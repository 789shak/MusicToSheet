import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

const SUPABASE_URL = 'https://wlyjrotvjxemzgagpulj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndseWpyb3R2anhlbXpnYWdwdWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjY3MjMsImV4cCI6MjA5MDQ0MjcyM30.UmEfpA50icRhMe3agmDWk0MYaE_g22XGFsBbcJttewI';

// Session persistence: AsyncStorage holds the session JSON across cold starts,
// so signed-in users come back as the same user and guests reuse the same
// anonymous identity (created on demand by getAccessToken() in api.js).
// This matches the Supabase docs for Expo/React Native:
// https://supabase.com/docs/reference/javascript/initializing
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Initial-session gate. Subscribed immediately after createClient so the
// INITIAL_SESSION event (fired once the persisted session has been read from
// AsyncStorage — see GoTrueClient.onAuthStateChange docs) is captured. Other
// code paths await this before deciding whether to fall back to an anonymous
// sign-in. Without this gate, getSession() can return null during a cold
// start while restoration is still in flight, and a stray signInAnonymously()
// silently overwrites the persisted real-user session.
let _initialSessionReady = false;
const _initialSessionPromise = new Promise((resolve) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'INITIAL_SESSION') {
      _initialSessionReady = true;
      subscription.unsubscribe();
      resolve();
    }
  });
});

export async function waitForInitialSession() {
  if (_initialSessionReady) return;
  await _initialSessionPromise;
}

// Foreground/background-aware token refresh, per Supabase's React Native
// guidance: pause refresh when backgrounded, resume on return to foreground.
// Without this the refresh timer keeps firing while the app is suspended,
// which can lead to stale tokens on long backgrounding.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
