import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createLogger } from '@hidmo/logging'

import { getApplicationRepositories } from '../../../../lib/application-services'
import { enqueuePlaidSyncTask } from '../../../../lib/cloud-tasks'
import { handlePlaidWebhookPayload } from '../../../../lib/plaid-webhooks'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-plaid-webhook')

export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ status: 'invalid_json' }, { status: 400 })
  }

  const repositories = getApplicationRepositories()
  const result = await handlePlaidWebhookPayload(payload, {
    connections: repositories.connections,
    syncJobs: repositories.syncJobs,
    enqueuePlaidSyncTask,
  })

  if (result.body.status === 'queued') {
    logger.info(
      {
        connectionId: result.body.connectionId,
        syncJobId: result.body.syncJobId,
        taskName: result.body.taskName,
      },
      'Plaid webhook sync enqueued',
    )
  } else {
    logger.info(result.body, 'Plaid webhook handled without enqueue')
  }

  return NextResponse.json(result.body, { status: result.httpStatus })
}
