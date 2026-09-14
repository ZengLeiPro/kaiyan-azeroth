-- 销售数据闭环：为 crm.sales_action_items 新菜单授权（销售数据闭环系统 块1）
--
-- 背景（勘察 01 §7 最大坑）：新菜单的 role_permissions 行只能靠 seed 写，而生产禁 seed。
-- 后果：非 ADMIN 用户对 @RequirePermission({menu:'sales_action_items'}) 接口一律 403。
-- ADMIN 走 guard 快路径自动放行，无需授权行。
-- 故：用本独立的幂等权限 migration 给销售相关角色补 sales_action_items 权限（Codex A7 硬要求）。
--
-- Codex 硬约束落地：
--   1) 按 role code 查角色、不写死 roleId（角色 id 在各环境不同）；
--   2) count > 1（同 code 多条活跃角色）→ RAISE EXCEPTION 整体回滚；
--   3) 全程在单事务内（Prisma migrate deploy 单文件单事务）+ DO 块；
--   4) 插入后断言影响行数（NOTICE 打印每角色实际写入条数）；
--   5) 幂等：ON CONFLICT (roleId,module,menu) DO NOTHING（重跑不重复写、不报错）。
--
-- 本地空库兼容：本地 docker 库无 roles 数据（禁 db:seed）→ 角色不存在则 RAISE NOTICE 跳过、绝不 abort；
-- 生产有 roles 数据时正常按 code 命中并写入。两种环境同一份 SQL。
--
-- 授权矩阵（逐一镜像各角色现有 CRM 菜单权限，保持新菜单与其它 CRM 菜单一致）：
--   CRM_MANAGER : view+create+edit+delete, viewScope=ALL   （林审批/中台，看全员待办+采纳率）
--   SALES       : view+create+edit,        viewScope=SELF  （销售本人处置自己的待办）
--   PM          : view,                     viewScope=SELF
--   VIEWER      : view,                     viewScope=SELF
-- ADMIN 不在此列（guard 硬编码放行）。

DO $$
DECLARE
  v_role_id  TEXT;
  v_count    INTEGER;
  v_inserted INTEGER;
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('CRM_MANAGER', TRUE,  TRUE,  TRUE,  TRUE,  'ALL'),
      ('SALES',       TRUE,  TRUE,  TRUE,  FALSE, 'SELF'),
      ('PM',          TRUE,  FALSE, FALSE, FALSE, 'SELF'),
      ('VIEWER',      TRUE,  FALSE, FALSE, FALSE, 'SELF')
    ) AS t(code, v_view, v_create, v_edit, v_delete, v_scope)
  LOOP
    -- 按 code 查活跃角色数（软删过滤）
    SELECT COUNT(*) INTO v_count
    FROM "roles"
    WHERE "code" = r.code AND "deletedAt" IS NULL;

    IF v_count = 0 THEN
      -- 本地空库/该环境无此角色：跳过不 abort
      RAISE NOTICE '[sales_action_items perm] 角色 % 不存在（count=0），跳过（本地空库属正常）。', r.code;
      CONTINUE;
    ELSIF v_count > 1 THEN
      -- 同 code 多条活跃角色：数据异常，整体回滚（Codex 硬要求）
      RAISE EXCEPTION '[sales_action_items perm] 角色 % 命中 % 条活跃记录（应为 1），中止迁移以防错配权限。', r.code, v_count;
    END IF;

    SELECT "id" INTO v_role_id
    FROM "roles"
    WHERE "code" = r.code AND "deletedAt" IS NULL
    LIMIT 1;

    -- 幂等插入：已存在则 DO NOTHING（重跑安全）
    INSERT INTO "role_permissions"
      ("id", "roleId", "module", "menu", "view", "create", "edit", "delete", "export", "approve", "viewScope", "createdAt")
    VALUES
      (gen_random_uuid()::text, v_role_id, 'crm', 'sales_action_items',
       r.v_view, r.v_create, r.v_edit, r.v_delete, FALSE, FALSE, r.v_scope, CURRENT_TIMESTAMP)
    ON CONFLICT ("roleId", "module", "menu") DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RAISE NOTICE '[sales_action_items perm] 角色 %（id=%）写入 % 条（0=已存在幂等跳过）。', r.code, v_role_id, v_inserted;
  END LOOP;

  RAISE NOTICE '[sales_action_items perm] 权限迁移完成。';
END $$;
