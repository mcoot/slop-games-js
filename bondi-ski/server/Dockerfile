# Bondi Ski's game server. Built from the repository root (it needs the workspace):
#   fly deploy . --config bondi-ski/server/fly.toml --dockerfile bondi-ski/server/Dockerfile --ha=false
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@slop/bondi-ski..."
RUN pnpm --filter @slop/bondi-ski build-server

FROM node:22-slim
WORKDIR /app
# One bundled file, plus the course and maps it builds the arenas from.
COPY --from=build /app/bondi-ski/dist-server ./dist-server
COPY bondi-ski/public/course ./public/course
COPY bondi-ski/public/maps ./public/maps
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/public/
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist-server/main.js"]
