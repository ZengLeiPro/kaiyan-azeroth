import {
  CONTACT_STATUS,
  CUSTOMER_LEVEL,
  CUSTOMER_RELATIONSHIP,
  CUSTOMER_SOURCE,
  DEAL_STATUS,
  INDUSTRY,
  SALES_ACTION_ITEM_CATEGORY,
  SALES_ACTION_ITEM_CONFIDENCE,
} from '@ky-azeroth/shared/constants';
import { DEFAULT_COUNTRY } from '@ky-azeroth/shared/constants/countries';
import type { WebsiteLeadIngestInput } from '@ky-azeroth/shared/schemas';
import {
  canonicalHttpUrlSchema,
  type SalesActionEvidenceInput,
  salesActionEvidenceSchema,
} from '@ky-azeroth/shared/schemas/sales-action-item';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { ACTIVE_EMPLOYEE_WHERE } from '../employees/employees.helper';

const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;
const SOURCE_RUN_ID = 'website-lead';
const CREATED_VIA = 'website_lead';
const PENDING_STATUSES = ['pending', 'snoozed'];

type WebsiteLeadTx = Prisma.TransactionClient;

type EmployeeOwner = {
  id: string;
  name: string;
};

type CustomerForLead = {
  id: string;
  customerName: string;
  chargerId: string | null;
};

export interface WebsiteLeadIngestResult {
  status: 'imported' | 'duplicate';
  customerId: string | null;
  actionItemId: string | null;
  matchedExistingCustomer: boolean;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

function short(value: string | null | undefined, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) ? timestamp : Number.NaN;
}

function timingSafeTextEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const phone = digits.length === 13 && digits.startsWith('86') ? digits.slice(2) : digits;
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw new BadRequestException('官网留资手机号格式不正确');
  }
  return phone;
}

function buildSourceId(input: WebsiteLeadIngestInput, phone: string): string {
  const provided = input.sourceId?.trim();
  if (provided) return provided.slice(0, 96);

  const hash = createHash('sha256')
    .update(
      stableStringify({
        event: input.event,
        site: input.site,
        phone,
        vid: input.vid ?? null,
        sid: input.sid ?? null,
        path: input.path ?? null,
        placement: input.placement ?? null,
        clientTs: input.clientTs ?? null,
      })
    )
    .digest('hex');
  return `wl_${hash}`;
}

function leadIntentText(channel: string | null | undefined): string {
  switch (channel) {
    case 'dingtalk':
      return '钉钉服务';
    case 'custom_dev':
      return '软件定制开发';
    case 'ai_employee':
      return 'AI 员工';
    case 'unsure':
      return '还不确定，先聊聊';
    default:
      return channel || '未填';
  }
}

function isTrialSignup(input: WebsiteLeadIngestInput): boolean {
  return input.event === 'trial_signup';
}

/** trial_signup 的注册补充信息行（留资事件这些字段为空，自然不出现） */
function signupDetailLines(input: WebsiteLeadIngestInput): string[] {
  return [
    input.name ? `称呼：${input.name}` : null,
    input.position ? `岗位：${input.position}` : null,
    input.company ? `公司：${input.company}` : null,
    input.scenario ? `直达场景：${input.scenario}` : null,
    input.tenantId ? `试用组织：${input.tenantId}` : null,
  ].filter((line): line is string => Boolean(line));
}

@Injectable()
export class WebsiteLeadsService {
  private readonly logger = new Logger(WebsiteLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly serialNumberService: SerialNumberService
  ) {}

  verifySignature(
    body: WebsiteLeadIngestInput,
    timestampHeader?: string,
    signatureHeader?: string
  ) {
    const secret = this.configService.get<string>('WEBSITE_LEAD_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      this.logger.error('WEBSITE_LEAD_WEBHOOK_SECRET 未配置');
      throw new InternalServerErrorException('Website lead webhook is not configured');
    }

    const timestamp = parseTimestamp(timestampHeader);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_SKEW_MS) {
      throw new ForbiddenException('Invalid website lead signature timestamp');
    }

    const signature = signatureHeader?.trim().replace(/^sha256=/, '');
    if (!signature) throw new ForbiddenException('Missing website lead signature');

    const expected = createHmac('sha256', secret)
      .update(`${timestampHeader}.${stableStringify(body)}`)
      .digest('hex');

    if (!timingSafeTextEqual(signature, expected)) {
      throw new ForbiddenException('Invalid website lead signature');
    }
  }

  async ingest(input: WebsiteLeadIngestInput): Promise<WebsiteLeadIngestResult> {
    const phone = normalizePhone(input.phone);
    const sourceId = buildSourceId(input, phone);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.websiteLeadImport.create({
          data: {
            sourceId,
            phone,
            status: 'processing',
            sourceSite: input.site,
            sourcePath: short(input.path, 512),
            placement: short(input.placement, 120),
            channel: short(input.channel, 120),
            payload: toJsonValue(input),
          },
        });

        const existing = await this.findExistingCustomerByPhone(tx, phone);
        const defaultOwner = await this.resolveDefaultOwner(tx);
        const actionOwner = existing?.customer.chargerId
          ? await this.resolveActiveOwner(tx, existing.customer.chargerId, defaultOwner)
          : defaultOwner;

        const { customer, matchedExistingCustomer } = existing
          ? { customer: existing.customer, matchedExistingCustomer: true }
          : {
              customer: await this.createPublicCustomer(tx, input, phone, actionOwner),
              matchedExistingCustomer: false,
            };

        if (!existing) {
          await this.createLeadContact(tx, customer.id, input, phone, actionOwner);
        }

        const actionItem = await this.upsertActionItem(tx, input, phone, customer, actionOwner);
        await this.upsertCoordinatorActionItem(
          tx,
          input,
          phone,
          customer,
          actionOwner,
          defaultOwner
        );

        await tx.websiteLeadImport.update({
          where: { sourceId },
          data: {
            status: 'imported',
            customerId: customer.id,
            actionItemId: actionItem.id,
            importedAt: new Date(),
          },
        });

        return {
          status: 'imported',
          customerId: customer.id,
          actionItemId: actionItem.id,
          matchedExistingCustomer,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        this.isSourceIdUniqueError(error)
      ) {
        const existing = await this.prisma.websiteLeadImport.findUnique({ where: { sourceId } });
        return {
          status: 'duplicate',
          customerId: existing?.customerId ?? null,
          actionItemId: existing?.actionItemId ?? null,
          matchedExistingCustomer: Boolean(existing?.customerId),
        };
      }
      throw error;
    }
  }

  private isSourceIdUniqueError(error: Prisma.PrismaClientKnownRequestError): boolean {
    const target = error.meta?.target;
    if (Array.isArray(target)) return target.includes('sourceId');
    return typeof target === 'string' && target.includes('sourceId');
  }

  private async resolveDefaultOwner(tx: WebsiteLeadTx): Promise<EmployeeOwner> {
    const configuredId = this.configService
      .get<string>('WEBSITE_LEAD_DEFAULT_OWNER_EMPLOYEE_ID')
      ?.trim();
    if (!configuredId) {
      throw new InternalServerErrorException('官网线索默认接单人未配置或不可用');
    }

    const owner = await tx.employee.findFirst({
      where: { id: configuredId, ...ACTIVE_EMPLOYEE_WHERE },
      select: { id: true, name: true },
    });

    if (!owner) {
      throw new InternalServerErrorException('官网线索默认接单人未配置或不可用');
    }
    return owner;
  }

  private async resolveActiveOwner(
    tx: WebsiteLeadTx,
    employeeId: string,
    fallback: EmployeeOwner
  ): Promise<EmployeeOwner> {
    const owner = await tx.employee.findFirst({
      where: { id: employeeId, ...ACTIVE_EMPLOYEE_WHERE },
      select: { id: true, name: true },
    });
    return owner ?? fallback;
  }

  private async findExistingCustomerByPhone(
    tx: WebsiteLeadTx,
    phone: string
  ): Promise<{ id: string; customer: CustomerForLead } | null> {
    return tx.contact.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { mobile: { equals: phone, mode: 'insensitive' } },
          { phone: { equals: phone, mode: 'insensitive' } },
        ],
        customer: { deletedAt: null, status: 'active' },
      },
      select: {
        id: true,
        customer: {
          select: {
            id: true,
            customerName: true,
            chargerId: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async createPublicCustomer(
    tx: WebsiteLeadTx,
    input: WebsiteLeadIngestInput,
    phone: string,
    owner: EmployeeOwner
  ): Promise<CustomerForLead> {
    const serialNumber = await this.serialNumberService.generate(SerialNumberType.CUSTOMER);
    // 注册比留资信息多：有公司名直接用真实公司名建档
    const customerName = isTrialSignup(input)
      ? short(input.company, 100) || `试用注册客户 ${phone.slice(-4)}`
      : `官网留资客户 ${phone.slice(-4)}`;
    const remark = this.buildRemark(input, phone);
    return tx.customer.create({
      data: {
        serialNumber,
        customerName,
        shortName: customerName,
        industry: INDUSTRY.SERVICE,
        customerLevel: CUSTOMER_LEVEL.C,
        customerSource: isTrialSignup(input)
          ? CUSTOMER_SOURCE.TRIAL_SIGNUP
          : CUSTOMER_SOURCE.WEBSITE_LEAD,
        customerRelationship: CUSTOMER_RELATIONSHIP.POTENTIAL,
        country: input.country || DEFAULT_COUNTRY,
        province: input.region || '未知',
        city: input.city || '未知',
        district: '未知',
        remark,
        chargerId: null,
        contactStatus: CONTACT_STATUS.UNTOUCHED,
        dealStatus: DEAL_STATUS.NOT_WON,
        creatorEmployeeId: owner.id,
        updaterEmployeeId: owner.id,
      },
      select: {
        id: true,
        customerName: true,
        chargerId: true,
      },
    });
  }

  private async createLeadContact(
    tx: WebsiteLeadTx,
    customerId: string,
    input: WebsiteLeadIngestInput,
    phone: string,
    owner: EmployeeOwner
  ): Promise<void> {
    await tx.contact.create({
      data: {
        customerId,
        contactName: isTrialSignup(input)
          ? short(input.name, 50) || '试用注册客户'
          : '官网留资客户',
        position: isTrialSignup(input) ? short(input.position, 50) : null,
        mobile: phone,
        remark: this.buildRemark(input, phone),
        creatorEmployeeId: owner.id,
        updaterEmployeeId: owner.id,
      },
    });
  }

  private async upsertActionItem(
    tx: WebsiteLeadTx,
    input: WebsiteLeadIngestInput,
    phone: string,
    customer: CustomerForLead,
    owner: EmployeeOwner
  ): Promise<{ id: string }> {
    const now = new Date();
    const evidence = this.buildEvidence(input, phone);
    const trial = isTrialSignup(input);
    const signupBrief = trial
      ? [input.name, input.position, input.company].filter(Boolean).join(' / ')
      : '';
    // dedupKey 两种事件共用（按手机号合流）：先留资后注册时，同一条 pending
    // 待办会被升级为「已注册待陪跑」文案，而不是并存两条。
    const data = {
      employeeId: owner.id,
      category: SALES_ACTION_ITEM_CATEGORY.WEBSITE_LEAD_NEW,
      priority: 95,
      refType: 'Customer',
      refId: customer.id,
      title: trial ? `试用已注册 ${maskPhone(phone)}` : `官网新线索 ${maskPhone(phone)}`,
      reason: trial
        ? `客户已自助注册开通试用，手机号 ${maskPhone(phone)}${signupBrief ? `（${signupBrief}）` : ''}${input.scenario ? `，直达场景：${input.scenario}` : ''}。`
        : `官网新增 1 条留资，手机号 ${maskPhone(phone)}，意向：${leadIntentText(input.channel)}。`,
      suggestedAction: trial
        ? '按试用 D0 陪跑 SOP 当天回访：确认首个场景是否跑出结果（aha），没跑通就带着客户跑一遍；处理后在本待办标记已办并同步跟进记录。'
        : '当天回电，确认公司名、岗位、需求、预算和下一步动作；处理后在本待办标记已办并同步跟进记录。',
      evidence: toJsonValue(evidence),
      confidence: SALES_ACTION_ITEM_CONFIDENCE.HIGH,
      dedupKey: `website_lead:${phone}`,
      sourceRunId: SOURCE_RUN_ID,
      createdVia: CREATED_VIA,
      updaterEmployeeId: owner.id,
    };

    const existing = await tx.salesActionItem.findFirst({
      where: {
        employeeId: owner.id,
        dedupKey: data.dedupKey,
        status: { in: PENDING_STATUSES },
        deletedAt: null,
      },
      select: { id: true },
    });

    const mergeExisting = (id: string) =>
      tx.salesActionItem.update({
        where: { id },
        data: {
          ...data,
          remindCount: { increment: 1 },
          updatedAt: now,
        },
        select: { id: true },
      });

    if (existing) return mergeExisting(existing.id);

    try {
      return await tx.salesActionItem.create({
        data: {
          ...data,
          creatorEmployeeId: owner.id,
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await tx.salesActionItem.findFirst({
          where: {
            employeeId: owner.id,
            dedupKey: data.dedupKey,
            status: { in: PENDING_STATUSES },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (raced) return mergeExisting(raced.id);
      }
      throw error;
    }
  }

  private async upsertCoordinatorActionItem(
    tx: WebsiteLeadTx,
    input: WebsiteLeadIngestInput,
    phone: string,
    customer: CustomerForLead,
    actionOwner: EmployeeOwner,
    coordinatorOwner: EmployeeOwner
  ): Promise<void> {
    if (actionOwner.id === coordinatorOwner.id) return;
    await this.upsertActionItem(tx, input, phone, customer, coordinatorOwner);
  }

  private buildEvidence(input: WebsiteLeadIngestInput, phone: string): SalesActionEvidenceInput {
    const nullableText = (value: string | null | undefined): string | null => value?.trim() || null;
    const region = [input.region, input.city].filter(Boolean).join(' · ');
    const evidence: SalesActionEvidenceInput = [
      {
        type: 'website',
        site: input.site,
        path: nullableText(input.path),
        placement: nullableText(input.placement),
        channel: nullableText(input.channel),
        phone,
        vid: nullableText(input.vid),
        sid: nullableText(input.sid),
        referrer: nullableText(input.referrer),
        refHost: nullableText(input.refHost),
        region: nullableText(input.region),
        city: nullableText(input.city),
        recordedAt:
          nullableText(input.receivedAt) ??
          nullableText(input.clientTs) ??
          new Date().toISOString(),
        excerpt: [
          isTrialSignup(input) ? '事件：自助注册开通试用' : null,
          `手机号：${maskPhone(phone)}`,
          ...signupDetailLines(input),
          isTrialSignup(input) ? null : `意向：${leadIntentText(input.channel)}`,
          input.path ? `来源页：${input.path}` : null,
          input.placement ? `位置：${input.placement}` : null,
          region ? `地区：${region}` : null,
        ]
          .filter((item): item is string => Boolean(item))
          .join('；'),
      },
    ];

    // referrer 来自公开 collector，不可信；只有统一 guard 成功才生成可点击 doc 证据。
    const sourceUrl = canonicalHttpUrlSchema.safeParse(input.referrer);
    if (sourceUrl.success) {
      evidence.push({ type: 'doc', title: '访问来源页', url: sourceUrl.data });
    }

    return salesActionEvidenceSchema.parse(evidence);
  }

  private buildRemark(input: WebsiteLeadIngestInput, phone: string): string {
    const lines = [
      isTrialSignup(input) ? '来源：自助注册试用' : '来源：官网留资',
      `手机号：${maskPhone(phone)}`,
      ...signupDetailLines(input),
      isTrialSignup(input) ? null : `意向：${leadIntentText(input.channel)}`,
      input.path ? `来源页：${input.path}` : null,
      input.placement ? `位置：${input.placement}` : null,
      input.refHost ? `来源域名：${input.refHost}` : null,
      input.utmSource
        ? `UTM：${input.utmSource}/${input.utmMedium || '-'}/${input.utmCampaign || '-'}`
        : null,
      [input.region, input.city].filter(Boolean).length
        ? `地区：${[input.region, input.city].filter(Boolean).join(' · ')}`
        : null,
      input.vid || input.sid ? `访客：vid=${input.vid || '-'} sid=${input.sid || '-'}` : null,
    ];
    return lines.filter((line): line is string => Boolean(line)).join('\n');
  }
}
