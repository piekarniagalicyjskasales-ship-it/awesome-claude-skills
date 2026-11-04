FROM node:22-alpine

LABEL org.opencontainers.image.title="Kanalik" \
      org.opencontainers.image.description="Kanalik - komunikator zespolowy w czasie rzeczywistym (Node.js, express, ws, SQLite)"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/kanalik.db \
    UPLOADS_DIR=/data/uploads \
    SEED=false \
    REGISTRATION=code

RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
