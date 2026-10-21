# Railway Baron's game server. Built from the repository root (it needs the workspace):
#   fly deploy . --config railway-baron/server/fly.toml --dockerfile railway-baron/server/Dockerfile --ha=false
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@slop/railway-baron..."
RUN pnpm --filter @slop/railway-baron build-server

FROM node:22-slim
WORKDIR /app
# One bundled file.
COPY --from=build /app/railway-baron/dist-server ./dist-server
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist-server/main.js"]
