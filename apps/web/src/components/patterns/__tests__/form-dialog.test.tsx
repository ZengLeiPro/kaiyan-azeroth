import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormDialog } from '../form-dialog';
import { useFormMode } from '../form-field';

const mobileState = vi.hoisted(() => ({ value: false }));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobileState.value }));

vi.mock('@/components/mobile/ResponsiveDialog', () => ({
  ResponsiveDialog: ({
    title,
    description,
    headerAction,
    footer,
    children,
  }: {
    title: string;
    description?: string;
    headerAction?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      <div data-testid="header-action">{headerAction}</div>
      <main>{children}</main>
      <div data-testid="footer">{footer}</div>
    </section>
  ),
}));

vi.mock('../change-log-panel', () => ({
  ChangeLogPanel: () => <aside>变更记录</aside>,
}));

function ModeProbe() {
  const { mode } = useFormMode();
  return <span>mode:{mode}</span>;
}

describe('FormDialog', () => {
  it('查看模式在桌面端把编辑/删除/关闭放入 header，并注入 view 模式上下文', () => {
    mobileState.value = false;
    const onModeChange = vi.fn();
    const onDelete = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <FormDialog
        open
        onOpenChange={onOpenChange}
        title="客户详情"
        mode="view"
        onModeChange={onModeChange}
        onDelete={onDelete}
        changeLogTarget={{ module: 'customer', target: 'c1' }}
      >
        <ModeProbe />
      </FormDialog>
    );

    expect(screen.getByRole('heading', { name: '客户详情' })).toBeTruthy();
    expect(screen.getByText('mode:view')).toBeTruthy();
    expect(screen.getByText('变更记录')).toBeTruthy();

    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('关闭'));

    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('编辑模式展示编辑标题、保存按钮 loading 态，并在移动端放入 footer', () => {
    mobileState.value = true;
    const onSubmit = vi.fn();

    render(
      <FormDialog
        open
        onOpenChange={vi.fn()}
        title="客户详情"
        mode="edit"
        onSubmit={onSubmit}
        loading
      >
        <ModeProbe />
      </FormDialog>
    );

    expect(screen.getByRole('heading', { name: '编辑客户' })).toBeTruthy();
    expect(screen.getByText('mode:edit')).toBeTruthy();
    expect(screen.getByTestId('header-action').textContent).toBe('');
    expect(screen.getByTestId('footer').textContent).toContain('处理中...');
    expect(screen.getByText('处理中...')).toHaveProperty('disabled', true);
  });

  it('自定义 footer 会接管标准操作按钮', () => {
    render(
      <FormDialog
        open
        onOpenChange={vi.fn()}
        title="客户"
        mode="create"
        footer={<button type="button">自定义保存</button>}
      >
        <ModeProbe />
      </FormDialog>
    );

    expect(screen.getByText('自定义保存')).toBeTruthy();
    expect(screen.queryByText('创建')).toBeNull();
  });
});
