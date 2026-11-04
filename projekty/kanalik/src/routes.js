'use strict';
const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPasswordAsync, verifyPasswordAsync, verifyDummy, createLoginLimiter, newToken, hashToken } = require('./auth');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const forbidden = (msg) => new HttpError(403, msg || 'Brak uprawnień');
const notFound = (msg) => new HttpError(404, msg || 'Nie znaleziono');

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const MAX_FILE = 5 * 1024 * 1024;

const str = (v) => (typeof v === 'string' ? v : null);
function parseId(v) {
  const n = Number(v);
  if (!/^\d+$/.test(String(v)) || !Number.isSafeInteger(n) || n < 1) throw notFound();
  return n;
}
const now = () => new Date().toISOString();

function createRouter({
  m, rt, db, uploadsDir, sessionTtlMs, uploadQuotaBytes, uploadsTotalBytes, removeFile, pendingIds,
  registration, registrationCode, registerLimit, inviteCodeLimit,
}) {
  const api = express.Router();
  const limiter = createLoginLimiter();
  const registerLimiter = registerLimit ? createLoginLimiter({ max: registerLimit, windowMs: 3600 * 1000 }) : null;
  const codeHash = registration === 'code' ? crypto.createHash('sha256').update(registrationCode).digest() : null;
  const inviteLimiter = inviteCodeLimit ? createLoginLimiter({ max: 10, windowMs: 15 * 60 * 1000 }) : null;
  const ticketWindows = new Map(); // tokenHash -> { n, start }

  function addMember(channelId, userId) {
    const last = m.get('SELECT COALESCE(MAX(id), 0) AS mx FROM messages WHERE channel_id = ?', channelId).mx;
    m.run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, last_read_message_id, joined_at) VALUES (?, ?, ?, ?)',
      channelId, userId, last, now());
  }

  // ---------- Auth ----------
  const HOUR = 3600 * 1000;
  function auth(req, res, next) {
    const h = req.headers.authorization || '';
    const mt = /^Bearer\s+([a-f0-9]{64})$/i.exec(h);
    const tokenHash = mt ? hashToken(mt[1].toLowerCase()) : null;
    const row = tokenHash
      ? m.get(`SELECT u.*, s.expires_at AS s_expires, s.last_used_at AS s_last FROM sessions s
               JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, tokenHash)
      : null;
    const t = Date.now();
    if (!row) return next(new HttpError(401, 'Wymagane zalogowanie'));
    if (row.s_expires < t) {
      m.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      rt.dropSession(tokenHash);
      return next(new HttpError(401, 'Sesja wygasła'));
    }
    if (t - row.s_last > HOUR) {
      m.run('UPDATE sessions SET expires_at = ?, last_used_at = ? WHERE token_hash = ?', t + sessionTtlMs, t, tokenHash);
    }
    req.userRow = row;
    req.me = row.id;
    req.tokenHash = tokenHash;
    next();
  }

  function createSession(userId) {
    const token = newToken();
    const t = Date.now();
    // Max 20 sesji na użytkownika: najstarsze (wg last_used_at) są usuwane, a ich sockety zamykane.
    const old = m.all('SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY last_used_at ASC, created_at ASC', userId);
    for (const o of old.slice(0, Math.max(0, old.length - 19))) {
      m.run('DELETE FROM sessions WHERE token_hash = ?', o.token_hash);
      rt.dropSession(o.token_hash);
    }
    m.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)',
      hashToken(token), userId, t, t + sessionTtlMs, t);
    return token;
  }

  api.get('/health', (req, res) => {
    m.get('SELECT 1');
    res.json({ ok: true });
  });

  api.get('/config', (req, res) => res.json({ registration }));

  api.post('/auth/register', async (req, res, next) => {
   try {
    if (registration === 'closed') throw forbidden('Rejestracja jest wyłączona');
    if (registerLimiter && registerLimiter.blocked(req.ip))
      throw new HttpError(429, 'Zbyt wiele rejestracji. Spróbuj później.');
    if (codeHash) {
      if (inviteLimiter && inviteLimiter.blocked(req.ip)) throw new HttpError(429, 'Zbyt wiele prób. Spróbuj później.');
      const given = str((req.body || {}).inviteCode);
      const ok = given !== null &&
        crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), codeHash);
      if (!ok) {
        if (inviteLimiter) inviteLimiter.fail(req.ip);
        throw forbidden('Nieprawidłowy kod zaproszenia');
      }
    }
    const b = req.body || {};
    const username = str(b.username) === null ? null : str(b.username).trim().toLowerCase();
    const password = str(b.password);
    if (!username || !USERNAME_RE.test(username))
      throw bad('Nazwa użytkownika: 3–20 znaków (małe litery, cyfry, _ i .)');
    if (!password || password.length < 6) throw bad('Hasło musi mieć co najmniej 6 znaków');
    if (password.length > 200) throw bad('Hasło może mieć maksymalnie 200 znaków');
    let displayName = username;
    if (b.displayName !== undefined && b.displayName !== null) {
      displayName = str(b.displayName);
      displayName = displayName === null ? '' : displayName.trim();
      if (displayName.length < 1 || displayName.length > 40) throw bad('Nazwa wyświetlana: 1–40 znaków');
    }
    if (m.get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'Nazwa użytkownika jest zajęta');
    const { salt, hash } = await hashPasswordAsync(password);
    if (m.get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'Nazwa użytkownika jest zajęta');
    const id = Number(m.run(
      'INSERT INTO users (username, password_hash, salt, display_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      username, hash, salt, displayName, '', now()).lastInsertRowid);
    const defaults = m.all('SELECT id FROM channels WHERE is_default = 1');
    for (const c of defaults) {
      addMember(c.id, id);
    }
    const user = m.getUser(id);
    rt.sendAll({ type: 'user.updated', user });
    for (const c of defaults) rt.sendMembers(c.id, { type: 'channel.member_joined', channelId: c.id, user }, id);
    if (registerLimiter) registerLimiter.fail(req.ip);
    res.status(201).json({ token: createSession(id), user });
   } catch (e) { next(e); }
  });

  api.post('/auth/login', async (req, res, next) => {
    try {
      const b = req.body || {};
      const username = str(b.username);
      const password = str(b.password);
      const fail = () => new HttpError(401, 'Nieprawidłowa nazwa użytkownika lub hasło');
      if (!username || !password) throw fail();
      const uname = username.trim().toLowerCase();
      const key = req.ip + ':' + uname;
      if (limiter.blocked(key)) throw new HttpError(429, 'Zbyt wiele prób logowania. Spróbuj za kilka minut.');
      if (password.length > 200) { limiter.fail(key); throw fail(); }
      const row = m.get('SELECT * FROM users WHERE username = ?', uname);
      if (!row) { await verifyDummy(password); limiter.fail(key); throw fail(); }
      if (!(await verifyPasswordAsync(password, row.salt, row.password_hash))) { limiter.fail(key); throw fail(); }
      limiter.clear(key);
      res.json({ token: createSession(row.id), user: m.userOut(row) });
    } catch (e) { next(e); }
  });

  api.use(auth);

  api.post('/auth/logout', (req, res) => {
    m.run('DELETE FROM sessions WHERE token_hash = ?', req.tokenHash);
    rt.dropSession(req.tokenHash);
    res.json({ ok: true });
  });

  api.post('/auth/logout-all', (req, res) => {
    m.run('DELETE FROM sessions WHERE user_id = ?', req.me);
    rt.dropUser(req.me);
    res.json({ ok: true });
  });

  api.post('/ws-ticket', (req, res) => {
    const t = Date.now();
    for (const [k, v] of ticketWindows) if (t - v.start > 60000) ticketWindows.delete(k);
    let w = ticketWindows.get(req.tokenHash);
    if (!w) { w = { n: 0, start: t }; ticketWindows.set(req.tokenHash, w); }
    if (++w.n > 30) throw new HttpError(429, 'Zbyt wiele żądań. Spróbuj za chwilę.');
    res.json({ ticket: rt.createTicket(req.me, req.tokenHash) });
  });

  api.post('/me/password', async (req, res, next) => {
    try {
      const b = req.body || {};
      const cur = str(b.currentPassword);
      const next_ = str(b.newPassword);
      if (!cur || !next_) throw bad('Podaj obecne i nowe hasło');
      if (next_.length < 6) throw bad('Hasło musi mieć co najmniej 6 znaków');
      if (next_.length > 200) throw bad('Hasło może mieć maksymalnie 200 znaków');
      const key = 'pw:' + req.tokenHash;
      if (limiter.blocked(key)) throw new HttpError(429, 'Zbyt wiele prób. Spróbuj za kilka minut.');
      const row = m.get('SELECT * FROM users WHERE id = ?', req.me);
      if (cur.length > 200 || !(await verifyPasswordAsync(cur, row.salt, row.password_hash))) {
        limiter.fail(key);
        throw forbidden('Nieprawidłowe obecne hasło');
      }
      limiter.clear(key);
      const { salt, hash } = await hashPasswordAsync(next_);
      m.run('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', hash, salt, req.me);
      m.run('DELETE FROM sessions WHERE user_id = ?', req.me);
      rt.dropUser(req.me);
      res.json({ ok: true, token: createSession(req.me) });
    } catch (e) { next(e); }
  });

  const usedBytes = (uid) => m.get('SELECT COALESCE(SUM(size), 0) AS s FROM files WHERE user_id = ?', uid).s;
  api.get('/me/storage', (req, res) => res.json({ usedBytes: usedBytes(req.me), quotaBytes: uploadQuotaBytes }));

  api.get('/me', (req, res) => res.json({ user: m.getUser(req.me) }));

  api.patch('/me', (req, res) => {
    const b = req.body || {};
    let displayName = req.userRow.display_name;
    let status = req.userRow.status;
    if (b.displayName !== undefined) {
      const d = str(b.displayName);
      if (d === null || d.trim().length < 1 || d.trim().length > 40) throw bad('Nazwa wyświetlana: 1–40 znaków');
      displayName = d.trim();
    }
    if (b.status !== undefined) {
      const s = str(b.status);
      if (s === null || s.length > 100) throw bad('Status: maksymalnie 100 znaków');
      status = s;
    }
    m.run('UPDATE users SET display_name = ?, status = ? WHERE id = ?', displayName, status, req.me);
    const user = m.getUser(req.me);
    rt.sendAll({ type: 'user.updated', user });
    res.json({ user });
  });

  api.get('/users', (req, res) => {
    const rows = m.all('SELECT * FROM users ORDER BY display_name COLLATE NOCASE, id');
    res.json({ users: rows.map(m.userOut) });
  });

  // ---------- Kanały ----------
  function channelOr404(id) {
    const row = m.getChannelRow(id);
    if (!row) throw notFound('Kanał nie istnieje');
    return row;
  }
  function memberChannel(req) {
    const row = channelOr404(parseId(req.params.id));
    if (!m.getMember(row.id, req.me)) throw forbidden('Nie jesteś członkiem tego kanału');
    return row;
  }

  api.get('/channels/browse', (req, res) => {
    const rows = m.all('SELECT * FROM channels WHERE is_dm = 0 AND is_private = 0 ORDER BY name');
    res.json({ channels: rows.map((r) => m.channelOut(r, req.me)) });
  });

  api.get('/channels', (req, res) => {
    const rows = m.all(
      `SELECT c.* FROM channels c JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
       ORDER BY c.is_dm, c.name`, req.me);
    res.json({ channels: rows.map((r) => m.channelOut(r, req.me)) });
  });

  api.post('/channels', (req, res) => {
    const b = req.body || {};
    const name = str(b.name);
    if (!name || !CHANNEL_RE.test(name))
      throw bad('Nazwa kanału: małe litery, cyfry, - i _ (maks. 80 znaków, zaczyna się od litery lub cyfry)');
    if (name.startsWith('dm-')) throw bad('Nazwa zarezerwowana');
    let topic = '';
    if (b.topic !== undefined && b.topic !== null) {
      topic = str(b.topic);
      if (topic === null || topic.length > 250) throw bad('Temat: maksymalnie 250 znaków');
    }
    const isPrivate = b.isPrivate === true || b.isPrivate === 1 ? 1 : 0;
    if (m.get('SELECT 1 FROM channels WHERE name = ?', name)) throw new HttpError(409, 'Kanał o takiej nazwie już istnieje');
    const id = Number(m.run('INSERT INTO channels (name, topic, is_private, created_at) VALUES (?, ?, ?, ?)',
      name, topic, isPrivate, now()).lastInsertRowid);
    addMember(id, req.me);
    if (isPrivate) rt.sendChannelToMembers('channel.created', id);
    else rt.sendChannelToAll('channel.created', id);
    res.status(201).json({ channel: m.channelOut(m.getChannelRow(id), req.me) });
  });

  api.post('/channels/:id/join', (req, res) => {
    const row = channelOr404(parseId(req.params.id));
    if (row.is_dm || row.is_private) throw forbidden('Nie można dołączyć do tego kanału');
    if (!m.getMember(row.id, req.me)) {
      addMember(row.id, req.me);
      rt.sendMembers(row.id, { type: 'channel.member_joined', channelId: row.id, user: m.getUser(req.me) });
    }
    res.json({ channel: m.channelOut(row, req.me) });
  });

  api.post('/channels/:id/leave', (req, res) => {
    const row = channelOr404(parseId(req.params.id));
    if (row.is_dm) throw bad('Nie można opuścić rozmowy bezpośredniej');
    m.run('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', row.id, req.me);
    rt.sendChannelToMembers('channel.updated', row.id);
    res.json({ ok: true });
  });

  api.patch('/channels/:id', (req, res) => {
    const row = memberChannel(req);
    if (row.is_dm) throw bad('Nie można zmienić tematu rozmowy bezpośredniej');
    const topic = str((req.body || {}).topic);
    if (topic === null || topic.length > 250) throw bad('Temat: 0–250 znaków');
    m.run('UPDATE channels SET topic = ? WHERE id = ?', topic, row.id);
    rt.sendChannelToMembers('channel.updated', row.id);
    res.json({ channel: m.channelOut(m.getChannelRow(row.id), req.me) });
  });

  api.get('/channels/:id/members', (req, res) => {
    const row = channelOr404(parseId(req.params.id));
    if ((row.is_private || row.is_dm) && !m.getMember(row.id, req.me)) throw forbidden('Nie jesteś członkiem tego kanału');
    const users = m.all(
      `SELECT u.* FROM users u JOIN channel_members cm ON cm.user_id = u.id WHERE cm.channel_id = ?
       ORDER BY u.display_name COLLATE NOCASE, u.id`, row.id);
    res.json({ users: users.map(m.userOut) });
  });

  api.post('/channels/:id/members', (req, res) => {
    const row = memberChannel(req);
    if (row.is_dm) throw bad('Nie można dodawać osób do rozmowy bezpośredniej');
    const uid = (req.body || {}).userId;
    if (!Number.isInteger(uid)) throw bad('Nieprawidłowy userId');
    const target = m.getUser(uid);
    if (!target) throw notFound('Użytkownik nie istnieje');
    if (!m.getMember(row.id, uid)) {
      addMember(row.id, uid);
      rt.sendChannelEvent('channel.created', row, [uid]);
      rt.sendMembers(row.id, { type: 'channel.member_joined', channelId: row.id, user: target }, uid);
    }
    res.json({ ok: true });
  });

  api.post('/dms', (req, res) => {
    const uid = (req.body || {}).userId;
    if (!Number.isInteger(uid)) throw bad('Nieprawidłowy userId');
    if (!m.getUserRow(uid)) throw notFound('Użytkownik nie istnieje');
    const name = `dm-${Math.min(req.me, uid)}-${Math.max(req.me, uid)}`;
    let row = m.get('SELECT * FROM channels WHERE name = ?', name);
    if (row && !row.is_dm) throw new HttpError(409, 'Nazwa zarezerwowana');
    if (!row) {
      const id = Number(m.run(
        'INSERT INTO channels (name, topic, is_dm, is_private, created_at) VALUES (?, \'\', 1, 1, ?)', name, now()).lastInsertRowid);
      addMember(id, req.me);
      if (uid !== req.me) addMember(id, uid);
      row = m.getChannelRow(id);
      if (uid !== req.me) rt.sendChannelEvent('channel.created', row, [uid]);
    }
    res.json({ channel: m.channelOut(row, req.me) });
  });

  // ---------- Wiadomości ----------
  api.get('/channels/:id/messages', (req, res) => {
    const row = memberChannel(req);
    let limit = 50;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw bad('limit musi być z zakresu 1–100');
    }
    let before = null;
    if (req.query.before !== undefined) {
      before = Number(req.query.before);
      if (!Number.isInteger(before) || before < 1) throw bad('Nieprawidłowy parametr before');
    }
    const rows = before === null
      ? m.all('SELECT * FROM messages WHERE channel_id = ? AND parent_id IS NULL ORDER BY id DESC LIMIT ?', row.id, limit)
      : m.all('SELECT * FROM messages WHERE channel_id = ? AND parent_id IS NULL AND id < ? ORDER BY id DESC LIMIT ?',
        row.id, before, limit);
    res.json({ messages: rows.reverse().map(m.messageOut) });
  });

  function validText(v, allowEmpty) {
    const t = str(v);
    if (t === null) { if (allowEmpty && (v === undefined || v === null)) return ''; throw bad('Treść wiadomości jest wymagana'); }
    const text = t.trim();
    if (text.length > 4000) throw bad('Wiadomość może mieć maksymalnie 4000 znaków');
    if (text.length < 1 && !allowEmpty) throw bad('Wiadomość nie może być pusta');
    return text;
  }

  api.post('/channels/:id/messages', (req, res) => {
    const row = memberChannel(req);
    const b = req.body || {};
    let fileId = null;
    if (b.fileId !== undefined && b.fileId !== null) {
      fileId = str(b.fileId);
      if (!fileId || !/^[a-f0-9]{32}$/.test(fileId) || !m.get('SELECT 1 FROM files WHERE id = ?', fileId))
        throw bad('Nieprawidłowy plik');
      if (!m.get('SELECT 1 FROM files WHERE id = ? AND user_id = ?', fileId, req.me)) throw forbidden('To nie jest Twój plik');
    }
    const text = validText(b.text, !!fileId);
    if (!text && !fileId) throw bad('Wiadomość nie może być pusta');
    let parentId = null;
    if (b.parentId !== undefined && b.parentId !== null) {
      if (!Number.isInteger(b.parentId)) throw bad('Nieprawidłowy parentId');
      const parent = m.getMessageRow(b.parentId);
      if (!parent || parent.channel_id !== row.id || parent.parent_id !== null)
        throw bad('Wiadomość nadrzędna musi należeć do tego kanału i nie może być odpowiedzią');
      if (parent.deleted) throw bad('Nie można odpowiadać na usuniętą wiadomość');
      parentId = parent.id;
    }
    const id = Number(m.run(
      'INSERT INTO messages (channel_id, user_id, parent_id, text, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      row.id, req.me, parentId, text, fileId, now()).lastInsertRowid);
    if (parentId === null) {
      m.run(`UPDATE channel_members SET last_read_message_id = MAX(last_read_message_id, ?)
             WHERE channel_id = ? AND user_id = ?`, id, row.id, req.me);
    }
    const message = m.getMessage(id);
    rt.sendMembers(row.id, { type: 'message.created', message });
    if (parentId) rt.sendMembers(row.id, { type: 'message.updated', message: m.getMessage(parentId) });
    res.status(201).json({ message });
  });

  // Zwraca wiersz wiadomości, do której użytkownik ma dostęp (członek kanału).
  function accessibleMessage(req) {
    const msg = m.getMessageRow(parseId(req.params.id));
    if (!msg) throw notFound('Wiadomość nie istnieje');
    if (!m.getMember(msg.channel_id, req.me)) throw forbidden('Nie jesteś członkiem tego kanału');
    return msg;
  }

  api.get('/messages/:id/thread', (req, res) => {
    const msg = accessibleMessage(req);
    if (msg.parent_id !== null) throw bad('To jest odpowiedź, nie wiadomość nadrzędna');
    const replies = m.all('SELECT * FROM messages WHERE parent_id = ? ORDER BY id', msg.id);
    res.json({ parent: m.messageOut(msg), replies: replies.map(m.messageOut) });
  });

  function emitUpdated(msg) {
    rt.sendMembers(msg.channel_id, { type: 'message.updated', message: m.getMessage(msg.id) });
    if (msg.parent_id) rt.sendMembers(msg.channel_id, { type: 'message.updated', message: m.getMessage(msg.parent_id) });
  }

  api.patch('/messages/:id', (req, res) => {
    const msg = accessibleMessage(req);
    if (msg.user_id !== req.me) throw forbidden('Możesz edytować tylko własne wiadomości');
    if (msg.deleted) throw notFound('Wiadomość została usunięta');
    const text = validText((req.body || {}).text, !!msg.file_id);
    if (!text && !msg.file_id) throw bad('Wiadomość nie może być pusta');
    m.run('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?', text, now(), msg.id);
    emitUpdated(msg);
    res.json({ message: m.getMessage(msg.id) });
  });

  api.delete('/messages/:id', (req, res) => {
    const msg = accessibleMessage(req);
    if (msg.user_id !== req.me) throw forbidden('Możesz usuwać tylko własne wiadomości');
    if (!msg.deleted) {
      m.run('UPDATE messages SET deleted = 1 WHERE id = ?', msg.id);
      if (msg.file_id) {
        const other = m.get('SELECT 1 FROM messages WHERE file_id = ? AND id != ? AND deleted = 0', msg.file_id, msg.id);
        if (!other) removeFile(msg.file_id);
      }
      emitUpdated(msg);
    }
    res.json({ ok: true });
  });

  api.post('/messages/:id/reactions', (req, res) => {
    const msg = accessibleMessage(req);
    if (msg.deleted) throw notFound('Wiadomość została usunięta');
    const emoji = str((req.body || {}).emoji);
    if (emoji === null || Array.from(emoji).length < 1 || emoji.length > 16) throw bad('Emoji: 1–16 znaków');
    const del = m.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', msg.id, req.me, emoji);
    if (del.changes === 0) {
      m.run('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', msg.id, req.me, emoji, now());
    }
    rt.sendMembers(msg.channel_id, { type: 'message.updated', message: m.getMessage(msg.id) });
    res.json({ message: m.getMessage(msg.id) });
  });

  api.post('/channels/:id/read', (req, res) => {
    const row = memberChannel(req);
    const mid = (req.body || {}).messageId;
    if (!Number.isInteger(mid) || mid < 0) throw bad('Nieprawidłowy messageId');
    const top = m.get('SELECT COALESCE(MAX(id), 0) AS mx FROM messages WHERE channel_id = ?', row.id).mx;
    m.run(`UPDATE channel_members SET last_read_message_id = MAX(last_read_message_id, ?)
           WHERE channel_id = ? AND user_id = ?`, Math.min(mid, top), row.id, req.me);
    res.json({ ok: true });
  });

  api.get('/search', (req, res) => {
    const q = str(req.query.q);
    if (q === null || q.trim().length < 2) throw bad('Zapytanie musi mieć co najmniej 2 znaki');
    const pattern = '%' + q.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const rows = m.all(
      `SELECT msg.*, c.name AS channel_name FROM messages msg
       JOIN channels c ON c.id = msg.channel_id
       JOIN channel_members cm ON cm.channel_id = msg.channel_id AND cm.user_id = ?
       WHERE msg.deleted = 0 AND lower_u(msg.text) LIKE lower_u(?) ESCAPE '\\'
       ORDER BY msg.id DESC LIMIT 50`, req.me, pattern);
    res.json({ results: rows.map((r) => ({ ...m.messageOut(r), channelName: r.channel_name })) });
  });

  // ---------- Pliki ----------
  const totalBytes = () => m.get('SELECT COALESCE(SUM(size), 0) AS s FROM files').s;
  const uploading = new Map(); // userId -> liczba trwających uploadów
  // Wykonywane PO uwierzytelnieniu, a PRZED parsowaniem body.
  function uploadGuard(req, res, next) {
    const raw = req.headers['content-length'];
    if (raw === undefined) return next(new HttpError(411, 'Wymagany nagłówek Content-Length'));
    const cl = Number(raw);
    if (!Number.isFinite(cl) || cl < 0) return next(bad('Nieprawidłowy Content-Length'));
    const approx = Math.max(0, cl - 1024) * 3 / 4; // minus narzut JSON (nazwa, mime)
    if (approx > MAX_FILE + 4096) return next(new HttpError(413, 'Plik jest za duży (maks. 5 MB)'));
    if (usedBytes(req.me) + approx > uploadQuotaBytes)
      return next(new HttpError(413, 'Przekroczono limit miejsca na pliki'));
    if (totalBytes() + approx > uploadsTotalBytes) return next(new HttpError(507, 'Brak miejsca na serwerze'));
    const n = uploading.get(req.me) || 0;
    if (n >= 2) return next(new HttpError(429, 'Poczekaj na zakończenie poprzedniego przesyłania'));
    uploading.set(req.me, n + 1);
    res.on('close', () => {
      const c = (uploading.get(req.me) || 1) - 1;
      if (c <= 0) uploading.delete(req.me); else uploading.set(req.me, c);
    });
    next();
  }

  api.post('/files', uploadGuard, express.json({ limit: '8mb' }), async (req, res, next) => {
   let id = null;
   try {
    const b = req.body || {};
    const name = str(b.name);
    const data = str(b.dataBase64);
    if (!name || !name.trim()) throw bad('Nazwa pliku jest wymagana');
    if (!data) throw bad('Brak danych pliku');
    const cleanName = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'plik';
    let mime = (str(b.mime) || '').trim().toLowerCase();
    if (!MIME_RE.test(mime) || mime.length > 100) mime = 'application/octet-stream';
    if (Math.floor((data.length * 3) / 4) > MAX_FILE + 3) throw new HttpError(413, 'Plik jest za duży (maks. 5 MB)');
    const buf = Buffer.from(data, 'base64');
    if (buf.length === 0) throw bad('Plik jest pusty');
    if (buf.length > MAX_FILE) throw new HttpError(413, 'Plik jest za duży (maks. 5 MB)');
    if (usedBytes(req.me) + buf.length > uploadQuotaBytes)
      throw new HttpError(413, 'Przekroczono limit miejsca na pliki');
    if (totalBytes() + buf.length > uploadsTotalBytes) throw new HttpError(507, 'Brak miejsca na serwerze');
    id = crypto.randomBytes(16).toString('hex');
    pendingIds.add(id);
    await fsp.mkdir(uploadsDir, { recursive: true });
    await fsp.writeFile(path.join(uploadsDir, id), buf);
    if (usedBytes(req.me) + buf.length > uploadQuotaBytes) {
      await fsp.unlink(path.join(uploadsDir, id)).catch(() => {});
      throw new HttpError(413, 'Przekroczono limit miejsca na pliki');
    }
    if (totalBytes() + buf.length > uploadsTotalBytes) {
      await fsp.unlink(path.join(uploadsDir, id)).catch(() => {});
      throw new HttpError(507, 'Brak miejsca na serwerze');
    }
    m.run('INSERT INTO files (id, name, mime, size, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, cleanName, mime, buf.length, req.me, now());
    pendingIds.delete(id);
    res.status(201).json({ file: m.fileOut(m.get('SELECT * FROM files WHERE id = ?', id)) });
   } catch (e) {
     if (id) {
       pendingIds.delete(id);
       if (!m.get('SELECT 1 FROM files WHERE id = ?', id)) await fsp.unlink(path.join(uploadsDir, id)).catch(() => {});
     }
     next(e);
   }
  });

  api.use((req, res, next) => next(notFound('Nie znaleziono zasobu')));

  // Publiczne serwowanie plików
  function serveFile(req, res, next) {
    const id = req.params.id;
    if (!/^[a-f0-9]{32}$/.test(id)) return next(notFound());
    const f = m.get('SELECT * FROM files WHERE id = ?', id);
    if (!f) return next(notFound());
    const inline = f.mime.startsWith('image/');
    res.sendFile(path.resolve(uploadsDir, id), {
      dotfiles: 'allow',
      cacheControl: false,
      headers: {
        'Content-Type': f.mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'Content-Disposition':
          `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name).replace(/['()*]/g, escape)}`,
      },
    }, (err) => { if (err && !res.headersSent) next(notFound()); });
  }

  return { api, serveFile };
}

module.exports = { createRouter, HttpError };
