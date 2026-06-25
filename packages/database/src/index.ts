import { Pool } from 'pg'

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
  })
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query('select 1')
}
