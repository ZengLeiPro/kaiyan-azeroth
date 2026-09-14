import { MODULES } from '@ky-azeroth/shared/constants';
import { describe, expect, it } from 'vitest';

import { menuGroups } from '../menu-config';

describe('菜单访问约束', () => {
  it('不再使用 superAdminOnly / adminOnly 硬编码显隐', () => {
    for (const [moduleKey, module] of Object.entries(MODULES)) {
      for (const [menuKey, menu] of Object.entries(module.menus)) {
        expect(menu).not.toHaveProperty('superAdminOnly');
        void moduleKey;
        void menuKey;
      }
    }
    for (const group of menuGroups) {
      expect(group).not.toHaveProperty('adminOnly');
      expect(group).not.toHaveProperty('superAdminOnly');
      for (const item of group.items) {
        expect(item).not.toHaveProperty('adminOnly');
        expect(item).not.toHaveProperty('superAdminOnly');
      }
    }
  });
});
