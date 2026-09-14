import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DrawerContentErrorBoundary } from '../DrawerContentErrorBoundary';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('DrawerContentErrorBoundary', () => {
  it('子组件渲染异常时显示局部错误提示，底层内容保留', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <p>底层列表</p>
        <DrawerContentErrorBoundary entryKey="drawer-1">
          <Boom message="render 失败" />
        </DrawerContentErrorBoundary>
      </div>
    );

    expect(screen.getByText('底层列表')).toBeTruthy();
    expect(screen.getByText('详情展示失败，请重试。')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('重试复位错误态，子树重新挂载', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Recoverable() {
      if (shouldThrow) throw new Error('第一次失败');
      return <p>恢复后的内容</p>;
    }

    render(
      <DrawerContentErrorBoundary entryKey="drawer-1">
        <Recoverable />
      </DrawerContentErrorBoundary>
    );

    expect(screen.getByText('详情展示失败，请重试。')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));

    await waitFor(() => {
      expect(screen.getByText('恢复后的内容')).toBeTruthy();
    });
    consoleError.mockRestore();
  });

  it('entryKey 切换后新记录不继承失败态', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <DrawerContentErrorBoundary entryKey="drawer-1">
        <Boom message="A 失败" />
      </DrawerContentErrorBoundary>
    );
    expect(screen.getByText('详情展示失败，请重试。')).toBeTruthy();

    // 从失败的 A 切到 B：B 正常渲染，不显示错误态
    rerender(
      <DrawerContentErrorBoundary entryKey="drawer-2">
        <p>记录 B 内容</p>
      </DrawerContentErrorBoundary>
    );

    await waitFor(() => {
      expect(screen.getByText('记录 B 内容')).toBeTruthy();
    });
    expect(screen.queryByText('详情展示失败，请重试。')).toBeNull();
    consoleError.mockRestore();
  });
});
