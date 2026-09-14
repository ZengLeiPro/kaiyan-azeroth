import { useState } from 'react';

import { Select } from '@/components/ui/select';

import { LoginLogView } from './LoginLogView';
import { OperationLogView } from './OperationLogView';

type LogType = 'operation' | 'login';

const logTypeOptions = [
  { value: 'operation' as const, label: '操作日志' },
  { value: 'login' as const, label: '登录日志' },
];

/**
 * 系统日志页（合并操作日志 + 登录日志）
 *
 * 顶部"日志类型"下拉切换两类日志：
 * - operation：业务模块写操作（OperationLogInterceptor 自动记录）
 * - login：登录/登出/失败（auth.service 直接写 LoginLog）
 *
 * 切换日志类型时，子视图会重新挂载，filter / pagination 自动重置。
 */
export function OperationLogsPage() {
  const [logType, setLogType] = useState<LogType>('operation');

  const logTypeSelector = (
    <div className="flex items-center gap-2">
      <label className="whitespace-nowrap text-sm text-muted-foreground">日志类型</label>
      <Select<LogType>
        value={logType}
        onChange={(v) => v && setLogType(v)}
        options={logTypeOptions}
        className="h-9 w-32"
        contentClassName="min-w-[240px] max-w-[calc(100vw-2rem)]"
        testId="log-type-filter"
      />
    </div>
  );

  // key 强制切换时重新挂载子视图，自动重置 filter 和分页
  return logType === 'operation' ? (
    <OperationLogView key="operation" logTypeSelector={logTypeSelector} />
  ) : (
    <LoginLogView key="login" logTypeSelector={logTypeSelector} />
  );
}
