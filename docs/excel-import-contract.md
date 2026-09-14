# Excel employee import contract

## Input

Accepted format: XLSX. First row contains headers.

Required columns: `full_name`, `department`, `position`, `hire_date`.
Optional columns: `external_id`, `email`, `medical_exam_expiry`, `briefing_expiry`, `training_expiry`.

Dates use ISO `YYYY-MM-DD`. Empty rows are ignored. Formula cells are rejected unless resolved values are available. Maximum initial batch: 5,000 rows and 10 MB.

## Staged workflow

1. Upload to a private temporary path scoped by organization.
2. Parse server-side; never trust client parsing.
3. Normalize whitespace, casing for matching, dates and email.
4. Resolve department and position against organization-scoped dictionaries.
5. Show preview: valid, warning, error, duplicate, create/update.
6. User explicitly confirms.
7. Import in one transaction or reject the whole batch.
8. Write import batch, row outcomes and audit events.
9. Delete temporary file according to retention policy.

## Duplicate key

Preferred: `organization_id + external_id`. Fallback: normalized `full_name + hire_date + position`. Fallback duplicates require manual confirmation; never silently overwrite.

## Failure behavior

A database error rolls back the entire confirmed batch. Validation errors do not write business rows. The result file includes source row number, status, entity ID and error code. Re-import with the same idempotency key returns the previous result.

## Security

Organization ID is taken from the authenticated server context, not trusted from the workbook. Import requires `employees.import`. Every created/updated employee is audited and linked to an import batch.
