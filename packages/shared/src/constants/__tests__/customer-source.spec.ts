import { describe, expect, it } from 'vitest';

import { CUSTOMER_SOURCE_LABELS } from '../status-labels';
import { CUSTOMER_SOURCE } from '../status-values';

describe('CUSTOMER_SOURCE', () => {
  it('包含小红书、抖音、视频号，且与标签一一对应', () => {
    expect(CUSTOMER_SOURCE.XIAOHONGSHU).toBe('小红书');
    expect(CUSTOMER_SOURCE.DOUYIN).toBe('抖音');
    expect(CUSTOMER_SOURCE.WECHAT_CHANNELS).toBe('视频号');
    expect(CUSTOMER_SOURCE_LABELS['小红书']).toBe('小红书');
    expect(CUSTOMER_SOURCE_LABELS['抖音']).toBe('抖音');
    expect(CUSTOMER_SOURCE_LABELS['视频号']).toBe('视频号');
    expect(Object.keys(CUSTOMER_SOURCE_LABELS).sort()).toEqual(
      Object.values(CUSTOMER_SOURCE).slice().sort()
    );
  });
});
