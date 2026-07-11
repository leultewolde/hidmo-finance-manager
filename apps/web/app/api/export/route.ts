import { NextResponse } from 'next/server'

import { buildFinanceExportArchive } from '@hidmo/export'
import { createLogger } from '@hidmo/logging'

import { requireDatabaseOwner } from '../../../lib/application-services'
import { AuthFailure } from '../../../lib/auth-policy'

export const dynamic = 'force-dynamic'

const logger = createLogger('web-export')

export async function GET() {
  try {
    const { databaseOwner, repositories } = await requireDatabaseOwner()
    const generatedAt = new Date()
    const archive = buildFinanceExportArchive({
      generatedAt,
      appVersion: process.env.npm_package_version ?? '0.1.0',
      data: await repositories.exports.buildForUser(databaseOwner.id),
    })

    logger.info(
      {
        userId: databaseOwner.id,
        fileName: archive.fileName,
        byteLength: archive.content.byteLength,
      },
      'Finance export generated',
    )

    return new NextResponse(Buffer.from(archive.content), {
      status: 200,
      headers: {
        'Content-Type': archive.contentType,
        'Content-Disposition': `attachment; filename="${archive.fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof AuthFailure) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }

    logger.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Finance export failed',
    )
    return NextResponse.json({ error: 'export-failed' }, { status: 500 })
  }
}
