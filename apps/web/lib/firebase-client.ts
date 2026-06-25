'use client'

import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth'

function getFirebaseClientConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  }

  if (
    Object.values(config).some((value) => value === undefined || value === '')
  ) {
    throw new Error('Firebase browser configuration is incomplete')
  }

  return config as Record<keyof typeof config, string>
}

export async function signInOwnerWithGoogle(): Promise<string> {
  const app =
    getApps().length === 0 ? initializeApp(getFirebaseClientConfig()) : getApp()
  const auth = getAuth(app)
  const provider = new GoogleAuthProvider()

  await setPersistence(auth, inMemoryPersistence)
  provider.setCustomParameters({ prompt: 'select_account' })
  const credential = await signInWithPopup(auth, provider)

  try {
    return await credential.user.getIdToken(true)
  } finally {
    await auth.signOut()
  }
}
