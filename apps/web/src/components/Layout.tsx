import { useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  CreditCard,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LogOut,
  ListChecks,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
  WalletCards,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
const nav = [
  {
    path: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    enabled: true,
  },
  { path: "/employees", label: "Employees", icon: Users, enabled: true },
  {
    path: "/settings/payroll",
    label: "Salary & Tax Settings",
    icon: WalletCards,
    enabled: true,
  },
  {
    path: "/attendance",
    label: "Attendance & LOP",
    icon: CalendarDays,
    enabled: true,
  },
  { path: "/payroll", label: "Payroll runs", icon: CreditCard, enabled: true },
  { path: "/payroll/components", label: "Payroll components", icon: ListChecks, enabled: true },
  { path: "/payslips", label: "Payslips", icon: FileText, enabled: true },
  {
    path: "/compliance",
    label: "Statutory Compliance",
    icon: FileCheck2,
    enabled: true,
  },
  {
    path: "/reports",
    label: "Reports & Analytics",
    icon: BarChart3,
    enabled: true,
  },
  {
    path: "/settings",
    label: "Company settings",
    icon: Settings,
    enabled: true,
  },
];
export default function Layout() {
  const [open, setOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { companies, current, select } = useCompany();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">P</div>
          <span>
            PayMate<small>PAYROLL WORKSPACE</small>
          </span>
          <button
            className="icon-button mobile-only close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <div className="company-switch">
          <Building2 size={18} />
          <select
            aria-label="Active company"
            value={current?.id ?? ""}
            onChange={(e) => select(e.target.value)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/payroll"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
              >
                <item.icon size={19} />
                {item.label}
              </NavLink>
            ) : (
              <div
                className="nav-item disabled"
                key={item.path}
                title="Coming in a future phase"
              >
                <item.icon size={19} />
                {item.label}
                <span className="soon">Soon</span>
              </div>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="phase-badge">
            <ShieldCheck size={17} /> Phase 10 · Production
          </div>
          <button
            className="nav-item signout"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            <LogOut size={19} />
            Sign out
          </button>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-backdrop"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="topbar-title">Your payroll, organized.</div>
          <div className="avatar" title={user?.email ?? ""}>
            {(user?.email ?? "U")[0]?.toUpperCase()}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
