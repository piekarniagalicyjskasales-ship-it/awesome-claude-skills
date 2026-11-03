'use strict';
const { WebSocketServer } = require('ws');

function createRealtime({ server, m }) {
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Map(); // userId -> Set<ws>

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
    const token = url.searchParams.get('token') || '';
    wss.handleUpgrade(req, socket, head, (ws) => {
      const row = /^[a-f0-9]{64}$/.test(token)
        ? m.get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', token)
        : null;
      if (!row) { ws.close(4001, 'Brak autoryzacji'); return; }
      onConnection(ws, row);
    });
  });

  function onConnection(ws, userRow) {
    const uid = userRow.id;
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
    for (const set of conns.values()) for (const ws of set) ws.terminate();
    return new Promise((resolve) => wss.close(() => resolve()));
  }

  return { isOnline, sendUser, sendAll, sendMembers, sendChannelToMembers, sendChannelToAll, sendChannelEvent, close };
}

module.exports = { createRealtime };
