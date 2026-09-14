import type { IEmployeeResponse } from '@ky-azeroth/shared/types/employee';
import { describe, expect, it } from 'vitest';

import { toEmployeeFormData, toEmployeePayload, toEmployeeProfile } from '../types';

const baseEmployee: IEmployeeResponse = {
  id: 'emp-1',
  serialNumber: 'E0001',
  name: '李四',
  phone: null,
  email: null,
  gender: null,
  entryDate: '2026-06-25T00:00:00.000Z',
  position: null,
  hourlyRate: 123.45,
  status: 'active',
  avatar: null,
  departments: [
    { id: 'rel-1', departmentId: 'dep-1', departmentName: '技术部', isPrimary: true },
    { id: 'rel-2', departmentId: 'dep-2', departmentName: '交付部', isPrimary: false },
  ],
  primaryDepartment: {
    id: 'rel-1',
    departmentId: 'dep-1',
    departmentName: '技术部',
    isPrimary: true,
  },
  version: 4,
};

describe('employee types converters', () => {
  it('Profile 规范日期、Decimal，并汇总部门展示字段', () => {
    const profile = toEmployeeProfile(baseEmployee);

    expect(profile.entryDate).toBe('2026-06-25');
    expect(profile.hourlyRate).toBe(123.45);
    expect(profile.departmentName).toBe('技术部');
    expect(profile.departmentNames).toBe('技术部, 交付部');
  });

  it('FormData 回填部门 ID、主部门和 version', () => {
    const form = toEmployeeFormData(toEmployeeProfile(baseEmployee));

    expect(form.departmentIds).toEqual(['dep-1', 'dep-2']);
    expect(form.primaryDepartmentId).toBe('dep-1');
    expect(form.version).toBe(4);
  });

  it('Payload trim 姓名并把 Decimal 字段字符串化', () => {
    const payload = toEmployeePayload({
      name: ' 李四 ',
      phone: null,
      email: null,
      gender: null,
      entryDate: '2026-06-25',
      position: null,
      hourlyRate: 123.45,
      status: 'active',
      avatar: null,
      departmentIds: ['dep-1'],
      primaryDepartmentId: 'dep-1',
      version: 4,
    });

    expect(payload.name).toBe('李四');
    expect(payload.hourlyRate).toBe('123.45');
    expect(payload.departmentIds).toEqual(['dep-1']);
  });
});
