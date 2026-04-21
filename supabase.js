import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vsvuefusumjeluoztnuq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnVlZnVzdW1qZWx1b3p0bnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDI1MzIsImV4cCI6MjA5MjAxODUzMn0.BhYhz44g_nQ0qOFLCGo8Zv5wqDZkcj8S_7VgJlMi60M";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
