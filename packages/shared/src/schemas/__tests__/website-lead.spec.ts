import { describe, expect, it } from 'vitest';

import { websiteLeadIngestSchema } from '../website-lead';

const baseInput = {
  event: 'lead_submit' as const,
  site: 'example.com',
  phone: '13800138000',
};

describe('websiteLeadIngestSchema referrer input contract', () => {
  it.each([' https://example.com/source', 'https://example.com/source '])(
    'preserves security-sensitive referrer whitespace for the downstream URL guard: %j',
    (referrer) => {
      expect(websiteLeadIngestSchema.parse({ ...baseInput, referrer }).referrer).toBe(referrer);
    }
  );

  it('continues to trim ordinary text fields independently of referrer validation', () => {
    expect(
      websiteLeadIngestSchema.parse({
        ...baseInput,
        site: ' example.com ',
        referrer: ' https://example.com/source ',
      })
    ).toEqual({
      ...baseInput,
      site: 'example.com',
      referrer: ' https://example.com/source ',
    });
  });
});
