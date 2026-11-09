import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { vexelApi } from '@/lib/api-client';
import type {
  MagicLinkRequestPayload,
  MagicLinkVerifyPayload,
  MagicLinkVerifyResponse,
  MeResponse,
  MetricsSummary,
  OnboardingStatus,
  RunDetail,
  RunListResponse,
  TenantRepRecord,
  TenantSettings,
  UpdateSettingsPayload,
} from '@/lib/types';

export const queryKeys = {
  me: ['app', 'me'] as const,
  runs: (params?: Record<string, unknown>) => ['app', 'runs', params] as const,
  run: (id: string) => ['app', 'run', id] as const,
  reps: ['app', 'reps'] as const,
  metrics: (params?: Record<string, unknown>) => ['app', 'metrics', params] as const,
  onboarding: ['app', 'onboarding'] as const,
  settings: ['app', 'settings'] as const,
};

export function useMe(): UseQueryResult<MeResponse, Error> {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => vexelApi.auth.getMe(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRuns(
  params?: {
    status?: string;
    repId?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  },
  options?: {
    refetchInterval?: number;
  },
): UseQueryResult<RunListResponse, Error> {
  return useQuery({
    queryKey: queryKeys.runs(params),
    queryFn: () => vexelApi.runs.list(params),
    staleTime: 10 * 1000,
    refetchInterval: options?.refetchInterval,
  });
}

export function useRun(id: string): UseQueryResult<RunDetail, Error> {
  return useQuery({
    queryKey: queryKeys.run(id),
    queryFn: () => vexelApi.runs.get(id),
    enabled: Boolean(id),
  });
}

export function useApproveRun(): UseMutationResult<
  { message: string; runId: string },
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vexelApi.runs.approve(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.run(id) });
      queryClient.invalidateQueries({ queryKey: ['app', 'runs'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.metrics() });
    },
  });
}

export function useRejectRun(): UseMutationResult<
  { message: string; runId: string },
  Error,
  { id: string; reason?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => vexelApi.runs.reject(id, reason),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.run(id) });
      queryClient.invalidateQueries({ queryKey: ['app', 'runs'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.metrics() });
    },
  });
}

export function useReplayRun(): UseMutationResult<
  { message: string; runId: string },
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vexelApi.runs.replay(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.run(id) });
      queryClient.invalidateQueries({ queryKey: ['app', 'runs'] });
    },
  });
}

export function useReps(): UseQueryResult<TenantRepRecord[], Error> {
  return useQuery({
    queryKey: queryKeys.reps,
    queryFn: () => vexelApi.reps.list(),
    staleTime: 60 * 1000,
  });
}

export function useCreateRep(): UseMutationResult<
  TenantRepRecord,
  Error,
  {
    hubspotOwnerId: string;
    email: string;
    fullName: string;
    whatsappPhone?: string;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => vexelApi.reps.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reps });
    },
  });
}

export function useUpdateRep(): UseMutationResult<
  TenantRepRecord,
  Error,
  {
    id: string;
    data: {
      fullName?: string;
      email?: string;
      whatsappPhone?: string;
      isActive?: boolean;
    };
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => vexelApi.reps.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reps });
    },
  });
}

export function useSendRepLinkCode(): UseMutationResult<
  { message: string; linkCode: string; expiresAt: string },
  Error,
  string
> {
  return useMutation({
    mutationFn: (id: string) => vexelApi.reps.sendLinkCode(id),
  });
}

export function useMetrics(params?: {
  from?: string;
  to?: string;
}): UseQueryResult<MetricsSummary, Error> {
  return useQuery({
    queryKey: queryKeys.metrics(params),
    queryFn: () => vexelApi.metrics.get(params),
    staleTime: 60 * 1000,
  });
}

export function useOnboardingStatus(): UseQueryResult<OnboardingStatus, Error> {
  return useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: () => vexelApi.onboarding.getStatus(),
    staleTime: 60 * 1000,
  });
}

export function useSettings(): UseQueryResult<TenantSettings, Error> {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => vexelApi.settings.get(),
    staleTime: 60 * 1000,
  });
}

export function useUpdateSettings(): UseMutationResult<
  TenantSettings,
  Error,
  UpdateSettingsPayload
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => vexelApi.settings.update(payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings, updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useRequestMagicLink(): UseMutationResult<
  { message: string },
  Error,
  MagicLinkRequestPayload
> {
  return useMutation({
    mutationFn: (payload) => vexelApi.auth.requestMagicLink(payload),
  });
}

export function useVerifyMagicLink(): UseMutationResult<
  MagicLinkVerifyResponse,
  Error,
  MagicLinkVerifyPayload
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => vexelApi.auth.verifyToken(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useLogout(): UseMutationResult<{ message: string }, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vexelApi.auth.logout(),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.me, null);
      queryClient.clear();
    },
  });
}

