import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Clock3,
  FileCheck2,
  FileText,
  IndianRupee,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  UserX,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { api } from "../lib/api";

const money = (v: number) =>
  `₹${Math.round(Number(v) || 0).toLocaleString("en-IN")}`;
const months = Array.from({ length: 12 }, (_, i) => i + 1);
function fyForDate(d = new Date()) {
  const y = d.getFullYear(),
    m = d.getMonth() + 1;
  return m >= 4
    ? `${y}-${String((y + 1) % 100).padStart(2, "0")}`
    : `${y - 1}-${String(y % 100).padStart(2, "0")}`;
}
function fyYears() {
  const y = new Date().getFullYear();
  return [
    `${y}-${String((y + 1) % 100).padStart(2, "0")}`,
    `${y - 1}-${String(y % 100).padStart(2, "0")}`,
    `${y - 2}-${String((y - 1) % 100).padStart(2, "0")}`,
  ];
}
function periodFromFy(value: string) {
  const [y] = value.split("-").map(Number);
  return y;
}
function LineChart({ data }: { data: any[] }) {
  if (!data.length)
    return (
      <div className="chart-empty">No data available for this period.</div>
    );
  const w = 760,
    h = 250,
    p = 28,
    max = Math.max(...data.flatMap((d) => [d.gross, d.net, d.employerCost]), 1);
  const x = (i: number) => p + (i * (w - p * 2)) / Math.max(data.length - 1, 1);
  const y = (v: number) => h - p - (v / max) * (h - p * 2);
  const path = (key: string) =>
    data
      .map((d, i) => `${i ? "L" : "M"} ${x(i)} ${y(Number(d[key]) || 0)}`)
      .join(" ");
  return (
    <div className="chart-scroll">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="line-chart"
        role="img"
        aria-label="Payroll trend"
      >
        <line x1={p} x2={w - p} y1={h - p} y2={h - p} stroke="#e8ebf2" />
        <path d={path("gross")} fill="none" stroke="#7366e8" strokeWidth="3" />
        <path d={path("net")} fill="none" stroke="#3b82f6" strokeWidth="3" />
        <path
          d={path("employerCost")}
          fill="none"
          stroke="#e39b52"
          strokeWidth="3"
        />
        {data.map((d, i) => (
          <g key={d.period}>
            <circle
              cx={x(i)}
              cy={y(Number(d.gross) || 0)}
              r="4"
              fill="#7366e8"
            />
            <text
              x={x(i)}
              y={h - 7}
              textAnchor="middle"
              className="chart-label"
            >
              {String(d.period).split(" ")[0].slice(0, 3)}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="dot purple-dot" />
          Gross
        </span>
        <span>
          <i className="dot blue-dot" />
          Net
        </span>
        <span>
          <i className="dot orange-dot" />
          Employer Cost
        </span>
      </div>
    </div>
  );
}
function BarChart({
  data,
  keyName = "gross",
}: {
  data: any[];
  keyName?: string;
}) {
  if (!data.length)
    return (
      <div className="chart-empty">No data available for this period.</div>
    );
  const max = Math.max(...data.map((d) => Number(d[keyName]) || 0), 1);
  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div className="bar-item" key={d.department || d.label}>
          <div className="bar-label">
            <span>{d.department || d.label}</span>
            <strong>{keyName === "count" ? d.count : money(d[keyName])}</strong>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${Math.max(2, ((Number(d[keyName]) || 0) / max) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function Donut({ items }: { items: any[] }) {
  const total = items.reduce((a, b) => a + Number(b.count || 0), 0);
  if (!total)
    return (
      <div className="chart-empty">No data available for this period.</div>
    );
  let acc = 0;
  const r = 48,
    circ = 2 * Math.PI * r;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" className="donut">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#edf0f5"
          strokeWidth="18"
        />
        {items.map((it, i) => {
          const len = (Number(it.count) / total) * circ;
          const dash = `${len} ${circ - len}`;
          const off = -acc;
          acc += len;
          return (
            <circle
              key={it.label}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={
                [
                  "#7366e8",
                  "#4e8fe8",
                  "#e7a65e",
                  "#46ad8a",
                  "#9aa7ba",
                  "#c96b7b",
                ][i % 6]
              }
              strokeWidth="18"
              strokeDasharray={dash}
              strokeDashoffset={off}
              transform="rotate(-90 60 60)"
            />
          );
        })}
        <text x="60" y="58" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="60" y="72" textAnchor="middle" className="donut-sub">
          employees
        </text>
      </svg>
      <div className="donut-legend">
        {items.map((it, i) => (
          <div key={it.label}>
            <i
              style={{
                background: [
                  "#7366e8",
                  "#4e8fe8",
                  "#e7a65e",
                  "#46ad8a",
                  "#9aa7ba",
                  "#c96b7b",
                ][i % 6],
              }}
            />
            {it.label}
            <strong>{it.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
function Kpi({
  icon: Icon,
  label,
  value,
  support,
  kind = "purple",
}: {
  icon: any;
  label: string;
  value: any;
  support: string;
  kind?: string;
}) {
  return (
    <div className="stat-card dashboard-kpi">
      <div className={`stat-icon ${kind}`}>
        <Icon size={20} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{support}</small>
    </div>
  );
}

export default function Dashboard() {
  const { current, loading, error, refresh } = useCompany();
  const { user } = useAuth();
  const [fy, setFy] = useState(fyForDate());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [data, setData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [widgetError, setWidgetError] = useState("");
  const load = useCallback(async () => {
    if (!current) return;
    setLoadingData(true);
    setWidgetError("");
    try {
      const r = await api<any>(
        `/reports/dashboard?company_id=${current.id}&month=${month}&year=${periodFromFy(fy) + (month >= 4 ? 0 : 1)}`,
      );
      setData(r);
    } catch (e) {
      setWidgetError(
        e instanceof Error ? e.message : "Unable to load dashboard",
      );
    } finally {
      setLoadingData(false);
    }
  }, [current?.id, month, fy]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <div className="center-screen">Loading workspace…</div>;
  if (error)
    return (
      <div className="alert error">
        {error}
        <button onClick={() => void refresh()}>Retry</button>
      </div>
    );
  if (!current) return <Navigate to="/onboarding" replace />;
  const name =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";
  const noPayroll = data?.empty || !data?.selectedRun;
  const quick: [string, string, LucideIcon, string[]][] = [
    ["Add Employee", "/employees", Users, ["OWNER", "COMPANY_ADMIN", "HR"]],
    [
      "Create Payroll",
      "/payroll",
      WalletCards,
      ["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"],
    ],
    [
      "View Payslips",
      "/payslips",
      FileText,
      ["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"],
    ],
    [
      "Attendance",
      "/attendance",
      CalendarDays,
      ["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"],
    ],
    [
      "Generate Reports",
      "/reports",
      BarChart3,
      ["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"],
    ],
    [
      "Compliance",
      "/compliance",
      ShieldCheck,
      ["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"],
    ],
  ];
  const allowed = (roles: string[]) => roles.includes(current.role);
  const statutory = data?.statutory || [];
  const status = data?.status;
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow">PAYROLL CONTROL CENTER</div>
          <h1>Good morning, {name}</h1>
          <p>
            {current.name} ·{" "}
            {data?.selectedRun
              ? new Date(
                  Date.UTC(
                    data.selectedRun.payroll_year,
                    data.selectedRun.payroll_month - 1,
                    1,
                  ),
                ).toLocaleString("en-IN", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })
              : "No payroll period processed yet"}{" "}
            · FY {data?.financial_year || fy}
          </p>
        </div>
        <div className="dashboard-tools">
          <label>
            FY
            <select value={fy} onChange={(e) => setFy(e.target.value)}>
              {fyYears().map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            Month
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {new Date(Date.UTC(2020, m - 1, 1)).toLocaleString("en-IN", {
                    month: "long",
                    timeZone: "UTC",
                  })}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            onClick={() => void load()}
            disabled={loadingData}
          >
            <RefreshCw size={15} className={loadingData ? "spin" : ""} />{" "}
            Refresh Data
          </button>
        </div>
      </div>
      {widgetError && (
        <div className="alert error">
          Unable to load dashboard: {widgetError}{" "}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {noPayroll ? (
        <section className="panel empty-dashboard">
          <Activity size={40} />
          <h2>No payroll has been processed yet.</h2>
          <p>
            Dashboard metrics will appear after an approved or locked payroll
            run is available for the selected period.
          </p>
          <Link className="primary" to="/payroll">
            Open Payroll
          </Link>
        </section>
      ) : (
        <>
          <div className="stat-grid dashboard-kpis">
            <Kpi
              icon={Users}
              label="Total Employees"
              value={data.kpis.totalEmployees}
              support={`${data.kpis.activeEmployees} active employees`}
              kind="blue"
            />
            <Kpi
              icon={WalletCards}
              label="Current Month Payroll"
              value={money(data.kpis.currentMonthPayroll)}
              support="Employer cost"
              kind="purple"
            />
            <Kpi
              icon={IndianRupee}
              label="Gross Payroll"
              value={money(data.kpis.grossPayroll)}
              support="Payroll snapshot"
              kind="orange"
            />
            <Kpi
              icon={IndianRupee}
              label="Net Payroll"
              value={money(data.kpis.netPayroll)}
              support="After employee deductions"
              kind="green"
            />
            <Kpi
              icon={FileText}
              label="Total Deductions"
              value={money(data.kpis.totalDeductions)}
              support={`PF ${money(data.kpis.employeePf)} · PT ${money(data.kpis.pt)} · TDS ${money(data.kpis.tds)}`}
              kind="blue"
            />
            <Kpi
              icon={ShieldCheck}
              label="Employer Contributions"
              value={money(data.kpis.employerContributions)}
              support={`PF ${money(data.kpis.employerContributions)}`}
              kind="purple"
            />
          </div>
          <div className="dashboard-grid dashboard-top-grid">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Monthly Payroll Summary</h3>
                  <span className="muted">Selected payroll period</span>
                </div>
                <span className="status-badge">{data.selectedRun.status}</span>
              </div>
              <div className="summary-grid">
                <div>
                  <span>Gross Earnings</span>
                  <strong>{money(data.summary.gross)}</strong>
                </div>
                <div>
                  <span>Employee Deductions</span>
                  <strong>{money(data.summary.deductions)}</strong>
                </div>
                <div>
                  <span>Net Pay</span>
                  <strong>{money(data.summary.net)}</strong>
                </div>
                <div>
                  <span>Employer Cost</span>
                  <strong>{money(data.summary.employerCost)}</strong>
                </div>
              </div>
              <div className="summary-visual">
                <div
                  style={{
                    width: `${Math.min(100, data.summary.gross ? (data.summary.net / data.summary.gross) * 100 : 0)}%`,
                  }}
                />
                <span>Net pay as % of gross</span>
              </div>
            </section>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Payroll Status</h3>
                  <span className="muted">Current selected run</span>
                </div>
                <Clock3 size={18} />
              </div>
              <div className="status-list">
                <div>
                  <span>Payroll Month</span>
                  <strong>{status.month}</strong>
                </div>
                <div>
                  <span>Employee Count</span>
                  <strong>{status.employeeCount}</strong>
                </div>
                <div>
                  <span>Last Updated</span>
                  <strong>
                    {new Date(status.lastUpdated).toLocaleString("en-IN")}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                  <b
                    className={`status-pill ${String(status.status).toLowerCase()}`}
                  >
                    {status.status}
                  </b>
                </div>
              </div>
              <Link to="/payroll" className="secondary full-link">
                View Payroll <ArrowRight size={15} />
              </Link>
            </section>
          </div>
          <section className="panel chart-panel">
            <div className="panel-title">
              <div>
                <h3>Payroll Trend</h3>
                <span className="muted">
                  Previous available approved/locked months · missing months are
                  not invented
                </span>
              </div>
              <TrendingUp size={18} />
            </div>
            <LineChart data={data.trend} />
          </section>
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Employee Headcount</h3>
                  <span className="muted">Selected month</span>
                </div>
              </div>
              <div className="headcount-cards">
                <div>
                  <Users size={18} />
                  <strong>{data.headcount.active}</strong>
                  <span>Active Employees</span>
                </div>
                <div>
                  <UserPlus size={18} />
                  <strong>{data.headcount.joiners}</strong>
                  <span>New Joiners</span>
                </div>
                <div>
                  <UserX size={18} />
                  <strong>{data.headcount.exited}</strong>
                  <span>Exited Employees</span>
                </div>
              </div>
              <div className="headcount-trend">
                {data.trend.map((t: any) => (
                  <div key={t.period}>
                    <span>{String(t.period).slice(0, 3)}</span>
                    <b>{t.activeEmployees}</b>
                    <small>
                      +{t.joiners} / -{t.exited}
                    </small>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Salary Distribution</h3>
                  <span className="muted">Monthly gross salary</span>
                </div>
              </div>
              <Donut items={data.salaryDistribution} />
            </section>
          </div>
          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Department-wise Payroll</h3>
                <span className="muted">Gross payroll by department</span>
              </div>
              <Link to="/reports/summary" className="text-link">
                Open report <ArrowRight size={14} />
              </Link>
            </div>
            <div className="department-layout">
              <BarChart data={data.departments} keyName="gross" />
              <div className="mini-table">
                <table>
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Employees</th>
                      <th>Gross</th>
                      <th>Net</th>
                      <th>Employer Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.departments.map((d: any) => (
                      <tr key={d.department}>
                        <td>{d.department}</td>
                        <td>{d.employees}</td>
                        <td>{money(d.gross)}</td>
                        <td>{money(d.net)}</td>
                        <td>{money(d.employerCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Attendance & LOP</h3>
                  <span className="muted">
                    Phase 4/6 attendance and payroll snapshot
                  </span>
                </div>
                <CalendarDays size={18} />
              </div>
              <div className="attendance-summary-grid">
                <div>
                  <span>Working Days</span>
                  <strong>{data.attendance.working}</strong>
                </div>
                <div>
                  <span>Present Days</span>
                  <strong>{data.attendance.present}</strong>
                </div>
                <div>
                  <span>Paid Leave</span>
                  <strong>{data.attendance.leave}</strong>
                </div>
                <div>
                  <span>LOP Days</span>
                  <strong>{data.attendance.lop}</strong>
                </div>
                <div>
                  <span>Paid Days</span>
                  <strong>{data.attendance.paid}</strong>
                </div>
                <div>
                  <span>LOP Deduction</span>
                  <strong>{money(data.attendance.lopDeduction)}</strong>
                </div>
              </div>
            </section>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Statutory Compliance</h3>
                  <span className="muted">
                    Phase 8 liabilities and payments
                  </span>
                </div>
                <FileCheck2 size={18} />
              </div>
              <div className="statutory-mini">
                {["PF", "PT", "TDS"].map((t) => {
                  const s = statutory.find((x: any) => x.type === t);
                  return (
                    <div key={t}>
                      <div>
                        <strong>{t}</strong>
                        <b
                          className={`status-pill ${String(s?.status || "PENDING").toLowerCase()}`}
                        >
                          {s?.status || "PENDING"}
                        </b>
                      </div>
                      <span>Liability {money(s?.liability)}</span>
                      <span>Paid {money(s?.paid)}</span>
                      <span>Balance {money(s?.balance)}</span>
                    </div>
                  );
                })}
              </div>
              <Link to="/compliance" className="text-link">
                Open compliance <ArrowRight size={14} />
              </Link>
            </section>
          </div>
          <section className="panel quick-actions">
            <div className="panel-title">
              <div>
                <h3>Quick Actions</h3>
                <span className="muted">Shortcuts based on your role</span>
              </div>
            </div>
            <div className="quick-action-grid">
              {quick
                .filter((q) => allowed(q[3] as string[]))
                .map(([label, path, Icon]) => (
                  <Link key={label} to={path as string}>
                    <span>
                      <Icon size={18} />
                    </span>
                    {label}
                    <ArrowRight size={14} />
                  </Link>
                ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
