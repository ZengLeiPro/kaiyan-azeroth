import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormModeProvider } from '@/components/patterns/form-field';

import { renderContactFields } from './contact-fields';
import type { ContactProfile } from './types';

vi.mock('@/components/patterns/related-entity-link', () => ({
  RelatedEntityLink: ({ label }: { label?: string }) => <span>{label}</span>,
}));

describe('renderContactFields', () => {
  it('详情模式展示创建人与修改人', () => {
    const entity = {
      id: 'contact-1',
      contactName: '张三',
      customerId: 'customer-1',
      customer: { id: 'customer-1', customerName: '测试客户', shortName: null },
      sex: null,
      mobile: null,
      phone: null,
      email: null,
      wechat: null,
      position: null,
      department: null,
      remark: null,
      status: 'active',
      createdBy: '王创建',
      updatedBy: '李修改',
      updatedAt: '2026-09-04T00:00:00.000Z',
    } as ContactProfile;

    render(
      <FormModeProvider mode="view">
        {renderContactFields({
          entity,
          formData: entity,
          updateFormField: vi.fn(),
          getFieldError: vi.fn(),
        })}
      </FormModeProvider>
    );

    expect(screen.getByText('创建人')).not.toBeNull();
    expect(screen.getByText('王创建')).not.toBeNull();
    expect(screen.getByText('修改人')).not.toBeNull();
    expect(screen.getByText('李修改')).not.toBeNull();
  });
});
