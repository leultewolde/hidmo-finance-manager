import { createDatabase, createDatabasePool } from '../client.js'

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined || !databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string')
  }
  return databaseUrl
}

export function createCliDatabase() {
  const pool = createDatabasePool(getDatabaseUrl())
  return { pool, db: createDatabase(pool) }
}
