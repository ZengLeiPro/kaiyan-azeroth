import { AlertCircle, Check, Eye, EyeOff, Lock, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  getStrengthColor,
  getStrengthText,
  PasswordFormState,
  PasswordStrengthResult,
} from '../hooks/use-profile-settings';

interface ChangePasswordCardProps {
  passwordForm: PasswordFormState;
  updatePasswordForm: (updates: Partial<PasswordFormState>) => void;
  passwordStrength: PasswordStrengthResult;
  isChangingPassword: boolean;
  onChangePassword: () => void;
}

export function ChangePasswordCard({
  passwordForm,
  updatePasswordForm,
  passwordStrength,
  isChangingPassword,
  onChangePassword,
}: ChangePasswordCardProps) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Lock className="h-4 w-4" />
          修改密码
        </h2>
      </div>
      <div className="space-y-4 p-6">
        {/* 当前密码 */}
        <div>
          <Label htmlFor="currentPassword">当前密码</Label>
          <div className="relative mt-1">
            <Input
              id="currentPassword"
              type={passwordForm.showCurrentPassword ? 'text' : 'password'}
              value={passwordForm.currentPassword}
              onChange={(e) => updatePasswordForm({ currentPassword: e.target.value })}
              placeholder="请输入当前密码"
              data-testid="current-password-input"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={() =>
                updatePasswordForm({ showCurrentPassword: !passwordForm.showCurrentPassword })
              }
            >
              {passwordForm.showCurrentPassword ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>

        {/* 新密码 */}
        <div>
          <Label htmlFor="newPassword">新密码</Label>
          <div className="relative mt-1">
            <Input
              id="newPassword"
              type={passwordForm.showNewPassword ? 'text' : 'password'}
              value={passwordForm.newPassword}
              onChange={(e) => updatePasswordForm({ newPassword: e.target.value })}
              placeholder="请输入新密码"
              data-testid="new-password-input"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={() => updatePasswordForm({ showNewPassword: !passwordForm.showNewPassword })}
            >
              {passwordForm.showNewPassword ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>

          {/* 密码强度指示器 */}
          {passwordForm.newPassword && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`h-1.5 flex-1 rounded ${
                          level <= passwordStrength.score
                            ? getStrengthColor(passwordStrength.score)
                            : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <span
                  className={`text-xs ${
                    passwordStrength.score >= 3 ? 'text-green-600' : 'text-orange-500'
                  }`}
                  data-testid="password-strength"
                >
                  {getStrengthText(passwordStrength.score)}
                </span>
              </div>
              {passwordStrength.feedback.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  建议: {passwordStrength.feedback.join('、')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 确认新密码 */}
        <div>
          <Label htmlFor="confirmPassword">确认新密码</Label>
          <div className="relative mt-1">
            <Input
              id="confirmPassword"
              type={passwordForm.showConfirmPassword ? 'text' : 'password'}
              value={passwordForm.confirmPassword}
              onChange={(e) => updatePasswordForm({ confirmPassword: e.target.value })}
              placeholder="请再次输入新密码"
              data-testid="confirm-password-input"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={() =>
                updatePasswordForm({ showConfirmPassword: !passwordForm.showConfirmPassword })
              }
            >
              {passwordForm.showConfirmPassword ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>

          {/* 密码匹配提示 */}
          {passwordForm.confirmPassword && (
            <div className="mt-1 flex items-center gap-1 text-xs">
              {passwordForm.newPassword === passwordForm.confirmPassword ? (
                <>
                  <Check className="h-3 w-3 text-green-500" />
                  <span className="text-green-500">密码匹配</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3 text-red-500" />
                  <span className="text-red-500">密码不匹配</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 密码要求提示 */}
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium">密码要求:</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>至少 8 个字符</li>
            <li>包含大写和小写字母</li>
            <li>包含至少一个数字</li>
            <li>建议包含特殊字符 (!@#$%^&*)</li>
          </ul>
        </div>

        {/* 提交按钮 */}
        <Button
          onClick={onChangePassword}
          disabled={isChangingPassword}
          className="w-full"
          data-testid="change-password-btn"
        >
          {isChangingPassword ? (
            '保存中...'
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              保存密码
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
