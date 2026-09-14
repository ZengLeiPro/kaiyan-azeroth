import {
  buildDateFilter,
  buildForeignKeyFilter,
  defineFilterRegistry,
} from '../../common/filter-scheme';

/**
 * 工时统计页 (projects.effort_stats) 的筛选方案。
 *
 * 与 effort-records 列表页 filter-scheme 解耦的原因：
 * 1. stats endpoint (`GET /effort-records/stats`) 仍然接受扁平 query params
 *    (`startDate`/`endDate`/`ownerId[]`/`projectId[]`),不解析 list endpoint 的
 *    `filters[xxx][operator]` 嵌套语法。
 * 2. stats 仅需 3 个过滤维度,且日期是业务必填(默认本周,前端 UI 强约束)。
 *    复用 effort-records scheme 会把 recordType/workType/createdAt 等不相关字段
 *    暴露给 stats 页 admin 配置,语义混乱。
 *
 * 因此本 registry 只用于驱动前端 CrudFilterBar 的 UI 渲染(从服务端拉字段元数据 +
 * options + 控件类型),后端 stats endpoint 不消费本 scheme 的 build 函数 ——
 * 前端 transformParams 会把 `filters[workDate][from/to]` / `filters[ownerId][]` /
 * `filters[projectId][]` 转回 stats endpoint 期望的扁平参数。
 *
 * build 函数仍保留(buildDateFilter/buildForeignKeyFilter)以保持 registry 类型完整,
 * 后续若 stats endpoint 想统一改吃 filters[] 语法可直接复用,无需重写 registry。
 */

const EFFORT_STATS_PAGE_KEY = 'projects.effort_stats';

export const EFFORT_STATS_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: EFFORT_STATS_PAGE_KEY,
  pageName: '工时统计',
  fields: {
    workDate: {
      label: '日期范围',
      dataType: 'date',
      // stats 业务上日期是必填(service 依赖 startDate/endDate 计算工作日天数),
      // 前端默认填充本周一到今天;此处 allowedControls 与 effort-records 对齐,
      // 允许 admin 在配置页切到单日 control(虽不推荐)。
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('workDate', value, { nullFallbackField: 'startDate' }),
    },
    ownerId: {
      label: '记录人',
      dataType: 'foreignKey',
      entity: 'employee',
      // 与 effort-records 一致:工时的 DataScope 走 ownerId。
      // stats endpoint 自身已在 controller 层做 DataScope intersect,
      // 此处标记主要为 UI 一致(选择器禁用态/提示语)与未来 list 化预留。
      isScopeField: true,
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('ownerId', value),
    },
    projectId: {
      label: '项目',
      dataType: 'foreignKey',
      entity: 'project',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('projectId', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'workDate', control: 'dateRange' },
      { fieldKey: 'ownerId', control: 'entityMultiSelect' },
      { fieldKey: 'projectId', control: 'entityMultiSelect' },
    ],
    keyword: {
      enabled: false,
      fieldKeys: [],
      placeholder: null,
    },
  },
});
