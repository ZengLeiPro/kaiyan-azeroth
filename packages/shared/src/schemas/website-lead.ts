import { z } from 'zod';

export const websiteLeadIngestSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(96).optional(),
    /**
     * lead_submit = 官网留资（collector 推送）；
     * trial_signup = leads.example.com 自助注册试用（agent-saas 推送）。
     * 两者按手机号在 CRM 合流为同一客户旅程。
     */
    event: z.enum(['lead_submit', 'trial_signup']),
    site: z.string().trim().min(1).max(255),
    phone: z.string().trim().min(1).max(50),
    // ---- trial_signup 专有（注册表单比留资信息多） ----
    name: z.string().trim().max(50).optional().nullable(),
    position: z.string().trim().max(50).optional().nullable(),
    company: z.string().trim().max(100).optional().nullable(),
    /** 场景直达：官网场景页带来的场景库 id */
    scenario: z.string().trim().max(80).optional().nullable(),
    /** agent-saas 试用租户 id */
    tenantId: z.string().trim().max(80).optional().nullable(),
    path: z.string().trim().max(512).optional().nullable(),
    pageType: z.string().trim().max(80).optional().nullable(),
    title: z.string().trim().max(200).optional().nullable(),
    placement: z.string().trim().max(120).optional().nullable(),
    channel: z.string().trim().max(120).optional().nullable(),
    vid: z.string().trim().max(80).optional().nullable(),
    sid: z.string().trim().max(80).optional().nullable(),
    clientTs: z.string().trim().max(64).optional().nullable(),
    receivedAt: z.string().trim().max(64).optional().nullable(),
    // 安全校验必须看到 collector 原值；文本落库副本如需清理，由消费侧另行 trim。
    referrer: z.string().max(1024).optional().nullable(),
    refHost: z.string().trim().max(255).optional().nullable(),
    utmSource: z.string().trim().max(200).optional().nullable(),
    utmMedium: z.string().trim().max(200).optional().nullable(),
    utmCampaign: z.string().trim().max(200).optional().nullable(),
    utmTerm: z.string().trim().max(200).optional().nullable(),
    utmContent: z.string().trim().max(200).optional().nullable(),
    country: z.string().trim().max(80).optional().nullable(),
    region: z.string().trim().max(80).optional().nullable(),
    city: z.string().trim().max(80).optional().nullable(),
    isp: z.string().trim().max(80).optional().nullable(),
    raw: z.record(z.unknown()).optional().nullable(),
  })
  .passthrough();

export type WebsiteLeadIngestInput = z.infer<typeof websiteLeadIngestSchema>;
