import { createContext, useContext, useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    // Load existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("onAuthStateChange fired:", event, session?.user?.email);
      setSession(session);
      setUser(session?.user ?? null);
      // Real sign-in clears guest mode automatically
      if (session) setIsGuest(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  function enterGuestMode() {
    setIsGuest(true);
  }

  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function signInWithGoogle() {
    const redirectUrl = AuthSession.makeRedirectUri({ scheme: 'musictosheet', path: 'auth/callback' });
    console.log('[OAuth] Google redirect URL:', redirectUrl);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;

    if (data?.url) {
      console.log('[OAuth] Opening URL:', data.url);
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
      console.log('[OAuth] Result type:', result.type);

      if (result.type === 'success' && result.url) {
        const hashParams = result.url.split('#')[1];
        if (hashParams) {
          const params = new URLSearchParams(hashParams);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
            if (sessionError) throw sessionError;
          }
        } else {
          // PKCE fallback — code is in query params
          await supabase.auth.exchangeCodeForSession(result.url);
        }
      }
    }
  }

  async function signInWithApple() {
    throw new Error('Apple Sign-In coming soon');
  }

  async function signInWithMicrosoft() {
    const redirectUrl = AuthSession.makeRedirectUri({ scheme: 'musictosheet', path: 'auth/callback' });
    console.log('[OAuth] Microsoft redirect URL:', redirectUrl);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw new Error('Microsoft login coming soon');

    if (data?.url) {
      console.log('[OAuth] Opening URL:', data.url);
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
      console.log('[OAuth] Result type:', result.type);

      if (result.type === 'success' && result.url) {
        const hashParams = result.url.split('#')[1];
        if (hashParams) {
          const params = new URLSearchParams(hashParams);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
            if (sessionError) throw new Error('Microsoft login coming soon');
          }
        } else {
          await supabase.auth.exchangeCodeForSession(result.url);
        }
      }
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isGuest,
        enterGuestMode,
        signUp,
        signIn,
        signOut,
        signInWithGoogle,
        signInWithApple,
        signInWithMicrosoft,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
