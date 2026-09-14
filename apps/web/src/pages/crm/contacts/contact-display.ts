import { GENDER_LABELS } from '@ky-azeroth/shared/constants/status-labels';

import { formatDateTimeDisplay } from '@/lib/date-utils';

import type { ContactProfile } from './types';

export const CONTACT_COLUMN_CONFIG = [
  { key: 'contactName', label: '联系人', visible: true, canHide: false },
  { key: 'customerName', label: '所属客户', visible: true },
  { key: 'sex', label: '性别', visible: true },
  { key: 'mobile', label: '手机号', visible: true },
  { key: 'phone', label: '电话', visible: true },
  { key: 'position', label: '职位', visible: true },
  { key: 'email', label: '邮箱', visible: true },
  { key: 'wechat', label: '微信', visible: true },
  { key: 'department', label: '部门', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'remark', label: '备注', visible: false },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'createdBy', label: '创建人', visible: true },
  { key: 'updatedAt', label: '最近修改', visible: true },
  { key: 'updatedBy', label: '修改人', visible: true },
];

export function getContactMobileFields(item: ContactProfile) {
  return [
    { label: '所属客户', value: item.customer?.customerName || '-' },
    {
      label: '性别',
      value: item.sex ? GENDER_LABELS[item.sex as keyof typeof GENDER_LABELS] || item.sex : '-',
    },
    { label: '手机号', value: item.mobile || '-' },
    { label: '电话', value: item.phone || '-' },
    { label: '职位', value: item.position || '-' },
    { label: '邮箱', value: item.email || '-' },
    { label: '微信', value: item.wechat || '-' },
    { label: '创建人', value: item.createdBy || '-' },
    { label: '最近修改', value: formatDateTimeDisplay(item.updatedAt) || '-' },
    { label: '修改人', value: item.updatedBy || '-' },
  ];
}
