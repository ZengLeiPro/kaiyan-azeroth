/**
 * 国家列表常量（用于客户/联系人地址国别选择）
 *
 * - `code`: ISO 3166-1 alpha-2 国家代码（仅供前端搜索/排序，数据库不存）
 * - `name`: 中文显示名，**作为数据库存储的实际值**（保持与历史数据 "中国" 兼容）
 *
 * 中国默认置顶，其余按地理大区分组、组内按常见度排序，保证选择体验。
 * 港澳台不单列：选中"中国"时省份级联里已包含「香港特别行政区/澳门特别行政区/台湾省」。
 */
export interface Country {
  code: string;
  name: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'CN', name: '中国' },
  // 东亚
  { code: 'JP', name: '日本' },
  { code: 'KR', name: '韩国' },
  { code: 'MN', name: '蒙古' },
  { code: 'KP', name: '朝鲜' },
  // 东南亚
  { code: 'SG', name: '新加坡' },
  { code: 'MY', name: '马来西亚' },
  { code: 'TH', name: '泰国' },
  { code: 'VN', name: '越南' },
  { code: 'PH', name: '菲律宾' },
  { code: 'ID', name: '印度尼西亚' },
  { code: 'KH', name: '柬埔寨' },
  { code: 'LA', name: '老挝' },
  { code: 'MM', name: '缅甸' },
  { code: 'BN', name: '文莱' },
  // 南亚
  { code: 'IN', name: '印度' },
  { code: 'PK', name: '巴基斯坦' },
  { code: 'BD', name: '孟加拉国' },
  { code: 'LK', name: '斯里兰卡' },
  { code: 'NP', name: '尼泊尔' },
  // 中亚与西亚
  { code: 'KZ', name: '哈萨克斯坦' },
  { code: 'UZ', name: '乌兹别克斯坦' },
  { code: 'AE', name: '阿联酋' },
  { code: 'SA', name: '沙特阿拉伯' },
  { code: 'IL', name: '以色列' },
  { code: 'TR', name: '土耳其' },
  { code: 'IR', name: '伊朗' },
  { code: 'QA', name: '卡塔尔' },
  // 北美
  { code: 'US', name: '美国' },
  { code: 'CA', name: '加拿大' },
  { code: 'MX', name: '墨西哥' },
  // 南美
  { code: 'BR', name: '巴西' },
  { code: 'AR', name: '阿根廷' },
  { code: 'CL', name: '智利' },
  { code: 'CO', name: '哥伦比亚' },
  { code: 'PE', name: '秘鲁' },
  // 欧洲
  { code: 'GB', name: '英国' },
  { code: 'FR', name: '法国' },
  { code: 'DE', name: '德国' },
  { code: 'IT', name: '意大利' },
  { code: 'ES', name: '西班牙' },
  { code: 'PT', name: '葡萄牙' },
  { code: 'NL', name: '荷兰' },
  { code: 'BE', name: '比利时' },
  { code: 'CH', name: '瑞士' },
  { code: 'AT', name: '奥地利' },
  { code: 'SE', name: '瑞典' },
  { code: 'NO', name: '挪威' },
  { code: 'DK', name: '丹麦' },
  { code: 'FI', name: '芬兰' },
  { code: 'PL', name: '波兰' },
  { code: 'CZ', name: '捷克' },
  { code: 'GR', name: '希腊' },
  { code: 'IE', name: '爱尔兰' },
  { code: 'RU', name: '俄罗斯' },
  { code: 'UA', name: '乌克兰' },
  // 大洋洲
  { code: 'AU', name: '澳大利亚' },
  { code: 'NZ', name: '新西兰' },
  // 非洲
  { code: 'ZA', name: '南非' },
  { code: 'EG', name: '埃及' },
  { code: 'NG', name: '尼日利亚' },
  { code: 'KE', name: '肯尼亚' },
  { code: 'MA', name: '摩洛哥' },
] as const;

export const COUNTRY_NAMES = COUNTRIES.map((c) => c.name) as [string, ...string[]];

/** 用于判断是否启用中国级联省市区 UI 的常量 */
export const DEFAULT_COUNTRY = '中国';
