import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth';

// 会话类型定义
export interface Session {
  id: string;
  userId: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  deviceName: string;
  browser: string;
  os: string;
  ipAddress: string;
  location: string;
  loginTime: string;
  lastActiveTime: string;
  isCurrent: boolean;
}

// 密码强度结果类型
export interface PasswordStrengthResult {
  score: number;
  feedback: string[];
}

// 密码表单状态
export interface PasswordFormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  showCurrentPassword: boolean;
  showNewPassword: boolean;
  showConfirmPassword: boolean;
}

// 密码强度检查
export function checkPasswordStrength(password: string): PasswordStrengthResult {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) {
    score++;
  } else {
    feedback.push('至少 8 个字符');
  }

  if (/[a-z]/.test(password)) {
    score++;
  } else {
    feedback.push('包含小写字母');
  }

  if (/[A-Z]/.test(password)) {
    score++;
  } else {
    feedback.push('包含大写字母');
  }

  if (/[0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('包含数字');
  }

  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    score++;
  } else {
    feedback.push('包含特殊字符');
  }

  return { score, feedback };
}

// 获取相对时间
export function getRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 30) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN');
}

// 密码强度指示器颜色
export function getStrengthColor(score: number): string {
  if (score <= 1) return 'bg-red-500';
  if (score <= 2) return 'bg-orange-500';
  if (score <= 3) return 'bg-yellow-500';
  if (score <= 4) return 'bg-green-500';
  return 'bg-green-600';
}

// 密码强度文本
export function getStrengthText(score: number): string {
  if (score <= 1) return '弱';
  if (score <= 2) return '较弱';
  if (score <= 3) return '中等';
  if (score <= 4) return '强';
  return '很强';
}

export function useProfileSettings() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  // 修改密码表单状态
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    showCurrentPassword: false,
    showNewPassword: false,
    showConfirmPassword: false,
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // 会话管理状态
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState<Session | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [showRevokeAllConfirm, setShowRevokeAllConfirm] = useState(false);

  // 密码强度
  const passwordStrength = checkPasswordStrength(passwordForm.newPassword);

  // 加载会话列表
  const fetchSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const response = await api.get('/sessions');
      setSessions(response.data);
    } catch (error) {
      logger.error('ProfileSettings', 'Failed to fetch sessions:', error);
      toast.error('获取登录设备列表失败');
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 更新密码表单字段
  const updatePasswordForm = useCallback((updates: Partial<PasswordFormState>) => {
    setPasswordForm((prev) => ({ ...prev, ...updates }));
  }, []);

  // 验证表单
  const validatePasswordForm = useCallback((): string | null => {
    if (!passwordForm.currentPassword) {
      return '请输入当前密码';
    }
    if (!passwordForm.newPassword) {
      return '请输入新密码';
    }
    if (passwordForm.newPassword.length < 8) {
      return '新密码至少需要 8 个字符';
    }
    if (passwordStrength.score < 3) {
      return '密码强度不足，请包含大小写字母和数字';
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return '两次输入的新密码不一致';
    }
    if (passwordForm.currentPassword === passwordForm.newPassword) {
      return '新密码不能与当前密码相同';
    }
    return null;
  }, [passwordForm, passwordStrength.score]);

  // 提交修改密码
  const handleChangePassword = useCallback(async () => {
    const error = validatePasswordForm();
    if (error) {
      // @validation-ok: 密码修改业务规则检查（强度/一致性），非普通表单字段验证
      toast.error(error);
      return;
    }

    setIsChangingPassword(true);
    try {
      await api.patch('/users/me/password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
        confirmPassword: passwordForm.confirmPassword,
      });

      toast.success('密码修改成功，请重新登录');

      // 清空表单
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        showCurrentPassword: false,
        showNewPassword: false,
        showConfirmPassword: false,
      });

      // 延迟后登出并跳转到登录页
      setTimeout(() => {
        logout();
        navigate('/login');
      }, 1500);
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { message?: string } } };
      const message = axiosError.response?.data?.message || '密码修改失败';
      toast.error(message);
    } finally {
      setIsChangingPassword(false);
    }
  }, [passwordForm, validatePasswordForm, logout, navigate]);

  // 注销单个会话
  const handleRevokeSession = useCallback(async (session: Session) => {
    if (session.isCurrent) {
      // @validation-ok: 操作前置状态检查，非表单字段验证
      toast.error('无法注销当前会话，请使用登出功能');
      return;
    }

    setIsRevoking(true);
    try {
      await api.delete(`/sessions/${session.id}`);
      toast.success('会话已注销');
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setSessionToRevoke(null);
    } catch {
      toast.error('注销会话失败');
    } finally {
      setIsRevoking(false);
    }
  }, []);

  // 注销所有其他会话
  const handleRevokeAllOtherSessions = useCallback(async () => {
    setIsRevoking(true);
    try {
      await api.delete('/sessions');
      toast.success('已注销所有其他设备');
      setSessions((prev) => prev.filter((s) => s.isCurrent));
      setShowRevokeAllConfirm(false);
    } catch {
      toast.error('注销失败');
    } finally {
      setIsRevoking(false);
    }
  }, []);

  // 其他设备数量
  const otherDevicesCount = sessions.filter((s) => !s.isCurrent).length;

  return {
    // 用户信息
    user,

    // 密码相关
    passwordForm,
    updatePasswordForm,
    passwordStrength,
    isChangingPassword,
    handleChangePassword,

    // 会话相关
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
  };
}
