# PayMate — Backup & Recovery Guidance

Phase 10 documents recovery procedures but does **not** claim that PayMate itself provides automatic backups.

## Database

Use the backup and point-in-time recovery capabilities configured for the production Supabase project. Confirm the selected Supabase plan actually provides the required retention and recovery features before relying on them.

Recommended operational practice:

1. Verify daily backup/PITR status in the Supabase project.
2. Record the retention period and responsible owner.
3. Before a production migration, create/verify a recoverable backup point.
4. Apply migrations in timestamp order.
5. Test restoration in a non-production Supabase project periodically.
6. Record the migration version and deployment timestamp.

## Storage

Sensitive Storage buckets (`employee-documents`, `payslips`, `payslip-branding`, `compliance`, `company-branding`) are private. Confirm the production storage backup/export process covers these objects; database backups alone are not sufficient for object recovery.

## Recovery procedure

1. Stop application writes if data integrity could be affected.
2. Identify the last known-good database recovery point.
3. Restore the Supabase database according to the configured Supabase recovery process.
4. Restore/verify Storage objects using the configured object-backup process.
5. Re-apply only migrations that are not already present.
6. Verify RLS, Storage privacy and Auth configuration.
7. Run the end-to-end smoke test in `PRODUCTION_CHECKLIST.md`.
8. Re-enable application traffic after validation.

Do not claim recovery capability until the external Supabase and Storage backup configuration has been verified.
