import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Calculator,
  FileText,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api, apiBlob } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";

type Regime = "NEW" | "OLD";
const money = (v: number) =>
  `₹${Math.round(Number(v) || 0).toLocaleString("en-IN")}`;
const currentFY = () => {
  const d = new Date();
  const y = d.getFullYear();
  return `${d.getMonth() + 1 >= 4 ? y : y - 1}-${String((d.getMonth() + 1 >= 4 ? y + 1 : y) % 100).padStart(2, "0")}`;
};
const monthName = (m: number) =>
  new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "short" });

export default function TDS() {
  const { current } = useCompany();
  const { employeeId: routeEmployeeId } = useParams();
  const [fy, setFy] = useState(currentFY());
  const [regime, setRegime] = useState<Regime>("NEW");
  const [employeeId, setEmployeeId] = useState(routeEmployeeId ?? "");
  const [payrollMonth, setPayrollMonth] = useState(new Date().getMonth() + 1);
  const [employees, setEmployees] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>({
    previous_employer_taxable_salary: 0,
    previous_employer_tds: 0,
    other_taxable_income: 0,
    other_tds: 0,
    tax_declaration_status: "PENDING",
  });
  const [profileSaved, setProfileSaved] = useState("");
  const [result, setResult] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function loadEmployees() {
    if (!current) return;
    try {
      const d = await api<any>(
        `/employees?company_id=${current.id}&limit=100&status=ACTIVE`,
      );
      setEmployees(d.employees ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load employees");
    }
  }
  async function loadRows() {
    if (!current) return;
    try {
      const [l, d] = await Promise.all([
        api<any>(
          `/tds?company_id=${current.id}&financial_year=${fy}&payroll_month=${payrollMonth}`,
        ),
        api<any>(
          `/tds/dashboard?company_id=${current.id}&financial_year=${fy}`,
        ),
      ]);
      setRows(l.calculations ?? []);
      setDashboard(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load TDS");
    }
  }
  useEffect(() => {
    void loadEmployees();
    if (current)
      void api<any>(`/settings/payroll?company_id=${current.id}`)
        .then((d) =>
          setRegime(d.payroll?.default_tax_regime === "OLD" ? "OLD" : "NEW"),
        )
        .catch((e) =>
          setError(
            e instanceof Error
              ? e.message
              : "Unable to load company tax settings",
          ),
        );
  }, [current?.id]);
  useEffect(() => {
    if (routeEmployeeId) setEmployeeId(routeEmployeeId);
  }, [routeEmployeeId]);
  useEffect(() => {
    void loadRows();
  }, [current?.id, fy, payrollMonth]);
  useEffect(() => {
    if (!current || !employeeId) return;
    api<any>(
      `/tds/profile/${employeeId}?company_id=${current.id}&financial_year=${fy}`,
    )
      .then((d) =>
        setProfile(
          d.profile ?? {
            previous_employer_taxable_salary:
              selected?.previous_employer_taxable_salary ?? 0,
            previous_employer_tds: selected?.previous_employer_tds ?? 0,
            other_taxable_income: 0,
            other_tds: 0,
            tax_declaration_status: "PENDING",
          },
        ),
      )
      .catch(() =>
        setProfile({
          previous_employer_taxable_salary:
            selected?.previous_employer_taxable_salary ?? 0,
          previous_employer_tds: selected?.previous_employer_tds ?? 0,
          other_taxable_income: 0,
          other_tds: 0,
          tax_declaration_status: "PENDING",
        }),
      );
  }, [current?.id, employeeId, fy]);
  async function calculate() {
    if (!current || !employeeId) {
      setError("Select an employee first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await api<any>(`/tds/calculate?company_id=${current.id}`, {
        method: "POST",
        body: JSON.stringify({
          employee_id: employeeId,
          financial_year: fy,
          tax_regime: regime,
          payroll_month: payrollMonth,
          profile,
        }),
      });
      setResult(d);
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to calculate TDS");
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile() {
    if (!current || !employeeId) return;
    try {
      await api(`/tds/profile?company_id=${current.id}`, {
        method: "PUT",
        body: JSON.stringify({
          employee_id: employeeId,
          financial_year: fy,
          tax_regime: regime,
          ...profile,
        }),
      });
      setProfileSaved("TDS information saved.");
      setTimeout(() => setProfileSaved(""), 2500);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save TDS information",
      );
    }
  }
  async function recalculateAll() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      for (const e of employees) {
        await api(`/tds/calculate?company_id=${current.id}`, {
          method: "POST",
          body: JSON.stringify({
            employee_id: e.id,
            financial_year: fy,
            tax_regime: regime,
            payroll_month: payrollMonth,
          }),
        });
      }
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to recalculate all");
    } finally {
      setBusy(false);
    }
  }
  async function exportTds() {
    if (!current) return;
    try {
      const b = await apiBlob(
        `/tds/export?company_id=${current.id}&financial_year=${fy}`,
      );
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u;
      a.download = `paymate-tds-${fy}.xlsx`;
      a.click();
      URL.revokeObjectURL(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }
  const selected = useMemo(
    () => employees.find((e) => e.id === employeeId),
    [employees, employeeId],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TAX WITHHOLDING</div>
          <h1>TDS & Income Tax</h1>
          <p>Calculate annual tax liability and monthly salary TDS</p>
        </div>
        <div className="heading-actions">
          <Link className="secondary" to="/settings/tax">
            <Settings2 size={16} /> Tax settings
          </Link>
          <button className="secondary" onClick={() => void exportTds()}>
            <ArrowDownToLine size={16} /> Export
          </button>
        </div>
      </div>
      <div className="attendance-controls">
        <label>
          <span>Financial Year</span>
          <select
            className="pm-input"
            value={fy}
            onChange={(e) => setFy(e.target.value)}
          >
            <option>2026-27</option>
            <option>2025-26</option>
          </select>
        </label>
        <label>
          <span>Tax Regime</span>
          <select
            className="pm-input"
            value={regime}
            onChange={(e) => setRegime(e.target.value as Regime)}
          >
            <option value="NEW">New Regime</option>
            <option value="OLD">Old Regime</option>
          </select>
        </label>
        <label>
          <span>Employee</span>
          <select
            className="pm-input"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.first_name} {e.last_name} · {e.employee_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Payroll Month</span>
          <select
            className="pm-input"
            value={payrollMonth}
            onChange={(e) => setPayrollMonth(Number(e.target.value))}
          >
            {[4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || !employeeId}
          onClick={() => void calculate()}
        >
          <Calculator size={16} />
          {busy ? "Calculating…" : "Calculate"}
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void recalculateAll()}
        >
          <RefreshCw size={16} /> Recalculate All
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {employeeId && (
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>TDS Information</h3>
              <span className="muted">Employee tax profile · {fy}</span>
            </div>
            <button className="primary" onClick={() => void saveProfile()}>
              Save TDS information
            </button>
          </div>
          <div className="form-grid-2">
            <label className="field">
              <span>Tax Regime</span>
              <select
                className="pm-input"
                value={regime}
                onChange={(e) => setRegime(e.target.value as Regime)}
              >
                <option value="NEW">New Regime</option>
                <option value="OLD">Old Regime</option>
              </select>
            </label>
            <label className="field">
              <span>Tax Declaration Status</span>
              <select
                className="pm-input"
                value={profile.tax_declaration_status ?? "PENDING"}
                onChange={(e) =>
                  setProfile((v: any) => ({
                    ...v,
                    tax_declaration_status: e.target.value,
                  }))
                }
              >
                <option>PENDING</option>
                <option>SUBMITTED</option>
                <option>VERIFIED</option>
              </select>
            </label>
            <label className="field">
              <span>Previous Employer Taxable Salary</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={profile.previous_employer_taxable_salary ?? 0}
                onChange={(e) =>
                  setProfile((v: any) => ({
                    ...v,
                    previous_employer_taxable_salary: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Previous Employer TDS</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={profile.previous_employer_tds ?? 0}
                onChange={(e) =>
                  setProfile((v: any) => ({
                    ...v,
                    previous_employer_tds: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Other Taxable Income</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={profile.other_taxable_income ?? 0}
                onChange={(e) =>
                  setProfile((v: any) => ({
                    ...v,
                    other_taxable_income: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Other Income TDS</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={profile.other_tds ?? 0}
                onChange={(e) =>
                  setProfile((v: any) => ({
                    ...v,
                    other_tds: Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>
          {profileSaved && <div className="alert success">{profileSaved}</div>}
          <p className="small-note">
            Previous Employer Taxable Salary is treated as already-taxable
            salary. PayMate does not apply the standard deduction to that field
            again.
          </p>
        </section>
      )}
      <div className="stat-grid attendance-stats">
        <div className="stat-card">
          <span>Total Annual TDS</span>
          <strong>{money(dashboard?.totalAnnualTds)}</strong>
          <small>Calculated employees</small>
        </div>
        <div className="stat-card">
          <span>Current Month TDS</span>
          <strong>
            {money(
              result?.currentMonthTds ||
                rows.reduce((n, r) => n + Number(r.current_month_tds), 0),
            )}
          </strong>
          <small>Selected payroll month</small>
        </div>
        <div className="stat-card">
          <span>Employees with TDS</span>
          <strong>{dashboard?.employeesWithTds ?? 0}</strong>
          <small>Remaining liability</small>
        </div>
        <div className="stat-card">
          <span>Zero TDS</span>
          <strong>{dashboard?.employeesWithZeroTds ?? 0}</strong>
          <small>After rebate/relief</small>
        </div>
        <div className="stat-card">
          <span>Previous Employer TDS</span>
          <strong>{money(dashboard?.previousEmployerTds)}</strong>
          <small>Already deducted</small>
        </div>
      </div>
      {result && (
        <section className="dashboard-grid">
          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Annual tax summary</h3>
                <span className="muted">
                  {selected?.first_name} {selected?.last_name} · {fy}
                </span>
              </div>
              <span className="status-badge active">
                {regime === "NEW" ? "New" : "Old"} regime
              </span>
            </div>
            <div className="detail-grid">
              <div>
                <small>Previous Employer Taxable Salary</small>
                <strong>
                  {money(result.inputs.previousEmployerTaxableSalary)}
                </strong>
              </div>
              <div>
                <small>Current Employer Projected Salary</small>
                <strong>{money(result.projection.totalProjectedSalary)}</strong>
              </div>
              <div>
                <small>Other Taxable Income</small>
                <strong>{money(result.inputs.otherTaxableIncome)}</strong>
              </div>
              <div>
                <small>Total Income</small>
                <strong>{money(result.annualTax.totalIncome)}</strong>
              </div>
              <div>
                <small>Standard Deduction</small>
                <strong>{money(result.annualTax.standardDeduction)}</strong>
              </div>
              <div>
                <small>Taxable Income</small>
                <strong>{money(result.annualTax.taxableIncome)}</strong>
              </div>
              <div>
                <small>Tax Before Rebate</small>
                <strong>{money(result.annualTax.taxBeforeRebate)}</strong>
              </div>
              <div>
                <small>Section 87A Rebate</small>
                <strong>{money(result.annualTax.rebate)}</strong>
              </div>
              <div>
                <small>Marginal Relief</small>
                <strong>{money(result.annualTax.marginalRelief)}</strong>
              </div>
              <div>
                <small>Tax After Rebate/Relief</small>
                <strong>{money(result.annualTax.taxAfterRebate)}</strong>
              </div>
              <div>
                <small>Health & Education Cess</small>
                <strong>{money(result.annualTax.cess)}</strong>
              </div>
              <div>
                <small>Annual Tax Liability</small>
                <strong className="green-value">
                  {money(result.annualTax.annualTaxLiability)}
                </strong>
              </div>
              <div>
                <small>Previous + Other TDS</small>
                <strong>
                  {money(
                    result.annualTax.previousTds + result.annualTax.otherTds,
                  )}
                </strong>
              </div>
              <div>
                <small>Remaining TDS</small>
                <strong className="green-value">
                  {money(result.remainingTdsAfterPrior)}
                </strong>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>TDS allocation</h3>
                <span className="muted">
                  Current month: {monthName(payrollMonth)}
                </span>
              </div>
            </div>
            <div className="salary-lines">
              <div>
                <span>Annual TDS to recover</span>
                <strong>{money(result.allocation.annualTdsToRecover)}</strong>
              </div>
              <div>
                <span>Normal monthly TDS</span>
                <strong>{money(result.allocation.normalMonthlyTds)}</strong>
              </div>
              <div>
                <span>First-month TDS</span>
                <strong>{money(result.allocation.firstMonthTds)}</strong>
              </div>
              <div>
                <span>Deferred first-month TDS</span>
                <strong>{money(result.allocation.deferredTds)}</strong>
              </div>
              <div>
                <span>Additional monthly TDS</span>
                <strong>
                  {money(result.allocation.additionalTdsPerMonth)}
                </strong>
              </div>
              <div className="line-total green-total">
                <span>Current month TDS</span>
                <strong>{money(result.currentMonthTds)}</strong>
              </div>
            </div>
            <p className="small-note">
              The first-month method is configurable. Final-month rounding is
              adjusted so the schedule exactly reconciles to the remaining TDS.
            </p>
          </section>
        </section>
      )}
      {result && (
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>TDS Schedule</h3>
              <span className="muted">
                Projected current-employer withholding
              </span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="salary-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Projected Salary</th>
                  <th>TDS Before Allocation</th>
                  <th>Deferred TDS</th>
                  <th>Current Month TDS</th>
                  <th>Cumulative TDS</th>
                  <th>Remaining TDS</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((r: any) => (
                  <tr key={r.payrollMonth}>
                    <td>
                      <strong>{monthName(r.payrollMonth)}</strong>
                      {r.payrollMonth === payrollMonth && (
                        <small>Current</small>
                      )}
                    </td>
                    <td>{money(r.projectedIncome)}</td>
                    <td>{money(result.allocation.normalMonthlyTds)}</td>
                    <td>{money(r.deferredAmount)}</td>
                    <td
                      className={
                        r.payrollMonth === payrollMonth ? "green-value" : ""
                      }
                    >
                      {money(r.tdsAmount)}
                    </td>
                    <td>{money(r.cumulativeTds)}</td>
                    <td>{money(r.remainingTds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>Employee TDS table</h3>
            <span className="muted">{fy}</span>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <FileText size={35} />
            <h3>No TDS calculations yet</h3>
            <p>Select an employee and calculate their annual tax.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Taxable Income</th>
                  <th>Annual Tax</th>
                  <th>Previous TDS</th>
                  <th>Remaining TDS</th>
                  <th>Current Month TDS</th>
                  <th>Regime</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>
                        {r.employees?.first_name} {r.employees?.last_name}
                      </strong>
                      <small>{r.employees?.employee_id}</small>
                    </td>
                    <td>{money(r.taxable_income)}</td>
                    <td>{money(r.annual_tax)}</td>
                    <td>{money(r.previous_tds)}</td>
                    <td>{money(r.remaining_tds)}</td>
                    <td>{money(r.current_month_tds)}</td>
                    <td>{regime}</td>
                    <td>
                      <span
                        className={`status-badge ${r.remaining_tds > 0 ? "active" : "inactive"}`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
