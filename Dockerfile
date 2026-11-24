# Servidor do jogo (Fastify + WebSocket + bot da Twitch). Roda sempre ligado,
# com UMA instância só: as salas e as lutas ficam na memória do processo.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# dependências primeiro (cache): o lockfile pede o package.json de todos os workspaces
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/games/package.json packages/games/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @clipei/server --include-workspace-root=false && npm cache clean --force

COPY packages packages
COPY apps/server apps/server

USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
