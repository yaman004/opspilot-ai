# syntax=docker/dockerfile:1
# One image for both the API and the SLA worker; the compose file picks the command.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace=shared --workspace=server --include-workspace-root=false
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
RUN npm run build -w server

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# The shared package is bundled into the server build, so only server's third-party dependencies are needed.
RUN npm ci --workspace=server --omit=dev --include-workspace-root=false

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./package.json
ENV UPLOAD_DIR=/data/uploads
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-4000}/api/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
