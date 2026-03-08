#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
pnpm db:migrate:prod

echo "[entrypoint] Starting server..."
exec pnpm start
