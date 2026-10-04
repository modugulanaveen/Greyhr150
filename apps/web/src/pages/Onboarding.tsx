import { useState, type FormEvent } from 'react';
import { ArrowRight, Building2 } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useCompany } from '../contexts/CompanyContext';
export default function Onboarding() {
  const { current, loading, refresh } = useCompany(); const navigate = useNavigate(); const [name, setName] = useState(''); const [legalName, setLegalName] = useState(''); const [state, setState] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (loading) return <div className="center-screen">Loading…</div>;
  if (current) return <Navigate to="/dashboard" replace/>;
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/companies', { method: 'POST', body: JSON.stringify({ name, legal_name: legalName, country: 'IN', state: state || null }) }); await refresh(); navigate('/dashboard'); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create company'); } finally { setBusy(false); } }
  return <div className="onboard-page"><div className="onboard-header"><div className="brand-icon">P</div><strong>PayMate</strong><span> / Company setup</span></div><div className="onboard-card"><div className="step">STEP 01 OF 01 · COMPANY ONBOARDING</div><div className="onboard-icon"><Building2 size={29}/></div><h1>Tell us about your company</h1><p className="muted">Create your first workspace. You can update company details later.</p><form onSubmit={submit}><label>Display name<input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Technologies"/></label><label>Legal company name<input required minLength={2} maxLength={200} value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="e.g. Acme Technologies Private Limited"/></label><div className="form-grid"><label>Country<input value="India" disabled/></label><label>State / Union territory<input maxLength={100} value={state} onChange={e => setState(e.target.value)} placeholder="e.g. Telangana"/></label></div>{error && <div className="alert error" role="alert">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Creating workspace…' : 'Create workspace'}<ArrowRight size={18}/></button></form></div></div>;
}
