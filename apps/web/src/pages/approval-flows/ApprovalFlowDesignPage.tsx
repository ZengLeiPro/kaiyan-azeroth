import { APPROVAL_EVENT_REGISTRY, APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import { ArrowLeft, FileText, Loader2, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { EmployeeMultiSelect } from '@/components/patterns/employee-multi-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, getErrorMessage } from '@/lib/api';

import { FlowCanvas } from './components/FlowCanvas';
import { NodeSettingsDrawer } from './components/NodeSettingsDrawer';
import {
  type ApprovalFlowFormData,
  approvalFlowFormSchema,
  type ApprovalFlowNodeFormData,
  createEmptyApprovalFlowFormData,
  createEmptyNodeFormData,
  type FlowNodeType,
  toApprovalFlowFormData,
  toApprovalFlowPayload,
  toApprovalFlowProfile,
  toApprovalFlowUpdatePayload,
} from './types';

// Event type options - 从注册表自动生成
const eventTypeOptions = Object.entries(APPROVAL_EVENT_REGISTRY).map(([key, config]) => ({
  value: key,
  label: config.label,
}));

export function ApprovalFlowDesignPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isNew = id === 'new';
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<ApprovalFlowFormData>(createEmptyApprovalFlowFormData());
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [flowInfoDrawerOpen, setFlowInfoDrawerOpen] = useState(false);

  const loadFlow = useCallback(
    async (flowId: string) => {
      try {
        setLoading(true);
        const response = await api.get(`/approval-flows/${flowId}`);
        const profile = toApprovalFlowProfile(response.data);
        const data = toApprovalFlowFormData(profile);
        setFormData(data);
      } catch (error) {
        toast.error(getErrorMessage(error, '加载流程失败'));
        navigate('/approval/flows');
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  // Load existing flow
  useEffect(() => {
    if (!isNew && id) {
      loadFlow(id);
    }
  }, [isNew, id, loadFlow]);

  // Update form field
  const updateField = <K extends keyof ApprovalFlowFormData>(
    field: K,
    value: ApprovalFlowFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Handle node select
  const handleNodeSelect = useCallback((index: number) => {
    setSelectedNodeIndex(index);
    setDrawerOpen(true);
  }, []);

  // Handle node update
  const handleNodeUpdate = useCallback(
    (node: ApprovalFlowNodeFormData) => {
      if (selectedNodeIndex === null) return;
      const newNodes = [...formData.nodes];
      newNodes[selectedNodeIndex] = node;
      updateField('nodes', newNodes);
    },
    [selectedNodeIndex, formData.nodes]
  );

  // Handle node delete
  const handleNodeDelete = useCallback(
    (index: number) => {
      if (formData.nodes.length <= 1) {
        toast.error('至少需要一个审批节点'); // @validation-ok: 操作前置状态检查，非表单字段验证
        return;
      }
      const newNodes = formData.nodes.filter((_, i) => i !== index);
      // Update node orders
      newNodes.forEach((node, i) => {
        node.nodeOrder = i + 1;
      });
      setFormData((prev) => ({ ...prev, nodes: newNodes }));
      setDrawerOpen(false);
      setSelectedNodeIndex(null);
    },
    [formData.nodes]
  );

  // Handle add node
  const handleAddNode = useCallback(
    (afterIndex: number, nodeType: FlowNodeType) => {
      const newNode = createEmptyNodeFormData(afterIndex + 2, nodeType);
      const newNodes = [
        ...formData.nodes.slice(0, afterIndex + 1),
        newNode,
        ...formData.nodes.slice(afterIndex + 1),
      ];
      // Update node orders
      newNodes.forEach((node, i) => {
        node.nodeOrder = i + 1;
      });
      setFormData((prev) => ({ ...prev, nodes: newNodes }));
      // Select the new node
      setSelectedNodeIndex(afterIndex + 1);
      setDrawerOpen(true);
    },
    [formData.nodes]
  );

  // Handle save
  const handleSave = async () => {
    const result = approvalFlowFormSchema.safeParse(formData);
    if (!result.success) {
      const errorMsg = result.error.errors[0]?.message || '表单验证失败';
      toast.error(errorMsg);
      return;
    }

    try {
      setSaving(true);
      if (isNew) {
        const payload = toApprovalFlowPayload(formData);
        await api.post('/approval-flows', payload);
        toast.success('创建成功');
      } else {
        const payload = toApprovalFlowUpdatePayload(formData);
        await api.put(`/approval-flows/${id}`, payload);
        toast.success('新版本已创建并激活');
      }
      navigate('/approval/flows');
    } catch (error) {
      toast.error(getErrorMessage(error, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  // Handle back - 从审批设置跳转过来时返回审批设置
  const handleBack = () => {
    const from = searchParams.get('from');
    navigate(from === 'settings' ? '/approval/settings' : '/approval/flows');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedNode =
    selectedNodeIndex !== null ? (formData.nodes[selectedNodeIndex] ?? null) : null;

  return (
    <div className="-m-6 flex flex-col md:m-0" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-2 md:gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="text-base font-medium md:text-lg">
            {isNew ? '新建流程' : '编辑流程'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 移动端显示流程信息按钮 */}
          {isMobile && (
            <Button variant="outline" size="sm" onClick={() => setFlowInfoDrawerOpen(true)}>
              <FileText className="mr-1.5 h-4 w-4" />
              信息
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} size={isMobile ? 'sm' : 'default'}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            保存
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Form (PC only) */}
        {!isMobile && (
          <div className="w-80 shrink-0 overflow-auto border-r bg-background p-4">
            <div className="space-y-4">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">
                  流程名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="如：采购订单审批流程"
                />
              </div>

              {/* Event Type */}
              <div className="space-y-2">
                <Label>
                  事件类型 <span className="text-destructive">*</span>
                </Label>
                <Select
                  options={eventTypeOptions}
                  value={formData.eventType}
                  onChange={(value) =>
                    updateField(
                      'eventType',
                      value as (typeof APPROVAL_EVENT_TYPE)[keyof typeof APPROVAL_EVENT_TYPE]
                    )
                  }
                  placeholder="选择事件类型"
                  disabled={!isNew}
                />
                {!isNew && (
                  <p className="text-xs text-muted-foreground">
                    编辑时无法更改事件类型，将创建新版本
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="流程描述（可选）"
                  rows={3}
                />
              </div>

              {/* Copy To (Default CC Users) */}
              <div className="space-y-2">
                <Label>默认抄送人</Label>
                <EmployeeMultiSelect
                  value={formData.copyToIds}
                  onChange={(value) => updateField('copyToIds', value)}
                  placeholder="选择抄送人员（可选）"
                />
                <p className="text-xs text-muted-foreground">
                  此流程触发的审批将自动抄送给选中的人员
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Right side - Flow Canvas */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <FlowCanvas
            nodes={formData.nodes}
            selectedIndex={selectedNodeIndex}
            onNodeSelect={handleNodeSelect}
            onNodeDelete={handleNodeDelete}
            onAddNode={handleAddNode}
          />
        </div>
      </div>

      {/* Mobile: Flow Info Drawer */}
      {isMobile && (
        <Sheet open={flowInfoDrawerOpen} onOpenChange={setFlowInfoDrawerOpen}>
          <SheetContent side="bottom" className="h-auto max-h-[80vh]">
            <SheetHeader>
              <SheetTitle>流程信息</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4 pb-4">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name-mobile">
                  流程名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name-mobile"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="如：采购订单审批流程"
                />
              </div>

              {/* Event Type */}
              <div className="space-y-2">
                <Label>
                  事件类型 <span className="text-destructive">*</span>
                </Label>
                <Select
                  options={eventTypeOptions}
                  value={formData.eventType}
                  onChange={(value) =>
                    updateField(
                      'eventType',
                      value as (typeof APPROVAL_EVENT_TYPE)[keyof typeof APPROVAL_EVENT_TYPE]
                    )
                  }
                  placeholder="选择事件类型"
                  disabled={!isNew}
                />
                {!isNew && (
                  <p className="text-xs text-muted-foreground">
                    编辑时无法更改事件类型，将创建新版本
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description-mobile">描述</Label>
                <Textarea
                  id="description-mobile"
                  value={formData.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="流程描述（可选）"
                  rows={3}
                />
              </div>

              {/* Copy To (Default CC Users) */}
              <div className="space-y-2">
                <Label>默认抄送人</Label>
                <EmployeeMultiSelect
                  value={formData.copyToIds}
                  onChange={(value) => updateField('copyToIds', value)}
                  placeholder="选择抄送人员（可选）"
                />
                <p className="text-xs text-muted-foreground">
                  此流程触发的审批将自动抄送给选中的人员
                </p>
              </div>

              {/* Confirm button */}
              <Button className="w-full" onClick={() => setFlowInfoDrawerOpen(false)}>
                确定
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Node Settings Drawer */}
      <NodeSettingsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        node={selectedNode}
        nodeIndex={selectedNodeIndex}
        onUpdate={handleNodeUpdate}
        onDelete={() => selectedNodeIndex !== null && handleNodeDelete(selectedNodeIndex)}
        canDelete={formData.nodes.length > 1}
      />
    </div>
  );
}

export default ApprovalFlowDesignPage;
