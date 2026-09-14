import {
  Clock,
  Globe,
  Loader2,
  LogOut,
  MapPin,
  Monitor,
  Shield,
  Smartphone,
  Tablet,
} from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { formatDateTimeDisplay } from '@/lib/date-utils';

import { getRelativeTime, Session } from '../hooks/use-profile-settings';

// 获取设备图标
function getDeviceIcon(deviceType: string) {
  switch (deviceType) {
    case 'mobile':
      return Smartphone;
    case 'tablet':
      return Tablet;
    default:
      return Monitor;
  }
}

interface SessionManagementCardProps {
  sessions: Session[];
  isLoadingSessions: boolean;
  sessionToRevoke: Session | null;
  setSessionToRevoke: (session: Session | null) => void;
  isRevoking: boolean;
  showRevokeAllConfirm: boolean;
  setShowRevokeAllConfirm: (show: boolean) => void;
  onRevokeSession: (session: Session) => void;
  onRevokeAllOtherSessions: () => void;
  otherDevicesCount: number;
}

export function SessionManagementCard({
  sessions,
  isLoadingSessions,
  sessionToRevoke,
  setSessionToRevoke,
  isRevoking,
  showRevokeAllConfirm,
  setShowRevokeAllConfirm,
  onRevokeSession,
  onRevokeAllOtherSessions,
  otherDevicesCount,
}: SessionManagementCardProps) {
  return (
    <>
      <div className="mt-6 rounded-lg border bg-card" data-testid="sessions-card">
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Shield className="h-4 w-4" />
              登录设备管理
            </h2>
            {otherDevicesCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRevokeAllConfirm(true)}
                data-testid="revoke-all-btn"
              >
                <LogOut className="mr-2 h-4 w-4" />
                注销所有其他设备
              </Button>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            查看和管理您账号在不同设备上的登录状态
          </p>
        </div>

        <div className="p-6">
          {isLoadingSessions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">加载中...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">暂无登录设备信息</div>
          ) : (
            <div className="space-y-4" data-testid="sessions-list">
              {sessions.map((session) => {
                const DeviceIcon = getDeviceIcon(session.deviceType);
                return (
                  <div
                    key={session.id}
                    className={`flex items-start gap-4 rounded-lg border p-4 ${
                      session.isCurrent ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                    data-testid={`session-${session.id}`}
                  >
                    {/* 设备图标 */}
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
                        session.isCurrent
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <DeviceIcon className="h-6 w-6" />
                    </div>

                    {/* 设备信息 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium" data-testid="session-device-name">
                          {session.deviceName}
                        </span>
                        {session.isCurrent && (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            当前设备
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Globe className="h-3.5 w-3.5" />
                          {session.browser} / {session.os}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {session.location}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">IP: {session.ipAddress}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          登录时间: {formatDateTimeDisplay(session.loginTime) || '-'}
                        </span>
                        <span title={formatDateTimeDisplay(session.lastActiveTime)}>
                          最后活跃: {getRelativeTime(session.lastActiveTime)}
                        </span>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    {!session.isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSessionToRevoke(session)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        data-testid={`revoke-session-${session.id}`}
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 注销单个会话确认对话框 */}
      <AlertDialog
        open={!!sessionToRevoke}
        onOpenChange={(open) => !open && setSessionToRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认注销此设备?</AlertDialogTitle>
            <AlertDialogDescription>
              {sessionToRevoke && (
                <>
                  您即将注销在 <strong>{sessionToRevoke.deviceName}</strong> 上的登录会话。
                  该设备将需要重新登录才能访问系统。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sessionToRevoke && onRevokeSession(sessionToRevoke)}
              disabled={isRevoking}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="confirm-revoke-btn"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  注销中...
                </>
              ) : (
                '确认注销'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 注销所有其他会话确认对话框 */}
      <AlertDialog open={showRevokeAllConfirm} onOpenChange={setShowRevokeAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认注销所有其他设备?</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将注销除当前设备外的所有登录会话（共 {otherDevicesCount} 个设备）。
              这些设备将需要重新登录才能访问系统。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={onRevokeAllOtherSessions}
              disabled={isRevoking}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="confirm-revoke-all-btn"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  注销中...
                </>
              ) : (
                '确认注销所有'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
