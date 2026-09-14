import { describe, expect, it } from 'vitest';

import { parseInvoiceSubjects, serializeInvoiceSubjects } from '../types';

describe('开票业务摘要多选值', () => {
  it('支持解析当前与历史分隔符，并去除重复空值', () => {
    expect(parseInvoiceSubjects('软件开发服务费、技术服务费，软件开发服务费, 培训费')).toEqual([
      '软件开发服务费',
      '技术服务费',
      '培训费',
    ]);
  });

  it('序列化为稳定的中文分隔格式', () => {
    expect(serializeInvoiceSubjects(['软件开发服务费', ' 技术服务费 ', '软件开发服务费'])).toBe(
      '软件开发服务费、技术服务费'
    );
  });
});
