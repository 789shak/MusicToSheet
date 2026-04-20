import { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';

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
    const redirectUrl = 'musictosheet://auth/callback';
    console.log('[OAuth] Google redirect URL:', redirectUrl);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl },
    });
    if (error) throw error;

    if (data?.url) {
      console.log('[OAuth] Opening in browser:', data.url);
      await Linking.openURL(data.url);
      // Session arrives via deep link → caught by Linking listener in _layout.tsx
    }
  }

  async function signInWithApple() {
    throw new Error('Apple Sign-In coming soon');
  }

  async function signInWithMicrosoft() {
    const redirectUrl = 'musictosheet://auth/callback';
    console.log('[OAuth] Microsoft redirect URL:', redirectUrl);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo: redirectUrl },
    });
    if (error) throw new Error('Microsoft login coming soon');

    if (data?.url) {
      console.log('[OAuth] Opening in browser:', data.url);
      await Linking.openURL(data.url);
      // Session arrives via deep link → caught by Linking listener in _layout.tsx
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
