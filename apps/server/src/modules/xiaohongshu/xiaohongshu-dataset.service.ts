import type {
  IXiaohongshuDatasetCatalogResponse,
  IXiaohongshuDatasetDefinition,
  IXiaohongshuDatasetField,
  IXiaohongshuDatasetParameter,
  IXiaohongshuDatasetQueryResponse,
  XiaohongshuDatasetAvailability,
  XiaohongshuDatasetParameterValueType,
  XiaohongshuReportRawPayload,
} from '@ky-azeroth/shared/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  XIAOHONGSHU_DATASET_BY_ID,
  XIAOHONGSHU_DATASET_REGISTRY,
  XiaohongshuApiClient,
  XiaohongshuDatasetRegistryEntry,
  XiaohongshuJsonValue,
} from '../xiaohongshu-core';
import { XiaohongshuDailyReportQueryDto, XiaohongshuDatasetQueryDto } from './dto';
import { XiaohongshuService } from './xiaohongshu.service';
import { XiaohongshuTokenService } from './xiaohongshu-token.service';

const BLOCKED_AVAILABILITY = new Set<XiaohongshuDatasetAvailability>([
  'connection_missing',
  'requires_whitelist',
  'requires_extra_scope',
  'role_unsupported',
  'contract_probe',
]);

const FIELD_LABELS: Record<string, string> = {
  time: '日期',
  statDate: '日期',
  campaign_id: '计划标识（ID）',
  campaign_name: '计划名称',
  unit_id: '单元标识（ID）',
  unit_name: '单元名称',
  creativity_id: '创意标识（ID）',
  creativity_name: '创意名称',
  creative_id: '创意标识（ID）',
  creative_name: '创意名称',
  note_id: '笔记标识（ID）',
  note_title: '笔记标题',
  keyword_id: '关键词标识（ID）',
  keyword: '关键词',
  search_word: '搜索词',
  spu_id: '标准化产品单元标识（SPU）',
  spu_name: '标准化产品单元名称（SPU）',
  status: '状态',
  fee: '消费',
  impression: '曝光',
  click: '点击',
  ctr: '点击率',
  acp: '点击成本',
  cpm: '千次曝光成本',
  interaction: '互动',
  like: '点赞',
  collect: '收藏',
  comment: '评论',
  follow: '关注',
  share: '分享',
  message_consult: '私信咨询',
  initiative_message: '私信开口',
  msg_leads_num: '私信留资',
  leads: '表单提交',
  valid_leads: '有效表单',
  create_time: '创建时间',
  update_time: '更新时间',
};

const SCOPE_LABELS: Readonly<Record<string, string>> = {
  account_manage: '账户管理权限',
  ad_manage: '广告管理权限',
  ad_query: '广告查询权限',
  report_service: '报表服务权限',
};

const PARAM_HINTS: Readonly<
  Record<string, Pick<IXiaohongshuDatasetParameter, 'label' | 'description' | 'valueType'>>
> = {
  campaign_group_ids: {
    label: '广告组标识列表',
    description: '要查询的广告组标识（ID）数组',
    valueType: 'string[]',
  },
  keywords: {
    label: '关键词列表',
    description: '要批量匹配的关键词数组',
    valueType: 'string[]',
  },
  note_id: { label: '笔记标识', description: '目标笔记标识（ID）', valueType: 'string' },
  note_ids: {
    label: '笔记标识列表',
    description: '目标笔记标识（ID）数组',
    valueType: 'string[]',
  },
  seed: {
    label: '种子词或种子对象',
    description: '官方推荐接口要求的种子词或种子对象',
    valueType: 'json',
  },
  sub_account_ids: {
    label: '子账户标识列表',
    description: '合作伙伴子账户标识（ID）数组',
    valueType: 'string[]',
  },
  target_config: {
    label: '定向配置',
    description: '官方 TargetConfig 结构',
    valueType: 'object',
  },
  taxonomy_id: {
    label: '类目标识',
    description: '关键词行业类目标识（ID）',
    valueType: 'string',
  },
  temporary_note_id: {
    label: '临时笔记标识',
    description: '待映射的临时笔记标识（ID）',
    valueType: 'string',
  },
  transaction_id: {
    label: '交易流水标识',
    description: '既有转账交易流水标识（ID）',
    valueType: 'string',
  },
  type: { label: '对象类型', description: '官方接口要求的对象类型', valueType: 'string' },
  name: { label: '对象名称', description: '待校验的对象名称', valueType: 'string' },
  unit_id: { label: '单元标识', description: '目标推广单元标识（ID）', valueType: 'string' },
};

@Injectable()
export class XiaohongshuDatasetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: XiaohongshuApiClient,
    private readonly tokens: XiaohongshuTokenService,
    private readonly legacy: XiaohongshuService
  ) {}

  async getCatalog(
    input: { advertiserId?: string } = {}
  ): Promise<IXiaohongshuDatasetCatalogResponse> {
    let connection: { scopes: unknown; status: string } | null;
    if (input.advertiserId) {
      const advertiser = await this.prisma.xiaohongshuAdvertiser.findFirst({
        where: {
          advertiserId: input.advertiserId,
          deletedAt: null,
          status: 'active',
          connection: { deletedAt: null, status: 'active' },
        },
        orderBy: { updatedAt: 'desc' },
        select: { connection: { select: { scopes: true, status: true } } },
      });
      connection = advertiser?.connection ?? null;
    } else {
      connection = await this.prisma.xiaohongshuConnection.findFirst({
        where: { deletedAt: null, status: 'active' },
        orderBy: { updatedAt: 'desc' },
        select: { scopes: true, status: true },
      });
    }
    const scopes = this.stringArray(connection?.scopes);
    const connected = connection?.status === 'active';
    return {
      datasets: XIAOHONGSHU_DATASET_REGISTRY.map((entry) =>
        this.toDefinition(entry, scopes, connected)
      ),
      scopes,
      connected,
      updatedAt: new Date().toISOString(),
    };
  }

  async getDefinition(
    datasetId: string,
    input: { advertiserId?: string } = {}
  ): Promise<IXiaohongshuDatasetDefinition> {
    if (!XIAOHONGSHU_DATASET_BY_ID.has(datasetId)) {
      throw new NotFoundException('小红书数据集不存在');
    }
    const catalog = await this.getCatalog(input);
    return catalog.datasets.find((dataset) => dataset.id === datasetId)!;
  }

  async query(
    datasetId: string,
    input: XiaohongshuDatasetQueryDto
  ): Promise<IXiaohongshuDatasetQueryResponse> {
    const entry = XIAOHONGSHU_DATASET_BY_ID.get(datasetId);
    if (!entry) throw new NotFoundException('小红书数据集不存在');

    const advertiser = await this.prisma.xiaohongshuAdvertiser.findFirst({
      where: {
        advertiserId: input.advertiserId,
        deletedAt: null,
        status: 'active',
        connection: { deletedAt: null, status: 'active' },
      },
      orderBy: { updatedAt: 'desc' },
      include: { connection: { select: { id: true, scopes: true } } },
    });
    if (!advertiser) throw new NotFoundException('未找到可用的小红书广告主授权');

    const scopes = this.stringArray(advertiser.connection.scopes);
    const definition = this.toDefinition(entry, scopes, true);
    if (!definition.queryable) {
      throw new BadRequestException(definition.availabilityReason ?? '当前数据集不可查询');
    }
    if (!entry.supportsDateRange && (input.startDate || input.endDate)) {
      throw new BadRequestException('当前数据集不支持日期范围参数');
    }
    if ((entry.pagination ?? 'page') === 'none' && input.page !== 1) {
      throw new BadRequestException('当前数据集不分页，page 必须为 1');
    }
    this.assertParamsContract(entry, input.params);

    if (entry.source === 'local_report') {
      return this.queryLocalReport(entry, definition, input);
    }
    if (!entry.endpoint) throw new BadRequestException('当前数据集没有可调用的公开读取接口');

    const accessToken = await this.tokens.getAccessToken(advertiser.connection.id);
    const request = this.buildRequest(entry, input);
    const result = await this.api.fetchReadData(
      accessToken,
      entry.endpoint,
      entry.method ?? 'POST',
      request
    );
    const normalized = this.normalizeResponse(entry, result.data, input.page, input.pageSize);
    return {
      dataset: definition,
      items: normalized.items,
      fields: this.fields(entry, normalized.items),
      total: normalized.total,
      totalMode: normalized.totalMode,
      hasMore: normalized.hasMore,
      page: input.page,
      pageSize: input.pageSize,
      totalPages:
        definition.pagination === 'none' ? 1 : Math.ceil(normalized.total / input.pageSize),
      aggregation: normalized.aggregation,
      metadata: normalized.metadata,
      requestId: result.requestId ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async queryLocalReport(
    entry: XiaohongshuDatasetRegistryEntry,
    definition: IXiaohongshuDatasetDefinition,
    input: XiaohongshuDatasetQueryDto
  ): Promise<IXiaohongshuDatasetQueryResponse> {
    const level = String(
      entry.defaults?.level ?? 'account'
    ) as XiaohongshuDailyReportQueryDto['level'];
    const result = await this.legacy.getReports({
      advertiserId: input.advertiserId,
      startDate: input.startDate,
      endDate: input.endDate,
      dataCaliber: input.dataCaliber,
      level,
      page: input.page,
      pageSize: input.pageSize,
      sortOrder: 'desc',
    });
    const items = result.items.map((item) => ({
      ...item.rawPayload,
      _ky_id: item.id,
      _ky_stat_date: item.statDate,
      _ky_entity_name:
        item.noteTitle ??
        item.creativeName ??
        item.unitName ??
        item.campaignName ??
        item.advertiserName ??
        null,
      _ky_fee: Number(item.fee),
      _ky_impression: item.impression,
      _ky_click: item.click,
      _ky_interaction: item.interaction,
      _ky_message_consult: item.messageConsult ?? null,
      _ky_message_lead: item.messageLead ?? null,
    })) as XiaohongshuReportRawPayload[];
    return {
      dataset: definition,
      items,
      fields: this.fields(entry, items),
      total: result.total,
      totalMode: 'exact',
      hasMore: result.page < result.totalPages,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      aggregation: null,
      metadata: null,
      requestId: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  private buildRequest(
    entry: XiaohongshuDatasetRegistryEntry,
    input: XiaohongshuDatasetQueryDto
  ): Record<string, unknown> {
    const request: Record<string, unknown> = {
      ...entry.defaults,
      ...input.params,
      advertiser_id: input.advertiserId,
    };
    if (entry.supportsDateRange) {
      if (input.startDate) request.start_date = input.startDate;
      if (input.endDate) request.end_date = input.endDate;
    }
    if (entry.supportsDataCaliber) request.data_caliber = input.dataCaliber;

    switch (entry.pagination ?? 'page') {
      case 'page_object':
        request.page = { page_index: input.page, page_size: input.pageSize };
        break;
      case 'page_num':
        request.page_num = input.page;
        request.page_size = input.pageSize;
        break;
      case 'page_index':
        request.page_index = input.page;
        request.page_size = input.pageSize;
        break;
      case 'page_camel':
        request.pageNum = input.page;
        request.pageSize = input.pageSize;
        break;
      case 'page':
        request.page = input.page;
        request.page_size = input.pageSize;
        break;
      case 'none':
        break;
    }
    return request;
  }

  private normalizeResponse(
    entry: XiaohongshuDatasetRegistryEntry,
    value: unknown,
    page: number,
    pageSize: number
  ): {
    items: XiaohongshuReportRawPayload[];
    total: number;
    totalMode: 'exact' | 'estimated';
    hasMore: boolean;
    aggregation: XiaohongshuReportRawPayload | null;
    metadata: XiaohongshuReportRawPayload | null;
  } {
    // 无分页接口一次返回完整集合，不能把业务对象里的 total 字段误认成分页总数。
    const noPagination = (entry.pagination ?? 'page') === 'none';
    const rows = this.findArray(value, entry.itemPaths ?? []);
    const explicitTotal = noPagination ? null : this.findNumber(value, entry.totalPaths ?? []);
    const singular =
      rows === null &&
      explicitTotal === null &&
      this.isObject(value) &&
      Object.keys(value).length > 0
        ? [value]
        : [];
    const items = (rows ?? singular)
      .filter((item): item is Record<string, unknown> => this.isObject(item))
      .map((item) => this.jsonObject(item));
    const hasMore = noPagination
      ? false
      : explicitTotal != null
        ? page * pageSize < explicitTotal
        : items.length >= pageSize;
    const total = noPagination
      ? items.length
      : (explicitTotal ?? (hasMore ? page * pageSize + 1 : (page - 1) * pageSize + items.length));
    const aggregationValue = this.findValue(
      value,
      entry.aggregationPaths ?? ['aggregation_data', 'total_data', 'aggregation']
    );
    const aggregation = this.isObject(aggregationValue) ? this.jsonObject(aggregationValue) : null;
    return {
      items,
      total,
      totalMode: noPagination || explicitTotal != null ? 'exact' : 'estimated',
      hasMore,
      aggregation,
      metadata: this.responseMetadata(value, rows, aggregationValue),
    };
  }

  /** 保留官方响应中行数据与汇总之外的兼容性提示、统计口径和分页元数据。 */
  private responseMetadata(
    value: unknown,
    rows: unknown[] | null,
    aggregation: unknown
  ): XiaohongshuReportRawPayload | null {
    if (!rows || !this.isObject(value)) return null;
    const metadata = this.pruneResponseData(value, rows, aggregation);
    return this.isObject(metadata) && Object.keys(metadata).length > 0
      ? this.jsonObject(metadata)
      : null;
  }

  private pruneResponseData(value: unknown, rows: unknown[], aggregation: unknown): unknown {
    if (value === rows || (aggregation !== undefined && value === aggregation)) return undefined;
    if (Array.isArray(value)) {
      return value
        .map((item) => this.pruneResponseData(item, rows, aggregation))
        .filter((item) => item !== undefined);
    }
    if (!this.isObject(value)) return value;

    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, this.pruneResponseData(item, rows, aggregation)] as const)
        .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
    );
  }

  private toDefinition(
    entry: XiaohongshuDatasetRegistryEntry,
    scopes: string[],
    connected: boolean
  ): IXiaohongshuDatasetDefinition {
    const connectionMissing = !connected;
    const scopeMissing = Boolean(
      !connectionMissing && entry.requiredScope && !scopes.includes(entry.requiredScope)
    );
    const availability: XiaohongshuDatasetAvailability = connectionMissing
      ? 'connection_missing'
      : scopeMissing
        ? 'scope_missing'
        : (entry.availability ?? 'available');
    const blocked = connectionMissing || scopeMissing || BLOCKED_AVAILABILITY.has(availability);
    return {
      id: entry.id,
      label: entry.label,
      group: entry.group,
      description: entry.description,
      requiredScope: entry.requiredScope ?? null,
      availability,
      availabilityReason: connectionMissing
        ? '当前没有有效的小红书聚光连接'
        : scopeMissing
          ? `当前开放授权（OAuth）缺少${SCOPE_LABELS[entry.requiredScope ?? ''] ?? '所需权限'}（${entry.requiredScope} scope）`
          : (entry.availabilityReason ?? null),
      queryable: !blocked && (entry.source === 'local_report' || Boolean(entry.endpoint)),
      source: entry.source,
      endpoint: entry.endpoint ?? null,
      method: entry.source === 'official_api' && entry.endpoint ? (entry.method ?? 'POST') : null,
      requiredParams: entry.requiredParams ?? [],
      parameters: this.parameters(entry),
      allowsAdditionalParams: entry.source === 'official_api',
      pagination: entry.pagination ?? 'page',
      supportsDateRange: entry.supportsDateRange ?? false,
      supportsDataCaliber: entry.supportsDataCaliber ?? false,
      defaults: {
        ...(entry.supportsDataCaliber ? { dataCaliber: 0 } : {}),
        ...((entry.pagination ?? 'page') !== 'none' ? { page: 1, pageSize: 50 } : {}),
        ...(entry.defaults ?? {}),
      },
      coreFields: entry.coreFields ?? [],
    };
  }

  private parameters(entry: XiaohongshuDatasetRegistryEntry): IXiaohongshuDatasetParameter[] {
    const parameters: IXiaohongshuDatasetParameter[] = [
      {
        name: 'advertiserId',
        label: '广告主标识',
        description: '已授权的小红书聚光广告主标识（ID）',
        source: 'request',
        required: true,
        valueType: 'string',
      },
    ];
    if (entry.supportsDateRange) {
      parameters.push(
        {
          name: 'startDate',
          label: '开始日期',
          description: '查询开始日期，格式 YYYY-MM-DD',
          source: 'request',
          required: false,
          valueType: 'string',
        },
        {
          name: 'endDate',
          label: '结束日期',
          description: '查询结束日期，格式 YYYY-MM-DD',
          source: 'request',
          required: false,
          valueType: 'string',
        }
      );
    }
    if (entry.supportsDataCaliber) {
      parameters.push({
        name: 'dataCaliber',
        label: '数据口径',
        description: '0 按计费/点击时间，1 按转化时间',
        source: 'request',
        required: false,
        valueType: 'number',
        enumValues: [0, 1],
      });
    }
    if ((entry.pagination ?? 'page') !== 'none') {
      parameters.push(
        {
          name: 'page',
          label: '页码',
          description: '从 1 开始的页码',
          source: 'request',
          required: false,
          valueType: 'number',
        },
        {
          name: 'pageSize',
          label: '每页数量',
          description: '每页 1—100 条',
          source: 'request',
          required: false,
          valueType: 'number',
        }
      );
    }
    if (entry.source === 'official_api') {
      parameters.push({
        name: 'params',
        label: '官方扩展参数',
        description: '按官方数据集契约透传的扩展参数对象；控制字段仍使用请求顶层参数',
        source: 'request',
        required: false,
        valueType: 'object',
      });
    }
    for (const name of entry.requiredParams ?? []) {
      const hint = PARAM_HINTS[name];
      parameters.push({
        name,
        label: hint?.label ?? '接口参数',
        description: hint?.description ?? '官方接口要求的上下文参数',
        source: 'params',
        required: true,
        valueType: hint?.valueType ?? 'json',
      });
    }
    return parameters;
  }

  /** 必填参数的展示契约和运行时校验共用 PARAM_HINTS，避免 describe 与实际调用漂移。 */
  private assertParamsContract(
    entry: XiaohongshuDatasetRegistryEntry,
    params: Record<string, unknown>
  ): void {
    if (entry.source === 'local_report' && Object.keys(params).length > 0) {
      throw new BadRequestException('本地日报数据集不接受 params 扩展参数');
    }

    const missing = (entry.requiredParams ?? []).filter((key) =>
      this.isMissingRequiredParam(params[key])
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `当前数据集还需要参数：${missing
          .map((key) => `${PARAM_HINTS[key]?.label ?? '接口参数'}（${key}）`)
          .join('、')}`
      );
    }

    for (const key of entry.requiredParams ?? []) {
      const valueType = PARAM_HINTS[key]?.valueType ?? 'json';
      if (!this.matchesParameterType(params[key], valueType)) {
        throw new BadRequestException(
          `参数 ${PARAM_HINTS[key]?.label ?? '接口参数'}（${key}）类型不正确，期望 ${valueType}`
        );
      }
    }
  }

  private isMissingRequiredParam(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return this.isObject(value) && Object.keys(value).length === 0;
  }

  private matchesParameterType(
    value: unknown,
    valueType: XiaohongshuDatasetParameterValueType
  ): boolean {
    switch (valueType) {
      case 'string':
        return typeof value === 'string' && value.trim().length > 0;
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'string[]':
        return (
          Array.isArray(value) &&
          value.length > 0 &&
          value.every((item) => typeof item === 'string' && item.trim().length > 0)
        );
      case 'number[]':
        return (
          Array.isArray(value) &&
          value.length > 0 &&
          value.every((item) => typeof item === 'number' && Number.isFinite(item))
        );
      case 'object':
        return this.isObject(value) && Object.keys(value).length > 0;
      case 'json':
        return !this.isMissingRequiredParam(value);
    }
  }

  private fields(
    entry: XiaohongshuDatasetRegistryEntry,
    items: XiaohongshuReportRawPayload[]
  ): IXiaohongshuDatasetField[] {
    const keys = [...new Set(items.flatMap((item) => Object.keys(item)))];
    const core = new Set(entry.coreFields ?? []);
    return keys
      .map((key) => ({
        key,
        label: FIELD_LABELS[key] ?? this.humanize(key),
        group: this.fieldGroup(key),
        valueType: this.valueType(items.map((item) => item[key])),
        isCore: core.has(key),
      }))
      .sort(
        (a, b) =>
          Number(b.isCore) - Number(a.isCore) ||
          a.group.localeCompare(b.group) ||
          a.key.localeCompare(b.key)
      );
  }

  private findArray(value: unknown, paths: string[]): unknown[] | null {
    for (const path of paths) {
      const found = this.getPath(value, path);
      if (Array.isArray(found)) return found;
    }
    if (Array.isArray(value)) return value;
    if (!this.isObject(value)) return null;
    for (const item of Object.values(value)) {
      if (Array.isArray(item) && item.every((row) => this.isObject(row))) return item;
    }
    return null;
  }

  private findNumber(value: unknown, paths: string[]): number | null {
    for (const path of paths) {
      const found = this.getPath(value, path);
      const parsed =
        typeof found === 'number' ? found : typeof found === 'string' ? Number(found) : NaN;
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private findValue(value: unknown, paths: string[]): unknown {
    for (const path of paths) {
      const found = this.getPath(value, path);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  private getPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      return this.isObject(current) ? current[key] : undefined;
    }, value);
  }

  private fieldGroup(key: string): string {
    const lower = key.toLowerCase();
    if (/^(time|.*_time|.*date|.*_at|_ky_)/.test(lower)) return '系统与口径';
    if (
      /(campaign|unit|creative|creativity|note|keyword|search_word|spu|target|group).*?(id|name|title)?$/.test(
        lower
      )
    )
      return '对象与关联';
    if (/(fee|cost|budget|balance|amount|price|roi|gmv)/.test(lower)) return '成本与资金';
    if (/(impression|click|ctr|cpm|acp|visit|read|play)/.test(lower)) return '流量';
    if (/(interaction|like|collect|comment|follow|share)/.test(lower)) return '内容互动';
    if (/(lead|message|form|wechat|phone|consult|submit|activate|register|pay)/.test(lower))
      return '线索与转化';
    if (/(status|audit|reason|scope|role)/.test(lower)) return '状态与治理';
    return '其他字段';
  }

  private valueType(
    values: Array<XiaohongshuJsonValue | undefined>
  ): IXiaohongshuDatasetField['valueType'] {
    const types = new Set(
      values
        .filter((value) => value !== undefined)
        .map((value) =>
          value === null
            ? 'null'
            : Array.isArray(value)
              ? 'array'
              : typeof value === 'object'
                ? 'object'
                : typeof value
        )
    );
    if (types.size !== 1) return 'mixed';
    const [type] = types;
    return type === 'string' ||
      type === 'number' ||
      type === 'boolean' ||
      type === 'object' ||
      type === 'array' ||
      type === 'null'
      ? type
      : 'mixed';
  }

  private humanize(key: string): string {
    return `其他字段（${key}）`;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private jsonObject(value: Record<string, unknown>): XiaohongshuReportRawPayload {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.jsonValue(item)])
    );
  }

  private jsonValue(value: unknown): XiaohongshuJsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((item) => this.jsonValue(item));
    if (this.isObject(value)) return this.jsonObject(value);
    return String(value);
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
