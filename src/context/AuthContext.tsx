import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEMO_PROFILE } from '@/lib/demoData';
import type { Profile } from '@/types/database';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  demoMode: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (
    email: string,
    password: string,
    username: string,
  ) => Promise<{ error?: string }>;
  signInWithMagicLink: (email: string) => Promise<{ error?: string }>;
  continueAsDemo: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(!isSupabaseConfigured);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) {
      setProfile(data as unknown as Profile);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (demoMode) {
      setProfile(DEMO_PROFILE);
      return;
    }
    if (session?.user?.id) {
      await loadProfile(session.user.id);
    }
  }, [demoMode, loadProfile, session?.user?.id]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!isSupabaseConfigured) {
        if (mounted) {
          setDemoMode(true);
          setProfile(DEMO_PROFILE);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user.id);
      }
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      if (next?.user) {
        setDemoMode(false);
        await loadProfile(next.user.id);
      } else if (!isSupabaseConfigured) {
        setDemoMode(true);
        setProfile(DEMO_PROFILE);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      setDemoMode(true);
      setProfile(DEMO_PROFILE);
      return {};
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, username: string) => {
      if (!isSupabaseConfigured) {
        setDemoMode(true);
        setProfile({ ...DEMO_PROFILE, username });
        return {};
      }
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };
      if (data.user) {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          username,
          display_name: username,
        });
      }
      return {};
    },
    [],
  );

  const signInWithMagicLink = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) {
      return { error: 'Configura Supabase para magic link. Usa modo demo por ahora.' };
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'koko://auth/callback' },
    });
    return error ? { error: error.message } : {};
  }, []);

  const continueAsDemo = useCallback(() => {
    setDemoMode(true);
    setProfile(DEMO_PROFILE);
    setSession(null);
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setDemoMode(!isSupabaseConfigured);
    setProfile(isSupabaseConfigured ? null : DEMO_PROFILE);
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      demoMode,
      signInWithEmail,
      signUpWithEmail,
      signInWithMagicLink,
      continueAsDemo,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      loading,
      demoMode,
      signInWithEmail,
      signUpWithEmail,
      signInWithMagicLink,
      continueAsDemo,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
