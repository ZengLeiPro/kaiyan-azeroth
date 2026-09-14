import { parseXiaohongshuScopes } from '../xiaohongshu-scope.utils';

describe('parseXiaohongshuScopes', () => {
  it.each([
    [
      'JSON 数组',
      '["report_service","ad_query","ad_manage","account_manage"]',
      ['report_service', 'ad_query', 'ad_manage', 'account_manage'],
    ],
    [
      '逗号与空格分隔',
      'user_info,advertiser.read advertiser.write',
      ['user_info', 'advertiser.read', 'advertiser.write'],
    ],
  ])('解析%s格式', (_label, scope, expected) => {
    expect(parseXiaohongshuScopes(scope)).toEqual(expected);
  });

  it('未返回 scope 时保留调用方的回退逻辑', () => {
    expect(parseXiaohongshuScopes(undefined)).toBeUndefined();
    expect(parseXiaohongshuScopes('  ')).toBeUndefined();
  });
});
