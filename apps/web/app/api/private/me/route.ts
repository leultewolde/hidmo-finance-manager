import { NextResponse } from 'next/server'

import { AuthFailure } from '../../../../lib/auth-policy'
import { requireOwner } from '../../../../lib/server-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const owner = await requireOwner()
    return NextResponse.json({ owner: { email: owner.email } })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    throw error
  }
}
