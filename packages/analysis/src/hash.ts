import { createHash } from 'node:crypto'

export type StableJsonPrimitive = string | number | boolean | null
export type StableJsonValue =
  | StableJsonPrimitive
  | bigint
  | Date
  | readonly StableJsonValue[]
  | { readonly [key: string]: StableJsonValue | undefined }

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry))
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Unsupported stable JSON value type: ${typeof value}`)
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, unknown] => {
        return entry[1] !== undefined
      })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalize(child)]),
  )
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function sha256StableJson(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex')
}
