import { describe, expect, it } from 'vitest';

import {
  canonicalHttpUrlSchema,
  SALES_ACTION_EVIDENCE_MAX_ITEMS,
  salesActionEvidenceDocSchema,
  salesActionEvidenceSchema,
  sanitizeSalesActionEvidence,
} from '../sales-action-item';

const validEvidence = {
  dingtalk: {
    type: 'dingtalk_msg' as const,
    conversationTitle: '客户项目群',
    sender: '销售A',
    sentAt: '2026-08-24T08:00:00.000Z',
    excerpt: '客户确认下周沟通',
    msgId: 'msg-1',
  },
  doc: {
    type: 'doc' as const,
    title: '方案文档',
    url: 'https://docs.example.com/plan',
  },
  calendar: {
    type: 'calendar' as const,
    summary: '客户回访',
    start: '2026-08-25T08:00:00.000Z',
  },
  crm: {
    type: 'crm' as const,
    table: 'customer',
    refId: 'customer-1',
    excerpt: '30 天无跟进',
    recordedAt: '2026-08-24T08:00:00.000Z',
  },
  website: {
    type: 'website' as const,
    site: 'example.com',
    path: '/ai-employee',
    phone: '13800138000',
    excerpt: '官网新增留资',
  },
};

describe('canonicalHttpUrlSchema', () => {
  it.each([
    ['http://example.com/document', 'http://example.com/document'],
    ['HTTPS://EXAMPLE.COM:443', 'https://example.com/'],
    [
      'https://example.com:8443/document?q=a%20b&next=%2Fcrm#section',
      'https://example.com:8443/document?q=a%20b&next=%2Fcrm#section',
    ],
    ['http://127.0.0.1:8080/a?x=1#y', 'http://127.0.0.1:8080/a?x=1#y'],
    [
      'https://[2001:db8::1]:8443/a?next=%2Fcrm%3Fid%3D1#detail',
      'https://[2001:db8::1]:8443/a?next=%2Fcrm%3Fid%3D1#detail',
    ],
    ['https://example.com/path?next=%252Fcrm', 'https://example.com/path?next=%252Fcrm'],
    ['https://example.com/%FF', 'https://example.com/%FF'],
    ['https://example.com/%D6%D0%CE%C4', 'https://example.com/%D6%D0%CE%C4'],
    ['https://example.com/%E2%28%A1', 'https://example.com/%E2%28%A1'],
  ])('accepts and returns canonical HTTP(S) href for %j', (input, expected) => {
    expect(canonicalHttpUrlSchema.parse(input)).toBe(expected);
  });

  it.each([
    ' https://example.com/doc',
    'https://example.com/doc ',
    'https://example.com/has space',
    'https://example.com/has\u00a0space',
    'https://@example.com/doc',
    'https://user@example.com/doc',
    'https://user:password@example.com/doc',
    'https:\\example.com\\doc',
    'https://example.com/path\\doc',
    'https://example.com/%5Cadmin',
    'https://example.com/%255Cadmin',
    'https://example.com/%25255Cadmin',
    'https://example.com/%',
    'https://example.com/%0',
    'https://example.com/%ZZ',
    'https://example.com/%25ZZ',
    'https://example.com/%00',
    'https://example.com/%250ASet-Cookie%253Asession%253Devil',
    'https://example.com/%250D%250ALocation%253Ahttps%253A%252F%252Fevil.example',
    'https://example.com/%0d%0aLocation%3Ahttps%3A%2F%2Fevil.example',
    'https://example.com/%E2%80%8Bhidden',
    'https://example.com/%25E2%2580%258Bhidden',
    'https://example.com/%E2%80%AEhidden',
    'https://example.com/%25E2%2580%25AEhidden',
    'https://example.com/%E2%81%A0hidden',
    'https://example.com/%25E2%2581%25A0hidden',
    'https://example.com/\u200bhidden',
    'https://example.com/\u202ehidden',
    'https://example.com/\u2060hidden',
    'https://例子.测试/document',
    'https://xn--fsqu00a.xn--0zwm56d/document',
    'https://%65xample.com/document',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '//example.com/document',
    'https:///missing-host',
  ])('rejects ambiguous or unsafe URL %j', (url) => {
    expect(canonicalHttpUrlSchema.safeParse(url).success).toBe(false);
  });

  it('fails closed when a percent projection still changes beyond the fixed layer bound', () => {
    let nestedPath = '%41';
    for (let layer = 0; layer < 32; layer += 1) nestedPath = nestedPath.replaceAll('%', '%25');

    expect(canonicalHttpUrlSchema.safeParse(`https://example.com/${nestedPath}`).success).toBe(
      false
    );
  });

  it('rejects a URL whose canonical output would exceed the fixed limit', () => {
    expect(
      canonicalHttpUrlSchema.safeParse(`https://example.com/${'a'.repeat(2048)}`).success
    ).toBe(false);
  });
});

describe('salesActionEvidenceSchema write contract', () => {
  it('accepts the exact five-source discriminated union', () => {
    expect(salesActionEvidenceSchema.parse(Object.values(validEvidence))).toEqual(
      Object.values(validEvidence)
    );
  });

  it('requires doc.url and canonicalizes it on write', () => {
    expect(
      salesActionEvidenceDocSchema.parse({
        type: 'doc',
        title: '安全文档',
        url: 'HTTPS://EXAMPLE.COM:443/doc?q=1#section',
      })
    ).toEqual({
      type: 'doc',
      title: '安全文档',
      url: 'https://example.com/doc?q=1#section',
    });
    expect(salesActionEvidenceDocSchema.safeParse({ type: 'doc', title: '无链接' }).success).toBe(
      false
    );
  });

  it.each([
    { ...validEvidence.dingtalk, url: 'https://evil.example' },
    { ...validEvidence.calendar, url: 'https://evil.example' },
    { ...validEvidence.crm, url: 'https://evil.example' },
    { ...validEvidence.website, url: 'https://evil.example' },
  ])('rejects url on every non-doc evidence variant %#', (evidence) => {
    expect(salesActionEvidenceSchema.safeParse([evidence]).success).toBe(false);
  });

  it.each([
    [{ ...validEvidence.doc, onClick: 'javascript:alert(1)' }],
    [{ ...validEvidence.crm, dangerousExtra: { url: 'javascript:alert(1)' } }],
    [{ type: 'unknown', title: '未知', url: 'https://example.com' }],
    [{ ...validEvidence.doc, title: 't'.repeat(501) }],
    [{ ...validEvidence.crm, excerpt: 'e'.repeat(5001) }],
  ])('rejects unknown types, extras, and oversized strings %#', (evidence) => {
    expect(salesActionEvidenceSchema.safeParse(evidence).success).toBe(false);
  });

  it('enforces the fixed item cap, including a 10,000-item hostile array', () => {
    const fifty = Array.from({ length: SALES_ACTION_EVIDENCE_MAX_ITEMS }, () => validEvidence.crm);
    const tenThousand = Array.from({ length: 10_000 }, () => validEvidence.crm);

    expect(salesActionEvidenceSchema.safeParse(fifty).success).toBe(true);
    expect(salesActionEvidenceSchema.safeParse([...fifty, validEvidence.crm]).success).toBe(false);
    expect(salesActionEvidenceSchema.safeParse(tenThousand).success).toBe(false);
  });
});

describe('sanitizeSalesActionEvidence legacy read contract', () => {
  it('rebuilds known variants from whitelists, degrades unsafe docs, and drops unknown values', () => {
    expect(
      sanitizeSalesActionEvidence([
        {
          type: 'doc',
          title: '危险历史文档',
          url: 'https://user:password@example.com/doc',
          extra: 'must-not-leak',
        },
        {
          type: 'doc',
          title: '双重编码危险历史文档',
          url: 'https://example.com/%250Aevil',
          extra: 'must-not-leak',
        },
        {
          type: 'doc',
          title: 'GBK 历史文档',
          url: 'https://example.com/%D6%D0%CE%C4?raw=%FF',
          extra: 'must-not-leak',
        },
        {
          type: 'doc',
          title: '安全历史文档',
          url: 'HTTPS://EXAMPLE.COM:443/doc?q=1#hash',
          extra: 'must-not-leak',
        },
        {
          ...validEvidence.crm,
          url: 'javascript:alert(1)',
          extra: { secret: true },
        },
        {
          ...validEvidence.website,
          url: 'javascript:alert(1)',
          extra: 'must-not-leak',
        },
        { type: 'unknown', title: '未知', url: 'https://example.com' },
        null,
        'not-an-object',
      ])
    ).toEqual([
      { type: 'doc', title: '危险历史文档' },
      { type: 'doc', title: '双重编码危险历史文档' },
      {
        type: 'doc',
        title: 'GBK 历史文档',
        url: 'https://example.com/%D6%D0%CE%C4?raw=%FF',
      },
      {
        type: 'doc',
        title: '安全历史文档',
        url: 'https://example.com/doc?q=1#hash',
      },
      validEvidence.crm,
      validEvidence.website,
    ]);
  });

  it('bounds hostile historical arrays to the first 50 sanitized items', () => {
    const history = Array.from({ length: 10_000 }, (_, index) => ({
      ...validEvidence.crm,
      excerpt: `历史证据 ${index}`,
      url: 'javascript:alert(1)',
    }));

    const result = sanitizeSalesActionEvidence(history);
    expect(result).toHaveLength(SALES_ACTION_EVIDENCE_MAX_ITEMS);
    expect(result?.[0]).toEqual({ ...validEvidence.crm, excerpt: '历史证据 0' });
    expect(result?.at(-1)).toEqual({ ...validEvidence.crm, excerpt: '历史证据 49' });
  });
});
