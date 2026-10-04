import { admin } from './supabase.js';
import type { CompanyRole } from '@paymate/shared';

export interface Membership { role: CompanyRole; status: 'ACTIVE'|'INVITED'|'SUSPENDED'|'DEACTIVATED' }

export async function getMembership(userId:string, companyId:string): Promise<Membership|null> {
  const { data, error } = await admin.from('company_members').select('role,status').eq('user_id',userId).eq('company_id',companyId).maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'DEACTIVATED' || data.status === 'SUSPENDED') return null;
  if (data.status === 'INVITED') {
    const { data: activated, error: activationError } = await admin.from('company_members').update({ status: 'ACTIVE', last_login_at: new Date().toISOString() }).eq('user_id',userId).eq('company_id',companyId).eq('status','INVITED').select('role,status').maybeSingle();
    if (activationError) throw activationError;
    if (activated) return activated as Membership;
  }
  return data as Membership;
}
export function canEdit(role:CompanyRole){ return ['OWNER','COMPANY_ADMIN','HR'].includes(role); }
export function canView(role:CompanyRole){ return ['OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'].includes(role); }
export function canViewSensitive(role:CompanyRole){ return ['OWNER','COMPANY_ADMIN','HR'].includes(role); }
export function isAdmin(role:CompanyRole){ return ['OWNER','COMPANY_ADMIN'].includes(role); }
export function isFinance(role:CompanyRole){ return ['OWNER','COMPANY_ADMIN','ACCOUNTANT'].includes(role); }
export type Permission = 'VIEW'|'CREATE'|'EDIT'|'DELETE'|'EXPORT'|'APPROVE'|'LOCK';
const permissions: Record<CompanyRole, Record<string, Permission[]>> = {
  OWNER: { '*': ['VIEW','CREATE','EDIT','DELETE','EXPORT','APPROVE','LOCK'] },
  COMPANY_ADMIN: { '*': ['VIEW','CREATE','EDIT','DELETE','EXPORT','APPROVE','LOCK'] },
  HR: {
    Employees:['VIEW','CREATE','EDIT','EXPORT'], Salary:['VIEW','CREATE','EDIT','EXPORT'], Attendance:['VIEW','CREATE','EDIT','EXPORT'], TDS:['VIEW','CREATE','EDIT','EXPORT'], Payroll:['VIEW','CREATE','EDIT','EXPORT'], Payslips:['VIEW','CREATE','EXPORT'], Compliance:['VIEW','EXPORT'], Reports:['VIEW','EXPORT'], Settings:['VIEW']
  },
  ACCOUNTANT: {
    Employees:['VIEW','EXPORT'], Salary:['VIEW','EXPORT'], Attendance:['VIEW','EXPORT'], TDS:['VIEW','CREATE','EDIT','EXPORT'], Payroll:['VIEW','CREATE','EDIT','EXPORT','APPROVE'], Payslips:['VIEW','CREATE','EXPORT'], Compliance:['VIEW','CREATE','EDIT','EXPORT'], Reports:['VIEW','EXPORT'], Settings:['VIEW']
  }
};
export function hasPermission(role: CompanyRole, module: string, permission: Permission) { return Boolean(permissions[role]?.['*']?.includes(permission) || permissions[role]?.[module]?.includes(permission)); }
export function permissionMatrix() { return permissions; }
