# Plaid Sandbox connection

Milestone 5 connects the authenticated owner to Plaid Sandbox, exchanges the
temporary public token on the server, encrypts the reusable access token, and
persists safe account metadata.

## Local configuration

Open the Plaid Dashboard and copy the Sandbox `client_id` and Sandbox secret
into the ignored root `.env` file:

```dotenv
PLAID_CLIENT_ID=copy-client-id
PLAID_SECRET=copy-sandbox-secret
PLAID_ENV=sandbox
```

Do not add a `NEXT_PUBLIC_` prefix. These values must never enter the browser
bundle.

Generate a 32-byte local token-wrapping key:

```bash
openssl rand -base64 32
```

Copy the single output line into `.env`:

```dotenv
LOCAL_TOKEN_ENCRYPTION_KEY=copy-generated-value
```

Do not reuse a password, Firebase value, Plaid secret, or macOS login
credential as the encryption key. Keep the generated key stable while local
connections exist; changing it makes existing encrypted Plaid access tokens
undecryptable.

## Run the Sandbox flow

1. Start the application with `pnpm dev`.
2. Open `http://localhost:3000` and sign in as the configured owner.
3. Select **Connect account**.
4. Choose a Sandbox institution.
5. Use current test credentials from the Plaid Sandbox documentation or the
   credentials shown inside Link.
6. Complete Link and wait for the dashboard to reload.
7. Confirm the institution and masked accounts remain after another refresh.

The browser receives a short-lived Link token and public token because Plaid
Link requires them. It never receives the Plaid secret, reusable access token,
Item ID, or complete provider account IDs.

## Inspect the security boundary

In browser developer tools:

- `/api/plaid/link-token` may return only `linkToken`;
- `/api/plaid/exchange` returns only an internal connection ID and account
  count;
- dashboard HTML and React data contain internal UUIDs and masked account
  numbers, not full provider identifiers;
- the `__session` cookie remains HTTP-only.

Application logs must not contain Plaid tokens or provider identifiers. Plaid
errors are logged only by safe error class name.

## Disconnect

Select **Disconnect** for the institution and confirm the prompt. The server:

1. loads the connection by authenticated owner and internal connection ID;
2. decrypts the access token server-side;
3. calls Plaid `/item/remove`;
4. deletes associated local accounts;
5. marks the connection revoked;
6. erases the encrypted token envelope.

The revoked connection row remains as a minimal audit record.

## Local encryption design

Each access token receives a random 256-bit data-encryption key and random
AES-GCM nonce. The access token is encrypted with that data key. The local
master key separately wraps the data key with AES-256-GCM.

PostgreSQL stores ciphertext, authentication tags, nonces, wrapped data key,
algorithm version, and key name. It never stores a plaintext access token.
Cloud KMS will later replace the local data-key wrapping operation without
changing the token envelope model.
