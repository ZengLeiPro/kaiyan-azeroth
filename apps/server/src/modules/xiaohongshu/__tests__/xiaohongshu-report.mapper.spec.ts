import { parseXiaohongshuReportRow } from '../xiaohongshu-report.mapper';

describe('parseXiaohongshuReportRow', () => {
  it('安全解析日报行、互动指标并写入传入的数据口径', () => {
    const parsed = parseXiaohongshuReportRow(
      {
        time: '2026-08-20',
        creativity_id: 'creative-1',
        creativity_name: '素材一',
        campaign_id: 'campaign-1',
        unit_id: 'unit-1',
        fee: '12.34',
        impression: '100',
        click: Number.NaN,
        interaction: 'invalid',
        like: '8',
        comment: '4',
        collect: '6',
        follow: '2',
        share: '1',
        ctr: '0.25',
      },
      'creative',
      'advertiser-1',
      1
    );
    expect(parsed).toEqual(
      expect.objectContaining({
        entityId: 'creative-1',
        creativeId: 'creative-1',
        creativeName: '素材一',
        impression: 100,
        click: 0,
        interaction: 0,
        like: 8,
        comment: 4,
        collect: 6,
        follow: 2,
        share: 1,
        dataCaliber: 1,
      })
    );
    expect(Number(parsed?.fee)).toBe(12.34);
    expect(Number(parsed?.ctr)).toBe(0.25);
    expect(JSON.stringify(parsed?.rawPayload)).not.toContain('NaN');
  });

  it('统一解析账户与明细层的获客转化字段并保留缺失值', () => {
    const account = parseXiaohongshuReportRow(
      {
        time: '2026-08-20',
        landing_page_visit: '12',
        leads_button_impression: '10',
        leads: '3',
        valid_leads: '2',
        message_user: '4',
        message_consult: '5',
        initiative_message: '6',
        msg_leads_num: '1',
      },
      'account',
      'advertiser-1',
      0
    );
    const campaign = parseXiaohongshuReportRow(
      {
        time: '2026-08-20',
        campaign_id: 'campaign-1',
        landing_page_pv: '8',
        landing_form_imp_num: '7',
        msg_leads_form_submit_num: '9',
      },
      'campaign',
      'advertiser-1',
      1
    );

    expect(account).toEqual(
      expect.objectContaining({
        landingPageVisit: 12,
        formImpression: 10,
        formSubmit: 3,
        validFormSubmit: 2,
        combinedLead: null,
        messageUser: 4,
        messageConsult: 5,
        messageOpen: 6,
        messageLead: 1,
        dataCaliber: 0,
      })
    );
    expect(campaign).toEqual(
      expect.objectContaining({
        landingPageVisit: 8,
        formImpression: 7,
        formSubmit: null,
        combinedLead: 9,
        messageLead: null,
        dataCaliber: 1,
      })
    );
  });

  it('以笔记 ID 和标题作为实体并完整保留笔记原始字段', () => {
    const row = {
      time: '2026-08-20',
      note_id: 123456,
      note_title: '夏日新品笔记',
      note_image: 'https://example.com/cover.jpg',
      note_jump_url: 'https://www.xiaohongshu.com/explore/123456',
      custom_metric: { nested: true },
    };

    const parsed = parseXiaohongshuReportRow(row, 'note', 'advertiser-1', 0);

    expect(parsed).toEqual(
      expect.objectContaining({
        level: 'note',
        entityId: '123456',
        entityName: '夏日新品笔记',
        rawPayload: row,
      })
    );
  });

  it('将官方百分号格式的 CTR 规范化为小数比率', () => {
    const parsed = parseXiaohongshuReportRow(
      { time: '2026-08-20', ctr: '12.47%' },
      'account',
      'advertiser-1',
      0
    );
    expect(Number(parsed?.ctr)).toBe(0.1247);
  });

  it('缺少日期或层级实体 ID 时丢弃行', () => {
    expect(parseXiaohongshuReportRow({ time: 'bad' }, 'campaign', 'adv', 0)).toBeNull();
  });
});
