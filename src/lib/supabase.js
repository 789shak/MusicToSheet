import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// REPLACE THESE WITH YOUR ACTUAL VALUES from https://supabase.com/dashboard → Project Settings → API
const SUPABASE_URL = 'https://wlyjrotvjxemzgagpulj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndseWpyb3R2anhlbXpnYWdwdWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjY3MjMsImV4cCI6MjA5MDQ0MjcyM30.UmEfpA50icRhMe3agmDWk0MYaE_g22XGFsBbcJttewI';

// expo-secure-store adapter for Supabase token persistence
const ExpoSecureStoreAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // must be false for React Native
  },
});
