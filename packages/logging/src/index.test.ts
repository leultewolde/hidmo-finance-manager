import { Writable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { createLogger } from './index.js'

describe('structured logging', () => {
  it('redacts known credential fields', async () => {
    let output = ''
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString()
        callback()
      },
    })
    const logger = createLogger('test', 'info', destination)

    logger.info({
      access_token: 'token-value',
      item_id: 'provider-item-id',
      link_token: 'link-token-value',
      provider_account_id: 'provider-account-id',
      accountId: 'internal-id',
    })
    await new Promise<void>((resolve) => destination.end(resolve))

    expect(output).not.toContain('token-value')
    expect(output).not.toContain('provider-item-id')
    expect(output).not.toContain('provider-account-id')
    expect(output).toContain('[REDACTED]')
    expect(output).toContain('internal-id')
  })
})
