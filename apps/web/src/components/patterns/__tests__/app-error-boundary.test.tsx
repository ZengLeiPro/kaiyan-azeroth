import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from '../app-error-boundary';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

function BrokenComponent(): never {
  throw new Error('render failed');
}

describe('AppErrorBoundary', () => {
  it('渲染异常时提供可恢复界面而不是整页白屏', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <BrokenComponent />
      </AppErrorBoundary>
    );
    expect(screen.getByText('页面显示失败')).not.toBeNull();
    expect(screen.getByRole('button', { name: '重新加载' })).not.toBeNull();
    consoleError.mockRestore();
  });
});
