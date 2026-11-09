'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMe, useLogout } from '@/hooks/use-vexel-api';
import { setActiveTenantIdGetter } from '@/lib/api-client';
import type { MembershipRole, MembershipSummary, TenantSummary, UserProfile } from '@/lib/types';

interface AuthContextType {
  user: UserProfile | null;
  memberships: MembershipSummary[];
  activeTenant: TenantSummary | null;
  currentRole: MembershipRole | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  switchTenant: (tenantId: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({
  children,
  locale = 'en',
}: {
  children: React.ReactNode;
  locale?: string;
}) {
  const router = useRouter();
  const { data: meData, isLoading, error } = useMe();
  const logoutMutation = useLogout();
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null);

  // Sync selected tenant with api client header getter
  React.useEffect(() => {
    setActiveTenantIdGetter(() => selectedTenantId);
  }, [selectedTenantId]);

  // Default to server-resolved active tenant from meData
  React.useEffect(() => {
    if (meData?.activeTenant?.id && !selectedTenantId) {
      setSelectedTenantId(meData.activeTenant.id);
    }
  }, [meData, selectedTenantId]);

  const user = meData?.user ?? null;
  const memberships = meData?.memberships ?? [];
  const activeTenant =
    memberships.find((m) => m.tenantId === selectedTenantId)?.tenant ??
    meData?.activeTenant ??
    null;
  const currentRole =
    memberships.find((m) => m.tenantId === selectedTenantId)?.role ??
    meData?.currentRole ??
    null;

  const switchTenant = (tenantId: string) => {
    setSelectedTenantId(tenantId);
  };

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      router.push(`/${locale}/auth/login`);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        activeTenant,
        currentRole,
        isLoading,
        isAuthenticated: Boolean(user),
        switchTenant,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

