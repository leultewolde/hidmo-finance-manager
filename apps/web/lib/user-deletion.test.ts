import { describe, expect, it, vi } from 'vitest'

import { requestUserDeletion, UserDeletionEnqueueError } from './user-deletion'

function createRepositories() {
  return {
    deletionRequests: {
      findActiveUserRequestForUser: vi.fn().mockResolvedValue(undefined),
      createUserRequest: vi.fn().mockImplementation((input) =>
        Promise.resolve({
          ...input,
          userId: input.userId,
          connectionId: null,
          scope: 'user',
          status: 'queued',
        }),
      ),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
  }
}

describe('user deletion request orchestration', () => {
  it('creates a user deletion request and enqueues the worker task', async () => {
    const repositories = createRepositories()
    const enqueueUserDeletionTask = vi.fn().mockResolvedValue({
      idempotencyKey:
        'deletion:user:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
      taskName: 'projects/test/locations/us-east1/queues/deletion/tasks/user',
    })

    await expect(
      requestUserDeletion({
        userId: '00000000-0000-4000-8000-000000000001',
        createId: () => '00000000-0000-4000-8000-000000000002',
        enqueueUserDeletionTask,
        repositories,
      }),
    ).resolves.toEqual({
      status: 'queued',
      deletionRequestId: '00000000-0000-4000-8000-000000000002',
      idempotencyKey:
        'deletion:user:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
      taskName: 'projects/test/locations/us-east1/queues/deletion/tasks/user',
    })

    expect(
      repositories.deletionRequests.createUserRequest,
    ).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000002',
      userId: '00000000-0000-4000-8000-000000000001',
      idempotencyKey:
        'deletion:user:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
      auditMetadata: {
        source: 'dashboard',
        scope: 'user',
      },
    })
    expect(enqueueUserDeletionTask).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      deletionRequestId: '00000000-0000-4000-8000-000000000002',
      idempotencyKey:
        'deletion:user:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
    })
  })

  it('coalesces when a user deletion request is already queued or running', async () => {
    const repositories = createRepositories()
    repositories.deletionRequests.findActiveUserRequestForUser.mockResolvedValue(
      {
        id: '00000000-0000-4000-8000-000000000002',
        status: 'running',
        idempotencyKey: 'deletion:user:existing',
      },
    )
    const enqueueUserDeletionTask = vi.fn()

    await expect(
      requestUserDeletion({
        userId: '00000000-0000-4000-8000-000000000001',
        createId: () => '00000000-0000-4000-8000-000000000003',
        enqueueUserDeletionTask,
        repositories,
      }),
    ).resolves.toEqual({
      status: 'already_queued',
      deletionRequestId: '00000000-0000-4000-8000-000000000002',
      idempotencyKey: 'deletion:user:existing',
      taskName: '',
    })

    expect(
      repositories.deletionRequests.createUserRequest,
    ).not.toHaveBeenCalled()
    expect(enqueueUserDeletionTask).not.toHaveBeenCalled()
  })

  it('marks the deletion request failed when Cloud Tasks enqueueing fails', async () => {
    const repositories = createRepositories()
    const enqueueUserDeletionTask = vi
      .fn()
      .mockRejectedValue(new Error('Cloud Tasks unavailable'))

    await expect(
      requestUserDeletion({
        userId: '00000000-0000-4000-8000-000000000001',
        createId: () => '00000000-0000-4000-8000-000000000002',
        enqueueUserDeletionTask,
        repositories,
      }),
    ).rejects.toBeInstanceOf(UserDeletionEnqueueError)

    expect(repositories.deletionRequests.markFailed).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      'TASK_ENQUEUE_FAILED',
      {
        source: 'dashboard',
        scope: 'user',
      },
    )
  })
})
