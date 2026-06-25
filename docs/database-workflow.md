# Database Workflow

## Purpose

PostgreSQL is the system of record. Drizzle defines the typed schema and
generates explicit SQL migration files. The application never runs migrations
on startup. Local commands run migrations directly; production will use a
dedicated Cloud Run Job.

The database stores normalized records, not unrestricted provider response
payloads. Plaid access tokens cannot be stored as plaintext: the schema only
provides fields for encrypted token ciphertext and its complete encryption
envelope.

## Local setup

From a clean checkout:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

The local database is:

```text
postgresql://finance:finance@localhost:5432/finance_manager
```

These credentials are local development defaults and must never be reused in a
deployed environment.

## Creating a migration

1. Edit `packages/database/src/schema.ts`.
2. Generate SQL:

   ```bash
   pnpm db:generate
   ```

3. Review every generated file under `packages/database/drizzle/`.
4. Check specifically for:
   - destructive drops or type conversions;
   - nullable-to-required changes;
   - index creation before foreign keys that depend on those indexes;
   - accidental plaintext token or unrestricted provider-payload columns;
   - missing ownership, uniqueness, or non-negative constraints.
5. Apply the migration:

   ```bash
   pnpm db:migrate
   ```

6. Run the complete test suite:

   ```bash
   pnpm test
   ```

Generated SQL is committed with the schema change. Do not edit migration
history that has already run in a shared or production environment. Before a
migration is merged or deployed anywhere shared, correcting generated SQL
ordering is allowed and must be called out in the pull request.

## Synthetic seed

```bash
pnpm db:seed
```

The seed uses stable UUIDs and conflict-safe inserts. Running it repeatedly does
not duplicate records. It contains only synthetic accounts, transactions,
loans, investments, and budgets from the finance-engine fixture.

The seed is for local and isolated development environments only.

## Local reset

```bash
pnpm db:reset
pnpm db:seed
```

`db:reset`:

1. refuses to run when `APP_ENV=production`;
2. refuses non-local database hostnames;
3. drops the local `public` application schema;
4. drops Drizzle's local migration-history schema;
5. recreates `public`;
6. applies every committed migration.

The command destroys local database content. It is not a production rollback
mechanism.

## Recovering from a failed development migration

If an unmerged migration fails locally:

1. read the PostgreSQL error and identify whether the schema definition or SQL
   ordering is wrong;
2. correct the schema or the unshared generated migration;
3. run:

   ```bash
   pnpm db:reset
   pnpm db:seed
   pnpm test
   ```

If a migration has already been merged or applied to any shared environment,
do not rewrite it. Create a forward corrective migration instead.

## Repository boundaries

- All financial repository reads take an explicit `userId`.
- Composite ownership foreign keys prevent child records from pointing at
  another user's parent records.
- Transaction split replacement validates the exact total before deleting the
  previous splits and runs in one database transaction.
- Task execution claims use a unique idempotency key.
- The finance engine receives normalized domain objects and has no Drizzle or
  PostgreSQL dependency.

## Testing

The integration suite:

- recreates a blank schema and applies all migrations;
- reapplies migrations to verify no-op behavior;
- seeds the synthetic household twice;
- reconciles repository data with finance-engine totals;
- verifies ownership, uniqueness, token-envelope, and non-negative constraints;
- verifies failed transactions roll back;
- verifies invalid split replacement preserves existing splits.

GitHub Actions provides a temporary PostgreSQL service for these tests.
