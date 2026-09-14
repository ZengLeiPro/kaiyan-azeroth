import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { MetricCard } from '../metric-card';

describe('MetricCard', () => {
  it('非 loading 状态展示指标值和提示', () => {
    render(
      <MetricCard
        label="销售额"
        value="12,345"
        hint="同比 +10%"
        icon={Activity}
        iconColor="text-blue-500"
        iconBg="bg-blue-50"
      />
    );

    expect(screen.getByText('销售额')).not.toBeNull();
    expect(screen.getByText('12,345')).not.toBeNull();
    expect(screen.getByText('同比 +10%')).not.toBeNull();
  });

  it('loading 状态隐藏指标值和提示', () => {
    render(
      <MetricCard
        label="销售额"
        value="12,345"
        hint="同比 +10%"
        icon={Activity}
        iconColor="text-blue-500"
        iconBg="bg-blue-50"
        loading
      />
    );

    expect(screen.getByText('销售额')).not.toBeNull();
    expect(screen.queryByText('12,345')).toBeNull();
    expect(screen.queryByText('同比 +10%')).toBeNull();
  });

  it('重新获取失败但保留旧数据时继续展示 KPI 并标记非最新', () => {
    render(
      <MetricCard
        label="销售额"
        value="12,345"
        icon={Activity}
        iconColor="text-blue-500"
        iconBg="bg-blue-50"
        error
        stale
      />
    );

    expect(screen.getByText('12,345')).not.toBeNull();
    expect(screen.getByText('上次成功数据，当前非最新')).not.toBeNull();
    expect(screen.queryByText('加载失败')).toBeNull();
  });
});
