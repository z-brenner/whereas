# One container: the server, the built web app, and LibreOffice for PDF.
# Not yet built in CI. Treat as a starting point until it has been run once.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable \
 && apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3000 WHEREAS_DATA_DIR=/data HOME=/tmp
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "apps/server/dist/server.js"]
