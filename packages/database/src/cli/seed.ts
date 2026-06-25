import { seedSyntheticHousehold } from '../seed.js'
import { createCliDatabase } from './runtime.js'

const { db, pool } = createCliDatabase()

try {
  await seedSyntheticHousehold(db)
  console.log('Synthetic household seed applied')
} finally {
  await pool.end()
}
