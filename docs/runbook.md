# Production runbook

## Ownership

- Production owner: repository owner / HSE Radar platform owner.
- Application: Vercel project connected to `generke/hse-radar-mvp`.
- Database/Auth/Storage: production Supabase project.
- Secrets must exist only in Vercel/Supabase secret stores. Never paste or commit secret values.

## Environments

Use separate Supabase projects for development/preview and production. Set Vercel variables by environment. Required public variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL`. Server-only variables include `SUPABASE_SERVICE_ROLE_KEY`, payment, cron, email and Telegram secrets.

## Deploy

1. Require `npm ci && npm run verify`.
2. Apply reviewed migrations to a non-production Supabase project.
3. Run `supabase/tests/rls_acceptance.sql` with two test users/organizations.
4. Deploy Preview and test authentication, organization switch, employee update, completion and audit entry.
5. Apply migration to production in a maintenance window.
6. Deploy the exact verified commit.
7. Check `/api/health` and critical workflows.

## Rollback

Application rollback: promote the last known-good Vercel deployment. Database migrations are forward-only. Do not improvise destructive DOWN migrations; create a reviewed compensating migration. Before a high-risk migration, create and verify a backup.

## Backup

- Enable Supabase database backups/PITR appropriate to the paid plan.
- Export schema plus data regularly to encrypted storage with limited access.
- Copy private Storage objects separately; database backups do not include bucket contents.
- Record backup time, checksum, retention and operator.
- Never store production backups in the public repository.

## Restore drill

At least quarterly:

1. Create an isolated Supabase recovery project.
2. Restore the latest database backup.
3. Restore `hse-documents` objects.
4. verify object checksums, row counts and RLS tests.
5. Point a temporary Preview deployment at recovery.
6. Test login, employee read, cross-tenant denial, document download and audit visibility.
7. Destroy the recovery project after recording results.

## Incident

1. Freeze deploys and record incident time.
2. Revoke or rotate compromised credentials.
3. Preserve Vercel logs, Supabase logs and immutable audit events.
4. Contain affected organization/account.
5. Restore service using the last known-good deployment or recovery project.
6. Notify affected parties according to applicable Kazakhstan personal-data obligations.
7. Publish root cause, scope, corrective actions and owner.

## Personal data

Collect only required fields, restrict exports, use private Storage, hash IP context, set retention periods and log privileged access. Production errors return generic messages; sensitive details belong in protected server logs.
