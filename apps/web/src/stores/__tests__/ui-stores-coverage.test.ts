import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeaderSlotStore } from '../header-slot';
import { useMobileSideMenu } from '../mobile-menu';
import { initializeTheme, useThemeStore } from '../theme';

describe('UI stores', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    useHeaderSlotStore.setState({ slotEl: null });
    useMobileSideMenu.setState({ isOpen: false });
    useThemeStore.setState({ theme: 'light' });
    document.documentElement.className = '';
  });

  it('header slot store 保存和清空挂载节点', () => {
    const el = document.createElement('div');

    useHeaderSlotStore.getState().setSlotEl(el);
    expect(useHeaderSlotStore.getState().slotEl).toBe(el);

    useHeaderSlotStore.getState().setSlotEl(null);
    expect(useHeaderSlotStore.getState().slotEl).toBeNull();
  });

  it('mobile menu store 支持 open/close/toggle', () => {
    useMobileSideMenu.getState().open();
    expect(useMobileSideMenu.getState().isOpen).toBe(true);

    useMobileSideMenu.getState().toggle();
    expect(useMobileSideMenu.getState().isOpen).toBe(false);

    useMobileSideMenu.getState().close();
    expect(useMobileSideMenu.getState().isOpen).toBe(false);
  });

  it('theme store 应用明暗主题并在 system 模式响应系统变化', () => {
    let changeListener: (() => void) | undefined;
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (_event: 'change', listener: () => void) => {
        changeListener = listener;
      },
    }));
    vi.stubGlobal('matchMedia', matchMedia);

    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    useThemeStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    useThemeStore.getState().setTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    initializeTheme();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    changeListener?.();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
