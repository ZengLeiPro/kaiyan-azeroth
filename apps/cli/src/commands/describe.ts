import { findMenusByCliCommand, getCliCommandForMenu, MODULES } from '@ky-azeroth/shared';
import { Command } from 'commander';

import { discoverEntities } from '../registry.js';
import { extractFields, fatal, type FieldInfo, printJson } from '../utils.js';

/**
 * 把 FieldInfo 序列化为 describe 输出。
 *  - 对嵌套字段（object / object-array）递归展开 nested 子字段，
 *    使用者一眼就能看到 products.quantity 这种结构。
 *  - 嵌套字段额外提示 cliFlag，明确该字段只能用 `--xxx-json` 传。
 */
function serializeField(f: FieldInfo): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: f.name,
    type: f.type,
    required: f.required,
    kind: f.kind,
  };
  if (f.kind === 'object' || f.kind === 'object-array') {
    base['cliFlag'] =
      `--${f.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}-json <path>`;
  }
  if (f.nested && f.nested.length > 0) {
    base['nested'] = f.nested.map(serializeField);
  }
  return base;
}

export function registerDescribeCommand(program: Command): void {
  program
    .command('describe [entity]')
    .description('Show schema fields for an entity, or look up CLI command by permission menu key')
    .option('-a, --action <action>', 'Which schema: create | update | query | response', 'create')
    .option(
      '-m, --menu <key>',
      '按权限菜单 key 反查 CLI 命令（格式：module.menu，如 system.user_account / reports.telesales_dailies）'
    )
    .action((entityName: string | undefined, opts: { action: string; menu?: string }) => {
      // ── --menu 反查分支 ──────────────────────────────────────
      // agent 拿到一个权限菜单 key 想知道用哪个 CLI 命令时的入口。
      // 与 entity 不同，这里查的是 MODULES（业务菜单），不是 schema 实体。
      if (opts.menu) {
        const [moduleKey, ...rest] = opts.menu.split('.');
        const menuKey = rest.join('.');
        if (!moduleKey || !menuKey) {
          fatal(
            `--menu 参数格式错误：应为 module.menu（如 system.user_account），收到 ${opts.menu}`
          );
        }
        const module = MODULES[moduleKey];
        if (!module) {
          fatal(`未知模块：${moduleKey}`, { availableModules: Object.keys(MODULES) });
        }
        const menu = module.menus[menuKey];
        if (!menu) {
          fatal(`模块 ${moduleKey} 下未知菜单：${menuKey}`, {
            availableMenus: Object.keys(module.menus),
          });
        }
        const cliCommand = getCliCommandForMenu(moduleKey, menuKey);
        printJson({
          menu: opts.menu,
          label: menu.label,
          cliCommand: cliCommand ?? null,
          cliHint: menu.cliHint ?? null,
          note: cliCommand === null
              ? '该菜单为看板/聚合类，无独立 CLI 命令。如需拉数请走 ky-data-query skill 或后端报表路由。'
              : cliCommand === undefined
                ? '菜单存在但 cliCommand 未声明（应为代码 bug，请检查 packages/shared/src/constants/modules.ts）'
                : `运行 azeroth ${cliCommand} --help 查看子命令`,
        });
        return;
      }

      // ── 标准 entity 描述分支 ──────────────────────────────────
      if (!entityName) {
        fatal('必须传 <entity> 参数或 --menu <module.menu>');
      }

      const entities = discoverEntities();
      const entity = entities.get(entityName);

      if (!entity) {
        const available = [...entities.keys()].sort().join(', ');
        fatal(`Unknown entity: ${entityName}`, { available });
      }

      const schemaMap: Record<string, { schema: unknown; label: string }> = {
        create: { schema: entity.createSchema, label: 'Create' },
        update: { schema: entity.updateSchema, label: 'Update' },
        query: { schema: entity.querySchema, label: 'Query' },
        response: { schema: entity.responseSchema, label: 'Response' },
      };

      const target = schemaMap[opts.action];
      if (!target?.schema) {
        fatal(`No ${opts.action} schema for ${entityName}`);
      }

      const fields = extractFields(target.schema as Parameters<typeof extractFields>[0]);

      // 反查本命令服务的权限菜单（用于让 agent 一眼看到与 RBAC 的对应关系）
      const servedMenus = findMenusByCliCommand(entityName);

      printJson({
        entity: entityName,
        label: entity.label,
        action: opts.action,
        servedMenus: servedMenus.length > 0 ? servedMenus : undefined,
        fields: fields.map(serializeField),
      });
    });
}
