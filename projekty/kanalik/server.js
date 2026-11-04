'use strict';
const { start } = require('./src/app');

function parseTrustProxy(v) {
  if (v === undefined || v === '') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

start({
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH || undefined,
  uploadsDir: process.env.UPLOADS_DIR || undefined,
  seed: process.env.SEED !== 'false',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
}).then((s) => {
  console.log(`Kanalik działa: http://localhost:${s.port}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    s.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}).catch((err) => {
  console.error('Nie udało się uruchomić serwera:', err);
  process.exit(1);
});
