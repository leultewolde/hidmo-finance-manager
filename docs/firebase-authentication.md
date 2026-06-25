# Firebase owner authentication

This application uses Firebase Google Sign-In to prove identity and a
server-side allowlist to authorize exactly one owner. A successful Google
sign-in is not sufficient by itself: the verified Firebase UID must equal
`FIREBASE_OWNER_UID`.

## Local configuration

Prerequisites:

- Firebase has been added to GCP project `finance-manager-dev-500423`;
- the Firebase web application is registered;
- Google is the only enabled Firebase Authentication provider;
- `localhost` is an authorized domain;
- `gcloud auth application-default login` has already been completed.

Copy the Firebase web configuration into the ignored root `.env` file:

```dotenv
FIREBASE_PROJECT_ID=finance-manager-dev-500423
FIREBASE_OWNER_UID=replace-after-first-google-sign-in
NEXT_PUBLIC_FIREBASE_API_KEY=copy-apiKey
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=copy-authDomain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=finance-manager-dev-500423
NEXT_PUBLIC_FIREBASE_APP_ID=copy-appId
```

Do not add quotation marks or trailing commas. Keep the existing database,
logging, and port values in `.env`.

The `NEXT_PUBLIC_` values identify the Firebase web application and are not
server credentials. Do not download a service-account JSON key. The Firebase
Admin SDK uses local Application Default Credentials and will later use the
Cloud Run service account.

## Record the owner UID

The first sign-in is a two-pass bootstrap:

1. Set `FIREBASE_OWNER_UID=replace-after-first-google-sign-in`.
2. Start PostgreSQL and the applications with `pnpm dev`.
3. Open `http://localhost:3000`.
4. Select **Continue with Google** and sign in using the intended owner.
5. The server rejects this first attempt because the placeholder UID is not
   authorized. The browser sign-in still creates the Firebase Authentication
   user.
6. Open Firebase Console, then **Build → Authentication → Users**.
7. Open the intended owner and copy its **User UID**.
8. Stop the development process.
9. Replace the placeholder:

   ```dotenv
   FIREBASE_OWNER_UID=the-copied-user-uid
   ```

10. Restart with `pnpm dev` and sign in again.
11. Confirm that `/dashboard` opens and displays the expected owner email.

The UID is authorization policy configuration. Do not commit `.env`, paste the
UID into client code, or replace it based on a browser request.

## Verify the security boundary

Expected behavior:

- no `__session` cookie redirects `/dashboard` to `/`;
- a valid Google account with another Firebase UID receives `403`;
- an invalid, expired, or revoked session receives `401` from private APIs;
- `/api/private/me` returns only the owner email derived from the verified
  server session and does not expose the authorization UID;
- logout clears the HTTP-only application session;
- deployed cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`.

Use browser developer tools under **Application → Cookies** to inspect cookie
flags. JavaScript must not be able to read `__session`.

## Session flow

1. The browser requests a short-lived CSRF token.
2. Firebase Google Sign-In returns an ID token.
3. The browser submits both values to `/api/auth/session`.
4. The server checks same-origin and CSRF protection.
5. Firebase Admin verifies the ID token and revocation status.
6. The server requires a recently authenticated, email-verified Google user.
7. The server compares the verified UID to `FIREBASE_OWNER_UID`.
8. Firebase Admin creates a five-day application session cookie.
9. Every private route verifies the cookie, revocation status, and owner UID.

The browser never selects the database user or authorization UID.
