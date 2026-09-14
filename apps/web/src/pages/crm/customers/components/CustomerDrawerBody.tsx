import { getEntityDisplayName } from '@ky-azeroth/shared/utils';
import {
  createElement,
  Fragment,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { ActivityTimelinePanel } from '@/components/patterns/activity-timeline-panel';
import { ChangeLogPanel, type ChangeLogTarget } from '@/components/patterns/change-log-panel';
import { type DrawerEntityType, useDrawerStackOptional } from '@/components/patterns/drawer-stack';
import {
  type RelatedEntityColumn,
  RelatedEntityList,
} from '@/components/patterns/related-entity-list';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatDateDisplay, formatDateTimeDisplay } from '@/lib/date-utils';
import { buildAmapMarkerUrl } from '@/lib/geocoding';
import { getPaymentDisplayMeta } from '@/lib/payment-display';
import { paymentDirectionMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';

interface CustomerDrawerBodyProps {
  customerId: string;
  customerName?: string;
  aiInfoSummary?: string | null;
  aiInfoGeneratedAt?: string | null;
  /** 第一 tab "基本信息" 的内容（沿用页面原 fields 区域） */
  fieldsContent: ReactNode;
  /**
   * 更改记录目标（view 模式才传）。仅渲染在「基本信息」tab 内，
   * 其他 tab（联系人/商机/订单等）不显示，避免与各自的关联实体列表抢空间。
   */
  changeLogTarget?: ChangeLogTarget;
}

// 简化的展示性类型——只关心列上要显示的字段
interface ContactRow {
  id: string;
  contactName: string;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  position?: string | null;
}

interface OpportunityRow {
  id: string;
  opportunityName: string;
  opportunityStage?: string | null;
  opportunityAmount?: number | null;
  chargerName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface SaleOrderRow {
  id: string;
  serialNumber: string;
  orderTitle?: string | null;
  orderStatus?: string | null;
  orderAmount?: number | null;
  totalReceivables?: number | null;
  totalUncollected?: number | null;
  chargerName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface SaleOrderLinkInfo {
  id?: string | null;
  serialNumber?: string | null;
  orderTitle?: string | null;
  chargerName?: string | null;
}

interface SaleOrderLinkedRow {
  saleOrderId?: string | null;
  orderSerialNumber?: string | null;
  saleOrder?: SaleOrderLinkInfo | null;
}

interface PaymentRow {
  id: string;
  saleOrderId: string;
  businessDate?: string | null;
  paymentAmount: number;
  bankName?: string | null;
  orderSerialNumber?: string | null;
  saleOrder?: SaleOrderLinkInfo | null;
  chargerName?: string | null;
  direction?: string;
  legacyAdjustment: boolean;
  refundType?: string | null;
}

interface InvoiceRow {
  id: string;
  saleOrderId: string;
  invoiceDate?: string | null;
  invoiceNumber?: string | null;
  invoiceAmount: number;
  invoiceStatus?: string | null;
  saleOrder?: SaleOrderLinkInfo | null;
  chargerName?: string | null;
}

interface KeepRecordRow {
  id: string;
  keepRecordTime?: string | null;
  keepRecordContent?: string | null;
  chargerName?: string | null;
}

interface VisitRecordRow {
  id: string;
  signInTime?: string | null;
  signAddress?: string | null;
  /** 原始坐标 "lng,lat"，有值时签到地址渲染为高德跳转链接 */
  signLocation?: string | null;
  chargerName?: string | null;
}

const truncate = (s: string | null | undefined, n = 20) =>
  !s ? '-' : s.length > n ? `${s.slice(0, n)}...` : s;

const formatAmount = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : Number(v).toFixed(2);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const RICH_TEXT_MARKUP_RE = /<\/?[a-z][\s\S]*>/i;
const MARKDOWN_LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
const ALLOWED_RICH_TEXT_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'u',
  'ul',
]);
const DROPPED_RICH_TEXT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed']);
const RICH_TEXT_TAG_CLASS: Partial<Record<string, string>> = {
  a: 'text-primary underline underline-offset-2',
  blockquote: 'border-l-2 border-border pl-3 text-muted-foreground',
  code: 'rounded bg-muted px-1 py-0.5 font-mono text-xs',
  h1: 'text-base font-semibold text-foreground',
  h2: 'text-base font-semibold text-foreground',
  h3: 'text-sm font-semibold text-foreground',
  h4: 'text-sm font-semibold text-foreground',
  h5: 'text-sm font-semibold text-foreground',
  h6: 'text-sm font-semibold text-foreground',
  li: 'pl-1',
  ol: 'list-decimal space-y-1 pl-5',
  p: 'whitespace-pre-wrap',
  pre: 'overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-xs',
  ul: 'list-disc space-y-1 pl-5',
};

function safeLinkHref(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(value, baseUrl);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function renderRichTextNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROPPED_RICH_TEXT_TAGS.has(tag)) {
    return null;
  }

  const children = Array.from(element.childNodes).map((child, index) =>
    renderRichTextNode(child, `${key}-${index}`)
  );

  if (!ALLOWED_RICH_TEXT_TAGS.has(tag)) {
    return <Fragment key={key}>{children}</Fragment>;
  }

  if (tag === 'br') {
    return <br key={key} />;
  }

  const normalizedTag = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
  const props: {
    key: string;
    className?: string;
    href?: string;
    rel?: string;
    target?: string;
  } = {
    key,
    className: RICH_TEXT_TAG_CLASS[normalizedTag],
  };

  if (normalizedTag === 'a') {
    const href = safeLinkHref(element.getAttribute('href'));
    if (!href) {
      return <Fragment key={key}>{children}</Fragment>;
    }
    props.href = href;
    props.rel = 'noreferrer';
    props.target = '_blank';
  }

  return createElement(normalizedTag, props, children);
}

function renderMarkdownInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(tokenRe)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    const key = `${keyPrefix}-inline-${tokenIndex}`;
    const linkMatch = token.match(MARKDOWN_LINK_RE);
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {token.slice(1, -1)}
        </code>
      );
    } else if (linkMatch) {
      const href = safeLinkHref(linkMatch[2] ?? null);
      nodes.push(
        href ? (
          <a
            key={key}
            className="text-primary underline underline-offset-2"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {linkMatch[1]}
          </a>
        ) : (
          linkMatch[1]
        )
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }

    lastIndex = index + token.length;
    tokenIndex++;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseMarkdownContent(content: string): { nodes: ReactNode[]; text: string } {
  const nodes: ReactNode[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join('\n');
    const key = `p-${nodes.length}`;
    nodes.push(
      <p key={key} className="whitespace-pre-wrap">
        {renderMarkdownInline(text, key)}
      </p>
    );
    paragraphLines = [];
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    const key = `quote-${nodes.length}`;
    nodes.push(
      <blockquote
        key={key}
        className="space-y-1 border-l-2 border-border pl-3 text-muted-foreground"
      >
        {quoteLines.map((line, index) => (
          <p key={`${key}-${index}`}>{renderMarkdownInline(line, `${key}-${index}`)}</p>
        ))}
      </blockquote>
    );
    quoteLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const key = `list-${nodes.length}`;
    const Tag = listType;
    nodes.push(
      <Tag
        key={key}
        className={cn(listType === 'ol' ? 'list-decimal' : 'list-disc', 'space-y-1 pl-5')}
      >
        {listItems.map((item, index) => (
          <li key={`${key}-${index}`}>{renderMarkdownInline(item, `${key}-${index}`)}</li>
        ))}
      </Tag>
    );
    listType = null;
    listItems = [];
  };

  const flushCode = () => {
    const key = `code-${nodes.length}`;
    nodes.push(
      <pre
        key={key}
        className="overflow-x-auto whitespace-pre-wrap rounded-md bg-background px-3 py-2 font-mono text-xs text-foreground"
      >
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
    codeLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (trimmed.startsWith('```')) {
        inCodeBlock = false;
        flushCode();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushQuote();
      flushList();
      inCodeBlock = true;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushQuote();
      flushList();
      const level = Math.min(headingMatch[1]?.length ?? 3, 6);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const key = `heading-${nodes.length}`;
      nodes.push(
        <Tag key={key} className={level <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold'}>
          {renderMarkdownInline(headingMatch[2] ?? '', key)}
        </Tag>
      );
      continue;
    }

    const quoteMatch = line.match(/^ {0,3}>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1] ?? '');
      continue;
    }

    const unorderedMatch = line.match(/^ {0,3}[-*+]\s+(.+)$/);
    const orderedMatch = line.match(/^ {0,3}\d+[.)]\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      flushQuote();
      const nextListType = orderedMatch ? 'ol' : 'ul';
      if (listType && listType !== nextListType) flushList();
      listType = nextListType;
      listItems.push(orderedMatch?.[1] ?? unorderedMatch?.[1] ?? '');
      continue;
    }

    flushQuote();
    flushList();
    paragraphLines.push(line);
  }

  if (inCodeBlock) flushCode();
  flushParagraph();
  flushQuote();
  flushList();

  return { nodes, text: content.trim() };
}

function parseRichTextContent(content: string): { nodes: ReactNode[]; text: string } {
  if (typeof DOMParser === 'undefined' || !RICH_TEXT_MARKUP_RE.test(content)) {
    return parseMarkdownContent(content);
  }

  const doc = new DOMParser().parseFromString(content, 'text/html');
  return {
    nodes: Array.from(doc.body.childNodes).map((node, index) =>
      renderRichTextNode(node, `${index}`)
    ),
    text: doc.body.textContent?.trim() ?? '',
  };
}

function CustomerAiInfoSummaryBlock({
  content,
  generatedAt,
}: {
  content?: string | null;
  generatedAt?: string | null;
}) {
  const parsed = useMemo(() => (content ? parseRichTextContent(content) : null), [content]);
  const generatedAtText = useMemo(() => formatDateTimeDisplay(generatedAt), [generatedAt]);
  if (!parsed?.text) return null;

  return (
    <section className="col-span-1 space-y-2 rounded-md border bg-muted/30 p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">AI 见解</Badge>
        <div className="text-xs text-muted-foreground">
          <span className="mr-1">生成日期</span>
          {generatedAtText ? (
            <time dateTime={generatedAt ?? undefined}>{generatedAtText}</time>
          ) : (
            '-'
          )}
        </div>
      </div>
      <div className="space-y-3 break-words text-sm leading-relaxed text-muted-foreground">
        {parsed.nodes}
      </div>
    </section>
  );
}

/**
 * 客户详情 Drawer 在查看模式下的完整内容（含 Tabs）。
 *
 * 8 个 Tab：
 *   基本信息 | 联系人 | 商机 | 合同订单 | 回款 | 开票 | 跟进记录 | 拜访签到
 *
 * 第一个 tab 渲染 `fieldsContent`（来自页面，保持现有字段视图）；
 * 其余 7 个 tab 内嵌 RelatedEntityList，按 customerId 拉取关联数据。
 *
 * 懒加载机制：依赖 Tabs 组件的"非激活 tab 不挂载 TabsContent"行为，
 * 切到某 tab 时该 tab 内的 RelatedEntityList 才首次 mount/fetch。
 */
export function CustomerDrawerBody({
  customerId,
  customerName,
  aiInfoSummary,
  aiInfoGeneratedAt,
  fieldsContent,
  changeLogTarget,
}: CustomerDrawerBodyProps) {
  const [tab, setTab] = useState('info');
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const drawerStack = useDrawerStackOptional();
  const sourceCustomerName = customerName?.trim();

  const drawerEntryContext = useMemo(
    () => (sourceCustomerName ? { sourceCustomerId: customerId, sourceCustomerName } : undefined),
    [customerId, sourceCustomerName]
  );

  const buildCreateHandler = useCallback(
    (type: DrawerEntityType, title: string) => {
      if (!drawerStack) return undefined;
      return () => {
        drawerStack.push({
          type,
          id: '__create__',
          mode: 'create',
          presets: { customerId },
          title,
          context: drawerEntryContext,
        });
      };
    },
    [drawerStack, customerId, drawerEntryContext]
  );

  const openSaleOrder = useCallback(
    (row: SaleOrderLinkedRow) => {
      const saleOrderId = row.saleOrder?.id ?? row.saleOrderId;
      if (!saleOrderId) return;
      const title = row.saleOrder
        ? getEntityDisplayName('sale-order', row.saleOrder, 'long')
        : (row.orderSerialNumber ?? undefined);

      if (drawerStack) {
        drawerStack.push({
          type: 'sale-order',
          id: saleOrderId,
          title: title || undefined,
          context: drawerEntryContext,
        });
        return;
      }

      navigate(`/crm/sale-orders?highlight=${encodeURIComponent(saleOrderId)}`);
    },
    [drawerStack, drawerEntryContext, navigate]
  );

  const renderSaleOrderLink = useCallback(
    (row: SaleOrderLinkedRow) => {
      const saleOrderId = row.saleOrder?.id ?? row.saleOrderId;
      if (!saleOrderId) {
        return row.saleOrder?.serialNumber ?? row.orderSerialNumber ?? '-';
      }
      const shortLabel = row.saleOrder
        ? getEntityDisplayName('sale-order', row.saleOrder, 'short')
        : (row.orderSerialNumber ?? '-');
      const longLabel = row.saleOrder
        ? getEntityDisplayName('sale-order', row.saleOrder, 'withContext')
        : shortLabel;
      if (shortLabel === '-') return '-';

      return (
        <button
          type="button"
          className="text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            openSaleOrder(row);
          }}
          title={longLabel}
        >
          {shortLabel}
        </button>
      );
    },
    [openSaleOrder]
  );

  const contactColumns = useMemo<RelatedEntityColumn<ContactRow>[]>(
    () => [
      {
        key: 'contactName',
        header: '姓名',
        render: (r) => <span className="font-medium">{r.contactName}</span>,
      },
      { key: 'mobile', header: '手机', render: (r) => r.mobile || r.phone || '-' },
      { key: 'email', header: '邮箱', render: (r) => r.email || '-' },
      { key: 'position', header: '职位', render: (r) => r.position || '-' },
    ],
    []
  );

  const opportunityColumns = useMemo<RelatedEntityColumn<OpportunityRow>[]>(
    () => [
      { key: 'opportunityStage', header: '阶段', render: (r) => r.opportunityStage || '-' },
      {
        key: 'opportunityAmount',
        header: '金额',
        className: 'text-right font-mono',
        render: (r) => formatAmount(r.opportunityAmount),
      },
      { key: 'chargerName', header: '负责人', render: (r) => r.chargerName || '-' },
      {
        key: 'createdAt',
        header: '创建时间',
        className: 'font-mono',
        render: (r) => formatDateTimeDisplay(r.createdAt) || '-',
      },
      {
        key: 'updatedAt',
        header: '最近修改',
        className: 'font-mono',
        render: (r) => formatDateTimeDisplay(r.updatedAt) || '-',
      },
    ],
    []
  );

  const saleOrderColumns = useMemo<RelatedEntityColumn<SaleOrderRow>[]>(
    () => [
      { key: 'orderStatus', header: '状态', render: (r) => r.orderStatus || '-' },
      {
        key: 'totalReceivables',
        header: '应收总额',
        className: 'text-right font-mono',
        render: (r) => formatAmount(r.totalReceivables),
      },
      {
        key: 'totalUncollected',
        header: '未收余额',
        className: 'text-right font-mono',
        render: (r) => formatAmount(r.totalUncollected),
      },
      { key: 'chargerName', header: '负责人', render: (r) => r.chargerName || '-' },
      {
        key: 'createdAt',
        header: '创建时间',
        className: 'font-mono',
        render: (r) => formatDateTimeDisplay(r.createdAt) || '-',
      },
      {
        key: 'updatedAt',
        header: '最近修改',
        className: 'font-mono',
        render: (r) => formatDateTimeDisplay(r.updatedAt) || '-',
      },
    ],
    []
  );

  const paymentColumns = useMemo<RelatedEntityColumn<PaymentRow>[]>(
    () => [
      {
        key: 'direction',
        header: '方向',
        render: (r) => {
          const display = getPaymentDisplayMeta(r);
          const cfg =
            paymentDirectionMap[r.legacyAdjustment ? 'OUT' : (r.direction as 'IN' | 'OUT')];
          if (!cfg) return display.directionLabel;
          return (
            <Badge className={cn(cfg.color, `hover:${cfg.color}`)}>{display.directionLabel}</Badge>
          );
        },
      },
      {
        key: 'businessDate',
        header: '业务日期',
        className: 'font-mono',
        render: (r) => formatDateDisplay(r.businessDate) || '-',
      },
      {
        key: 'saleOrder',
        header: '订单',
        render: renderSaleOrderLink,
      },
      {
        key: 'paymentAmount',
        header: '金额',
        className: 'text-right font-mono',
        render: (r) => {
          const { isOut } = getPaymentDisplayMeta(r);
          return (
            <span className={cn(isOut && 'text-orange-700')}>
              {isOut ? '-' : ''}
              {formatAmount(r.paymentAmount)}
            </span>
          );
        },
      },
      { key: 'bankName', header: '账户', render: (r) => r.bankName || '-' },
      { key: 'chargerName', header: '负责人', render: (r) => r.chargerName || '-' },
    ],
    [renderSaleOrderLink]
  );

  const invoiceColumns = useMemo<RelatedEntityColumn<InvoiceRow>[]>(
    () => [
      {
        key: 'saleOrder',
        header: '订单',
        render: renderSaleOrderLink,
      },
      {
        key: 'invoiceDate',
        header: '开票日期',
        className: 'font-mono',
        render: (r) => formatDateDisplay(r.invoiceDate) || '-',
      },
      {
        key: 'invoiceAmount',
        header: '金额',
        className: 'text-right font-mono',
        render: (r) => formatAmount(r.invoiceAmount),
      },
      { key: 'invoiceStatus', header: '状态', render: (r) => r.invoiceStatus || '-' },
      { key: 'chargerName', header: '负责人', render: (r) => r.chargerName || '-' },
    ],
    [renderSaleOrderLink]
  );

  const keepRecordColumns = useMemo<RelatedEntityColumn<KeepRecordRow>[]>(
    () => [
      {
        key: 'keepRecordTime',
        header: '跟进时间',
        className: 'font-mono',
        render: (r) => formatDateTimeDisplay(r.keepRecordTime) || '-',
      },
      {
        key: 'keepRecordContent',
        header: '跟进内容',
        className: 'min-w-80 whitespace-normal',
        render: (r) => (
          <span className="block whitespace-pre-wrap break-words text-muted-foreground">
            {r.keepRecordContent || '-'}
          </span>
        ),
      },
      { key: 'chargerName', header: '跟进人', render: (r) => r.chargerName || '-' },
    ],
    []
  );

  const visitRecordColumns = useMemo<RelatedEntityColumn<VisitRecordRow>[]>(
    () => [
      {
        key: 'signInTime',
        header: '签到时间',
        className: 'font-mono',
        render: (r) => formatDateTimeDisplay(r.signInTime) || '-',
      },
      {
        key: 'signAddress',
        header: '签到地址',
        render: (r) => {
          if (!r.signAddress) return '-';
          const url = buildAmapMarkerUrl(r.signLocation);
          const label = truncate(r.signAddress, 24);
          if (!url) {
            return (
              <span className="text-muted-foreground" title={r.signAddress}>
                {label}
              </span>
            );
          }
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
              title={`高德地图查看：${r.signAddress}`}
              onClick={(e) => e.stopPropagation()}
            >
              {label}
            </a>
          );
        },
      },
      { key: 'chargerName', header: '拜访人', render: (r) => r.chargerName || '-' },
    ],
    []
  );

  const sortDesc = (sortBy: string) => ({ sortBy, sortOrder: 'desc' as const });

  return (
    // col-span-1 md:col-span-2：撑满父级 FormDialog 的 grid-cols-2 容器，
    // 否则整个 Tabs 会被当作一个 grid 单元格挤在左列、右列空白。
    <Tabs value={tab} onValueChange={setTab} className="col-span-1 md:col-span-2">
      <TabsList className="flex w-full justify-start gap-1 overflow-x-auto whitespace-nowrap">
        <TabsTrigger value="info">基本信息</TabsTrigger>
        {/* 活动时间线（2026-06-16 投影派）：插在"基本信息""联系人"之间，作为客户 360 总览入口 */}
        <TabsTrigger value="activities">活动</TabsTrigger>
        <TabsTrigger value="contacts">联系人</TabsTrigger>
        <TabsTrigger value="opportunities">商机</TabsTrigger>
        <TabsTrigger value="saleOrders">合同订单</TabsTrigger>
        <TabsTrigger value="payments">回款</TabsTrigger>
        <TabsTrigger value="invoices">开票</TabsTrigger>
        <TabsTrigger value="keepRecords">跟进记录</TabsTrigger>
        <TabsTrigger value="visitRecords">拜访签到</TabsTrigger>
      </TabsList>

      <TabsContent value="info">
        <div className={cn(isMobile ? 'space-y-4' : 'grid grid-cols-2 gap-x-4 gap-y-4')}>
          <CustomerAiInfoSummaryBlock content={aiInfoSummary} generatedAt={aiInfoGeneratedAt} />
          {fieldsContent}
        </div>
        {changeLogTarget ? <ChangeLogPanel target={changeLogTarget} /> : null}
      </TabsContent>

      <TabsContent value="activities">
        <ActivityTimelinePanel customerId={customerId} />
      </TabsContent>

      <TabsContent value="contacts">
        <RelatedEntityList<ContactRow>
          endpoint="/contacts"
          queryParams={{ customerId, ...sortDesc('createdAt') }}
          columns={contactColumns}
          emptyHint="该客户暂无联系人"
          targetRoute="/crm/contacts"
          entityType="contact"
          drawerEntryContext={drawerEntryContext}
          getRowTitle={(r) => r.contactName}
          onCreate={buildCreateHandler('contact', '新建联系人')}
          createLabel="新增联系人"
        />
      </TabsContent>

      <TabsContent value="opportunities">
        <RelatedEntityList<OpportunityRow>
          endpoint="/opportunities"
          queryParams={{ customerId, ...sortDesc('createdAt') }}
          columns={opportunityColumns}
          emptyHint="该客户暂无商机"
          targetRoute="/crm/opportunities"
          entityType="opportunity"
          drawerEntryContext={drawerEntryContext}
          getRowTitle={(r) => r.opportunityName}
          onCreate={buildCreateHandler('opportunity', '新建商机')}
          createLabel="新增商机"
        />
      </TabsContent>

      <TabsContent value="saleOrders">
        <RelatedEntityList<SaleOrderRow>
          endpoint="/sale-orders"
          queryParams={{ customerId, ...sortDesc('createdAt') }}
          columns={saleOrderColumns}
          emptyHint="该客户暂无合同订单"
          targetRoute="/crm/sale-orders"
          entityType="sale-order"
          drawerEntryContext={drawerEntryContext}
          getRowTitle={(r) => getEntityDisplayName('sale-order', r, 'long')}
          onCreate={buildCreateHandler('sale-order', '新建订单')}
          createLabel="新增订单"
        />
      </TabsContent>

      <TabsContent value="payments">
        <RelatedEntityList<PaymentRow>
          endpoint="/payments"
          queryParams={{ customerId, ...sortDesc('businessDate') }}
          columns={paymentColumns}
          emptyHint="该客户暂无回款记录"
          targetRoute="/crm/payments"
          entityType="payment"
          drawerEntryContext={drawerEntryContext}
          getRowTitle={(r) => {
            const display = getPaymentDisplayMeta(r);
            return `${display.directionLabel} ${formatDateDisplay(r.businessDate) || ''} ${
              display.isOut ? '-' : ''
            }${formatAmount(r.paymentAmount)}`;
          }}
          onCreate={buildCreateHandler('payment', '新建回款')}
          createLabel="新增回款"
        />
      </TabsContent>

      <TabsContent value="invoices">
        <RelatedEntityList<InvoiceRow>
          endpoint="/invoices"
          queryParams={{ customerId, ...sortDesc('invoiceDate') }}
          columns={invoiceColumns}
          emptyHint="该客户暂无开票记录"
          targetRoute="/crm/invoices"
          entityType="invoice"
          drawerEntryContext={drawerEntryContext}
          getRowTitle={(r) => `发票 ${r.invoiceNumber || formatDateDisplay(r.invoiceDate) || ''}`}
          onCreate={buildCreateHandler('invoice', '新建发票')}
          createLabel="新增发票"
        />
      </TabsContent>

      <TabsContent value="keepRecords">
        <RelatedEntityList<KeepRecordRow>
          endpoint="/keep-records"
          queryParams={{ customerId, ...sortDesc('keepRecordTime') }}
          columns={keepRecordColumns}
          emptyHint="该客户暂无跟进记录"
          targetRoute="/crm/keep-records"
          entityType="keep-record"
          drawerEntryContext={drawerEntryContext}
          getRowTitle={(r) => `跟进 ${formatDateTimeDisplay(r.keepRecordTime) || ''}`}
          onCreate={buildCreateHandler('keep-record', '新建跟进')}
          createLabel="新增跟进"
        />
      </TabsContent>

      <TabsContent value="visitRecords">
        <RelatedEntityList<VisitRecordRow>
          endpoint="/visit-records"
          queryParams={{ customerId, ...sortDesc('signInTime') }}
          columns={visitRecordColumns}
          emptyHint="该客户暂无拜访签到记录"
          targetRoute="/crm/visit-records"
          entityType="visit-record"
          drawerEntryContext={drawerEntryContext}
          getRowTitle={(r) => `拜访 ${formatDateTimeDisplay(r.signInTime) || ''}`}
        />
      </TabsContent>
    </Tabs>
  );
}
