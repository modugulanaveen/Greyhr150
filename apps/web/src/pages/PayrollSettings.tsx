import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";
import TaxSettings from "./TaxSettings";

type TaxRegime = "NEW" | "OLD";
type PtSlab = { min: number; max: number | null; amount: number };

type SettingsForm = {
  pf_enabled: boolean;
  minimum_basic: number;
  basic_percentage: number;
  employee_pf_rate: number;
  employer_pf_rate: number;
  pf_wage_ceiling: number;
  proration_basis: "CALENDAR_DAYS" | "WORKING_DAYS";
  pt_enabled: boolean;
  pt_state: string;
  pt_slabs: PtSlab[];
  default_tax_regime: TaxRegime;
};

const defaults: SettingsForm = {
  pf_enabled: true,
  minimum_basic: 20000,
  basic_percentage: 50,
  employee_pf_rate: 12,
  employer_pf_rate: 12,
  pf_wage_ceiling: 25000,
  proration_basis: "CALENDAR_DAYS",
  pt_enabled: false,
  pt_state: "",
  pt_slabs: [],
  default_tax_regime: "NEW",
};

export default function PayrollSettings() {
  const { current } = useCompany();
  const [settings, setSettings] = useState<SettingsForm>(defaults);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!current) return;
    setLoading(true);
    void api<any>(`/settings/payroll?company_id=${current.id}`)
      .then((result) =>
        setSettings({
          pf_enabled: result.pf.enabled !== false,
          minimum_basic: Number(
            result.pf.minimum_basic ?? defaults.minimum_basic,
          ),
          basic_percentage: Number(
            result.pf.basic_percentage ?? defaults.basic_percentage,
          ),
          employee_pf_rate: Number(
            result.pf.employee_pf_rate ?? defaults.employee_pf_rate,
          ),
          employer_pf_rate: Number(
            result.pf.employer_pf_rate ?? defaults.employer_pf_rate,
          ),
          pf_wage_ceiling: Number(
            result.pf.pf_wage_ceiling ?? defaults.pf_wage_ceiling,
          ),
          proration_basis:
            result.attendance.proration_basis ?? defaults.proration_basis,
          pt_enabled: Boolean(result.pt.enabled),
          pt_state: result.pt.state ?? "",
          pt_slabs: Array.isArray(result.pt.slabs) ? result.pt.slabs : [],
          default_tax_regime:
            result.payroll.default_tax_regime === "OLD" ? "OLD" : "NEW",
        }),
      )
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Unable to load payroll settings",
        ),
      )
      .finally(() => setLoading(false));
  }, [current?.id]);

  function set<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  function updateSlab(index: number, patch: Partial<PtSlab>) {
    set(
      "pt_slabs",
      settings.pt_slabs.map((slab, i) =>
        i === index ? { ...slab, ...patch } : slab,
      ),
    );
  }

  async function save() {
    if (!current) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/settings/payroll?company_id=${current.id}`, {
        method: "PUT",
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          ...settings,
          pt_state: settings.pt_state.trim() || null,
          currency: "INR",
        }),
      });
      setMessage(
        "Company payroll settings saved for future calculations. Historical payroll snapshots are unchanged.",
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name === "TimeoutError"
          ? "Saving timed out. Refresh payroll settings to verify whether the changes were saved."
          : e instanceof Error
            ? e.message
            : "Unable to save payroll settings",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return <div className="center-screen">Loading payroll settings…</div>;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/settings">
            <ArrowLeft size={16} /> Settings
          </Link>
          <div className="eyebrow">COMPANY PAYROLL</div>
          <h1>Salary &amp; Tax Settings</h1>
          <p>
            PF, PT, and TDS settings are used when payroll is calculated. Locked
            payroll snapshots remain unchanged. To apply saved settings to an
            unlocked payroll, recalculate it before submitting it for review.
          </p>
        </div>
        <div className="heading-actions">
          <Link className="secondary" to="/payroll/components">Manage payroll components</Link>
          <button className="primary" onClick={() => void save()} disabled={busy}>
          <Save size={15} /> {busy ? "Saving…" : "Save company settings"}
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <section className="panel">
        <div className="settings-block">
          <h3>Basic salary and PF</h3>
          <div className="form-grid-2">
            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.pf_enabled}
                onChange={(e) => set("pf_enabled", e.target.checked)}
              />{" "}
              Enable company PF
            </label>
            <label className="field">
              <span>Minimum Basic (₹)</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={settings.minimum_basic}
                onChange={(e) => set("minimum_basic", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Basic percentage of monthly CTC</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                max="100"
                value={settings.basic_percentage}
                onChange={(e) =>
                  set("basic_percentage", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>Employee PF rate (%)</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                max="100"
                value={settings.employee_pf_rate}
                onChange={(e) =>
                  set("employee_pf_rate", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>Employer PF rate (%)</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                max="100"
                value={settings.employer_pf_rate}
                onChange={(e) =>
                  set("employer_pf_rate", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              <span>PF wage ceiling (₹)</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={settings.pf_wage_ceiling}
                onChange={(e) => set("pf_wage_ceiling", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Salary proration basis</span>
              <select
                className="pm-input"
                value={settings.proration_basis}
                onChange={(e) =>
                  set(
                    "proration_basis",
                    e.target.value as SettingsForm["proration_basis"],
                  )
                }
              >
                <option value="CALENDAR_DAYS">Calendar days</option>
                <option value="WORKING_DAYS">Working days</option>
              </select>
            </label>
          </div>
        </div>

        <div className="settings-block">
          <h3>Professional Tax</h3>
          <div className="form-grid-2">
            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.pt_enabled}
                onChange={(e) => set("pt_enabled", e.target.checked)}
              />{" "}
              Enable company PT
            </label>
            <label className="field">
              <span>State</span>
              <input
                className="pm-input"
                maxLength={100}
                value={settings.pt_state}
                onChange={(e) => set("pt_state", e.target.value)}
              />
            </label>
          </div>
          <div className="pt-head">
            <span>Monthly gross from (₹)</span>
            <span>Monthly gross to (₹)</span>
            <span>PT amount (₹)</span>
            <span />
          </div>
          {settings.pt_slabs.map((slab, index) => (
            <div className="pt-row" key={index}>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={slab.min}
                aria-label="PT slab minimum"
                onChange={(e) =>
                  updateSlab(index, { min: Number(e.target.value) })
                }
              />
              <input
                className="pm-input"
                type="number"
                min="0"
                value={slab.max ?? ""}
                placeholder="No limit"
                aria-label="PT slab maximum"
                onChange={(e) =>
                  updateSlab(index, {
                    max: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <input
                className="pm-input"
                type="number"
                min="0"
                value={slab.amount}
                aria-label="PT slab amount"
                onChange={(e) =>
                  updateSlab(index, { amount: Number(e.target.value) })
                }
              />
              <button
                className="icon-button"
                type="button"
                title="Remove PT slab"
                onClick={() =>
                  set(
                    "pt_slabs",
                    settings.pt_slabs.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            className="secondary"
            type="button"
            onClick={() =>
              set("pt_slabs", [
                ...settings.pt_slabs,
                { min: 0, max: null, amount: 0 },
              ])
            }
          >
            <Plus size={15} /> Add PT slab
          </button>
        </div>

        <div className="settings-block">
          <h3>Income tax regime</h3>
          <label className="field">
            <span>Company default tax regime</span>
            <select
              className="pm-input"
              value={settings.default_tax_regime}
              onChange={(e) =>
                set("default_tax_regime", e.target.value as TaxRegime)
              }
            >
              <option value="NEW">New regime</option>
              <option value="OLD">Old regime</option>
            </select>
          </label>
        </div>
      </section>

      <TaxSettings embedded regime={settings.default_tax_regime} />
    </>
  );
}
