/**
 * 销售数据闭环：category 分组 / 图标 / 配色 / 选项常量（两卡 + 列表页 + 抽屉 + 移动端共用）
 *
 * 配色与图标范式参照勘察 09 §1.8：
 * - 进攻（今日作战卡）用暖色 + Swords/Target 系图标。
 * - 防御（数据待办卡）：CONFLICT 红 / GAP_HARD 橙 / GAP_SOFT 黄 / FILL_CONFIRM 蓝。
 * - confidence：HIGH 高（红）/ MEDIUM 疑似（黄）。
 * - status：pending 待处理 / adopted 已采纳 / done 已办结 / ignored 已忽略 / snoozed 已稍后 / transferred 已转交 / auto_expired 自动失效。
 *
 * 注意：priority 列表排序 DESC（高=优先），别按设计稿 1 最高的 ASC。
 */
import {
  SALES_ACTION_ITEM_CATEGORY,
  SALES_ACTION_ITEM_CATEGORY_LABELS,
  SALES_ACTION_ITEM_CONFIDENCE_LABELS,
  SALES_ACTION_ITEM_DONE_TYPE_LABELS,
  SALES_ACTION_ITEM_STATUS_LABELS,
} from '@ky-azeroth/shared/constants';
import type { ISalesActionItemResponse, SalesActionItemCategory } from '@ky-azeroth/shared/types';
import {
  AlarmClock,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  Globe2,
  type LucideIcon,
  Snowflake,
  Swords,
  Target,
  UserX,
  Wallet,
} from 'lucide-react';

/** 进攻类 category（今日作战卡 + 列表「进攻」分组） */
export const ATTACK_CATEGORIES: SalesActionItemCategory[] = [
  SALES_ACTION_ITEM_CATEGORY.WEBSITE_LEAD_NEW,
  SALES_ACTION_ITEM_CATEGORY.FOLLOW_UP_DUE,
  SALES_ACTION_ITEM_CATEGORY.DEAL_COOLING,
  SALES_ACTION_ITEM_CATEGORY.PAYMENT_SILENT,
  SALES_ACTION_ITEM_CATEGORY.CUSTOMER_STALE,
];

/** 防御类 category（数据待办卡 + 列表「防御」分组） */
export const DEFENSE_CATEGORIES: SalesActionItemCategory[] = [
  SALES_ACTION_ITEM_CATEGORY.GAP_HARD,
  SALES_ACTION_ITEM_CATEGORY.GAP_SOFT,
  SALES_ACTION_ITEM_CATEGORY.CONFLICT,
  SALES_ACTION_ITEM_CATEGORY.FILL_CONFIRM,
];

/** 唯一可一键采纳的 category */
export const ADOPTABLE_CATEGORY: SalesActionItemCategory = SALES_ACTION_ITEM_CATEGORY.FILL_CONFIRM;

/**
 * 是否可一键采纳（前端判定，与后端 adopt 的 assertAdoptableDraft 对齐）。
 *
 * 入库 aiDraft 已过 create schema 严格校验（kind=keep_record + matchMode=FULL_NAME_EXPLICIT
 * + matchedCustomerId/matchedFullName/evidenceMessageId/payload.customerId 必全），故前端无需重复校验这些字段；
 * 后端 assertAdoptableDraft 仍可能 400 的唯一 schema 不保证项 = 草稿匹配客户与 payload 客户一致性，这里补判。
 *
 * 用途：列表行「采纳」按钮 + 抽屉「采纳/标记已办」二选一的显隐，统一走此判定，
 * 杜绝「显示采纳但点了必 400、又没有办结兜底」的死角（旧逻辑只判 category + kind）。
 */
export function isAdoptableActionItem(
  item: Pick<ISalesActionItemResponse, 'category' | 'aiDraft'>
): boolean {
  if (item.category !== ADOPTABLE_CATEGORY) return false;
  const draft = item.aiDraft;
  if (draft?.kind !== 'keep_record') return false;
  return draft.payload.customerId === draft.matchedCustomerId;
}

/** category → 行内图标（进攻暖色系，防御信息系） */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  // 进攻
  WEBSITE_LEAD_NEW: Globe2,
  FOLLOW_UP_DUE: Clock,
  DEAL_COOLING: Snowflake,
  PAYMENT_SILENT: Wallet,
  CUSTOMER_STALE: UserX,
  // 防御
  GAP_HARD: AlertTriangle,
  GAP_SOFT: AlertTriangle,
  CONFLICT: AlertTriangle,
  FILL_CONFIRM: ClipboardCheck,
};

/** 卡片头部图标：进攻 Swords / 防御 Target（暖色作战语义，区别于审批卡 CheckCircle） */
export const ATTACK_CARD_ICON = Swords;
export const DEFENSE_CARD_ICON = Target;

/** 卡片头部图标块底色（进攻 rose 暖色 / 防御 amber 暖色），区别审批卡 amber-100 */
export const ATTACK_CARD_ICON_BG = 'bg-rose-100 dark:bg-rose-900/30';
export const ATTACK_CARD_ICON_FG = 'text-rose-600 dark:text-rose-400';
export const DEFENSE_CARD_ICON_BG = 'bg-orange-100 dark:bg-orange-900/30';
export const DEFENSE_CARD_ICON_FG = 'text-orange-600 dark:text-orange-400';

/** category 选项（列表页筛选用） */
export const CATEGORY_OPTIONS = Object.entries(SALES_ACTION_ITEM_CATEGORY_LABELS).map(
  ([value, label]) => ({ value, label })
);

/** status 选项（列表页筛选用） */
export const STATUS_OPTIONS = Object.entries(SALES_ACTION_ITEM_STATUS_LABELS).map(
  ([value, label]) => ({ value, label })
);

/** doneType 选项（标记已办 / 列表筛选用） */
export const DONE_TYPE_OPTIONS = Object.entries(SALES_ACTION_ITEM_DONE_TYPE_LABELS).map(
  ([value, label]) => ({ value, label })
);

/** confidence 选项（列表页筛选用） */
export const CONFIDENCE_OPTIONS = Object.entries(SALES_ACTION_ITEM_CONFIDENCE_LABELS).map(
  ([value, label]) => ({ value, label })
);

/**
 * refType → DrawerStack 实体类型映射（进攻类行点击穿透）。
 * 后端 refType 常见取值：Opportunity / Customer / KeepRecord / SaleOrder / Payment / Invoice /
 * VisitRecord / Contact；同时兼容 snake/kebab/lowercase 形态。
 */
export function refTypeToDrawerType(
  refType: string | null | undefined
):
  | 'opportunity'
  | 'customer'
  | 'keep-record'
  | 'sale-order'
  | 'payment'
  | 'invoice'
  | 'visit-record'
  | 'contact'
  | null {
  const normalized = refType?.toLowerCase().replace(/[\s_-]/g, '');
  switch (normalized) {
    case 'opportunity':
      return 'opportunity';
    case 'customer':
      return 'customer';
    case 'keeprecord':
      return 'keep-record';
    case 'saleorder':
      return 'sale-order';
    case 'payment':
      return 'payment';
    case 'invoice':
      return 'invoice';
    case 'visitrecord':
      return 'visit-record';
    case 'contact':
      return 'contact';
    default:
      return null;
  }
}

/** 稍后提醒图标（snoozed 行可能用到） */
export const SNOOZE_ICON = AlarmClock;
