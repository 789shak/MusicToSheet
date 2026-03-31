import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://wlyjrotvjxemzgagpulj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndseWpyb3R2anhlbXpnYWdwdWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjY3MjMsImV4cCI6MjA5MDQ0MjcyM30.UmEfpA50icRhMe3agmDWk0MYaE_g22XGFsBbcJttewI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
