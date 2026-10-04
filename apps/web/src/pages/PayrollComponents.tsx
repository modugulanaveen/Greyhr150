import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";

type Direction = "EARNING" | "DEDUCTION";
type Component = {
  id: string;
  name: string;
  direction: Direction;
  is_taxable: boolean;
  active: boolean;
};

export default function PayrollComponents() {
  const { current } = useCompany();
  const [items, setItems] = useState<Component[]>([]);
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<Direction>("EARNING");
  const [taxable, setTaxable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const result = await api<{ components: Component[] }>(
        `/payroll/components?company_id=${current.id}`,
      );
      setItems(result.components ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load components");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [current?.id]);

  async function add() {
    if (!current || !name.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ component: Component }>(
        `/payroll/components?company_id=${current.id}`,
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            direction,
            is_taxable: direction === "EARNING" && taxable,
          }),
        },
      );
      setItems((previous) => [...previous, result.component].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setMessage(`${result.component.name} added. Enter an amount for each employee in their open payroll run.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add component");
    } finally {
      setBusy(false);
    }
  }

  async function update(component: Component, changes: Partial<Component>) {
    if (!current) return;
    setError("");
    setMessage("");
    try {
      const result = await api<{ component: Component }>(
        `/payroll/components/${component.id}?company_id=${current.id}`,
        { method: "PATCH", body: JSON.stringify(changes) },
      );
      setItems((previous) => previous.map((item) => item.id === component.id ? result.component : item));
      setMessage("Component updated. Recalculate any open payroll that should use the updated TDS treatment.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update component");
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/payroll"><ArrowLeft size={16} /> Payroll</Link>
          <div className="eyebrow">PAYROLL SETUP</div>
          <h1>Payroll Components</h1>
          <p>Set up reusable earning and deduction names. Amounts are entered separately for each employee in an open payroll run.</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <section className="panel">
        <div className="panel-title"><div><h3>Add a component</h3><span className="muted">Examples: Conveyance, Reimbursement, Advance Salary, or Insurance.</span></div></div>
        <div className="form-grid-2">
          <label className="field"><span>Component name</span><input className="pm-input" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="For example: Insurance" /></label>
          <label className="field"><span>Type</span><select className="pm-input" value={direction} onChange={(event) => setDirection(event.target.value as Direction)}><option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option></select></label>
          {direction === "EARNING" && <label className="check-field"><input type="checkbox" checked={taxable} onChange={(event) => setTaxable(event.target.checked)} /> Include in projected taxable earnings</label>}
          <div><button className="primary" type="button" disabled={busy || name.trim().length < 2} onClick={() => void add()}><Plus size={15} /> Add component</button></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title"><div><h3>Available components</h3><span className="muted">Inactive items stay on existing payroll records but cannot be added to new ones.</span></div></div>
        {loading ? <div className="center-screen">Loading components…</div> : items.length ? (
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>TDS treatment</th><th>Status</th><th>Action</th></tr></thead><tbody>
            {items.map((component) => <tr key={component.id}>
              <td>{component.name}</td>
              <td>{component.direction === "EARNING" ? "Earning" : "Deduction"}</td>
              <td>{component.direction === "EARNING" ? <label className="check-field"><input type="checkbox" checked={component.is_taxable} onChange={(event) => void update(component, { is_taxable: event.target.checked })} /> Taxable</label> : "Not applicable"}</td>
              <td>{component.active ? "Active" : "Inactive"}</td>
              <td><button className="secondary" type="button" onClick={() => void update(component, { active: !component.active })}>{component.active ? "Deactivate" : "Activate"}</button></td>
            </tr>)}
          </tbody></table></div>
        ) : <div className="empty-state"><p>No payroll components yet.</p></div>}
      </section>
    </>
  );
}
