#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-finance-manager-dev-500423}"
REGION="${REGION:-us-east1}"
REPOSITORY_ID="${REPOSITORY_ID:-finance-images}"
PLATFORM="${PLATFORM:-linux/amd64}"
TAG_SUFFIX="${TAG_SUFFIX:-amd64}"
COMPONENT="${1:-all}"

REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY_ID}"
GIT_COMMIT="$(git rev-parse --short HEAD)"
IMAGE_TAG="${GIT_COMMIT}-${TAG_SUFFIX}"

usage() {
  printf 'Usage: %s [all|web|worker|migrations]\n' "$0" >&2
}

if [[ "$COMPONENT" != "all" && "$COMPONENT" != "web" && "$COMPONENT" != "worker" && "$COMPONENT" != "migrations" ]]; then
  usage
  exit 2
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

build_web() {
  pnpm exec dotenv -e .env -- docker buildx build \
    --platform "$PLATFORM" \
    --provenance=false \
    --target web \
    --build-arg NEXT_PUBLIC_FIREBASE_API_KEY \
    --build-arg NEXT_PUBLIC_FIREBASE_APP_ID \
    --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    -t "$REPO/web:$IMAGE_TAG" \
    --push .
}

build_worker() {
  docker buildx build \
    --platform "$PLATFORM" \
    --provenance=false \
    --target worker \
    -t "$REPO/worker:$IMAGE_TAG" \
    --push .
}

build_migrations() {
  docker buildx build \
    --platform "$PLATFORM" \
    --provenance=false \
    --target migrations \
    -t "$REPO/migrations:$IMAGE_TAG" \
    --push .
}

image_digest() {
  local image_name="$1"
  gcloud artifacts docker images describe "$REPO/$image_name:$IMAGE_TAG" \
    --format='value(image_summary.digest)'
}

require_command docker
require_command gcloud
require_command git
require_command pnpm

printf 'Repository: %s\n' "$REPO"
printf 'Tag: %s\n' "$IMAGE_TAG"
printf 'Platform: %s\n' "$PLATFORM"

if [[ "$COMPONENT" == "all" || "$COMPONENT" == "web" ]]; then
  build_web
fi

if [[ "$COMPONENT" == "all" || "$COMPONENT" == "worker" ]]; then
  build_worker
fi

if [[ "$COMPONENT" == "all" || "$COMPONENT" == "migrations" ]]; then
  build_migrations
fi

printf '\nTerraform image values:\n'

if [[ "$COMPONENT" == "all" || "$COMPONENT" == "web" ]]; then
  printf 'web_image = "%s/web@%s"\n' "$REPO" "$(image_digest web)"
fi

if [[ "$COMPONENT" == "all" || "$COMPONENT" == "worker" ]]; then
  printf 'worker_image = "%s/worker@%s"\n' "$REPO" "$(image_digest worker)"
fi

if [[ "$COMPONENT" == "all" || "$COMPONENT" == "migrations" ]]; then
  printf 'migration_image = "%s/migrations@%s"\n' "$REPO" "$(image_digest migrations)"
fi
