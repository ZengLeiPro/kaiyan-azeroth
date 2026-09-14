import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATE, COL_DATETIME, COL_NUMBER, COL_STATUS } from './column-widths';
import { paginationSchema, stringOrStringArray, stringOrStringArrayOfUuid } from './common';

/**
 * 销售数据待办/作战项（销售数据闭环系统）Zod 校验
 *
 * 对应 Prisma model SalesActionItem。夜间缺口侦探 + 晨间作战信号共用。
 * 写入红线（D1）：AI 抽取一律进此表人工采纳，绝不夜间直接写 CRM。
 */

// ============================================================
// aiDraft / evidence JSON shape（勘察 09 §1.5）
// ============================================================

/**
 * 采纳草稿（仅 keep_record 可一键采纳）。
 * adopt 端点强校验（D6/Codex A4）：matchMode='FULL_NAME_EXPLICIT' + matchedCustomerId
 * + matchedFullName + evidenceMessageId 缺一拒绝。
 */
export const salesActionKeepRecordDraftSchema = z
  .object({
    kind: z.literal('keep_record'),
    matchMode: z.literal('FULL_NAME_EXPLICIT'),
    matchedCustomerId: z.string().uuid(),
    matchedFullName: z.string().min(1),
    evidenceMessageId: z.string().min(1),
    payload: z
      .object({
        customerId: z.string().uuid(),
        keepRecordType: z.string().min(1),
        keepRecordContent: z.string().min(1),
        keepRecordTime: z.string().min(1),
        contactId: z.string().uuid().optional().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

/** aiDraft 顶层（首版仅 keep_record；其它 kind 不允许采纳，schema 保持宽松以容纳占位） */
export const salesActionAiDraftSchema = salesActionKeepRecordDraftSchema;

export const SALES_ACTION_EVIDENCE_MAX_ITEMS = 50;
const CANONICAL_HTTP_URL_MAX_LENGTH = 2048;
const MAX_PERCENT_DECODE_LAYERS = 5;
const EVIDENCE_TITLE_MAX_LENGTH = 500;
const EVIDENCE_EXCERPT_MAX_LENGTH = 5000;
const UNSAFE_RAW_URL_UNICODE_RE = /[\p{Cc}\p{Cf}\p{Z}]/u;
const UNSAFE_DECODED_URL_UNICODE_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const MALFORMED_PERCENT_RE = /%(?![\dA-Fa-f]{2})/;

const evidenceText = (maxLength: number) => z.string().trim().min(1).max(maxLength);
const optionalEvidenceText = (maxLength: number) => evidenceText(maxLength).optional().nullable();

function urlAuthority(value: string): string {
  const authorityStart = value.indexOf('://') + 3;
  const remainder = value.slice(authorityStart);
  const authorityEnd = remainder.search(/[/?#]/);
  return authorityEnd === -1 ? remainder : remainder.slice(0, authorityEnd);
}

function containsNonAscii(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint > 0x7f) return true;
  }
  return false;
}

function percentByteAt(value: string, index: number): number | null {
  if (value[index] !== '%' || index + 2 >= value.length) return null;
  const hex = value.slice(index + 1, index + 3);
  return /^[\dA-Fa-f]{2}$/.test(hex) ? Number.parseInt(hex, 16) : null;
}

type Utf8PercentProjection = {
  character: string;
  consumedCharacters: number;
};

/** Decode only a well-formed UTF-8 sequence made entirely from adjacent percent bytes. */
function projectUtf8PercentSequence(
  value: string,
  index: number,
  firstByte: number
): Utf8PercentProjection | null {
  let byteLength: number;
  let secondByteMin = 0x80;
  let secondByteMax = 0xbf;

  if (firstByte >= 0xc2 && firstByte <= 0xdf) {
    byteLength = 2;
  } else if (firstByte >= 0xe0 && firstByte <= 0xef) {
    byteLength = 3;
    if (firstByte === 0xe0) secondByteMin = 0xa0;
    if (firstByte === 0xed) secondByteMax = 0x9f;
  } else if (firstByte >= 0xf0 && firstByte <= 0xf4) {
    byteLength = 4;
    if (firstByte === 0xf0) secondByteMin = 0x90;
    if (firstByte === 0xf4) secondByteMax = 0x8f;
  } else {
    return null;
  }

  const bytes = [firstByte];
  for (let offset = 1; offset < byteLength; offset += 1) {
    const byte = percentByteAt(value, index + offset * 3);
    if (
      byte === null ||
      (offset === 1 ? byte < secondByteMin || byte > secondByteMax : byte < 0x80 || byte > 0xbf)
    ) {
      return null;
    }
    bytes.push(byte);
  }

  let codePoint: number;
  if (byteLength === 2) {
    codePoint = ((bytes[0] ?? 0) & 0x1f) << 6;
    codePoint |= (bytes[1] ?? 0) & 0x3f;
  } else if (byteLength === 3) {
    codePoint = ((bytes[0] ?? 0) & 0x0f) << 12;
    codePoint |= ((bytes[1] ?? 0) & 0x3f) << 6;
    codePoint |= (bytes[2] ?? 0) & 0x3f;
  } else {
    codePoint = ((bytes[0] ?? 0) & 0x07) << 18;
    codePoint |= ((bytes[1] ?? 0) & 0x3f) << 12;
    codePoint |= ((bytes[2] ?? 0) & 0x3f) << 6;
    codePoint |= (bytes[3] ?? 0) & 0x3f;
  }

  return {
    character: String.fromCodePoint(codePoint),
    consumedCharacters: byteLength * 3,
  };
}

/**
 * Produce one security-only percent-decoding layer.
 *
 * ASCII bytes are projected directly. Valid UTF-8 byte runs become Unicode so Cc/Cf checks can
 * see them. Invalid non-ASCII/legacy byte encodings stay percent-encoded instead of being rejected.
 */
function projectPercentEncodedLayer(value: string): string | null {
  let projected = '';

  for (let index = 0; index < value.length; ) {
    if (value[index] !== '%') {
      projected += value[index];
      index += 1;
      continue;
    }

    const byte = percentByteAt(value, index);
    if (byte === null) return null;

    if (byte <= 0x7f) {
      projected += String.fromCharCode(byte);
      index += 3;
      continue;
    }

    const utf8 = projectUtf8PercentSequence(value, index, byte);
    if (utf8) {
      projected += utf8.character;
      index += utf8.consumedCharacters;
      continue;
    }

    projected += value.slice(index, index + 3);
    index += 3;
  }

  return projected;
}

function isSafeHttpUrlLayer(value: string, isRawLayer: boolean): boolean {
  if (
    value.includes('\\') ||
    MALFORMED_PERCENT_RE.test(value) ||
    (isRawLayer
      ? UNSAFE_RAW_URL_UNICODE_RE.test(value)
      : UNSAFE_DECODED_URL_UNICODE_RE.test(value)) ||
    !/^https?:\/\//i.test(value)
  ) {
    return false;
  }

  const authority = urlAuthority(value);
  if (
    authority.length === 0 ||
    authority.includes('%') ||
    authority.includes('@') ||
    containsNonAscii(authority)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname !== '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      !parsed.hostname
        .toLowerCase()
        .split('.')
        .some((label) => label.startsWith('xn--'))
    );
  } catch {
    return false;
  }
}

function hasSafePercentEncodingLayers(value: string): boolean {
  let layer = value;

  for (let decodedLayers = 0; decodedLayers <= MAX_PERCENT_DECODE_LAYERS; decodedLayers += 1) {
    if (!isSafeHttpUrlLayer(layer, decodedLayers === 0)) return false;

    const projected = projectPercentEncodedLayer(layer);
    if (projected === null) return false;
    if (projected === layer) return true;
    if (decodedLayers === MAX_PERCENT_DECODE_LAYERS) return false;

    layer = projected;
  }

  return false;
}

function canonicalizeHttpUrl(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > CANONICAL_HTTP_URL_MAX_LENGTH ||
    value.trim() !== value ||
    !hasSafePercentEncodingLayers(value)
  ) {
    return null;
  }

  try {
    const canonical = new URL(value).href;
    return canonical.length <= CANONICAL_HTTP_URL_MAX_LENGTH ? canonical : null;
  } catch {
    return null;
  }
}

/**
 * 唯一 canonical HTTP(S) 外链解析器。
 *
 * 输入必须已经无首尾空格；逐层拒绝控制/format 字符、反斜线、credentials、IDN 与畸形
 * percent。安全投影有固定层数上限，旧式非 UTF-8 percent 字节保持编码；成功值统一返回
 * WHATWG URL.href 规范化结果。
 */
export const canonicalHttpUrlSchema = z.string().transform((value, ctx) => {
  const canonical = canonicalizeHttpUrl(value);
  if (canonical === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'URL 必须是无歧义、无凭据的绝对 HTTP(S) 地址',
    });
    return z.NEVER;
  }
  return canonical;
});

/** evidence 单条：钉钉消息 */
export const salesActionEvidenceDingtalkSchema = z
  .object({
    type: z.literal('dingtalk_msg'),
    conversationTitle: evidenceText(300),
    sender: evidenceText(100),
    sentAt: evidenceText(64),
    excerpt: evidenceText(EVIDENCE_EXCERPT_MAX_LENGTH),
    msgId: evidenceText(255),
  })
  .strict();

/** evidence 单条：文档。写入必须同时提供严格 canonical URL。 */
export const salesActionEvidenceDocSchema = z
  .object({
    type: z.literal('doc'),
    title: evidenceText(EVIDENCE_TITLE_MAX_LENGTH),
    url: canonicalHttpUrlSchema,
  })
  .strict();

/** 读取历史非法 doc URL 时的安全降级 shape：只保留 title，不保留原 URL/extra。 */
const salesActionEvidenceDocResponseSchema = z
  .object({
    type: z.literal('doc'),
    title: evidenceText(EVIDENCE_TITLE_MAX_LENGTH),
    url: canonicalHttpUrlSchema.optional(),
  })
  .strict();

/** evidence 单条：日程 */
export const salesActionEvidenceCalendarSchema = z
  .object({
    type: z.literal('calendar'),
    summary: evidenceText(EVIDENCE_TITLE_MAX_LENGTH),
    start: evidenceText(64),
  })
  .strict();

/**
 * evidence 单条：CRM 交叉比对证据。
 * 缺口侦探的证据【主来源】——商机逾期/应收静默/赢单无跟进/客户沉睡等依据来自存量 CRM，非钉钉消息。
 */
export const salesActionEvidenceCrmSchema = z
  .object({
    type: z.literal('crm'),
    table: evidenceText(100),
    refId: optionalEvidenceText(255),
    excerpt: evidenceText(EVIDENCE_EXCERPT_MAX_LENGTH),
    recordedAt: optionalEvidenceText(64),
  })
  .strict();

/** evidence 单条：官网留资。所有 URL-like 字段只作文本；可点击来源必须另建 doc。 */
export const salesActionEvidenceWebsiteSchema = z
  .object({
    type: z.literal('website'),
    site: optionalEvidenceText(255),
    path: optionalEvidenceText(1024),
    placement: optionalEvidenceText(200),
    channel: optionalEvidenceText(200),
    phone: evidenceText(50),
    vid: optionalEvidenceText(255),
    sid: optionalEvidenceText(255),
    referrer: optionalEvidenceText(2048),
    refHost: optionalEvidenceText(255),
    region: optionalEvidenceText(100),
    city: optionalEvidenceText(100),
    recordedAt: optionalEvidenceText(64),
    excerpt: evidenceText(EVIDENCE_EXCERPT_MAX_LENGTH),
  })
  .strict();

/** 写契约：有上限的 strict discriminated union；未知 type、extra 与非 doc.url 一律拒绝。 */
export const salesActionEvidenceItemSchema = z.discriminatedUnion('type', [
  salesActionEvidenceDingtalkSchema,
  salesActionEvidenceDocSchema,
  salesActionEvidenceCalendarSchema,
  salesActionEvidenceCrmSchema,
  salesActionEvidenceWebsiteSchema,
]);
export const salesActionEvidenceSchema = z
  .array(salesActionEvidenceItemSchema)
  .max(SALES_ACTION_EVIDENCE_MAX_ITEMS);

/** 响应契约仅比写契约多一种安全状态：legacy doc 可降为 title-only。 */
export const salesActionEvidenceResponseItemSchema = z.discriminatedUnion('type', [
  salesActionEvidenceDingtalkSchema,
  salesActionEvidenceDocResponseSchema,
  salesActionEvidenceCalendarSchema,
  salesActionEvidenceCrmSchema,
  salesActionEvidenceWebsiteSchema,
]);
export const salesActionEvidenceResponseSchema = z
  .array(salesActionEvidenceResponseItemSchema)
  .max(SALES_ACTION_EVIDENCE_MAX_ITEMS);

export type SalesActionEvidenceDingtalk = z.infer<typeof salesActionEvidenceDingtalkSchema>;
export type SalesActionEvidenceDoc = z.infer<typeof salesActionEvidenceDocResponseSchema>;
export type SalesActionEvidenceCalendar = z.infer<typeof salesActionEvidenceCalendarSchema>;
export type SalesActionEvidenceCrm = z.infer<typeof salesActionEvidenceCrmSchema>;
export type SalesActionEvidenceWebsite = z.infer<typeof salesActionEvidenceWebsiteSchema>;
export type SalesActionEvidenceInput = z.infer<typeof salesActionEvidenceSchema>;
export type SalesActionEvidenceOutput = z.infer<typeof salesActionEvidenceResponseSchema>;
export type SalesActionEvidenceItemOutput = z.infer<typeof salesActionEvidenceResponseItemSchema>;

function optionalWhitelistedField(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key) ? { [key]: record[key] } : {};
}

function sanitizeSalesActionEvidenceItem(value: unknown): SalesActionEvidenceItemOutput | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  switch (record.type) {
    case 'doc': {
      const title = evidenceText(EVIDENCE_TITLE_MAX_LENGTH).safeParse(record.title);
      if (!title.success) return null;
      const url = canonicalHttpUrlSchema.safeParse(record.url);
      return url.success
        ? { type: 'doc', title: title.data, url: url.data }
        : { type: 'doc', title: title.data };
    }
    case 'dingtalk_msg': {
      const parsed = salesActionEvidenceDingtalkSchema.safeParse({
        type: 'dingtalk_msg',
        conversationTitle: record.conversationTitle,
        sender: record.sender,
        sentAt: record.sentAt,
        excerpt: record.excerpt,
        msgId: record.msgId,
      });
      return parsed.success ? parsed.data : null;
    }
    case 'calendar': {
      const parsed = salesActionEvidenceCalendarSchema.safeParse({
        type: 'calendar',
        summary: record.summary,
        start: record.start,
      });
      return parsed.success ? parsed.data : null;
    }
    case 'crm': {
      const parsed = salesActionEvidenceCrmSchema.safeParse({
        type: 'crm',
        table: record.table,
        excerpt: record.excerpt,
        ...optionalWhitelistedField(record, 'refId'),
        ...optionalWhitelistedField(record, 'recordedAt'),
      });
      return parsed.success ? parsed.data : null;
    }
    case 'website': {
      const parsed = salesActionEvidenceWebsiteSchema.safeParse({
        type: 'website',
        phone: record.phone,
        excerpt: record.excerpt,
        ...optionalWhitelistedField(record, 'site'),
        ...optionalWhitelistedField(record, 'path'),
        ...optionalWhitelistedField(record, 'placement'),
        ...optionalWhitelistedField(record, 'channel'),
        ...optionalWhitelistedField(record, 'vid'),
        ...optionalWhitelistedField(record, 'sid'),
        ...optionalWhitelistedField(record, 'referrer'),
        ...optionalWhitelistedField(record, 'refHost'),
        ...optionalWhitelistedField(record, 'region'),
        ...optionalWhitelistedField(record, 'city'),
        ...optionalWhitelistedField(record, 'recordedAt'),
      });
      return parsed.success ? parsed.data : null;
    }
    default:
      return null;
  }
}

/**
 * 历史读侧 sanitizer：最多检查前 50 项，并逐类从字段白名单重建对象。
 * 未知/畸形项丢弃；非法 doc URL 只保留安全 title，任何 extra 都不会进入响应或 transfer。
 */
export function sanitizeSalesActionEvidence(value: unknown): SalesActionEvidenceOutput | null {
  if (!Array.isArray(value)) return null;

  const sanitized: SalesActionEvidenceItemOutput[] = [];
  for (const item of value.slice(0, SALES_ACTION_EVIDENCE_MAX_ITEMS)) {
    const safeItem = sanitizeSalesActionEvidenceItem(item);
    if (safeItem) sanitized.push(safeItem);
  }
  return sanitized;
}

// category / confidence / doneType 取值
const SALES_ACTION_CATEGORY_VALUES = [
  'WEBSITE_LEAD_NEW',
  'FOLLOW_UP_DUE',
  'DEAL_COOLING',
  'PAYMENT_SILENT',
  'CUSTOMER_STALE',
  'GAP_HARD',
  'GAP_SOFT',
  'CONFLICT',
  'FILL_CONFIRM',
] as const;
const SALES_ACTION_CONFIDENCE_VALUES = ['HIGH', 'MEDIUM'] as const;
const SALES_ACTION_DONE_TYPE_VALUES = [
  'follow_recorded',
  'progressed',
  'shelved',
  'false_alarm',
  'other',
] as const;
const SALES_ACTION_DONE_TYPE_FOLLOW_RECORDED = 'follow_recorded';

// ============================================================
// 创建（夜间 cron / 管理端建待办）
// ============================================================
export const createSalesActionItemSchema = z.object({
  employeeId: z.string().min(1, '请指定收件销售').uuid('employeeId 格式不正确'),
  category: z.enum(SALES_ACTION_CATEGORY_VALUES),
  priority: z.number().int().min(0).max(100),
  refType: z.string().max(30).optional().nullable(),
  refId: z.string().optional().nullable(),
  title: z.string().trim().min(1, '请填写标题').max(200),
  reason: z.string().trim().min(1, '请填写「为什么提醒你」'),
  suggestedAction: z.string().optional().nullable(),
  aiDraft: salesActionAiDraftSchema.optional().nullable(),
  evidence: salesActionEvidenceSchema.optional().nullable(),
  confidence: z.enum(SALES_ACTION_CONFIDENCE_VALUES),
  dedupKey: z.string().trim().min(1, '请提供 dedupKey').max(120),
  sourceRunId: z.string().max(64).optional().nullable(),
  createdVia: z.string().max(40).optional(),
});

// ============================================================
// 更新（含 version 乐观锁）
// ============================================================
export const updateSalesActionItemSchema = createSalesActionItemSchema.partial().extend({
  version: z.number().int().optional(),
});

// ============================================================
// 查询（分页 + 管理端筛选）
// ============================================================
export const querySalesActionItemSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  employeeId: z.string().uuid().optional(),
  customerId: stringOrStringArrayOfUuid,
  category: stringOrStringArray,
  status: stringOrStringArray,
  doneType: stringOrStringArray,
  confidence: stringOrStringArray,
  sourceRunId: z.string().max(64).optional(),
});

// ============================================================
// 处置动作入参
// ============================================================
/** 忽略：resolveNote 必填（D7 可审计） */
export const ignoreSalesActionItemSchema = z.object({
  resolveNote: z.string().trim().min(1, '忽略必须填写理由'),
});

/** 办结时同步写入跟进记录的最小负载；客户/负责人由后端从待办结构化关联解析。 */
export const doneSalesActionItemKeepRecordSchema = z.object({
  contactId: z.string().uuid().optional().nullable(),
  keepRecordType: z.string().trim().min(1, '请选择跟进类型'),
  keepRecordTime: z
    .string()
    .min(1, '请选择跟进时间')
    .datetime({ offset: true, message: 'keepRecordTime 必须是 ISO 8601 带时区时间' }),
  keepRecordContent: z.string().trim().min(1, '请输入跟进内容'),
  keepRecordStatus: z.string().trim().min(1, '请选择跟进状态'),
});

/** 办结：doneType + resolveNote 必填（销售需说明实际处置结果） */
export const doneSalesActionItemSchema = z
  .object({
    doneType: z.enum(SALES_ACTION_DONE_TYPE_VALUES, { message: '请选择办结类型' }),
    resolveNote: z.string().trim().min(1, '办结必须填写处置结果'),
    keepRecord: doneSalesActionItemKeepRecordSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.doneType === SALES_ACTION_DONE_TYPE_FOLLOW_RECORDED && !value.keepRecord) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keepRecord'],
        message: '选择跟进情况时必须填写跟进记录',
      });
    }
    if (value.doneType !== SALES_ACTION_DONE_TYPE_FOLLOW_RECORDED && value.keepRecord) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keepRecord'],
        message: '只有办结类型为跟进情况时才能同步跟进记录',
      });
    }
  });

/** 转交：仅管理端动作，目标员工 + 转交原因必填。 */
export const transferSalesActionItemSchema = z.object({
  targetEmployeeId: z.string().uuid('请选择有效的转交对象'),
  reason: z.string().trim().min(1, '转交必须填写原因').max(500, '转交原因最多 500 字'),
});

// ============================================================
// 响应（withColumn 附 UI 列元数据）
// ============================================================
export const salesActionItemEmployeeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const salesActionItemCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
});

export const salesActionItemResponseSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  category: withColumn(z.string(), {
    label: '类型',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'salesActionItemCategory',
    order: 20,
  }),
  priority: withColumn(z.number(), {
    label: '优先级',
    width: COL_NUMBER,
    align: 'right',
    sortable: true,
    type: 'text',
    order: 30,
  }),
  refType: z.string().optional().nullable(),
  refId: z.string().optional().nullable(),
  title: withColumn(z.string(), {
    label: '标题',
    type: 'text',
    required: true,
    order: 10,
  }),
  customerName: withColumn(z.string().optional().nullable(), {
    label: '客户',
    width: 180,
    type: 'text',
    order: 15,
  }),
  reason: withColumn(z.string(), {
    label: '原因',
    type: 'text',
    order: 40,
  }),
  suggestedAction: z.string().optional().nullable(),
  aiDraft: salesActionAiDraftSchema.optional().nullable(),
  evidence: salesActionEvidenceResponseSchema.optional().nullable(),
  confidence: withColumn(z.string(), {
    label: '置信度',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'salesActionItemConfidence',
    order: 50,
  }),
  dedupKey: z.string(),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'salesActionItemStatus',
    order: 60,
  }),
  resolveNote: withColumn(z.string().optional().nullable(), {
    label: '处置结果',
    minWidth: 240,
    type: 'text',
    order: 68,
  }),
  doneType: withColumn(z.string().optional().nullable(), {
    label: '办结类型',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'salesActionItemDoneType',
    order: 67,
  }),
  snoozeUntil: z.string().optional().nullable(),
  remindCount: z.number().optional(),
  resultType: z.string().optional().nullable(),
  resultId: z.string().optional().nullable(),
  sourceRunId: z.string().optional().nullable(),
  createdVia: z.string().optional(),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATE,
    sortable: true,
    type: 'datetime',
    order: 70,
  }),
  creatorEmployeeId: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATE,
    type: 'datetime',
    hidden: true,
    order: 80,
  }),
  updaterEmployeeId: z.string().optional().nullable(),
  resolvedAt: withColumn(z.string().optional().nullable(), {
    label: '处置时间',
    width: COL_DATETIME,
    type: 'datetime',
    sortable: true,
    order: 66,
  }),
  resolvedById: z.string().optional().nullable(),
  resolvedByName: withColumn(z.string().optional().nullable(), {
    label: '处置人',
    width: 100,
    type: 'text',
    order: 65,
  }),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  employee: salesActionItemEmployeeInfoSchema.optional(),
  resolvedBy: salesActionItemEmployeeInfoSchema.optional().nullable(),
  customer: salesActionItemCustomerInfoSchema.optional(),
});

export type CreateSalesActionItemInput = z.infer<typeof createSalesActionItemSchema>;
export type UpdateSalesActionItemInput = z.infer<typeof updateSalesActionItemSchema>;
export type QuerySalesActionItemInput = z.infer<typeof querySalesActionItemSchema>;
export type IgnoreSalesActionItemInput = z.infer<typeof ignoreSalesActionItemSchema>;
export type DoneSalesActionItemInput = z.infer<typeof doneSalesActionItemSchema>;
export type TransferSalesActionItemInput = z.infer<typeof transferSalesActionItemSchema>;
export type SalesActionItemResponseOutput = z.infer<typeof salesActionItemResponseSchema>;
export type SalesActionItemEmployeeInfoOutput = z.infer<typeof salesActionItemEmployeeInfoSchema>;
export type SalesActionItemCustomerInfoOutput = z.infer<typeof salesActionItemCustomerInfoSchema>;
