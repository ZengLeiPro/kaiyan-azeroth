import * as allExports from '@ky-azeroth/shared';
import {
  type EntityDisplayShapeMap,
  type EntityType,
  getEntityDisplayName,
} from '@ky-azeroth/shared';
import { z } from 'zod';

import { pascalToKebab, pluralize } from './utils.js';

// ── Types ───────────────────────────────────────────────────────────

export interface EntityConfig {
  /** CLI command name and API route path, e.g. "customers", "sale-orders" */
  commandName: string;
  /** PascalCase entity name, e.g. "Customer", "SaleOrder" */
  pascalName: string;
  /** Chinese display label (if found in MODULES) */
  label: string;
  /** Zod schema for create operation（只读实体为 undefined） */
  createSchema?: z.ZodTypeAny;
  /** Zod schema for update operation（只读实体为 undefined） */
  updateSchema?: z.ZodTypeAny;
  /** Zod schema for list query (includes pagination) */
  querySchema: z.ZodTypeAny;
  /** Zod schema for response (optional, used by describe) */
  responseSchema?: z.ZodTypeAny;
  /** 只读实体：只暴露 list / get，不注册 create / update / delete / restore */
  readOnly: boolean;
  /**
   * update 操作使用的 HTTP 方法，默认 'PUT'。
   * 后端少数 controller 用 @Patch(':id')（如 cloud-alerts/dingtalk-logs），
   * 必须显式覆盖为 'PATCH'，否则 CLI 调用会 405/404。
   */
  updateMethod: 'PUT' | 'PATCH';
  /**
   * 是否注册 `restore <id>` 子命令。
   * 仅当后端 controller 真有 `POST /:id/restore` 路由时才置 true，
   * 否则一调用必 404。当前仅 customers/crm-products 真实现了 restore。
   */
  supportsRestore: boolean;
  /**
   * 是否注册 `submit-approval <id>` 子命令。
   * 仅当后端 controller 真有 `POST /:id/submit-approval` thin wrapper 时
   * 才置 true。当前 sale-orders / payments / invoices / visit-records 4 个
   * 实体支持。该子命令仅传 id，formCode/title 由后端 BusinessApprovalService
   * 自动生成。
   */
  supportsSubmitApproval: boolean;
  /**
   * 是否注册 `claim <id>` 子命令（认领公海客户）。
   * 仅当后端 controller 真有 `POST /:id/claim` 路由时才置 true。
   * 当前仅 customers 实现了 claim（公海客户认领），其他实体调用必 404。
   */
  supportsClaim: boolean;
  /**
   * 是否注册 `change-request <id>` 子命令（提交变更走审批流）。
   * 仅当后端 controller 真有 `POST /:id/change-request` 路由时才置 true。
   * 当前 sale-orders / payments / invoices / visit-records 4 个实体支持。
   * body 复用各模块自己的 update schema（与 update 同形态，区别在走审批流）。
   */
  supportsChangeRequest: boolean;
  /**
   * 单条 DELETE 是否必须携带 `--version` 并作为 query 参数发送。
   * 仅对后端强制乐观锁删除的实体开启，避免在命令实现里硬编码实体名。
   */
  deleteRequiresVersion: boolean;
  /**
   * 实体支持的标准 CRUD 子命令白名单。未列出的子命令不会被注册。
   * undefined 表示全开（默认）。
   *
   * 当前用于 holidays：后端只有 GET /（分页）、GET /calendar、PUT /year/:year，
   * 没有 GET /:id、POST、DELETE，所以只暴露 list。
   */
  supportedOperations?: Array<'list' | 'get' | 'create' | 'update' | 'delete'>;
  /**
   * 业务实体显示名派生函数（用于 --format table 第一列优先显示，便于人眼区分）。
   * undefined 表示该实体未接入业务显示名统一规约，table 模式走 printTable 默认列。
   * 与 `@ky-azeroth/shared/utils/entity-display-name` 收敛同源。
   */
  displayName?: (entity: Record<string, unknown>) => string;
}

// ── Display name overrides（业务实体显示名统一规约）────────────────
// 与 packages/shared/src/utils/entity-display-name.ts 收敛同源；
// 这里只是把 entity → displayName 的派生函数挂到 EntityConfig 上，供 CLI table 模式使用。
const DISPLAY_NAME_OVERRIDES: Record<string, EntityType> = {
  opportunities: 'opportunity',
  'sale-orders': 'sale-order',
  payments: 'payment',
  invoices: 'invoice',
};

function createDisplayName<T extends EntityType>(
  entityType: T
): (entity: Record<string, unknown>) => string {
  return (entity) => getEntityDisplayName(entityType, entity as EntityDisplayShapeMap[T], 'short');
}

function buildDisplayName(
  commandName: string
): ((entity: Record<string, unknown>) => string) | undefined {
  const entityType = DISPLAY_NAME_OVERRIDES[commandName];
  return entityType ? createDisplayName(entityType) : undefined;
}

// ── Route overrides for irregular pluralization or naming ────────────

const ROUTE_OVERRIDES: Record<string, string> = {
  Payroll: 'payroll', // Controller uses singular route
  // 只读实体：shared schema 叫 calendar-event 但后端挂载在 dingtalk-calendar-events
  CalendarEvent: 'dingtalk-calendar-events',
  FinanceLedger: 'finance-ledger',
  FinancePersonalLedger: 'finance-personal-ledger',
};

// ── Update method overrides（PascalName → 'PATCH'） ──────────────────
//
// 默认所有 CRUD 实体走 PUT /:id；下列实体在后端用 @Patch(':id')。
// 加入此表后 CLI 自动派发正确方法，doctor 也据此判定是否 covered_broken。
//
// export 给 doctor.ts 复用，避免双源维护漂移。
export const UPDATE_METHOD_OVERRIDES: Record<string, 'PATCH'> = {
  // 后端 cloud-alerts.controller 仅 @Get() / @Get(':id') / @Patch(':id')（告警由 cloud-cost-sync
  // 自动生成，无 create/delete）。配合 SUPPORTED_OPERATIONS_OVERRIDES 限定为 list/get/update，update 走 PATCH。
  CloudAlert: 'PATCH',
  // 后端 dingtalk-logs.controller 用 @Patch(':reportId') / @Delete(':reportId') / @Get(':reportId')。
  // CLI 默认 PUT/:id 会 405——路径段 :reportId vs :id 是位置匹配，命名差异不影响 CLI。
  DingtalkLog: 'PATCH',
};

// ── Restore support（PascalName → true） ────────────────────────────
//
// 历史上 CLI 给所有 CRUD 实体无脑注册 `restore <id>`，但后端只有少数实体
// 真的实现了 `POST /:id/restore`。其他 19 个实体的 restore 命令调用必 404。
// 仅显式列出真实现 restore 的实体。
//
// export 给 doctor.ts 复用，避免双源维护漂移。
export const RESTORE_SUPPORTED = new Set<string>(['Customer', 'CrmProduct']);

// ── Submit-approval support（PascalName → true） ────────────────────
//
// 后端在 sale-orders / payments / invoices / visit-records 4 个 controller
// 各自挂了 `POST /:id/submit-approval` thin wrapper，转 BusinessApprovalService。
// 该子命令传业务单 id，eventType/formCode/title 由后端 APPROVAL_BUSINESS_REGISTRY
// 自动派发，调用方零参数。其他实体不应有此命令。
//
// 配合 EntityConfig.supportsSubmitApproval；export 给 doctor.ts 复用。
export const SUBMIT_APPROVAL_SUPPORTED = new Set<string>([
  'SaleOrder',
  'Payment',
  'Invoice',
  'VisitRecord',
]);

// ── Claim support（PascalName → true） ──────────────────────────────
//
// 后端 customers controller 挂了 `POST /:id/claim`（认领公海客户）。
// 仅 Customer 实体存在公海/私海概念，其他实体无此动作。
//
// 配合 EntityConfig.supportsClaim；export 给 doctor.ts 复用。
export const CLAIM_SUPPORTED = new Set<string>(['Customer']);

// ── Change-request support（PascalName → true） ─────────────────────
//
// 后端在 sale-orders / payments / invoices / visit-records 4 个 controller
// 各自挂了 `POST /:id/change-request` thin wrapper，复用各模块自己的
// UpdateXxxDto 作为 body（与"直接 update"语义相同，但走审批流而非立即生效）。
// 转 BusinessApprovalService.submitChangeApproval，自动派发审批流类型。
//
// 之所以与 SUBMIT_APPROVAL_SUPPORTED 同 4 实体却独立配置：submit-approval
// 是"提交业务单进入审批流"（无 body），change-request 是"变更已生效业务单
// 走审批流"（带 body=更新内容），语义不同。
//
// 配合 EntityConfig.supportsChangeRequest；export 给 doctor.ts 复用。
export const CHANGE_REQUEST_SUPPORTED = new Set<string>([
  'SaleOrder',
  'Payment',
  'Invoice',
  'VisitRecord',
]);

// ── Optimistic-lock DELETE capability（PascalName → true） ──────────
//
// 这些 controller 的 DELETE /:id 强制 query.version；CLI 必须把 `--version`
// 注册为必填正整数并透传。独立配置避免在通用 CRUD 命令里按实体名分支。
export const DELETE_VERSION_REQUIRED = new Set<string>([
  'Payment',
  'Invoice',
  'Payroll',
  'KeepRecord',
  'VisitRecord',
  'SaleOrder',
  'Opportunity',
  'Project',
  'ProjectTicket',
  'EffortRecord',
]);

// ── Supported CRUD operations overrides ──────────────────────────────
//
// 部分实体后端不实现完整 CRUD，需显式声明 CLI 可注册的子命令。
// 默认（undefined）= 全开 list/get/create/update/delete。
//
// Holiday：后端无 GET /:id（详情走 list --year 查），无 POST/DELETE
// （写入只有 PUT /year/:year，由 holidays publish 子命令承接），调用必 404。
//
// export 给 crud.ts 复用做子命令注册前的 gating，doctor.ts 也据此判定覆盖度
// （只校验白名单内操作的路由是否存在，避免把"后端故意不提供 create/delete"误报为 covered_broken）。
export const SUPPORTED_OPERATIONS_OVERRIDES: Record<string, EntityConfig['supportedOperations']> = {
  Holiday: ['list'],
  // cloud-alerts 只有 GET / GET/:id / PATCH/:id：告警由 cloud-cost-sync 自动生成，
  // 不支持手动 create/delete，CLI 仅暴露 list/get/update（update 走 PATCH，见 UPDATE_METHOD_OVERRIDES）。
  CloudAlert: ['list', 'get', 'update'],
  // operation-logs / login-logs 后端仅 GET /，无 :id 详情路由——CLI 自动生成的
  // `get :id` 调用必 404（2026-06-13 audit 报告的"幽灵命令"）。收窄到 list-only。
  OperationLog: ['list'],
  LoginLog: ['list'],
  // notifications / table-preferences 同理：后端 :id 路由不存在，CLI `get :id` 调必 404。
  Notification: ['list'],
  TablePreference: ['list'],
};

// ── CLI 发现排除名单（PascalName） ──────────────────────────────────
//
// 仅放「shared 里有三元组、但设计上没有独立标准 CRUD controller」的内部资源/嵌套子项。
// discoverEntities 若为这些 PascalName 自动注册根级 CRUD 命令，会生成调用必 404 的幽灵命令；
// 因此在 registry 层显式排除，并由 doctor 归类为 `excluded`。
//
// 注意：这里不是看板/分析 DTO 的跳过清单。
// 如果某个资源后来补齐独立标准 CRUD controller，应从本集合移除，让 CLI 自动覆盖。
export const EXCLUDED_ENTITIES = new Set<string>([
  // FinanceImportBatch 由 finance-import/batches 嵌套路由承载，无独立标准 CRUD controller。
  'FinanceImportBatch',
  // WorkCalendar 由 holidays calendar/work-dates 子命令承载，无 /work-calendars 根级 controller。
  'WorkCalendar',
]);

// ── Label mapping (from MODULES constant, flattened) ────────────────

/** Manual label overrides for entities whose MODULES menu key doesn't match the route */
const LABEL_OVERRIDES: Record<string, string> = {
  'crm-products': '产品管理',
  'crm-work-dailies': 'CRM 日报',
  'project-tickets': '项目工单',
  projects: '项目列表',
  roles: '角色权限',
  users: '用户管理',
};

const LABEL_MAP: Record<string, string> = {};

function buildLabelMap(): void {
  const raw = allExports as Record<string, unknown>;
  const resolved = (raw['default'] ?? raw) as Record<string, unknown>;
  const modules = resolved['MODULES'] as
    | Record<string, { menus: Record<string, { label: string }> }>
    | undefined;
  if (!modules) return;

  for (const group of Object.values(modules)) {
    for (const [menuKey, menu] of Object.entries(group.menus)) {
      // Convert snake_case menu key to the route format
      // e.g. "sale_orders" → "sale-orders", "keep_records" → "keep-records"
      const routeKey = menuKey.replace(/_/g, '-');
      LABEL_MAP[routeKey] = menu.label;
    }
  }
}

// ── Entity discovery ────────────────────────────────────────────────

/**
 * Scan all exports from @ky-azeroth/shared and discover entities.
 *
 * 支持两种实体形态：
 *  1. **全 CRUD 实体**：createXxxSchema + updateXxxSchema + queryXxxSchema 三件套
 *  2. **只读实体**（如钉钉同步数据）：仅 queryXxxSchema + xxxResponseSchema 两件套，
 *     没有 create/update schema。只注册 list / get 两个子命令。
 */
export function discoverEntities(): Map<string, EntityConfig> {
  buildLabelMap();

  // Handle ESM/CJS interop: when shared package has no "type": "module",
  // tsx wraps named exports into a `default` property
  const raw = allExports as Record<string, unknown>;
  const exports = (raw['default'] ?? raw) as Record<string, unknown>;
  const entities = new Map<string, EntityConfig>();
  const allKeys = Object.keys(exports);
  const createKeys = allKeys.filter((k) => /^create\w+Schema$/.test(k));
  const seenPascal = new Set<string>();

  // ── Pass 1: 全 CRUD 实体（create + update + query 三件套） ────────
  for (const key of createKeys) {
    const match = key.match(/^create(\w+)Schema$/);
    if (!match) continue;

    const pascalName = match[1]!;
    if (EXCLUDED_ENTITIES.has(pascalName)) continue; // 无独立标准 CRUD controller，显式排除
    const updateKey = `update${pascalName}Schema`;
    const queryKey = `query${pascalName}Schema`;
    const responseKey = `${pascalName.charAt(0).toLowerCase()}${pascalName.slice(1)}ResponseSchema`;

    // Must have all three CRUD schemas
    if (!(updateKey in exports) || !(queryKey in exports)) continue;

    // Skip non-entity schemas (auth forms, import previews, etc.)
    const createSchema = exports[key] as z.ZodTypeAny;
    if (!isZodObject(createSchema)) continue;

    // Derive route path
    const kebab = pascalToKebab(pascalName);
    const commandName = ROUTE_OVERRIDES[pascalName] ?? pluralize(kebab);

    entities.set(commandName, {
      commandName,
      pascalName,
      label:
        LABEL_OVERRIDES[commandName] ??
        LABEL_MAP[commandName] ??
        findLabelFallback(commandName) ??
        pascalName,
      createSchema,
      updateSchema: exports[updateKey] as z.ZodTypeAny,
      querySchema: exports[queryKey] as z.ZodTypeAny,
      responseSchema: (exports[responseKey] as z.ZodTypeAny) ?? undefined,
      readOnly: false,
      updateMethod: UPDATE_METHOD_OVERRIDES[pascalName] ?? 'PUT',
      supportsRestore: RESTORE_SUPPORTED.has(pascalName),
      supportsSubmitApproval: SUBMIT_APPROVAL_SUPPORTED.has(pascalName),
      supportsClaim: CLAIM_SUPPORTED.has(pascalName),
      supportsChangeRequest: CHANGE_REQUEST_SUPPORTED.has(pascalName),
      deleteRequiresVersion: DELETE_VERSION_REQUIRED.has(pascalName),
      supportedOperations: SUPPORTED_OPERATIONS_OVERRIDES[pascalName],
      displayName: buildDisplayName(commandName),
    });
    seenPascal.add(pascalName);
  }

  // ── Pass 2: 只读实体（query + response 两件套，无 create） ────────
  const queryKeys = allKeys.filter((k) => /^query\w+Schema$/.test(k));
  for (const key of queryKeys) {
    const match = key.match(/^query(\w+)Schema$/);
    if (!match) continue;

    const pascalName = match[1]!;
    if (seenPascal.has(pascalName)) continue; // 已被 Pass 1 注册过
    if (EXCLUDED_ENTITIES.has(pascalName)) continue; // 无独立标准 CRUD controller，显式排除

    const createKey = `create${pascalName}Schema`;
    const responseKey = `${pascalName.charAt(0).toLowerCase()}${pascalName.slice(1)}ResponseSchema`;

    // 必须不存在 createSchema 且存在 responseSchema 才算只读两件套
    if (createKey in exports) continue;
    if (!(responseKey in exports)) continue;

    const querySchema = exports[key] as z.ZodTypeAny;
    if (!isZodObject(querySchema)) continue;

    const kebab = pascalToKebab(pascalName);
    const commandName = ROUTE_OVERRIDES[pascalName] ?? pluralize(kebab);

    entities.set(commandName, {
      commandName,
      pascalName,
      label:
        LABEL_OVERRIDES[commandName] ??
        LABEL_MAP[commandName] ??
        findLabelFallback(commandName) ??
        pascalName,
      querySchema,
      responseSchema: exports[responseKey] as z.ZodTypeAny,
      readOnly: true,
      // 只读实体不会调用 update / restore / submit-approval / claim / change-request，但字段必填为类型完整
      updateMethod: 'PUT',
      supportsRestore: false,
      supportsSubmitApproval: false,
      supportsClaim: false,
      supportsChangeRequest: false,
      deleteRequiresVersion: false,
      supportedOperations: SUPPORTED_OPERATIONS_OVERRIDES[pascalName],
      displayName: buildDisplayName(commandName),
    });
    seenPascal.add(pascalName);
  }

  return entities;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Check if a Zod schema is (or wraps) a ZodObject */
function isZodObject(schema: z.ZodTypeAny): boolean {
  const def = schema._def as Record<string, unknown>;
  const typeName = def['typeName'] as string | undefined;
  if (typeName === 'ZodObject') return true;
  if (typeName === 'ZodEffects') return isZodObject(def['schema'] as z.ZodTypeAny);
  if (typeName === 'ZodIntersection') return true;
  return false;
}

/** Try to find a label by partial match (e.g. "products" → "产品管理") */
function findLabelFallback(commandName: string): string | undefined {
  // Direct match
  if (LABEL_MAP[commandName]) return LABEL_MAP[commandName];

  // Try singular form (rarely needed)
  for (const [key, label] of Object.entries(LABEL_MAP)) {
    if (commandName.startsWith(key) || key.startsWith(commandName)) {
      return label;
    }
  }
  return undefined;
}
