# PayMate security notes — Phase 2

Phase 2 adds tenant-scoped employee data and server-enforced role permissions on top of the Phase 1 authentication foundation.

- Every employee request requires a verified Supabase access token.
- The requested `company_id` is accepted only after checking the authenticated user's `company_members` membership.
- OWNER, COMPANY_ADMIN and HR can create/update/deactivate employees and manage departments.
- ACCOUNTANT can view employee information needed for payroll, but bank/statutory values are masked and employee document downloads are denied.
- Employee IDs are unique within each company at the database level.
- Employee records use soft deactivation; payroll-relevant rows are not hard-deleted through the application.
- Employee documents are stored in a private Supabase Storage bucket. The API generates short-lived signed URLs only after authorization.
- Sensitive detail tables have RLS enabled and no broad browser policies; the server API uses the service role only after verifying identity and membership.
- Full Aadhaar numbers are not required by the model; only an optional reference/token is supported.
- The application does not intentionally log PAN, bank account numbers, or other sensitive employee values.
- Uploads are limited to PDF/JPG/JPEG/PNG/DOCX and 5 MB.

Before public deployment, add production rate limiting, audit logging, MFA policy, managed secret storage, database backups, malware scanning for uploaded documents, integration/RLS tests against a dedicated Supabase project, and an independent compliance review of Indian payroll/statutory handling.
