import { describe, expect, it } from 'vitest';

import { isDingtalkTokenInvalidResponse } from './dingtalk-errors';

describe('钉钉错误分类', () => {
  it('errcode=88 且 subCode/subMsg 指向 access token 时才判定 token 失效', () => {
    expect(
      isDingtalkTokenInvalidResponse({
        errcode: 88,
        errmsg: '鉴权异常',
        subCode: 'InvalidAccessToken',
        subMsg: 'access token invalid',
      })
    ).toBe(true);
  });

  it('裸 errcode=88 不等于 token 失效', () => {
    expect(
      isDingtalkTokenInvalidResponse({
        errcode: 88,
        errmsg: '鉴权异常',
      })
    ).toBe(false);
  });

  it('非 88 即使文本包含 token 也不走 88 的刷新分支', () => {
    expect(
      isDingtalkTokenInvalidResponse({
        errcode: 60011,
        subCode: 'InvalidAccessToken',
        subMsg: 'access token invalid',
      })
    ).toBe(false);
  });
});
