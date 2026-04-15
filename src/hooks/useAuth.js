import { createContext, useContext, useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
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
    const redirectTo = Linking.createURL('/');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
    if (data?.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        const { url } = result;
        await supabase.auth.exchangeCodeForSession(url);
      }
    }
  }

  async function signInWithApple() {
    const redirectTo = Linking.createURL('/');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });
    if (error) throw error;
    if (data?.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        const { url } = result;
        await supabase.auth.exchangeCodeForSession(url);
      }
    }
  }

  async function signInWithMicrosoft() {
    const redirectTo = Linking.createURL('/');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo },
    });
    if (error) throw error;
    if (data?.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        const { url } = result;
        await supabase.auth.exchangeCodeForSession(url);
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
