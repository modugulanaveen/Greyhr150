import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { requiredEnv } from './config.js';

const url = requiredEnv('SUPABASE_URL');
export const authClient = createClient(url, requiredEnv('SUPABASE_ANON_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });
// Never expose service-role credentials to the browser. All service-role queries are scoped by verified user membership.
export const admin = createClient(url, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });
