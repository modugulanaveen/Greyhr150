import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Company } from '../lib/api';
import { useAuth } from './AuthContext';
interface CompanyValue { companies: Company[]; current: Company | null; loading: boolean; error: string; refresh: () => Promise<void>; select: (id: string) => void }
const CompanyContext = createContext<CompanyValue | null>(null);
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!user) { setCompanies([]); setLoading(false); return; }
    setLoading(true); setError('');
    try { const data = await api<{ companies: Company[] }>('/companies'); setCompanies(data.companies); setCurrentId(old => data.companies.some(c => c.id === old) ? old : (data.companies[0]?.id ?? null)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load companies'); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <CompanyContext.Provider value={{ companies, current: companies.find(c => c.id === currentId) ?? null, loading, error, refresh, select: setCurrentId }}>{children}</CompanyContext.Provider>;
}
export function useCompany() { const ctx = useContext(CompanyContext); if (!ctx) throw new Error('useCompany requires CompanyProvider'); return ctx; }
