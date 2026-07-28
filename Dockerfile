# Assent — pnpm/Turborepo monorepo. The deployed surface is apps/web (marketing +
# gated console); the pipeline CLI ships too so the container can migrate and
# bootstrap its own corpus on boot.
#
# One stage on purpose. The boot sequence runs migrations and the offline pipeline
# through tsx, so the runtime genuinely needs the workspace sources and dev
# dependencies — a slimmed runner stage would have to copy nearly all of it back.
# Build toolchain is installed as a virtual package and removed after the build.

FROM node:20-alpine

WORKDIR /app

# libc6-compat: prebuilt native binaries (better-sqlite3) expect glibc symbols.
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy manifests first so dependency installation caches independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/desktop/package.json ./apps/desktop/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/local-db/package.json ./packages/local-db/
COPY packages/parse/package.json ./packages/parse/
COPY packages/ingest/package.json ./packages/ingest/
COPY packages/extract/package.json ./packages/extract/
COPY packages/brain/package.json ./packages/brain/
COPY packages/blueprint/package.json ./packages/blueprint/
COPY packages/ui/package.json ./packages/ui/
COPY packages/evals/package.json ./packages/evals/
COPY scripts/package.json ./scripts/

# better-sqlite3 compiles from source when no prebuild matches this platform.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && pnpm install --frozen-lockfile \
 && apk del .build-deps

COPY . .

# Next builds without a database: every console page is force-dynamic and the
# pool is created lazily, so no connection is opened during the build.
RUN pnpm --filter @assent/web build

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PIPELINE_MODE=fixture \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

COPY scripts/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
CMD ["/usr/local/bin/entrypoint.sh"]
