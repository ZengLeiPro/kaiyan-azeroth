import {
  APPROVAL_ACTION,
  APPROVAL_INSTANCE_STATUS,
  APPROVAL_TASK_STATUS,
  type ApprovalEventTypeValue,
} from '@ky-azeroth/shared/constants';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { auditCreate } from '../../common/utils/audit-helper';
import { pickCurrentNodeApproverIds } from './approval-current-approvers.helper';
import {
  enqueueApprovalNotification,
  enqueueApprovalPendingNotifications,
} from './approval-notification-outbox.enqueue';
import { ApprovalNotifier } from './approval-notifier.service';
import { ApprovalQueryService } from './approval-query.service';
import {
  ApprovalTransitionEngine,
  type ApprovalTransitionResult,
} from './approval-transition.engine';
import { ApproverResolverService } from './approver-resolver.service';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { QueryApprovalDto } from './dto/query-approval.dto';

type CurrentUser = { id: string; employeeId?: string | null };

interface CreateApprovalInstanceInput {
  eventType: ApprovalEventTypeValue;
  formId: string;
  formCode: string;
  title: string;
  targetVersion: number;
}

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approverResolver: ApproverResolverService,
    private readonly serialNumberService: SerialNumberService,
    private readonly transitionEngine: ApprovalTransitionEngine,
    private readonly notifier: ApprovalNotifier,
    private readonly queryService: ApprovalQueryService
  ) {}
  async createApprovalInstance(
    tx: Prisma.TransactionClient,
    dto: CreateApprovalInstanceInput,
    currentUser: CurrentUser
  ) {
    const userId = currentUser.id;
    if (!Number.isInteger(dto.targetVersion) || dto.targetVersion < 1) {
      throw new ConflictException('审批目标缺少有效版本快照，拒绝创建审批实例');
    }

    const existing = await tx.approvalInstance.findFirst({
      where: {
        eventType: dto.eventType,
        formId: dto.formId,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
      },
    });
    if (existing) {
      throw new BadRequestException('该表单已有进行中的审批');
    }

    const flow = await tx.approvalFlow.findFirst({
      where: {
        eventType: dto.eventType,
        status: 'active',
      },
      include: {
        nodes: {
          orderBy: { nodeOrder: 'asc' },
        },
      },
    });
    if (!flow) {
      throw new BadRequestException(`未配置 ${dto.eventType} 类型的审批流程`);
    }
    if (flow.nodes.length === 0) {
      throw new BadRequestException('审批流程未配置审批节点');
    }

    const initiatorInfo = await this.approverResolver.getUserInfo(userId);
    if (!initiatorInfo) {
      throw new BadRequestException('发起人信息不存在');
    }

    for (const node of flow.nodes) {
      const isValid = await this.approverResolver.validateNodeConfig(node, userId);
      if (!isValid) {
        throw new BadRequestException(`节点 "${node.nodeName}" 无法解析出有效审批人`);
      }
    }

    const firstNode = flow.nodes[0];
    if (!firstNode) {
      throw new BadRequestException('审批流程配置错误：无有效节点');
    }
    const approvers = await this.approverResolver.resolveApprovers(firstNode, userId);
    const code = await this.serialNumberService.generate(SerialNumberType.APPROVAL);

    const instance = await tx.approvalInstance.create({
      data: {
        code,
        flowId: flow.id,
        flowVersion: flow.version,
        eventType: dto.eventType,
        formId: dto.formId,
        formCode: dto.formCode,
        targetVersion: dto.targetVersion,
        title: dto.title,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        currentNode: 1,
        totalNodes: flow.nodes.length,
        initiatorId: userId,
        initiatorName: initiatorInfo.name,
        copyToIds: flow.copyToIds,
        ...auditCreate(currentUser),
      },
    });

    await tx.approvalTask.createMany({
      data: approvers.map((approver) => ({
        instanceId: instance.id,
        nodeOrder: 1,
        nodeName: firstNode.nodeName,
        approverId: approver.approverId,
        approverName: approver.approverName,
        approverType: approver.approverType,
        sequence: approver.sequence,
        status: APPROVAL_TASK_STATUS.PENDING,
        ...auditCreate(currentUser),
      })),
    });

    await tx.approvalRecord.create({
      data: {
        instanceId: instance.id,
        nodeOrder: 0,
        nodeName: null,
        operatorId: userId,
        operatorName: initiatorInfo.name,
        action: APPROVAL_ACTION.SUBMIT,
        result: null,
        comment: null,
      },
    });

    // 「申请人=审批人自动通过」链式推进：
    // 若首节点（或后续节点）的审批人包含发起人本人，按 multiType 规则自动通过本人那一份
    // 并可能整节点跳过 / 推进到下一节点，最终一路推到终态 approved 也有可能。
    // 推进后 instance 的 status/currentNode/version 都可能变化，需要 fresh-read 返回。
    await this.transitionEngine.autoPassSelfTasksAndAdvance(
      tx,
      instance.id,
      userId,
      currentUser,
      initiatorInfo.name
    );

    const refreshed = await tx.approvalInstance.findUnique({
      where: { id: instance.id },
      include: {
        flow: { select: { nodes: { select: { nodeOrder: true, multiType: true } } } },
        tasks: {
          where: { status: APPROVAL_TASK_STATUS.PENDING },
          select: { approverId: true, nodeOrder: true, sequence: true },
        },
      },
    });
    const notificationState = refreshed ?? instance;
    if (notificationState.status === APPROVAL_INSTANCE_STATUS.APPROVED) {
      await enqueueApprovalNotification(tx, {
        instanceId: instance.id,
        eventKey: `submitted-approved-v${notificationState.version}`,
        recipientEmployeeId: instance.initiatorId,
        title: '审批通过',
        content: `您发起的「${instance.title}」已审批通过`,
        link: `/approval/list?tab=initiated&instanceId=${instance.id}`,
      });
    } else if (refreshed && Array.isArray(refreshed.tasks)) {
      const approverIds = Array.from(
        new Set(pickCurrentNodeApproverIds(refreshed).filter((id) => id !== instance.initiatorId))
      );
      await enqueueApprovalPendingNotifications(tx, {
        instanceId: instance.id,
        approverEmployeeIds: approverIds,
        title: '待我审批',
        content: `${instance.initiatorName} 提交了：${instance.title}`,
        link: `/approval/list?tab=pending&instanceId=${instance.id}`,
      });
    }
    for (const copyToId of new Set(
      ((instance.copyToIds as string[] | null) ?? []).filter((id) => id !== instance.initiatorId)
    )) {
      await enqueueApprovalNotification(tx, {
        instanceId: instance.id,
        eventKey: `submitted-copy-v${notificationState.version}`,
        recipientEmployeeId: copyToId,
        title: '审批抄送',
        content: `${instance.initiatorName} 发起：${instance.title}`,
        link: `/approval/list?tab=copyTo&instanceId=${instance.id}`,
      });
    }
    return notificationState;
  }

  /**
   * 审批操作（通过/驳回）
   */

  async doApproval(instanceId: string, dto: ApprovalActionDto, currentUser: CurrentUser) {
    return this.executeTransition(instanceId, dto, currentUser, 'assigned');
  }

  async doAdminApproval(instanceId: string, dto: ApprovalActionDto, currentUser: CurrentUser) {
    return this.executeTransition(instanceId, dto, currentUser, 'admin');
  }

  private async executeTransition(
    instanceId: string,
    dto: ApprovalActionDto,
    currentUser: CurrentUser,
    operatorPolicy: 'assigned' | 'admin'
  ) {
    const result = await this.transitionEngine.execute({
      instanceId,
      dto,
      currentUser,
      operatorPolicy,
    });
    this.completeTransitionTodos(result, operatorPolicy);
    this.notifier
      .notifyOnApprovalAction({
        instance: result.instance,
        action: dto.action,
        finalStatus: result.status,
        nextApproverIds: result.nextApproverIds,
        operatorName: result.operatorName,
      })
      .catch((error) => {
        const prefix = operatorPolicy === 'admin' ? '管理员审批' : '审批操作';
        this.logger.error(
          `${prefix}通知发送失败 instanceId=${instanceId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    return { success: result.success, status: result.status };
  }

  private completeTransitionTodos(
    result: ApprovalTransitionResult,
    operatorPolicy: 'assigned' | 'admin'
  ): void {
    const completion = result.completeAllInstanceTodos
      ? this.notifier.completeDingtalkApprovalTodosByInstance(result.instance.id)
      : this.notifier.completeDingtalkApprovalTodosByTaskIds(result.completedTodoTaskIds);
    completion.catch((error) => {
      const prefix = operatorPolicy === 'admin' ? '管理员审批' : '审批';
      this.logger.warn(
        `${prefix}钉钉待办完成失败 instanceId=${result.instance.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }
  completeInstanceTodos(instanceId: string): void {
    this.notifier.completeDingtalkApprovalTodosByInstance(instanceId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`自动失效审批的钉钉待办完成失败 instanceId=${instanceId}: ${message}`);
    });
  }

  async withdraw(instanceId: string, currentUser: CurrentUser, comment?: string) {
    const result = await this.transitionEngine.withdraw({ instanceId, currentUser, comment });

    this.notifier.completeDingtalkApprovalTodosByInstance(instanceId).catch((err) => {
      this.logger.warn(
        `审批撤回钉钉待办完成失败 instanceId=${instanceId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });

    return result;
  }

  getPendingList(userId: string, query: QueryApprovalDto) {
    return this.queryService.getPendingList(userId, query);
  }

  getPendingCount(userId: string) {
    return this.queryService.getPendingCount(userId);
  }

  getCompletedList(userId: string, query: QueryApprovalDto) {
    return this.queryService.getCompletedList(userId, query);
  }

  getCopyToList(userId: string, query: QueryApprovalDto) {
    return this.queryService.getCopyToList(userId, query);
  }

  getInitiatedList(userId: string, query: QueryApprovalDto) {
    return this.queryService.getInitiatedList(userId, query);
  }

  getInstanceDetail(instanceId: string, currentUser: CurrentUser, hasAllScope: boolean) {
    return this.queryService.getInstanceDetail(instanceId, currentUser.id, hasAllScope);
  }

  getByForm(eventType: string, formId: string, currentUser: CurrentUser, hasAllScope: boolean) {
    return this.queryService.getByForm(eventType, formId, currentUser.id, hasAllScope);
  }

  getAllApprovals(query: QueryApprovalDto) {
    return this.queryService.getAllApprovals(query);
  }

  notifyOnSubmit(instanceId: string): Promise<void> {
    return this.notifier.notifyOnSubmit(instanceId);
  }
}
