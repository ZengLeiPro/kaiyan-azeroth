import { describe, expect, it } from 'vitest';

import { formatXiaohongshuDisplayValue, getXiaohongshuFieldLabel } from './xiaohongshu-display';

describe('小红书业务字段中文化', () => {
  it('已知字段中文优先，必要缩写放在中文后的括号中', () => {
    expect(getXiaohongshuFieldLabel('campaign_id', 'campaign id')).toBe('计划标识（ID）');
    expect(getXiaohongshuFieldLabel('spu_name')).toBe('标准化产品单元名称（SPU）');
    expect(getXiaohongshuFieldLabel('campaign_group_ids')).toBe('广告组标识列表（ID）');
  });

  it('新增字段按词元翻译，无法可靠翻译时使用中文兜底并保留原键', () => {
    expect(getXiaohongshuFieldLabel('deep_conversion_cost')).toBe('深度转化成本');
    expect(getXiaohongshuFieldLabel('settings')).toBe('配置详情');
    expect(getXiaohongshuFieldLabel('future_magic_metric')).toBe('其他字段（future_magic_metric）');
  });

  it('汇总元数据、嵌套字段和英文枚举均转为中文业务表达', () => {
    expect(formatXiaohongshuDisplayValue(['deep_conversion_cost'], 'unsupported_columns')).toBe(
      '["深度转化成本"]'
    );
    expect(formatXiaohongshuDisplayValue({ status: 'ACTIVE', daily_budget: 100 }, 'settings')).toBe(
      '{"状态":"已启用","每日预算":100}'
    );
  });

  it('名称和标识等真实业务值保持原样', () => {
    expect(formatXiaohongshuDisplayValue('Spring Sale', 'campaign_name')).toBe('Spring Sale');
    expect(formatXiaohongshuDisplayValue('campaign-1', 'campaign_id')).toBe('campaign-1');
  });

  it('不同原始键翻译成同名字段时仍保留全部数据', () => {
    expect(
      formatXiaohongshuDisplayValue({ creative_id: 'a', creativity_id: 'b' }, 'relations')
    ).toBe('{"创意标识（ID）":"a","创意标识（ID）（creativity_id）":"b"}');
  });
});
