import { User } from 'lucide-react';

import { Label } from '@/components/ui/label';

interface UserRole {
  id: string;
  name: string;
}

interface UserInfo {
  username?: string;
  email?: string | null;
  phone?: string | null;
  roles?: UserRole[];
}

interface PersonalInfoCardProps {
  user: UserInfo | null;
}

export function PersonalInfoCard({ user }: PersonalInfoCardProps) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <User className="h-4 w-4" />
          个人信息
        </h2>
      </div>
      <div className="space-y-4 p-6">
        <div>
          <Label className="text-muted-foreground">用户名</Label>
          <div className="mt-1 text-lg font-medium" data-testid="profile-username">
            {user?.username || '-'}
          </div>
        </div>
        <div>
          <Label className="text-muted-foreground">邮箱</Label>
          <div className="mt-1" data-testid="profile-email">
            {user?.email || '-'}
          </div>
        </div>
        <div>
          <Label className="text-muted-foreground">手机号</Label>
          <div className="mt-1" data-testid="profile-phone">
            {user?.phone || '-'}
          </div>
        </div>
        <div>
          <Label className="text-muted-foreground">角色</Label>
          <div className="mt-1 flex flex-wrap gap-2" data-testid="profile-roles">
            {user?.roles?.map((role) => (
              <span
                key={role.id}
                className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {role.name}
              </span>
            )) || '-'}
          </div>
        </div>
      </div>
    </div>
  );
}
