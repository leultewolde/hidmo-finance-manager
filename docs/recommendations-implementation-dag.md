# Milestone 11 recommendations implementation DAG

Milestone 11 turns financial analysis into evidence-grounded recommendations.
The core rule is the same as Milestone 10: deterministic code owns facts and
math; AI can only rank and explain supplied evidence.

## Work drivers

- Evidence grounding: every recommendation, narrative claim, and priority must
  reference deterministic evidence IDs supplied by the app.
- Deterministic recommendations first: policy code creates recommendation
  candidates before any AI provider is called.
- No invented facts: AI output is rejected if it references unknown evidence,
  changes amounts, invents debt terms, or introduces unsupported timelines.
- Cost control: cache by input hash, keep Cloud Tasks execution async, cap
  provider request size, and keep the dev provider switch explicit.
- Privacy: prompts must exclude credentials, Plaid identifiers, account masks,
  raw transaction descriptions, owner identity, and free-form notes.
- Explainability: the dashboard should show why each recommendation exists,
  what evidence supports it, and what assumptions limit it.
- Operational safety: Vertex AI provider usage must be observable through
  model ID, latency, token counts, schema failures, and estimated cost metadata
  without logging prompt bodies.
- Beginner-friendly deployment: keep dev safe by default, document exactly
  when Terraform, image deploys, migrations, and manual validation are needed.

## Existing constraints

- `analysis_snapshots` and `analysis_jobs` already store deterministic summary
  and AI narrative output for a period.
- `recommendations` already exists in the initial schema with `type`,
  `status`, `priority`, `evidence`, `assumptions`, impact, confidence, narrative,
  and model metadata columns.
- The existing `recommendations` table may be reusable, but Milestone 11 must
  define a stricter typed evidence contract before relying on it.
- The worker already supports `AI_PROVIDER=mock | vertex`, but development is
  currently configured as `mock`.
- Exact Vertex AI model names and regional availability change. Before enabling
  Vertex in deployment, verify the selected stable Flash-Lite model in official
  Google Cloud documentation or the Vertex AI console.

## DAG

```text
A. Recommendation domain contracts
   ├─ A1. Recommendation period/input type
   ├─ A2. Evidence ID type and evidence reference schema
   ├─ A3. Recommendation candidate schema
   ├─ A4. Ranked/explained recommendation output schema
   ├─ A5. Recommendation provider metadata schema
   └─ A6. Prohibited claim/error codes

B. Deterministic recommendation policy engine
   ├─ depends on A and Milestone 10 summary engine
   ├─ B1. Low emergency fund policy
   ├─ B2. Negative free cash flow policy
   ├─ B3. High-interest debt policy
   ├─ B4. High credit utilization policy
   ├─ B5. Category overspend policy
   ├─ B6. Missing/stale/unreviewed data policy
   ├─ B7. Candidate impact/confidence estimates
   └─ B8. Stable evidence IDs and input hash

C. Persistence and read model
   ├─ depends on A and B
   ├─ C1. Decide whether to reuse `recommendations` table as-is
   ├─ C2. Add columns/tables only if typed evidence cannot fit safely
   ├─ C3. Repository methods for candidate batch upsert/list
   ├─ C4. Recommendation status lifecycle
   ├─ C5. Cache by user, period, input hash, formula/prompt version
   └─ C6. Tests for idempotent refresh and deletion cascade

D. AI grounding layer
   ├─ depends on A and B
   ├─ D1. Provider-neutral recommendation ranking interface
   ├─ D2. Mock provider
   ├─ D3. Prompt builder with minimized aggregate payload
   ├─ D4. Strict structured output validation
   ├─ D5. Reject unknown evidence references
   ├─ D6. Reject unsupported amounts/claims
   └─ D7. Redaction and payload-size tests

E. Recommendation generation service
   ├─ depends on B, C, and D
   ├─ E1. Build latest analysis summary/evidence input
   ├─ E2. Generate deterministic candidates
   ├─ E3. Reuse cached recommendations when input hash is unchanged
   ├─ E4. Call AI rank/explain provider only when needed
   ├─ E5. Store accepted recommendations and provider metadata
   ├─ E6. Mark failures with actionable error codes
   └─ E7. Idempotency for Cloud Tasks retries

F. Cloud Tasks and scheduling
   ├─ depends on E
   ├─ F1. Recommendation refresh task payload
   ├─ F2. Worker task handler
   ├─ F3. Web/manual refresh endpoint
   ├─ F4. Cooldown/coalescing for manual refresh
   ├─ F5. Weekly scheduler or safe scheduled trigger
   └─ F6. Structured logs for refresh status and provider usage

G. Vertex AI deployment wiring
   ├─ depends on D and E
   ├─ G1. Select and document exact stable Flash-Lite model
   ├─ G2. Terraform/env wiring for Vertex provider values
   ├─ G3. Least-privilege Vertex IAM for worker runtime
   ├─ G4. Keep dev default controlled and reversible
   ├─ G5. Token/output limits and timeout settings
   └─ G6. Cost metadata and budget validation

H. Evaluation suite
   ├─ depends on A, B, D, and E
   ├─ H1. Fixture summaries for common financial states
   ├─ H2. Golden deterministic candidates
   ├─ H3. Unknown evidence rejection tests
   ├─ H4. Prohibited claim tests
   ├─ H5. Privacy regression tests
   └─ H6. Provider failure/schema-failure tests

I. Dashboard recommendation UI
   ├─ depends on C and E
   ├─ I1. Recommendation list on dashboard
   ├─ I2. Evidence details for each recommendation
   ├─ I3. Assumptions and limitations
   ├─ I4. Manual refresh and cooldown status
   ├─ I5. Accept/dismiss controls if supported
   └─ I6. Clear planning-assistance disclaimer

J. Monitoring and docs
   ├─ depends on F, G, and H
   ├─ J1. Provider latency/token/cost logs
   ├─ J2. Schema failure and grounding failure logs
   ├─ J3. Alert metrics/policies for provider or grounding failures
   ├─ J4. Vertex enablement runbook
   ├─ J5. Recommendation troubleshooting runbook
   └─ J6. Final deployed validation checklist
```

## Proposed PR sequence

1. Milestone 11 DAG and work drivers: this document.
2. Recommendation contracts and evidence schema: `A`.
3. Deterministic recommendation policy engine: `B`.
4. Persistence/read model decision and repository work: `C`.
5. AI grounding layer and mock provider: `D`.
6. Recommendation generation service: `E`.
7. Cloud Tasks/manual refresh/scheduling integration: `F`.
8. Vertex deployment wiring and provider runtime configuration: `G`.
9. Evaluation fixtures and grounding/privacy tests: `H`.
10. Dashboard recommendation UI: `I`.
11. Monitoring, runbooks, and final checklist: `J`.

## Initial policy candidates

Start with policies that can be fully explained from existing deterministic
summary data:

- Low emergency fund: emergency coverage below configured floor.
- Negative free cash flow: expenses exceed income for the selected period.
- High-interest debt: high APR debt exists and should be prioritized.
- High credit utilization: credit utilization exceeds target threshold.
- Category overspend: category spending exceeds budget or baseline.
- Data quality: too many unreviewed, unknown, stale, or estimated inputs.

Defer policies that need additional product work:

- Investment allocation advice.
- Tax advice.
- Refinance decisions.
- Insurance optimization.
- Any action requiring real-world execution outside the app.

## Acceptance checklist

- Deterministic totals do not change when AI is disabled.
- Each recommendation contains valid evidence IDs.
- AI output cannot reference unknown evidence IDs.
- Prompts contain no Plaid credentials, Plaid IDs, raw descriptions, account
  masks, owner identity, or free-form notes.
- Repeated dashboard loads do not call Vertex AI.
- Manual refresh is asynchronous, idempotent, and cooldown-protected.
- Vertex provider usage logs model, latency, token counts, and status without
  logging prompt text.
- Fixture evaluations cover groundedness, prohibited claims, privacy, and
  provider failures.
