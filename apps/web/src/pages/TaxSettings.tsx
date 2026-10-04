import { useEffect, useState } from "react";
import { ShieldCheck, Save, Calculator } from "lucide-react";
import { useCompany } from "../contexts/CompanyContext";
import { api } from "../lib/api";

type Regime = "NEW" | "OLD";
export default function TaxSettings({
  embedded = false,
  regime: companyRegime,
}: {
  embedded?: boolean;
  regime?: Regime;
} = {}) {
  const { current } = useCompany();
  const [fy, setFy] = useState("2026-27");
  const [regime, setRegime] = useState<Regime>(companyRegime ?? "NEW");
  const [settings, setSettings] = useState<any>(null);
  const [slabs, setSlabs] = useState<any[]>([]);
  const [rebate, setRebate] = useState<any>({
    income_limit: 0,
    maximum_rebate: 0,
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (companyRegime) setRegime(companyRegime);
  }, [companyRegime]);
  async function load() {
    if (!current) return;
    try {
      const d = await api<any>(
        `/tds/settings?company_id=${current.id}&financial_year=${fy}&regime=${regime}`,
      );
      setSettings(d.settings);
      setSlabs(d.settings.slabs ?? []);
      setRebate(d.settings.rebate ?? { income_limit: 0, maximum_rebate: 0 });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load tax settings");
    }
  }
  useEffect(() => {
    void load();
  }, [current?.id, fy, regime]);
  async function save() {
    if (!current || !settings) return;
    try {
      await api(`/tds/settings?company_id=${current.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...settings,
          financial_year: fy,
          regime,
          standard_deduction: Number(
            settings.standard_deduction ?? settings.standardDeduction,
          ),
          cess_rate: Number(settings.cess_rate ?? settings.cessRate),
          marginal_relief_enabled: Boolean(
            settings.marginal_relief_enabled ?? settings.marginalReliefEnabled,
          ),
          marginal_relief_income_limit: Number(
            settings.marginal_relief_income_limit ??
              settings.marginalReliefIncomeLimit,
          ),
          first_month_tds_method:
            settings.first_month_tds_method ?? settings.firstMonthTdsMethod,
          first_month_tds_paid_day_factor: Number(
            settings.first_month_tds_paid_day_factor ?? 1,
          ),
          rounding_method: "WHOLE_RUPEE",
          final_month_adjustment_enabled: true,
        }),
      });
      await api(`/tds/settings/slabs?company_id=${current.id}`, {
        method: "PUT",
        body: JSON.stringify({ financial_year: fy, regime, slabs, rebate }),
      });
      setSaved("Tax settings saved.");
      setTimeout(() => setSaved(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save settings");
    }
  }
  if (!settings)
    return (
      <div className="center-screen">{error || "Loading tax settings…"}</div>
    );
  return (
    <>
      {!embedded && (
        <div className="page-heading">
          <div>
            <div className="eyebrow">SETTINGS · TAX</div>
            <h1>Tax Settings</h1>
            <p>
              Configure financial-year-specific income tax and TDS withholding
              rules.
            </p>
          </div>
          <div className="heading-actions">
            <span className="date-pill">
              <ShieldCheck size={15} /> Admin controlled
            </span>
          </div>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert success">{saved}</div>}
      <section className="panel">
        <div className="info-box">
          Tax settings affect TDS withholding, not the Basic, Gross, or CTC
          salary split. Save these rules here, then recalculate TDS for affected
          employees. Existing locked payroll snapshots remain unchanged.
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
            <span>
              {embedded ? "Configure tax rules for regime" : "Tax Regime"}
            </span>
            <select
              className="pm-input"
              value={regime}
              onChange={(e) => setRegime(e.target.value as Regime)}
            >
              <option value="NEW">New Regime</option>
              <option value="OLD">Old Regime</option>
            </select>
          </label>
        </div>
        <div className="settings-block">
          <h3>General tax configuration</h3>
          <div className="form-grid-2">
            <label className="field">
              <span>Standard Deduction</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={settings.standard_deduction}
                onChange={(e) =>
                  setSettings((v: any) => ({
                    ...v,
                    standard_deduction: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Health & Education Cess (%)</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                max="100"
                value={settings.cess_rate}
                onChange={(e) =>
                  setSettings((v: any) => ({
                    ...v,
                    cess_rate: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.marginal_relief_enabled}
                onChange={(e) =>
                  setSettings((v: any) => ({
                    ...v,
                    marginal_relief_enabled: e.target.checked,
                  }))
                }
              />{" "}
              Marginal relief enabled
            </label>
            <label className="field">
              <span>Marginal Relief Income Limit</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={settings.marginal_relief_income_limit ?? ""}
                onChange={(e) =>
                  setSettings((v: any) => ({
                    ...v,
                    marginal_relief_income_limit: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>First Month TDS Method</span>
              <select
                className="pm-input"
                value={settings.first_month_tds_method}
                onChange={(e) =>
                  setSettings((v: any) => ({
                    ...v,
                    first_month_tds_method: e.target.value,
                  }))
                }
              >
                <option value="PRORATED_REDISTRIBUTE">
                  Prorated TDS + Redistribute Balance
                </option>
                <option value="FULL_MONTHLY">Full Monthly TDS</option>
              </select>
            </label>
            <label className="field">
              <span>First Month Paid-Day Factor</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={settings.first_month_tds_paid_day_factor ?? 1}
                onChange={(e) =>
                  setSettings((v: any) => ({
                    ...v,
                    first_month_tds_paid_day_factor: Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>
        </div>
        <div className="settings-block">
          <h3>Progressive tax slabs</h3>
          <div className="pt-head">
            <span>Lower limit</span>
            <span>Upper limit</span>
            <span>Rate %</span>
            <span />
          </div>
          {slabs.map((slab, i) => (
            <div className="pt-row" key={i}>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={slab.lower_limit ?? 0}
                onChange={(e) =>
                  setSlabs((v) =>
                    v.map((x, j) =>
                      j === i
                        ? { ...x, lower_limit: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
              <input
                className="pm-input"
                type="number"
                min="0"
                value={slab.upper_limit ?? ""}
                placeholder="No limit"
                onChange={(e) =>
                  setSlabs((v) =>
                    v.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            upper_limit:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          }
                        : x,
                    ),
                  )
                }
              />
              <input
                className="pm-input"
                type="number"
                min="0"
                max="100"
                value={slab.rate}
                onChange={(e) =>
                  setSlabs((v) =>
                    v.map((x, j) =>
                      j === i ? { ...x, rate: Number(e.target.value) } : x,
                    ),
                  )
                }
              />
              <button
                className="icon-button"
                onClick={() => setSlabs((v) => v.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              setSlabs((v) => [
                ...v,
                { lower_limit: 0, upper_limit: null, rate: 0 },
              ])
            }
          >
            Add slab
          </button>
        </div>
        <div className="settings-block">
          <h3>Section 87A rebate</h3>
          <div className="form-grid-2">
            <label className="field">
              <span>Income Limit</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={rebate.income_limit}
                onChange={(e) =>
                  setRebate((v: any) => ({
                    ...v,
                    income_limit: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Maximum Rebate</span>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={rebate.maximum_rebate}
                onChange={(e) =>
                  setRebate((v: any) => ({
                    ...v,
                    maximum_rebate: Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>
        </div>
        <div className="settings-block">
          <h3>Statutory values</h3>
          <p className="small-note">
            Tax slabs and rebate values are stored separately by financial year
            and regime. The supplied migration seeds configurable reference
            values; administrators should verify them against the applicable tax
            rules before relying on payroll withholding output.
          </p>
          <div className="info-box">
            <Calculator size={16} /> This module is a payroll
            estimation/withholding engine, not a tax-return filing system.
          </div>
        </div>
        <div className="drawer-actions">
          <button className="primary" onClick={() => void save()}>
            <Save size={16} /> Save settings
          </button>
        </div>
      </section>
    </>
  );
}
