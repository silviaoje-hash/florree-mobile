import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://kiwhtdhvgiybjtiagala.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtpd2h0ZGh2Z2l5Ymp0aWFnYWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NjgyMDIsImV4cCI6MjEwNjQ0NDIwMn0.wN3cDKf9512eddpKDm6WgY_bCS_L5hXmjDJ5c0x2Kuw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});