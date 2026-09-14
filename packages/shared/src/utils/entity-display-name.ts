/**
 * 业务实体「显示名」统一规约
 *
 * 设计原则：
 *   1. 单一来源：所有显示名通过 getEntityDisplayName(type, entity, variant) 一个函数派生，
 *      禁止散落各处的 `xxxTitle || serialNumber` 兜底链
 *   2. 三种粒度：short / long / withContext，由调用方按场景选择
 *   3. 业务语义优先，编号兜底
 *
 * 当前版本：Payment.subject / Invoice.subject 已落库，调用方传入的 entity 上会带
 * subject 字段；历史数据或极端老调用方缺 subject 时，仍保留 direction/refundType/
 * "开票" 等兜底，避免显示空白。
 *
 * @see assets/20260614/ky-azeroth业务实体显示名统一规约.md（设计文档）
 * @see docs/conventions/entity-display-name.md（团队规约，P3 阶段编写）
 */

import { formatDateString } from './date';
import { formatCurrency } from './format';

/**
 * 业务实体类型 —— 与 web 端 `DrawerEntityType` kebab-case 风格对齐，
 * 也与 Prisma `@@map` 表名（复数 snake_case）的单数形式语义一致：
 *   - opportunity  ↔ opportunities ↔ Opportunity
 *   - sale-order   ↔ sale_orders   ↔ SaleOrder
 *   - payment      ↔ payments      ↔ Payment
 *   - invoice      ↔ invoices      ↔ Invoice
 */
export type EntityType = 'opportunity' | 'sale-order' | 'payment' | 'invoice';

/** 全部支持的实体类型 —— 用于运行时校验 */
export const DISPLAYABLE_ENTITY_TYPES: readonly EntityType[] = [
  'opportunity',
  'sale-order',
  'payment',
  'invoice',
] as const;

/** type guard：判断任意字符串是否为本函数已覆盖的实体类型 */
export function isDisplayableEntityType(t: string): t is EntityType {
  return (DISPLAYABLE_ENTITY_TYPES as readonly string[]).includes(t);
}

/**
 * 显示名粒度：
 *   short       —— 列表加粗主列 / 移动卡 title / 删除确认（≤ 30 字）
 *   long        —— 抽屉面包屑 / Tab 标题 / 消息推送（≤ 60 字）
 *   withContext —— 跨模块引用（订单详情看回款列表、回款表单选订单等，≤ 80 字）
 */
export type DisplayVariant = 'short' | 'long' | 'withContext';

/** 兼容 Prisma.Decimal / number / string / null / undefined 的金额类型 */
type MoneyLike = number | string | { toString(): string } | null | undefined;

/** 兼容 Date / ISO 字符串 / null 的日期类型 */
type DateLike = Date | string | null | undefined;

// --- 各实体最小入参 shape（仅声明本函数读取的字段，不要求传完整实体） ---

export interface OpportunityDisplayShape {
  opportunityName?: string | null;
  serialNumber?: string | null;
}

export interface SaleOrderDisplayShape {
  orderTitle?: string | null;
  serialNumber?: string | null;
}

export interface PaymentDisplayShape {
  /** P2 阶段新增字段，P0 阶段可能为空 */
  subject?: string | null;
  /** 'IN' = 回款 / 'OUT' = 退款 */
  direction?: string | null;
  /** direction='OUT' 时的退款类型，P0 用作 subject fallback */
  refundType?: string | null;
  paymentAmount?: MoneyLike;
  businessDate?: DateLike;
  serialNumber?: string | null;
}

export interface InvoiceDisplayShape {
  /** P2 阶段新增字段，P0 阶段可能为空 */
  subject?: string | null;
  invoiceAmount?: MoneyLike;
  invoiceDate?: DateLike;
  invoiceNumber?: string | null;
  serialNumber?: string | null;
}

/** EntityType → 对应入参 shape 的类型映射 */
export interface EntityDisplayShapeMap {
  opportunity: OpportunityDisplayShape;
  'sale-order': SaleOrderDisplayShape;
  payment: PaymentDisplayShape;
  invoice: InvoiceDisplayShape;
}

// --- 内部工具 ---

function toAmount(m: MoneyLike): number {
  if (m == null) return 0;
  if (typeof m === 'number') return Number.isFinite(m) ? m : 0;
  const raw = typeof m === 'string' ? m : m.toString();
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function clean(s: string | null | undefined): string {
  return s?.trim() ?? '';
}

/** 实体类型 → 兜底中文名（entity 为 null/undefined 或无任何可显示字段时返回） */
function fallbackName(type: EntityType): string {
  switch (type) {
    case 'opportunity':
      return '商机';
    case 'sale-order':
      return '订单';
    case 'payment':
      return '回款';
    case 'invoice':
      return '发票';
    default:
      return '';
  }
}

function pickPaymentSubject(p: PaymentDisplayShape): string {
  const subject = clean(p.subject);
  if (subject) return subject;
  if (p.direction === 'OUT') {
    return clean(p.refundType) || '退款';
  }
  return '回款';
}

function pickInvoiceSubject(inv: InvoiceDisplayShape): string {
  return clean(inv.subject) || '开票';
}

// --- 各实体的派生 ---

function displayOpportunity(e: OpportunityDisplayShape, variant: DisplayVariant): string {
  const name = clean(e.opportunityName);
  const sn = clean(e.serialNumber);
  if (!name && !sn) return fallbackName('opportunity');

  if (variant === 'long' && name && sn) {
    return `${name}（${sn}）`;
  }
  // short / withContext：商机引用方关心名字，不重复编号
  return name || sn;
}

function displaySaleOrder(e: SaleOrderDisplayShape, variant: DisplayVariant): string {
  const title = clean(e.orderTitle);
  const sn = clean(e.serialNumber);
  if (!title && !sn) return fallbackName('sale-order');

  if (variant === 'short') {
    // 列表已有独立编号列，short 优先标题
    return title || sn;
  }
  // long / withContext：合同标识必带编号
  if (title && sn) return `${title}（${sn}）`;
  return title || sn;
}

function displayPayment(e: PaymentDisplayShape, variant: DisplayVariant): string {
  const subject = pickPaymentSubject(e);
  const amount = formatCurrency(toAmount(e.paymentAmount));
  const date = formatDateString(e.businessDate ?? null);
  const sn = clean(e.serialNumber);
  const headWithDate = date ? `${subject}·${amount}·${date}` : `${subject}·${amount}`;

  if (variant === 'short') {
    return `${subject}·${amount}`;
  }
  if (variant === 'withContext') {
    return headWithDate;
  }
  // long
  return sn ? `${headWithDate}（${sn}）` : headWithDate;
}

function displayInvoice(e: InvoiceDisplayShape, variant: DisplayVariant): string {
  const subject = pickInvoiceSubject(e);
  const amount = formatCurrency(toAmount(e.invoiceAmount));
  const date = formatDateString(e.invoiceDate ?? null);
  const invNo = clean(e.invoiceNumber);
  const sn = clean(e.serialNumber);
  const headWithDate = date ? `${subject}·${amount}·${date}` : `${subject}·${amount}`;

  if (variant === 'short') {
    return `${subject}·${amount}`;
  }
  if (variant === 'withContext') {
    return headWithDate;
  }
  // long：优先真实税务发票号，没有则系统编号
  const tail = invNo || sn;
  return tail ? `${headWithDate}（${tail}）` : headWithDate;
}

/**
 * 业务实体显示名统一派生函数
 *
 * @param type    实体类型
 * @param entity  实体对象（仅需带 EntityDisplayShapeMap[type] 列出的字段；可为 null/undefined）
 * @param variant 显示粒度（默认 short）
 * @returns       中文显示名字符串；entity 为空或缺失关键字段时返回中文兜底名
 *
 * @example
 *   getEntityDisplayName('opportunity', opp)                       // '示例家居 AI 项目'
 *   getEntityDisplayName('sale-order', order, 'withContext')        // '示例家居一期定制（S-202606-0123）'
 *   getEntityDisplayName('payment', pay, 'short')                  // '首期款·¥30,000.00'
 *   getEntityDisplayName('invoice', inv, 'long')                   // '软件服务费·¥30,000.00·2026-06-14（INV-2026-001）'
 */
export function getEntityDisplayName<T extends EntityType>(
  type: T,
  entity: EntityDisplayShapeMap[T] | null | undefined,
  variant: DisplayVariant = 'short'
): string {
  if (!entity) return fallbackName(type);

  switch (type) {
    case 'opportunity':
      return displayOpportunity(entity as OpportunityDisplayShape, variant);
    case 'sale-order':
      return displaySaleOrder(entity as SaleOrderDisplayShape, variant);
    case 'payment':
      return displayPayment(entity as PaymentDisplayShape, variant);
    case 'invoice':
      return displayInvoice(entity as InvoiceDisplayShape, variant);
    default:
      return fallbackName(type);
  }
}
