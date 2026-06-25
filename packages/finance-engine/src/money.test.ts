import { describe, expect, it } from 'vitest'

import {
  addMoney,
  divideRounded,
  money,
  ratioBps,
  subtractMoney,
} from './money.js'

describe('money operations', () => {
  it('adds and subtracts integer minor units', () => {
    expect(addMoney([money(10_001n), money(999n)])).toEqual(money(11_000n))
    expect(subtractMoney(money(11_000n), money(999n))).toEqual(money(10_001n))
  })

  it('rejects mixed currencies', () => {
    expect(() => addMoney([money(100n, 'USD'), money(100n, 'EUR')])).toThrow(
      /Currency mismatch/,
    )
  })

  it('rounds ratios deterministically without floating-point money', () => {
    expect(divideRounded(5n, 2n)).toBe(3n)
    expect(divideRounded(-5n, 2n)).toBe(-3n)
    expect(ratioBps(1n, 3n)).toBe(3_333)
    expect(ratioBps(1n, 0n)).toBeNull()
  })
})
