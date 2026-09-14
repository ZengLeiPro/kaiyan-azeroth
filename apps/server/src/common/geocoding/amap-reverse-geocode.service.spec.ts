import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AmapReverseGeocodeService } from './amap-reverse-geocode.service';

describe('AmapReverseGeocodeService', () => {
  let service: AmapReverseGeocodeService;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    const config = {
      get: vi.fn((key: string) => (key === 'AMAP_WEB_SERVICE_KEY' ? 'test-amap-key' : undefined)),
    } as unknown as ConfigService;
    service = new AmapReverseGeocodeService(config);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('已有人工地址时不请求高德，仅规范化坐标', async () => {
    await expect(
      service.ensureAddress(' 福建省泉州市丰泽区美桐街3号 ', '118.609147, 24.888068')
    ).resolves.toEqual({
      signAddress: '福建省泉州市丰泽区美桐街3号',
      signLocation: '118.609147,24.888068',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('完全没有定位信息时保持为空', async () => {
    await expect(service.ensureAddress(null, null)).resolves.toEqual({
      signAddress: null,
      signLocation: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('坐标文本由服务端反解成人类地址', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: '1',
          info: 'OK',
          regeocode: { formatted_address: '福建省泉州市晋江市陈埭镇' },
        }),
        { status: 200 }
      )
    );

    await expect(
      service.ensureAddress('纬度 24.732352, 经度 118.638586 (精度 60米)', '118.643052,24.729363')
    ).resolves.toEqual({
      signAddress: '福建省泉州市晋江市陈埭镇',
      signLocation: '118.643052,24.729363',
    });

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://restapi.amap.com/v3/geocode/regeo');
    expect(url.searchParams.get('key')).toBe('test-amap-key');
    expect(url.searchParams.get('location')).toBe('118.643052,24.729363');
    expect(url.searchParams.get('extensions')).toBe('base');
  });

  it('只有 signLocation 时也反解地址', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: '1',
          regeocode: { formatted_address: '福建省泉州市丰泽区' },
        }),
        { status: 200 }
      )
    );

    await expect(service.ensureAddress(null, '118.609147,24.888068')).resolves.toEqual({
      signAddress: '福建省泉州市丰泽区',
      signLocation: '118.609147,24.888068',
    });
  });

  it('旧客户端只有 WGS-84 坐标文本时转换为 GCJ-02 后反解', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: '1',
          regeocode: { formatted_address: '福建省泉州市晋江市' },
        }),
        { status: 200 }
      )
    );

    const result = await service.ensureAddress('纬度 24.732352, 经度 118.638586 (精度 60米)', null);

    expect(result).toEqual({
      signAddress: '福建省泉州市晋江市',
      signLocation: '118.643052,24.729363',
    });
  });

  it('非法 signLocation 直接拒绝', async () => {
    await expect(service.ensureAddress(null, 'not-a-coordinate')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未配置服务端 Key 时拒绝坐标签到', async () => {
    const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const unconfigured = new AmapReverseGeocodeService(config);

    await expect(unconfigured.ensureAddress(null, '118.609147,24.888068')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it('首次网络失败后重试成功', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: '1', regeocode: { formatted_address: '重试后的地址' } }),
          { status: 200 }
        )
      );

    await expect(service.ensureAddress(null, '118.609147,24.888068')).resolves.toEqual({
      signAddress: '重试后的地址',
      signLocation: '118.609147,24.888068',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('两次均失败时拒绝纯坐标入库', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }), {
          status: 200,
        })
      )
    );

    await expect(service.ensureAddress(null, '118.609147,24.888068')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
