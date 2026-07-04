# Milestone 10 analysis implementation DAG

Milestone 10 adds AI-assisted financial analysis. Core financial numbers must
come from deterministic code first; AI should only turn structured facts into
plain-language analysis and recommendations.

## Work drivers

- Data correctness: reviewed transaction handling, split support, transfer
  exclusion, debt coverage, and investment balances in net worth.
- Deterministic calculations before AI: cash flow, category spending, debt,
  net worth, emergency coverage, savings capacity, budget baseline, and risk
  indicators.
- Privacy: send aggregate-first payloads, never tokens/provider IDs, and avoid
  raw transaction detail by default.
- Explainability: show period, included/excluded data, coverage notes, and
  deterministic numbers next to AI narrative.
- Cost control: generate on demand, store snapshots, and version prompts.
- Async execution: run analysis generation through Cloud Tasks/worker.
- Safety: planning-assistant language, caveats, and no guarantees.

## DAG

```text
A. Analysis domain contracts
   ├─ A1. Analysis period type
   ├─ A2. Analysis input schema
   ├─ A3. Deterministic summary schema
   ├─ A4. AI output schema
   └─ A5. Snapshot/job status schema

B. Deterministic finance summary engine
   ├─ depends on A
   ├─ B1. Cash flow summary
   ├─ B2. Category spending summary
   ├─ B3. Income stability summary
   ├─ B4. Debt summary
   ├─ B5. Net worth summary
   ├─ B6. Savings capacity estimate
   ├─ B7. Budget baseline
   └─ B8. Coverage/confidence notes

C. Data access/read model
   ├─ depends on A
   ├─ C1. Query accounts/balances
   ├─ C2. Query liabilities
   ├─ C3. Query reviewed transactions
   ├─ C4. Query splits
   ├─ C5. Query transfers/exclusions
   └─ C6. Build analysis input from DB rows

D. Snapshot persistence
   ├─ depends on A
   ├─ D1. analysis_snapshots table
   ├─ D2. analysis_jobs table or equivalent
   ├─ D3. repositories
   ├─ D4. input hash/version
   └─ D5. deterministic summary + AI output stored separately

E. AI provider abstraction
   ├─ depends on A and B
   ├─ E1. Provider interface
   ├─ E2. local/mock provider
   ├─ E3. Vertex AI/Gemini provider
   ├─ E4. schema-validated AI output
   ├─ E5. prompt versioning
   └─ E6. redaction/payload-size guardrails

F. Analysis generation service
   ├─ depends on B, C, D, E
   ├─ F1. Build deterministic summary
   ├─ F2. Store snapshot
   ├─ F3. Call AI provider
   ├─ F4. Validate AI response
   ├─ F5. Store final analysis
   ├─ F6. mark job succeeded/failed
   └─ F7. idempotency by period/input hash

G. Cloud Tasks worker integration
   ├─ depends on D and F
   ├─ G1. analysis task payload
   ├─ G2. web enqueue endpoint
   ├─ G3. worker handler
   ├─ G4. OIDC validation
   ├─ G5. retry-safe behavior
   └─ G6. structured logs

H. Dashboard UI
   ├─ depends on D and G
   ├─ H1. latest analysis snapshot
   ├─ H2. generation status
   ├─ H3. Generate analysis button
   ├─ H4. financial snapshot card
   ├─ H5. suggested budget card
   ├─ H6. action plan card
   ├─ H7. caveats/coverage notes
   └─ H8. not-financial-advice disclaimer

I. Monitoring and docs
   ├─ depends on G and H
   ├─ I1. analysis worker failure logs
   ├─ I2. alert metric/policy if useful
   ├─ I3. analysis runbook
   ├─ I4. prompt/privacy docs
   └─ I5. deployed validation checklist
```

## PR sequence

1. Analysis contracts and deterministic summary engine: `A + B`.
2. Analysis read model: `C`.
3. Snapshot persistence: `D`.
4. AI provider abstraction and mock provider: `E1 + E2 + E4 + E5 + E6`.
5. Vertex AI/Gemini provider: `E3`.
6. Analysis generation service: `F`.
7. Cloud Tasks worker integration: `G`.
8. Dashboard analysis UI: `H`.
9. Monitoring, docs, and final checklist: `I`.

## Implementation status

Completed:

- `A`: analysis domain contracts;
- `B`: deterministic finance summary engine;
- `C`: database read model for analysis inputs;
- `D`: snapshot and job persistence;
- `E`: AI provider abstraction, mock provider, guardrails, and Vertex adapter;
- `F`: analysis generation service;
- `G`: Cloud Tasks worker integration;
- `H`: dashboard analysis UI;
- `I`: monitoring, runbook, prompt/privacy docs, and deployed validation
  checklist.

Operational documentation:

- [Financial analysis runbook](./financial-analysis-runbook.md)
- [Development GCP environment guide](../infra/environments/dev/README.md)
