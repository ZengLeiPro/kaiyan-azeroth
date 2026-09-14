import type { IProjectMemberResponse } from '@ky-azeroth/shared/types/project';
import { Loader2, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { EmployeeSelect } from '@/components/patterns/employee-select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { EmployeeOption } from '@/hooks/use-employee-search';
import { api, getErrorMessage } from '@/lib/api';

interface ProjectMemberSectionProps {
  projectId: string;
  isViewMode: boolean;
}

export function ProjectMemberSection({ projectId, isViewMode }: ProjectMemberSectionProps) {
  const [members, setMembers] = useState<IProjectMemberResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');

  // 已有成员的 employeeId 列表，用于 EmployeeSelect 的 excludeIds
  const existingUserIds = members.map((m) => m.employeeId).filter((id): id is string => !!id);

  // 获取项目成员列表
  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.get<IProjectMemberResponse[]>(`/projects/${projectId}/members`);
      setMembers(res.data);
    } catch (err) {
      toast.error('获取成员列表失败: ' + getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // 添加成员
  const handleAddMember = async (employee: EmployeeOption | null) => {
    if (!employee) return;
    setAddingMember(true);
    try {
      await api.post(`/projects/${projectId}/members`, {
        employeeId: employee.id,
        userName: employee.name,
        role: null,
      });
      toast.success(`已添加成员: ${employee.name}`);
      setSelectedEmployeeId('');
      setShowAddForm(false);
      await fetchMembers();
    } catch (err) {
      toast.error('添加成员失败: ' + getErrorMessage(err));
    } finally {
      setAddingMember(false);
    }
  };

  // 移除成员
  const handleRemoveMember = async (member: IProjectMemberResponse) => {
    if (!Number.isInteger(member.version) || (member.version ?? 0) < 1) {
      toast.error('成员数据版本缺失，请刷新后重试');
      await fetchMembers();
      return;
    }
    setRemovingMemberId(member.id);
    try {
      await api.delete(`/projects/${projectId}/members/${member.id}`, {
        params: { version: member.version },
      });
      toast.success(`已移除成员: ${member.userName || '未知'}`);
      await fetchMembers();
    } catch (err) {
      toast.error('移除成员失败: ' + getErrorMessage(err));
    } finally {
      setRemovingMemberId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <Users className="h-4 w-4" />
          项目成员 ({members.length})
        </Label>
        {!isViewMode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            disabled={addingMember}
          >
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            添加成员
          </Button>
        )}
        {isViewMode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            disabled={addingMember}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加
          </Button>
        )}
      </div>

      {/* 添加成员表单 */}
      {showAddForm && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
          <div className="flex-1">
            <EmployeeSelect
              value={selectedEmployeeId}
              onChange={setSelectedEmployeeId}
              onSelect={handleAddMember}
              placeholder="搜索并选择员工..."
              excludeIds={existingUserIds}
            />
          </div>
          {addingMember && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* 成员列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          暂无项目成员，点击"添加"按钮添加成员
        </div>
      ) : (
        <div className="space-y-1.5">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {(member.userName || '?')[0]}
                </div>
                <div>
                  <span className="font-medium">{member.userName || '未知成员'}</span>
                  {member.role && (
                    <span className="ml-2 text-xs text-muted-foreground">({member.role})</span>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemoveMember(member)}
                disabled={removingMemberId === member.id}
              >
                {removingMemberId === member.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
