const capabilities = [
  'Connect accounts securely through Plaid',
  'Reconcile income, spending, transfers, and debt',
  'Build budgets and forecasts from deterministic calculations',
  'Explain prioritized actions with evidence-grounded AI',
]

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Private financial command center</p>
        <h1>Know where you stand. Decide what comes next.</h1>
        <p className="lede">
          Hidmo Finance Manager is being built as a single-owner application for
          trustworthy account aggregation, budgeting, debt planning, and
          forward-looking recommendations.
        </p>
        <div className="status">
          <span className="statusDot" aria-hidden="true" />
          Foundation in progress
        </div>
      </section>

      <section className="capabilities" aria-labelledby="capabilities-title">
        <div>
          <p className="sectionLabel">MVP direction</p>
          <h2 id="capabilities-title">Financial truth before automation.</h2>
        </div>
        <ol>
          {capabilities.map((capability, index) => (
            <li key={capability}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {capability}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
