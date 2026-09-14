import { ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/** 超过默认分页上限时，仅 viewScope=ALL（chargerScope=null）允许继续。 */
export function assertLargePageSizeAllowed(
  pageSize: number | undefined,
  chargerScope: string[] | null
): void {
  if ((pageSize ?? 0) > 500 && chargerScope !== null) {
    throw new ForbiddenException('pageSize 超过 500 需要该菜单的全部数据范围');
  }
}

/**
 * 数据范围服务(可配置 viewScope 版本)
 *
 * 改造背景:原硬编码角色逻辑(ADMIN→ALL / CRM_MANAGER→DEPT / 其他→SELF)
 * 已替换为按 RolePermission.viewScope 配置:每个 (role, module, menu) 一档,
 * 多角色取最大范围(OR:任一 ALL → 最终 ALL)。
 *
 * 返回值三态语义(保留与历史一致):
 * - null     → 无限制(ALL)
 * - []       → 无任何可见数据(理论上不会出现:默认 SELF 至少能看自己)
 * - string[] → 可见的 employeeId 集合(SELF 档为 [employeeId])
 *
 * ADMIN 角色也不再硬编码放行,而是与普通角色一样读取 system/roles 的 viewScope 配置。
 *
 * 授权 scope 不得依赖进程本地缓存：每次请求都从共享数据库读取当前 active、未删除角色，
 * 使跨实例角色停用/删除和 SELF/ALL 变更立即生效。
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 解析多个菜单共享同一资源时的最大数据范围（任一 ALL → ALL）。 */
  async resolveChargerScopeAny(
    userId: string,
    permissions: Array<{ module: string; menu: string }>,
    options?: { employeeId?: string }
  ): Promise<string[] | null> {
    const scopes = await Promise.all(
      permissions.map((permission) =>
        this.resolveChargerScope(userId, [], permission.module, permission.menu, options)
      )
    );
    if (scopes.some((scope) => scope === null)) return null;
    return Array.from(new Set(scopes.flatMap((scope) => scope ?? [])));
  }

  /**
   * 解析用户在某菜单上的数据可见范围。
   *
   * @param userId      `user.id`,在 push 4+ 实际就是 employee.id
   * @param roles       `user.roles`,角色 code 列表(如 ['SALES', 'PM'])
   * @param module      RolePermission.module(如 'crm')
   * @param menu        RolePermission.menu(如 'customers')
   * @param options.employeeId 已知的 employeeId,避免重复推导
   */
  async resolveChargerScope(
    userId: string,
    roles: string[],
    module: string,
    menu: string,
    options?: { employeeId?: string }
  ): Promise<string[] | null> {
    // 1. 解析 employeeId
    const employeeId = options?.employeeId ?? userId;
    if (!employeeId) return []; // 未关联员工 → 无可见

    // 2. 查 RolePermission 取 viewScope 列表。授权判定始终直读共享 DB，不走进程缓存。
    //    同一 employee 可能有多个角色 → 多行;同一菜单同一角色唯一一行
    const rows = await this.prisma.rolePermission.findMany({
      where: {
        module,
        menu,
        role: {
          deletedAt: null,
          status: 'active',
          users: { some: { employeeId } },
        },
      },
      select: { viewScope: true },
    });

    // 3. 取最大范围:任一 ALL → null；全部 SELF 或无任何行时兜底 SELF。
    return rows.some((r) => r.viewScope === 'ALL') ? null : [employeeId];
  }
}

/**
 * 通用 RBAC where 注入:把 chargerScope 注入为「双路径 OR」
 *
 *   chargerId IN scope OR customer.chargerId IN scope
 *
 * 含义:
 * 1. **业绩归属是我的**:实体自身 chargerId = 我
 * 2. **客户名下、业绩归历史经手人**:客户从离职销售转给我后,历史订单/商机/跟进/拜访
 *    的 chargerId 仍是原经手人,但 customer.chargerId 已迁移到我
 *
 * 适用:sale_orders / opportunities / keep_records / visit_records / payments
 * (凡是同时拥有自身 chargerId 字段 + customerId 关联 customer 的实体)。
 *
 * invoices 因 schema 无自身 chargerId 字段,由 service 层手拼单路径
 * `customer.chargerId IN scope`,是本函数的退化形。
 *
 * 调用方在传给 FilterApplier 时必须传 `chargerScope: null`,否则 applier
 * 会在 isScopeField 字段上额外注入 AND 把 OR 收紧成空集。配套地,对应
 * filter-registry 的 chargerId 字段也要去掉 `isScopeField: true` 标记。
 *
 * @returns 直接 mutate baseWhere 并返回它,方便链式调用。
 */
export function applyChargerOrCustomerScope<W extends Record<string, unknown>>(
  baseWhere: W,
  chargerScope: string[] | null | undefined
): W & { OR?: Array<Record<string, unknown>> } {
  if (chargerScope === undefined || chargerScope === null) {
    return baseWhere as W & { OR?: Array<Record<string, unknown>> };
  }
  // 保留原 mutate 语义以兼容历史调用(如把同一对象反复传给多个 helper)
  const target = baseWhere as W & { OR?: Array<Record<string, unknown>> };
  target.OR = [
    { chargerId: { in: chargerScope } },
    { customer: { chargerId: { in: chargerScope } } },
  ];
  return target;
}

/**
 * Customer 自身查询的访问范围:负责人 OR 协作人
 *
 *   chargerId IN scope OR collaboratorIds @> [me]
 *
 * 适用:Customer 模块自身(findAll / findOne / update / remove 等)。
 *
 * 注意:调用方必须把 `chargerScope: null` 传给 FilterApplier,且 Customer
 * filter-registry 中 chargerId 字段不能带 `isScopeField: true`,否则
 * applier 会再次注入 AND chargerId IN scope,把 OR 收紧为空。
 */
export function applyCustomerCollabSelfScope<W extends Record<string, unknown>>(
  baseWhere: W,
  chargerScope: string[] | null | undefined,
  currentEmployeeId: string | null | undefined
): W & { OR?: Array<Record<string, unknown>> } {
  if (chargerScope === undefined || chargerScope === null) {
    return baseWhere as W & { OR?: Array<Record<string, unknown>> };
  }
  const target = baseWhere as W & { OR?: Array<Record<string, unknown>> };
  const or: Array<Record<string, unknown>> = [{ chargerId: { in: chargerScope } }];
  if (currentEmployeeId) {
    or.push({ collaboratorIds: { array_contains: [currentEmployeeId] } });
  }
  target.OR = or;
  return target;
}

/**
 * 关联业务(带自身 chargerId)的访问范围:自身负责人 OR 客户负责人 OR 客户协作人
 * OR 客户在公海
 *
 *   chargerId IN scope
 *   OR customer.chargerId IN scope
 *   OR customer.collaboratorIds @> [me]
 *   OR customer.chargerId IS NULL  // 公海客户的关联业务历史对所有 view 权限可见
 *
 * 适用:opportunities / sale-orders / payments / keep-records / visit-records
 * (凡同时拥有自身 chargerId 字段 + customerId 关联 customer 的实体)。
 *
 * 公海可见的业务理由（2026-06-04 加入）：
 * 公海客户的语义本就是「任何人可认领」，认领候选人在认领前必须能看到该客户
 * 历史跟进/拜访/商机/订单/回款，否则只能基于客户名盲认。此前因三路径全部
 * 依赖 chargerId 命中，公海客户（chargerId=NULL）的历史业务对所有非 ADMIN
 * 角色完全不可见——前端公海客户详情各 Tab 全空，CLI total=0。
 * 例如：公海客户 CUS90001，历史跟进仍挂在已离职员工上，
 * 若没有公海可见路径，其他销售无法在认领前看到这些记录。
 */
export function applyCustomerCollabViaCustomerScope<W extends Record<string, unknown>>(
  baseWhere: W,
  chargerScope: string[] | null | undefined,
  currentEmployeeId: string | null | undefined
): W & { OR?: Array<Record<string, unknown>> } {
  if (chargerScope === undefined || chargerScope === null) {
    return baseWhere as W & { OR?: Array<Record<string, unknown>> };
  }
  const target = baseWhere as W & { OR?: Array<Record<string, unknown>> };
  const or: Array<Record<string, unknown>> = [
    { chargerId: { in: chargerScope } },
    { customer: { chargerId: { in: chargerScope } } },
    // 公海客户的历史关联业务对所有持有 view 权限的角色可见
    { customer: { chargerId: null } },
  ];
  if (currentEmployeeId) {
    or.push({ customer: { collaboratorIds: { array_contains: [currentEmployeeId] } } });
  }
  target.OR = or;
  return target;
}

/**
 * 关联业务写入范围：自身负责人 OR 客户负责人 OR 客户协作人。
 *
 * 与读取规则 `applyCustomerCollabViaCustomerScope` 的关键差异是：不放行公海客户。
 * 公海可见是为了认领前查看历史，不代表任何有 view 权限的人都能新增回款、退款
 * 或发票等会改变客户财务事实的记录。
 */
export function applyCustomerCollabViaCustomerWriteScope<W extends Record<string, unknown>>(
  baseWhere: W,
  chargerScope: string[] | null | undefined,
  currentEmployeeId: string | null | undefined
): W & { OR?: Array<Record<string, unknown>> } {
  if (chargerScope === undefined || chargerScope === null) {
    return baseWhere as W & { OR?: Array<Record<string, unknown>> };
  }
  const target = baseWhere as W & { OR?: Array<Record<string, unknown>> };
  const or: Array<Record<string, unknown>> = [
    { chargerId: { in: chargerScope } },
    { customer: { chargerId: { in: chargerScope } } },
  ];
  if (currentEmployeeId) {
    or.push({ customer: { collaboratorIds: { array_contains: [currentEmployeeId] } } });
  }
  target.OR = or;
  return target;
}

/**
 * 关联业务(无自身 chargerId)的访问范围:客户负责人 OR 客户协作人 OR 公海客户
 *
 *   customer.chargerId IN scope
 *   OR customer.collaboratorIds @> [me]
 *   OR customer.chargerId IS NULL  // 公海客户的联系人/开票对所有 view 权限可见
 *
 * 适用:contacts / invoices(schema 无自身 chargerId,仅靠 customer 关联鉴权)。
 *
 * 公海可见的业务理由（2026-06-04 加入，与 applyCustomerCollabViaCustomerScope 同步）：
 * 与跟进/订单/商机/回款/拜访保持一致语义——公海客户「任何人可认领」，
 * 认领候选人需要看到客户的全部历史交互（含联系人、历史开票）才能判断。
 * invoices 涉及金额敏感度比较高，但既然客户都进了公海，金额保护意义有限；
 * 拒绝「公海客户跟进可见、但联系人/开票看不到」的拧巴体验。
 */
export function applyCustomerOwnedScope<W extends Record<string, unknown>>(
  baseWhere: W,
  chargerScope: string[] | null | undefined,
  currentEmployeeId: string | null | undefined
): W & { OR?: Array<Record<string, unknown>> } {
  if (chargerScope === undefined || chargerScope === null) {
    return baseWhere as W & { OR?: Array<Record<string, unknown>> };
  }
  const target = baseWhere as W & { OR?: Array<Record<string, unknown>> };
  const or: Array<Record<string, unknown>> = [
    { customer: { chargerId: { in: chargerScope } } },
    // 公海客户的关联联系人/开票对所有持有 view 权限的角色可见
    { customer: { chargerId: null } },
  ];
  if (currentEmployeeId) {
    or.push({ customer: { collaboratorIds: { array_contains: [currentEmployeeId] } } });
  }
  target.OR = or;
  return target;
}
