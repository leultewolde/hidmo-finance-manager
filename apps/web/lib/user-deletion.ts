type DeletionRequest = {
  id: string
  userId: string | null
  connectionId: string | null
  scope: 'user' | 'connection'
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  idempotencyKey: string
}

type DeletionRequestRepository = {
  findActiveUserRequestForUser(userId: string): Promise<
    | {
        id: string
        status: 'queued' | 'running' | 'succeeded' | 'failed'
        idempotencyKey: string
      }
    | undefined
  >
  createUserRequest(input: {
    id: string
    userId: string
    idempotencyKey: string
    requestedBy?: string
    auditMetadata?: Record<string, unknown>
  }): Promise<DeletionRequest>
  markFailed(
    id: string,
    errorCode: string,
    auditMetadata?: Record<string, unknown>,
  ): Promise<DeletionRequest | undefined>
}

type UserDeletionRepositories = {
  deletionRequests: DeletionRequestRepository
}

type EnqueueUserDeletionTask = (input: {
  userId: string
  deletionRequestId: string
  idempotencyKey: string
}) => Promise<{ idempotencyKey: string; taskName: string }>

const userDeletionAuditMetadata = {
  source: 'dashboard',
  scope: 'user',
}

export class UserDeletionEnqueueError extends Error {
  constructor(
    message: string,
    readonly deletionRequestId: string,
  ) {
    super(message)
    this.name = 'UserDeletionEnqueueError'
  }
}

export async function requestUserDeletion(input: {
  userId: string
  createId: () => string
  enqueueUserDeletionTask: EnqueueUserDeletionTask
  repositories: UserDeletionRepositories
}) {
  const active =
    await input.repositories.deletionRequests.findActiveUserRequestForUser(
      input.userId,
    )

  if (active !== undefined) {
    return {
      status: 'already_queued' as const,
      deletionRequestId: active.id,
      idempotencyKey: active.idempotencyKey,
      taskName: '',
    }
  }

  const deletionRequestId = input.createId()
  const idempotencyKey = `deletion:user:${input.userId}:${deletionRequestId}`
  const deletionRequest =
    await input.repositories.deletionRequests.createUserRequest({
      id: deletionRequestId,
      userId: input.userId,
      idempotencyKey,
      auditMetadata: userDeletionAuditMetadata,
    })

  try {
    const task = await input.enqueueUserDeletionTask({
      userId: input.userId,
      deletionRequestId: deletionRequest.id,
      idempotencyKey: deletionRequest.idempotencyKey,
    })

    return {
      status: 'queued' as const,
      deletionRequestId: deletionRequest.id,
      ...task,
    }
  } catch (error) {
    await input.repositories.deletionRequests.markFailed(
      deletionRequest.id,
      'TASK_ENQUEUE_FAILED',
      userDeletionAuditMetadata,
    )
    throw new UserDeletionEnqueueError(
      error instanceof Error ? error.message : 'User deletion enqueue failed',
      deletionRequest.id,
    )
  }
}
