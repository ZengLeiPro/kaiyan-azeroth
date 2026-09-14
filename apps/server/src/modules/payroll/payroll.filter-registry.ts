import {
  buildForeignKeyFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

export const PAYROLL_PAGE_KEY = 'finance.payroll';

const HAS_REMARK_LABELS = { true: '有备注', false: '无备注' };

function buildPeriodFilter(value: Parameters<typeof buildStringFilter>[1]) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return { payrollPeriod: { periodKey: value } };
}

function buildPositionFilter(value: Parameters<typeof buildStringFilter>[1]) {
  return buildStringFilter('positionSnapshot', value);
}

function buildHasRemarkFilter(value: Parameters<typeof buildStringFilter>[1]) {
  const selected = Array.isArray(value) ? value[0] : value;
  if (selected === 'true') return { remarkSnapshot: { not: null } };
  if (selected === 'false') return { remarkSnapshot: null };
  return null;
}

export const PAYROLL_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: PAYROLL_PAGE_KEY,
  pageName: '薪资记录',
  fields: {
    periodKey: {
      label: '期间',
      dataType: 'string',
      allowedControls: ['text'],
      build: buildPeriodFilter,
    },
    employeeId: {
      label: '员工',
      dataType: 'foreignKey',
      entity: 'employee',
      allowedControls: ['entitySelect'],
      build: (value) => buildForeignKeyFilter('employeeId', value),
    },
    departmentId: {
      label: '部门',
      dataType: 'foreignKey',
      entity: 'department',
      allowedControls: ['entitySelect'],
      build: (value) => buildForeignKeyFilter('departmentId', value),
    },
    position: {
      label: '职位',
      dataType: 'string',
      allowedControls: ['text'],
      build: buildPositionFilter,
    },
    hasRemark: {
      label: '备注',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(HAS_REMARK_LABELS),
      build: buildHasRemarkFilter,
    },
    employeeName: {
      label: '员工姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('employeeNameSnapshot', value),
    },
    departmentName: {
      label: '部门名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('departmentNameSnapshot', value),
    },
    bankCardNo: {
      label: '银行卡号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('bankCardNoSnapshot', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'periodKey', control: 'text' },
      { fieldKey: 'employeeId', control: 'entitySelect' },
      { fieldKey: 'departmentId', control: 'entitySelect' },
      { fieldKey: 'position', control: 'text' },
      { fieldKey: 'hasRemark', control: 'select' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['employeeName', 'departmentName', 'bankCardNo'],
      placeholder: '员工/部门/银行卡号',
    },
  },
});
