import { setToken } from '@/lib/auth';
import type { ApiErrorBody, ErrorCode, LoginRequest, LoginResponse } from '@haflux/contracts';

const API_BASE = '/api/v1';

/**
 * При истёкшем JWT (или вообще любом 401 от защищённых эндпойнтов) сбрасываем
 * локальный токен. useAuth реагирует через useSyncExternalStore →
 * ProtectedShell видит null → <Navigate to="/login" />.
 *
 * Сохраняем текущий путь в ?next= чтобы после успешного логина вернуть.
 */
function handleUnauthorized(path: string) {
  if (path.startsWith('/auth/')) return; // не зацикливаемся на login-ответах
  setToken(null);
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    const next = window.location.pathname + window.location.search;
    const target = `/login?next=${encodeURIComponent(next)}`;
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(null, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }
}

export class ApiError extends Error {
  /** Машиночитаемый код ошибки от бэка. Может быть undefined (старые/чужие 5xx). */
  public readonly code?: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    if (body && typeof body === 'object') {
      const b = body as Partial<ApiErrorBody>;
      if (b.code) this.code = b.code as ErrorCode;
      if (b.details) this.details = b.details as Record<string, unknown>;
    }
  }

  /** True если код совпадает с одним из перечисленных. Удобно во views. */
  is(...codes: ErrorCode[]): boolean {
    return this.code !== undefined && codes.includes(this.code);
  }
}

/**
 * Скачать защищённый бинарный ресурс под текущим JWT и вернуть Blob +
 * имя файла из Content-Disposition (если сервер прислал). Используется
 * экспортом сертификатов: ссылку <a download> нельзя прицепить заголовок
 * Authorization, так что качаем через fetch и создаём object URL.
 */
async function downloadBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const headers = new Headers();
  const token = localStorage.getItem('haflux:access-token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const rawMsg =
      body && typeof body === 'object' && 'message' in body
        ? (body as { message?: unknown }).message
        : undefined;
    const message = typeof rawMsg === 'string' && rawMsg.length > 0 ? rawMsg : res.statusText;
    throw new ApiError(res.status, message, body);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
  const filename = m?.[1] ? decodeURIComponent(m[1]) : null;
  return { blob: await res.blob(), filename };
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean | string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  // Content-Type ставим ТОЛЬКО когда реально шлём body. Иначе Fastify
  // body-parser падает с "Body cannot be empty when content-type is set
  // to 'application/json'" (это и было на DELETE кластера).
  if (init.body !== undefined && init.body !== null) {
    headers.set('Content-Type', 'application/json');
  }

  if (init.auth) {
    const token =
      typeof init.auth === 'string' ? init.auth : localStorage.getItem('haflux:access-token');
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    if (res.status === 401) {
      handleUnauthorized(path);
    }
    const message =
      (body &&
        typeof body === 'object' &&
        'message' in body &&
        String((body as { message?: unknown }).message)) ||
      res.statusText;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DnsProvider {
  id: string;
  kind: 'CLOUDFLARE' | string;
  name: string;
  zones: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ClusterErrorFileItem {
  code: number;
  isCustom: boolean;
  html: string;
}

export interface AccessGroupSummary {
  id: string;
  name: string;
  ipCount: number;
  userCount: number;
  proxyHostCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccessGroupDetail extends AccessGroupSummary {
  ipAllowlist: string[];
  users: { username: string; hasPassword: boolean }[];
}

export interface Certificate {
  id: string;
  commonName: string;
  sans: string[];
  issuer: string;
  notBefore: string;
  notAfter: string;
  source: 'UPLOAD' | 'ACME';
  fingerprintSha256: string;
  createdAt: string;
}

export type ForwardScheme = 'http' | 'https' | 'tcp' | 'udp';

export interface ProxyHost {
  id: string;
  clusterId: string;
  domain: string;
  forwardScheme: ForwardScheme;
  forwardHost: string;
  forwardPort: number;
  listenPort: number | null;
  ssl: boolean;
  certificateId: string | null;
  httpToHttps: boolean;
  hsts: boolean;
  blockExploits: boolean;
  wsSupport: boolean;
  http2: boolean;
  http3: boolean;
  enabled: boolean;
  notes: string | null;
  /** GET path для проверки upstream; null = «/». */
  healthCheckPath: string | null;
  customHeaders: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  certificate: { id: string; commonName: string; sans: string[] } | null;
  healthStatus: 'UNKNOWN' | 'HEALTHY' | 'UNHEALTHY' | 'DEGRADED';
  healthCheckedAt: string | null;
  healthHttpCode: number | null;
  healthLatencyMs: number | null;
  healthError: string | null;
  accessGroups: { id: string; name: string }[];
}

export interface CreateProxyHostInput {
  clusterId: string;
  domain: string;
  forwardScheme: ForwardScheme;
  forwardHost: string;
  forwardPort: number;
  listenPort?: number | null;
  ssl?: boolean;
  certificateId?: string | null;
  httpToHttps?: boolean;
  hsts?: boolean;
  blockExploits?: boolean;
  wsSupport?: boolean;
  http2?: boolean;
  http3?: boolean;
  notes?: string | null;
  healthCheckPath?: string | null;
  customHeaders?: Record<string, string> | null;
  accessGroupIds?: string[];
}

export const api = {
  auth: {
    login: (body: LoginRequest) =>
      request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  me: {
    get: () => request<Me>('/me', { auth: true }),
    update: (body: {
      currentPassword: string;
      email?: string;
      displayName?: string;
      newPassword?: string;
    }) =>
      request<Me & { passwordChanged: boolean }>('/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
        auth: true,
      }),
  },
  clusters: {
    list: () =>
      request<
        {
          id: string;
          name: string;
          mode: string;
          orgId?: string;
          createdAt: string;
          updatedAt?: string;
          nodesCount?: number;
          proxyHostsCount?: number;
        }[]
      >('/clusters', { auth: true }),
    create: (input: { name: string; mode?: 'STANDALONE' | 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE' }) =>
      request<{ id: string; name: string; mode: string }>('/clusters', {
        method: 'POST',
        body: JSON.stringify(input),
        auth: true,
      }),
    update: (
      id: string,
      input: { name?: string; mode?: 'STANDALONE' | 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE' },
    ) =>
      request<{ id: string; name: string; mode: string }>(`/clusters/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        auth: true,
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/clusters/${id}`, { method: 'DELETE', auth: true }),
    errorFiles: {
      list: (clusterId: string) =>
        request<ClusterErrorFileItem[]>(`/clusters/${clusterId}/error-files`, { auth: true }),
      update: (clusterId: string, code: number, input: { html: string }) =>
        request<{ ok: true }>(`/clusters/${clusterId}/error-files/${code}`, {
          method: 'PUT',
          body: JSON.stringify(input),
          auth: true,
        }),
      reset: (clusterId: string, code: number) =>
        request<{ ok: true }>(`/clusters/${clusterId}/error-files/${code}`, {
          method: 'DELETE',
          auth: true,
        }),
    },
    accessGroups: {
      list: (clusterId: string) =>
        request<AccessGroupSummary[]>(`/clusters/${clusterId}/access-groups`, { auth: true }),
      get: (clusterId: string, groupId: string) =>
        request<AccessGroupDetail>(`/clusters/${clusterId}/access-groups/${groupId}`, {
          auth: true,
        }),
      create: (
        clusterId: string,
        input: {
          name: string;
          ipAllowlist: string[];
          users: { username: string; password: string }[];
        },
      ) =>
        request<{ id: string }>(`/clusters/${clusterId}/access-groups`, {
          method: 'POST',
          body: JSON.stringify(input),
          auth: true,
        }),
      update: (
        clusterId: string,
        groupId: string,
        input: {
          name?: string;
          ipAllowlist?: string[];
          users?: { username: string; password?: string }[];
        },
      ) =>
        request<{ id: string }>(`/clusters/${clusterId}/access-groups/${groupId}`, {
          method: 'PATCH',
          body: JSON.stringify(input),
          auth: true,
        }),
      delete: (clusterId: string, groupId: string) =>
        request<{ ok: true }>(`/clusters/${clusterId}/access-groups/${groupId}`, {
          method: 'DELETE',
          auth: true,
        }),
    },
  },
  certificates: {
    verifyCloudflare: (apiToken: string, accountId?: string) =>
      request<{
        ok: boolean;
        tokenStatus: string;
        zones: { id: string; name: string }[];
        warnings: string[];
      }>('/certificates/providers/cloudflare/verify', {
        method: 'POST',
        body: JSON.stringify({ apiToken, accountId }),
        auth: true,
      }),

    listProviders: () => request<DnsProvider[]>('/certificates/providers', { auth: true }),

    saveCloudflareProvider: (input: { name: string; apiToken: string; accountId?: string }) =>
      request<{ id: string; zones: { id: string; name: string }[] }>(
        '/certificates/providers/cloudflare',
        {
          method: 'POST',
          body: JSON.stringify(input),
          auth: true,
        },
      ),

    deleteProvider: (id: string) =>
      request<{ ok: true }>(`/certificates/providers/${id}`, {
        method: 'DELETE',
        auth: true,
      }),

    list: () => request<Certificate[]>('/certificates', { auth: true }),

    issue: (input: {
      providerId: string;
      domain: string;
      wildcard?: boolean;
      email?: string;
      staging?: boolean;
    }) =>
      request<{
        id: string;
        commonName: string;
        sans: string[];
        issuer: string;
        notAfter: string;
      }>('/certificates/issue', {
        method: 'POST',
        body: JSON.stringify(input),
        auth: true,
      }),

    delete: (id: string) =>
      request<{ ok: true }>(`/certificates/${id}`, {
        method: 'DELETE',
        auth: true,
      }),

    renew: (id: string) =>
      request<{
        id: string;
        commonName: string;
        notBefore: string;
        notAfter: string;
        sans: string[];
      }>(`/certificates/${id}/renew`, { method: 'POST', auth: true }),

    upload: (input: { certPem: string; keyPem: string }) =>
      request<{
        id: string;
        commonName: string;
        sans: string[];
        notAfter: string;
        source: 'UPLOAD' | 'ACME';
      }>('/certificates/upload', {
        method: 'POST',
        body: JSON.stringify(input),
        auth: true,
      }),

    /** Скачать один сертификат как ZIP — возвращает Blob, готовый для FileSaver. */
    exportOne: (id: string) => downloadBlob(`/certificates/${id}/export`),

    /** Скачать все сертификаты разом — Blob (`application/zip`). */
    exportAll: () => downloadBlob('/certificates/export/all'),
  },
  proxyHosts: {
    list: (clusterId: string) =>
      request<ProxyHost[]>(`/clusters/${clusterId}/proxy-hosts`, { auth: true }),
    create: (input: CreateProxyHostInput) =>
      request<ProxyHost>('/proxy-hosts', {
        method: 'POST',
        body: JSON.stringify(input),
        auth: true,
      }),
    update: (id: string, input: Partial<CreateProxyHostInput> & { enabled?: boolean }) =>
      request<ProxyHost>(`/proxy-hosts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        auth: true,
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/proxy-hosts/${id}`, { method: 'DELETE', auth: true }),
    healthCheck: (id: string) =>
      request<ProxyHost>(`/proxy-hosts/${id}/health-check`, {
        method: 'POST',
        auth: true,
      }),

    logs: (id: string) =>
      request<
        {
          time: string;
          clientIp: string;
          clientPort: number;
          frontend: string;
          backend: string;
          server: string;
          status: number;
          bytes: number;
          method: string;
          url: string;
          path: string;
          durationMs: number;
          backendMs: number;
          termState: string;
          userAgent: string;
        }[]
      >(`/proxy-hosts/${id}/logs`, { auth: true }),

    stats: (id: string) =>
      request<{
        total: number;
        status2xx: number;
        status3xx: number;
        status4xx: number;
        status5xx: number;
        rpm1: number;
        rpm5: number;
        rpm60: number;
        lastSeen: string | null;
      }>(`/proxy-hosts/${id}/stats`, { auth: true }),
  },
  backup: {
    download: async (): Promise<{ blob: Blob; filename: string }> => {
      const token = localStorage.getItem('haflux:access-token');
      const res = await fetch(`${API_BASE}/backup`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 401) handleUnauthorized('/backup');
        throw new ApiError(res.status, res.statusText);
      }
      const cd = res.headers.get('Content-Disposition') ?? '';
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m?.[1] ?? 'hpm-backup.json';
      const blob = await res.blob();
      return { blob, filename };
    },
    restore: (payload: unknown) =>
      request<{ restored: Record<string, number> }>('/backup/restore', {
        method: 'POST',
        body: JSON.stringify(payload),
        auth: true,
      }),
  },
};
