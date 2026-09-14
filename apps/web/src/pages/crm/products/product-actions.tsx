import { PackageX } from 'lucide-react';

import { createStandardActions } from '@/components/patterns/row-actions-helpers';

import type { CrmProductProfile } from './types';

interface CreateCrmProductActionsOptions {
  onView: (product: CrmProductProfile) => void;
  onEdit: (product: CrmProductProfile) => void;
  onDelete: (product: CrmProductProfile) => void;
  onOffSale: (product: CrmProductProfile) => void;
  canEdit: boolean;
  canDelete: boolean;
}

export function createCrmProductActions({
  onView,
  onEdit,
  onDelete,
  onOffSale,
  canEdit,
  canDelete,
}: CreateCrmProductActionsOptions) {
  return createStandardActions<CrmProductProfile>({
    onView,
    onEdit,
    onDelete,
    hideEdit: !canEdit,
    hideDelete: !canDelete,
    extraActions: canEdit
      ? [
          {
            key: 'off-sale',
            label: '下架',
            icon: <PackageX className="h-4 w-4" />,
            onClick: onOffSale,
            hidden: (product) => product.productStatus === 'off_sale',
          },
        ]
      : [],
  });
}
