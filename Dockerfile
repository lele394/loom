# syntax=docker/dockerfile:1

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm rebuild better-sqlite3 esbuild
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    LOOM_DATA_DIR=/data \
    PORT=8787 \
    HOST=0.0.0.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm rebuild better-sqlite3 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server/main.ts"]
