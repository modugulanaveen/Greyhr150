import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDownToLine,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { api, apiBlob } from "../lib/api";
import { useCompany } from "../contexts/CompanyContext";
import type { Employee } from "@paymate/shared";

const schema = z.object({
  employee_id: z.string().trim().min(1, "Employee ID is required").max(50),
  first_name: z.string().trim().min(1, "First name is required"),
  last_name: z.string().trim().min(1, "Last name is required"),
  email: z
    .string()
    .email("Enter a valid email")
    .or(z.literal(""))
    .nullable()
    .optional(),
  mobile: z.string().max(30).nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  residential_address: z.string().max(1000).nullable().optional(),
  emergency_contact_name: z.string().max(150).nullable().optional(),
  emergency_contact_phone: z.string().max(30).nullable().optional(),
  date_of_joining: z.string().min(1, "Joining date is required"),
  department_name: z.string().trim().max(100).nullable().optional(),
  designation: z.string().max(120).nullable().optional(),
  employment_type: z.enum([
    "FULL_TIME",
    "PART_TIME",
    "CONTRACT",
    "INTERN",
    "CONSULTANT",
  ]),
  reporting_manager: z.string().max(150).nullable().optional(),
  employment_status: z.enum(["ACTIVE", "ON_NOTICE", "TERMINATED"]),
  last_working_date: z.string().nullable().optional(),
  work_location: z.string().max(150).nullable().optional(),
  annual_ctc: z.coerce.number().min(0).nullable().optional(),
  salary_effective_date: z.string().nullable().optional(),
  salary_payment_frequency: z.enum(["MONTHLY", "WEEKLY", "BIWEEKLY"]),
  pf_applicable: z.boolean(),
  pt_applicable: z.boolean(),
  tds_applicable: z.boolean(),
  bank_account_holder_name: z.string().max(150).nullable().optional(),
  bank_name: z.string().max(150).nullable().optional(),
  account_number: z.string().max(50).nullable().optional(),
  ifsc: z.string().max(20).nullable().optional(),
  pan: z.string().max(20).nullable().optional(),
  uan: z.string().max(30).nullable().optional(),
  pf_member_id: z.string().max(50).nullable().optional(),
  aadhaar_reference: z.string().max(100).nullable().optional(),
  previous_employer_name: z.string().max(200).nullable().optional(),
  previous_employer_taxable_salary: z.coerce
    .number()
    .min(0)
    .nullable()
    .optional(),
  previous_employer_tds: z.coerce.number().min(0).nullable().optional(),
  previous_employment_start_date: z.string().nullable().optional(),
  previous_employment_end_date: z.string().nullable().optional(),
});
type FormData = z.infer<typeof schema>;
function nullableField(value: string | null | undefined) {
  return value?.trim() || null;
}
function editableSensitiveValue(value: string | null | undefined) {
  // Employee detail responses mask sensitive values for users without access.
  // Do not place those masks in editable fields, where they could be saved.
  return value && !value.includes("•") && value !== "Not displayed" ? value : "";
}
function sensitiveFieldPlaceholder(saved: string | null | undefined) {
  if (saved?.includes("•")) return `Saved value: ${saved} · leave blank to keep`;
  return "Leave blank to keep saved value";
}
const empty: FormData = {
  employee_id: "",
  first_name: "",
  last_name: "",
  email: "",
  mobile: "",
  date_of_birth: "",
  gender: "",
  residential_address: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  date_of_joining: "",
  department_name: "",
  designation: "",
  employment_type: "FULL_TIME",
  reporting_manager: "",
  employment_status: "ACTIVE",
  last_working_date: "",
  work_location: "",
  annual_ctc: null,
  salary_effective_date: "",
  salary_payment_frequency: "MONTHLY",
  pf_applicable: true,
  pt_applicable: true,
  tds_applicable: true,
  bank_account_holder_name: "",
  bank_name: "",
  account_number: "",
  ifsc: "",
  pan: "",
  uan: "",
  pf_member_id: "",
  aadhaar_reference: "",
  previous_employer_name: "",
  previous_employer_taxable_salary: null,
  previous_employer_tds: null,
  previous_employment_start_date: "",
  previous_employment_end_date: "",
};
const tabs = [
  "Personal Details",
  "Employment",
  "Salary",
  "Bank & Statutory",
  "Previous Employer",
  "Documents",
];
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}
const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>((p, ref) => <input {...p} ref={ref} className="pm-input" />);
function EmployeeForm({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { current } = useCompany();
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [downloadingDocuments, setDownloadingDocuments] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: empty,
  });
  function showFirstInvalidField(fieldErrors: typeof errors) {
    const fieldsByTab: (keyof FormData)[][] = [
      [
        "employee_id",
        "first_name",
        "last_name",
        "email",
        "mobile",
        "date_of_birth",
        "gender",
        "residential_address",
        "emergency_contact_name",
        "emergency_contact_phone",
      ],
      [
        "date_of_joining",
        "department_name",
        "designation",
        "employment_type",
        "reporting_manager",
        "employment_status",
        "last_working_date",
        "work_location",
      ],
      ["annual_ctc", "salary_effective_date", "salary_payment_frequency"],
      [
        "bank_account_holder_name",
        "bank_name",
        "account_number",
        "ifsc",
        "pan",
        "uan",
        "pf_member_id",
        "aadhaar_reference",
      ],
      [
        "previous_employer_name",
        "previous_employer_taxable_salary",
        "previous_employer_tds",
        "previous_employment_start_date",
        "previous_employment_end_date",
      ],
      [],
    ];
    const invalidTab = fieldsByTab.findIndex((fields) =>
      fields.some((field) => fieldErrors[field]),
    );
    if (invalidTab >= 0) setTab(invalidTab);
  }
  useEffect(() => {
    if (employee) {
      const e: any = employee;
      reset({
        ...empty,
        ...e,
        employment_status:
          e.employment_status === "INACTIVE"
            ? "TERMINATED"
            : e.employment_status,
        annual_ctc: e.salary?.annual_ctc ?? null,
        salary_effective_date: e.salary?.effective_from ?? "",
        salary_payment_frequency: e.salary?.payment_frequency ?? "MONTHLY",
        pf_applicable: e.salary?.pf_applicable !== false,
        pt_applicable: e.salary?.pt_applicable !== false,
        tds_applicable: e.salary?.tds_applicable !== false,
        bank_account_holder_name: e.bank?.account_holder_name ?? "",
        bank_name: e.bank?.bank_name ?? "",
        account_number: editableSensitiveValue(e.bank?.account_number),
        ifsc: editableSensitiveValue(e.bank?.ifsc),
        pan: editableSensitiveValue(e.statutory?.pan),
        uan: editableSensitiveValue(e.statutory?.uan),
        pf_member_id: editableSensitiveValue(e.statutory?.pf_member_id),
        aadhaar_reference: editableSensitiveValue(e.statutory?.aadhaar_reference),
        previous_employer_name: e.previous_employment?.employer_name ?? "",
        previous_employer_taxable_salary:
          e.previous_employment?.taxable_salary ?? null,
        previous_employer_tds: e.previous_employment?.tds_deducted ?? null,
        previous_employment_start_date:
          e.previous_employment?.employment_start_date ?? "",
        previous_employment_end_date:
          e.previous_employment?.employment_end_date ?? "",
      });
      setDocuments(e.documents ?? []);
    } else reset(empty);
  }, [employee, reset]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [isDirty]);
  async function submit(data: FormData) {
    if (!current) return;
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        ...data,
        email: nullableField(data.email),
        department_name: nullableField(data.department_name),
        date_of_birth: nullableField(data.date_of_birth),
        last_working_date: nullableField(data.last_working_date),
        salary_effective_date: nullableField(data.salary_effective_date),
        previous_employment_start_date: nullableField(
          data.previous_employment_start_date,
        ),
        previous_employment_end_date: nullableField(
          data.previous_employment_end_date,
        ),
      };
      await api(
        `/employees${employee ? `/${employee.id}` : ""}?company_id=${current.id}`,
        {
          method: employee ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setMessage("Employee saved successfully.");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save employee");
    } finally {
      setBusy(false);
    }
  }
  async function upload(type: string, file: File) {
    if (!employee || !current) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("document_type", type);
      fd.append("file", file);
      const result = await api<{ document: any }>(
        `/employees/${employee.id}/documents?company_id=${current.id}`,
        { method: "POST", body: fd },
      );
      setDocuments((v) => [result.document, ...v]);
      setMessage("Document uploaded.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  async function downloadAllDocuments(employeeId: string) {
    if (!current) return;
    setDownloadingDocuments(true);
    try {
      const blob = await apiBlob(
        `/employees/${employeeId}/documents/download-all?company_id=${current.id}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${employee?.employee_id ?? "employee"}-documents.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to download documents");
    } finally {
      setDownloadingDocuments(false);
    }
  }
  const reg = (name: keyof FormData) => register(name);
  return (
    <div className="drawer-backdrop">
      <div className="employee-drawer">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">EMPLOYEE MANAGEMENT</div>
            <h2>{employee ? "Edit employee" : "Add employee"}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="tab-strip">
          {tabs.map((t, i) => (
            <button
              key={t}
              className={tab === i ? "tab active" : "tab"}
              onClick={() => setTab(i)}
            >
              {i + 1}. {t}
            </button>
          ))}
        </div>
        <form
          onSubmit={handleSubmit(submit, showFirstInvalidField)}
          className="employee-form"
        >
          {tab === 0 && (
            <div className="form-grid-2">
              <Field label="Employee ID" error={errors.employee_id?.message}>
                <Input {...reg("employee_id")} placeholder="EMP-001" />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <Input type="email" {...reg("email")} />
              </Field>
              <Field label="First name" error={errors.first_name?.message}>
                <Input {...reg("first_name")} />
              </Field>
              <Field label="Last name" error={errors.last_name?.message}>
                <Input {...reg("last_name")} />
              </Field>
              <Field label="Mobile">
                <Input {...reg("mobile")} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" {...reg("date_of_birth")} />
              </Field>
              <Field label="Gender">
                <select {...reg("gender")} className="pm-input">
                  <option value="">Select</option>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                  <option>Prefer not to say</option>
                </select>
              </Field>
              <Field label="Emergency contact name">
                <Input {...reg("emergency_contact_name")} />
              </Field>
              <Field label="Emergency contact phone">
                <Input {...reg("emergency_contact_phone")} />
              </Field>
              <Field label="Residential address">
                <textarea
                  {...reg("residential_address")}
                  className="pm-input pm-textarea"
                />
              </Field>
            </div>
          )}
          {tab === 1 && (
            <div className="form-grid-2">
              <Field
                label="Date of joining"
                error={errors.date_of_joining?.message}
              >
                <Input type="date" {...reg("date_of_joining")} />
              </Field>
              <Field label="Department" error={errors.department_name?.message}>
                <Input {...reg("department_name")} placeholder="e.g. Finance" />
              </Field>
              <Field label="Designation">
                <Input {...reg("designation")} />
              </Field>
              <Field label="Employment type">
                <select {...reg("employment_type")} className="pm-input">
                  <option value="FULL_TIME">Full time</option>
                  <option value="PART_TIME">Part time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERN">Intern</option>
                  <option value="CONSULTANT">Consultant</option>
                </select>
              </Field>
              <Field label="Reporting manager">
                <Input {...reg("reporting_manager")} />
              </Field>
              <Field label="Employment status">
                <select {...reg("employment_status")} className="pm-input">
                  <option value="ACTIVE">Active</option>
                  <option value="ON_NOTICE">On notice</option>
                  <option value="TERMINATED">Resigned</option>
                </select>
              </Field>
              <Field label="Last working date">
                <Input type="date" {...reg("last_working_date")} />
              </Field>
              <Field label="Work location">
                <Input {...reg("work_location")} />
              </Field>
            </div>
          )}
          {tab === 2 && (
            <div className="form-grid-2">
              <Field label="Annual CTC">
                <Input type="number" step="0.01" {...reg("annual_ctc")} />
              </Field>
              <Field label="Salary effective date">
                <Input type="date" {...reg("salary_effective_date")} />
              </Field>
              <Field label="Payment frequency">
                <select
                  {...reg("salary_payment_frequency")}
                  className="pm-input"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Bi-weekly</option>
                </select>
              </Field>
              <label className="check-field">
                <input type="checkbox" {...reg("pf_applicable")} />
                PF applies to this employee
              </label>
              <label className="check-field">
                <input type="checkbox" {...reg("pt_applicable")} />
                PT applies to this employee
              </label>
              <label className="check-field">
                <input type="checkbox" {...reg("tds_applicable")} />
                Deduct TDS for this employee
              </label>
              <div className="info-box">
                Phase 2 stores effective-dated salary assignments only. Salary
                calculation is intentionally reserved for Phase 3.
              </div>
            </div>
          )}
          {tab === 3 && (
            <div className="form-grid-2">
              <Field label="Bank account holder name">
                <Input {...reg("bank_account_holder_name")} />
              </Field>
              <Field label="Bank name">
                <Input {...reg("bank_name")} />
              </Field>
              <Field label="Account number">
                <Input
                  type="text"
                  autoComplete="off"
                  {...reg("account_number")}
                  placeholder={
                    employee ? sensitiveFieldPlaceholder((employee as any).bank?.account_number) : ""
                  }
                />
              </Field>
              <Field label="IFSC">
                <Input
                  type="text"
                  autoComplete="off"
                  {...reg("ifsc")}
                  placeholder={
                    employee ? sensitiveFieldPlaceholder((employee as any).bank?.ifsc) : ""
                  }
                />
              </Field>
              <Field label="PAN">
                <Input
                  type="text"
                  autoComplete="off"
                  {...reg("pan")}
                  placeholder={
                    employee ? sensitiveFieldPlaceholder((employee as any).statutory?.pan) : ""
                  }
                />
              </Field>
              <Field label="UAN">
                <Input
                  type="text"
                  autoComplete="off"
                  {...reg("uan")}
                  placeholder={
                    employee ? sensitiveFieldPlaceholder((employee as any).statutory?.uan) : ""
                  }
                />
              </Field>
              <Field label="PF member ID">
                <Input
                  type="text"
                  autoComplete="off"
                  {...reg("pf_member_id")}
                  placeholder={
                    employee ? sensitiveFieldPlaceholder((employee as any).statutory?.pf_member_id) : ""
                  }
                />
              </Field>
              <Field label="Aadhaar reference">
                <Input
                  type="text"
                  autoComplete="off"
                  {...reg("aadhaar_reference")}
                  placeholder={
                    employee
                      ? sensitiveFieldPlaceholder((employee as any).statutory?.aadhaar_reference)
                      : "Reference/token only; not full Aadhaar"
                  }
                />
              </Field>
              <div className="info-box">
                Sensitive statutory and bank values are masked for ACCOUNTANT
                users and are not returned to them in full.
              </div>
            </div>
          )}
          {tab === 4 && (
            <div className="form-grid-2">
              <Field label="Previous employer name">
                <Input {...reg("previous_employer_name")} />
              </Field>
              <Field label="Previous Employer Taxable Salary">
                <Input
                  type="number"
                  step="0.01"
                  {...reg("previous_employer_taxable_salary")}
                />
              </Field>
              <Field label="Previous employer TDS already deducted">
                <Input
                  type="number"
                  step="0.01"
                  {...reg("previous_employer_tds")}
                />
              </Field>
              <Field label="Previous employment start">
                <Input type="date" {...reg("previous_employment_start_date")} />
              </Field>
              <Field label="Previous employment end">
                <Input type="date" {...reg("previous_employment_end_date")} />
              </Field>
              <div className="info-box full-span">
                <strong>Tax note:</strong> This is taxable salary for the
                selected financial year, not gross salary. Future TDS
                calculations must not apply the standard deduction twice.
              </div>
              <DocumentUpload
                disabled={!employee}
                uploading={uploading}
                onUpload={upload}
                label="Form 12B / supporting document"
              />
            </div>
          )}
          {tab === 5 && (
            <div>
              <div className="doc-grid">
                <DocumentUpload
                  disabled={!employee}
                  uploading={uploading}
                  onUpload={upload}
                  label="Offer letter"
                  type="OFFER_LETTER"
                />
                <DocumentUpload
                  disabled={!employee}
                  uploading={uploading}
                  onUpload={upload}
                  label="PAN document"
                  type="PAN_DOCUMENT"
                />
                <DocumentUpload
                  disabled={!employee}
                  uploading={uploading}
                  onUpload={upload}
                  label="Bank proof"
                  type="BANK_PROOF"
                />
                <DocumentUpload
                  disabled={!employee}
                  uploading={uploading}
                  onUpload={upload}
                  label="Form 16"
                  type="FORM_16"
                />
                <DocumentUpload
                  disabled={!employee}
                  uploading={uploading}
                  onUpload={upload}
                  label="Form 12B"
                  type="FORM_12B"
                />
                <DocumentUpload
                  disabled={!employee}
                  uploading={uploading}
                  onUpload={upload}
                  label="Other authorized document"
                  type="OTHER"
                />
              </div>
              {!employee && (
                <div className="info-box">
                  Save the employee first, then upload private documents.
                </div>
              )}
              <div className="uploaded-list">
                {documents.length > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={!employee || downloadingDocuments}
                    onClick={() => employee && void downloadAllDocuments(employee.id)}
                  >
                    <ArrowDownToLine size={16} />
                    {downloadingDocuments ? "Preparing download…" : "Download all documents"}
                  </button>
                )}
                {documents.map((d) => (
                  <div className="uploaded-item" key={d.id}>
                    <FileText size={18} />
                    <span>{d.original_name}</span>
                    <small>{Math.round(d.file_size / 1024)} KB</small>
                  </div>
                ))}
              </div>
            </div>
          )}
          {message && (
            <div
              className={
                message.includes("success") || message.includes("uploaded")
                  ? "alert success"
                  : "alert error"
              }
            >
              {message}
            </div>
          )}
          <div className="drawer-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            {tab > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setTab((v) => v - 1)}
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
            {tab < tabs.length - 1 ? (
              <button
                type="button"
                className="primary"
                onClick={() => setTab((v) => v + 1)}
              >
                Next <ChevronRight size={16} />
              </button>
            ) : (
              <button className="primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : employee
                    ? "Save changes"
                    : "Create employee"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
function DocumentUpload({
  label,
  type = "FORM_12B",
  disabled,
  uploading,
  onUpload,
}: {
  label: string;
  type?: string;
  disabled: boolean;
  uploading: boolean;
  onUpload: (type: string, file: File) => void;
}) {
  return (
    <div className="upload-card">
      <FileText size={20} />
      <strong>{label}</strong>
      <small>PDF, JPG, PNG, DOCX · max 5 MB</small>
      <label className="upload-button">
        {disabled
          ? "Save employee first"
          : uploading
            ? "Uploading…"
            : "Choose file"}
        <input
          type="file"
          hidden
          disabled={disabled || uploading}
          accept=".pdf,.jpg,.jpeg,.png,.docx"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(type, f);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}
export default function Employees() {
  const { current } = useCompany();
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    active: 0,
    onNotice: 0,
    separated: 0,
  });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Employee | null | false>(false);
  const [selected, setSelected] = useState<any>(null);
  const [attendanceHistory, setAttendanceHistory] = useState<any>(null);
  const [confirm, setConfirm] = useState<any>(null);
  const [confirmError, setConfirmError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [sort, setSort] = useState("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  async function load() {
    if (!current) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        company_id: current.id,
        page: String(page),
        limit: "10",
        search,
        status,
        department_id: department,
        sort,
        dir,
      });
      const d = await api<any>(`/employees?${q}`);
      setRows(d.employees);
      setSummary(d.summary);
      setPages(d.pagination.total_pages || 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load employees");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (current) {
      api<any>(`/employees/departments?company_id=${current.id}`)
        .then((d) => setDepartments(d.departments ?? []))
        .catch(() => setDepartments([]));
    }
    void load();
  }, [current?.id, page, status, department, sort, dir]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void load();
    }, 350);
    return () => clearTimeout(t);
  }, [search, current?.id]);
  async function view(id: string) {
    if (!current) return null;
    try {
      const d = await api<any>(`/employees/${id}?company_id=${current.id}`);
      setSelected(d.employee);
      return d.employee;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load employee");
      return null;
    }
  }
  async function edit(id: string) {
    if (!current) return;
    try {
      const d = await api<any>(`/employees/${id}?company_id=${current.id}`);
      setSelected(null);
      setEditing(d.employee);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load employee");
    }
  }
  async function deleteEmployee() {
    if (!current || !confirm) return;
    setDeleting(true);
    setConfirmError("");
    try {
      const result = await api<{ file_cleanup_pending?: boolean }>(
        `/employees/${confirm.id}?company_id=${current.id}`,
        {
          method: "DELETE",
        },
      );
      setConfirm(null);
      await load();
      if (result.file_cleanup_pending)
        setError(
          "Employee deleted, but some stored files could not be removed. Contact your administrator.",
        );
    } catch (e) {
      setConfirmError(
        e instanceof Error ? e.message : "Unable to delete employee",
      );
    } finally {
      setDeleting(false);
    }
  }
  async function changeStatus(employeeId: string, employmentStatus: string) {
    if (!current) return;
    setUpdatingStatusId(employeeId);
    try {
      await api(`/employees/${employeeId}/status?company_id=${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ employment_status: employmentStatus }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update status");
    } finally {
      setUpdatingStatusId(null);
    }
  }
  async function downloadDocument(employeeId: string, documentId: string) {
    if (!current) return;
    try {
      const d = await api<any>(
        `/employees/${employeeId}/documents/${documentId}/download?company_id=${current.id}`,
      );
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download document");
    }
  }
  async function loadAttendanceHistory(employeeId: string) {
    if (!current) return;
    try {
      setAttendanceHistory(
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
  async function exportXlsx() {
    if (!current) return;
    try {
      const blob = await apiBlob(`/employees/export?company_id=${current.id}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "paymate-employees.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }
  const canManageEmployees = ["OWNER", "COMPANY_ADMIN", "HR"].includes(
    current?.role ?? "",
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PEOPLE</div>
          <h1>Employees</h1>
          <p>
            Manage employee records, statutory details and authorized documents
            for {current?.name}.
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={exportXlsx}>
            <ArrowDownToLine size={16} /> Export Excel
          </button>
          <button className="primary" onClick={() => setEditing(null)}>
            <Plus size={17} /> Add employee
          </button>
        </div>
      </div>
      <div className="stat-grid employee-stats">
        <div className="stat-card">
          <div className="stat-icon blue">
            <Clock3 size={20} />
          </div>
          <span>On notice</span>
          <strong>{summary.onNotice}</strong>
          <small>Serving notice period</small>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <UserCheck size={20} />
          </div>
          <span>Active</span>
          <strong>{summary.active}</strong>
          <small>Currently active</small>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">
            <UserX size={20} />
          </div>
          <span>Resigned / terminated</span>
          <strong>{summary.separated}</strong>
          <small>Former employees</small>
        </div>
      </div>
      <section className="panel employee-panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, employee ID, department or designation…"
            />
          </div>
          <select
            className="filter-select"
            value={department}
            onChange={(e) => {
              setPage(1);
              setDepartment(e.target.value);
            }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_NOTICE">On notice</option>
            <option value="TERMINATED">Resigned</option>
          </select>
          <select
            className="filter-select"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="created_at">Newest</option>
            <option value="employee_id">Employee ID</option>
            <option value="first_name">Name</option>
            <option value="date_of_joining">Joining date</option>
          </select>
          <button
            className="sort-btn"
            onClick={() => setDir((v) => (v === "asc" ? "desc" : "asc"))}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </div>
        {error && <div className="alert error">{error}</div>}
        {loading ? (
          <div className="empty-state">Loading employees…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <UserCheck size={35} />
            <h3>No employees found</h3>
            <p>
              {search || status || department
                ? "Try clearing your filters."
                : "Add your first employee to start building the workforce."}
            </p>
            {!search && !status && !department && (
              <button className="primary" onClick={() => setEditing(null)}>
                <Plus size={16} /> Add employee
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Joining</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong>
                          {e.first_name} {e.last_name}
                        </strong>
                        <small>{e.employee_id}</small>
                      </td>
                      <td>{e.department_name || "—"}</td>
                      <td>{e.designation || "—"}</td>
                      <td>{e.date_of_joining}</td>
                      <td>
                        {canManageEmployees ? (
                          <select
                            className="filter-select"
                            aria-label={`Employment status for ${e.first_name} ${e.last_name}`}
                            value={
                              e.employment_status === "INACTIVE"
                                ? "TERMINATED"
                                : e.employment_status
                            }
                            disabled={updatingStatusId === e.id}
                            onChange={(event) =>
                              void changeStatus(e.id, event.target.value)
                            }
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="ON_NOTICE">On Notice</option>
                            <option value="TERMINATED">Resigned</option>
                          </select>
                        ) : (
                          <span
                            className={`status-badge ${String(e.employment_status).toLowerCase()}`}
                          >
                            {e.employment_status === "TERMINATED" ||
                            e.employment_status === "INACTIVE"
                              ? "Resigned"
                              : e.employment_status === "ON_NOTICE"
                                ? "On Notice"
                                : "Active"}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button title="View" onClick={() => void view(e.id)}>
                            <Eye size={16} />
                          </button>
                          {canManageEmployees && (
                            <>
                              <button
                                title="Edit"
                                onClick={() => void edit(e.id)}
                              >
                                Edit
                              </button>
                              <button
                                title="Delete"
                                aria-label={`Delete ${e.first_name} ${e.last_name}`}
                                onClick={() => {
                                  setConfirmError("");
                                  setConfirm(e);
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Page {page} of {pages}
              </span>
              <div>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  disabled={page >= pages}
                  onClick={() => setPage((v) => v + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {selected && (
        <div className="modal-backdrop">
          <div className="detail-modal">
            <div className="drawer-head">
              <div>
                <div className="eyebrow">EMPLOYEE RECORD</div>
                <h2>
                  {selected.first_name} {selected.last_name}
                </h2>
              </div>
              <button className="icon-button" onClick={() => setSelected(null)}>
                <X />
              </button>
            </div>
            <div className="detail-grid">
              <div>
                <small>Employee ID</small>
                <strong>{selected.employee_id}</strong>
              </div>
              <div>
                <small>Status</small>
                <strong>{selected.employment_status}</strong>
              </div>
              <div>
                <small>Email</small>
                <strong>{selected.email || "—"}</strong>
              </div>
              <div>
                <small>Mobile</small>
                <strong>{selected.mobile || "—"}</strong>
              </div>
              <div>
                <small>Department</small>
                <strong>{selected.department_name || "—"}</strong>
              </div>
              <div>
                <small>Designation</small>
                <strong>{selected.designation || "—"}</strong>
              </div>
              <div>
                <small>Bank</small>
                <strong>
                  {selected.bank?.bank_name || "—"}{" "}
                  {selected.bank?.account_number
                    ? `••••${String(selected.bank.account_number).slice(-4)}`
                    : ""}
                </strong>
              </div>
              <div>
                <small>PAN</small>
                <strong>
                  {selected.statutory?.pan
                    ? `••••${String(selected.statutory.pan).slice(-4)}`
                    : "—"}
                </strong>
              </div>
            </div>
            <div className="detail-docs">
              <h3>Salary</h3>
              {selected.salary ? (
                <div className="detail-grid">
                  <div>
                    <small>Current CTC</small>
                    <strong>
                      ₹
                      {Math.round(
                        Number(selected.salary.annual_ctc) || 0,
                      ).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div>
                    <small>Basic</small>
                    <strong>
                      ₹
                      {Math.round(
                        Number(selected.salary.basic_salary) || 0,
                      ).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div>
                    <small>Special Allowance</small>
                    <strong>
                      ₹
                      {Math.round(
                        Number(selected.salary.special_allowance) || 0,
                      ).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div>
                    <small>Gross Salary</small>
                    <strong>
                      ₹
                      {Math.round(
                        Number(selected.salary.gross_salary) || 0,
                      ).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div>
                    <small>Employee PF</small>
                    <strong>
                      ₹
                      {Math.round(
                        Number(selected.salary.employee_pf) || 0,
                      ).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div>
                    <small>Employer PF</small>
                    <strong>
                      ₹
                      {Math.round(
                        Number(selected.salary.employer_pf) || 0,
                      ).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div>
                    <small>PT</small>
                    <strong>
                      ₹
                      {Math.round(
                        Number(selected.salary.professional_tax) || 0,
                      ).toLocaleString("en-IN")}
                    </strong>
                  </div>
                  <div>
                    <small>Effective From</small>
                    <strong>{selected.salary.effective_from}</strong>
                  </div>
                </div>
              ) : (
                <p className="muted">
                  Set the employee’s annual CTC in their profile. Payroll uses
                  it with your saved salary and tax settings.
                </p>
              )}
              <div className="drawer-actions">
                <button
                  className="secondary"
                  onClick={() => void loadAttendanceHistory(selected.id)}
                >
                  <CalendarDays size={15} /> Attendance History
                </button>
              </div>
              <h3>Documents</h3>
              {selected.documents?.length ? (
                selected.documents.map((d: any) => (
                  <div className="uploaded-item" key={d.id}>
                    <FileText size={17} />
                    {d.original_name}
                    <small>{d.document_type}</small>
                    <button
                      className="secondary"
                      onClick={() => void downloadDocument(selected.id, d.id)}
                    >
                      Download
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">No documents uploaded.</p>
              )}
            </div>
            <div className="drawer-actions">
              <button className="secondary" onClick={() => setSelected(null)}>
                Close
              </button>
              <button
                className="primary"
                onClick={() => {
                  setEditing(selected);
                  setSelected(null);
                }}
              >
                Edit employee
              </button>
            </div>
          </div>
        </div>
      )}
      {attendanceHistory && (
        <div className="modal-backdrop">
          <div className="detail-modal">
            <div className="drawer-head">
              <div>
                <div className="eyebrow">ATTENDANCE HISTORY</div>
                <h2>
                  {attendanceHistory.employee.first_name}{" "}
                  {attendanceHistory.employee.last_name}
                </h2>
                <p>{attendanceHistory.employee.employee_id}</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setAttendanceHistory(null)}
              >
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
                    <th>Paid Days</th>
                    <th>LOP Deduction</th>
                    <th>Adjusted Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceHistory.history.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        {r.payroll_year}-
                        {String(r.payroll_month).padStart(2, "0")}
                      </td>
                      <td>{r.working_days}</td>
                      <td>{r.present_days}</td>
                      <td>{r.paid_leave_days}</td>
                      <td>{r.lop_days}</td>
                      <td>{r.paid_days}</td>
                      <td>
                        ₹
                        {Math.round(
                          Number(r.lop_deduction) || 0,
                        ).toLocaleString("en-IN")}
                      </td>
                      <td>
                        ₹
                        {Math.round(
                          Number(r.adjusted_gross) || 0,
                        ).toLocaleString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {editing !== false && (
        <EmployeeForm
          employee={editing || null}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            await load();
            setEditing(false);
          }}
        />
      )}
      {confirm && (
        <div className="modal-backdrop">
          <div className="confirm-modal">
            <div className="stat-icon red">
              <UserX />
            </div>
            <h2>Delete employee?</h2>
            <p>
              This permanently deletes the employee and all linked salary,
              attendance, tax, payroll, payslip, document, and personal records
              for{" "}
              <strong>
                {confirm.first_name} {confirm.last_name}
              </strong>
              . This cannot be undone.
            </p>
            <div className="drawer-actions">
              <button className="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="danger"
                disabled={deleting}
                onClick={() => void deleteEmployee()}
              >
                {deleting ? "Deleting…" : "Delete employee"}
              </button>
            </div>
            {confirmError && <div className="alert error">{confirmError}</div>}
          </div>
        </div>
      )}
    </>
  );
}
