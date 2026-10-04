import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useCompany } from "../contexts/CompanyContext";
import { api } from "../lib/api";
import ReportTable from "../components/ReportTable";
import {
  ReportFilters,
  defaultFilters,
  type ReportFilterState,
} from "../components/ReportFilters";

const names: any = {
  payroll: "Payroll Register",
  summary: "Payroll Summary",
  employees: "Employee Report",
  joiners: "New Joiners",
  exits: "Employee Exits",
  salary: "Salary Register",
  "salary-revisions": "Salary Revision Report",
  attendance: "Attendance Report",
  lop: "LOP Report",
  deductions: "Deduction Report",
  "employer-cost": "Employer Cost Report",
  statutory: "Statutory Reports",
  payslips: "Payslip Status Report",
};
function yearFor(month: string, fy: string) {
  if (!month || !fy) return "";
  const start = Number(fy.slice(0, 4));
  return Number(month) >= 4 ? String(start) : String(start + 1);
}
export default function ReportPage() {
  const { type = "payroll" } = useParams();
  const { current } = useCompany();
  const [filters, setFilters] = useState<ReportFilterState>(defaultFilters);
  const [data, setData] = useState<any>({
    rows: [],
    summary: {},
    total: 0,
    page: 1,
    total_pages: 1,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({
        company_id: current.id,
        page: String(page),
        limit: "25",
      });
      const year = yearFor(filters.month, filters.financialYear);
      if (filters.month) p.set("month", filters.month);
      if (year) p.set("year", year);
      if (filters.financialYear) p.set("financial_year", filters.financialYear);
      if (filters.payrollRunId) p.set("payroll_run_id", filters.payrollRunId);
      if (filters.departmentId) p.set("department_id", filters.departmentId);
      if (filters.employeeId) p.set("employee_id", filters.employeeId);
      if (filters.dateFrom) p.set("date_from", filters.dateFrom);
      if (filters.dateTo) p.set("date_to", filters.dateTo);
      if (filters.status) p.set("status", filters.status);
      const r = await api<any>(`/reports/${type}?${p}`);
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load report");
    } finally {
      setLoading(false);
    }
  }, [current?.id, type, page, filters]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setPage(1), [filters, type]);
  const exportQuery = useMemo(() => {
    if (!current) return "";
    const p = new URLSearchParams({ company_id: current.id });
    const year = yearFor(filters.month, filters.financialYear);
    if (filters.month) p.set("month", filters.month);
    if (year) p.set("year", year);
    if (filters.financialYear) p.set("financial_year", filters.financialYear);
    if (filters.payrollRunId) p.set("payroll_run_id", filters.payrollRunId);
    if (filters.departmentId) p.set("department_id", filters.departmentId);
    if (filters.employeeId) p.set("employee_id", filters.employeeId);
    if (filters.dateFrom) p.set("date_from", filters.dateFrom);
    if (filters.dateTo) p.set("date_to", filters.dateTo);
    return `/reports/${type}/export?${p}`;
  }, [current?.id, type, filters]);
  if (type === "statutory")
    return (
      <>
        <div className="page-heading">
          <div>
            <Link to="/reports" className="back-link">
              <ArrowLeft size={14} /> Reports
            </Link>
            <div className="eyebrow">STATUTORY</div>
            <h1>Statutory Reports</h1>
            <p>Reuse the Phase 8 statutory compliance module.</p>
          </div>
        </div>
        <div className="statutory-report-links">
          {(
            data.links || [
              { label: "PF Report", path: "/compliance/pf" },
              { label: "PT Report", path: "/compliance/pt" },
              { label: "TDS Report", path: "/compliance/tds" },
              {
                label: "Statutory Payment Report",
                path: "/compliance/payments",
              },
            ]
          ).map((x: any) => (
            <Link key={x.label} to={x.path} className="report-card">
              <div>
                <h3>{x.label}</h3>
                <p>Open the existing compliance workflow.</p>
              </div>
              <ExternalLink size={17} />
            </Link>
          ))}
        </div>
      </>
    );
  const summaryEntries = Object.entries(data.summary || {}).filter(([k]) =>
    [
      "totalEmployees",
      "gross",
      "deductions",
      "net",
      "employerCost",
      "generated",
      "not_generated",
      "failed",
    ].includes(k),
  );
  const dateReports = type === "joiners" || type === "exits";
  return (
    <>
      <div className="page-heading">
        <div>
          <Link to="/reports" className="back-link">
            <ArrowLeft size={14} /> Reports
          </Link>
          <div className="eyebrow">REPORT</div>
          <h1>{names[type] || "Report"}</h1>
          <p>
            {data.run
              ? `Period: ${new Date(Date.UTC(data.run.payroll_year, data.run.payroll_month - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} · ${data.financial_year}`
              : "Select filters to explore available records."}
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>
      <ReportFilters
        companyId={current?.id || ""}
        value={filters}
        onChange={(v) => {
          setFilters(v);
          setPage(1);
        }}
        showDates={dateReports}
        showStatus={type === "payslips" || type === "employees"}
      />
      {error && <div className="alert error">{error}</div>}
      <div className="report-summary-strip">
        {summaryEntries.map(([k, v]) => (
          <div key={k}>
            <span>{k.replace(/_/g, " ")}</span>
            <strong>
              {typeof v === "number"
                ? Math.round(v as number).toLocaleString("en-IN")
                : String(v)}
            </strong>
          </div>
        ))}
      </div>
      <ReportTable
        rows={data.rows || []}
        total={data.total || 0}
        page={data.page || page}
        totalPages={data.total_pages || 1}
        loading={loading}
        onPageChange={setPage}
        exportUrl={exportQuery}
        requiredColumns={[
          "employee_id",
          "employee_name",
          "EmployeeID",
          "Employee",
        ]}
      />
    </>
  );
}
