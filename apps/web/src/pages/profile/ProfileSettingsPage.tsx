import { User } from 'lucide-react';

import { ChangePasswordCard } from './components/ChangePasswordCard';
import { PersonalInfoCard } from './components/PersonalInfoCard';
import { SessionManagementCard } from './components/SessionManagementCard';
import { useProfileSettings } from './hooks/use-profile-settings';

export function ProfileSettingsPage() {
  const {
    user,
    passwordForm,
    updatePasswordForm,
    passwordStrength,
    isChangingPassword,
    handleChangePassword,
    sessions,
    isLoadingSessions,
    sessionToRevoke,
    setSessionToRevoke,
    isRevoking,
    showRevokeAllConfirm,
    setShowRevokeAllConfirm,
    handleRevokeSession,
    handleRevokeAllOtherSessions,
    otherDevicesCount,
  } = useProfileSettings();

  return (
    <div className="p-6 md:h-full md:overflow-auto" data-testid="profile-settings-page">
      {/* 页面标题 */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">个人设置</h1>
          <p className="text-sm text-muted-foreground">管理您的账号信息和安全设置</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 个人信息卡片 */}
        <PersonalInfoCard user={user} />

        {/* 修改密码卡片 */}
        <ChangePasswordCard
          passwordForm={passwordForm}
          updatePasswordForm={updatePasswordForm}
          passwordStrength={passwordStrength}
          isChangingPassword={isChangingPassword}
          onChangePassword={handleChangePassword}
        />
      </div>

      {/* 会话管理卡片 */}
      <SessionManagementCard
        sessions={sessions}
        isLoadingSessions={isLoadingSessions}
        sessionToRevoke={sessionToRevoke}
        setSessionToRevoke={setSessionToRevoke}
        isRevoking={isRevoking}
        showRevokeAllConfirm={showRevokeAllConfirm}
        setShowRevokeAllConfirm={setShowRevokeAllConfirm}
        onRevokeSession={handleRevokeSession}
        onRevokeAllOtherSessions={handleRevokeAllOtherSessions}
        otherDevicesCount={otherDevicesCount}
      />
    </div>
  );
}
