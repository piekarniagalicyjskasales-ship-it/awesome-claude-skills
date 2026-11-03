'use strict';
const { start } = require('./src/app');

start({
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || undefined,
  uploadsDir: process.env.UPLOADS_DIR || undefined,
}).then((s) => {
  console.log(`Kanalik działa: http://localhost:${s.port}`);
  const stop = () => s.close().then(() => process.exit(0), () => process.exit(1));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}).catch((err) => {
  console.error('Nie udało się uruchomić serwera:', err);
  process.exit(1);
});
