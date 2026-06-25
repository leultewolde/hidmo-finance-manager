import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

import { getWebEnvironment } from '@hidmo/config'

export function getFirebaseAdminAuth() {
  const environment = getWebEnvironment()
  const app =
    getApps()[0] ??
    initializeApp({
      credential: applicationDefault(),
      projectId: environment.FIREBASE_PROJECT_ID,
    })

  return getAuth(app)
}
