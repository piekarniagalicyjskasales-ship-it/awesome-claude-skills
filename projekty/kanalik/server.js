'use strict';
const { start } = require('./src/app');
const { ConfigError, envNumber } = require('./src/config');

function parseTrustProxy(v) {
  if (v === undefined || v === '') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

function parseSeed(v) {
  if (v === undefined || v === '') return true;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ConfigError(`Nieprawidłowa wartość SEED="${v}": dozwolone true lub false`);
}

async function main() {
  const port = envNumber('PORT', { min: 1, integer: true, def: 3000 });
  const seed = parseSeed(process.env.SEED);
  const s = await start({
    port,
    host: process.env.HOST || '0.0.0.0',
    dbPath: process.env.DB_PATH || undefined,
    uploadsDir: process.env.UPLOADS_DIR || undefined,
    seed,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  });
  console.log(`Kanalik działa: http://localhost:${s.port}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    s.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  if (err instanceof ConfigError) console.error('Błąd konfiguracji: ' + err.message);
  else console.error('Nie udało się uruchomić serwera:', err);
  process.exit(1);
});
