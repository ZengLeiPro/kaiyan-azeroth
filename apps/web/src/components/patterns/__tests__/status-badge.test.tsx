import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from '../status-badge';

describe('StatusBadge', () => {
  it('按 statusMap 渲染状态文案', () => {
    render(
      <StatusBadge status="active" statusMap={{ active: { label: '启用', variant: 'default' } }} />
    );

    expect(screen.getByText('启用')).not.toBeNull();
  });

  it('未知状态渲染 fallback', () => {
    render(<StatusBadge status="missing" statusMap={{}} fallback="未登记" />);

    expect(screen.getByText('未登记')).not.toBeNull();
  });
});
