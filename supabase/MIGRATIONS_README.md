Migrations guide — Supabase

Purpose

This folder contains SQL migration files for schema changes. When the front-end code requires a new table/column/index/policy, a new migration SQL file should be added here and applied to the Supabase project.

Naming

- Use a numeric prefix to order migrations: `001_add_facturas.sql`, `002_alter_clientes_add_phone.sql`, etc.
- Keep the files idempotent when possible (use `IF NOT EXISTS`).

Applying migrations — Option A: Supabase Console (recommended for quick/manual runs)

1. Open https://app.supabase.com and select your project.
2. Go to "SQL Editor" → "New query".
3. Paste the contents of the migration file and click **RUN**.
4. Verify the change in Table Editor.

Applying migrations — Option B: supabase CLI (reproducible, requires CLI & credentials)

Prereqs:
- Install CLI: https://supabase.com/docs/guides/cli
- Login or set env vars:
  - `export SUPABASE_ACCESS_TOKEN=...` (or login with `supabase login`)
  - Use `supabase db remote set <project-ref>` or set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` as needed.

Run a single file with `psql` (example):

```bash
# If you have the service_role key and the DB connection string
psql "postgresql://postgres:<SERVICE_ROLE_KEY>@db.<project-ref>.supabase.co:5432/postgres" -f ./supabase/001_add_facturas.sql
```

Or, if you prefer to keep it manual via CLI:

```bash
# open SQL editor via CLI (or just use the web editor)
supabase sql "$(cat supabase/001_add_facturas.sql)"
```

Security note

- Never commit your Supabase service role key into the repository.
- Use the web SQL editor for manual runs when unsure, and use the CLI only from a trusted machine.

Reverting migrations

- Not all migrations are easily reversible. Prefer adding new ALTER commands that are safe (e.g., `ADD COLUMN`) and write separate rollback files if needed.

Workflow we will follow

- For any code change that requires DB changes, I'll create a migration file in `supabase/` and include in the commit a short instruction block telling you exactly which file to run and how (UI/CLI). You will then run it in your Supabase project.

If you want, I can start converting a concrete change now (tell me which table/field you want to add) and produce the SQL file and the exact command to run.