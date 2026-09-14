import type {
  IXiaohongshuSummaryResponse,
  IXiaohongshuTrendResponse,
  XiaohongshuMetricCoverageStatus,
} from '@ky-azeroth/shared/types';

export type XiaohongshuSignalTone = 'critical' | 'warning' | 'info' | 'positive';

export interface XiaohongshuOperatingSignal {
  title: string;
  evidence: string;
  action: string;
  target: 'delivery' | 'content' | 'leads';
  tone: XiaohongshuSignalTone;
}

export interface XiaohongshuTrendSeriesPoint {
  date: string;
  fee: number | null;
  click: number | null;
  interaction: number | null;
  messageConsult: number | null;
  messageLead: number | null;
  formSubmit: number | null;
  ctr: number | null;
  cpc: number | null;
  cpi: number | null;
  messageConsultCost: number | null;
}

const numberValue = (value: unknown): number | null => {
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed) ? null : parsed;
};

const coveredNumber = (
  value: unknown,
  coverage?: XiaohongshuMetricCoverageStatus
): number | null => (coverage === 'unavailable' ? null : numberValue(value));

const formatChange = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '无法比较';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
};

const formatCount = (value: number): string => value.toLocaleString('zh-CN');

export function buildXiaohongshuOperatingSignals(
  data?: IXiaohongshuSummaryResponse
): XiaohongshuOperatingSignal[] {
  if (!data) return [];
  const current = data.totals;
  const previous = data.comparison?.totals;
  const signals: XiaohongshuOperatingSignal[] = [];
  const consultCoverage = current.metricCoverage.messageConsult;
  const leadCoverage = current.metricCoverage.messageLead;
  const formCoverage = current.metricCoverage.formSubmit;
  const consult = coveredNumber(current.messageConsult, consultCoverage);
  const lead = coveredNumber(current.messageLead, leadCoverage);
  const form = coveredNumber(current.formSubmit, formCoverage);
  const feeChange = data.deltas?.fee?.changeRate;
  const consultChange = data.deltas?.messageConsult?.changeRate;

  if (
    consult != null &&
    feeChange != null &&
    feeChange > 0.1 &&
    consultChange != null &&
    consultChange <= 0
  ) {
    signals.push({
      title: '增投没有传到咨询',
      evidence: `消费环比 ${formatChange(feeChange)}，私信咨询环比 ${formatChange(consultChange)}`,
      action: '先按创意查看高消费零咨询项，再决定是否继续放量。',
      target: 'delivery',
      tone: 'critical',
    });
  }

  if (consult != null && previous && current.click > 0 && previous.click > 0) {
    const currentRate = consult / current.click;
    const previousConsult = coveredNumber(
      previous.messageConsult,
      previous.metricCoverage.messageConsult
    );
    const previousRate = previousConsult == null ? null : previousConsult / previous.click;
    if (previousRate != null && previousRate > 0 && currentRate < previousRate * 0.8) {
      signals.push({
        title: '点击增加，但咨询转化走弱',
        evidence: `点击到咨询从 ${(previousRate * 100).toFixed(2)}% 降至 ${(currentRate * 100).toFixed(2)}%`,
        action: '重点复盘搜索意图、素材承诺和私信承接，不把便宜点击直接当成好流量。',
        target: 'content',
        tone: 'warning',
      });
    }
  }

  const acquisitionSample = (consult ?? 0) + (form ?? 0);
  if (consult != null && form != null && acquisitionSample < 10) {
    signals.push({
      title: '获客样本仍小',
      evidence: `当前只有 ${formatCount(consult)} 次私信咨询、${formatCount(form)} 次表单提交`,
      action: '把结论视为排查线索，不依据单日或单条记录直接扩大预算。',
      target: 'leads',
      tone: 'info',
    });
  }

  if (consult != null && form != null && consult > 0 && form === 0) {
    signals.push({
      title: '当前转化集中在私信链路',
      evidence: `${formatCount(consult)} 次私信咨询，表单提交为 0${lead == null ? '' : `，私信留资 ${formatCount(lead)} 次`}`,
      action: '私信与表单分开复盘；表单为 0 不等于整个渠道没有转化。',
      target: 'leads',
      tone: 'info',
    });
  }

  if (signals.length === 0) {
    signals.push({
      title: '本期未触发确定性经营提示',
      evidence: '现有完整指标没有出现“增投但咨询下降”等明确冲突',
      action: '继续按层级查看消费贡献与转化覆盖，不把未触发提示理解为效果优秀。',
      target: 'delivery',
      tone: 'positive',
    });
  }

  return signals.slice(0, 3);
}

function eachDate(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end)
    return [];
  const dates: string[] = [];
  for (const cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function buildXiaohongshuTrendSeries(
  data?: IXiaohongshuTrendResponse
): XiaohongshuTrendSeriesPoint[] {
  if (!data) return [];
  const byDate = new Map(data.points.map((point) => [point.date, point]));
  return eachDate(data.range.startDate, data.range.endDate).map((date) => {
    const point = byDate.get(date);
    if (!point) {
      return {
        date,
        fee: null,
        click: null,
        interaction: null,
        messageConsult: null,
        messageLead: null,
        formSubmit: null,
        ctr: null,
        cpc: null,
        cpi: null,
        messageConsultCost: null,
      };
    }
    return {
      date,
      fee: numberValue(point.fee),
      click: numberValue(point.click),
      interaction: numberValue(point.interaction),
      messageConsult: coveredNumber(point.messageConsult, point.metricCoverage.messageConsult),
      messageLead: coveredNumber(point.messageLead, point.metricCoverage.messageLead),
      formSubmit: coveredNumber(point.formSubmit, point.metricCoverage.formSubmit),
      ctr: numberValue(point.ctr),
      cpc: numberValue(point.cpc),
      cpi: numberValue(point.cpi),
      messageConsultCost: coveredNumber(
        point.messageConsultCost,
        point.metricCoverage.messageConsult
      ),
    };
  });
}
