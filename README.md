# Finance Manager

A private, single-user personal finance application that connects financial accounts through Plaid,
normalizes transactions and liabilities, calculates the user's financial
position, builds a practical budget, and provides explainable recommendations.

This directory currently contains the product and technical design. It is
separate from `home-dashboard` and is designed for deployment on Google Cloud.

## Product principles

1. Financial calculations are deterministic and testable.
2. AI explains facts and proposes actions; it does not calculate source-of-truth
   balances.
3. Every classification can be inspected and corrected by the user.
4. Transfers and debt payments must not be counted as ordinary spending.
5. Recommendations show their assumptions, expected impact, and confidence.
6. Plaid credentials, account identifiers, and raw financial records never
   reach the browser or the AI provider; AI receives only minimized aggregates.

## Platform decisions

- Hosting: Google Cloud.
- Primary GCP region: `us-east1`.
- Access model: one allowlisted owner account; no public registration.
- Authentication: Firebase Authentication with Google Sign-In.
- AI: Gemini on Vertex AI, using a low-cost Flash-Lite model by default.
- Calculations: deterministic finance engine; AI only explains and prioritizes.

## MVP outcome

After connecting accounts, a user can answer:

- What do I own and owe?
- How much comes in and goes out each month?
- Where is my money going?
- What bills, subscriptions, and debt payments are coming next?
- What can I safely spend before the next payday?
- What budget is realistic based on my actual behavior?
- Which three actions would improve my position most?

The MVP includes connected credit cards, connected personal/auto/student loan
accounts when available through Plaid, manually entered loans, and investment
account balances for net-worth calculation. It does not analyze investment
holdings or recommend investments.

See [docs/product-design.md](docs/product-design.md) and
[docs/technical-design.md](docs/technical-design.md). The concrete GCP topology
is documented in [docs/gcp-architecture.md](docs/gcp-architecture.md).

## Implementation guides

- [Implementation plan](docs/implementation-plan.md)
- [Financial formula reference](docs/financial-formulas.md)
- [Database workflow](docs/database-workflow.md)
- [Firebase owner authentication](docs/firebase-authentication.md)
- [GCP beginner guide](docs/gcp-getting-started.md)
- [Plaid beginner guide](docs/plaid-getting-started.md)

## Repository structure

```text
apps/
  web/                 Next.js user interface and API
  worker/              asynchronous HTTP task handler
packages/
  ai/                  Vertex AI boundary (placeholder)
  classification/      transaction classification (placeholder)
  config/              validated runtime configuration
  contracts/           shared request and response schemas
  database/            PostgreSQL schema, migrations, repositories, and seed
  finance-engine/      deterministic financial domain and calculations
  logging/             structured, redacted logging
  plaid/               Plaid adapter boundary (placeholder)
docs/                  product, architecture, and implementation guides
```

Placeholder packages reserve the intended dependency boundaries. Their product
logic is implemented in later milestones.

## Local development

Prerequisites:

- Node.js 22;
- pnpm 9 through Corepack;
- Docker Desktop with Docker Compose.

From a clean checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

`pnpm dev` starts local PostgreSQL, waits for it to become healthy, and then
starts:

- web application: <http://localhost:3000>
- worker service: <http://localhost:3001>

Stop the web and worker with `Ctrl+C`, then stop PostgreSQL:

```bash
pnpm db:down
```

The PostgreSQL data volume is preserved by `db:down`. To inspect database logs:

```bash
pnpm db:logs
```

Do not put Plaid credentials or other secrets in `.env.example`. Local `.env`
files are ignored by Git.

## Health endpoints

Liveness confirms that the process can serve requests:

```text
GET http://localhost:3000/api/health/live
GET http://localhost:3001/health/live
```

Readiness validates required configuration and PostgreSQL connectivity:

```text
GET http://localhost:3000/api/health/ready
GET http://localhost:3001/health/ready
```

Readiness returns HTTP `503` when a required dependency is unavailable.

## Validation

Run the same checks as CI:

```bash
pnpm db:up
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

GitHub Actions runs these checks for pull requests and pushes to `main`.
Database tests recreate the local `public` schema and use synthetic data only.
