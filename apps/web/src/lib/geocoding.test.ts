import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: mocks.warn },
}));

type GeocoderCallback = (
  status: string,
  result?: { regeocode?: { formattedAddress?: string } }
) => void;

async function importReverseGeocode() {
  const { reverseGeocode } = await import('./geocoding');
  return reverseGeocode;
}

function getAppendedAmapScript(appendChild: ReturnType<typeof vi.spyOn>): HTMLScriptElement {
  const script = appendChild.mock.calls.find(
    (call: unknown[]) => call[0] instanceof HTMLScriptElement
  )?.[0];
  expect(script).toBeInstanceOf(HTMLScriptElement);
  return script as HTMLScriptElement;
}

function installSuccessfulAMap(address = '福建省泉州市丰泽区') {
  const getAddress = vi.fn((_location: [number, number], callback: GeocoderCallback) => {
    callback('complete', { regeocode: { formattedAddress: address } });
  });

  window.AMap = {
    Geocoder: class {
      getAddress = getAddress;
    },
  } as never;

  return getAddress;
}

describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_AMAP_WEB_KEY', 'test-key');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete window.AMap;
    delete window._AMapSecurityConfig;
    document.head
      .querySelectorAll('script[src^="https://webapi.amap.com/maps"]')
      .forEach((script) => script.remove());
  });

  it('Geocoder 调用异常走统一 logger 且仍安全回退坐标', async () => {
    const error = new Error('geocoder authorization=Bearer secret');
    window.AMap = {
      Geocoder: class {
        constructor() {
          throw error;
        }
      },
    } as never;
    const reverseGeocode = await importReverseGeocode();

    const result = await reverseGeocode({ longitude: 118.6, latitude: 24.9 });

    expect(result.address).toBeNull();
    expect(result.location).toMatch(/^118\.\d{6},24\.\d{6}$/);
    expect(mocks.warn).toHaveBeenCalledWith('Geocoding', 'Geocoder 调用异常', error);
  });

  it('signal 在调用前已中止时立即 AbortError，且不启动共享 SDK 加载', async () => {
    vi.useFakeTimers();
    const appendChild = vi.spyOn(document.head, 'appendChild');
    const controller = new AbortController();
    controller.abort();
    const reverseGeocode = await importReverseGeocode();

    await expect(
      reverseGeocode({ longitude: 118.6, latitude: 24.9, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(appendChild).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('延迟 script load 时一调用中止立即拒绝，另一调用继续复用共享加载', async () => {
    vi.useFakeTimers();
    const appendChild = vi.spyOn(document.head, 'appendChild');
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const reverseGeocode = await importReverseGeocode();

    const abortedCall = reverseGeocode({
      longitude: 118.6,
      latitude: 24.9,
      signal: controller.signal,
    });
    const continuingCall = reverseGeocode({ longitude: 118.6, latitude: 24.9 });
    const script = getAppendedAmapScript(appendChild);

    controller.abort();
    await expect(abortedCall).rejects.toMatchObject({ name: 'AbortError' });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    // 未推进 6 秒 fake timer 便已拒绝；共享加载定时器仍然存在，未被当前中止污染。
    expect(vi.getTimerCount()).toBe(1);

    const getAddress = installSuccessfulAMap();
    script.onload?.(new Event('load'));

    await expect(continuingCall).resolves.toMatchObject({
      address: '福建省泉州市丰泽区',
    });
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(getAddress).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('SDK 刚完成但当前调用的 await 尚未续跑时中止，仍以 AbortError 胜出', async () => {
    vi.useFakeTimers();
    const appendChild = vi.spyOn(document.head, 'appendChild');
    const controller = new AbortController();
    const reverseGeocode = await importReverseGeocode();
    const currentCall = reverseGeocode({
      longitude: 118.6,
      latitude: 24.9,
      signal: controller.signal,
    });
    const script = getAppendedAmapScript(appendChild);
    const getAddress = installSuccessfulAMap();

    script.onload?.(new Event('load'));
    controller.abort();

    await expect(currentCall).rejects.toMatchObject({ name: 'AbortError' });
    expect(getAddress).not.toHaveBeenCalled();

    await expect(reverseGeocode({ longitude: 118.6, latitude: 24.9 })).resolves.toMatchObject({
      address: '福建省泉州市丰泽区',
    });
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(getAddress).toHaveBeenCalledTimes(1);
  });
});
