'use strict';
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { createModels } = require('./models');
const { createRealtime } = require('./realtime');
const { createRouter, HttpError } = require('./routes');
const { seed, ensureDefaultChannels } = require('./seed');

async function start({ port = 3000, dbPath = './data/kanalik.db', uploadsDir = './data/uploads', seed: doSeed = true } = {}) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const db = openDb(dbPath);
  ensureDefaultChannels(db);
  if (doSeed) seed(db);

  const app = express();
  app.disable('x-powered-by');
  const server = http.createServer(app);

  let rt = null;
  const m = createModels(db, (id) => (rt ? rt.isOnline(id) : false));
  rt = createRealtime({ server, m });
  const { api, serveFile } = createRouter({ m, rt, db, uploadsDir });

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  const bigJson = express.json({ limit: '8mb' });
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/files' ? bigJson : smallJson)(req, res, next));
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
    res.status(status).json({ error: msg });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });

  let closed = null;
  function close() {
    if (closed) return closed;
    closed = (async () => {
      await rt.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      try { db.close(); } catch { /* już zamknięta */ }
    })();
    return closed;
  }

  return { port: server.address().port, close };
}

module.exports = { start };
