import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CustomerDuplicateWarningDialog } from '../CustomerDuplicateWarningDialog';

vi.mock('@/components/mobile/ResponsiveDialog', () => ({
  ResponsiveDialog: ({ children, title }: { children: ReactNode; title?: string }) => (
    <div>
      <h2>{title}</h2>
      {children}
    </div>
  ),
}));

vi.mock('@/components/patterns/related-entity-link', () => ({
  RelatedEntityLink: ({ label }: { label?: string }) => <span>{label}</span>,
}));

describe('CustomerDuplicateWarningDialog', () => {
  it('创建时间展示到分钟 YYYY-MM-DD HH:mm', () => {
    render(
      <CustomerDuplicateWarningDialog
        open
        forceable
        duplicates={[
          {
            id: 'customer-1',
            serialNumber: 'C-001',
            customerName: '重复客户',
            shortName: null,
            uncId: null,
            organizationId: null,
            chargerId: null,
            chargerName: '销售甲',
            pool: 'public',
            accessible: true,
            matchedFields: ['customerName'],
            createdAt: new Date(2026, 8, 14, 9, 8).toISOString(),
          },
        ]}
        onCancel={vi.fn()}
        onConfirmCreate={vi.fn()}
      />
    );

    expect(screen.getByText('创建：2026-09-14 09:08')).toBeTruthy();
  });
});
