import {
  Building2,
  CreditCard,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  UserCog,
  Activity,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useCompany } from "../contexts/CompanyContext";
const items = [
  {
    to: "/settings/company",
    icon: Building2,
    title: "Company",
    text: "Legal identity, contact details, address and logo.",
    adminOnly: true,
  },
  {
    to: "/settings/users",
    icon: UserCog,
    title: "Users",
    text: "Invite, deactivate, reactivate and change roles.",
    adminOnly: true,
  },
  {
    to: "/settings/roles",
    icon: ShieldCheck,
    title: "Roles & Permissions",
    text: "Review the permissions available to existing roles.",
    adminOnly: true,
  },
  {
    to: "/settings/payroll",
    icon: WalletCards,
    title: "Salary & Tax Settings",
    text: "Configure company-wide salary, PF, PT and income tax rules.",
    adminOnly: true,
  },
  {
    to: "/payslips/settings",
    icon: ScrollText,
    title: "Payslip Settings",
    text: "Existing payslip branding and sensitive-field display.",
    adminOnly: true,
  },
  {
    to: "/settings/security",
    icon: LockKeyhole,
    title: "Security",
    text: "Account security, password and session controls.",
  },
  {
    to: "/settings/subscription",
    icon: CreditCard,
    title: "Subscription",
    text: "Subscription-ready plan and usage information; no payment gateway.",
    adminOnly: true,
  },
  {
    to: "/settings/system-health",
    icon: Activity,
    title: "System Health",
    text: "Application, database, storage and authentication health.",
    adminOnly: true,
  },
];
export default function Settings() {
  const { current } = useCompany();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Settings</h1>
          <p>
            {current?.name || "Company"} · production configuration and
            administration.
          </p>
        </div>
      </div>
      <div className="settings-card-grid">
        {items
          .filter(
            (x) =>
              !x.adminOnly ||
              current?.role === "OWNER" ||
              current?.role === "COMPANY_ADMIN",
          )
          .map(({ to, icon: Icon, title, text }) => (
            <Link key={to} to={to} className="settings-card">
              <div className="stat-icon purple">
                <Icon size={20} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <span>Open settings →</span>
            </Link>
          ))}
      </div>
    </>
  );
}
