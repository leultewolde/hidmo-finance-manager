import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { createCliDatabase, getDatabaseUrl } from './runtime.js'

const databaseUrl = new URL(getDatabaseUrl())
if (
  process.env.APP_ENV === 'production' ||
  !['localhost', '127.0.0.1'].includes(databaseUrl.hostname)
) {
  throw new Error('db:reset is restricted to a local non-production database')
}

const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
)
const { db, pool } = createCliDatabase()

try {
  await db.execute(sql`drop schema public cascade`)
  await db.execute(sql`drop schema if exists drizzle cascade`)
  await db.execute(sql`create schema public`)
  await migrate(db, { migrationsFolder })
  console.log('Local database reset and migrations applied')
} finally {
  await pool.end()
}
