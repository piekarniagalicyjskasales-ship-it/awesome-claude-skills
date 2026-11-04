'use strict';
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { openDb } = require('./db');
const { createModels } = require('./models');
const { createRealtime } = require('./realtime');
const { createRouter, HttpError } = require('./routes');
const { seed, ensureDefaultChannels } = require('./seed');
const { envNumber, resolveRegistration, ConfigError } = require('./config');

const DAY = 24 * 3600 * 1000;

async function start({
  port = 3000, host, dbPath = './data/kanalik.db', uploadsDir = './data/uploads', seed: doSeed = true,
  sessionTtlMs, uploadQuotaBytes, uploadsTotalBytes, orphanMaxAgeMs = DAY, trustProxy,
  registration, registrationCode, registerRateLimit,
} = {}) {
  // Walidacja konfiguracji przed jakimkolwiek efektem ubocznym.
  if (sessionTtlMs === undefined) sessionTtlMs = envNumber('SESSION_TTL_DAYS', { min: 1, def: 30 }) * DAY;
  if (uploadQuotaBytes === undefined) uploadQuotaBytes = envNumber('UPLOAD_QUOTA_MB', { min: 1, def: 100 }) * 1024 * 1024;
  if (uploadsTotalBytes === undefined) uploadsTotalBytes = envNumber('UPLOADS_TOTAL_MB', { min: 1, def: 5000 }) * 1024 * 1024;
  const reg = resolveRegistration(registration, registrationCode);
  let registerLimit;
  if (registerRateLimit === false) registerLimit = 0;
  else if (registerRateLimit === undefined) registerLimit = envNumber('REGISTER_LIMIT_PER_HOUR', { min: 1, integer: true, def: 5 });
  else if (Number.isFinite(registerRateLimit) && registerRateLimit >= 1) registerLimit = registerRateLimit;
  else throw new ConfigError('registerRateLimit musi być false lub liczbą >= 1');
  if (trustProxy === true) {
    console.warn('UWAGA: TRUST_PROXY=true ufa nagłówkowi X-Forwarded-For od dowolnego klienta. ' +
      'Ustaw liczbę proxy przed aplikacją (np. 1).');
  }
  fs.mkdirSync(uploadsDir, { recursive: true });
  const db = openDb(dbPath);
  ensureDefaultChannels(db);
  if (doSeed) seed(db);

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy !== undefined && trustProxy !== null && trustProxy !== '') app.set('trust proxy', trustProxy);
  const server = http.createServer(app);

  let rt = null;
  const m = createModels(db, (id) => (rt ? rt.isOnline(id) : false));
  rt = createRealtime({ server, m });

  const pendingIds = new Set(); // pliki w trakcie zapisu (nie ruszać przy sprzątaniu)
  let closing = false;
  const removeFile = (id) => {
    m.run('DELETE FROM files WHERE id = ?', id);
    fsp.unlink(path.join(uploadsDir, id)).catch(() => {});
  };
  // Usuwa wiersz (warunkowo) i dopiero potem plik. Zwraca true, gdy usunięto.
  async function dropOrphanRow(id) {
    const r = m.run(
      'DELETE FROM files WHERE id = ? AND NOT EXISTS (SELECT 1 FROM messages WHERE file_id = ?)', id, id);
    if (r.changes !== 1) return false;
    await fsp.unlink(path.join(uploadsDir, id)).catch(() => {});
    return true;
  }
  // Pliki-sieroty (bez wiadomości) starsze niż orphanMaxAgeMs oraz pliki na dysku bez wiersza w bazie.
  async function cleanupOrphans() {
    const cutoffMs = Date.now() - orphanMaxAgeMs;
    const rows = m.all('SELECT id FROM files WHERE created_at <= ?', new Date(cutoffMs).toISOString());
    let removed = 0;
    for (const r of rows) if (!pendingIds.has(r.id) && await dropOrphanRow(r.id)) removed++;
    let names = [];
    try { names = await fsp.readdir(uploadsDir); } catch { /* brak katalogu */ }
    for (const name of names) {
      if (!/^[a-f0-9]{32}$/.test(name) || pendingIds.has(name)) continue;
      if (m.get('SELECT 1 FROM files WHERE id = ?', name)) continue;
      try {
        const st = await fsp.stat(path.join(uploadsDir, name));
        if (st.mtimeMs <= cutoffMs && !pendingIds.has(name) && !m.get('SELECT 1 FROM files WHERE id = ?', name)) {
          await fsp.unlink(path.join(uploadsDir, name));
          removed++;
        }
      } catch { /* plik zniknął */ }
    }
    return removed;
  }
  // Jednorazowo: pliki przypięte wyłącznie do usuniętych wiadomości (dziedzictwo sprzed R2).
  function cleanupDeletedMessageFiles() {
    const rows = m.all(
      `SELECT f.id FROM files f
       WHERE EXISTS (SELECT 1 FROM messages WHERE file_id = f.id)
       AND NOT EXISTS (SELECT 1 FROM messages WHERE file_id = f.id AND deleted = 0)`);
    for (const r of rows) removeFile(r.id);
  }
  const housekeeping = async () => {
    if (closing) return 0;
    try {
      m.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      return await cleanupOrphans();
    } catch (e) {
      if (!closing) console.error('Sprzątanie plików:', e);
      return 0;
    }
  };
  cleanupDeletedMessageFiles();
  await housekeeping();
  const hkTimer = setInterval(housekeeping, 3600 * 1000);
  hkTimer.unref();

  const { api, serveFile } = createRouter({
    m, rt, db, uploadsDir, sessionTtlMs, uploadQuotaBytes, uploadsTotalBytes, removeFile, pendingIds,
    registration: reg.mode, registrationCode: reg.code, registerLimit,
  });

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // POST /api/files ma własny parser (8 MB) w routerze, po uwierzytelnieniu.
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/files' ? next() : smallJson(req, res, next)));
  app.get('/files/:id', serveFile);
  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let msg = err.message;
    if (err instanceof HttpError) { /* komunikat już po polsku */ }
    else if (err.type === 'entity.too.large') { status = 413; msg = 'Żądanie jest za duże'; }
    else if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) { status = 400; msg = 'Nieprawidłowy JSON'; }
    else { status = status >= 400 && status < 500 ? status : 500; msg = status === 500 ? 'Błąd serwera' : 'Nieprawidłowe żądanie'; if (status === 500) console.error(err); }
    if (res.headersSent) return res.destroy();
    if (!req.complete) res.setHeader('Connection', 'close');
    res.status(status).json({ error: msg });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    if (host) server.listen(port, host, resolve); else server.listen(port, resolve);
  });

  let closed = null;
  function close() {
    if (closed) return closed;
    closed = (async () => {
      closing = true;
      clearInterval(hkTimer);
      // 1. przestań przyjmować nowe połączenia
      const serverClosed = new Promise((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      // 2. WebSockety: kod 1001
      await rt.close();
      // 3. poczekaj na trwające żądania (max 10 s)
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(resolve, 10000); });
      const idleSweep = setInterval(() => server.closeIdleConnections(), 100);
      await Promise.race([serverClosed, timeout]);
      clearTimeout(timer);
      clearInterval(idleSweep);
      server.closeAllConnections();
      await serverClosed;
      try { db.close(); } catch { /* już zamknięta */ }
    })();
    return closed;
  }

  return { port: server.address().port, close, cleanupOrphans };
}

module.exports = { start };
