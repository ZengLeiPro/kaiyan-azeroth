import { AlertTriangle, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  SelectContent,
  SelectItem,
  SelectRoot as Select,
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
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

// 系统参数接口
interface SystemParam {
  id: string;
  code: string;
  name: string;
  value: string;
  type: 'number' | 'text' | 'boolean';
  group: string;
  description: string;
  unit?: string;
  updatedAt: string;
  updatedBy?: string;
}

// 分类名称映射
const groupLabels: Record<string, string> = {
  库存设置: '库存管理',
  生产设置: '生产管理',
  财务设置: '财务管理',
  系统设置: '系统通用',
  基础设置: '基础设置',
  采购设置: '采购设置',
  门店设置: '门店设置',
  研发设置: '研发设置',
  通知设置: '通知设置',
};

export function SettingsPage() {
  const isMobile = useIsMobile();
  const [params, setParams] = useState<SystemParam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editedParams, setEditedParams] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // 加载系统参数
  const loadParams = async () => {
    setLoading(true);
    try {
      const response = await api.get('/system-params');
      const data = response.data.items;
      setParams(data);
      // 初始化编辑状态
      const initialValues: Record<string, string> = {};
      data.forEach((param: SystemParam) => {
        initialValues[param.code] = param.value;
      });
      setEditedParams(initialValues);
      setHasChanges(false);
    } catch {
      toast.error('加载系统参数失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadParams();
  }, []);

  // 处理参数值变更
  const handleValueChange = (key: string, value: string) => {
    setEditedParams((prev) => ({
      ...prev,
      [key]: value,
    }));

    // 检查是否有变更
    const param = params.find((p) => p.code === key);
    if (param) {
      const originalValues: Record<string, string> = {};
      params.forEach((p) => {
        originalValues[p.code] = p.value;
      });
      const newValues = { ...originalValues, [key]: value };
      const hasAnyChange = params.some((p) => newValues[p.code] !== p.value);
      setHasChanges(hasAnyChange);
    }
  };

  // 保存所有变更
  const handleSave = async () => {
    setSaving(true);
    try {
      // 找出所有变更的参数
      const changedParams = params.filter((param) => editedParams[param.code] !== param.value);

      // 逐个保存变更
      for (const param of changedParams) {
        await api.put(`/system-params/${param.id}`, {
          value: editedParams[param.code],
        });
      }

      toast.success('系统参数已保存');
      await loadParams(); // 重新加载以获取最新数据
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 重置变更
  const handleReset = () => {
    const originalValues: Record<string, string> = {};
    params.forEach((param) => {
      originalValues[param.code] = param.value;
    });
    setEditedParams(originalValues);
    setHasChanges(false);
    toast.info('已重置所有变更');
  };

  // 按分类分组参数
  const groupedParams = params.reduce(
    (acc, param) => {
      const group = param.group || '系统设置';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(param);
      return acc;
    },
    {} as Record<string, SystemParam[]>
  );

  // 渲染参数输入
  const renderParamInput = (param: SystemParam) => {
    const value = editedParams[param.code] ?? param.value;
    const isChanged = value !== param.value;

    if (param.type === 'boolean') {
      return (
        <div className="flex items-center gap-2">
          <Select value={value} onValueChange={(val) => handleValueChange(param.code, val)}>
            <SelectTrigger className="h-9 w-full" data-testid={`param-input-${param.code}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">是</SelectItem>
              <SelectItem value="false">否</SelectItem>
            </SelectContent>
          </Select>
          {isChanged && <span className="text-xs text-orange-500">*</span>}
        </div>
      );
    }

    // 对于 number 类型，验证值是否为有效数字，否则回退到 text 类型
    const isValidNumber = param.type === 'number' && value !== '' && !isNaN(Number(value));
    const inputType = isValidNumber ? 'number' : 'text';

    return (
      <div className="flex items-center gap-2">
        <Input
          type={inputType}
          value={value}
          onChange={(e) => handleValueChange(param.code, e.target.value)}
          className={isChanged ? 'border-orange-500' : ''}
          data-testid={`param-input-${param.code}`}
        />
        {param.unit && (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{param.unit}</span>
        )}
        {isChanged && <span className="text-xs text-orange-500">*</span>}
      </div>
    );
  };

  // 渲染移动端参数卡片
  const renderMobileParamCard = (param: SystemParam) => {
    const value = editedParams[param.code] ?? param.value;
    const isChanged = value !== param.value;

    return (
      <Card key={param.id} className={cn(isChanged && 'border-orange-500')}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{param.name}</span>
            {isChanged && <span className="text-xs text-orange-500">*</span>}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{param.code}</code>
          <div>{renderParamInput(param)}</div>
          <div className="text-xs text-muted-foreground">{param.description}</div>
        </CardContent>
      </Card>
    );
  };

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile && hasChanges}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            actions={
              !isMobile && (
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <div className="flex items-center gap-2 text-sm text-orange-500">
                      <AlertTriangle className="h-4 w-4" />
                      <span>有未保存的变更</span>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={!hasChanges || saving}
                    data-testid="reset-params-btn"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    重置
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                    data-testid="save-params-btn"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? '保存中...' : '保存'}
                  </Button>
                </div>
              )
            }
          />
        }
      >
        {/* 参数列表 - 按分类分组 */}
        {loading ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <div className="text-muted-foreground">加载中...</div>
          </div>
        ) : params.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <div className="text-muted-foreground">暂无系统参数</div>
          </div>
        ) : isMobile ? (
          <div className="space-y-6">
            {Object.entries(groupedParams).map(([group, groupParams]) => (
              <div key={group}>
                <h2 className="mb-3 font-semibold" data-testid={`group-${group}`}>
                  {groupLabels[group] || group}
                </h2>
                <div className="space-y-3">
                  {groupParams.map((param) => renderMobileParamCard(param))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedParams).map(([group, groupParams]) => (
              <div key={group} className="rounded-lg border bg-card">
                <div className="border-b bg-muted/30 px-4 py-3">
                  <h2 className="font-semibold" data-testid={`group-${group}`}>
                    {groupLabels[group] || group}
                  </h2>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">参数名称</TableHead>
                      <TableHead className="w-[150px]">参数键</TableHead>
                      <TableHead className="w-[200px]">参数值</TableHead>
                      <TableHead>说明</TableHead>
                      <TableHead className="w-[150px]">更新时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupParams.map((param) => (
                      <TableRow key={param.id} data-testid={`param-row-${param.code}`}>
                        <TableCell className="font-medium">{param.name}</TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {param.code}
                          </code>
                        </TableCell>
                        <TableCell>{renderParamInput(param)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {param.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {param.updatedAt ? formatDateTimeDisplay(param.updatedAt) || '-' : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </StandardLayout>
      {isMobile && hasChanges && (
        <MobileBottomBar>
          <Button variant="outline" onClick={handleReset} disabled={saving}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重置
          </Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
