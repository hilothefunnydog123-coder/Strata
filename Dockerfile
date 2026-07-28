# Assent — pnpm/Turborepo monorepo. The deployed surface is apps/web (marketing +
# gated console); the pipeline CLI ships too so the container can migrate and
# bootstrap its own corpus on boot.
#
# Debian slim rather than Alpine, deliberately: on musl, better-sqlite3 has no
# prebuilt binary and must be compiled, which drags in python3/make/g++ and a
# package-manager round trip on every build. On glibc it resolves without a
# toolchain, so this image installs NO operating-system packages at all — nothing
# to break when a distro mirror is slow, moved, or unreachable.
#
# One stage on purpose. The boot sequence runs migrations and the offline pipeline
# through tsx, so the runtime genuinely needs the workspace sources and dev
# dependencies; a slimmed runner stage would have to copy nearly all of it back.

FROM node:20-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Manifests first so dependency installation caches independently of source.
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

RUN pnpm install --frozen-lockfile

COPY . .

# The desktop renderer, built first so the web app can serve it at /terminal to a
# signed-in browser. Same bundle the Tauri shell loads — no browser-only variant.
RUN pnpm --filter @assent/desktop build

# Next builds without a database: every console page is force-dynamic and the
# connection pool is created lazily, so no connection is opened during the build.
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
