import type { Request, Response, NextFunction } from 'express';
import { authClient, admin } from '../lib/supabase.js';
export interface AuthRequest extends Request { userId?: string }
const lastLoginWrite = new Map<string, number>();
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Authentication required' }); return; }
  const token = header.slice(7);
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return; }
  try {
    const { data: { user }, error } = await authClient.auth.getUser(token);
    if (error || !user) { res.status(401).json({ error: 'Invalid or expired token' }); return; }
    req.userId = user.id;
    const last = lastLoginWrite.get(user.id) || 0;
    if (Date.now() - last > 15 * 60_000) {
      lastLoginWrite.set(user.id, Date.now());
      void admin.from('company_members').update({ last_login_at: new Date().toISOString() }).eq('user_id', user.id).eq('status', 'ACTIVE');
    }
    next();
  } catch { res.status(401).json({ error: 'Unable to verify token' }); }
}
