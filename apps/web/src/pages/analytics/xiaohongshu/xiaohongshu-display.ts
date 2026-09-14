const FIELD_LABELS: Readonly<Record<string, string>> = {
  _ky_id: '系统记录标识',
  _ky_stat_date: '系统统计日期',
  _ky_entity_name: '系统对象名称',
  _ky_fee: '系统消费金额',
  _ky_impression: '系统曝光量',
  _ky_click: '系统点击量',
  _ky_interaction: '系统互动量',
  _ky_message_consult: '系统私信咨询量',
  _ky_message_lead: '系统私信留资量',
  account_id: '账户标识（ID）',
  advertiser_id: '广告主标识（ID）',
  advertiser_name: '广告主名称',
  campaign_group_ids: '广告组标识列表（ID）',
  campaign_id: '计划标识（ID）',
  campaign_name: '计划名称',
  unit_id: '单元标识（ID）',
  unit_name: '单元名称',
  creativity_id: '创意标识（ID）',
  creativity_name: '创意名称',
  creative_id: '创意标识（ID）',
  creative_name: '创意名称',
  note_id: '笔记标识（ID）',
  note_ids: '笔记标识列表（ID）',
  note_title: '笔记标题',
  note_image: '笔记封面',
  note_jump_url: '笔记原文链接',
  temporary_note_id: '临时笔记标识（ID）',
  author_id: '作者标识（ID）',
  author_name: '作者名称',
  keyword_id: '关键词标识（ID）',
  keyword: '关键词',
  keywords: '关键词列表',
  search_word: '搜索词',
  spu_id: '标准化产品单元标识（SPU ID）',
  spu_name: '标准化产品单元名称（SPU）',
  taxonomy_id: '类目标识（ID）',
  target_config: '定向配置',
  sub_account_ids: '子账户标识列表（ID）',
  transaction_id: '交易流水标识（ID）',
  time: '日期',
  statDate: '日期',
  stat_date: '日期',
  start_date: '开始日期',
  end_date: '结束日期',
  create_time: '创建时间',
  update_time: '更新时间',
  created_at: '创建时间',
  updated_at: '更新时间',
  status: '状态',
  audit_status: '审核状态',
  audit_reason: '审核原因',
  reason: '原因',
  type: '对象类型',
  name: '对象名称',
  title: '标题',
  desc: '正文',
  description: '说明',
  settings: '配置详情',
  marketing_target: '营销目标',
  daily_budget: '每日预算',
  bid: '出价',
  budget: '预算',
  balance: '余额',
  amount: '金额',
  fee: '消费金额',
  cost: '成本',
  price: '价格',
  impression: '曝光量',
  click: '点击量',
  ctr: '点击率',
  acp: '平均点击成本',
  cpc: '平均点击成本',
  cpm: '千次曝光成本',
  interaction: '互动量',
  interaction_rate: '互动率',
  like: '点赞量',
  like_rate: '点赞率',
  collect: '收藏量',
  collect_rate: '收藏率',
  comment: '评论量',
  comment_rate: '评论率',
  follow: '关注量',
  follow_rate: '关注率',
  share: '分享量',
  share_rate: '分享率',
  read_count: '阅读量',
  read_rate: '阅读率',
  interact_count: '自然互动量',
  interact_rate: '自然互动率',
  video_play: '视频播放量',
  video_play_3s: '三秒播放量',
  video_play_5s: '五秒播放量',
  video_play_10s: '十秒播放量',
  video_complete_play: '完整播放量',
  video_play_rate: '视频播放率',
  video_complete_play_rate: '完整播放率',
  landing_page_visit: '落地页访问量',
  landing_page_pv: '落地页浏览量（PV）',
  landing_page_visit_rate: '落地页访问率',
  leads_button_impression: '表单曝光量',
  landing_form_imp_num: '表单曝光量',
  form_impression_rate: '表单曝光率',
  leads: '表单提交量',
  valid_leads: '有效表单量',
  form_submit_rate: '表单提交率',
  form_submit_cost: '表单提交成本',
  valid_form_submit_rate: '有效表单率',
  valid_form_submit_cost: '有效表单成本',
  message_user: '私信用户量',
  message_consult: '私信咨询量',
  message_consult_rate: '私信咨询率',
  message_consult_cost: '私信咨询成本',
  initiative_message: '私信开口量',
  message_open_rate: '私信开口率',
  msg_leads_num: '私信留资量',
  message_lead_rate: '私信留资率',
  message_lead_cost: '私信留资成本',
  product_click: '商品点击量',
  add_cart: '加购量',
  order_num: '订单量',
  order_amount: '成交金额',
  gmv: '商品交易总额（GMV）',
  content_type: '内容类型',
  note_type: '笔记类型',
  image: '图片',
  image_list: '图片列表',
  note_url: '笔记链接',
  unsupported_columns: '不支持的指标字段',
  aggregation_data: '官方汇总数据',
  total_data: '汇总数据',
  total: '记录总数',
  total_count: '记录总数',
  page: '页码信息',
  page_num: '页码',
  page_index: '页码',
  page_size: '每页数量',
  pagination: '分页信息',
  request_id: '请求标识',
  data_caliber: '数据统计口径',
  seed: '种子词或种子对象',
};

const TOKEN_LABELS: Readonly<Record<string, string>> = {
  account: '账户',
  advertiser: '广告主',
  campaign: '计划',
  unit: '单元',
  creative: '创意',
  creativity: '创意',
  group: '组',
  note: '笔记',
  keyword: '关键词',
  search: '搜索',
  word: '词',
  spu: '标准化产品单元',
  author: '作者',
  target: '定向',
  taxonomy: '类目',
  category: '类目',
  product: '商品',
  material: '素材',
  content: '内容',
  item: '项目',
  id: '标识',
  ids: '标识列表',
  name: '名称',
  title: '标题',
  desc: '正文',
  description: '说明',
  status: '状态',
  audit: '审核',
  reason: '原因',
  type: '类型',
  config: '配置',
  setting: '配置',
  settings: '配置详情',
  time: '时间',
  date: '日期',
  start: '开始',
  end: '结束',
  create: '创建',
  created: '创建',
  update: '更新',
  updated: '更新',
  fee: '消费金额',
  cost: '成本',
  amount: '金额',
  price: '价格',
  budget: '预算',
  balance: '余额',
  impression: '曝光量',
  click: '点击量',
  rate: '率',
  count: '数量',
  num: '数量',
  total: '总计',
  interaction: '互动',
  interact: '互动',
  message: '私信',
  consult: '咨询',
  lead: '留资',
  leads: '线索',
  form: '表单',
  submit: '提交',
  valid: '有效',
  landing: '落地页',
  page: '页面',
  unsupported: '不支持的',
  columns: '指标字段',
  field: '字段',
  fields: '字段列表',
  list: '列表',
  data: '数据',
  raw: '原始',
  meta: '元数据',
  metadata: '元数据',
  source: '来源',
  role: '角色',
  scope: '授权范围',
  system: '系统',
  deep: '深度',
  conversion: '转化',
  current: '当前',
  previous: '上一周期',
};

const VALUE_LABELS: Readonly<Record<string, string>> = {
  active: '已启用',
  inactive: '未启用',
  enabled: '已启用',
  disabled: '已停用',
  online: '投放中',
  offline: '已下线',
  paused: '已暂停',
  pending: '待处理',
  processing: '处理中',
  approved: '审核通过',
  rejected: '审核驳回',
  success: '成功',
  failed: '失败',
  draft: '草稿',
  deleted: '已删除',
  automatic: '自动',
  manual: '手动',
  account: '账户',
  campaign: '计划',
  unit: '单元',
  creative: '创意',
  creativity: '创意',
  note: '笔记',
  search: '搜索',
  feed: '信息流',
  image: '图文',
  video: '视频',
  ios: '苹果移动系统（iOS）',
  android: '安卓系统（Android）',
  all: '全部',
};

const HAS_CHINESE = /[\u3400-\u9fff]/;
const TECHNICAL_FIELD = /(status|type|platform|source|role|mode|action|level)$/i;
const FIELD_NAME_COLLECTION = /(columns|fields|keys)$/i;

function splitFieldKey(key: string): string[] {
  return key
    .replace(/^_ky_/, 'system_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_./:-]+/)
    .filter(Boolean);
}

function normalizeProvidedLabel(label: string): string {
  return label
    .replace(/\bAIGC\b/g, '人工智能生成内容（AIGC）')
    .replace(/\bSPU\b/g, '标准化产品单元（SPU）')
    .replace(/\bID\b/g, '标识（ID）')
    .replace(/\s+标识/g, '标识');
}

export function getXiaohongshuFieldLabel(key: string, providedLabel?: string): string {
  const exact = FIELD_LABELS[key];
  if (exact) return exact;

  if (providedLabel && HAS_CHINESE.test(providedLabel) && !providedLabel.startsWith('其他字段（')) {
    return normalizeProvidedLabel(providedLabel);
  }

  const translated = splitFieldKey(key).map((token) => TOKEN_LABELS[token]);
  if (translated.length > 0 && translated.every(Boolean)) return translated.join('');
  return `其他字段（${key}）`;
}

function localizeStructuredValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string' && key && FIELD_NAME_COLLECTION.test(key)) {
        return getXiaohongshuFieldLabel(item);
      }
      return localizeStructuredValue(item);
    });
  }
  if (value && typeof value === 'object') {
    const localized: Record<string, unknown> = {};
    for (const [itemKey, item] of Object.entries(value)) {
      const baseLabel = getXiaohongshuFieldLabel(itemKey);
      const label = Object.hasOwn(localized, baseLabel) ? `${baseLabel}（${itemKey}）` : baseLabel;
      localized[label] = localizeStructuredValue(item, itemKey);
    }
    return localized;
  }
  if (typeof value === 'string') {
    const translated = VALUE_LABELS[value.trim().toLowerCase()];
    if (translated) return translated;
    if (key && TECHNICAL_FIELD.test(key) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
      return `代码值（${value}）`;
    }
  }
  return value;
}

export function formatXiaohongshuDisplayValue(value: unknown, key?: string): string {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return value.toLocaleString('zh-CN');
  const localized = localizeStructuredValue(value, key);
  return typeof localized === 'object' ? JSON.stringify(localized) : String(localized);
}
