import { describe, expect, it } from 'vitest';

import { resolveOrderBy } from '../order-by.helper';

const WHITELIST = new Set(['createdAt', 'updatedAt', 'businessDate', 'paymentAmount']);
const FALLBACK = { createdAt: 'desc' as const };

describe('resolveOrderBy', () => {
  it('sortBy 命中白名单：返回 {[field]: sortOrder}', () => {
    expect(
      resolveOrderBy('businessDate', 'asc', { whitelist: WHITELIST, fallback: FALLBACK })
    ).toEqual({ businessDate: 'asc' });
  });

  it('sortBy 命中白名单且 sortOrder 缺省：默认 desc', () => {
    expect(
      resolveOrderBy('businessDate', undefined, { whitelist: WHITELIST, fallback: FALLBACK })
    ).toEqual({ businessDate: 'desc' });
  });

  it('sortBy 未命中白名单：兜底', () => {
    expect(
      resolveOrderBy('phantomField', 'asc', { whitelist: WHITELIST, fallback: FALLBACK })
    ).toBe(FALLBACK);
  });

  it('sortBy 缺省：兜底', () => {
    expect(resolveOrderBy(undefined, 'desc', { whitelist: WHITELIST, fallback: FALLBACK })).toBe(
      FALLBACK
    );
  });

  it('sortBy 为空字符串：兜底', () => {
    expect(resolveOrderBy('', 'asc', { whitelist: WHITELIST, fallback: FALLBACK })).toBe(FALLBACK);
  });

  it('防注入：__proto__ 不在白名单 → 兜底', () => {
    expect(resolveOrderBy('__proto__', 'asc', { whitelist: WHITELIST, fallback: FALLBACK })).toBe(
      FALLBACK
    );
  });

  it('防注入：constructor 不在白名单 → 兜底', () => {
    expect(resolveOrderBy('constructor', 'asc', { whitelist: WHITELIST, fallback: FALLBACK })).toBe(
      FALLBACK
    );
  });

  it('aliasMap：前端 status 映射到 Prisma loginStatus', () => {
    const aliased = resolveOrderBy('status', 'asc', {
      whitelist: new Set(['status']),
      fallback: { createdAt: 'desc' as const },
      aliasMap: { status: 'loginStatus' },
    });
    expect(aliased).toEqual({ loginStatus: 'asc' });
  });

  it('aliasMap：sortBy 未命中白名单时 alias 不生效', () => {
    const fallback = { createdAt: 'desc' as const };
    expect(
      resolveOrderBy('status', 'asc', {
        whitelist: new Set(['createdAt']), // status 不在白名单
        fallback,
        aliasMap: { status: 'loginStatus' },
      })
    ).toBe(fallback);
  });

  it('aliasMap：sortBy 命中白名单但 aliasMap 没配 → 原样返回', () => {
    expect(
      resolveOrderBy('businessDate', 'asc', {
        whitelist: WHITELIST,
        fallback: FALLBACK,
        aliasMap: { status: 'loginStatus' },
      })
    ).toEqual({ businessDate: 'asc' });
  });

  describe('nullsPolicy', () => {
    it("'nullsLast' + desc：输出 { field: { sort, nulls: 'last' } }", () => {
      expect(
        resolveOrderBy('businessDate', 'desc', {
          whitelist: WHITELIST,
          fallback: FALLBACK,
          nullsPolicy: { businessDate: 'nullsLast' },
        })
      ).toEqual({ businessDate: { sort: 'desc', nulls: 'last' } });
    });

    it("'nullsLast' + asc：仍输出 nulls: 'last'（对齐 PG 默认，显式更稳）", () => {
      expect(
        resolveOrderBy('businessDate', 'asc', {
          whitelist: WHITELIST,
          fallback: FALLBACK,
          nullsPolicy: { businessDate: 'nullsLast' },
        })
      ).toEqual({ businessDate: { sort: 'asc', nulls: 'last' } });
    });

    it("'nullsFirst' + asc：输出 nulls: 'first'", () => {
      expect(
        resolveOrderBy('businessDate', 'asc', {
          whitelist: WHITELIST,
          fallback: FALLBACK,
          nullsPolicy: { businessDate: 'nullsFirst' },
        })
      ).toEqual({ businessDate: { sort: 'asc', nulls: 'first' } });
    });

    it('对象形式：onAsc / onDesc 分别声明', () => {
      const options = {
        whitelist: WHITELIST,
        fallback: FALLBACK,
        nullsPolicy: { businessDate: { onAsc: 'first' as const, onDesc: 'last' as const } },
      };
      expect(resolveOrderBy('businessDate', 'asc', options)).toEqual({
        businessDate: { sort: 'asc', nulls: 'first' },
      });
      expect(resolveOrderBy('businessDate', 'desc', options)).toEqual({
        businessDate: { sort: 'desc', nulls: 'last' },
      });
    });

    it('对象形式：只配 onDesc → asc 走 PG 默认（不输出 nulls）', () => {
      expect(
        resolveOrderBy('businessDate', 'asc', {
          whitelist: WHITELIST,
          fallback: FALLBACK,
          nullsPolicy: { businessDate: { onDesc: 'last' } },
        })
      ).toEqual({ businessDate: 'asc' });
    });

    it('未配置 nullsPolicy 的字段：保持原 { field: order } 行为', () => {
      expect(
        resolveOrderBy('createdAt', 'desc', {
          whitelist: WHITELIST,
          fallback: FALLBACK,
          nullsPolicy: { businessDate: 'nullsLast' },
        })
      ).toEqual({ createdAt: 'desc' });
    });

    it('nullsPolicy 按「前端字段名」查，不是 alias 后的实际字段', () => {
      // 白名单接受 'status'，alias 到 'loginStatus'；nullsPolicy 必须用 'status' 而不是 'loginStatus'
      expect(
        resolveOrderBy('status', 'desc', {
          whitelist: new Set(['status']),
          fallback: FALLBACK,
          aliasMap: { status: 'loginStatus' },
          nullsPolicy: { status: 'nullsLast' },
        })
      ).toEqual({ loginStatus: { sort: 'desc', nulls: 'last' } });
    });

    it('sortBy 未命中白名单：nullsPolicy 不生效，走兜底', () => {
      expect(
        resolveOrderBy('phantomField', 'desc', {
          whitelist: WHITELIST,
          fallback: FALLBACK,
          nullsPolicy: { phantomField: 'nullsLast' },
        })
      ).toBe(FALLBACK);
    });
  });
});
