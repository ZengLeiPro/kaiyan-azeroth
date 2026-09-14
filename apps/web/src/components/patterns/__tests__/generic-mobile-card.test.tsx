import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GenericMobileCard } from '../generic-mobile-card';

describe('GenericMobileCard interactions', () => {
  it('正文与独立标题按钮各点击详情一次，标题按钮支持键盘', () => {
    const onClick = vi.fn();
    render(
      <GenericMobileCard
        title="移动客户"
        fields={[{ label: '负责人', value: '销售甲' }]}
        onClick={onClick}
        testId="mobile-card"
      />
    );

    const card = screen.getByTestId('mobile-card');
    const detailButton = screen.getByRole('button', { name: '移动客户' });

    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('tabindex')).toBeNull();
    detailButton.focus();
    expect(document.activeElement).toBe(detailButton);

    expect(detailButton.tagName).toBe('BUTTON');
    fireEvent.click(screen.getByText('销售甲'));
    fireEvent.click(detailButton);

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('内嵌按钮不会触发卡片详情，且不存在交互容器嵌套按钮', () => {
    const onClick = vi.fn();
    const onAction = vi.fn();
    render(
      <GenericMobileCard title="含操作卡片" onClick={onClick} testId="action-card">
        <button type="button" onClick={onAction}>
          独立操作
        </button>
      </GenericMobileCard>
    );

    const card = screen.getByTestId('action-card');
    const action = screen.getByRole('button', { name: '独立操作' });
    fireEvent.click(action);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(card.querySelector('[role="button"] button')).toBeNull();
    expect(card.querySelector('button button')).toBeNull();
  });
});
