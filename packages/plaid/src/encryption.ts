import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const LOCAL_KEY_NAME = 'local://plaid-token-wrapping/v1'

export class TokenDecryptionError extends Error {
  constructor() {
    super('The stored Plaid token could not be decrypted')
    this.name = 'TOKEN_DECRYPTION_FAILED'
  }
}

export interface TokenEnvelope {
  encryptedAccessToken: string
  wrappedDataKey: string
  encryptionNonce: string
  encryptionTag: string
  encryptionAlgorithm: string
  kmsKeyName: string
}

function encryptAesGcm(plaintext: Buffer, key: Buffer) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])

  return { ciphertext, nonce, tag: cipher.getAuthTag() }
}

function decryptAesGcm(
  ciphertext: Buffer,
  key: Buffer,
  nonce: Buffer,
  tag: Buffer,
) {
  const decipher = createDecipheriv(ALGORITHM, key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function parseLocalWrappingKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error(
      'LOCAL_TOKEN_ENCRYPTION_KEY must be 32 base64-encoded bytes',
    )
  }
  return key
}

export function encryptAccessToken(
  accessToken: string,
  wrappingKey: Buffer,
): TokenEnvelope {
  if (wrappingKey.length !== 32) {
    throw new Error('Wrapping key must be 32 bytes')
  }

  const dataKey = randomBytes(32)
  const token = encryptAesGcm(Buffer.from(accessToken, 'utf8'), dataKey)
  const wrappedKey = encryptAesGcm(dataKey, wrappingKey)

  return {
    encryptedAccessToken: token.ciphertext.toString('base64'),
    encryptionNonce: token.nonce.toString('base64'),
    encryptionTag: token.tag.toString('base64'),
    wrappedDataKey: [
      wrappedKey.nonce.toString('base64'),
      wrappedKey.tag.toString('base64'),
      wrappedKey.ciphertext.toString('base64'),
    ].join('.'),
    encryptionAlgorithm: ALGORITHM,
    kmsKeyName: LOCAL_KEY_NAME,
  }
}

export function decryptAccessToken(
  envelope: TokenEnvelope,
  wrappingKey: Buffer,
): string {
  if (
    envelope.encryptionAlgorithm !== ALGORITHM ||
    envelope.kmsKeyName !== LOCAL_KEY_NAME
  ) {
    throw new Error('Unsupported token envelope')
  }

  const [wrappedNonce, wrappedTag, wrappedCiphertext] =
    envelope.wrappedDataKey.split('.')
  if (
    wrappedNonce === undefined ||
    wrappedTag === undefined ||
    wrappedCiphertext === undefined
  ) {
    throw new Error('Invalid wrapped data key')
  }

  let dataKey: Buffer
  let plaintext: Buffer
  try {
    dataKey = decryptAesGcm(
      Buffer.from(wrappedCiphertext, 'base64'),
      wrappingKey,
      Buffer.from(wrappedNonce, 'base64'),
      Buffer.from(wrappedTag, 'base64'),
    )
    plaintext = decryptAesGcm(
      Buffer.from(envelope.encryptedAccessToken, 'base64'),
      dataKey,
      Buffer.from(envelope.encryptionNonce, 'base64'),
      Buffer.from(envelope.encryptionTag, 'base64'),
    )
  } catch {
    throw new TokenDecryptionError()
  }

  return plaintext.toString('utf8')
}
