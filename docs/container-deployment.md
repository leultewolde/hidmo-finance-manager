# Production containers

Milestone 8 uses one multi-target `Dockerfile` to produce three independent
images:

- `web`: the public Next.js Cloud Run service;
- `worker`: the private Cloud Run service invoked by Cloud Tasks;
- `migrations`: the Cloud Run Job that applies PostgreSQL migrations.

No GCP resources are needed to build or test these images locally.

## Build

Build every image:

```bash
pnpm container:build
```

Build one image:

```bash
pnpm container:build:web
docker build --target worker -t hidmo-worker:local .
docker build --target migrations -t hidmo-migrations:local .
```

Firebase browser configuration is public but must be embedded in the web
JavaScript bundle at image build time. `container:build:web` reads the four
`NEXT_PUBLIC_FIREBASE_*` values from the local `.env` file and passes only
those public values as build arguments. Plaid credentials, database
credentials, Firebase owner UID, and encryption keys must never be build
arguments.

Local Docker builds use the host architecture (`linux/arm64` on Apple Silicon).
The Artifact Registry release workflow will explicitly build `linux/amd64`,
which is the architecture expected by Cloud Run.

## Runtime conventions

Cloud Run injects `PORT`. The web and worker containers default to `8080` and
listen on `0.0.0.0`. Local `WEB_PORT` and `WORKER_PORT` remain supported and
take precedence over `PORT`.

The containers run as the unprivileged `node` user. They do not contain `.env`,
Git history, local dependencies, or Terraform files.

## Local worker smoke test

The worker readiness endpoint requires PostgreSQL, but liveness only verifies
that the process started.

```bash
docker run --rm \
  --name hidmo-worker-smoke \
  -p 8081:8080 \
  -e PORT=8080 \
  -e APP_ENV=production \
  -e DATABASE_URL=postgresql://finance:finance@host.docker.internal:5432/finance_manager \
  hidmo-worker:local
```

In another terminal:

```bash
curl --fail http://localhost:8081/health/live
curl --fail http://localhost:8081/health/ready
```

Stop the foreground container with `Ctrl+C`.

## Local migration smoke test

Start local PostgreSQL first:

```bash
pnpm db:up
```

Then run:

```bash
docker run --rm \
  -e APP_ENV=development \
  -e DATABASE_URL=postgresql://finance:finance@host.docker.internal:5432/finance_manager \
  hidmo-migrations:local
```

The command must print `Database migrations applied` and exit with status zero.

## Web image

The web image needs the complete runtime configuration before it can start.
During GCP deployment, ordinary configuration comes from Cloud Run and
sensitive values come from Secret Manager. Do not pass production secrets as
Docker build arguments or bake an `.env` file into the image.
