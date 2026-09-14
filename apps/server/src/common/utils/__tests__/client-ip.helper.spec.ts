import { describe, expect, it } from 'vitest';

import { extractClientIp } from '../client-ip.helper';

describe('extractClientIp', () => {
  it('XFF 单值场景：取 XFF 即可', () => {
    expect(extractClientIp({ headers: { 'x-forwarded-for': '9.9.9.9' }, ip: '127.0.0.1' })).toBe(
      '9.9.9.9'
    );
  });

  it('XFF 多值场景：取首段并 trim', () => {
    expect(
      extractClientIp({
        headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 172.16.0.1' },
        ip: '127.0.0.1',
      })
    ).toBe('1.2.3.4');
  });

  it('XFF 缺失场景：回退 request.ip', () => {
    expect(extractClientIp({ headers: {}, ip: '203.0.113.5' })).toBe('203.0.113.5');
  });

  it('XFF 与 request.ip 均缺失：回退 socket.remoteAddress', () => {
    expect(extractClientIp({ headers: {}, socket: { remoteAddress: '198.51.100.7' } })).toBe(
      '198.51.100.7'
    );
  });

  it('::ffff: 前缀剥除（XFF 命中）', () => {
    expect(extractClientIp({ headers: { 'x-forwarded-for': '::ffff:21.0.0.1' } })).toBe('21.0.0.1');
  });

  it('::ffff: 前缀剥除（回退到 request.ip）', () => {
    expect(extractClientIp({ ip: '::ffff:172.16.0.5' })).toBe('172.16.0.5');
  });

  it('XFF 是数组：取第一项', () => {
    expect(extractClientIp({ headers: { 'x-forwarded-for': ['5.5.5.5', '6.6.6.6'] } })).toBe(
      '5.5.5.5'
    );
  });

  it('全部缺失：返回 undefined', () => {
    expect(extractClientIp({ headers: {} })).toBeUndefined();
    expect(extractClientIp(undefined)).toBeUndefined();
  });

  it('XFF 是空字符串：回退 request.ip', () => {
    expect(extractClientIp({ headers: { 'x-forwarded-for': '' }, ip: '127.0.0.1' })).toBe(
      '127.0.0.1'
    );
  });
});
