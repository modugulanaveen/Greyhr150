import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";

const money = (value: number) =>
  `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;
const closedStatuses = ["APPROVED", "LOCKED"];

export default function PayrollEmployee() {
  const { payrollId, employeeId } = useParams();
  const { current } = useCompany();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    component_id: "",
    amount: "",
    reason: "",
    notes: "",
    repeat_every_month: false,
  });
  const [editForm, setEditForm] = useState({ amount: "", reason: "", notes: "" });

  async function load() {
    if (!current || !payrollId || !employeeId) return;
    try {
      const result = await api<any>(
        `/payroll/${payrollId}/employee/${employeeId}?company_id=${current.id}`,
      );
      setData(result);
      setError("");
      setForm((previous) => ({
        ...previous,
        component_id:
          previous.component_id || result.components?.[0]?.id || "",
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load payroll detail");
    }
  }

  useEffect(() => {
    void load();
  }, [current?.id, payrollId, employeeId]);

  async function add() {
    if (!current || !payrollId || !employeeId) return;
    try {
      await api(`/payroll/${payrollId}/adjustments?company_id=${current.id}`, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          employee_id: employeeId,
          amount: Number(form.amount),
        }),
      });
      setShow(false);
      setForm({ component_id: data?.components?.[0]?.id || "", amount: "", reason: "", notes: "", repeat_every_month: false });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add adjustment");
    }
  }

  function startEdit(item: any) {
    setEditing(item);
    setEditForm({ amount: String(item.amount), reason: item.reason || "", notes: item.notes || "" });
  }

  async function saveEdit() {
    if (!current || !payrollId || !editing) return;
    try {
      await api(`/payroll/${payrollId}/adjustments/${editing.id}?company_id=${current.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...editForm, amount: Number(editForm.amount) }),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update adjustment");
    }
  }

  async function stopRepeat(recurringId: string) {
    if (!current || !payrollId) return;
    try {
      await api(`/payroll/recurring-components/${recurringId}/stop?company_id=${current.id}`, { method: "PATCH" });
      setMessage("Future monthly repeats stopped. This month’s amount is unchanged.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to stop monthly repeats");
    }
  }

  async function remove(id: string) {
    if (!current || !payrollId) return;
    try {
      await api(`/payroll/${payrollId}/adjustments/${id}?company_id=${current.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to remove adjustment");
    }
  }

  const components = data?.components ?? [];
  const selectedComponent = components.find(
    (component: any) => component.id === form.component_id,
  );
  const earnings = useMemo(
    () => (data?.adjustments ?? []).filter((item: any) =>
      (item.component_type ?? (item.adjustment_type === "OTHER_DEDUCTION" ? "DEDUCTION" : "EARNING")) === "EARNING",
    ),
    [data?.adjustments],
  );
  const customDeductions = useMemo(
    () => (data?.adjustments ?? []).filter((item: any) =>
      (item.component_type ?? (item.adjustment_type === "OTHER_DEDUCTION" ? "DEDUCTION" : "EARNING")) === "DEDUCTION",
    ),
    [data?.adjustments],
  );

  if (!data) return <div className="center-screen">{error || "Loading payroll detail…"}</div>;
  const record = data.record;
  const employee = record.employees;
  const adjustmentsOpen = !closedStatuses.includes(data.run.status);
  const componentLabel = (item: any) =>
    item.component_name || item.adjustment_type?.replaceAll("_", " ") || "Adjustment";

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/payroll"><ArrowLeft size={16} /> Back to payroll</Link>
          <div className="eyebrow">PAYROLL DETAIL</div>
          <h1>{employee.first_name} {employee.last_name}</h1>
          <p>{employee.employee_id} · {data.run.payroll_month}/{data.run.payroll_year}</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}
      <div className="detail-grid payroll-detail-grid">
        <div><small>Paid Days</small><strong>{record.paid_days}</strong></div>
        <div><small>LOP Days</small><strong>{record.lop_days}</strong></div>
        <div><small>Original Gross</small><strong>{money(record.gross_salary)}</strong></div>
        <div><small>LOP Deduction</small><strong>{money(record.lop_deduction)}</strong></div>
        <div><small>Adjusted Gross</small><strong>{money(record.adjusted_gross)}</strong></div>
        <div><small>Employee PF</small><strong>{money(record.employee_pf)}</strong></div>
        <div><small>Employer PF</small><strong>{money(record.employer_pf)}</strong></div>
        <div><small>PT</small><strong>{money(record.professional_tax)}</strong></div>
        <div><small>TDS</small><strong>{money(record.tds)}</strong></div>
        <div><small>Total Deductions</small><strong>{money(record.total_deductions)}</strong></div>
        <div><small>Net Salary</small><strong className="green-value">{money(record.net_salary)}</strong></div>
        <div><small>Employer Cost</small><strong>{money(record.employer_cost)}</strong></div>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-title"><h3>Earnings</h3></div>
          <div className="salary-lines">
            <div><span>Basic</span><strong>{money(record.basic_salary)}</strong></div>
            <div><span>Special Allowance</span><strong>{money(record.special_allowance)}</strong></div>
            {earnings.map((item: any) => <div key={item.id}><span>{componentLabel(item)}</span><strong>{money(item.amount)}</strong></div>)}
            <div><span>Gross</span><strong>{money(record.gross_salary)}</strong></div>
            <div><span>LOP Deduction</span><strong className="deduction">− {money(record.lop_deduction)}</strong></div>
            <div className="line-total"><span>Adjusted Gross</span><strong>{money(record.adjusted_gross)}</strong></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-title"><h3>Deductions</h3></div>
          <div className="salary-lines">
            <div><span>Employee PF</span><strong>{money(record.employee_pf)}</strong></div>
            <div><span>Professional Tax</span><strong>{money(record.professional_tax)}</strong></div>
            <div><span>TDS</span><strong>{money(record.tds)}</strong></div>
            <div><span>Other Deductions</span><strong>{money(record.other_deductions)}</strong></div>
            {customDeductions.map((item: any) => <div key={item.id}><span>{componentLabel(item)}</span><strong>{money(item.amount)}</strong></div>)}
            <div className="line-total"><span>Net Salary</span><strong className="green-value">{money(record.net_salary)}</strong></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-title">
          <div><h3>Payroll components</h3><span className="muted">Each item is saved by name and included in payroll totals.</span></div>
          <button className="primary" disabled={!adjustmentsOpen} onClick={() => setShow(true)}><Plus size={15} /> Add component</button>
        </div>
        {data.adjustments?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Component</th><th>Type</th><th>Amount</th><th>Reason</th><th>Notes</th><th>Repeat</th><th>Actions</th></tr></thead>
              <tbody>{data.adjustments.map((item: any) => (
                <tr key={item.id}>
                  <td>{componentLabel(item)}</td>
                  <td>{(item.component_type ?? (item.adjustment_type === "OTHER_DEDUCTION" ? "DEDUCTION" : "EARNING")) === "DEDUCTION" ? "Deduction" : "Earning"}</td>
                  <td>{money(item.amount)}</td><td>{item.reason}</td><td>{item.notes || "—"}</td>
                  <td>{item.recurring_active ? <><span>Every month</span><button className="secondary" onClick={() => void stopRepeat(item.recurring_component_id)}>Stop future repeats</button></> : item.recurring_component_id ? "Repeat stopped" : "This month"}</td>
                  <td><button className="row-action-icon" disabled={!adjustmentsOpen} onClick={() => startEdit(item)} aria-label={`Edit ${componentLabel(item)} for this month`}><Pencil size={15} /></button><button className="row-action-icon" disabled={!adjustmentsOpen} onClick={() => void remove(item.id)} aria-label={`Delete ${componentLabel(item)} for this month`}><Trash2 size={15} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="empty-state compact"><p>No added payroll components.</p></div>}
      </section>

      {show && <div className="modal-backdrop"><div className="confirm-modal">
        <h2>Add payroll component</h2>
        {components.length ? <div className="form-grid-2">
          <label className="field"><span>Component</span><select className="pm-input" value={form.component_id} onChange={(event) => setForm({ ...form, component_id: event.target.value })}>{components.map((component: any) => <option key={component.id} value={component.id}>{component.name} · {component.direction === "EARNING" ? "Earning" : "Deduction"}{component.direction === "EARNING" ? (component.is_taxable ? " · taxable" : " · non-taxable") : ""}</option>)}</select></label>
          <label className="field"><span>Amount</span><input className="pm-input" type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
          <label className="field full-span"><span>Reason</span><input className="pm-input" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
          <label className="field full-span"><span>Notes</span><textarea className="pm-input pm-textarea" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <label className="check-field full-span"><input type="checkbox" checked={form.repeat_every_month} onChange={(event) => setForm({ ...form, repeat_every_month: event.target.checked })} /> Repeat this amount for this employee every month from this payroll month</label>
          {selectedComponent?.direction === "EARNING" && <span className="muted full-span">This earning is {selectedComponent.is_taxable ? "included" : "excluded"} in projected taxable earnings.</span>}
        </div> : <p>No active components. Add them in Settings → Payroll earnings and deductions.</p>}
        <div className="drawer-actions"><button className="secondary" onClick={() => setShow(false)}>Cancel</button><button className="primary" disabled={!components.length || !form.amount || !form.reason.trim()} onClick={() => void add()}>Save component</button></div>
      </div></div>}
      {editing && <div className="modal-backdrop"><div className="confirm-modal">
        <h2>Edit component for this month</h2>
        <p>This changes only {data.run.payroll_month}/{data.run.payroll_year}. Future recurring months keep their scheduled amount.</p>
        <div className="form-grid-2">
          <label className="field"><span>Amount</span><input className="pm-input" type="number" min="0.01" step="0.01" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })} /></label>
          <label className="field"><span>Reason</span><input className="pm-input" value={editForm.reason} onChange={(event) => setEditForm({ ...editForm, reason: event.target.value })} /></label>
          <label className="field full-span"><span>Notes</span><textarea className="pm-input pm-textarea" value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} /></label>
        </div>
        <div className="drawer-actions"><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={!editForm.amount || Number(editForm.amount) <= 0 || editForm.reason.trim().length < 2} onClick={() => void saveEdit()}>Save this month</button></div>
      </div></div>}
    </>
  );
}
