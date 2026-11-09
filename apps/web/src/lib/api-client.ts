import type {
  ApiErrorResponse,
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
} from './types';

export class ApiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errorResponse?: ApiErrorResponse,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientConfig {
  baseUrl?: string;
  getActiveTenantId?: () => string | null;
}

let activeTenantIdGetter: (() => string | null) | null = null;

export function setActiveTenantIdGetter(fn: () => string | null): void {
  activeTenantIdGetter = fn;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined' ? '' : 'http://localhost:3000');

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const tenantId = activeTenantIdGetter ? activeTenantIdGetter() : null;
  if (tenantId && !headers.has('x-vexel-tenant-id')) {
    headers.set('x-vexel-tenant-id', tenantId);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let errorData: ApiErrorResponse | undefined;
    try {
      errorData = await response.json();
    } catch {
      // Non-JSON response
    }
    const message = errorData?.message || `API error (${response.status}): ${response.statusText}`;
    throw new ApiClientError(response.status, message, errorData);
  }

  return response.json();
}

export const vexelApi = {
  auth: {
    requestMagicLink: (payload: MagicLinkRequestPayload) =>
      request<{ message: string }>('/v1/app/auth/magic-link', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    verifyToken: (payload: MagicLinkVerifyPayload) =>
      request<MagicLinkVerifyResponse>('/v1/app/auth/verify', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    logout: () =>
      request<{ message: string }>('/v1/app/auth/logout', {
        method: 'POST',
      }),

    getMe: () => request<MeResponse>('/v1/app/me'),
  },

  runs: {
    list: (params?: {
      status?: string;
      repId?: string;
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set('status', params.status);
      if (params?.repId) searchParams.set('repId', params.repId);
      if (params?.from) searchParams.set('from', params.from);
      if (params?.to) searchParams.set('to', params.to);
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));

      const query = searchParams.toString();
      return request<RunListResponse>(`/v1/app/runs${query ? `?${query}` : ''}`);
    },

    get: (id: string) => request<RunDetail>(`/v1/app/runs/${id}`),

    approve: (id: string) =>
      request<{ message: string; runId: string }>(`/v1/app/runs/${id}/approve`, {
        method: 'POST',
      }),

    reject: (id: string, reason?: string) =>
      request<{ message: string; runId: string }>(`/v1/app/runs/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),

    replay: (id: string) =>
      request<{ message: string; runId: string }>(`/v1/app/runs/${id}/replay`, {
        method: 'POST',
      }),
  },

  reps: {
    list: () => request<TenantRepRecord[]>('/v1/app/reps'),

    create: (data: {
      hubspotOwnerId: string;
      email: string;
      fullName: string;
      whatsappPhone?: string;
    }) =>
      request<TenantRepRecord>('/v1/app/reps', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (
      id: string,
      data: {
        fullName?: string;
        email?: string;
        whatsappPhone?: string;
        isActive?: boolean;
      },
    ) =>
      request<TenantRepRecord>(`/v1/app/reps/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    sendLinkCode: (id: string) =>
      request<{ message: string; linkCode: string; expiresAt: string }>(
        `/v1/app/reps/${id}/send-link-code`,
        {
          method: 'POST',
        },
      ),
  },

  metrics: {
    get: (params?: { from?: string; to?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.from) searchParams.set('from', params.from);
      if (params?.to) searchParams.set('to', params.to);
      const query = searchParams.toString();
      return request<MetricsSummary>(`/v1/app/metrics${query ? `?${query}` : ''}`);
    },
  },

  onboarding: {
    getStatus: () => request<OnboardingStatus>('/v1/app/onboarding/status'),
  },

  settings: {
    get: () => request<TenantSettings>('/v1/app/settings'),
    update: (payload: UpdateSettingsPayload) =>
      request<TenantSettings>('/v1/app/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },
};

