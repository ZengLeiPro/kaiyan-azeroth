-- 合同订单纠错作废使用独立审批事件，避免继续混入普通订单变更审批。
-- 生产已有 sale_order_change 流程时，复制其最新启用版本与全部节点；
-- 空库由 seed 创建默认流程，因此找不到源流程时安全跳过。
DO $$
DECLARE
  source_flow public.approval_flows%ROWTYPE;
  new_flow_id TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.approval_flows
    WHERE "eventType" = 'sale_order_void'
      AND status <> 'deleted'
      AND "deletedAt" IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT *
  INTO source_flow
  FROM public.approval_flows
  WHERE "eventType" = 'sale_order_change'
    AND status = 'active'
    AND "deletedAt" IS NULL
  ORDER BY version DESC, "createdAt" DESC
  LIMIT 1;

  IF source_flow.id IS NULL THEN
    RETURN;
  END IF;

  new_flow_id := gen_random_uuid()::TEXT;

  INSERT INTO public.approval_flows (
    id,
    "groupId",
    code,
    name,
    "eventType",
    description,
    version,
    status,
    "copyToIds",
    "createdAt",
    "creatorEmployeeId",
    "updatedAt",
    "updaterEmployeeId",
    "deletedAt"
  )
  VALUES (
    new_flow_id,
    'sale_order_void_' || LEFT(REPLACE(new_flow_id, '-', ''), 8),
    'SALE_ORDER_VOID_V1',
    '合同订单纠错作废审批',
    'sale_order_void',
    '从合同订单变更审批复制；用于原子撤销误建订单及其可安全撤销的关联记录',
    1,
    'active',
    source_flow."copyToIds",
    NOW(),
    source_flow."creatorEmployeeId",
    NOW(),
    source_flow."updaterEmployeeId",
    NULL
  );

  INSERT INTO public.approval_flow_nodes (
    id,
    "flowId",
    "nodeOrder",
    "nodeName",
    "approverType",
    "approverUserIds",
    "approverRoleId",
    "managerLevel",
    "multiType",
    "timeoutHours",
    "createdAt",
    "creatorEmployeeId",
    "updatedAt",
    "updaterEmployeeId",
    "deletedAt",
    version
  )
  SELECT
    gen_random_uuid()::TEXT,
    new_flow_id,
    node."nodeOrder",
    node."nodeName",
    node."approverType",
    node."approverUserIds",
    node."approverRoleId",
    node."managerLevel",
    node."multiType",
    node."timeoutHours",
    NOW(),
    node."creatorEmployeeId",
    NOW(),
    node."updaterEmployeeId",
    NULL,
    1
  FROM public.approval_flow_nodes AS node
  WHERE node."flowId" = source_flow.id
    AND node."deletedAt" IS NULL
  ORDER BY node."nodeOrder";
END $$;
