import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  CalendarDays,
  Check,
  Clock3,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Save,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { api, apiBlob } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";
import {
  countWorkingDays,
  daysInMonth,
  eligiblePayrollDays,
  type AttendanceSettings,
  type ProrationBasis,
} from "@paymate/shared";

type Row = {
  employee: any;
  record: any;
  preview: any;
  error: string | null;
  dirty?: boolean;
};
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const defaultSettings: AttendanceSettings = {
  prorationBasis: "CALENDAR_DAYS",
  weeklyOffDays: [0, 6],
  holidays: [],
  pfCalculationBasis: "ACTUAL_ADJUSTED_WAGES",
};

function isoNow() {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}
export default function Attendance() {
  const { current } = useCompany();
  const now = isoNow();
  const [month, setMonth] = useState(now.month);
  const [year, setYear] = useState(now.year);
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [departments, setDepartments] = useState<any[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [settings, setSettings] = useState<AttendanceSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const load = async () => {
    if (!current) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        company_id: current.id,
        month: String(month),
        year: String(year),
        department_id: department,
        search,
      });
      const d = await api<any>(`/attendance?${q}`);
      setRows(d.rows ?? []);
      setSettings(d.settings ?? defaultSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load attendance");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (current)
      api<any>(`/employees/departments?company_id=${current.id}`)
        .then((d) => setDepartments(d.departments ?? []))
        .catch(() => setDepartments([]));
    void load();
  }, [current?.id, month, year, department]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 350);
    return () => clearTimeout(t);
  }, [search]);
  const visible = useMemo(() => rows, [rows]);
  function updateRow(
    id: string,
    field: "presentDays" | "paidLeaveDays" | "lopDays",
    value: number,
  ) {
    setError("");
    setMessage("");
    setRows((old) =>
      old.map((r) => {
        if (r.employee.id !== id) return r;
        const nextPreview = {
          ...(r.preview ?? {}),
          presentDays: Number(r.preview?.presentDays ?? r.record?.present_days ?? 0),
          paidLeaveDays: Number(r.preview?.paidLeaveDays ?? r.record?.paid_leave_days ?? 0),
          lopDays: Number(r.preview?.lopDays ?? r.record?.lop_days ?? 0),
          [field]: Math.max(0, Number.isFinite(value) ? Math.round(value) : 0),
        };
        const eligibleDays = eligiblePayrollDays(
          year,
          month,
          r.employee.date_of_joining,
          settings,
        );
        nextPreview.paidDays = Math.max(
          0,
          eligibleDays - Number(nextPreview.lopDays ?? 0),
        );
        const overLimit =
          nextPreview.presentDays + nextPreview.paidLeaveDays + nextPreview.lopDays >
          eligibleDays;
        return {
          ...r,
          preview: nextPreview,
          dirty: true,
          error: overLimit
            ? `Present, paid leave, and LOP total ${nextPreview.presentDays + nextPreview.paidLeaveDays + nextPreview.lopDays}, over the ${eligibleDays} eligible days.`
            : null,
        };
      }),
    );
  }
  async function save() {
    if (!current) return;
    setError("");
    setMessage("");
    const changedRows = rows.filter((r) => r.dirty);
    if (!changedRows.length) {
      setError("");
      setMessage("No attendance changes to save. Enter or edit attendance days first.");
      return;
    }
    const bad = changedRows.filter((r) => r.error);
    if (bad.length) {
      setError(
        "Fix attendance errors before saving.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(
        `/attendance?company_id=${current.id}&month=${month}&year=${year}`,
        {
          method: "PUT",
          body: JSON.stringify({
            rows: changedRows.map((r) => ({
              employee_id: r.employee.id,
              present_days: r.preview.presentDays,
              paid_leave_days: r.preview.paidLeaveDays,
              lop_days: r.preview.lopDays,
            })),
          }),
        },
      );
      setMessage("Attendance saved successfully.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save attendance");
    } finally {
      setSaving(false);
    }
  }
  async function exportXlsx() {
    if (!current) return;
    try {
      const blob = await apiBlob(
        `/attendance/export?company_id=${current.id}&month=${month}&year=${year}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paymate-attendance-${year}-${String(month).padStart(2, "0")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }
  async function template() {
    try {
      const blob = await apiBlob("/attendance/template");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "paymate-attendance-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Template download failed");
    }
  }
  async function previewImport() {
    if (!current || !importFile) return;
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const d = await api<any>(
        `/attendance/import-preview?company_id=${current.id}&month=${month}&year=${year}`,
        { method: "POST", body: fd },
      );
      setImportPreview(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to preview import");
    }
  }
  async function confirmImport() {
    if (!current || !importPreview || importPreview.errors?.length) return;
    try {
      const q = (importPreview.validRows ?? []).map((r: any) => ({
        employee_id: r.employee_id,
        present_days: Number(r.present_days),
        paid_leave_days: Number(r.paid_leave_days),
        lop_days: Number(r.lop_days),
      }));
      if (!q.length) {
        setError("No imported attendance rows to save.");
        return;
      }
      const d = await api<any>(
        `/attendance/import?company_id=${current.id}&month=${month}&year=${year}`,
        { method: "POST", body: JSON.stringify({ rows: q }) },
      );
      setMessage(d.message);
      setImportOpen(false);
      setImportPreview(null);
      setImportFile(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to import attendance");
    }
  }
  async function loadHistory(employeeId: string) {
    if (!current) return;
    try {
      setHistory(
        await api<any>(
          `/attendance/employee/${employeeId}/history?company_id=${current.id}`,
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load attendance history",
      );
    }
  }
  const monthLabel = `${monthNames[month - 1]} ${year}`;
  const employeesWithLop = visible.filter(
    (r) => Number(r.preview?.lopDays ?? r.record?.lop_days ?? 0) > 0,
  ).length;
  const totalLopDays = visible.reduce(
    (sum, r) => sum + Number(r.preview?.lopDays ?? r.record?.lop_days ?? 0),
    0,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MONTHLY ATTENDANCE</div>
          <h1>Attendance & LOP</h1>
          <p>Manage monthly attendance and loss of pay for {current?.name}.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={16} /> Settings
          </button>
          <button className="secondary" onClick={() => void template()}>
            <Download size={16} /> Template
          </button>
          <button className="secondary" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Import Attendance
          </button>
          <button className="secondary" onClick={() => void exportXlsx()}>
            <ArrowDownToLine size={16} /> Export
          </button>
          <button
            className="primary"
            disabled={saving}
            onClick={() => void save()}
          >
            <Save size={16} /> {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
      <div className="attendance-controls">
        <label>
          <span>Payroll Month</span>
          <select
            className="pm-input"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {monthNames.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Year</span>
          <input
            className="pm-input"
            type="number"
            value={year}
            min="1900"
            max="2200"
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label className="attendance-search">
          <span>Search Employee</span>
          <input
            className="pm-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or Employee ID"
          />
        </label>
        <label>
          <span>Department</span>
          <select
            className="pm-input"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="stat-grid attendance-stats">
        <div className="stat-card">
          <div className="stat-icon blue">
            <CalendarDays size={20} />
          </div>
          <span>Total Employees</span>
          <strong>{visible.length}</strong>
          <small>{monthLabel}</small>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">
            <Clock3 size={20} />
          </div>
          <span>Employees with LOP</span>
          <strong>{employeesWithLop}</strong>
          <small>Needs review</small>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">
            <Clock3 size={20} />
          </div>
          <span>Total LOP Days</span>
          <strong>{totalLopDays}</strong>
          <small>Across employees</small>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}
      <section className="panel employee-panel">
        <div className="attendance-note">
          <strong>{monthLabel}</strong>
          <span>
            Working days:{" "}
            {settings.prorationBasis === "CALENDAR_DAYS"
              ? "Calendar Days"
              : "Working Days"}
          </span>
          <button className="secondary" onClick={() => void load()}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="empty-state">Loading attendance…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <CalendarDays size={36} />
            <h3>No active employees for this period</h3>
            <p>Active employees whose joining date is within or before the selected month are shown here.</p>
          </div>
        ) : (
          <div className="table-wrap attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Joining</th><th>Working Days</th>
                  <th>Present</th><th>Paid Leave</th><th>LOP</th><th>Paid Days</th>
                  <th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.employee.id}>
                    <td><strong>{r.employee.first_name} {r.employee.last_name}</strong><small>{r.employee.employee_id}</small></td>
                    <td>{r.employee.date_of_joining}</td>
                    <td>{r.preview?.workingDays ?? r.record?.working_days ?? countWorkingDays(year, month, settings, Math.max(1, new Date(`${r.employee.date_of_joining}T00:00:00Z`).getUTCDate()), daysInMonth(year, month))}</td>
                    <td><input className="mini-input" type="number" min="0" value={r.dirty ? r.preview?.presentDays ?? 0 : r.record?.present_days ?? 0} onChange={(e) => updateRow(r.employee.id, "presentDays", Number(e.target.value))} /></td>
                    <td><input className="mini-input" type="number" min="0" value={r.dirty ? r.preview?.paidLeaveDays ?? 0 : r.record?.paid_leave_days ?? 0} onChange={(e) => updateRow(r.employee.id, "paidLeaveDays", Number(e.target.value))} /></td>
                    <td><input className="mini-input lop-input" type="number" min="0" value={r.dirty ? r.preview?.lopDays ?? 0 : r.record?.lop_days ?? 0} onChange={(e) => updateRow(r.employee.id, "lopDays", Number(e.target.value))} /></td>
                    <td>{r.dirty ? r.preview?.paidDays ?? 0 : r.record?.paid_days ?? 0}</td>
                    <td><span className={`status-badge ${r.dirty ? "on_notice" : r.record ? "active" : "on_notice"}`}>{r.dirty ? "Unsaved" : r.record ? "Saved" : "Draft"}</span>{r.dirty && r.error && <small className="field-error">{r.error}</small>}</td>
                    <td><button className="row-action-icon" title="Attendance history" onClick={() => void loadHistory(r.employee.id)}><Clock3 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {settingsOpen && (
        <AttendanceSettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSaved={(s) => { setSettings(s); setSettingsOpen(false); void load(); }} />
      )}
      {importOpen && (
        <ImportModal file={importFile} setFile={setImportFile} preview={importPreview} onPreview={previewImport} onConfirm={confirmImport} onClose={() => { setImportOpen(false); setImportPreview(null); setImportFile(null); }} />
      )}
      {importOpen && (
        <ImportModal
          file={importFile}
          setFile={setImportFile}
          preview={importPreview}
          onPreview={previewImport}
          onConfirm={confirmImport}
          onClose={() => {
            setImportOpen(false);
            setImportPreview(null);
            setImportFile(null);
          }}
        />
      )}
      {history && (
        <div className="modal-backdrop">
          <div className="detail-modal">
            <div className="drawer-head">
              <div>
                <div className="eyebrow">ATTENDANCE HISTORY</div>
                <h2>
                  {history.employee.first_name} {history.employee.last_name}
                </h2>
                <p>{history.employee.employee_id}</p>
              </div>
              <button className="icon-button" onClick={() => setHistory(null)}>
                <X />
              </button>
            </div>
            <div className="history-table">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Working</th>
                    <th>Present</th>
                    <th>Leave</th>
                    <th>LOP</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {history.history.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        {monthNames[r.payroll_month - 1]} {r.payroll_year}
                      </td>
                      <td>{r.working_days}</td>
                      <td>{r.present_days}</td>
                      <td>{r.paid_leave_days}</td>
                      <td>{r.lop_days}</td>
                      <td>{r.paid_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AttendanceSettingsModal({
  settings,
  onClose,
  onSaved,
}: {
  settings: AttendanceSettings;
  onClose: () => void;
  onSaved: (s: AttendanceSettings) => void;
}) {
  const { current } = useCompany();
  const [s, setS] = useState<AttendanceSettings>(settings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!current) return;
    setBusy(true);
    try {
      const d = await api<any>(
        `/attendance/settings?company_id=${current.id}`,
        { method: "PUT", body: JSON.stringify(s) },
      );
      onSaved(d.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save settings");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <div className="settings-modal">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">ATTENDANCE SETTINGS</div>
            <h2>Attendance configuration</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="salary-modal-body">
          <section className="settings-block">
            <h3>Working day calculation</h3>
            <div className="form-grid-2">
              <label className="field">
                <span>Working day basis</span>
                <select
                  className="pm-input"
                  value={s.prorationBasis}
                  onChange={(e) =>
                    setS((v) => ({
                      ...v,
                      prorationBasis: e.target.value as ProrationBasis,
                    }))
                  }
                >
                  <option value="CALENDAR_DAYS">Calendar Days</option>
                  <option value="WORKING_DAYS">Working Days</option>
                </select>
              </label>
            </div>
          </section>
          <section className="settings-block">
            <h3>Weekly Offs</h3>
            <div className="weekday-grid">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((n, i) => (
                <label key={n} className="check-field">
                  <input
                    type="checkbox"
                    checked={s.weeklyOffDays.includes(i)}
                    onChange={(e) =>
                      setS((v) => ({
                        ...v,
                        weeklyOffDays: e.target.checked
                          ? [...v.weeklyOffDays, i]
                          : v.weeklyOffDays.filter((d) => d !== i),
                      }))
                    }
                  />
                  {n}
                </label>
              ))}
            </div>
          </section>
          <section className="settings-block">
            <h3>Holidays</h3>
            <textarea
              className="pm-input pm-textarea"
              value={s.holidays.join("\n")}
              onChange={(e) =>
                setS((v) => ({
                  ...v,
                  holidays: e.target.value
                    .split(/\n|,/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="2026-10-02\n2026-10-20"
            />
            <p className="small-note">
              Enter ISO dates. Holidays affect Working Days proration.
            </p>
          </section>
          {error && <div className="alert error">{error}</div>}
          <div className="drawer-actions">
            <button className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportModal({
  file,
  setFile,
  preview,
  onPreview,
  onConfirm,
  onClose,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  preview: any;
  onPreview: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="settings-modal import-modal">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">ATTENDANCE IMPORT</div>
            <h2>Import attendance from Excel</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="salary-modal-body">
          <label className="upload-card">
            <FileSpreadsheet size={22} />
            <strong>{file ? file.name : "Choose an .xlsx file"}</strong>
            <small>Maximum 5 MB. Employee ID is the matching key.</small>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="drawer-actions">
            <button className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={!file} onClick={onPreview}>
              Preview Import
            </button>
          </div>
          {preview && (
            <div className="import-preview">
              <div className="stat-grid">
                <div className="stat-card">
                  <span>Imported</span>
                  <strong>{preview.imported}</strong>
                </div>
                <div className="stat-card">
                  <span>Valid</span>
                  <strong>{preview.valid}</strong>
                </div>
                <div className="stat-card">
                  <span>Errors</span>
                  <strong>{preview.errors?.length ?? 0}</strong>
                </div>
              </div>
              {preview.errors?.length ? (
                <div className="import-errors">
                  {preview.errors.map((e: any, i: number) => (
                    <div key={i}>
                      <strong>Row {e.row}</strong> · {e.employee_id || "—"} ·{" "}
                      {e.error}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="alert success">
                  <Check size={16} /> Import is valid. Confirm to save.
                </div>
              )}
              <div className="drawer-actions">
                <button className="secondary" onClick={onClose}>
                  Cancel Import
                </button>
                <button
                  className="primary"
                  disabled={Boolean(preview.errors?.length)}
                  onClick={onConfirm}
                >
                  <Check size={16} /> Confirm Import
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
