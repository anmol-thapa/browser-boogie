const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const SESSION_STORAGE_KEY = 'jd_auth_session';

type AuthError = {
  message?: string;
  error?: string;
  error_description?: string;
};

export type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user?: {
    id: string;
    email: string;
    user_metadata?: Record<string, unknown>;
  };
};

function ensureConfig() {
  if (!rawSupabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env');
  }
}

function normalizeSupabaseUrl(value: string): string {
  const trimmed = value.trim();

  // If someone pasted the dashboard URL, convert it to the project API URL.
  const dashboardMatch = trimmed.match(/supabase\.com\/dashboard\/project\/([a-z0-9-]+)/i);
  if (dashboardMatch?.[1]) {
    return `https://${dashboardMatch[1]}.supabase.co`;
  }

  if (trimmed.includes('.supabase.co')) {
    try {
      const withProtocol = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
      const url = new URL(withProtocol);
      return `${url.protocol}//${url.host}`;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl || '');

function baseHeaders() {
  ensureConfig();
  return {
    apikey: supabaseAnonKey as string,
    'Content-Type': 'application/json'
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const raw = (await response.json().catch(() => ({}))) as T & AuthError;
  if (!response.ok) {
    throw new Error(raw.error_description || raw.message || raw.error || 'Authentication request failed.');
  }
  return raw;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${supabaseUrl}${path}`, init);
    return await parseJson<T>(response);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot reach Supabase at ${supabaseUrl}. Check VITE_SUPABASE_URL (should be https://<project-ref>.supabase.co) and disable browser shields/VPN for localhost.`
      );
    }
    throw error;
  }
}

export function saveSession(session: SupabaseSession) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures and continue without persisted session.
  }
}

export function getSavedSession(): SupabaseSession | null {
  try {
    const data = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!data) return null;

    const parsed = JSON.parse(data) as Partial<SupabaseSession>;
    if (!parsed || typeof parsed.access_token !== 'string' || !parsed.access_token) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    return parsed as SupabaseSession;
  } catch {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function isAuthenticated() {
  return Boolean(getSavedSession()?.access_token);
}

export async function signUpWithEmail(email: string, password: string, username: string) {
  ensureConfig();
  return requestJson<{ session: SupabaseSession | null; user: { id: string; email: string } }>('/auth/v1/signup', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({
      email,
      password,
      data: { username }
    })
  });
}

export async function signInWithEmail(email: string, password: string) {
  ensureConfig();
  const session = await requestJson<SupabaseSession>('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ email, password })
  });
  saveSession(session);
  return session;
}

export async function fetchCurrentUser() {
  const session = getSavedSession();
  if (!session?.access_token) {
    throw new Error('No auth session found.');
  }

  ensureConfig();
  return requestJson<{ id: string; email: string; user_metadata?: Record<string, unknown> }>('/auth/v1/user', {
    method: 'GET',
    headers: {
      apikey: supabaseAnonKey as string,
      Authorization: `Bearer ${session.access_token}`
    }
  });
}
