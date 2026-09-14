import type { XiaohongshuDataCaliber } from '@ky-azeroth/shared/types';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { toJsonValue } from '../../common/utils/json-type-helpers';
import type { XiaohongshuReportLevel, XiaohongshuReportRow } from '../xiaohongshu-core';

export interface ParsedXiaohongshuReportRow {
  statDate: Date;
  level: XiaohongshuReportLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  unitId: string | null;
  unitName: string | null;
  creativeId: string | null;
  creativeName: string | null;
  fee: Decimal;
  impression: number;
  click: number;
  interaction: number;
  like: number;
  comment: number;
  collect: number;
  follow: number;
  share: number;
  landingPageVisit: number | null;
  formImpression: number | null;
  formSubmit: number | null;
  validFormSubmit: number | null;
  combinedLead: number | null;
  messageUser: number | null;
  messageConsult: number | null;
  messageOpen: number | null;
  messageLead: number | null;
  ctr: Decimal | null;
  acp: Decimal | null;
  cpm: Decimal | null;
  cpi: Decimal | null;
  dataCaliber: XiaohongshuDataCaliber;
  rawPayload: Prisma.InputJsonValue;
}

export function parseXiaohongshuReportRow(
  row: XiaohongshuReportRow,
  level: XiaohongshuReportLevel,
  advertiserId: string,
  dataCaliber: XiaohongshuDataCaliber
): ParsedXiaohongshuReportRow | null {
  const time = stringValue(row.time);
  if (!time || !/^\d{4}-\d{2}-\d{2}$/.test(time)) return null;

  const ids = {
    account: advertiserId,
    campaign: stringValue(row.campaign_id),
    unit: stringValue(row.unit_id),
    creative: stringValue(row.creativity_id),
    note: stringValue(row.note_id),
  };
  const names = {
    account: stringValue(row.advertiser_name),
    campaign: stringValue(row.campaign_name),
    unit: stringValue(row.unit_name),
    creative: stringValue(row.creativity_name) ?? stringValue(row.creative_name),
    note: stringValue(row.note_title),
  };
  const entityId = ids[level];
  if (!entityId) return null;

  return {
    statDate: new Date(`${time}T00:00:00.000Z`),
    level,
    entityId,
    entityName: names[level],
    campaignId: stringValue(row.campaign_id),
    campaignName: stringValue(row.campaign_name),
    unitId: stringValue(row.unit_id),
    unitName: stringValue(row.unit_name),
    creativeId: stringValue(row.creativity_id),
    creativeName: stringValue(row.creativity_name) ?? stringValue(row.creative_name),
    fee: decimalValue(row.fee) ?? new Decimal(0),
    impression: integerValue(row.impression),
    click: integerValue(row.click),
    interaction: integerValue(row.interaction),
    like: integerValue(row.like),
    comment: integerValue(row.comment),
    collect: integerValue(row.collect),
    follow: integerValue(row.follow),
    share: integerValue(row.share),
    landingPageVisit: nullableIntegerValue(row.landing_page_visit ?? row.landing_page_pv),
    formImpression: nullableIntegerValue(row.leads_button_impression ?? row.landing_form_imp_num),
    formSubmit: nullableIntegerValue(row.leads),
    validFormSubmit: nullableIntegerValue(row.valid_leads),
    combinedLead: nullableIntegerValue(row.msg_leads_form_submit_num),
    messageUser: nullableIntegerValue(row.message_user),
    messageConsult: nullableIntegerValue(row.message_consult),
    messageOpen: nullableIntegerValue(row.initiative_message),
    messageLead: nullableIntegerValue(row.msg_leads_num),
    ctr: percentageValue(row.ctr),
    acp: decimalValue(row.acp),
    cpm: decimalValue(row.cpm),
    cpi: decimalValue(row.cpi),
    dataCaliber,
    rawPayload: toJsonValue(sanitizeJson(row)) ?? {},
  };
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerValue(value: unknown): number {
  return nullableIntegerValue(value) ?? 0;
}

function nullableIntegerValue(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(2_147_483_647, Math.trunc(parsed)));
}

function percentageValue(value: unknown): Decimal | null {
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    const parsed = finiteNumber(value.trim().slice(0, -1));
    return parsed === null ? null : new Decimal(parsed).div(100);
  }
  return decimalValue(value);
}

function decimalValue(value: unknown): Decimal | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : new Decimal(parsed);
}

function sanitizeJson(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeJson(item)])
    );
  }
  return value;
}
