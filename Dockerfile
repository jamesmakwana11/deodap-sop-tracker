# DeoDap SOP Campaign Tracker — single container: API + built web app.
# Build:  docker build -t deodap-sop-tracker .
# Run:    see docker-compose.yml and docs/SETUP.md

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY shared shared
COPY server server
COPY client client
COPY tsconfig.base.json ./
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    CLIENT_DIST_DIR=/app/client/dist
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/shared/package.json shared/package.json
COPY --from=build --chown=node:node /app/shared/src shared/src
COPY --from=build --chown=node:node /app/server/package.json server/package.json
COPY --from=build --chown=node:node /app/server/src server/src
COPY --from=build --chown=node:node /app/server/assets server/assets
COPY --from=build --chown=node:node /app/client/dist client/dist
COPY --from=build --chown=node:node /app/tsconfig.base.json ./
# JSON data files live here; mount a volume so they survive container updates.
ENV DATA_DIR=/app/server/data
RUN mkdir -p /app/server/data && chown node:node /app/server/data
VOLUME /app/server/data
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
