import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vsvuefusumjeluoztnuq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnVlZnVzdW1qZWx1b3p0bnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDI1MzIsImV4cCI6MjA5MjAxODUzMn0.BhYhz44g_nQ0qOFLCGo8Zv5wqDZkcj8S_7VgJlMi60M";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export function isRefreshTokenError(error) {
  const message = (error && (error.message || String(error))) || "";
  return /invalid refresh token|refresh token not found|refresh token/i.test(message);
}

export async function clearPersistedSupabaseSession() {
  try {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      console.warn("Supabase signOut failed while clearing stale session:", error.message);
    }
  } catch (error) {
    console.warn("Supabase clear session failed:", error);
  }
}
