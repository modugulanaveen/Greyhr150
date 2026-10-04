import { admin } from './supabase.js';

export async function writeAudit(companyId: string, userId: string, action: string, module: string, recordId: string|null = null, metadata: Record<string, unknown> = {}) {
  const safe = JSON.parse(JSON.stringify(metadata, (_key, value) => {
    if (typeof value === 'string' && value.length > 1000) return value.slice(0, 1000);
    return value;
  }));
  const { error } = await admin.from('audit_logs').insert({ company_id: companyId, user_id: userId, action, entity_type: module, entity_id: recordId, metadata: safe });
  if (error) console.error('Audit write failed', { action, module, error: error.message });
}
