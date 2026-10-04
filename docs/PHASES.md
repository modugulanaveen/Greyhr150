# PayMate 10-phase continuity contract

This repository is the single source of truth for every phase. Do not scaffold new independent applications in later phases. Continue with the same `apps/web`, `apps/api`, `supabase/migrations` folders and existing Supabase project.

1. **Foundation:** Auth, onboarding, companies, membership, responsive dashboard, navigation.
2. **Employee management:** Tenant-scoped employee CRUD, identity, employment dates, bank/statutory details, previous-employer taxable salary, private documents, permissioned access.
3. **Salary structures:** Dynamic CTC-based salary calculation, configurable PF/PT settings, versioned salary structures, salary revisions/history, and effective dates.
4. **Attendance and LOP (this release):** Attendance import, leave, loss-of-pay rules, monthly salary proration, joining-date eligibility, configurable proration/PF basis, attendance history and LOP audit logging.
5. **TDS & income tax estimation:** Financial-year tax configuration, previous-employer taxable salary/TDS, projected current-employer salary, progressive slabs, rebate, marginal relief, cess, monthly TDS allocation and reconciliation.
6. **Payroll calculation & statutory processing:** Deterministic monthly payroll cycles, approval/locking and additional statutory calculations.
7. **Payslips:** A4 templates, PDF generation, secure distribution.
8. **Bulk processing:** Imports, bulk payslips, error handling and jobs.
9. **Compliance exports:** EPFO ECR and other applicable statutory reports with reconciliation.
10. **SaaS hardening:** Subscription/billing integration, observability, permissions, backups and deployment.

These are proposed phase boundaries, not functionality already present.

## Invariants

- `companies.id` (UUID) is the tenant key on every future tenant-owned table. Use foreign keys, indexes, and RLS based on verified membership.
- `company_members` maps `auth.users` to tenants. Preserve `OWNER`, `COMPANY_ADMIN`, `HR` role values; extend with new roles only through a migration and authorization updates.
- All migrations are **append-only** timestamped SQL files. Do not edit a migration after it has been applied in production.
- Backend middleware verifies the Supabase bearer token; backend never accepts a user ID from request bodies for authorization.
- Service-role credentials are server-only. Every service-role access is scoped by caller membership; use explicit permission checks on write routes.
- `apps/web/src/lib/api.ts` remains the browser API gateway; contexts handle auth and active-company state. New pages live in `apps/web/src/pages` and are added to the existing router/sidebar.
- Add integration tests for all new authenticated endpoints and RLS policies before production. No actual payroll data exists in the repository.


## Phase 10 — Production Foundation

- Production configuration and environment validation
- Settings and user administration
- Existing-role permission review
- API rate limiting, request limits and secure CORS
- Private Storage and upload validation
- Tenant/RLS hardening and deactivated-user handling
- Append-only audit history
- Health/version endpoints
- Subscription-ready plans, subscriptions and usage metrics
- Deployment, backup/recovery and security documentation
- Final QA boundary: external Supabase/hosting configuration remains required
