import type { IProjectResponse } from '@ky-azeroth/shared/types/project';
import { describe, expect, it } from 'vitest';

import { projectFormSchema, toProjectFormData, toProjectPayload, toProjectProfile } from '../types';

const baseProject: IProjectResponse = {
  id: 'project-1',
  name: ' 项目 A ',
  description: null,
  status: 'active',
  logicalStatus: null,
  category: 'delivery',
  customerId: '11111111-1111-1111-1111-111111111111',
  customerName: '客户 A',
  ownerId: 'emp-1',
  ownerName: '负责人',
  version: 5,
};

describe('project list types converters', () => {
  it('API 响应转 Profile/FormData 时保留核心字段', () => {
    const profile = toProjectProfile(baseProject);
    const form = toProjectFormData(profile);

    expect(profile).toEqual(baseProject);
    expect(form.status).toBe('active');
    expect(form.category).toBe('delivery');
    expect(form.customerId).toBe(baseProject.customerId);
    expect(form.version).toBe(5);
  });

  it('提交 payload 时 trim 名称并保留可清空字段', () => {
    const payload = toProjectPayload({
      name: ' 项目 A ',
      description: null,
      status: 'active',
      category: null,
      customerId: null,
      ownerId: null,
      version: 5,
    });

    expect(payload.name).toBe('项目 A');
    expect(payload.category).toBeNull();
    expect(payload.customerId).toBeNull();
    expect(payload.ownerId).toBeNull();
  });

  it('前端表单 schema 对关键字段执行必填校验', () => {
    const result = projectFormSchema.safeParse({ name: '项目 A' });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(errorPaths).toEqual(
        expect.arrayContaining(['status', 'category', 'customerId', 'ownerId'])
      );
    }
  });
});
