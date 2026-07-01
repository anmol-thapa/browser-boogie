import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

function toSupabaseSession(session: Session): SupabaseSession {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in ?? 3600,
    token_type: session.token_type,
    user: session.user
      ? {
          id: session.user.id,
          email: session.user.email ?? '',
          user_metadata: session.user.user_metadata
        }
      : undefined
  };
}

export async function saveSession(session: SupabaseSession) {
  // The Supabase client persists this to localStorage and updates its
  // internal session state; onAuthStateChange listeners pick it up from there.
  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });
}

// Resolves once after the client has loaded any existing session from
// localStorage. Callers that need to know auth state before first render
// (e.g. a route guard) should await this once.
export const sessionReady: Promise<void> = supabase.auth.getSession().then(({ data }) => {
  cachedSession = data.session;
});

export function getSavedSession(): SupabaseSession | null {
  return cachedSession ? toSupabaseSession(cachedSession) : null;
}

export async function clearSession() {
  await supabase.auth.signOut();
  cachedSession = null;
}

export function isAuthenticated() {
  return Boolean(cachedSession?.access_token);
}

let cachedSession: Session | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  cachedSession = session;
});

export async function signUpWithEmail(email: string, password: string, username: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  });
  if (error) throw new Error(error.message);
  return {
    session: data.session ? toSupabaseSession(data.session) : null,
    user: { id: data.user?.id ?? '', email: data.user?.email ?? '' }
  };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  cachedSession = data.session;
  return toSupabaseSession(data.session);
}

export async function fetchCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error(error?.message || 'No auth session found.');
  return {
    id: data.user.id,
    email: data.user.email ?? '',
    user_metadata: data.user.user_metadata
  };
}
