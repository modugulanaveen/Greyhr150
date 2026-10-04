import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { CompanyProvider } from "./contexts/CompanyContext";
import Protected from "./components/Protected";
import Layout from "./components/Layout";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import CompanySettings from "./pages/CompanySettings";
import PayrollSettings from "./pages/PayrollSettings";
import UsersSettings from "./pages/UsersSettings";
import RolesSettings from "./pages/RolesSettings";
import SecuritySettings from "./pages/SecuritySettings";
import SubscriptionSettings from "./pages/SubscriptionSettings";
import SystemHealthSettings from "./pages/SystemHealthSettings";
import Employees from "./pages/Employees";
import Attendance from "./pages/Attendance";
import Payroll from "./pages/Payroll";
import PayrollHistory from "./pages/PayrollHistory";
import PayrollEmployee from "./pages/PayrollEmployee";
import PayrollComponents from "./pages/PayrollComponents";
import Payslips from "./pages/Payslips";
import PayslipDetail from "./pages/PayslipDetail";
import PayslipSettings from "./pages/PayslipSettings";
import Compliance from "./pages/Compliance";
import CompliancePF from "./pages/CompliancePF";
import CompliancePT from "./pages/CompliancePT";
import ComplianceTDS from "./pages/ComplianceTDS";
import CompliancePayments from "./pages/CompliancePayments";
import Reports from "./pages/Reports";
import ReportPage from "./pages/ReportPage";
import ComplianceReports from "./pages/ComplianceReports";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CompanyProvider>
          <Routes>
            <Route path="/login" element={<Auth mode="login" />} />
            <Route path="/register" element={<Auth mode="register" />} />
            <Route element={<Protected />}>
              <Route path="/onboarding" element={<Onboarding />} />
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/company" element={<CompanySettings />} />
                <Route path="/settings/payroll" element={<PayrollSettings />} />
                <Route path="/settings/users" element={<UsersSettings />} />
                <Route path="/settings/roles" element={<RolesSettings />} />
                <Route
                  path="/settings/security"
                  element={<SecuritySettings />}
                />
                <Route
                  path="/settings/subscription"
                  element={<SubscriptionSettings />}
                />
                <Route
                  path="/settings/system-health"
                  element={<SystemHealthSettings />}
                />
                <Route
                  path="/settings/statutory"
                  element={<Navigate to="/settings/payroll" replace />}
                />
                <Route
                  path="/settings/tax"
                  element={<Navigate to="/settings/payroll" replace />}
                />
                <Route
                  path="/settings/tds"
                  element={<Navigate to="/settings/payroll" replace />}
                />
                <Route
                  path="/settings/audit-logs"
                  element={<Navigate to="/settings" replace />}
                />
                <Route path="/employees" element={<Employees />} />
                <Route
                  path="/employees/salary-structures"
                  element={<Navigate to="/settings/payroll" replace />}
                />
                <Route
                  path="/salary-structure"
                  element={
                    <Navigate to="/settings/payroll" replace />
                  }
                />
                <Route path="/attendance" element={<Attendance />} />
                <Route
                  path="/tds"
                  element={<Navigate to="/settings/payroll" replace />}
                />
                <Route
                  path="/employees/:employeeId/tds"
                  element={<Navigate to="/settings/payroll" replace />}
                />
                <Route path="/payroll" element={<Payroll />} />
                <Route path="/payroll/components" element={<PayrollComponents />} />
                <Route path="/payroll/history" element={<PayrollHistory />} />
                <Route
                  path="/payroll/:payrollId/employee/:employeeId"
                  element={<PayrollEmployee />}
                />
                <Route path="/payslips" element={<Payslips />} />
                <Route
                  path="/payslips/:payslipId"
                  element={<PayslipDetail />}
                />
                <Route
                  path="/payslips/settings"
                  element={<PayslipSettings />}
                />
                <Route path="/compliance" element={<Compliance />} />
                <Route path="/compliance/pf" element={<CompliancePF />} />
                <Route path="/compliance/pt" element={<CompliancePT />} />
                <Route path="/compliance/tds" element={<ComplianceTDS />} />
                <Route
                  path="/compliance/payments"
                  element={<CompliancePayments />}
                />
                <Route path="/reports" element={<Reports />} />
                <Route path="/reports/:type" element={<ReportPage />} />
                <Route
                  path="/compliance/reports"
                  element={<ComplianceReports />}
                />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </CompanyProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
