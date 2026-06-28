import 'server-only'

import { getWebEnvironment } from '@hidmo/config'
import {
  createDatabase,
  createDatabasePool,
  createRepositories,
} from '@hidmo/database'
import { createPlaidProvider, parseLocalWrappingKey } from '@hidmo/plaid'

import { requireOwner } from './server-auth'

const globalServices = globalThis as typeof globalThis & {
  hidmoDatabasePool?: ReturnType<typeof createDatabasePool>
}

export function getApplicationRepositories() {
  const environment = getWebEnvironment()
  const pool =
    globalServices.hidmoDatabasePool ??
    createDatabasePool(environment.DATABASE_URL)

  if (environment.APP_ENV !== 'production') {
    globalServices.hidmoDatabasePool = pool
  }

  return createRepositories(createDatabase(pool))
}

export function getPlaidProvider() {
  const environment = getWebEnvironment()
  return createPlaidProvider({
    clientId: environment.PLAID_CLIENT_ID,
    secret: environment.PLAID_SECRET,
    environment: environment.PLAID_ENV,
    ...(environment.PLAID_WEBHOOK_URL === undefined
      ? {}
      : { webhookUrl: environment.PLAID_WEBHOOK_URL }),
  })
}

export function getLocalTokenWrappingKey() {
  return parseLocalWrappingKey(getWebEnvironment().LOCAL_TOKEN_ENCRYPTION_KEY)
}

export async function requireDatabaseOwner() {
  const firebaseOwner = await requireOwner()
  const repositories = getApplicationRepositories()
  const databaseOwner = await repositories.users.ensureOwner(
    firebaseOwner.uid,
    firebaseOwner.email,
  )

  if (databaseOwner === undefined) {
    throw new Error('Unable to resolve database owner')
  }

  return { firebaseOwner, databaseOwner, repositories }
}
