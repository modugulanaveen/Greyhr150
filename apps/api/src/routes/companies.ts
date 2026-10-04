import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
const router = Router(); router.use(requireAuth);
const createSchema = z.object({ name: z.string().trim().min(2).max(120), legal_name: z.string().trim().min(2).max(200), country: z.literal('IN'), state: z.string().trim().max(100).nullable().optional() }).strict();
router.get('/', async (req: AuthRequest, res) => {
  try { const { data: memberships, error } = await admin.from('company_members').select('role,status, companies(id,name,legal_name,country,state,created_at)').eq('user_id', req.userId!).in('status',['ACTIVE','INVITED']); if (error) throw error;
    const companies = (memberships ?? []).flatMap((m: any) => m.companies ? [{ ...m.companies, role: m.role, membership_status: m.status }] : []); res.json({ companies }); }
  catch (e) { console.error('List companies:', e); res.status(500).json({ error: 'Unable to load companies' }); }
});
router.post('/', async (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: 'Invalid company details', details: parsed.error.flatten().fieldErrors }); return; }
  // Atomic SECURITY DEFINER function creates company + owner membership; avoids orphan companies on partial failure.
  try { const { data, error } = await admin.rpc('create_company_for_user', { p_user_id: req.userId!, p_name: parsed.data.name, p_legal_name: parsed.data.legal_name, p_country: parsed.data.country, p_state: parsed.data.state ?? null }); if (error) throw error; res.status(201).json({ company: data }); }
  catch (e) { console.error('Create company:', e); res.status(500).json({ error: 'Unable to create company' }); }
});
router.get('/:id', async (req: AuthRequest, res) => {
  try { const { data: member, error: membershipError } = await admin.from('company_members').select('role,status').eq('company_id', req.params.id).eq('user_id', req.userId!).eq('status','ACTIVE').maybeSingle(); if (membershipError) throw membershipError; if (!member) { res.status(404).json({ error: 'Company not found' }); return; }
    const { data: company, error } = await admin.from('companies').select('id,name,legal_name,country,state,created_at').eq('id', req.params.id).single(); if (error) throw error; res.json({ company: { ...company, role: member.role } }); }
  catch (e) { console.error('Get company:', e); res.status(500).json({ error: 'Unable to load company' }); }
});
export default router;
