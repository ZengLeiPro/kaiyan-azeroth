import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DingtalkAuth } from '../dingtalk-core/dingtalk-auth.service';
import { isDingtalkTokenInvalidResponse } from '../dingtalk-core/dingtalk-errors';
import { DingtalkHttp } from '../dingtalk-core/dingtalk-http';

const DEFAULT_OAPI_BASE_URL = 'https://oapi.dingtalk.com';
/** OA action_card markdown 整体上限：钉钉文档允许 5000，但客户端渲染稳态约 2000 */
const MARKDOWN_MAX_LEN = 2000;
interface AsyncsendV2Response {
  errcode?: number;
  errmsg?: string;
  subCode?: string;
  subMsg?: string;
  sub_code?: string;
  sub_msg?: string;
  task_id?: number;
  request_id?: string;
}

export interface SendActionCardParams {
  /** 目标钉钉 userId 列表（已过滤空值；空数组直接返回） */
  dingtalkUserIds: string[];
  /** 卡片标题，显示在消息列表预览与卡片顶部 */
  title: string;
  /** 卡片正文（钉钉支持有限 markdown：粗体/换行/列表/引用/链接） */
  markdown: string;
  /** 底部按钮文案，例如「查看审批详情」 */
  singleTitle: string;
  /** 点击卡片或底部按钮跳转的绝对 URL */
  singleUrl: string;
}

/**
 * 钉钉工作通知下行服务
 *
 * 负责调用钉钉 OpenAPI `topapi/message/corpconversation/asyncsend_v2`，
 * 向指定钉钉 userId 列表发送 OA action_card 工作通知。
 *
 * 设计原则：
 * - 通用能力：不耦合任何业务语义（审批/订单/拜访由调用方传入 markdown）
 * - 失败不抛出：所有异常 catch 后写 logger.warn，并用 false 让 outbox 等调用方决定是否重试
 * - 共享 token：通过 DingtalkAuthModule 单例 DingtalkAuth 共享 access_token 缓存
 * - 配置即开关：`DINGTALK_AGENT_ID` 缺失时直接跳过发送（写一次 warn 日志），
 *   便于本地/测试环境快速关闭钉钉外呼
 *
 * 鲁棒性：
 * - errcode=88 且子错误明确为 token 失效：自动 invalidate + 重试一次
 * - markdown 过长：截断到 MARKDOWN_MAX_LEN 防止钉钉客户端渲染异常或拒绝
 * - 分批日志：聚合记录 batchIndex / batchTotal / errcode / request_id 便于排障
 *
 * 钉钉接口约束（文档：
 * https://open.dingtalk.com/document/orgapp/asynchronous-sending-of-enterprise-session-messages）：
 * - userid_list 最多 100 人，多人时英文逗号分隔
 * - title ≤ 64 char，markdown ≤ 5000 char（钉钉客户端实际渲染 ~2048 较稳）
 * - 同一应用对同一 userId 1 分钟内不超过 30 条
 */
@Injectable()
export class DingtalkMessengerService {
  private readonly logger = new Logger(DingtalkMessengerService.name);
  private readonly http: DingtalkHttp;
  /** 已校验的 agentId（数字形式）。0 表示未配置或非法，运行时跳过推送 */
  private readonly agentId: number;

  constructor(
    private readonly config: ConfigService,
    private readonly auth: DingtalkAuth
  ) {
    const rawAgentId = (this.config.get<string>('DINGTALK_AGENT_ID') ?? '').trim();
    const oapiBaseUrl = this.config.get<string>('DINGTALK_OAPI_BASE_URL') ?? DEFAULT_OAPI_BASE_URL;

    this.http = new DingtalkHttp({
      baseUrl: oapiBaseUrl,
      timeout: 30,
      maxRetries: 3,
      qps: 20,
    });

    if (rawAgentId === '') {
      // 未配置：仅 warn，运行时也跳过（兼顾本地/测试环境）
      this.agentId = 0;
      this.logger.warn('DINGTALK_AGENT_ID 未配置，钉钉工作通知推送将被跳过');
    } else {
      const parsed = Number(rawAgentId);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        // 配了但格式非法：fail fast，让生产部署立刻可见，而不是默默静默
        throw new Error(`DINGTALK_AGENT_ID 必须是正整数，当前值="${rawAgentId}" parsed=${parsed}`);
      }
      this.agentId = parsed;
    }
  }

  /**
   * 发送 OA action_card 工作通知给一批钉钉 userId。
   *
   * 失败处理：
   * - userid_list 为空 → 静默 no-op
   * - agentId 未配置 → warn + 跳过
   * - errcode=88 且子错误明确为 token 失效 → invalidate + 重试一次
   * - 其他钉钉接口 errcode !== 0 → warn 记录 errcode/errmsg，不抛出
   * - 网络异常 → warn 记录错误，不抛出
   */
  async sendActionCardToUsers(params: SendActionCardParams): Promise<boolean> {
    const userIds = (params.dingtalkUserIds ?? []).filter((id) => !!id);
    if (userIds.length === 0) return false;
    if (!this.agentId) {
      this.logger.warn(`钉钉工作通知跳过：DINGTALK_AGENT_ID 未配置（目标 ${userIds.length} 人）`);
      return false;
    }

    // markdown 整体兜底截断（builder 应已控制单字段，此处是双保险）
    const safeMarkdown =
      params.markdown.length > MARKDOWN_MAX_LEN
        ? params.markdown.slice(0, MARKDOWN_MAX_LEN - 1) + '…'
        : params.markdown;
    const safeParams: SendActionCardParams = { ...params, markdown: safeMarkdown };

    // 钉钉 userid_list 上限 100，超出分批发送
    const BATCH_SIZE = 100;
    const batchTotal = Math.ceil(userIds.length / BATCH_SIZE);
    let allSucceeded = true;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const batchIndex = i / BATCH_SIZE + 1;
      allSucceeded =
        (await this.sendOneBatchWithRetry(batch, safeParams, batchIndex, batchTotal)) &&
        allSucceeded;
    }
    return allSucceeded;
  }

  private async sendOneBatchWithRetry(
    batchUserIds: string[],
    params: SendActionCardParams,
    batchIndex: number,
    batchTotal: number
  ): Promise<boolean> {
    // 首次发送
    const firstResult = await this.sendOneBatch(batchUserIds, params, batchIndex, batchTotal);
    if (!firstResult.tokenInvalid) return firstResult.success;

    // 只有子错误明确指向 token 失效时才清缓存；裸 errcode=88 只是通用鉴权异常。
    this.logger.warn(
      `钉钉工作通知子错误确认 token 失效，invalidate 后重试 batch=${batchIndex}/${batchTotal}`
    );
    this.auth.invalidate();
    return (await this.sendOneBatch(batchUserIds, params, batchIndex, batchTotal)).success;
  }

  /** 单批发送，返回是否已确认 token 失效，让上层判断是否需要重试 */
  private async sendOneBatch(
    batchUserIds: string[],
    params: SendActionCardParams,
    batchIndex: number,
    batchTotal: number
  ): Promise<{ tokenInvalid: boolean; success: boolean }> {
    let token: string;
    try {
      token = await this.auth.getAccessToken();
    } catch (err) {
      this.logger.warn(
        `钉钉工作通知 access_token 获取失败 batch=${batchIndex}/${batchTotal}: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      return { tokenInvalid: false, success: false };
    }

    const body = {
      agent_id: this.agentId,
      userid_list: batchUserIds.join(','),
      msg: {
        msgtype: 'action_card',
        action_card: {
          title: params.title,
          markdown: params.markdown,
          single_title: params.singleTitle,
          single_url: params.singleUrl,
        },
      },
    };

    try {
      const resp = await this.http.post<AsyncsendV2Response>(
        '/topapi/message/corpconversation/asyncsend_v2',
        body,
        { params: { access_token: token } }
      );
      const errcode = resp?.errcode ?? 0;

      if (errcode !== 0) {
        this.logger.warn(
          `钉钉工作通知发送失败 errcode=${errcode} errmsg=${resp?.errmsg} ` +
            `subCode=${resp?.subCode ?? resp?.sub_code} subMsg=${resp?.subMsg ?? resp?.sub_msg} ` +
            `request_id=${resp?.request_id} batch=${batchIndex}/${batchTotal} ` +
            `userid_count=${batchUserIds.length} title=${params.title}`
        );
        return { tokenInvalid: isDingtalkTokenInvalidResponse(resp), success: false };
      }

      this.logger.log(
        `钉钉工作通知已发送 task_id=${resp.task_id} request_id=${resp.request_id} ` +
          `batch=${batchIndex}/${batchTotal} userid_count=${batchUserIds.length} title=${params.title}`
      );
      return { tokenInvalid: false, success: true };
    } catch (err) {
      this.logger.warn(
        `钉钉工作通知发送异常 batch=${batchIndex}/${batchTotal}: ` +
          `${err instanceof Error ? err.message : String(err)} ` +
          `title=${params.title} userid_count=${batchUserIds.length}`
      );
      return { tokenInvalid: false, success: false };
    }
  }
}
