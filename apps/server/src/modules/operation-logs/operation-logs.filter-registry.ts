import {
  buildDateFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterFieldBuildValue,
  type FilterOption,
} from '../../common/filter-scheme';

const MODULE_LABELS: Record<string, string> = {
  customers: '客户管理',
  contacts: '联系人',
  opportunities: '商机',
  'sale-orders': '合同订单',
  payments: '回款管理',
  invoices: '开票管理',
  'keep-records': '跟进记录',
  'visit-records': '拜访签到',
  'crm-products': '产品管理',
  'purchase-orders': '采购订单',
  'purchase-inbound': '采购入库',
  'purchase-return': '采购退货',
  stores: '门店档案',
  warehouses: '仓库档案',
  products: '产品信息',
  suppliers: '供应商档案',
  employees: '员工档案',
  bom: '产品配方',
  'production-plans': '生产排产',
  'fixed-assets': '固定资产',
  users: '用户管理',
  roles: '角色权限',
  settings: '系统参数',
};

const ACTION_LABELS: Record<string, string> = {
  create: '新建',
  update: '修改',
  delete: '删除',
  approve: '审批通过',
  reject: '审批驳回',
  submit: '提交审批',
  claim: '认领',
  restore: '恢复',
  'red-void': '冲红',
  'submit-approval': '提交审批',
  'submit-refund': '提交退款审批',
  'batch-transfer': '批量转交',
  'batch-update': '批量编辑',
  'batch-delete': '批量删除',
  'batch-add-collab': '批量加协作人',
  'batch-remove-collab': '批量移除协作人',
  'permanent-delete': '永久删除',
};

const toOptions = (labels: Record<string, string>): FilterOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

function buildOperatorFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  const username = buildStringFilter('username', value)?.username;
  if (!username) return null;
  return { employee: { OR: [{ username }, { name: username }] } };
}

export const OPERATION_LOG_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: 'system.operation_logs',
  pageName: '操作日志',
  fields: {
    module: {
      label: '模块',
      dataType: 'enum',
      allowedControls: ['multiSelect', 'select'],
      optionsSource: () => toOptions(MODULE_LABELS),
      build: (value) => buildEnumFilter('module', new Set(Object.keys(MODULE_LABELS)), value),
    },
    action: {
      label: '操作类型',
      dataType: 'enum',
      allowedControls: ['multiSelect', 'select'],
      optionsSource: () => toOptions(ACTION_LABELS),
      build: (value) => buildEnumFilter('action', new Set(Object.keys(ACTION_LABELS)), value),
    },
    operator: {
      label: '操作人',
      dataType: 'string',
      allowedControls: ['text'],
      build: buildOperatorFilter,
    },
    createdAt: {
      label: '日期范围',
      dataType: 'date',
      allowedControls: ['dateRange', 'date'],
      build: (value) => buildDateFilter('createdAt', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'module', control: 'multiSelect' },
      { fieldKey: 'action', control: 'multiSelect' },
      { fieldKey: 'operator', control: 'text' },
      { fieldKey: 'createdAt', control: 'dateRange' },
    ],
    keyword: { enabled: false, fieldKeys: [] },
  },
});

export const LOGIN_LOG_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: 'system.login_logs',
  pageName: '登录日志',
  fields: {
    username: {
      label: '用户名',
      dataType: 'string',
      allowedControls: ['text'],
      build: (value) => buildStringFilter('username', value),
    },
    actionType: {
      label: '操作类型',
      dataType: 'enum',
      allowedControls: ['multiSelect', 'select'],
      optionsSource: () => [
        { value: 'login', label: '登录' },
        { value: 'logout', label: '登出' },
      ],
      build: (value) => buildEnumFilter('actionType', new Set(['login', 'logout']), value),
    },
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['multiSelect', 'select'],
      optionsSource: () => [
        { value: 'success', label: '成功' },
        { value: 'fail', label: '失败' },
      ],
      build: (value) => buildEnumFilter('status', new Set(['success', 'fail']), value),
    },
    createdAt: {
      label: '日期',
      dataType: 'date',
      allowedControls: ['dateRange', 'date'],
      build: (value) => buildDateFilter('createdAt', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'username', control: 'text' },
      { fieldKey: 'actionType', control: 'multiSelect' },
      { fieldKey: 'status', control: 'multiSelect' },
      { fieldKey: 'createdAt', control: 'dateRange' },
    ],
    keyword: { enabled: false, fieldKeys: [] },
  },
});
