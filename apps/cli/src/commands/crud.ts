import { findMenusByCliCommand } from '@ky-azeroth/shared';
import { Command } from 'commander';
import { z } from 'zod';

import { request } from '../client.js';
import type { EntityConfig } from '../registry.js';
import {
  camelToKebab,
  encodeUuidPathId,
  extractFields,
  fatal,
  output,
  parseStrictInt,
  printJson,
  readJsonInput,
  validateWithSchema,
} from '../utils.js';
import { runAllPages } from './all-pages.js';

// ── Pagination defaults ─────────────────────────────────────────────

/**
 * 与后端 paginationSchema.default(100) 保持一致。
 * 提示：非 ADMIN 用户在 customers/keep-records/opportunities 上 pageSize>500
 * 会被服务端 403；需要批量导出请走 `--all` 自动翻页。
 */
const DEFAULT_PAGE_SIZE = 100;

// ── Numeric coerce helpers ──────────────────────────────────────────

/**
 * Commander 的 coerce 函数签名是 `(value, previous) => result`，必须显式包一层只取
 * 第一个参数。整数 option 复用严格解析；通用数字用 Number 完整消费输入，避免
 * parseInt/parseFloat 把 `3junk` 静默截成 3，同时保留 3.14 等合法 decimal。
 */
const intArg = (v: string): number => {
  const parsed = parseStrictInt(v, 'integer option');
  if (parsed < 1) {
    fatal(`Invalid integer option "${v}"`, 'Expected a positive integer (>= 1)');
  }
  return parsed;
};
const numberArg = (v: string): number => {
  if (v.trim().length === 0) {
    fatal('Invalid numeric value', 'Whitespace is not a number');
  }
  const parsed = Number(v);
  if (!Number.isFinite(parsed)) {
    fatal(`Invalid numeric value "${v}"`, 'Expected a finite number without prefix/suffix');
  }
  return parsed;
};

// ── JSON input helpers ──────────────────────────────────────────────
// 注：readJsonInput 已抽到 utils.ts 供 holidays/customers/payments 等模块复用。

/**
 * 给嵌套字段对应的 `--<field>-json` option 名（commander 会按规则把它转成 camelCase 属性名）。
 *  e.g. products → --products-json，opts.productsJson
 */
function jsonFlagName(fieldName: string): string {
  return `${camelToKebab(fieldName)}-json`;
}
function jsonOptKey(fieldName: string): string {
  return `${fieldName}Json`;
}

// ── Dynamic option registration ─────────────────────────────────────

/**
 * Register CLI options from a Zod schema's shape.
 *  - 基础类型（string/number/boolean/enum/union）→ `--field <value>`
 *  - 基础类型数组（string[] 等）→ `--field <value>` 可重复
 *  - 嵌套对象 / 对象数组 → 这里完全跳过（无法用 string flag 表达），改由
 *    `addNestedJsonOptions` 注册 `--field-json <path>` 接管
 */
function addSchemaOptions(
  cmd: Command,
  schema: z.ZodTypeAny,
  skipFields: Set<string> = new Set()
): void {
  const fields = extractFields(schema);
  for (const field of fields) {
    if (skipFields.has(field.name)) continue;
    // Credential-like values must never become Commander options (argv/process title/history).
    // They remain available only through --json - or a restricted mode-0600 JSON file.
    if (/(?:password|passwd|secret|token|apiKey)$/i.test(field.name)) continue;
    if (field.kind === 'object' || field.kind === 'object-array') continue;

    const flag = `--${camelToKebab(field.name)} <value>`;
    const desc = `${field.type}${field.required ? ' (required)' : ''}`;

    if (field.kind === 'scalar-array') {
      // Scalar arrays: allow repeating --field v1 --field v2
      cmd.option(flag, desc, (val: string, prev: string[]) => [...prev, val], [] as string[]);
    } else if (field.type === 'number') {
      const numericArg =
        field.numericKind === 'integer'
          ? (value: string): number => parseStrictInt(value, `--${camelToKebab(field.name)}`)
          : numberArg;
      cmd.option(flag, desc, numericArg);
    } else if (field.type === 'boolean') {
      // For booleans, use --flag / --no-flag pattern
      cmd.option(`--${camelToKebab(field.name)}`, desc);
    } else {
      cmd.option(flag, desc);
    }
  }
}

/**
 * 给 create/update 注册嵌套字段的 `--<field>-json <path>` 选项。
 *  - 仅对 schema 中 kind 为 object / object-array 的字段注册
 *  - 值是文件路径，或 `-` 表示从 stdin 读
 *  - 读到的 JSON 整体替换该字段（与后端 service 的"传则全量替换"语义一致）
 */
function addNestedJsonOptions(
  cmd: Command,
  schema: z.ZodTypeAny,
  skipFields: Set<string> = new Set()
): void {
  const fields = extractFields(schema);
  for (const field of fields) {
    if (skipFields.has(field.name)) continue;
    // Credential-like values must never become Commander options (argv/process title/history).
    // They remain available only through --json - or a restricted mode-0600 JSON file.
    if (/(?:password|passwd|secret|token|apiKey)$/i.test(field.name)) continue;
    if (field.kind !== 'object' && field.kind !== 'object-array') continue;

    const flag = `--${jsonFlagName(field.name)} <path>`;
    const hint = field.kind === 'object-array' ? 'JSON array' : 'JSON object';
    const desc = `${field.type}${field.required ? ' (required)' : ''} ${hint} file (or "-" for stdin)`;
    cmd.option(flag, desc);
  }
}

/**
 * 把 create/update opts 组装成最终 request body，合并优先级（低 → 高）：
 *  1. `--json <path>`：整体 base（要求顶层是 JSON 对象）
 *  2. `--<field>-json <path>`：覆盖对应嵌套字段（object / object-array）
 *  3. `--<field> <value>`：scalar / scalar-array flags 最后覆盖
 */
function buildRequestBody(
  opts: Record<string, unknown>,
  schema: z.ZodTypeAny
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  // 1) --json：整体 base
  const jsonPath = opts['json'] as string | undefined;
  if (jsonPath) {
    const parsed = readJsonInput(jsonPath, '--json');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      fatal('--json input must be a JSON object at the top level');
    }
    Object.assign(body, parsed as Record<string, unknown>);
  }

  // 2) 字段级 --<field>-json：覆盖嵌套字段
  for (const field of extractFields(schema)) {
    if (field.kind !== 'object' && field.kind !== 'object-array') continue;
    const src = opts[jsonOptKey(field.name)] as string | undefined;
    if (!src) continue;
    const value = readJsonInput(src, `--${jsonFlagName(field.name)}`);
    if (field.kind === 'object-array' && !Array.isArray(value)) {
      fatal(`--${jsonFlagName(field.name)} must contain a JSON array`);
    }
    if (
      field.kind === 'object' &&
      (typeof value !== 'object' || value === null || Array.isArray(value))
    ) {
      fatal(`--${jsonFlagName(field.name)} must contain a JSON object`);
    }
    body[field.name] = value;
  }

  // 3) 标量字段 --<field>：最高优先级
  const flat = collectValues(opts, schema);
  for (const [k, v] of Object.entries(flat)) {
    body[k] = v;
  }

  return body;
}

/** Collect option values, converting kebab-case back to camelCase and stripping undefined */
function collectValues(
  opts: Record<string, unknown>,
  schema: z.ZodTypeAny
): Record<string, unknown> {
  const fields = extractFields(schema);
  const fieldNames = new Set(fields.map((f) => f.name));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(opts)) {
    // Commander converts --customer-name to customerName automatically
    if (!fieldNames.has(key)) continue;
    if (value === undefined) continue;

    // Convert string "null" to actual null
    if (value === 'null') {
      result[key] = null;
      continue;
    }

    // Empty arrays from commander default
    if (Array.isArray(value) && value.length === 0) continue;

    result[key] = value;
  }

  return result;
}

// ── CRUD command factory ────────────────────────────────────────────

const PAGINATION_FIELDS = new Set(['page', 'pageSize', 'sortBy', 'sortOrder']);

export function registerCrudCommands(
  program: Command,
  entityName: string,
  config: EntityConfig
): void {
  const entityCmd = program.command(entityName).description(config.label);

  // ── 关联权限菜单提示 ─────────────────────────────────────────
  // 在 --help 末尾追加本命令服务的 RBAC 菜单（让 agent 一眼看到 CLI ↔ 权限映射）。
  // 不放进 .description() 以免污染 commands 列表的紧凑显示。
  const servedMenus = findMenusByCliCommand(entityName);
  if (servedMenus.length > 0) {
    const lines = ['', '对应权限菜单：'];
    for (const m of servedMenus) {
      lines.push(`  - ${m.moduleKey}.${m.menuKey}  ${m.label}`);
      if (m.cliHint) lines.push(`    提示：${m.cliHint}`);
    }
    entityCmd.addHelpText('after', lines.join('\n'));
  }

  const apiPath = `/${config.commandName}`;
  const resolveEntityPath = (id: string): string =>
    `${apiPath}/${encodeUuidPathId(id, `${config.label} id`)}`;
  // Customer 的 DELETE/claim 契约在本次 CAS 收口中升级为必填 version；registry 是
  // 自动发现配置的共享基础设施，本命令在实体专属边界显式收紧，避免改动其他实体。
  const isCustomer = entityName === 'customers';
  const deleteRequiresVersion = config.deleteRequiresVersion || isCustomer;

  /**
   * 子命令注册前的白名单守门人。
   *
   * 当 EntityConfig.supportedOperations === undefined 时全开（默认行为）；
   * 显式声明时只注册白名单内的子命令，其余跳过——避免给后端无对应路由的
   * 实体注册"调用必 404"的死命令（如 holidays 只有 list 一个标准 CRUD）。
   */
  const opAllowed = (op: 'list' | 'get' | 'create' | 'update' | 'delete'): boolean => {
    if (config.supportedOperations === undefined) return true;
    return config.supportedOperations.includes(op);
  };

  // ── list ──────────────────────────────────────────────────────
  if (opAllowed('list')) {
    const listCmd = entityCmd
      .command('list')
      .description(`List ${config.label} records`)
      .option('--page <n>', 'Page number', intArg, 1)
      .option('--page-size <n>', 'Items per page', intArg, DEFAULT_PAGE_SIZE)
      .option('--sort-by <field>', 'Sort field')
      .option('--sort-order <dir>', 'asc or desc', 'desc')
      .option('-q, --quiet', 'Output IDs only')
      .option('--all', 'Fetch all pages sequentially as NDJSON (one JSON object per line)')
      .option(
        '--output <file>',
        '(with --all) Write NDJSON to file instead of stdout; partial output preserved on failure'
      )
      .option(
        '--resume-from-page <n>',
        '(with --all) Resume from the specified page after a failed run',
        intArg
      );

    // Add entity-specific query filters
    addSchemaOptions(listCmd, config.querySchema, PAGINATION_FIELDS);

    listCmd.action(async (opts: Record<string, unknown>) => {
      const format = program.opts()['format'] as string;
      const queryFields = collectValues(opts, config.querySchema);
      for (const field of PAGINATION_FIELDS) {
        delete queryFields[field];
      }
      const sortParams: Record<string, unknown> = {};
      if (opts['sortBy']) sortParams['sortBy'] = opts['sortBy'];
      if (opts['sortOrder']) sortParams['sortOrder'] = opts['sortOrder'];
      const validatedQuery = validateWithSchema(
        config.querySchema,
        {
          page: opts['page'],
          pageSize: opts['pageSize'],
          ...queryFields,
          ...sortParams,
        },
        `${entityName} list query`
      ) as Record<string, unknown>;
      const validatedQueryFields = { ...validatedQuery };
      for (const field of PAGINATION_FIELDS) delete validatedQueryFields[field];

      // ── --all 自动翻页模式 ───────────────────────────────────────
      if (opts['all']) {
        // 冲突检测：--all 与 --page / --quiet / --format table 互斥
        if ((opts['page'] as number) !== 1) {
          fatal('--all is incompatible with --page (use --resume-from-page instead)');
        }
        if (opts['quiet']) fatal('--all is incompatible with --quiet');
        if (format === 'table') fatal('--all is incompatible with --format table');

        await runAllPages({
          apiPath,
          pageSize: validatedQuery['pageSize'] as number,
          queryParams: {
            ...validatedQueryFields,
            ...(validatedQuery['sortBy'] ? { sortBy: validatedQuery['sortBy'] } : {}),
            sortOrder: validatedQuery['sortOrder'],
          },
          output: opts['output'] as string | undefined,
          resumeFromPage: opts['resumeFromPage'] as number | undefined,
          entityName,
        });
        return;
      }

      // --resume-from-page / --output 仅在 --all 下有意义
      if (opts['output']) fatal('--output requires --all');
      if (opts['resumeFromPage']) fatal('--resume-from-page requires --all');

      // ── 标准单页模式 ───────────────────────────────────────────────
      const params: Record<string, unknown> = validatedQuery;

      const result = await request<{
        items: Record<string, unknown>[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>('GET', apiPath, undefined, params);

      if (opts['quiet']) {
        output(result.items, format, { quiet: true });
      } else {
        output(result, format, { displayName: config.displayName });
      }
    });
  } // end if opAllowed('list')

  // ── get ───────────────────────────────────────────────────────
  // 屏蔽场景：holidays 后端无 GET /:id 路由（详情走 list --year 查），
  // 历史上 CLI 无脑注册导致 `holidays get <id>` 调用必 404。
  if (opAllowed('get')) {
    entityCmd
      .command('get <id>')
      .description(`Get a single ${config.label} by ID`)
      .action(async (id: string) => {
        const format = program.opts()['format'] as string;
        const path = resolveEntityPath(id);
        const result = await request('GET', path);
        output(result, format, { displayName: config.displayName });
      });
  }

  // 只读实体到此为止：不注册 create / update / delete / restore
  if (config.readOnly) {
    return;
  }

  // ── create ────────────────────────────────────────────────────
  if (opAllowed('create')) {
    const createCmd = entityCmd
      .command('create')
      .description(`Create a new ${config.label}`)
      .option(
        '--json <path>',
        'Read full request body from a JSON file (or "-" for stdin); per-field flags override this'
      )
      .option('--dry-run', 'Print the resolved request body without sending');

    addSchemaOptions(createCmd, config.createSchema!);
    addNestedJsonOptions(createCmd, config.createSchema!);

    createCmd.action(async (opts: Record<string, unknown>) => {
      const format = program.opts()['format'] as string;
      const rawData = buildRequestBody(opts, config.createSchema!);

      if (Object.keys(rawData).length === 0) {
        fatal(
          'No fields provided. Use --json <file>, --<field>-json <file> for nested fields, or per-field --xxx options. See: azeroth describe ' +
            entityName +
            ' --action create'
        );
      }
      const data = validateWithSchema(
        config.createSchema!,
        rawData,
        `${entityName} create body`
      ) as Record<string, unknown>;

      if (opts['dryRun']) {
        printJson({ method: 'POST', path: apiPath, body: data });
        return;
      }

      const result = await request('POST', apiPath, data);
      output(result, format);
    });
  } // end if opAllowed('create')

  // ── update ────────────────────────────────────────────────────
  if (opAllowed('update')) {
    const updateCmd = entityCmd
      .command('update <id>')
      .description(`Update a ${config.label} by ID`)
      .option(
        '--json <path>',
        'Read full request body from a JSON file (or "-" for stdin); per-field flags override this'
      )
      .option('--dry-run', 'Print the resolved request body without sending');

    addSchemaOptions(updateCmd, config.updateSchema!);
    addNestedJsonOptions(updateCmd, config.updateSchema!);

    updateCmd.action(async (id: string, opts: Record<string, unknown>) => {
      const format = program.opts()['format'] as string;
      const path = resolveEntityPath(id);
      const rawData = buildRequestBody(opts, config.updateSchema!);

      if (Object.keys(rawData).length === 0) {
        fatal(
          'No fields provided. Use --json <file>, --<field>-json <file> for nested fields, or per-field --xxx options. See: azeroth describe ' +
            entityName +
            ' --action update'
        );
      }
      const data = validateWithSchema(
        config.updateSchema!,
        rawData,
        `${entityName} update body`
      ) as Record<string, unknown>;

      if (opts['dryRun']) {
        printJson({ method: config.updateMethod, path, body: data });
        return;
      }

      const result = await request(config.updateMethod, path, data);
      output(result, format);
    });
  } // end if opAllowed('update')

  // ── delete ────────────────────────────────────────────────────
  if (opAllowed('delete')) {
    const deleteCmd = entityCmd
      .command('delete <id>')
      .description(`Soft-delete a ${config.label} by ID`)
      .option('--dry-run', 'Print the resolved DELETE request without sending')
      .option('--yes', 'Confirm the destructive operation (required unless --dry-run)');

    if (deleteRequiresVersion) {
      deleteCmd.requiredOption(
        '--version <n>',
        `当前${config.label} version（必填，乐观锁，先 get <id> 读取）`
      );
    }

    deleteCmd.action(async (id: string, opts: Record<string, unknown>) => {
      const format = program.opts()['format'] as string;
      const path = resolveEntityPath(id);
      let params: Record<string, unknown> | undefined;
      if (deleteRequiresVersion) {
        const version = parseStrictInt(String(opts['version']), '--version');
        if (version < 1) {
          fatal('Invalid --version', 'Expected a positive integer (>= 1)');
        }
        params = { version };
      }

      if (opts['dryRun']) {
        printJson({
          method: 'DELETE',
          path,
          ...(params ? { query: params } : {}),
        });
        return;
      }
      if (!opts['yes']) {
        fatal('Destructive delete requires --yes', {
          command: `${entityName} delete`,
          hint: 'Use --dry-run first, then repeat with --yes',
        });
      }

      const result = await request('DELETE', path, undefined, params);
      output(result, format);
    });
  }

  // ── restore ───────────────────────────────────────────────────
  // 仅当后端 controller 真有 `POST /:id/restore` 路由时才注册（由
  // EntityConfig.supportsRestore 控制）。历史上这里无脑给所有 CRUD
  // 实体注册 restore，但 21 个实体里只有 customers/crm-products 真
  // 实现了 restore，其他 19 个调用必 404（2026-05-10 修复）。
  if (config.supportsRestore) {
    const restoreCmd = entityCmd
      .command('restore <id>')
      .description(`Restore a soft-deleted ${config.label}`)
      .option('--dry-run', 'Print the resolved restore request without sending');

    if (isCustomer) {
      restoreCmd.requiredOption(
        '--version <n>',
        `当前${config.label}回收站 version（必填，乐观锁，先 trash 读取）`
      );
    }

    restoreCmd.action(async (id: string, opts: Record<string, unknown>) => {
      const format = program.opts()['format'] as string;
      const path = `${resolveEntityPath(id)}/restore`;
      let body: Record<string, unknown> | undefined;
      if (isCustomer) {
        const version = parseStrictInt(String(opts['version']), '--version');
        if (version < 1) {
          fatal('Invalid --version', 'Expected a positive integer (>= 1)');
        }
        body = { version };
      }
      if (opts['dryRun']) {
        printJson({ method: 'POST', path, ...(body ? { body } : {}) });
        return;
      }
      const result = await request('POST', path, body);
      output(result, format);
    });
  }

  // ── submit-approval ───────────────────────────────────────────
  // 仅 sale-orders / payments / invoices / visit-records 4 个实体支持。
  // formCode / title / eventType 由后端 BusinessApprovalService 自动派发，
  // CLI 仅需传业务单 id。配置驱动：前端建/删 ApprovalFlow → 调用结果由
  // server 实时反映（无 active flow 时 server 抛"未配置该类型的审批流程"）。
  if (config.supportsSubmitApproval) {
    entityCmd
      .command('submit-approval <id>')
      .description(`提交 ${config.label} 进入审批流程`)
      .action(async (id: string) => {
        const format = program.opts()['format'] as string;
        const path = `${resolveEntityPath(id)}/submit-approval`;
        const result = await request('POST', path);
        output(result, format);
      });
  }

  // ── claim ─────────────────────────────────────────────────────
  // 仅 customers 支持。认领是 Customer 写操作，必须携带读取到的当前 version。
  if (config.supportsClaim) {
    entityCmd
      .command('claim <id>')
      .description(`认领公海 ${config.label}`)
      .requiredOption('--version <n>', `当前${config.label} version（必填，先 get <id> 读取）`)
      .option('--dry-run', 'Print the resolved claim request without sending')
      .action(async (id: string, opts: { version: string; dryRun?: boolean }) => {
        const format = program.opts()['format'] as string;
        const path = `${resolveEntityPath(id)}/claim`;
        const version = parseStrictInt(opts.version, '--version');
        if (version < 1) {
          fatal('Invalid --version', 'Expected a positive integer (>= 1)');
        }
        const body = { version };
        if (opts.dryRun) {
          printJson({ method: 'POST', path, body });
          return;
        }
        const result = await request('POST', path, body);
        output(result, format);
      });
  }

  // ── change-request ────────────────────────────────────────────
  // 仅 sale-orders / payments / invoices / visit-records 4 个实体支持。
  // 后端 `POST /:id/change-request` body 复用各模块自己的 UpdateXxxDto
  // （与 update 同字段，但走 BusinessApprovalService.submitChangeApproval
  // 进审批流而非立即生效）。CLI 直接传 --json body，由 server 兜校验
  // —— 避免在 CLI 重复 import 每个实体的 update schema 造成耦合。
  if (config.supportsChangeRequest) {
    entityCmd
      .command('change-request <id>')
      .description(`提交 ${config.label} 变更走审批流（body 复用 update 字段）`)
      .option('--json <path>', 'body JSON 路径（或 "-" 走 stdin），形态与 update 相同')
      .option('--dry-run', '只打印请求体，不发请求')
      .action(async (id: string, opts: { json?: string; dryRun?: boolean }) => {
        const format = program.opts()['format'] as string;
        const path = `${resolveEntityPath(id)}/change-request`;
        if (!opts.json) {
          fatal(
            'Missing --json',
            'Pass a JSON file path (or "-" for stdin). body 字段与该实体 update 相同'
          );
        }
        const parsed = readJsonInput(opts.json!, '--json');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          fatal('--json input must be a JSON object at the top level');
        }
        const body = validateWithSchema(
          config.updateSchema!,
          parsed,
          `${entityName} change-request body`
        ) as Record<string, unknown>;

        if (opts.dryRun) {
          printJson({
            method: 'POST',
            path,
            body,
          });
          return;
        }

        const result = await request('POST', path, body);
        output(result, format);
      });
  }
}
