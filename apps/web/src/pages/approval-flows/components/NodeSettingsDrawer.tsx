import {
  APPROVER_TYPE,
  APPROVER_TYPE_LABELS,
  MULTI_APPROVAL_TYPE,
  MULTI_APPROVAL_TYPE_LABELS,
} from '@ky-azeroth/shared/constants';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { EmployeeMultiSelect } from '@/components/patterns/employee-multi-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AsyncSelect, Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';

import type { ApprovalFlowNodeFormData } from '../types';

interface NodeSettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: ApprovalFlowNodeFormData | null;
  nodeIndex: number | null;
  onUpdate: (node: ApprovalFlowNodeFormData) => void;
  onDelete: () => void;
  canDelete: boolean;
}

// Approver type options
const approverTypeOptions = [
  { value: APPROVER_TYPE.MEMBER, label: APPROVER_TYPE_LABELS[APPROVER_TYPE.MEMBER] || '指定人员' },
  {
    value: APPROVER_TYPE.MANAGER,
    label: APPROVER_TYPE_LABELS[APPROVER_TYPE.MANAGER] || '直属主管',
  },
  { value: APPROVER_TYPE.ROLE, label: APPROVER_TYPE_LABELS[APPROVER_TYPE.ROLE] || '指定角色' },
];

// Multi-approval type options
const multiApprovalTypeOptions = [
  {
    value: MULTI_APPROVAL_TYPE.AND,
    label: MULTI_APPROVAL_TYPE_LABELS[MULTI_APPROVAL_TYPE.AND] || '会签',
  },
  {
    value: MULTI_APPROVAL_TYPE.OR,
    label: MULTI_APPROVAL_TYPE_LABELS[MULTI_APPROVAL_TYPE.OR] || '或签',
  },
  {
    value: MULTI_APPROVAL_TYPE.SEQUENCE,
    label: MULTI_APPROVAL_TYPE_LABELS[MULTI_APPROVAL_TYPE.SEQUENCE] || '依次审批',
  },
];

// Manager level options (1-10)
const managerLevelOptions = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1} 级上级`,
}));

export function NodeSettingsDrawer({
  open,
  onOpenChange,
  node,
  nodeIndex,
  onUpdate,
  onDelete,
  canDelete,
}: NodeSettingsDrawerProps) {
  const isMobile = useIsMobile();
  const [localNode, setLocalNode] = useState<ApprovalFlowNodeFormData | null>(null);

  // Sync local state with node prop
  useEffect(() => {
    if (node) {
      setLocalNode({ ...node });
    } else {
      setLocalNode(null);
    }
  }, [node]);

  // Load roles for the AsyncSelect
  const loadRoles = useCallback(async () => {
    try {
      const response = await api.get('/roles', { params: { pageSize: 100 } });
      const roles = response.data.items;
      return roles.map((role: { id: string; name: string; code: string }) => ({
        value: role.id,
        label: `${role.name} (${role.code})`,
      }));
    } catch (error) {
      logger.error('NodeSettingsDrawer', 'Failed to load roles:', error);
      return [];
    }
  }, []);

  const updateField = <K extends keyof ApprovalFlowNodeFormData>(
    field: K,
    value: ApprovalFlowNodeFormData[K]
  ) => {
    if (!localNode) return;
    const updated = { ...localNode, [field]: value };
    setLocalNode(updated);
    onUpdate(updated);
  };

  const handleApproverTypeChange = (type: string) => {
    if (!localNode) return;
    const approverType = type as (typeof APPROVER_TYPE)[keyof typeof APPROVER_TYPE];
    const updated = {
      ...localNode,
      approverType,
      // Reset type-specific fields when changing approver type
      approverUserIds: [],
      approverRoleId: undefined,
      managerLevel: 1,
    };
    setLocalNode(updated);
    onUpdate(updated);
  };

  if (!localNode) return null;

  const isApprovalNode = localNode.nodeType === 'approval';
  const isCcNode = localNode.nodeType === 'cc';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile ? 'h-auto max-h-[80vh]' : 'w-[400px] sm:w-[400px]'}
      >
        <SheetHeader>
          <SheetTitle>
            {isCcNode ? '抄送节点设置' : '审批节点设置'}
            {nodeIndex !== null && ` (${nodeIndex + 1})`}
          </SheetTitle>
        </SheetHeader>

        <div className={`space-y-4 ${isMobile ? 'mt-4 max-h-[50vh] overflow-auto pb-4' : 'mt-6'}`}>
          {/* Node Name */}
          <div className="space-y-2">
            <Label htmlFor="node-name-input">节点名称</Label>
            <Input
              id="node-name-input"
              value={localNode.nodeName ?? ''}
              onChange={(e) => updateField('nodeName', e.target.value)}
              placeholder={isCcNode ? '如：抄送财务部' : '如：部门主管审批'}
            />
          </div>

          {/* CC Node: CC User Selection */}
          {isCcNode && (
            <div className="space-y-2">
              <Label>
                抄送人 <span className="text-destructive">*</span>
              </Label>
              <EmployeeMultiSelect
                value={localNode.ccUserIds || []}
                onChange={(value) => updateField('ccUserIds', value)}
                placeholder="选择抄送人员"
              />
            </div>
          )}

          {/* Approval Node Settings */}
          {isApprovalNode && (
            <>
              {/* Approver Type */}
              <div className="space-y-2">
                <Label>
                  审批人类型 <span className="text-destructive">*</span>
                </Label>
                <Select
                  options={approverTypeOptions}
                  value={localNode.approverType}
                  onChange={handleApproverTypeChange}
                  placeholder="选择审批人类型"
                />
              </div>

              {/* Conditional fields based on approver type */}
              {localNode.approverType === APPROVER_TYPE.MEMBER && (
                <div className="space-y-2">
                  <Label>
                    指定审批人 <span className="text-destructive">*</span>
                  </Label>
                  <EmployeeMultiSelect
                    value={localNode.approverUserIds || []}
                    onChange={(value) => updateField('approverUserIds', value)}
                    placeholder="选择审批人员"
                  />
                </div>
              )}

              {localNode.approverType === APPROVER_TYPE.ROLE && (
                <div className="space-y-2">
                  <Label>
                    指定角色 <span className="text-destructive">*</span>
                  </Label>
                  <AsyncSelect
                    loadOptions={loadRoles}
                    value={localNode.approverRoleId || null}
                    onChange={(value) => updateField('approverRoleId', value || undefined)}
                    placeholder="选择审批角色"
                  />
                </div>
              )}

              {localNode.approverType === APPROVER_TYPE.MANAGER && (
                <div className="space-y-2">
                  <Label>
                    上级层级 <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    options={managerLevelOptions}
                    value={String(localNode.managerLevel || 1)}
                    onChange={(value) => updateField('managerLevel', Number(value))}
                    placeholder="选择上级层级"
                  />
                </div>
              )}

              {/* Multi-approval Type */}
              <div className="space-y-2">
                <Label>
                  多人审批方式 <span className="text-destructive">*</span>
                </Label>
                <Select
                  options={multiApprovalTypeOptions}
                  value={localNode.multiType}
                  onChange={(value) =>
                    updateField(
                      'multiType',
                      value as (typeof MULTI_APPROVAL_TYPE)[keyof typeof MULTI_APPROVAL_TYPE]
                    )
                  }
                  placeholder="选择多人审批方式"
                />
              </div>
            </>
          )}
        </div>

        <SheetFooter className={`mt-6 ${isMobile ? 'flex-row gap-2' : ''}`}>
          {canDelete && (
            <Button
              variant="destructive"
              onClick={() => {
                onDelete();
                onOpenChange(false);
              }}
              className={isMobile ? 'flex-1' : ''}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除节点
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)} className={isMobile ? 'flex-1' : ''}>
            确定
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
