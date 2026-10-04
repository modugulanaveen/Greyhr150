import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  IndianRupee,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCompany } from "../contexts/CompanyContext";
import { api } from "../lib/api";
const money = (n: number) =>
  `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
export default function Compliance() {
  const { current } = useCompany();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1),
    [year, setYear] = useState(now.getFullYear()),
    [d, setD] = useState<any>(null),
    [err, setErr] = useState("");
  useEffect(() => {
    if (!current) return;
    api<any>(
      `/compliance/dashboard?company_id=${current.id}&month=${month}&year=${year}`,
    )
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [current?.id, month, year]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMPLIANCE</div>
          <h1>Statutory Compliance</h1>
          <p>Monitor monthly payroll statutory obligations</p>
        </div>
        <div className="toolbar">
          <select
            className="pm-input"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i, 1).toLocaleString("en-IN", {
                  month: "long",
                })}
              </option>
            ))}
          </select>
          <input
            className="pm-input"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}
      {!d?.run ? (
        <section className="panel empty-state">
          <ShieldCheck size={32} />
          <h3>No approved payroll for this period</h3>
          <p>Statutory reports are available after payroll approval.</p>
          <Link className="primary" to="/payroll">
            Open Payroll
          </Link>
        </section>
      ) : d.blocked ? (
        <section className="panel empty-state">
          <AlertTriangle size={32} />
          <h3>Payroll not approved</h3>
          <p>Statutory reports are available after payroll approval.</p>
        </section>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <WalletCards size={21} />
              <span>Employee EPF</span>
              <strong>{money(d.summary.employeePf)}</strong>
            </div>
            <div className="stat-card">
              <WalletCards size={21} />
              <span>Employer EPF</span>
              <strong>{money(d.summary.employerPf)}</strong>
            </div>
            <div className="stat-card">
              <IndianRupee size={21} />
              <span>Professional Tax</span>
              <strong>{money(d.summary.pt)}</strong>
            </div>
            <div className="stat-card">
              <IndianRupee size={21} />
              <span>TDS</span>
              <strong>{money(d.summary.tds)}</strong>
            </div>
            <div className="stat-card">
              <FileCheck2 size={21} />
              <span>Total Statutory Liability</span>
              <strong>{money(d.summary.total)}</strong>
            </div>
          </div>
          <section className="panel">
            <div className="panel-title">
              <h3>Compliance status</h3>
            </div>
            <div className="detail-grid">
              <Status title="PF" value={d.statuses.PF?.status} />
              <Status title="PT" value={d.statuses.PT?.status} />
              <Status title="TDS" value={d.statuses.TDS?.status} />
            </div>
          </section>
          <div className="dashboard-grid">
            <section className="panel">
              <h3>Compliance checks</h3>
              <p className="muted">
                PF, PT and TDS reports are based on the approved payroll
                snapshot.
              </p>
              <div className="check-item">
                <CheckCircle2 className="check-done" />
                <div>
                  <strong>Payroll snapshot protected</strong>
                  <p>
                    {d.run.status} payroll · {month}/{year}
                  </p>
                </div>
              </div>
            </section>
            <section className="panel">
              <h3>Reports</h3>
              <div className="button-stack">
                <Link
                  className="secondary"
                  to={`/compliance/pf?payroll_run_id=${d.run.id}`}
                >
                  PF / ECR
                </Link>
                <Link
                  className="secondary"
                  to={`/compliance/pt?payroll_run_id=${d.run.id}`}
                >
                  Professional Tax
                </Link>
                <Link
                  className="secondary"
                  to={`/compliance/tds?payroll_run_id=${d.run.id}`}
                >
                  TDS
                </Link>
                <Link className="secondary" to="/compliance/payments">
                  Statutory Payments
                </Link>
                <Link className="secondary" to="/compliance/reports">
                  Compliance Reports
                </Link>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
function Status({ title, value }: { title: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{title}</span>
      <strong>{value?.replaceAll("_", " ") || "PENDING"}</strong>
      <small>Internal PayMate tracking status</small>
    </div>
  );
}
