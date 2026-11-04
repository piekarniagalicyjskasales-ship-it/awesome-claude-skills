'use strict';
const { WebSocketServer } = require('ws');
const crypto = require('node:crypto');

const TICKET_TTL_MS = 30000;

function createRealtime({ server, m }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const conns = new Map(); // userId -> Set<ws>
  const tickets = new Map(); // ticket -> { userId, tokenHash, expiresAt }
  const typingSeen = new Map(); // "user:channel:parent" -> timestamp ostatniego eventu

  // Heartbeat: co 30 s ping; socket bez pong od poprzedniego cyklu jest zamykany.
  const heartbeat = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of tickets) if (v.expiresAt < t) tickets.delete(k);
    for (const set of conns.values()) {
      for (const ws of set) {
        const s = m.get('SELECT expires_at FROM sessions WHERE token_hash = ?', ws.tokenHash);
        if (!s || s.expires_at < t) { ws.close(4001, 'Sesja wygasła'); continue; }
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* socket już zamknięty */ }
      }
    }
  }, 30000);
  heartbeat.unref();

  const isOnline = (userId) => (conns.get(userId)?.size || 0) > 0;

  function sendWs(ws, payload) {
    if (ws.readyState === 1) ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }
  function sendUser(userId, payload) {
    const set = conns.get(userId);
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const ws of set) sendWs(ws, data);
  }
  function sendAll(payload) {
    const data = JSON.stringify(payload);
    for (const set of conns.values()) for (const ws of set) sendWs(ws, data);
  }
  function sendMembers(channelId, payload, exceptUserId) {
    for (const uid of m.memberIds(channelId)) if (uid !== exceptUserId) sendUser(uid, payload);
  }
  // Event z obiektem Channel liczonym z perspektywy każdego odbiorcy.
  function sendChannelEvent(type, channelRow, userIds) {
    for (const uid of userIds) {
      if (conns.has(uid)) sendUser(uid, { type, channel: m.channelOut(channelRow, uid) });
    }
  }
  function sendChannelToMembers(type, channelId) {
    const row = m.getChannelRow(channelId);
    if (row) sendChannelEvent(type, row, m.memberIds(channelId));
  }
  function sendChannelToAll(type, channelId) {
    const row = m.getChannelRow(channelId);
    if (row) sendChannelEvent(type, row, [...conns.keys()]);
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const ticket = url.searchParams.get('ticket') || '';
    const info = /^[a-f0-9]{64}$/.test(ticket) ? tickets.get(ticket) : null;
    if (info) tickets.delete(ticket); // jednorazowy
    wss.handleUpgrade(req, socket, head, (ws) => {
      const row = info && info.expiresAt >= Date.now()
        ? m.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ? AND s.user_id = ? AND s.expires_at >= ?`, info.tokenHash, info.userId, Date.now())
        : null;
      if (!row) { ws.close(4001, 'Brak autoryzacji'); return; }
      onConnection(ws, row, info.tokenHash);
    });
  });

  function createTicket(userId, tokenHash) {
    const t = Date.now();
    for (const [k, v] of tickets) if (v.expiresAt < t) tickets.delete(k);
    const ticket = crypto.randomBytes(32).toString('hex');
    tickets.set(ticket, { userId, tokenHash, expiresAt: t + TICKET_TTL_MS });
    return ticket;
  }
  function dropSession(tokenHash) {
    for (const set of conns.values()) {
      for (const ws of set) if (ws.tokenHash === tokenHash) ws.close(4001, 'Wylogowano');
    }
    for (const [k, v] of tickets) if (v.tokenHash === tokenHash) tickets.delete(k);
  }
  function dropUser(userId) {
    for (const ws of conns.get(userId) || []) ws.close(4001, 'Wylogowano');
    for (const [k, v] of tickets) if (v.userId === userId) tickets.delete(k);
  }

  function onConnection(ws, userRow, tokenHash) {
    const uid = userRow.id;
    ws.tokenHash = tokenHash;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    let set = conns.get(uid);
    const first = !set || set.size === 0;
    if (!set) { set = new Set(); conns.set(uid, set); }
    set.add(ws);
    sendWs(ws, { type: 'hello', user: m.getUser(uid) });
    if (first) sendAll({ type: 'presence', userId: uid, online: true });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ping') sendWs(ws, { type: 'pong' });
      else if (msg.type === 'typing') {
        const channelId = Number(msg.channelId);
        if (!Number.isInteger(channelId) || !m.getMember(channelId, uid)) return;
        const parentId = Number.isInteger(msg.parentId) ? msg.parentId : null;
        const key = `${uid}:${channelId}:${parentId}`;
        const t = Date.now();
        if (t - (typingSeen.get(key) || 0) < 1000) return;
        if (typingSeen.size > 5000) for (const [k, v] of typingSeen) if (t - v > 1000) typingSeen.delete(k);
        typingSeen.set(key, t);
        sendMembers(channelId, { type: 'typing', channelId, parentId, user: m.getUser(uid) }, uid);
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) {
        conns.delete(uid);
        sendAll({ type: 'presence', userId: uid, online: false });
      }
    });
  }

  function close() {
    clearInterval(heartbeat);
    for (const set of conns.values()) for (const ws of set) ws.terminate();
    return new Promise((resolve) => wss.close(() => resolve()));
  }

  return { isOnline, sendUser, sendAll, sendMembers, sendChannelToMembers, sendChannelToAll, sendChannelEvent, createTicket, dropSession, dropUser, close };
}

module.exports = { createRealtime };
