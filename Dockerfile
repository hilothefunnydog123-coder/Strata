# Strata — Healthcare AI Control Plane (Next.js + Prisma).
# On boot: applies database migrations, seeds the owner + demo org (idempotent),
# then serves the app. Binds 0.0.0.0 and honors $PORT.

FROM node:22-alpine
WORKDIR /app

# Prisma needs OpenSSL on Alpine.
RUN apk add --no-cache openssl libc6-compat

# Copy source first so postinstall's `prisma generate` finds the schema.
COPY . .

# Default DB location (the persistent disk mounts at /data in production).
# Override DATABASE_URL / SESSION_SECRET / OWNER_* as host env vars.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:/data/strata.db"
RUN npm ci
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

# Apply migrations, seed (idempotent), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.mjs && npm start"]
