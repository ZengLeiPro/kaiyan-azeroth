import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LoginForm } from '../login-form';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal('ResizeObserver', ResizeObserverMock));
afterAll(() => vi.unstubAllGlobals());

describe('LoginForm 可访问性', () => {
  it('密码可见性按钮有稳定名称和按下状态', () => {
    render(
      <MemoryRouter>
        <LoginForm />
      </MemoryRouter>
    );

    const toggle = screen.getByRole('button', { name: '显示密码' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '隐藏密码' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('校验错误与输入框建立 aria-describedby 关联', async () => {
    render(
      <MemoryRouter>
        <LoginForm />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(screen.getByLabelText('用户名').getAttribute('aria-describedby')).toBe(
        'username-error'
      );
      expect(screen.getByLabelText('密码').getAttribute('aria-describedby')).toBe('password-error');
    });
  });
});
