import { describe, expect, it, vi } from 'vitest';

import {
  getAppUpdateUrl,
  logAppUpdateApplyFailure,
  logAppUpdateCheckFailure,
  logAppUpdateRegistrationFailure,
} from './app-update';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.error, info: mocks.info },
}));

describe('getAppUpdateUrl', () => {
  it('保留当前路径、查询参数和锚点', () => {
    expect(
      getAppUpdateUrl({
        pathname: '/analytics/xiaohongshu',
        search: '?tab=campaigns',
        hash: '#overview',
      })
    ).toBe('/update.html#return=%2Fanalytics%2Fxiaohongshu%3Ftab%3Dcampaigns%23overview');
  });
});

describe('app update prompt diagnostics', () => {
  it('所有 SW 失败路径统一进入安全 logger', () => {
    const checkError = new Error('check token=secret');
    const registrationError = new Error('registration password=secret');
    const applyError = new Error('apply authorization=Bearer secret');

    logAppUpdateCheckFailure(checkError);
    logAppUpdateRegistrationFailure(registrationError);
    logAppUpdateApplyFailure(applyError);

    expect(mocks.info).toHaveBeenCalledWith(
      'AppUpdatePrompt',
      'SW update check failed',
      checkError
    );
    expect(mocks.error).toHaveBeenNthCalledWith(
      1,
      'AppUpdatePrompt',
      'SW 注册失败',
      registrationError
    );
    expect(mocks.error).toHaveBeenNthCalledWith(
      2,
      'AppUpdatePrompt',
      'SW 更新失败，回退为普通刷新',
      applyError
    );
  });
});
