import { useEffect, useState } from "react";
import { ArrowLeft, Download, Printer, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";
const money = (v: number) =>
  `₹${Math.round(Number(v) || 0).toLocaleString("en-IN")}`;
const dateLabel = (value?: string | null) =>
  value
    ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
export default function PayslipDetail() {
  const { payslipId } = useParams();
  const { current } = useCompany();
  const [d, setD] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const load = async () => {
    if (!current || !payslipId) return;
    setLoading(true);
    try {
      setD(await api<any>(`/payslips/${payslipId}?company_id=${current.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load payslip");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [current?.id, payslipId]);
  async function download() {
    if (!current || !payslipId) return;
    try {
      const x = await api<any>(
        `/payslips/${payslipId}/download?company_id=${current.id}`,
      );
      window.open(x.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }
  async function regenerate() {
    if (!current || !payslipId) return;
    setBusy(true);
    try {
      await api(`/payslips/${payslipId}/generate?company_id=${current.id}`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="center-screen">Loading payslip…</div>;
  if (!d)
    return <div className="center-screen">{error || "Payslip not found"}</div>;
  const r = d.payslip.snapshot?.payroll_record || d.payslip.payroll_records,
    e = d.employee,
    b = d.bank,
    s = d.statutory,
    c = d.branding;
  const adjustmentRows = Array.isArray(d.payslip.snapshot?.adjustments)
    ? d.payslip.snapshot.adjustments
    : [];
  const adjustmentDirection = (item: any) =>
    item.component_type ??
    (item.adjustment_type === "OTHER_DEDUCTION" ? "DEDUCTION" : "EARNING");
  const adjustmentName = (item: any) =>
    item.component_name ||
    String(item.adjustment_type || "Adjustment").replaceAll("_", " ");
  const earnings = adjustmentRows.filter(
    (item: any) => adjustmentDirection(item) === "EARNING",
  );
  const customDeductions = adjustmentRows.filter(
    (item: any) => adjustmentDirection(item) === "DEDUCTION",
  );
  return (
    <>
      <div className="page-heading payslip-page-heading">
        <div>
          <Link className="back-link" to="/payslips">
            <ArrowLeft size={16} /> Back to Payslips
          </Link>
          <div className="eyebrow">SALARY PAYSLIP</div>
          <h1>
            {e.first_name} {e.last_name}
          </h1>
          <p>
            {e.employee_id} ·{" "}
            {new Date(2000, d.payslip.pay_period_month - 1, 1).toLocaleString(
              "en-IN",
              { month: "long" },
            )}{" "}
            {d.payslip.pay_period_year}
          </p>
        </div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
          <button
            className="secondary"
            onClick={() => void regenerate()}
            disabled={busy}
          >
            <RefreshCw size={15} /> Regenerate
          </button>
          <button className="primary" onClick={() => void download()}>
            <Download size={15} /> Download PDF
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="payslip-screen">
      <section className="payslip-paper">
        <div className="payslip-header">
          <div className="payslip-company">
            <span className="payslip-brand-mark">PM</span>
            <div>
              <h2>{c.company_name || "PayMate Company"}</h2>
              <p>{c.company_address || ""}</p>
              <p className="payslip-contact">
                {[c.company_phone, c.company_email, c.company_website]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <div className="payslip-title">
            <small>PAYROLL STATEMENT</small>
            <strong>Salary payslip</strong>
            <span>
              {new Date(2000, d.payslip.pay_period_month - 1, 1).toLocaleString(
                "en-IN",
                { month: "long", year: "numeric" },
              )}
            </span>
          </div>
        </div>
        <div className="payslip-info-grid">
          <div className="payslip-info-item">
            <small>Employee ID</small>
            <strong>{e.employee_id}</strong>
          </div>
          <div className="payslip-info-item">
            <small>Employee Name</small>
            <strong>
              {e.first_name} {e.last_name}
            </strong>
          </div>
          <div className="payslip-info-item">
            <small>Designation</small>
            <strong>{e.designation || "—"}</strong>
          </div>
          <div className="payslip-info-item">
            <small>Department</small>
            <strong>{e.department_name || e.department || "—"}</strong>
          </div>
          <div className="payslip-info-item">
            <small>Date of Joining</small>
            <strong>{dateLabel(e.date_of_joining)}</strong>
          </div>
          <div className="payslip-info-item">
            <small>Paid Days</small>
            <strong>{r.paid_days ?? "—"}</strong>
          </div>
          <div className="payslip-info-item">
            <small>LOP Days</small>
            <strong>{r.lop_days ?? "—"}</strong>
          </div>
          <div className="payslip-info-item">
            <small>PAN</small>
            <strong>
              {c.show_pan
                ? c.mask_pan && s?.pan
                  ? `${s.pan.slice(0, 5)}****${s.pan.slice(-1)}`
                  : s?.pan || "—"
                : "—"}
            </strong>
          </div>
          <div className="payslip-info-item">
            <small>UAN</small>
            <strong>{c.show_uan ? s?.uan || "—" : "—"}</strong>
          </div>
          <div className="payslip-info-item">
            <small>Bank Account</small>
            <strong>
              {c.show_bank_account
                ? c.mask_bank_account && b?.account_number
                  ? `XXXX XXXX ${String(b.account_number).slice(-4)}`
                  : b?.account_number || "—"
                : "—"}
            </strong>
          </div>
        </div>
        <div className="payslip-columns">
          <section className="payslip-ledger">
            <div className="payslip-ledger-heading">
              <h3>Earnings</h3>
              <span>INR</span>
            </div>
            <div className="salary-lines">
              <div>
                <span>Basic Salary</span>
                <strong>{money(r.basic_salary)}</strong>
              </div>
              <div>
                <span>Special Allowance</span>
                <strong>{money(r.special_allowance)}</strong>
              </div>
              {earnings.length ? earnings.map((item: any) => (
                <div key={item.id}>
                  <span>{adjustmentName(item)}</span>
                  <strong>{money(item.amount)}</strong>
                </div>
              )) : Number(r.adjustment_earnings) > 0 && (
                <div>
                  <span>Other Earnings</span>
                  <strong>{money(r.adjustment_earnings)}</strong>
                </div>
              )}
              <div className="line-total">
                <span>Total Earnings</span>
                <strong>{money(r.adjusted_gross)}</strong>
              </div>
            </div>
          </section>
          <section className="payslip-ledger">
            <div className="payslip-ledger-heading">
              <h3>Deductions</h3>
              <span>INR</span>
            </div>
            <div className="salary-lines">
              <div>
                <span>Employee PF</span>
                <strong>{money(r.employee_pf)}</strong>
              </div>
              <div>
                <span>Professional Tax</span>
                <strong>{money(r.professional_tax)}</strong>
              </div>
              <div>
                <span>TDS</span>
                <strong>{money(r.tds)}</strong>
              </div>
              {Number(r.other_deductions) > 0 && (
                <div>
                  <span>Other Deductions</span>
                  <strong>{money(Number(r.other_deductions))}</strong>
                </div>
              )}
              {customDeductions.length ? customDeductions.map((item: any) => (
                <div key={item.id}>
                  <span>{adjustmentName(item)}</span>
                  <strong>{money(item.amount)}</strong>
                </div>
              )) : Number(r.adjustment_deductions) > 0 && (
                <div>
                  <span>Other Adjustments</span>
                  <strong>{money(r.adjustment_deductions)}</strong>
                </div>
              )}
              <div className="line-total">
                <span>Total Deductions</span>
                <strong>{money(r.total_deductions)}</strong>
              </div>
            </div>
          </section>
        </div>
        <section className="payslip-net">
          <div>
            <span>Gross Pay</span>
            <strong>{money(r.adjusted_gross)}</strong>
          </div>
          <div>
            <span>Total Deductions</span>
            <strong>{money(r.total_deductions)}</strong>
          </div>
          <div className="net">
            <span>Net Pay</span>
            <strong>{money(r.net_salary)}</strong>
          </div>
        </section>
        <section className="payslip-employer">
          <h3>Employer contributions</h3>
          <div className="salary-lines">
            <div>
              <span>Employer PF</span>
              <strong>{money(r.employer_pf)}</strong>
            </div>
            <div className="line-total">
              <span>Total Employer Cost</span>
              <strong>{money(r.employer_cost)}</strong>
            </div>
          </div>
        </section>
        <div className="payslip-footer">
          <span>
            {c.payslip_footer || "This is a computer-generated payslip."}
          </span>
          <span>
            Generated{" "}
            {d.payslip.generated_at
              ? new Date(d.payslip.generated_at).toLocaleString("en-IN")
              : "—"}{" "}
            · Version {d.payslip.version}
          </span>
        </div>
      </section>
      </div>
    </>
  );
}
