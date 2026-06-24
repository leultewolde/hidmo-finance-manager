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
- [GCP beginner guide](docs/gcp-getting-started.md)
- [Plaid beginner guide](docs/plaid-getting-started.md)
