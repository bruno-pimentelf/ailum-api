FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" pnpm db:generate
RUN pnpm build
# Copy Prisma generated internals into dist (tsc doesn't copy .js → .js)
RUN cp -r src/generated/prisma/internal dist/generated/prisma/internal

# ── Production image ──────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY package.json ./

EXPOSE 3001

CMD ["node", "dist/server.js"]
