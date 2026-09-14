/**
 * 销售数据闭环：跨页面复用组件 + hooks 统一导出。
 * 被工作台两卡（pages/dashboard）、独立列表页（pages/sales-action-items）、移动端共用，
 * 故置于 components/patterns（UI 四层规范：跨页面复用上提 patterns）。
 */
export {
  ADOPTABLE_CATEGORY,
  ATTACK_CARD_ICON,
  ATTACK_CARD_ICON_BG,
  ATTACK_CARD_ICON_FG,
  ATTACK_CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_OPTIONS,
  CONFIDENCE_OPTIONS,
  DEFENSE_CARD_ICON,
  DEFENSE_CARD_ICON_BG,
  DEFENSE_CARD_ICON_FG,
  DEFENSE_CATEGORIES,
  DONE_TYPE_OPTIONS,
  isAdoptableActionItem,
  refTypeToDrawerType,
  STATUS_OPTIONS,
} from './constants';
export { AiDraftPreview, EvidenceList } from './evidence-view';
export {
  type SalesActionItemListResponse,
  salesActionItemsKeys,
  type SalesActionItemsQuery,
  useAdminActionItemCount,
  useAdminActionItems,
  useAdoptActionItem,
  useDoneActionItem,
  useIgnoreActionItem,
  useInvalidateActionItems,
  useMyActionItemCount,
  useMyActionItems,
  useReopenActionItem,
  useTransferActionItem,
  useUndoActionItem,
} from './hooks';
export { IgnoreDialog } from './ignore-dialog';
export { SalesActionDrawer } from './sales-action-drawer';
export { TransferDialog } from './transfer-dialog';
