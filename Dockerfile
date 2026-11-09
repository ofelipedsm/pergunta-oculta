# Imagem do servidor do jogo (apps/server). O front vai para a Vercel separado.
# Build:  docker build -t pergunta-oculta-server .
# Rodar:  docker run -p 3000:3000 -e CORS_ORIGIN=http://localhost:5173 pergunta-oculta-server

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# Dependências primeiro, para aproveitar o cache das camadas
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/question-bank/package.json packages/question-bank/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @po/server...

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm --filter @po/shared --filter @po/question-bank build \
  && pnpm --filter @po/server build \
  && pnpm --filter @po/server deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "dist/main.js"]
