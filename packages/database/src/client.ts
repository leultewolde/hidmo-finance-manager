import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema.js'

export type Database = NodePgDatabase<typeof schema>

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
  })
}

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema })
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query('select 1')
}
