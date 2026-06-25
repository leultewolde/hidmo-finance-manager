import pino, { type Logger, type LoggerOptions } from 'pino'

export type { Logger } from 'pino'

const redactedPaths = [
  'access_token',
  'authorization',
  'client_secret',
  'cookie',
  'database_url',
  'password',
  'public_token',
  'req.headers.authorization',
  'req.headers.cookie',
  'secret',
  '*.access_token',
  '*.authorization',
  '*.client_secret',
  '*.cookie',
  '*.password',
  '*.public_token',
  '*.secret',
]

export function createLogger(
  service: string,
  level = 'info',
  destination?: pino.DestinationStream,
): Logger {
  const options: LoggerOptions = {
    base: { service },
    level,
    redact: {
      paths: redactedPaths,
      censor: '[REDACTED]',
    },
  }

  return pino(options, destination)
}
