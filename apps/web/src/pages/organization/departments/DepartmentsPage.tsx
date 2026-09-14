import { DEPARTMENT_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { DEPARTMENT_STATUS } from '@ky-azeroth/shared/constants/status-values';
import type { DepartmentStatus, IDepartmentTreeNode } from '@ky-azeroth/shared/types/department';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronRight,
  Crown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DepartmentSelect } from '@/components/patterns/department-select';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { StatusBadge } from '@/components/patterns/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { invalidateAnalyticsQueries } from '@/hooks/analytics-invalidation';
import { api, getErrorMessage } from '@/lib/api';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { departmentStatusMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { type DepartmentFormData, departmentFormSchema, toDepartmentPayload } from './types';

// ==================== 部门员工项类型 ====================

interface DepartmentEmployeeItem {
  id: string;
  name: string;
  serialNumber?: string | null;
  phone?: string | null;
  position?: string | null;
  status?: string | null;
  isPrimary: boolean;
}

interface DepartmentEmployeesResponse {
  items: DepartmentEmployeeItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ==================== 树节点组件 ====================

interface TreeNodeProps {
  node: IDepartmentTreeNode;
  level: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (node: IDepartmentTreeNode) => void;
  onToggle: (id: string) => void;
}

function TreeNode({ node, level, selectedId, expandedIds, onSelect, onToggle }: TreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
          isSelected && 'bg-accent font-medium'
        )}
        style={{ paddingLeft: `${8 + level * 16}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            className="shrink-0 rounded p-0.5 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{node.name}</span>
        {node.employeeCount !== undefined && node.employeeCount > 0 && (
          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
            {node.employeeCount}
          </Badge>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== 主页面 ====================

const EMPTY_FORM: DepartmentFormData = {
  name: '',
  parentId: null,
  sortOrder: 0,
  managerId: null,
  status: DEPARTMENT_STATUS.ACTIVE,
};

export function DepartmentsPage() {
  const queryClient = useQueryClient();
  const { hasMenuPermission } = useAuthStore();
  const canCreate = hasMenuPermission('organization', 'departments', 'create');
  const canEdit = hasMenuPermission('organization', 'departments', 'edit');
  const canDelete = hasMenuPermission('organization', 'departments', 'delete');

  // 树状态
  const [selectedNode, setSelectedNode] = useState<IDepartmentTreeNode | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<DepartmentFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // 删除确认
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingNode, setDeletingNode] = useState<IDepartmentTreeNode | null>(null);

  // 员工管理状态
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [addEmployeeId, setAddEmployeeId] = useState<string>('');
  const [addEmployeeIsPrimary, setAddEmployeeIsPrimary] = useState(false);
  const [removeEmployeeOpen, setRemoveEmployeeOpen] = useState(false);
  const [removingEmployee, setRemovingEmployee] = useState<DepartmentEmployeeItem | null>(null);

  // 从树中递归查找节点
  const findNodeInTree = useCallback(
    (nodes: IDepartmentTreeNode[], id: string): IDepartmentTreeNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children?.length) {
          const found = findNodeInTree(node.children, id);
          if (found) return found;
        }
      }
      return null;
    },
    []
  );

  // 获取部门树
  const {
    data: treeData = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['departments', 'tree'],
    queryFn: async () => {
      const res = await api.get<IDepartmentTreeNode[]>('/departments/tree');
      return res.data;
    },
  });

  // 当树数据更新时，同步选中节点的最新数据
  useEffect(() => {
    if (selectedNode && treeData.length > 0) {
      const updatedNode = findNodeInTree(treeData, selectedNode.id);
      if (updatedNode) {
        setSelectedNode(updatedNode);
      }
    }
  }, [treeData, findNodeInTree]); // eslint-disable-line react-hooks/exhaustive-deps

  // 创建部门
  const createMutation = useMutation({
    mutationFn: async (data: DepartmentFormData) => {
      const payload = toDepartmentPayload(data);
      return api.post('/departments', payload);
    },
    onSuccess: async () => {
      toast.success('部门创建成功');
      setDialogOpen(false);
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['departments'] }),
        invalidateAnalyticsQueries(queryClient, '/departments'),
      ]);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, '创建失败'));
    },
  });

  // 更新部门
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: DepartmentFormData }) => {
      const payload = toDepartmentPayload(data);
      return api.put(`/departments/${id}`, payload);
    },
    onSuccess: async () => {
      toast.success('部门更新成功');
      setDialogOpen(false);
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['departments'] }),
        invalidateAnalyticsQueries(queryClient, '/departments'),
      ]);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, '更新失败'));
    },
  });

  // 删除部门
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/departments/${id}`);
    },
    onSuccess: async () => {
      toast.success('部门删除成功');
      setDeleteOpen(false);
      setDeletingNode(null);
      if (selectedNode?.id === deletingNode?.id) {
        setSelectedNode(null);
      }
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['departments'] }),
        invalidateAnalyticsQueries(queryClient, '/departments'),
      ]);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, '删除失败'));
    },
  });

  // 获取部门员工列表
  const {
    data: employeesData,
    isLoading: employeesLoading,
    refetch: refetchEmployees,
  } = useQuery({
    queryKey: ['departments', selectedNode?.id, 'employees'],
    queryFn: async () => {
      if (!selectedNode) return null;
      const res = await api.get<DepartmentEmployeesResponse>(
        `/departments/${selectedNode.id}/employees`,
        { params: { page: 1, pageSize: 100 } }
      );
      return res.data;
    },
    enabled: !!selectedNode,
  });

  // 当选中节点变化时，重新获取员工列表
  useEffect(() => {
    if (selectedNode) {
      refetchEmployees();
    }
  }, [selectedNode, refetchEmployees]);

  // 添加员工到部门
  const addEmployeeMutation = useMutation({
    mutationFn: async ({
      departmentId,
      employeeId,
      isPrimary,
    }: {
      departmentId: string;
      employeeId: string;
      isPrimary: boolean;
    }) => {
      return api.post(`/departments/${departmentId}/employees`, {
        employeeId,
        isPrimary,
      });
    },
    onSuccess: async () => {
      toast.success('员工添加成功');
      setAddEmployeeOpen(false);
      setAddEmployeeId('');
      setAddEmployeeIsPrimary(false);
      await Promise.all([
        refetchEmployees(),
        refetch(), // 刷新树以更新员工计数
        invalidateAnalyticsQueries(queryClient, '/departments'),
      ]);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, '添加员工失败'));
    },
  });

  // 从部门移除员工
  const removeEmployeeMutation = useMutation({
    mutationFn: async ({
      departmentId,
      employeeId,
    }: {
      departmentId: string;
      employeeId: string;
    }) => {
      return api.delete(`/departments/${departmentId}/employees/${employeeId}`);
    },
    onSuccess: async () => {
      toast.success('员工已移除');
      setRemoveEmployeeOpen(false);
      setRemovingEmployee(null);
      await Promise.all([
        refetchEmployees(),
        refetch(), // 刷新树以更新员工计数
        invalidateAnalyticsQueries(queryClient, '/departments'),
      ]);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, '移除员工失败'));
    },
  });

  // 展开/折叠切换
  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 选中节点
  const handleSelectNode = useCallback((node: IDepartmentTreeNode) => {
    setSelectedNode(node);
  }, []);

  // 打开新建对话框
  const handleCreate = useCallback((parentId?: string) => {
    setIsEditing(false);
    setFormData({
      ...EMPTY_FORM,
      parentId: parentId ?? null,
    });
    setFormErrors({});
    setDialogOpen(true);
  }, []);

  // 打开编辑对话框
  const handleEdit = useCallback((node: IDepartmentTreeNode) => {
    setIsEditing(true);
    setFormData({
      name: node.name,
      parentId: node.parentId ?? null,
      sortOrder: node.sortOrder,
      managerId: node.managerId ?? null,
      status: node.status,
    });
    setFormErrors({});
    setDialogOpen(true);
  }, []);

  // 打开删除确认
  const handleDeleteConfirm = useCallback((node: IDepartmentTreeNode) => {
    setDeletingNode(node);
    setDeleteOpen(true);
  }, []);

  // 打开添加员工对话框
  const handleAddEmployee = useCallback(() => {
    setAddEmployeeId('');
    setAddEmployeeIsPrimary(false);
    setAddEmployeeOpen(true);
  }, []);

  // 打开移除员工确认
  const handleRemoveEmployeeConfirm = useCallback((employee: DepartmentEmployeeItem) => {
    setRemovingEmployee(employee);
    setRemoveEmployeeOpen(true);
  }, []);

  // 提交添加员工
  const handleAddEmployeeSubmit = useCallback(() => {
    if (!selectedNode || !addEmployeeId) {
      toast.error('请选择要添加的员工'); // @validation-ok: 操作前置状态检查，非表单字段验证
      return;
    }
    addEmployeeMutation.mutate({
      departmentId: selectedNode.id,
      employeeId: addEmployeeId,
      isPrimary: addEmployeeIsPrimary,
    });
  }, [selectedNode, addEmployeeId, addEmployeeIsPrimary, addEmployeeMutation]);

  // 表单字段更新
  const updateField = useCallback(
    <K extends keyof DepartmentFormData>(field: K, value: DepartmentFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // 清除该字段的错误
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    []
  );

  // 提交表单
  const handleSubmit = useCallback(() => {
    // 验证
    const result = departmentFormSchema.safeParse(formData);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = String(issue.path[0]);
        if (!errors[field]) {
          errors[field] = issue.message;
        }
      });
      setFormErrors(errors);
      const firstError = result.error.issues[0]?.message;
      if (firstError) {
        toast.error(firstError); // @validation-ok: Zod 验证失败后展示第一个错误信息
      }
      return;
    }

    if (isEditing && selectedNode) {
      updateMutation.mutate({ id: selectedNode.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }, [formData, isEditing, selectedNode, createMutation, updateMutation]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex h-full gap-4 md:p-6">
      {/* 左侧 - 部门树 */}
      <Card className="w-72 shrink-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-medium">部门结构</CardTitle>
          {canCreate && (
            <Button size="sm" variant="outline" onClick={() => handleCreate()}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              新建
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : treeData.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无部门数据，点击"新建"开始创建
            </div>
          ) : (
            <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
              {treeData.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  level={0}
                  selectedId={selectedNode?.id ?? null}
                  expandedIds={expandedIds}
                  onSelect={handleSelectNode}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 右侧 - 部门详情 */}
      <Card className="flex-1">
        {selectedNode ? (
          <>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">{selectedNode.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">部门详细信息</p>
              </div>
              <div className="flex items-center gap-2">
                {canCreate && (
                  <Button size="sm" variant="outline" onClick={() => handleCreate(selectedNode.id)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    子部门
                  </Button>
                )}
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => handleEdit(selectedNode)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    编辑
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteConfirm(selectedNode)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    删除
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">部门名称</p>
                  <p className="text-sm">{selectedNode.name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">状态</p>
                  <StatusBadge status={selectedNode.status} statusMap={departmentStatusMap} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">负责人</p>
                  <p className="text-sm">{selectedNode.manager?.name || '-'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">员工数量</p>
                  <div className="flex items-center gap-1 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedNode.employeeCount ?? 0} 人</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">排序</p>
                  <p className="text-sm">{selectedNode.sortOrder}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">子部门数量</p>
                  <p className="text-sm">{selectedNode.children?.length ?? 0} 个</p>
                </div>
                {selectedNode.createdAt && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">创建时间</p>
                    <p className="text-sm">
                      {formatDateTimeDisplay(selectedNode.createdAt) || '-'}
                    </p>
                  </div>
                )}
                {selectedNode.lastSyncAt && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">最近同步</p>
                    <p className="text-sm">
                      {formatDateTimeDisplay(selectedNode.lastSyncAt) || '-'}
                    </p>
                  </div>
                )}
              </div>

              {/* 同步信息 */}
              {(selectedNode.dingtalkDeptId !== undefined ||
                selectedNode.createDeptGroup !== undefined ||
                selectedNode.autoAddUser !== undefined) && (
                <div className="mt-6 space-y-3 border-t pt-4">
                  <h4 className="text-sm font-medium text-muted-foreground">钉钉同步信息</h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">钉钉部门ID</p>
                      <p className="text-sm">
                        {selectedNode.dingtalkDeptId != null
                          ? String(selectedNode.dingtalkDeptId)
                          : '-'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">创建群组</p>
                      <p className="text-sm">
                        {selectedNode.createDeptGroup !== undefined
                          ? selectedNode.createDeptGroup
                            ? '是'
                            : '否'
                          : '-'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">自动添加用户</p>
                      <p className="text-sm">
                        {selectedNode.autoAddUser !== undefined
                          ? selectedNode.autoAddUser
                            ? '是'
                            : '否'
                          : '-'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">钉钉父部门ID</p>
                      <p className="text-sm">
                        {selectedNode.dingtalkParentId != null
                          ? String(selectedNode.dingtalkParentId)
                          : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 部门员工列表 */}
              <div className="mt-6 space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    部门员工（{employeesData?.total ?? 0} 人）
                  </h4>
                  <Button size="sm" variant="outline" onClick={handleAddEmployee}>
                    <UserPlus className="mr-1 h-3.5 w-3.5" />
                    添加员工
                  </Button>
                </div>
                {employeesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !employeesData?.items?.length ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    暂无员工，点击"添加员工"将员工加入该部门
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[140px]">姓名</TableHead>
                          <TableHead className="w-[120px]">工号</TableHead>
                          <TableHead className="w-[120px]">职位</TableHead>
                          <TableHead className="w-[120px]">手机号</TableHead>
                          <TableHead className="w-[60px] text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employeesData.items.map((emp) => (
                          <TableRow key={emp.id}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-1.5">
                                {emp.name}
                                {emp.isPrimary && (
                                  <span title="主部门">
                                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {emp.serialNumber || '-'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {emp.position || '-'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {emp.phone || '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleRemoveEmployeeConfirm(emp)}
                                title="移除员工"
                              >
                                <UserMinus className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex h-full items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Building2 className="mx-auto mb-3 h-12 w-12 opacity-50" />
              <p>请从左侧选择一个部门查看详情</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 新建/编辑部门对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? '编辑部门' : '新建部门'}</DialogTitle>
          </DialogHeader>
          <FormModeProvider mode={isEditing ? 'edit' : 'create'}>
            <div className="space-y-4 py-4">
              <FormField name="name" label="部门名称" required error={formErrors.name}>
                <Input
                  id="name"
                  placeholder="请输入部门名称"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                />
              </FormField>

              <FormField name="parentId" label="上级部门" error={formErrors.parentId}>
                <DepartmentSelect
                  value={formData.parentId ?? ''}
                  onChange={(val) =>
                    updateField('parentId', typeof val === 'string' && val ? val : null)
                  }
                  placeholder="选择上级部门（可选）"
                  clearable
                />
              </FormField>

              <FormField name="managerId" label="部门负责人" error={formErrors.managerId}>
                <EmployeeSelect
                  value={formData.managerId ?? ''}
                  onChange={(val) => updateField('managerId', val || null)}
                  placeholder="选择部门负责人（可选）"
                  clearable
                />
              </FormField>

              <FormField name="status" label="状态" error={formErrors.status}>
                <SelectRoot
                  value={formData.status ?? DEPARTMENT_STATUS.ACTIVE}
                  onValueChange={(val: string) => updateField('status', val as DepartmentStatus)}
                >
                  <SelectTrigger id="status">
                    <SelectValue placeholder="请选择状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEPARTMENT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </FormField>

              <FormField name="sortOrder" label="排序" error={formErrors.sortOrder}>
                <Input
                  id="sortOrder"
                  type="number"
                  placeholder="排序序号"
                  value={formData.sortOrder ?? 0}
                  onChange={(e) => updateField('sortOrder', parseInt(e.target.value, 10) || 0)}
                />
              </FormField>
            </div>
          </FormModeProvider>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除部门"
              {deletingNode?.name}
              "吗？此操作不可撤销。
              {deletingNode?.children && deletingNode.children.length > 0 && (
                <span className="mt-1 block font-medium text-destructive">
                  该部门下有 {deletingNode.children.length} 个子部门，请先处理子部门。
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingNode) {
                  deleteMutation.mutate(deletingNode.id);
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 添加员工对话框 */}
      <Dialog open={addEmployeeOpen} onOpenChange={setAddEmployeeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加员工到「{selectedNode?.name}」</DialogTitle>
          </DialogHeader>
          <FormModeProvider mode="create">
            <div className="space-y-4 py-4">
              <FormField name="employeeId" label="选择员工" required>
                <EmployeeSelect
                  value={addEmployeeId}
                  onChange={(val) => setAddEmployeeId(val)}
                  placeholder="搜索并选择员工"
                />
              </FormField>
              <div className="flex items-center gap-2">
                <input
                  id="isPrimary"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={addEmployeeIsPrimary}
                  onChange={(e) => setAddEmployeeIsPrimary(e.target.checked)}
                />
                <label htmlFor="isPrimary" className="text-sm text-muted-foreground">
                  设为主部门
                </label>
              </div>
            </div>
          </FormModeProvider>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddEmployeeOpen(false)}
              disabled={addEmployeeMutation.isPending}
            >
              取消
            </Button>
            <Button
              onClick={handleAddEmployeeSubmit}
              disabled={addEmployeeMutation.isPending || !addEmployeeId}
            >
              {addEmployeeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 移除员工确认 */}
      <AlertDialog open={removeEmployeeOpen} onOpenChange={setRemoveEmployeeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除员工</AlertDialogTitle>
            <AlertDialogDescription>
              确定要将员工「{removingEmployee?.name}」从部门「{selectedNode?.name}」中移除吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeEmployeeMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedNode && removingEmployee) {
                  removeEmployeeMutation.mutate({
                    departmentId: selectedNode.id,
                    employeeId: removingEmployee.id,
                  });
                }
              }}
              disabled={removeEmployeeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeEmployeeMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
