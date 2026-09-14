/**
 * azeroth doctor —— CLI 覆盖度体检
 *
 * 背景（2026-04-22 审计）：
 *   CLI 发现实体的硬门槛是 shared 里同时存在 create/update/query 三元组 zod schema。
 *   不满足的实体会被 `discoverEntities()` 静默跳过。历史上（04-22）我们曾误把所有
 *   缺三元组的实体当"纯遗漏"想一键补齐，结果发现大部分是故意的——只读同步数据、
 *   append-only 审计日志、auth 自管实体、半只读预置配置等。
 *
 * 本命令的目的：
 *   把"缺三元组"的判断过程显式化。对仓库里每个业务模块，交叉比对 shared schema
 *   与后端 controller 的实际 endpoint 形态，输出下列分类：
 *
 *     covered             —— 三元组齐全 + controller 是标准 CRUD 路径 → CLI 真能调通
 *     covered_broken      —— 三元组齐全但 controller 走非标路径（如 `my/*` 个人 scope）
 *                            → CLI 以为自己暴露了，实际 404。需要 ROUTE_OVERRIDES
 *                            或 CLI v2 支持路径前缀
 *     readonly            —— shared 仅 queryX，controller 仅 GET → 刻意只读
 *     custom_actions      —— controller 有非标 POST/PUT/DELETE（如 :id/read、:pageKey）
 *                            → 需 CLI v2 自定义 action 扩展点
 *     standard_gap        —— controller 有完整标准 CRUD 但 shared 缺件 → 真·遗漏
 *     nested_schema       —— shared 有零散 create/update/query 但与父实体同文件
 *                            （如 OpportunityProduct、DietMealSlot），伴随父实体写入，
 *                            本就没有独立 controller
 *     orphan_prisma       —— Prisma 有 model 但无 controller → 子表 / join / 内部
 *     reporting           —— shared 中的只读查询/报表/聚合 DTO（不应 CRUD 化，但可评估 CLI 报表命令/extras）
 *     non_entity          —— 有 controller 但非业务实体（auth/upload/dashboard 等）
 *
 *   对"真·遗漏"（standard_gap）才是值得补 shared schema 的实体——当前预期为空，
 *   是个持续的回归用断言。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'commander';

import {
  CLAIM_SUPPORTED,
  EXCLUDED_ENTITIES,
  RESTORE_SUPPORTED,
  SUBMIT_APPROVAL_SUPPORTED,
  SUPPORTED_OPERATIONS_OVERRIDES,
  UPDATE_METHOD_OVERRIDES,
} from '../registry.js';
import { fatal, output, pascalToKebab, pluralize } from '../utils.js';

// ── Paths ───────────────────────────────────────────────────────────

/**
 * 寻找 monorepo 根目录（含 pnpm-workspace.yaml 的目录）。
 *
 * 多入口探测：doctor 需要读源码做交叉比对，但 CLI 的运行上下文有 3 种：
 *   1. dev / tsx：`import.meta.url` 指向 apps/cli/src/commands/doctor.ts，向上找即可。
 *   2. tsup build dist：`import.meta.url` 仍指向 apps/cli/dist/index.js，向上找仍可。
 *   3. esbuild cjs bundle（cli-bundle.cjs）：esbuild 警告 "import.meta is undefined"，
 *      `fileURLToPath(undefined)` 会抛 ERR_INVALID_ARG_TYPE。
 *      这种情况下必须 fallback 到 process.cwd()——使用方在 ky-azeroth 工作树内执行。
 *
 * 任一入口找到都直接返回；都没找到再 fatal()。
 */
function findMonorepoRoot(): string {
  const candidates: string[] = [];

  // 入口 1：当前模块所在目录（ESM dev / tsup dist 走这里）
  try {
    const metaUrl =
      typeof import.meta !== 'undefined' ? (import.meta as { url?: string }).url : undefined;
    if (typeof metaUrl === 'string' && metaUrl.length > 0) {
      candidates.push(path.dirname(fileURLToPath(metaUrl)));
    }
  } catch {
    // ignore — fall through to other candidates
  }

  // 入口 2：process.cwd()（cli-bundle.cjs 模式或 import.meta 不可用时的兜底）
  candidates.push(process.cwd());

  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error(
    'Cannot locate monorepo root (no pnpm-workspace.yaml found). ' +
      'doctor 需要扫描源码，请在 ky-azeroth 工作树内执行（cd ~/code/ky-azeroth && azeroth doctor）'
  );
}

// PascalName → expected controller dirName overrides.
//
// Two sources of irregularity:
//   1. Route overrides that the CLI registry also applies (must stay in sync
//      with registry.ts:ROUTE_OVERRIDES) — e.g. Payroll uses a singular route.
//   2. Shared schemas whose controller lives under a different module (a single
//      controller serves multiple shared entity types) — e.g. CalendarEvent
//      lives under the dingtalk-calendar-events controller; LoginLog shares
//      the operation-logs controller; SystemConfig is served by system-params.
const PASCAL_TO_DIR_OVERRIDES: Record<string, string> = {
  // Kept in sync with registry.ts ROUTE_OVERRIDES
  Payroll: 'payroll',
  // Shared controller — multiple shared schemas feed into one module
  CalendarEvent: 'dingtalk-calendar-events',
  FinanceLedger: 'finance-ledger',
  FinancePersonalLedger: 'finance-personal-ledger',
  LoginLog: 'operation-logs',
  SystemConfig: 'system-params',
};

// Module directories that exist in apps/server but aren't CRUD entities.
// Listed here so the classifier can flag them as non_entity rather than noise.
//
// 共同点：要么是公开端点（auth/health 走 @Public），要么是无业务实体语义的工具型
// controller（upload 生成上传 URL、dashboard 聚合首页数据、rate-limit-test 压测）。
// 这些 controller 普遍**不挂 @RequirePermission**——但不算 decorator_missing：
//   - upload / dashboard：路由参数中无业务实体 id，service 层用 @CurrentUser 强制
//     拿当前用户上下文（如 dashboard.getStats(user) / upload 只生成签名 URL），
//     不存在跨用户访问空间。
//   - auth / health：@Public 守卫显式放行（登录、健康检查）。
//   - rate-limit-test：受 NODE_ENV 与额外守卫保护，仅用于压测。
// 若未来发现该列表里某个 controller 真在做需要 RBAC 隔离的操作，应拆出独立 module
// 并归到下方 CONTROLLER_STATUS_OVERRIDES，而不是放在这里。
const NON_ENTITY_MODULES = new Set(['auth', 'upload', 'dashboard', 'health', 'rate-limit-test']);

// Shared 中只提供 query/response schema、但语义上是看板/报表/聚合/父 controller 子端点的
// 非 CRUD 读模型。它们不是独立业务实体，不应为了 doctor 数字补空 create/update schema 或假 controller。
const REPORTING_SCHEMAS = new Set<string>([
  'CloudCostOverview',
  'CloudPackageProjection',
  'CloudUsageSeries',
  'FinancePnl',
  'FinancePnlDrilldown',
  'SeoPageInsight',
  'SeoSearchQuery',
  'SeoSearchRanking',
  'SeoSearchTrend',
  'SeoSiteSummary',
  'SeoSummary',
  'SeoSyncRun',
  'SeoTrafficSnapshot',
  'WorkCalendar',
]);

// 当前用户偏好 schema 由父级 filter-schemes controller 的 personal/* 子路由承载，
// 不是独立标准 CRUD controller，也不应被误报为 standard_gap。
const PREFERENCE_SCHEMAS = new Set<string>(['PersonalFilterPreference', 'PersonalFilterPreset']);

type ControllerStatusOverride = {
  status: Status;
  note: string;
};

// Controller 级别的非 CRUD 语义分类：这些模块不是 standard_gap，也不应为了覆盖率补假 CRUD。
// 分类目的不是“跳过”，而是把后续工作拆清楚：报表补 reporting CLI、审批补 workflow CLI、
// 偏好/安全/导入/运维/配置按专门动作建模。
const CONTROLLER_STATUS_OVERRIDES: Record<string, ControllerStatusOverride> = {
  analytics: {
    status: 'reporting',
    note: '看板/分析聚合 controller；不应 CRUD 化，后续如需 Agent 调用应补只读报表 CLI 命令',
  },
  'web-analytics': {
    status: 'reporting',
    note: '官网分析聚合 controller；不应 CRUD 化，后续如需 Agent 调用应补只读报表 CLI 命令',
  },
  seo: {
    status: 'reporting',
    note: 'SEO 明细/聚合/同步查询 controller；不应 CRUD 化，后续可拆只读报表 CLI 与 sync action',
  },
  'finance-pnl': {
    status: 'reporting',
    note: '财务 PnL 报表 controller；不应 CRUD 化，后续可补 summary/drilldown CLI',
  },
  approvals: {
    status: 'workflow_actions',
    note: '审批处理/撤回/多视图查询是 workflow；业务提交仅走实体薄入口，不提供通用 approvals submit',
  },
  'filter-schemes': {
    status: 'preference_actions',
    note: '站点级表单字段配置（pageKey 维度，不按用户隔离）；list/replace/reset 走 system.filter_schemes 权限矩阵，业务页 GET 由 JwtAuthGuard 全局兜底。',
  },
  'table-preferences': {
    status: 'preference_actions',
    note: '当前用户表格偏好（service 层按 @CurrentUser.id 过滤）；不应按全局 CRUD 实体暴露',
  },
  notifications: {
    status: 'preference_actions',
    note: '当前用户通知读取/已读动作（service 层按 @CurrentUser.id 过滤，无跨用户访问）；系统生成、用户处理，不应补 create/update/delete CRUD',
  },
  sessions: {
    status: 'security_actions',
    note: '登录会话安全动作（list/delete/delete-others，service 层按 @CurrentUser.id 强制过滤）；需专门 CLI 与审计语义，不走自动 CRUD',
  },
  'personal-access-tokens': {
    status: 'security_actions',
    note: 'PAT 安全敏感动作；create/list/delete 需脱敏与权限设计，不走自动 CRUD',
  },
  'finance-import': {
    status: 'import_actions',
    note: '财务导入 preview/commit/batches 工作流；不应 CRUD 化，后续可补导入专用 CLI',
  },
  'dingtalk-sync': {
    status: 'ops_actions',
    note: '钉钉同步运维触发口；不应 CRUD 化，若保留需按 ops action 暴露或明确设计豁免',
  },
  holidays: {
    status: 'config_actions',
    note: '节假日按年份发布配置，写入是 PUT /year/:year；不是单条标准 CRUD',
  },
  'system-params': {
    status: 'config_actions',
    note: '系统参数配置 controller；已有顶级 system-params CLI，命名错位不应算标准 CRUD 缺口',
  },
  'web-events': {
    status: 'ops_actions',
    note: '官网事件只读 + archive 运维动作；不应补 create/update/delete CRUD',
  },
};

// ── Data sources ────────────────────────────────────────────────────

interface SharedSchemaInfo {
  pascalName: string;
  file: string;
  hasCreate: boolean;
  hasUpdate: boolean;
  hasQuery: boolean;
  readonlyComment: boolean;
  otherExports: string[]; // e.g. ['listXSchema', 'detailXSchema']
}

function scanSharedSchemas(monoRoot: string): Map<string, SharedSchemaInfo> {
  const dir = path.join(monoRoot, 'packages/shared/src/schemas');
  const byPascal = new Map<string, SharedSchemaInfo>();

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');

    // Heuristic: the file explicitly documents the entity as read-only.
    // Both employee-leave.ts / dingtalk-log.ts / calendar-event.ts use this wording.
    const readonlyComment = /只读实体|append-only/i.test(content);

    // Collect all exported const names → group by PascalName suffix.
    const exportRegex = /export\s+const\s+(\w+)\b/g;
    const exports: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = exportRegex.exec(content))) {
      exports.push(m[1]!);
    }

    for (const exp of exports) {
      const tripletMatch = exp.match(/^(create|update|query)(\w+)Schema$/);
      if (tripletMatch) {
        const action = tripletMatch[1]! as 'create' | 'update' | 'query';
        const pascalName = tripletMatch[2]!;
        let info = byPascal.get(pascalName);
        if (!info) {
          info = {
            pascalName,
            file,
            hasCreate: false,
            hasUpdate: false,
            hasQuery: false,
            readonlyComment,
            otherExports: [],
          };
          byPascal.set(pascalName, info);
        }
        if (action === 'create') info.hasCreate = true;
        if (action === 'update') info.hasUpdate = true;
        if (action === 'query') info.hasQuery = true;
        if (readonlyComment) info.readonlyComment = true;
      }
    }

    // Second pass: for entities already known, collect non-triplet schemas as context.
    for (const exp of exports) {
      if (/^(create|update|query)\w+Schema$/.test(exp)) continue;
      // Try to attribute to an entity by longest-match on known PascalNames.
      for (const [pascal, info] of byPascal) {
        if (info.file !== file) continue;
        if (exp.toLowerCase().includes(pascal.toLowerCase())) {
          info.otherExports.push(exp);
          break;
        }
      }
    }
  }

  return byPascal;
}

interface ControllerInfo {
  dirName: string;
  endpoints: Array<{ method: string; path: string }>;
}

function findControllerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files.push(...findControllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      files.push(full);
    }
  }
  return files;
}

function getControllerRoute(content: string, fallback: string): string {
  const match = content.match(/@Controller\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/);
  return match?.[1] ?? fallback;
}

function scanControllers(monoRoot: string): Map<string, ControllerInfo> {
  const modulesDir = path.join(monoRoot, 'apps/server/src/modules');
  const byDir = new Map<string, ControllerInfo>();

  for (const ctrlPath of findControllerFiles(modulesDir)) {
    const content = fs.readFileSync(ctrlPath, 'utf-8');
    const fallback = path.basename(ctrlPath).replace('.controller.ts', '');
    const dirName = getControllerRoute(content, fallback);
    const endpoints: Array<{ method: string; path: string }> = [];
    // Match @Get(), @Get('path'), @Post(':id/read'), etc.
    const regex = /@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content))) {
      endpoints.push({ method: m[1]!, path: m[2] ?? '' });
    }

    const existing = byDir.get(dirName);
    if (existing) {
      existing.endpoints.push(...endpoints);
    } else {
      byDir.set(dirName, { dirName, endpoints });
    }
  }

  return byDir;
}

function scanPrismaModels(monoRoot: string): string[] {
  const schemaPath = path.join(monoRoot, 'apps/server/prisma/schema.prisma');
  const content = fs.readFileSync(schemaPath, 'utf-8');
  return [...content.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!);
}

// ── CLI extras scanner（2026-06-13 audit phase D 新增） ──────────────────
//
// 解析 apps/cli/src/commands/*.ts，抽取每个 register*Extras / register*Commands
// 函数体里的 .command(...) + request(METHOD, '/path', ...) 调用，得到 CLI
// 真正能调到的 (entity, subcommand, method, pathPattern) 四元组。
//
// 用于 extras 覆盖度对账：判定 controller 非标 endpoint 是否有对应 CLI 子命令。
// CLI 自动 CRUD 的 list/get/create/update/delete + restore/submit-approval/claim/
// change-request 不在此扫描范围（由 crud.ts 模板自动注册，已被 EntityRow 主流程
// 覆盖）。

export interface ExtrasSubcommand {
  /** CLI 实体命令名（或 finance / approvals / system-params 这类顶级命令组名） */
  entity: string;
  /** .command('xxx') 里的 xxx，含 path 参数（如 'transition <id>'） */
  subcommandRaw: string;
  /** request('METHOD', '/path', ...) 里的 METHOD（大写） */
  method: string;
  /** 反引号模板字符串里的路径，把 ${id} / ${encodeUuidPathId(id, 'id')} 之类替换为 :id */
  pathPattern: string;
  /** 解析到的源码文件名（用于报告反向定位） */
  source: string;
}

function normalizeTemplatePath(template: string): string {
  // 把 ${...} 占位符统一替换为 :id 语义记号；把 :employeeId/:year 等参数名也归一为 :id。
  // extras 对账只关心路径形态是否能打到同一类 endpoint，不关心参数变量名。
  return template
    .split('?')[0]!
    .replace(/\$\{[^}]+\}/g, ':id')
    .replace(/:\w+/g, ':id')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
}

export function scanCliExtras(monoRoot: string): ExtrasSubcommand[] {
  const dir = path.join(monoRoot, 'apps/cli/src/commands');
  const result: ExtrasSubcommand[] = [];
  // 这几个不是业务 extras：crud 是模板、all-pages 是 helper、describe/doctor 是 meta、
  // auth 是登录引导（不对接业务实体）。
  const SKIP = new Set(['crud.ts', 'all-pages.ts', 'describe.ts', 'doctor.ts', 'auth.ts']);

  // 每个 commands/<entity>.ts 文件被一个 register*Extras / register*Commands 包住。
  // 我们用一个简单的状态机：找 .command('xxx') 锚点，然后在其后 80 行内找
  // request('METHOD', `path`) 或 request('METHOD', '/literal-path') 调用。

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') || SKIP.has(file)) continue;
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // 文件名（去 .ts）= entity 命令组名。一些特例：
    //   approvals.ts 是顶级 program.command('xxx') 注册（root），entity 都是 approvals
    //   finance.ts 同理
    //   system-params.ts 同理
    const entity = file.replace(/\.ts$/, '');

    // commander .command('subname') 锚点（记下 entity 拥有哪些子命令，作为存在性证据）
    const cmdRegex = /\.command\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let cmdMatch: RegExpExecArray | null;
    const cmdAnchors: Array<{ raw: string; offset: number }> = [];
    while ((cmdMatch = cmdRegex.exec(content))) {
      cmdAnchors.push({ raw: cmdMatch[1]!, offset: cmdMatch.index });
    }

    // 全文件扫所有 request / helper 调用，按文件 entity 归属——避免 helper 函数体内调用
    // request 不在某个 .command 锚点窗口内的归属丢失。
    const seenPaths = new Set<string>();
    const addEndpoint = (method: string, rawPath: string, offset: number, label?: string): void => {
      if (/\$\{\s*action\s*\}/.test(rawPath)) return;
      const normalized = normalizeTemplatePath(rawPath);
      if (!normalized.startsWith('/')) return;
      const key = `${method}|${normalized}`;
      if (seenPaths.has(key)) return;
      seenPaths.add(key);

      // 找最近的 .command 锚点反推子命令名（仅做反向定位用，不影响匹配）
      let nearestCmd = label ?? '(file-level)';
      if (!label) {
        for (const anchor of cmdAnchors) {
          if (anchor.offset < offset) nearestCmd = anchor.raw;
        }
      }
      result.push({
        entity,
        subcommandRaw: nearestCmd,
        method,
        pathPattern: normalized,
        source: `apps/cli/src/commands/${file}`,
      });
    };

    // const path = '/foo' / const path = `/foo/${id}` 后续 request('GET', path) 的变量解析。
    // 同一文件里常有多个 const path，必须按 request 位置取“前面最近”的同名定义，不能全局 Map 覆盖。
    const stringVarDefs: Array<{ name: string; value: string; offset: number }> = [];
    const varRegex = /const\s+(\w+)\s*=\s*(`[^`]+`|'[^']+'|"[^"]+")/g;
    let varMatch: RegExpExecArray | null;
    while ((varMatch = varRegex.exec(content))) {
      stringVarDefs.push({
        name: varMatch[1]!,
        value: varMatch[2]!.slice(1, -1),
        offset: varMatch.index,
      });
    }
    const resolveStringVar = (name: string, offset: number): string | undefined => {
      let resolved: string | undefined;
      let bestOffset = -1;
      for (const def of stringVarDefs) {
        if (def.name === name && def.offset < offset && def.offset > bestOffset) {
          resolved = def.value;
          bestOffset = def.offset;
        }
      }
      return resolved;
    };

    const reqRegex =
      /(?:request|runBodyJsonAction|runAction)\s*(?:<[^>]+>)?\s*\(\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*(`[^`]+`|'[^']+'|"[^"]+"|\w+)/g;
    let reqMatch: RegExpExecArray | null;
    while ((reqMatch = reqRegex.exec(content))) {
      const method = reqMatch[1]!;
      const rawArg = reqMatch[2]!;
      const rawPath = /^[`'"]/.test(rawArg)
        ? rawArg.slice(1, -1)
        : resolveStringVar(rawArg, reqMatch.index);
      if (!rawPath) continue;
      addEndpoint(method, rawPath, reqMatch.index);
    }

    // registerJsonBatchAction(entityCmd, { method: 'PATCH', path: '/x', ... }) 这类 helper 配置解析。
    const batchRegex =
      /registerJsonBatchAction\s*\([\s\S]*?method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`][\s\S]*?path:\s*['"`]([^'"`]+)['"`][\s\S]*?\}\s*\)/g;
    let batchMatch: RegExpExecArray | null;
    while ((batchMatch = batchRegex.exec(content))) {
      addEndpoint(batchMatch[1]!, batchMatch[2]!, batchMatch.index, '(registerJsonBatchAction)');
    }

    // 兜底：命令描述/注释里的 “POST /resource/:id/action” 也是可靠的 CLI 覆盖声明，
    // 用来覆盖 postAction(id, 'done') 这类二次封装和 const path 变量转发。
    const docEndpointRegex =
      /\b(GET|POST|PUT|PATCH|DELETE)[ \t]+(\/[-\w/:${}.]+(?:\?[-\w=&${}.]+)?)/g;
    let docMatch: RegExpExecArray | null;
    while ((docMatch = docEndpointRegex.exec(content))) {
      const documentedPath = docMatch[2]!;
      if (!normalizeTemplatePath(documentedPath).startsWith(`/${entity}`)) continue;
      addEndpoint(docMatch[1]!, documentedPath, docMatch.index, '(documented-endpoint)');
    }
  }

  return result;
}

// ── Decorator drift scanner（2026-06-13 audit phase D 新增） ────────────
//
// 重新解析每个 controller 文件，对每个 @(Get|Post|Put|Patch|Delete) 装饰器，
// 在路由装饰器向前的同组声明，以及向后直到方法签名之间检查显式权限装饰器：
//   - @RequirePermission(...)
//   - @RequireAnyPermission(...)
//   - @Public()
//   - @AllowAnyAuthenticatedUser()
// 或在 class 顶部（前 30 行）找到 class-level 的同类装饰器。
// 缺一切显式装饰器的 endpoint 进入 decorator_missing 列表。

export interface EndpointDecoratorAudit {
  controller: string;
  /** HTTP 方法 + 路径（如 "GET /:id"） */
  endpoint: string;
  /** 找到的显式装饰器列表，无则空数组 */
  decorators: string[];
  /** 是否有 class 级别的装饰器兜底 */
  classLevel: boolean;
}

const PERMISSION_DECORATOR_PATTERNS = [
  /@RequirePermission\b/,
  /@RequireAnyPermission\b/,
  /@Public\b/,
  /@AllowAnyAuthenticatedUser\b/,
];

function scanControllerDecorators(monoRoot: string): EndpointDecoratorAudit[] {
  const modulesDir = path.join(monoRoot, 'apps/server/src/modules');
  const results: EndpointDecoratorAudit[] = [];

  for (const dirName of fs.readdirSync(modulesDir)) {
    const full = path.join(modulesDir, dirName);
    if (!fs.statSync(full).isDirectory()) continue;
    // 一个 module 可能有多个 controller 文件（如 auth/auth.controller.ts + auth/pat.controller.ts；
    // operation-logs/operation-logs.controller.ts 含 OperationLogsController + LoginLogsController）。
    const ctrlFiles = fs.readdirSync(full).filter((f) => f.endsWith('.controller.ts'));
    for (const ctrlFile of ctrlFiles) {
      const ctrlPath = path.join(full, ctrlFile);
      const content = fs.readFileSync(ctrlPath, 'utf-8');
      const lines = content.split('\n');

      // 检测 class-level 装饰器（找文件里所有 @Controller 上下 30 行）
      const classDecoratorLines = new Set<number>();
      const classLevelDecoratorsByLine = new Map<number, string[]>();
      for (let i = 0; i < lines.length; i++) {
        if (/export\s+class\s+\w+Controller/.test(lines[i]!)) {
          const found: string[] = [];
          // 向上找 30 行
          for (let j = Math.max(0, i - 30); j < i; j++) {
            for (const pat of PERMISSION_DECORATOR_PATTERNS) {
              if (pat.test(lines[j]!)) {
                const decMatch = lines[j]!.match(/@\w+/);
                if (decMatch) found.push(decMatch[0]);
              }
            }
          }
          classLevelDecoratorsByLine.set(i, found);
          classDecoratorLines.add(i);
        }
      }

      // 找每个方法上的 HTTP 装饰器
      const httpRegex = /@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
      for (let i = 0; i < lines.length; i++) {
        const httpMatch = lines[i]!.match(httpRegex);
        if (!httpMatch) continue;
        const method = httpMatch[1]!.toUpperCase();
        const pathPart = httpMatch[2] ?? '';
        const endpoint = `${method} /${pathPart}`;

        // Swagger / Throttle 等多行装饰器可能把权限装饰器推到 8 行之外。
        // 向后只扫到当前方法签名，既不漏报，也不借用下一个 endpoint 的权限装饰器。
        let methodLine = Math.min(lines.length - 1, i + 40);
        for (let j = i + 1; j <= methodLine; j++) {
          if (/^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(lines[j]!)) {
            methodLine = j;
            break;
          }
        }
        const found = new Set<string>();
        for (let j = Math.max(0, i - 8); j <= methodLine; j++) {
          for (const pat of PERMISSION_DECORATOR_PATTERNS) {
            if (pat.test(lines[j]!)) {
              const decMatch = lines[j]!.match(/@\w+/);
              if (decMatch) found.add(decMatch[0]);
            }
          }
        }

        // 找 method 所属的 class（在它前面最近的 export class 行）
        let owningClassLine = -1;
        for (const classLine of classDecoratorLines) {
          if (classLine < i && classLine > owningClassLine) owningClassLine = classLine;
        }
        const classDecors =
          owningClassLine >= 0 ? (classLevelDecoratorsByLine.get(owningClassLine) ?? []) : [];

        results.push({
          controller:
            dirName === ctrlFile.replace('.controller.ts', '')
              ? dirName
              : `${dirName}/${ctrlFile.replace('.controller.ts', '')}`,
          endpoint,
          decorators: [...found, ...classDecors.map((d) => `${d}(class)`)],
          classLevel: classDecors.length > 0,
        });
      }
    }
  }

  return results;
}

// ── Mapping helpers ─────────────────────────────────────────────────

/** PascalName → expected controller dirName (kebab-plural or override). */
function pascalToDirName(pascal: string): string {
  if (PASCAL_TO_DIR_OVERRIDES[pascal]) return PASCAL_TO_DIR_OVERRIDES[pascal]!;
  return pluralize(pascalToKebab(pascal));
}

// ── Classification ──────────────────────────────────────────────────

type Status =
  | 'covered'
  | 'covered_broken'
  | 'excluded'
  | 'readonly'
  | 'custom_actions'
  | 'workflow_actions'
  | 'preference_actions'
  | 'security_actions'
  | 'import_actions'
  | 'ops_actions'
  | 'config_actions'
  | 'standard_gap'
  | 'nested_schema'
  | 'orphan_prisma'
  | 'reporting'
  | 'non_entity';

interface EntityRow {
  pascalName: string | null; // null for non_entity modules
  dirName: string | null; // null for orphan_prisma
  status: Status;
  schemas: { create: boolean; update: boolean; query: boolean; file?: string };
  endpoints: Array<{ method: string; path: string }>;
  note: string;
}

/**
 * A controller is "standard_crud" (CLI-reachable) if the root-level standard
 * CRUD endpoints all exist:
 *    GET  /       (list)
 *    POST /       (create)
 *    PUT  /:id    (update)   OR   PATCH /:id
 *    DELETE /:id  (delete)
 *
 * Extra endpoints beyond these (e.g. `GET /all`, `GET /trash`,
 * `POST /:id/restore`, `PATCH /:id/status`) do NOT break CLI reachability —
 * CLI only calls the stock six. So we check *existence* of the standard set,
 * not exclusivity.
 *
 * The failure mode we're trying to catch is a controller whose every endpoint
 * sits under a prefix, with no root-level standard endpoints, so CLI stock
 * requests all 404.
 *
 * 进一步：仅检查"server 端有 PUT 或 PATCH 任一"还不够——CLI 默认发 PUT，
 * server 若仅有 PATCH，CLI 调用就 405。
 * 必须根据 UPDATE_METHOD_OVERRIDES 决定 CLI 实际会发的方法，并验证 server
 * 真的有该方法的路由。pascalName 为 null（controller 无对应 shared 实体）
 * 时退回宽松判定（CLI 反正不会自动派生此实体的命令）。
 */
function classifyController(
  endpoints: Array<{ method: string; path: string }>,
  pascalName: string | null,
  // 仅在"三元组齐全的可写实体"判定时为 true：此时 CLI 真会按 SUPPORTED_OPERATIONS_OVERRIDES
  // 白名单注册子命令，只校验白名单内操作的路由。对 partial-schema（只读类）实体不生效，
  // 否则会把 Holiday(['list']) 这种误判成 standard_crud→standard_gap。
  respectSupportedOps = false
): {
  shape: 'readonly' | 'standard_crud' | 'custom_actions';
  /** server 实际有 update 路由但用的方法与 CLI 默认不一致（例：CLI 发 PUT，server 仅 @Patch） */
  methodMismatch: boolean;
} {
  const methodsOnly = new Set(endpoints.map((e) => e.method));
  if (methodsOnly.size === 1 && methodsOnly.has('Get')) {
    return { shape: 'readonly', methodMismatch: false };
  }

  const has = (method: string, pathRe: RegExp) =>
    endpoints.some((e) => e.method === method && pathRe.test(e.path));

  const hasList = has('Get', /^$/);
  const hasCreate = has('Post', /^$/);
  const hasPut = has('Put', /^:\w+$/);
  const hasPatch = has('Patch', /^:\w+$/);
  const hasDelete = has('Delete', /^:\w+$/);

  // CLI 实际派发的方法：默认 PUT，OVERRIDES 命中走 PATCH
  const cliMethod: 'Put' | 'Patch' =
    pascalName && UPDATE_METHOD_OVERRIDES[pascalName] === 'PATCH' ? 'Patch' : 'Put';
  const hasMatchingUpdate = cliMethod === 'Put' ? hasPut : hasPatch;
  const hasAnyUpdate = hasPut || hasPatch;

  // 若实体在 SUPPORTED_OPERATIONS_OVERRIDES 白名单内，CLI 只会注册白名单里的子命令，
  // 因此只校验这些操作的路由是否存在（避免把"后端故意不提供 create/delete"误报为 covered_broken）。
  const ops = pascalName ? SUPPORTED_OPERATIONS_OVERRIDES[pascalName] : undefined;
  if (respectSupportedOps && ops) {
    const needList = ops.includes('list');
    const needCreate = ops.includes('create');
    const needUpdate = ops.includes('update');
    const needDelete = ops.includes('delete');
    const listOk = !needList || hasList;
    const createOk = !needCreate || hasCreate;
    const deleteOk = !needDelete || hasDelete;
    if (needUpdate && hasAnyUpdate && !hasMatchingUpdate) {
      return { shape: 'standard_crud', methodMismatch: true };
    }
    const updateOk = !needUpdate || hasMatchingUpdate;
    if (listOk && createOk && updateOk && deleteOk) {
      return { shape: 'standard_crud', methodMismatch: false };
    }
    return { shape: 'custom_actions', methodMismatch: false };
  }

  if (hasList && hasCreate && hasMatchingUpdate && hasDelete) {
    return { shape: 'standard_crud', methodMismatch: false };
  }

  // 关键检测：server 有 update 路由但方法不匹配——CLI 调用会 405
  if (hasList && hasCreate && hasAnyUpdate && hasDelete && !hasMatchingUpdate) {
    return { shape: 'standard_crud', methodMismatch: true };
  }

  return { shape: 'custom_actions', methodMismatch: false };
}

function controllerStatusOverride(dirName: string): ControllerStatusOverride | undefined {
  return CONTROLLER_STATUS_OVERRIDES[dirName];
}

function classifyEntities(
  sharedByPascal: Map<string, SharedSchemaInfo>,
  controllerByDir: Map<string, ControllerInfo>,
  prismaModels: string[]
): EntityRow[] {
  const rows: EntityRow[] = [];
  const seenDirs = new Set<string>();
  const seenPascals = new Set<string>();

  // Pre-compute: for each shared file, which PascalName in it has full triplet
  // (i.e. will be `covered`). Used to detect nested schemas — a partial schema
  // co-located with a covered parent entity is almost certainly a child/nested
  // type, not a standalone CRUD entity.
  const coveredParentsByFile = new Map<string, string[]>();
  for (const [pascal, info] of sharedByPascal) {
    if (info.hasCreate && info.hasUpdate && info.hasQuery) {
      const list = coveredParentsByFile.get(info.file) ?? [];
      list.push(pascal);
      coveredParentsByFile.set(info.file, list);
    }
  }

  // 1. Iterate all PascalNames appearing in shared schemas.
  for (const [pascal, info] of sharedByPascal) {
    seenPascals.add(pascal);
    const expectedDir = pascalToDirName(pascal);
    const controller = controllerByDir.get(expectedDir);
    if (controller) seenDirs.add(expectedDir);

    const allThree = info.hasCreate && info.hasUpdate && info.hasQuery;
    let status: Status;
    let note = '';

    if (EXCLUDED_ENTITIES.has(pascal)) {
      // 显式排除的实体（嵌套子项/内部资源等）：discoverEntities 不为其生成命令，
      // 不算 covered_broken 缺陷，单列 excluded。
      status = 'excluded';
      note =
        '已在 registry.ts 的 EXCLUDED_ENTITIES 中显式排除（无独立标准 CRUD controller，CLI 不生成命令）';
    } else if (allThree) {
      if (!controller) {
        status = 'covered_broken';
        note = `三元组齐全但无 controller at ${expectedDir}/——CLI 调用会 404`;
      } else {
        const { shape, methodMismatch } = classifyController(controller.endpoints, pascal, true);
        if (shape === 'standard_crud' && !methodMismatch) {
          status = 'covered';
          // 诚信检查：CLI 在 supportsRestore=true 时会注册 restore 子命令——
          // 此时 server 必须真有 POST /:id/restore 路由，否则一调即 404。
          const hasRestoreRoute = controller.endpoints.some(
            (e) => e.method === 'Post' && /^:\w+\/restore$/.test(e.path)
          );
          if (RESTORE_SUPPORTED.has(pascal) && !hasRestoreRoute) {
            status = 'covered_broken';
            note = `RESTORE_SUPPORTED 标记为 true 但 controller 无 POST /:id/restore——CLI restore 调用会 404`;
          } else if (!RESTORE_SUPPORTED.has(pascal) && hasRestoreRoute) {
            // server 实现了 restore 但 CLI 未声明——非阻塞，但应补 RESTORE_SUPPORTED
            note =
              '提示：controller 有 POST /:id/restore 但未在 RESTORE_SUPPORTED 中声明，CLI 不会暴露 restore 命令';
          }
          // 诚信检查：SUBMIT_APPROVAL_SUPPORTED 标记的实体必须真有
          // POST /:id/submit-approval 路由（thin wrapper），否则 CLI
          // 的 submit-approval 子命令一调用必 404。
          const hasSubmitApprovalRoute = controller.endpoints.some(
            (e) => e.method === 'Post' && /^:\w+\/submit-approval$/.test(e.path)
          );
          if (SUBMIT_APPROVAL_SUPPORTED.has(pascal) && !hasSubmitApprovalRoute) {
            status = 'covered_broken';
            note = `SUBMIT_APPROVAL_SUPPORTED 标记为 true 但 controller 无 POST /:id/submit-approval——CLI submit-approval 调用会 404`;
          } else if (!SUBMIT_APPROVAL_SUPPORTED.has(pascal) && hasSubmitApprovalRoute) {
            // server 有 thin wrapper 但 CLI 未声明——非阻塞提示
            const existingNote = note;
            const submitNote =
              '提示：controller 有 POST /:id/submit-approval 但未在 SUBMIT_APPROVAL_SUPPORTED 中声明，CLI 不会暴露 submit-approval 命令';
            note = existingNote ? `${existingNote}; ${submitNote}` : submitNote;
          }
          // 诚信检查：CLAIM_SUPPORTED 标记的实体必须真有
          // POST /:id/claim 路由（公海认领），否则 CLI claim 调用必 404。
          const hasClaimRoute = controller.endpoints.some(
            (e) => e.method === 'Post' && /^:\w+\/claim$/.test(e.path)
          );
          if (CLAIM_SUPPORTED.has(pascal) && !hasClaimRoute) {
            status = 'covered_broken';
            note = `CLAIM_SUPPORTED 标记为 true 但 controller 无 POST /:id/claim——CLI claim 调用会 404`;
          } else if (!CLAIM_SUPPORTED.has(pascal) && hasClaimRoute) {
            // server 有 claim 路由但 CLI 未声明——非阻塞提示
            const existingNote = note;
            const claimNote =
              '提示：controller 有 POST /:id/claim 但未在 CLAIM_SUPPORTED 中声明，CLI 不会暴露 claim 命令';
            note = existingNote ? `${existingNote}; ${claimNote}` : claimNote;
          }
        } else if (shape === 'standard_crud' && methodMismatch) {
          status = 'covered_broken';
          const cliMethod = UPDATE_METHOD_OVERRIDES[pascal] === 'PATCH' ? 'PATCH' : 'PUT';
          note = `三元组齐全但 update 方法不匹配——CLI 默认发 ${cliMethod}/:id，server 实现了另一种方法。请在 registry.ts 的 UPDATE_METHOD_OVERRIDES 中显式声明`;
        } else if (shape === 'readonly') {
          // Extremely unusual: shared says CRUD but backend only exposes GETs.
          // Treat as covered_broken — CLI POST/PUT/DELETE will fail.
          status = 'covered_broken';
          note = '三元组齐全但 controller 仅 GET，CLI create/update/delete 会 405';
        } else {
          status = 'covered_broken';
          note = '三元组齐全但 controller 路径非标准（如 `my/*` 前缀），CLI 调用会 404';
        }
      }
    } else if (!controller) {
      // No controller matches. If this partial schema sits in a file whose
      // primary entity is already covered, it's almost certainly a nested
      // child type written via the parent — not a missing CRUD.
      const siblings = (coveredParentsByFile.get(info.file) ?? []).filter((p) => p !== pascal);
      if (siblings.length > 0) {
        status = 'nested_schema';
        note = `与同文件父实体 ${siblings.join(', ')} 共享，伴随父实体写入`;
      } else if (PREFERENCE_SCHEMAS.has(pascal)) {
        status = 'preference_actions';
        note =
          '当前用户筛选偏好由 filter-schemes controller 的 personal/* 子路由按员工隔离承载，不是独立标准 CRUD 实体';
      } else if (REPORTING_SCHEMAS.has(pascal)) {
        status = 'reporting';
        note =
          '只读查询/报表/聚合 DTO，由父级或专题 controller 承载，不是独立 CRUD 实体；后续可评估 CLI 报表命令/extras，禁止为覆盖率补空 create/update schema';
      } else {
        // Truly orphan on the shared side — partial definition but no parent
        // in the same file. This is the real gap signal.
        status = 'standard_gap';
        note = `shared has partial schemas but no controller at ${expectedDir}/`;
      }
    } else {
      const { shape } = classifyController(controller.endpoints, pascal);
      if (shape === 'readonly') {
        status = 'readonly';
        if (info.readonlyComment) note = 'shared 注释已标「只读实体」';
        else note = 'controller 仅 GET';
      } else if (shape === 'standard_crud') {
        status = 'standard_gap';
        note = 'controller 有完整标准 CRUD 但 shared 缺 create/update/query 三元组之一';
      } else {
        const override = controllerStatusOverride(expectedDir);
        if (override) {
          status = override.status;
          note = override.note;
        } else {
          status = 'custom_actions';
          note = 'controller 有非标 POST/PUT/DELETE，不匹配标准 CRUD 模式';
        }
      }
    }

    rows.push({
      pascalName: pascal,
      dirName: controller ? expectedDir : null,
      status,
      schemas: {
        create: info.hasCreate,
        update: info.hasUpdate,
        query: info.hasQuery,
        file: info.file,
      },
      endpoints: controller?.endpoints ?? [],
      note,
    });
  }

  // 2. Controllers that have no matching shared entity.
  for (const [dirName, controller] of controllerByDir) {
    if (seenDirs.has(dirName)) continue;
    seenDirs.add(dirName);
    const isNonEntity = NON_ENTITY_MODULES.has(dirName);
    const override = controllerStatusOverride(dirName);
    rows.push({
      pascalName: null,
      dirName,
      status: override?.status ?? (isNonEntity ? 'non_entity' : 'custom_actions'),
      schemas: { create: false, update: false, query: false },
      endpoints: controller.endpoints,
      note:
        override?.note ??
        (isNonEntity
          ? '非业务实体模块（auth/upload/dashboard/health/rate-limit-test 等）'
          : 'controller 存在但 shared 无对应 createX/updateX/queryX——可能命名不匹配或实体全靠非标 action'),
    });
  }

  // 3. Prisma models with no shared schema and no controller = orphan.
  for (const model of prismaModels) {
    if (seenPascals.has(model)) continue;
    rows.push({
      pascalName: model,
      dirName: null,
      status: 'orphan_prisma',
      schemas: { create: false, update: false, query: false },
      endpoints: [],
      note: '子表 / join 表 / 审计表，无独立 controller 和 shared schema（设计上不暴露）',
    });
  }

  // Stable ordering: surface real gaps first, chrome last.
  const order: Record<Status, number> = {
    covered_broken: 0, // false-positive coverage — MOST urgent
    standard_gap: 1, // real gaps on the shared side
    custom_actions: 2,
    workflow_actions: 3,
    config_actions: 4,
    import_actions: 5,
    security_actions: 6,
    preference_actions: 7,
    ops_actions: 8,
    reporting: 9,
    readonly: 10,
    excluded: 11, // 显式排除（设计上不暴露）
    nested_schema: 12,
    orphan_prisma: 13,
    non_entity: 14,
    covered: 15, // actually working — bottom of the list
  };
  rows.sort((a, b) => {
    const d = order[a.status] - order[b.status];
    if (d !== 0) return d;
    return (a.pascalName ?? a.dirName ?? '').localeCompare(b.pascalName ?? b.dirName ?? '');
  });

  return rows;
}

// ── Reporting ───────────────────────────────────────────────────────

function summarize(rows: EntityRow[]): Record<Status, number> {
  const s: Record<Status, number> = {
    covered: 0,
    covered_broken: 0,
    excluded: 0,
    readonly: 0,
    custom_actions: 0,
    workflow_actions: 0,
    preference_actions: 0,
    security_actions: 0,
    import_actions: 0,
    ops_actions: 0,
    config_actions: 0,
    standard_gap: 0,
    nested_schema: 0,
    orphan_prisma: 0,
    reporting: 0,
    non_entity: 0,
  };
  for (const r of rows) s[r.status]++;
  return s;
}

function renderMarkdown(rows: EntityRow[]): string {
  const summary = summarize(rows);
  const lines: string[] = [];
  lines.push('# ky-azeroth CLI 覆盖度体检报告');
  lines.push('');
  lines.push(`_生成时间：${new Date().toISOString()}_`);
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push('| 分类 | 数量 | 说明 |');
  lines.push('|---|---|---|');
  lines.push(`| covered | ${summary.covered} | 三元组齐全 + controller 标准 CRUD，CLI 真能调通 |`);
  lines.push(
    `| covered_broken | ${summary.covered_broken} | **假 covered**——三元组齐全但 controller 路径非标（如 my/*），CLI 调用会 404 |`
  );
  lines.push(
    `| standard_gap | ${summary.standard_gap} | **真·遗漏**——补 shared schema 即可接入 CLI（预期为 0） |`
  );
  lines.push(
    `| custom_actions | ${summary.custom_actions} | 未归类的非标 endpoint，需人工判断是否补 CLI 或新增语义分类 |`
  );
  lines.push(`| workflow_actions | ${summary.workflow_actions} | 审批/动作流，不应 CRUD 化 |`);
  lines.push(
    `| config_actions | ${summary.config_actions} | 配置发布/系统参数类动作，不应按普通 CRUD 建模 |`
  );
  lines.push(`| import_actions | ${summary.import_actions} | 导入预览/提交工作流 |`);
  lines.push(`| security_actions | ${summary.security_actions} | 会话/Token 等安全敏感动作 |`);
  lines.push(`| preference_actions | ${summary.preference_actions} | 当前用户偏好/通知动作 |`);
  lines.push(`| ops_actions | ${summary.ops_actions} | 运维/归档/同步动作 |`);
  lines.push(`| readonly | ${summary.readonly} | 刻意只读（同步/审计），不应暴露 create/update |`);
  lines.push(
    `| excluded | ${summary.excluded} | 显式排除（无独立标准 CRUD controller），CLI 不生成命令 |`
  );
  lines.push(
    `| nested_schema | ${summary.nested_schema} | 与父实体共享文件的子项 schema，伴随父实体写入 |`
  );
  lines.push(
    `| orphan_prisma | ${summary.orphan_prisma} | Prisma 有 model 但无 controller（子表/内部） |`
  );
  lines.push(
    `| reporting | ${summary.reporting} | 只读查询/报表/聚合 DTO，不应 CRUD 化，但可评估 CLI 报表命令/extras |`
  );
  lines.push(`| non_entity | ${summary.non_entity} | 非业务实体模块 |`);
  lines.push('');

  const groupLabels: Record<Status, string> = {
    covered: '## covered — CLI 已覆盖',
    covered_broken: '## covered_broken — 假 covered（CLI 调用会 404，最紧急）',
    standard_gap: '## standard_gap — 真·遗漏（该补）',
    custom_actions: '## custom_actions — 未归类非标操作（需人工判断）',
    workflow_actions: '## workflow_actions — 审批/动作流',
    config_actions: '## config_actions — 配置动作',
    import_actions: '## import_actions — 导入工作流',
    security_actions: '## security_actions — 安全敏感动作',
    preference_actions: '## preference_actions — 用户偏好/通知动作',
    ops_actions: '## ops_actions — 运维/同步/归档动作',
    readonly: '## readonly — 刻意只读',
    excluded: '## excluded — 显式排除（设计上不暴露）',
    nested_schema: '## nested_schema — 嵌套子项 schema',
    orphan_prisma: '## orphan_prisma — 子表/内部表',
    reporting: '## reporting — 报表/聚合读模型',
    non_entity: '## non_entity — 非实体模块',
  };

  for (const status of [
    'covered_broken',
    'standard_gap',
    'custom_actions',
    'workflow_actions',
    'config_actions',
    'import_actions',
    'security_actions',
    'preference_actions',
    'ops_actions',
    'readonly',
    'excluded',
    'nested_schema',
    'orphan_prisma',
    'reporting',
    'non_entity',
    'covered',
  ] as Status[]) {
    const group = rows.filter((r) => r.status === status);
    if (group.length === 0) continue;
    lines.push('');
    lines.push(groupLabels[status]);
    lines.push('');
    lines.push('| PascalName | dirName | schemas (c/u/q) | endpoints | note |');
    lines.push('|---|---|---|---|---|');
    for (const r of group) {
      const triplet = `${r.schemas.create ? 'c' : '·'}${r.schemas.update ? 'u' : '·'}${r.schemas.query ? 'q' : '·'}`;
      const eps = r.endpoints.map((e) => `${e.method} /${e.path}`).join('<br>') || '(none)';
      lines.push(
        `| ${r.pascalName ?? '(none)'} | ${r.dirName ?? '(none)'} | ${triplet} | ${eps} | ${r.note} |`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ── Command registration ───────────────────────────────────────────

// ── decorator drift 分类 ────────────────────────────────────────────
//
// 输入：scanControllerDecorators 出来的全部 endpoint 装饰器 audit
// 输出：仅缺一切显式权限装饰器的 endpoint 列表
//
// 为何不直接 filter：有些 endpoint 是 self-scoped（如 sessions / users me），
// server-side 通过 @CurrentUser 行级隔离即可，无需任何 RBAC 装饰器——把这
// 些 endpoint 显式排除避免噪声。

const DECORATOR_SELF_SCOPED_ALLOWLIST: Array<{ controller: RegExp; endpoint: RegExp }> = [
  { controller: /^sessions$/, endpoint: /.*/ },
  { controller: /^upload$/, endpoint: /.*/ },
  // 自助型 endpoint（个人通知/未读数/列表）
  { controller: /^notifications$/, endpoint: /.*/ },
  // 用户自助（GET /me / PATCH /me/password）
  { controller: /^users$/, endpoint: /\/me/ },
  // dashboard 通过 DataScopeService 行级隔离
  { controller: /^dashboard$/, endpoint: /.*/ },
  // health 模块完全不参与 audit
  { controller: /^health$/, endpoint: /.*/ },
  // filter-schemes / table-preferences 是用户私有 UI 偏好，登录即用
  { controller: /^filter-schemes$/, endpoint: /.*/ },
  { controller: /^table-preferences$/, endpoint: /.*/ },
  // CRM 工时自助接口（/effort-records/my/*）按 @CurrentUser 隔离
  { controller: /^effort-records$/, endpoint: /\/my\// },
];

function classifyDecoratorAudit(audits: EndpointDecoratorAudit[]): EndpointDecoratorAudit[] {
  return audits.filter((a) => {
    if (a.decorators.length > 0) return false;
    // 在白名单内则视为 self-scoped 设计豁免
    for (const wl of DECORATOR_SELF_SCOPED_ALLOWLIST) {
      if (wl.controller.test(a.controller) && wl.endpoint.test(a.endpoint)) {
        return false;
      }
    }
    return true;
  });
}

// ── extras 覆盖度对账 ───────────────────────────────────────────────
//
// 对每个 covered/custom_actions 实体的非标 endpoint（不是 list/get/create/
// update/delete/restore/submit-approval/claim/change-request 这 9 个标准
// 子命令对应路径），检查 CLI 是否有手写 extras 子命令调到。
// 缺则进 extras_gap 列表；CLI extras 指向不存在 endpoint 则进 ghost_extras。

const STANDARD_CRUD_PATHS = [
  /^$/, // list (GET /)
  /^:\w+$/, // get/update/delete (GET|PUT|PATCH|DELETE /:id)
  /^:\w+\/restore$/, // restore
  /^:\w+\/submit-approval$/, // submit-approval
  /^:\w+\/claim$/, // claim
  /^:\w+\/change-request$/, // change-request
];

function isStandardCrudPath(p: string): boolean {
  return STANDARD_CRUD_PATHS.some((re) => re.test(p));
}

export interface ExtrasGap {
  controller: string;
  endpoint: string;
  /**
   * - 'strong'：extras 文件不存在 OR 文件存在但 endpoint 关键 token 也找不到 → 真 gap
   * - 'weak'：extras 文件存在且关键 token 命中过，但本扫描器没静态匹配上 request 字面量
   *   （helper 转发/变量拼接路径 case），属于 false-negative 风险，仅提示。--strict 不卡。
   */
  strength: 'strong' | 'weak';
  reason: string;
}

// 受保护管理端点 看板/纯前端聚合 controller：endpoint 不该有对应 CLI 子命令，
// 整体从 extras 对账中排除。与 audit 报告里"design_excluded"分类语义一致。
const EXTRAS_AUDIT_SKIP_CONTROLLERS = new Set<string>([
  // 纯看板聚合（仅前端可视化）
  'analytics',
  'seo-monitor',
  'web-analytics',
  'seo',
  'finance-pnl',
  // 非业务实体
  'auth',
  'upload',
  'dashboard',
  'health',
  'rate-limit-test',
  'finance-import',
  'personal-access-tokens',
  // 用户私域偏好（@CurrentUser 行级隔离，无 CLI 价值）
  'filter-schemes',
  'table-preferences',
  'notifications',
  'sessions',
  // 钉钉同步：触发口归运维 cron，CLI 不暴露（与 doctor non_entity 类似定位）
  'dingtalk-sync',
]);

// 单条 endpoint 级别的豁免（路径 + controller 同时匹配则不算 gap）。
// 用于 controller 整体在 CLI 内但个别 endpoint 是 selection helper / 内部转发等
// 设计上不必暴露的子路径。
interface ExtrasEndpointExclusion {
  controller: RegExp;
  method?: RegExp;
  pathRe: RegExp;
  reason: string;
}

const EXTRAS_AUDIT_SKIP_ENDPOINTS: ExtrasEndpointExclusion[] = [
  // /all selection 端点（2026-06-13 决策：本次不做）
  {
    controller: /.*/,
    pathRe: /^all$/,
    reason: '登录用户下拉选择器，不是 Agent 业务动作',
  },
  // approvals 的部分内部 list view 已通过 approvals.ts 顶级注册
  {
    controller: /^approvals$/,
    pathRe: /.*/,
    reason: '由顶级 approvals 命令组覆盖',
  },
  // approval-flows / finance 由 顶级注册 commands/{approvals,finance,system-params}.ts 覆盖
  // 不属于 entityCmd 追挂式 extras——entity 同名映射不上，需整体豁免
  {
    controller: /^approval-flows$/,
    pathRe: /.*/,
    reason: '由顶级 approvals 命令组覆盖',
  },
  { controller: /^finance$/, pathRe: /.*/, reason: '由顶级 finance 命令组覆盖' },
  {
    controller: /^system-params$/,
    pathRe: /.*/,
    reason: '由顶级 system-params 命令组覆盖',
  },
  {
    controller: /^xiaohongshu-oauth$/,
    method: /^POST$/,
    pathRe: /^authorization-url$/,
    reason: 'OAuth 授权必须由用户在浏览器完成外部跳转与账号确认，不属于 Agent API 能力',
  },
  {
    controller: /^xiaohongshu-oauth$/,
    method: /^GET$/,
    pathRe: /^callback$/,
    reason:
      'OAuth provider 外部回调路由，由浏览器重定向携带一次性 state/auth_code，不应由 Agent 调用',
  },
];

function classifyExtrasGaps(
  monoRoot: string,
  controllerByDir: Map<string, ControllerInfo>,
  extras: ExtrasSubcommand[],
  rows: EntityRow[]
): { extrasGaps: ExtrasGap[]; ghostExtras: ExtrasGap[] } {
  const extrasGaps: ExtrasGap[] = [];
  const ghostExtras: ExtrasGap[] = [];

  // 启发式 strength 判定：读取 entity 的 extras 文件内容，对每条 gap endpoint
  // 提取关键 token（如 /customers/trash → 'trash'；/:id/red-void → 'red-void'）。
  // token 在文件内出现 ≥1 次 = weak（视为软覆盖，static scanner false-negative 风险）。
  // 文件不存在或 token 也 grep 不到 = strong（真 gap）。
  const cmdDir = path.join(monoRoot, 'apps/cli/src/commands');
  const extrasFileContent = new Map<string, string>();
  function loadExtrasFile(entity: string): string | null {
    if (extrasFileContent.has(entity)) return extrasFileContent.get(entity)!;
    const p = path.join(cmdDir, `${entity}.ts`);
    if (!fs.existsSync(p)) {
      extrasFileContent.set(entity, '');
      return null;
    }
    const content = fs.readFileSync(p, 'utf-8');
    extrasFileContent.set(entity, content);
    return content;
  }
  function extractEndpointTokens(epPath: string): string[] {
    // 取 path 里所有非 :id 的字段名 token（kebab-case 词组也保留整体）
    return epPath
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith(':'))
      .filter((s) => s !== 'undefined');
  }
  function judgeStrength(controllerName: string, epPath: string): 'strong' | 'weak' {
    const fileContent = loadExtrasFile(controllerName);
    if (!fileContent) return 'strong';
    const tokens = extractEndpointTokens(epPath);
    if (tokens.length === 0) return 'strong';
    // 任一关键 token 在 extras 文件内命中 → weak
    const allHit = tokens.every((t) => fileContent.includes(t));
    return allHit ? 'weak' : 'strong';
  }

  // 仅对 covered / custom_actions 实体做 extras 对账（设计排除的不算）
  const auditTargets = new Set(
    rows
      .filter(
        (r) =>
          [
            'covered',
            'custom_actions',
            'workflow_actions',
            'config_actions',
            'import_actions',
            'security_actions',
            'preference_actions',
            'ops_actions',
          ].includes(r.status) &&
          r.dirName &&
          !EXTRAS_AUDIT_SKIP_CONTROLLERS.has(r.dirName)
      )
      .map((r) => r.dirName!)
  );

  // 把 extras 按 entity 索引（按 CLI 文件名匹配 controller dirName；少数顶级命令组
  // 如 finance / approvals / system-params 不映射任何单一 controller，跳过）
  const extrasByEntity = new Map<string, ExtrasSubcommand[]>();
  for (const e of extras) {
    const list = extrasByEntity.get(e.entity) ?? [];
    list.push(e);
    extrasByEntity.set(e.entity, list);
  }

  for (const dirName of auditTargets) {
    const controller = controllerByDir.get(dirName);
    if (!controller) continue;
    const entityExtras = extrasByEntity.get(dirName) ?? [];

    // 检查每个非标 endpoint 是否有 extras 覆盖
    for (const ep of controller.endpoints) {
      if (isStandardCrudPath(ep.path)) continue;

      // 单条豁免
      const skipped = EXTRAS_AUDIT_SKIP_ENDPOINTS.some(
        (exclusion) =>
          exclusion.controller.test(dirName) &&
          (!exclusion.method || exclusion.method.test(ep.method.toUpperCase())) &&
          exclusion.pathRe.test(ep.path)
      );
      if (skipped) continue;

      const fullEndpoint = `${ep.method.toUpperCase()} /${dirName}/${ep.path}`.replace(/\/+$/, '');

      // CLI 真能调到的方法：extras 里方法+路径都匹配
      const epPathRe = normalizeTemplatePath(`/${dirName}/${ep.path}`);
      const covered = entityExtras.some(
        (x) => x.method.toUpperCase() === ep.method.toUpperCase() && x.pathPattern === epPathRe
      );
      if (!covered) {
        const strength = judgeStrength(dirName, epPathRe);
        extrasGaps.push({
          controller: dirName,
          endpoint: fullEndpoint,
          strength,
          reason:
            strength === 'strong'
              ? `非标 endpoint 无对应 CLI extras（文件不存在 或 关键 token 也未在 extras 文件命中）`
              : `非标 endpoint 静态扫描无对应 CLI 子命令（期望路径 ${epPathRe}）—— extras 文件存在且关键 token 命中，可能是 helper 转发/path 变量拼接的 false-negative`,
        });
      }
    }

    // 反向：检查 extras 是否指向不存在的 endpoint
    for (const x of entityExtras) {
      if (x.pathPattern === '?') continue; // helper 转发，未抽到 request
      const normalized = normalizeTemplatePath(x.pathPattern);
      // finance.ts 是顶级命令组，内部请求分散到 finance-accounts /
      // finance-ledger / finance-import 等真实 controller；按请求首段反查，
      // 不能拿整份 finance.ts 与 /finance controller 逐条比较。
      const targetDir = x.entity === 'finance' ? normalized.split('/').filter(Boolean)[0] : dirName;
      const targetController = targetDir ? controllerByDir.get(targetDir) : undefined;
      const exists = targetController?.endpoints.some((ep) => {
        const epPath = normalizeTemplatePath(`/${targetDir}/${ep.path}`);
        return ep.method.toUpperCase() === x.method.toUpperCase() && epPath === normalized;
      });
      if (!exists) {
        ghostExtras.push({
          controller: targetDir ?? dirName,
          endpoint: `${x.method} ${normalized}`,
          strength: 'strong',
          reason: `CLI extras 子命令 "${x.subcommandRaw}"（${x.source}）指向 server 不存在的路径`,
        });
      }
    }
  }

  return { extrasGaps, ghostExtras };
}

function renderExtrasSection(extrasGaps: ExtrasGap[], ghostExtras: ExtrasGap[]): string {
  const strong = extrasGaps.filter((g) => g.strength === 'strong');
  const weak = extrasGaps.filter((g) => g.strength === 'weak');
  const lines: string[] = [];
  lines.push('');
  lines.push('## extras 覆盖度（2026-06-13 audit phase D 新增）');
  lines.push('');
  lines.push(`- extras_gap_strong: ${strong.length} 项（必修，--strict 卡）`);
  lines.push(`- extras_gap_weak: ${weak.length} 项（仅提示，可能是 helper 转发的 false-negative）`);
  lines.push(`- ghost_extras: ${ghostExtras.length} 项（必修，--strict 卡）`);
  if (strong.length > 0) {
    lines.push('');
    lines.push('### extras_gap_strong 明细（必修）');
    lines.push('');
    lines.push('| controller | endpoint | 原因 |');
    lines.push('|---|---|---|');
    for (const g of strong) {
      lines.push(`| ${g.controller} | ${g.endpoint} | ${g.reason} |`);
    }
  }
  if (weak.length > 0) {
    lines.push('');
    lines.push('### extras_gap_weak 明细（仅提示）');
    lines.push('');
    lines.push('| controller | endpoint | 原因 |');
    lines.push('|---|---|---|');
    for (const g of weak) {
      lines.push(`| ${g.controller} | ${g.endpoint} | ${g.reason} |`);
    }
  }
  if (ghostExtras.length > 0) {
    lines.push('');
    lines.push('### ghost_extras 明细（必修）');
    lines.push('');
    lines.push('| controller | endpoint | 原因 |');
    lines.push('|---|---|---|');
    for (const g of ghostExtras) {
      lines.push(`| ${g.controller} | ${g.endpoint} | ${g.reason} |`);
    }
  }
  return lines.join('\n');
}

function renderDecoratorSection(missing: EndpointDecoratorAudit[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('## decorator_missing（2026-06-13 audit phase D 新增）');
  lines.push('');
  lines.push(`- ${missing.length} 项端点无任何显式权限装饰器（已排除 self-scoped 设计豁免）`);
  if (missing.length > 0) {
    lines.push('');
    lines.push('| controller | endpoint | 现状 |');
    lines.push('|---|---|---|');
    for (const m of missing) {
      lines.push(
        `| ${m.controller} | ${m.endpoint} | 无 @RequirePermission / @Public / @AllowAnyAuthenticatedUser；如属设计豁免，请加显式装饰器或更新 DECORATOR_SELF_SCOPED_ALLOWLIST |`
      );
    }
  }
  return lines.join('\n');
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(
      '诊断 CLI 覆盖度：交叉比对 shared schema、后端 controller、Prisma model、CLI extras 与权限装饰器'
    )
    .addOption(
      new Option('--format <type>', '输出格式: json | table | markdown')
        .choices(['json', 'table', 'markdown'])
        .default('json')
    )
    .option('--output <file>', '把 markdown 报告写入文件（隐含 --format markdown）')
    .option(
      '--status <status>',
      '仅输出指定分类: covered | covered_broken | standard_gap | custom_actions | workflow_actions | config_actions | import_actions | security_actions | preference_actions | ops_actions | readonly | nested_schema | orphan_prisma | reporting | non_entity'
    )
    .option(
      '--strict',
      '存在 extras_gap / ghost_extras / decorator_missing 任一项时返回非零退出码（CI 用）'
    )
    .action((opts: { format: string; output?: string; status?: string; strict?: boolean }) => {
      let monoRoot: string;
      try {
        monoRoot = findMonorepoRoot();
      } catch (err) {
        fatal((err as Error).message);
      }

      const sharedByPascal = scanSharedSchemas(monoRoot);
      const controllerByDir = scanControllers(monoRoot);
      const prismaModels = scanPrismaModels(monoRoot);
      const extrasSubcommands = scanCliExtras(monoRoot);
      const decoratorAudits = scanControllerDecorators(monoRoot);

      let rows = classifyEntities(sharedByPascal, controllerByDir, prismaModels);
      const { extrasGaps, ghostExtras } = classifyExtrasGaps(
        monoRoot,
        controllerByDir,
        extrasSubcommands,
        rows
      );
      const decoratorMissing = classifyDecoratorAudit(decoratorAudits);

      if (opts.status) {
        rows = rows.filter((r) => r.status === opts.status);
      }

      const summary = summarize(rows);
      const strongGaps = extrasGaps.filter((g) => g.strength === 'strong');
      const extendedSummary = {
        ...summary,
        extras_gap_strong: strongGaps.length,
        extras_gap_weak: extrasGaps.length - strongGaps.length,
        ghost_extras: ghostExtras.length,
        decorator_missing: decoratorMissing.length,
      };

      // --output implies markdown
      const format = opts.output ? 'markdown' : opts.format;

      if (format === 'markdown') {
        const md =
          renderMarkdown(rows) +
          renderExtrasSection(extrasGaps, ghostExtras) +
          renderDecoratorSection(decoratorMissing) +
          '\n';
        if (opts.output) {
          fs.writeFileSync(opts.output, md, 'utf-8');
          console.log(JSON.stringify({ written: opts.output, summary: extendedSummary }, null, 2));
        } else {
          process.stdout.write(md);
        }
      } else if (format === 'table') {
        const tableRows = rows.map((r) => ({
          status: r.status,
          pascal: r.pascalName ?? '',
          dir: r.dirName ?? '',
          triplet: `${r.schemas.create ? 'c' : '·'}${r.schemas.update ? 'u' : '·'}${r.schemas.query ? 'q' : '·'}`,
          endpoints: r.endpoints.length,
          note: r.note,
        }));
        output(tableRows, 'table', {
          columns: ['status', 'pascal', 'dir', 'triplet', 'endpoints', 'note'],
        });
        console.log('\nSummary:', JSON.stringify(extendedSummary));
      } else {
        output(
          {
            summary: extendedSummary,
            rows,
            extras_gap: extrasGaps,
            ghost_extras: ghostExtras,
            decorator_missing: decoratorMissing,
          },
          'json'
        );
      }

      // --strict：标准 CRUD 断裂、标准 endpoint 缺口、强 extras 缺口、幽灵命令和权限漏挂均阻断。
      // extras_gap_weak 仍不阻断，因为 helper/变量路径会让静态扫描出现可解释的 false-negative。
      if (opts.strict) {
        const coveredBroken = summary.covered_broken ?? 0;
        const standardGap = summary.standard_gap ?? 0;
        const blocking =
          coveredBroken +
          standardGap +
          strongGaps.length +
          ghostExtras.length +
          decoratorMissing.length;
        if (blocking > 0) {
          fatal(
            `doctor --strict failed: covered_broken=${coveredBroken} standard_gap=${standardGap} extras_gap_strong=${strongGaps.length} ghost_extras=${ghostExtras.length} decorator_missing=${decoratorMissing.length}`,
            { coveredBroken, standardGap, strongGaps, ghostExtras, decoratorMissing }
          );
        }
      }
    });
}
