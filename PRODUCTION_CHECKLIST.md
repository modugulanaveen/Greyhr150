# PayMate Production Deployment Checklist

## Infrastructure
- [ ] Supabase production project created
- [ ] Database migrations applied in timestamp order
- [ ] RLS enabled and reviewed
- [ ] Private Storage buckets verified
- [ ] Storage policies verified
- [ ] Auth email/redirect configuration verified
- [ ] SMTP/email delivery verified if invitations/password recovery are required
- [ ] Backup/PITR retention verified with the selected Supabase plan
- [ ] Storage backup/export process verified

## Environment
- [ ] API `NODE_ENV=production`
- [ ] API `SUPABASE_URL` configured
- [ ] API `SUPABASE_ANON_KEY` configured
- [ ] API `SUPABASE_SERVICE_ROLE_KEY` configured securely
- [ ] Web `VITE_SUPABASE_URL` configured
- [ ] Web `VITE_SUPABASE_ANON_KEY` configured
- [ ] Web `VITE_API_URL` configured
- [ ] `WEB_ORIGIN` contains only trusted frontend origins
- [ ] HTTPS enabled
- [ ] Custom domain configured

## Application
- [ ] Frontend deployed to Vercel or equivalent
- [ ] Backend deployed to Node.js hosting
- [ ] `/health` returns status `ok`
- [ ] Login tested
- [ ] Company onboarding tested
- [ ] Employee creation tested
- [ ] Salary tested
- [ ] Attendance/LOP tested
- [ ] TDS tested
- [ ] Payroll calculated/reviewed/approved/locked
- [ ] Payslip generated/downloaded
- [ ] PF/ECR tested
- [ ] Statutory payment tracking tested
- [ ] Dashboard tested
- [ ] Reports/export tested
- [ ] Settings tested
- [ ] User invitation/deactivation tested

## Security
- [ ] Company A cannot access Company B data
- [ ] Deactivated user cannot access tenant data
- [ ] Unauthorized payroll lock denied
- [ ] Sensitive Storage remains private
- [ ] Signed URLs expire
- [ ] File type/size/magic-byte validation verified
- [ ] Rate limits verified
- [ ] CORS restricted to trusted origin(s)
- [ ] No `.env` files in deployment artifact
- [ ] No service-role key in frontend bundle
- [ ] Error responses do not expose stack traces or SQL details
- [ ] Audit history cannot be deleted through application paths
