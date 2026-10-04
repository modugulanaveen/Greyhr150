import { useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  Download,
  FileText,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api, apiBlob } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";
const money = (v: number) =>
  `₹${Math.round(Number(v) || 0).toLocaleString("en-IN")}`;
const monthName = (m: number) =>
  new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });
export default function Payslips() {
  const { current } = useCompany();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1),
    [year, setYear] = useState(now.getFullYear()),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("ALL"),
    [rows, setRows] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = async () => {
    if (!current) return;
    setLoading(true);
    setError("");
    try {
      const d = await api<any>(
        `/payslips?company_id=${current.id}&month=${month}&year=${year}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      );
      setRows(d.payslips || []);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load payslips");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [current?.id, month, year]);
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          status === "ALL" || (r.payslip?.status || "NOT_GENERATED") === status,
      ),
    [rows, status],
  );
  const canGenerate = (r: any) =>
    ["APPROVED", "LOCKED"].includes(r.run?.status);
  const selectable = filtered
    .filter(
      (r) =>
        canGenerate(r) &&
        (r.payslip?.status === "GENERATED" || r.payslip?.status === undefined),
    )
    .map((r) => r.id);
  const all =
    selectable.length > 0 && selectable.every((id) => selected.includes(id));
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  async function generate(ids: string[]) {
    if (!current || !ids.length) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const d = await api<any>(`/payslips/generate?company_id=${current.id}`, {
        method: "POST",
        body: JSON.stringify({ record_ids: ids }),
      });
      const failures = (d.results || [])
        .filter((result: any) => result.status === "FAILED")
        .map((result: any) => {
          const employee = rows.find((row) => row.id === result.record_id);
          const name = employee
            ? `${employee.employees?.employee_id || "Employee"}`
            : result.record_id;
          return `${name}: ${result.error || "Generation failed"}`;
        });
      await load();
      setMessage(
        `Generated ${d.generated} payslip${d.generated === 1 ? "" : "s"}${d.failed ? `; ${d.failed} failed` : ""}.`,
      );
      if (failures.length) setError(failures.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payslip generation failed");
    } finally {
      setLoading(false);
    }
  }
  async function download(id: string) {
    if (!current) return;
    try {
      const d = await api<any>(
        `/payslips/${id}/download?company_id=${current.id}`,
      );
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download payslip");
    }
  }
  async function bulk() {
    if (!current || !selected.length) return;
    try {
      const b = await apiBlob(
        `/payslips/bulk/download?company_id=${current.id}&month=${month}&year=${year}&ids=${selected.join(",")}`,
      );
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u;
      a.download = `PAYSLIPS_${year}-${String(month).padStart(2, "0")}.zip`;
      a.click();
      URL.revokeObjectURL(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create ZIP");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PAYROLL</div>
          <h1>Payslips</h1>
          <p>
            View and download employee payslips from approved payroll snapshots.
          </p>
        </div>
        <Link className="secondary" to="/payslips/settings">
          <FileText size={15} /> Payslip Settings
        </Link>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}
      <section className="panel">
        <div className="filters-row">
          <label className="field">
            <span>Month</span>
            <select
              className="pm-input"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {monthName(i + 1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Year</span>
            <input
              className="pm-input"
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </label>
          <label className="field grow">
            <span>Search Employee</span>
            <div className="search-box">
              <Search size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void load()}
                placeholder="Employee ID or name"
              />
            </div>
          </label>
          <label className="field">
            <span>Status</span>
            <select
              className="pm-input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="NOT_GENERATED">Not generated</option>
              <option value="GENERATED">Generated</option>
              <option value="FAILED">Failed</option>
            </select>
          </label>
          <button
            className="secondary filter-button"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>
              {monthName(month)} {year}
            </h3>
            <span className="muted">{filtered.length} payroll records</span>
          </div>
          <div className="toolbar-actions">
            <button
              className="secondary"
              disabled={!selected.length || loading}
              onClick={() => void bulk()}
            >
              <Download size={15} /> Download ZIP ({selected.length})
            </button>
            <button
              className="primary"
              disabled={!selected.length || loading}
              onClick={() => void generate(selected)}
            >
              <FileText size={15} /> Generate Selected
            </button>
          </div>
        </div>
        {loading ? (
          <div className="empty-state">
            <p>Loading payslips…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <FileText size={28} />
            <h3>No payslips match your filters.</h3>
            <p>Generate payslips after the payroll run is approved.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <button
                      className="plain-icon"
                          disabled={!selectable.length}
                      onClick={() => setSelected(all ? [] : selectable)}
                    >
                      {all ? <CheckSquare size={17} /> : <Square size={17} />}
                    </button>
                  </th>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Pay Period</th>
                  <th>Gross Pay</th>
                  <th>Deductions</th>
                  <th>Net Pay</th>
                  <th>Status</th>
                  <th>Generated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const ps = r.payslip;
                  const generated = ps?.status === "GENERATED";
                  return (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="plain-icon"
                          disabled={!canGenerate(r)}
                          title={
                            canGenerate(r)
                              ? "Select payslip"
                              : "Approve or lock payroll before generating payslips."
                          }
                          onClick={() => toggle(r.id)}
                        >
                          {selected.includes(r.id) ? (
                            <CheckSquare size={17} />
                          ) : (
                            <Square size={17} />
                          )}
                        </button>
                      </td>
                      <td>
                        <strong>
                          {r.employees?.first_name} {r.employees?.last_name}
                        </strong>
                        <small className="block-muted">
                          {r.employees?.employee_id}
                        </small>
                      </td>
                      <td>{r.employees?.departments?.name || "—"}</td>
                      <td>
                        {monthName(r.run.payroll_month)} {r.run.payroll_year}
                      </td>
                      <td>{money(r.adjusted_gross)}</td>
                      <td>{money(r.total_deductions)}</td>
                      <td className="green-value">{money(r.net_salary)}</td>
                      <td>
                        <span
                          className={`status-badge ${String(ps?.status || "NOT_GENERATED").toLowerCase()}`}
                        >
                          {ps?.status || "NOT_GENERATED"}
                        </span>
                      </td>
                      <td>
                        {ps?.generated_at
                          ? new Date(ps.generated_at).toLocaleDateString(
                              "en-IN",
                            )
                          : "—"}
                      </td>
                      <td>
                        <div className="row-actions">
                          {generated ? (
                            <>
                              <Link
                                className="row-action-icon"
                                title="View"
                                to={`/payslips/${ps.id}`}
                              >
                                View
                              </Link>
                              <button
                                className="row-action-icon"
                                title="Download"
                                onClick={() => void download(ps.id)}
                              >
                                <Download size={15} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="primary small-button"
                              disabled={
                                !canGenerate(r) || loading
                              }
                              title={
                                canGenerate(r)
                                  ? "Generate payslip"
                                  : "Approve or lock payroll before generating payslips."
                              }
                              onClick={() => void generate([r.id])}
                            >
                              Generate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
