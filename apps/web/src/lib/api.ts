export const API_BASE = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('railgrid_token');
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('railgrid_token', token);
}

export function removeAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('railgrid_token');
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let errBody: ApiErrorResponse | null = null;
    try {
      errBody = await res.json();
    } catch {
      // not JSON
    }
    const message = errBody?.error?.message ?? `Request failed with status ${res.status}`;
    const code = errBody?.error?.code ?? 'UNKNOWN_ERROR';
    throw new ApiError(res.status, code, message, errBody?.error?.details);
  }

  return (await res.json()) as T;
}
