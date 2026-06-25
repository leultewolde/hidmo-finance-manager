import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { createCliDatabase } from './runtime.js'

const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
)
const { db, pool } = createCliDatabase()

try {
  await migrate(db, { migrationsFolder })
  console.log('Database migrations applied')
} finally {
  await pool.end()
}
