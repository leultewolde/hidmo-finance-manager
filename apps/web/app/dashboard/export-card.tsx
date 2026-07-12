export function ExportCard({ deletionActive }: { deletionActive: boolean }) {
  return (
    <section className="exportSection">
      <div>
        <p className="sectionLabel">Owner data</p>
        <h2>Export</h2>
        <p>
          Download a ZIP archive containing CSV files and a manifest. The export
          includes normalized financial records, analysis, and recommendations.
          It intentionally excludes Plaid tokens, provider account IDs, provider
          transaction IDs, account masks, and encryption material.
        </p>
      </div>
      {deletionActive ? (
        <span className="primaryButton exportButton disabledAction">
          Export disabled during deletion
        </span>
      ) : (
        <a className="primaryButton exportButton" href="/api/export">
          Download CSV export
        </a>
      )}
    </section>
  )
}
