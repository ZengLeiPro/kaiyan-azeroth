import { describe, expect, it } from 'vitest';

import { XIAOHONGSHU_DATASET_REGISTRY } from '../xiaohongshu-dataset.registry';

describe('XIAOHONGSHU_DATASET_REGISTRY', () => {
  it('完整目录的标识唯一，且保留五个本地日报层级', () => {
    const ids = XIAOHONGSHU_DATASET_REGISTRY.map((item) => item.id);
    expect(ids).toHaveLength(66);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      XIAOHONGSHU_DATASET_REGISTRY.filter((item) => item.source === 'local_report').map(
        (item) => item.defaults?.level
      )
    ).toEqual(['account', 'campaign', 'unit', 'creative', 'note']);
  });

  it('官方目录只注册 GET/POST 读取接口，不混入投放写操作', () => {
    const official = XIAOHONGSHU_DATASET_REGISTRY.filter(
      (item) => item.source === 'official_api' && item.endpoint
    );
    expect(official).toHaveLength(60);
    for (const item of official) {
      expect(['GET', 'POST']).toContain(item.method ?? 'POST');
      expect(item.endpoint).toMatch(/^(\/api\/open\/|https:\/\/ad\.xiaohongshu\.com\/)/);
      expect(item.endpoint).not.toMatch(
        /\/(?:create|update|delete|enable|disable|pause|transfer\/create)(?:\/|$)/
      );
    }
  });

  it('条件型能力在目录中明确保留原因，不把不可调用误写成零数据', () => {
    const conditional = XIAOHONGSHU_DATASET_REGISTRY.filter(
      (item) => item.availability && item.availability !== 'available'
    );
    expect(conditional.length).toBeGreaterThan(10);
    expect(conditional.every((item) => Boolean(item.availabilityReason))).toBe(true);
    expect(conditional.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'content.comment',
        'audience.package-report',
        'account.sub-account',
        'conversion.private-message-session',
      ])
    );
  });
});
