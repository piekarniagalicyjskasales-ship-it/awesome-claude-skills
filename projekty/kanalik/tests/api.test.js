'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

let server;
let base;
let tmpDir;
let counter = 0;

before(async () => {
  const { start } = require('../src/app');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanalik-'));
  server = await start({
    port: 0,
    dbPath: path.join(tmpDir, 'test.db'),
    uploadsDir: path.join(tmpDir, 'uploads'),
    seed: false,
  });
  base = `http://127.0.0.1:${server.port}`;
});

after(async () => {
  if (server) await server.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- helpers ----------
async function api(method, p, body, token, baseUrl = base) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(baseUrl + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function uniq(prefix) {
  counter += 1;
  return `${prefix}${counter}${Math.random().toString(36).slice(2, 6)}`.toLowerCase().slice(0, 20);
}

async function register(name) {
  const username = uniq(name || 'u');
  const r = await api('POST', '/api/auth/register', { username, password: 'haslo123' });
  assert.equal(r.status, 201, 'register failed: ' + JSON.stringify(r.body));
  return { username, token: r.body.token, user: r.body.user, id: r.body.user.id };
}

async function createChannel(token, opts = {}) {
  const name = opts.name || uniq('ch');
  const r = await api('POST', '/api/channels', { name, topic: opts.topic, isPrivate: !!opts.isPrivate }, token);
  assert.equal(r.status, 201, 'createChannel failed: ' + JSON.stringify(r.body));
  return r.body.channel;
}

async function send(token, channelId, text, extra = {}) {
  const r = await api('POST', `/api/channels/${channelId}/messages`, { text, ...extra }, token);
  assert.equal(r.status, 201, 'send failed: ' + JSON.stringify(r.body));
  return r.body.message;
}

async function getTicket(token, baseUrl = base) {
  const r = await api('POST', '/api/ws-ticket', undefined, token, baseUrl);
  assert.equal(r.status, 200, 'ws-ticket failed: ' + JSON.stringify(r.body));
  return r.body.ticket;
}

async function connectWs(token) {
  const ticket = await getTicket(token);
  return connectWsTicket(ticket);
}

function connectWsTicket(ticket, baseUrl = base) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`);
    const buffer = [];
    const waiters = [];
    let closeInfo = null;
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      buffer.push(msg);
      for (const w of [...waiters]) {
        if (w.predicate(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(msg);
        }
      }
    });
    ws.on('close', (code) => { closeInfo = { code }; });
    const client = {
      ws,
      buffer,
      waitFor(predicate, timeoutMs = 2000) {
        const found = buffer.find(predicate);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const w = { predicate, resolve: res };
          w.timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(w), 1);
            rej(new Error('waitFor timeout; received: ' + JSON.stringify(buffer.map((m) => m.type))));
          }, timeoutMs);
          waiters.push(w);
        });
      },
      async expectNone(predicate, ms = 400) {
        await new Promise((r) => setTimeout(r, ms));
        const hit = buffer.find(predicate);
        assert.equal(hit, undefined, 'unexpected event: ' + JSON.stringify(hit));
      },
      send(obj) { ws.send(JSON.stringify(obj)); },
      close() {
        return new Promise((res) => {
          if (closeInfo || ws.readyState === WebSocket.CLOSED) return res();
          ws.once('close', () => res());
          ws.close();
        });
      },
    };
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

// otwiera /ws z dowolnym query string i zwraca kod zamknięcia
function waitForCloseQuery(query, baseUrl = base) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws${query}`);
    const timer = setTimeout(() => reject(new Error('close timeout')), 3000);
    ws.on('close', (code) => { clearTimeout(timer); resolve(code); });
    ws.on('error', () => {});
  });
}

// osobna instancja serwera (własne tmp), zwraca {srv, url, dir, dbPath, api, close}
async function startInstance(opts = {}) {
  const { start } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanalik-r2-'));
  const dbPath = path.join(dir, 'test.db');
  const srv = await start({
    port: 0,
    dbPath,
    uploadsDir: path.join(dir, 'uploads'),
    seed: false,
    ...opts,
  });
  const url = `http://127.0.0.1:${srv.port}`;
  let closed = false;
  return {
    srv, url, dir, dbPath,
    api: (method, p, body, token) => api(method, p, body, token, url),
    async register(name) {
      const username = uniq(name || 'u');
      const r = await api('POST', '/api/auth/register', { username, password: 'haslo123' }, undefined, url);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return { username, token: r.body.token, user: r.body.user, id: r.body.user.id };
    },
    async close() {
      if (closed) return;
      closed = true;
      await srv.close();
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// ---------- 1. Rejestracja ----------
test('rejestracja: 201, token i user', async () => {
  const username = uniq('reg');
  const r = await api('POST', '/api/auth/register', { username, password: 'haslo123', displayName: 'Jan Test' });
  assert.equal(r.status, 201);
  assert.equal(typeof r.body.token, 'string');
  assert.ok(r.body.token.length > 0);
  assert.equal(r.body.user.username, username);
  assert.equal(r.body.user.displayName, 'Jan Test');
  assert.equal(typeof r.body.user.id, 'number');
  assert.match(r.body.user.avatarColor, /^#[0-9a-f]{6}$/i);
  assert.equal(typeof r.body.user.status, 'string');
  assert.equal(typeof r.body.user.online, 'boolean');
});

test('rejestracja: displayName domyślnie = username', async () => {
  const username = uniq('dn');
  const r = await api('POST', '/api/auth/register', { username, password: 'haslo123' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.displayName, username);
});

test('rejestracja: duplikat username -> 409', async () => {
  const u = await register('dup');
  const r = await api('POST', '/api/auth/register', { username: u.username, password: 'haslo123' });
  assert.equal(r.status, 409);
  assert.equal(typeof r.body.error, 'string');
});

test('rejestracja: zły username -> 400', async () => {
  for (const username of ['ab', 'ze spacja', 'a'.repeat(21), 'zly-myslnik', '']) {
    const r = await api('POST', '/api/auth/register', { username, password: 'haslo123' });
    assert.equal(r.status, 400, `username "${username}"`);
    assert.equal(typeof r.body.error, 'string');
  }
});

test('rejestracja: za krótkie hasło -> 400', async () => {
  const r = await api('POST', '/api/auth/register', { username: uniq('pw'), password: '12345' });
  assert.equal(r.status, 400);
});

test('rejestracja: nowy user jest w kanałach domyślnych (ogolny, luzne-rozmowy)', async () => {
  const u = await register('def');
  const r = await api('GET', '/api/channels', undefined, u.token);
  assert.equal(r.status, 200);
  const names = r.body.channels.map((c) => c.name);
  assert.ok(names.includes('ogolny'), 'brak ogolny');
  assert.ok(names.includes('luzne-rozmowy'), 'brak luzne-rozmowy');
});

// ---------- 2. Login / me / logout ----------
test('login: poprawny 200, zły 401', async () => {
  const u = await register('log');
  const ok = await api('POST', '/api/auth/login', { username: u.username, password: 'haslo123' });
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.body.token, 'string');
  assert.equal(ok.body.user.id, u.id);
  const bad = await api('POST', '/api/auth/login', { username: u.username, password: 'zlehaslo' });
  assert.equal(bad.status, 401);
  assert.equal(typeof bad.body.error, 'string');
  const nouser = await api('POST', '/api/auth/login', { username: 'nieistnieje_xyz', password: 'haslo123' });
  assert.equal(nouser.status, 401);
});

test('/api/me: bez tokenu 401, zły token 401, z tokenem 200', async () => {
  const u = await register('me');
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('GET', '/api/me', undefined, 'zlytoken')).status, 401);
  const r = await api('GET', '/api/me', undefined, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, u.id);
});

test('logout unieważnia token', async () => {
  const u = await register('out');
  const r = await api('POST', '/api/auth/logout', undefined, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal((await api('GET', '/api/me', undefined, u.token)).status, 401);
});

test('PATCH /api/me aktualizuje displayName i status; GET /api/users zawiera usera', async () => {
  const u = await register('pat');
  const r = await api('PATCH', '/api/me', { displayName: 'Nowe Imie', status: 'na urlopie' }, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.displayName, 'Nowe Imie');
  assert.equal(r.body.user.status, 'na urlopie');
  const list = await api('GET', '/api/users', undefined, u.token);
  assert.equal(list.status, 200);
  assert.ok(list.body.users.some((x) => x.id === u.id && x.displayName === 'Nowe Imie'));
  const tooLong = await api('PATCH', '/api/me', { status: 'x'.repeat(101) }, u.token);
  assert.equal(tooLong.status, 400);
});

// ---------- 3. Kanały ----------
test('kanał: tworzenie 201, zła nazwa 400, duplikat 409', async () => {
  const a = await register('cha');
  const name = uniq('kan');
  const r = await api('POST', '/api/channels', { name, topic: 'temat' }, a.token);
  assert.equal(r.status, 201);
  const c = r.body.channel;
  assert.equal(c.name, name);
  assert.equal(c.topic, 'temat');
  assert.equal(c.isPrivate, false);
  assert.equal(c.isDm, false);
  assert.equal(c.dmUser, null);
  assert.equal(c.isMember, true);
  assert.equal(c.memberCount, 1);
  assert.equal(c.unreadCount, 0);
  assert.equal(typeof c.createdAt, 'string');

  for (const bad of ['Zla Nazwa', '-start', '', 'a'.repeat(81), 'UPPER']) {
    const rb = await api('POST', '/api/channels', { name: bad }, a.token);
    assert.equal(rb.status, 400, `name "${bad}"`);
  }
  const dup = await api('POST', '/api/channels', { name }, a.token);
  assert.equal(dup.status, 409);
});

test('kanał: wymaga autoryzacji', async () => {
  const r = await api('POST', '/api/channels', { name: uniq('noauth') });
  assert.equal(r.status, 401);
});

test('kanał publiczny: browse z isMember:false, join, widoczny w /api/channels', async () => {
  const a = await register('bra');
  const b = await register('brb');
  const c = await createChannel(a.token);

  const browse = await api('GET', '/api/channels/browse', undefined, b.token);
  assert.equal(browse.status, 200);
  const seen = browse.body.channels.find((x) => x.id === c.id);
  assert.ok(seen, 'kanał publiczny powinien być w browse');
  assert.equal(seen.isMember, false);

  const mine0 = await api('GET', '/api/channels', undefined, b.token);
  assert.ok(!mine0.body.channels.some((x) => x.id === c.id));

  const join = await api('POST', `/api/channels/${c.id}/join`, undefined, b.token);
  assert.equal(join.status, 200);
  assert.equal(join.body.channel.id, c.id);
  assert.equal(join.body.channel.isMember, true);
  assert.equal(join.body.channel.memberCount, 2);

  const mine = await api('GET', '/api/channels', undefined, b.token);
  assert.ok(mine.body.channels.some((x) => x.id === c.id));
});

test('kanał: leave, PATCH topic (tylko członek), members', async () => {
  const a = await register('lva');
  const b = await register('lvb');
  const c = await createChannel(a.token);
  await api('POST', `/api/channels/${c.id}/join`, undefined, b.token);

  const upd = await api('PATCH', `/api/channels/${c.id}`, { topic: 'nowy temat' }, b.token);
  assert.equal(upd.status, 200);
  assert.equal(upd.body.channel.topic, 'nowy temat');

  const long = await api('PATCH', `/api/channels/${c.id}`, { topic: 'x'.repeat(251) }, a.token);
  assert.equal(long.status, 400);

  const members = await api('GET', `/api/channels/${c.id}/members`, undefined, a.token);
  assert.equal(members.status, 200);
  assert.deepEqual(members.body.users.map((u) => u.id).sort(), [a.id, b.id].sort());

  const leave = await api('POST', `/api/channels/${c.id}/leave`, undefined, b.token);
  assert.equal(leave.status, 200);
  assert.equal(leave.body.ok, true);
  const mine = await api('GET', '/api/channels', undefined, b.token);
  assert.ok(!mine.body.channels.some((x) => x.id === c.id));

  const outsiderPatch = await api('PATCH', `/api/channels/${c.id}`, { topic: 'hak' }, b.token);
  assert.equal(outsiderPatch.status, 403);
});

test('GET /api/channels: nie-DM po name, potem DM', async () => {
  const a = await register('srt');
  const b = await register('srtb');
  await createChannel(a.token, { name: 'zzz' + uniq('s') });
  await api('POST', '/api/dms', { userId: b.id }, a.token);
  const r = await api('GET', '/api/channels', undefined, a.token);
  const list = r.body.channels;
  const firstDm = list.findIndex((c) => c.isDm);
  assert.ok(firstDm > 0);
  assert.ok(list.slice(firstDm).every((c) => c.isDm), 'DM-y muszą być na końcu');
  const nonDm = list.slice(0, firstDm).map((c) => c.name);
  assert.deepEqual(nonDm, [...nonDm].sort());
});

// ---------- 4. Kanał prywatny ----------
test('kanał prywatny: niewidoczny w browse, join 403, messages 403; po dodaniu członka dostęp', async () => {
  const a = await register('pra');
  const b = await register('prb');
  const c = await createChannel(a.token, { isPrivate: true });
  assert.equal(c.isPrivate, true);
  await send(a.token, c.id, 'tajne');

  const browse = await api('GET', '/api/channels/browse', undefined, b.token);
  assert.ok(!browse.body.channels.some((x) => x.id === c.id), 'prywatny nie może być w browse');

  const join = await api('POST', `/api/channels/${c.id}/join`, undefined, b.token);
  assert.equal(join.status, 403);

  const msgs = await api('GET', `/api/channels/${c.id}/messages`, undefined, b.token);
  assert.equal(msgs.status, 403);
  const post = await api('POST', `/api/channels/${c.id}/messages`, { text: 'wlam' }, b.token);
  assert.equal(post.status, 403);

  const add = await api('POST', `/api/channels/${c.id}/members`, { userId: b.id }, a.token);
  assert.equal(add.status, 200);
  assert.equal(add.body.ok, true);

  const msgs2 = await api('GET', `/api/channels/${c.id}/messages`, undefined, b.token);
  assert.equal(msgs2.status, 200);
  assert.equal(msgs2.body.messages.length, 1);
  assert.equal(msgs2.body.messages[0].text, 'tajne');
  const mine = await api('GET', '/api/channels', undefined, b.token);
  assert.ok(mine.body.channels.some((x) => x.id === c.id));
});

test('członkowie: nie-członek nie może dodawać, nie dla DM', async () => {
  const a = await register('mma');
  const b = await register('mmb');
  const c = await register('mmc');
  const ch = await createChannel(a.token);
  const r = await api('POST', `/api/channels/${ch.id}/members`, { userId: c.id }, b.token);
  assert.equal(r.status, 403);

  const dm = (await api('POST', '/api/dms', { userId: b.id }, a.token)).body.channel;
  const r2 = await api('POST', `/api/channels/${dm.id}/members`, { userId: c.id }, a.token);
  assert.ok([400, 403].includes(r2.status), 'dodanie do DM musi być odrzucone, było ' + r2.status);
});

// ---------- 5. Wiadomości ----------
test('wiadomości: wysłanie i pobranie rosnąco', async () => {
  const a = await register('msa');
  const ch = await createChannel(a.token);
  const m1 = await send(a.token, ch.id, 'pierwsza');
  const m2 = await send(a.token, ch.id, 'druga');
  const m3 = await send(a.token, ch.id, 'trzecia');
  assert.equal(m1.text, 'pierwsza');
  assert.equal(m1.channelId, ch.id);
  assert.equal(m1.user.id, a.id);
  assert.equal(m1.parentId, null);
  assert.equal(m1.editedAt, null);
  assert.equal(m1.deleted, false);
  assert.deepEqual(m1.reactions, []);
  assert.equal(m1.replyCount, 0);
  assert.equal(m1.lastReplyAt, null);
  assert.equal(m1.file, null);
  assert.equal(typeof m1.createdAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(m1.createdAt)));

  const r = await api('GET', `/api/channels/${ch.id}/messages`, undefined, a.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.messages.map((m) => m.id), [m1.id, m2.id, m3.id]);
});

test('wiadomości: paginacja before/limit', async () => {
  const a = await register('pga');
  const ch = await createChannel(a.token);
  const ids = [];
  for (let i = 1; i <= 7; i++) ids.push((await send(a.token, ch.id, 'm' + i)).id);

  const p1 = await api('GET', `/api/channels/${ch.id}/messages?limit=3`, undefined, a.token);
  assert.equal(p1.status, 200);
  assert.deepEqual(p1.body.messages.map((m) => m.id), ids.slice(4, 7), 'ostatnie 3 rosnąco');

  const p2 = await api('GET', `/api/channels/${ch.id}/messages?limit=3&before=${ids[4]}`, undefined, a.token);
  assert.deepEqual(p2.body.messages.map((m) => m.id), ids.slice(1, 4));

  const p3 = await api('GET', `/api/channels/${ch.id}/messages?limit=3&before=${ids[1]}`, undefined, a.token);
  assert.deepEqual(p3.body.messages.map((m) => m.id), ids.slice(0, 1));

  const all = await api('GET', `/api/channels/${ch.id}/messages`, undefined, a.token);
  assert.equal(all.body.messages.length, 7);
});

test('wiadomości: pusty tekst 400, same spacje 400, >4000 znaków 400, nie-członek 403', async () => {
  const a = await register('mva');
  const b = await register('mvb');
  const ch = await createChannel(a.token);
  for (const text of ['', '   ', 'x'.repeat(4001)]) {
    const r = await api('POST', `/api/channels/${ch.id}/messages`, { text }, a.token);
    assert.equal(r.status, 400, `text len ${text.length}`);
  }
  const noText = await api('POST', `/api/channels/${ch.id}/messages`, {}, a.token);
  assert.equal(noText.status, 400);
  const edge = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'x'.repeat(4000) }, a.token);
  assert.equal(edge.status, 201);

  const nm = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'hej' }, b.token);
  assert.equal(nm.status, 403);
  const nmGet = await api('GET', `/api/channels/${ch.id}/messages`, undefined, b.token);
  // kanał publiczny: odczyt przez nie-członka nie jest zdefiniowany w kontrakcie jako dozwolony (403)
  assert.equal(nmGet.status, 403);
});

test('wiadomości: nieistniejący kanał -> 404', async () => {
  const a = await register('nfa');
  const r = await api('GET', '/api/channels/99999999/messages', undefined, a.token);
  assert.equal(r.status, 404);
});

// ---------- 6. Edycja, usuwanie, reakcje ----------
test('edycja: autor ok z editedAt, inny 403', async () => {
  const a = await register('eda');
  const b = await register('edb');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const m = await send(a.token, ch.id, 'stary');

  const ok = await api('PATCH', `/api/messages/${m.id}`, { text: 'nowy' }, a.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.message.text, 'nowy');
  assert.equal(typeof ok.body.message.editedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(ok.body.message.editedAt)));

  const other = await api('PATCH', `/api/messages/${m.id}`, { text: 'hak' }, b.token);
  assert.equal(other.status, 403);

  const empty = await api('PATCH', `/api/messages/${m.id}`, { text: '  ' }, a.token);
  assert.equal(empty.status, 400);

  const list = await api('GET', `/api/channels/${ch.id}/messages`, undefined, b.token);
  assert.equal(list.body.messages[0].text, 'nowy');
});

test('usuwanie: soft delete (deleted true, text ""), inny 403', async () => {
  const a = await register('dla');
  const b = await register('dlb');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const m = await send(a.token, ch.id, 'do usuniecia');

  const other = await api('DELETE', `/api/messages/${m.id}`, undefined, b.token);
  assert.equal(other.status, 403);

  const del = await api('DELETE', `/api/messages/${m.id}`, undefined, a.token);
  assert.equal(del.status, 200);
  assert.equal(del.body.ok, true);

  const list = await api('GET', `/api/channels/${ch.id}/messages`, undefined, a.token);
  const got = list.body.messages.find((x) => x.id === m.id);
  assert.ok(got, 'usunięta wiadomość pozostaje w liście (soft delete)');
  assert.equal(got.deleted, true);
  assert.equal(got.text, '');
  assert.equal(got.file, null);
  assert.deepEqual(got.reactions, []);
});

test('reakcje: toggle (count 1 -> 0)', async () => {
  const a = await register('rea');
  const b = await register('reb');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const m = await send(a.token, ch.id, 'reaguj');

  const on = await api('POST', `/api/messages/${m.id}/reactions`, { emoji: '👍' }, a.token);
  assert.equal(on.status, 200);
  assert.equal(on.body.message.reactions.length, 1);
  assert.equal(on.body.message.reactions[0].emoji, '👍');
  assert.equal(on.body.message.reactions[0].count, 1);
  assert.deepEqual(on.body.message.reactions[0].userIds, [a.id]);

  const second = await api('POST', `/api/messages/${m.id}/reactions`, { emoji: '👍' }, b.token);
  assert.equal(second.body.message.reactions[0].count, 2);

  const off1 = await api('POST', `/api/messages/${m.id}/reactions`, { emoji: '👍' }, a.token);
  assert.equal(off1.body.message.reactions[0].count, 1);
  assert.deepEqual(off1.body.message.reactions[0].userIds, [b.id]);

  const off2 = await api('POST', `/api/messages/${m.id}/reactions`, { emoji: '👍' }, b.token);
  assert.equal(off2.status, 200);
  const r = off2.body.message.reactions.find((x) => x.emoji === '👍');
  assert.ok(!r || r.count === 0, 'reakcja powinna zniknąć lub mieć count 0');

  const bad = await api('POST', `/api/messages/${m.id}/reactions`, { emoji: '' }, a.token);
  assert.equal(bad.status, 400);
  const bad2 = await api('POST', `/api/messages/${m.id}/reactions`, { emoji: 'x'.repeat(17) }, a.token);
  assert.equal(bad2.status, 400);
});

// ---------- 7. Wątki ----------
test('wątki: odpowiedź z parentId, poza listą kanału, /thread, replyCount, zagnieżdżenie 400', async () => {
  const a = await register('tha');
  const ch = await createChannel(a.token);
  const parent = await send(a.token, ch.id, 'rodzic');
  const reply = await send(a.token, ch.id, 'odpowiedz', { parentId: parent.id });
  assert.equal(reply.parentId, parent.id);

  const list = await api('GET', `/api/channels/${ch.id}/messages`, undefined, a.token);
  assert.deepEqual(list.body.messages.map((m) => m.id), [parent.id], 'odpowiedź nie może być w liście kanału');
  assert.equal(list.body.messages[0].replyCount, 1);
  assert.equal(typeof list.body.messages[0].lastReplyAt, 'string');

  const th = await api('GET', `/api/messages/${parent.id}/thread`, undefined, a.token);
  assert.equal(th.status, 200);
  assert.equal(th.body.parent.id, parent.id);
  assert.equal(th.body.parent.replyCount, 1);
  assert.equal(th.body.replies.length, 1);
  assert.equal(th.body.replies[0].id, reply.id);
  assert.equal(th.body.replies[0].text, 'odpowiedz');

  const reply2 = await send(a.token, ch.id, 'druga', { parentId: parent.id });
  const th2 = await api('GET', `/api/messages/${parent.id}/thread`, undefined, a.token);
  assert.deepEqual(th2.body.replies.map((m) => m.id), [reply.id, reply2.id]);

  const nested = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'zagniezdzona', parentId: reply.id }, a.token);
  assert.equal(nested.status, 400);
});

test('wątki: parentId z innego kanału -> 400', async () => {
  const a = await register('thb');
  const ch1 = await createChannel(a.token);
  const ch2 = await createChannel(a.token);
  const parent = await send(a.token, ch1.id, 'rodzic');
  const r = await api('POST', `/api/channels/${ch2.id}/messages`, { text: 'obca', parentId: parent.id }, a.token);
  assert.equal(r.status, 400);
});

test('wątki: /thread dla nie-członka prywatnego kanału -> 403', async () => {
  const a = await register('thc');
  const b = await register('thd');
  const ch = await createChannel(a.token, { isPrivate: true });
  const parent = await send(a.token, ch.id, 'rodzic');
  const r = await api('GET', `/api/messages/${parent.id}/thread`, undefined, b.token);
  assert.equal(r.status, 403);
});

// ---------- 8. DM ----------
test('DM: ten sam id przy dwóch wywołaniach, isDm, dmUser, osoba trzecia 403', async () => {
  const a = await register('dma');
  const b = await register('dmb');
  const c = await register('dmc');

  const r1 = await api('POST', '/api/dms', { userId: b.id }, a.token);
  assert.ok([200, 201].includes(r1.status));
  const r2 = await api('POST', '/api/dms', { userId: b.id }, a.token);
  assert.equal(r2.body.channel.id, r1.body.channel.id);
  const r3 = await api('POST', '/api/dms', { userId: a.id }, b.token);
  assert.equal(r3.body.channel.id, r1.body.channel.id, 'DM jest symetryczny');

  const ch = r1.body.channel;
  assert.equal(ch.isDm, true);
  assert.equal(ch.isPrivate, true);
  assert.equal(ch.dmUser.id, b.id);
  assert.equal(r3.body.channel.dmUser.id, a.id);
  const lo = Math.min(a.id, b.id);
  const hi = Math.max(a.id, b.id);
  assert.equal(ch.name, `dm-${lo}-${hi}`);

  const m = await send(a.token, ch.id, 'prywatnie');
  const seenByB = await api('GET', `/api/channels/${ch.id}/messages`, undefined, b.token);
  assert.equal(seenByB.status, 200);
  assert.equal(seenByB.body.messages[0].id, m.id);

  const third = await api('GET', `/api/channels/${ch.id}/messages`, undefined, c.token);
  assert.equal(third.status, 403);
  const thirdPost = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'x' }, c.token);
  assert.equal(thirdPost.status, 403);
  const thirdJoin = await api('POST', `/api/channels/${ch.id}/join`, undefined, c.token);
  assert.equal(thirdJoin.status, 403);

  const leave = await api('POST', `/api/channels/${ch.id}/leave`, undefined, a.token);
  assert.equal(leave.status, 400);

  const browse = await api('GET', '/api/channels/browse', undefined, c.token);
  assert.ok(!browse.body.channels.some((x) => x.id === ch.id));
  const mineB = await api('GET', '/api/channels', undefined, b.token);
  assert.ok(mineB.body.channels.some((x) => x.id === ch.id && x.isDm));
});

test('DM z samym sobą: dmUser = ja', async () => {
  const a = await register('dms');
  const r = await api('POST', '/api/dms', { userId: a.id }, a.token);
  assert.ok([200, 201].includes(r.status));
  assert.equal(r.body.channel.isDm, true);
  assert.equal(r.body.channel.dmUser.id, a.id);
  assert.equal(r.body.channel.name, `dm-${a.id}-${a.id}`);
});

test('DM: nieistniejący użytkownik -> 404 lub 400', async () => {
  const a = await register('dmx');
  const r = await api('POST', '/api/dms', { userId: 99999999 }, a.token);
  assert.ok([400, 404].includes(r.status), 'status ' + r.status);
});

// ---------- 9. Unread ----------
test('unread: licznik, /read zeruje, własne nie liczą się', async () => {
  const a = await register('una');
  const b = await register('unb');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);

  const getCh = async (token) =>
    (await api('GET', '/api/channels', undefined, token)).body.channels.find((c) => c.id === ch.id);

  await send(a.token, ch.id, 'moja wlasna');
  assert.equal((await getCh(a.token)).unreadCount, 0, 'własne wiadomości nie liczą się');

  await send(b.token, ch.id, 'b1');
  const last = await send(b.token, ch.id, 'b2');
  assert.equal((await getCh(a.token)).unreadCount, 2);
  assert.equal((await getCh(b.token)).unreadCount, 0);

  // odpowiedzi w wątku nie liczą się do unread (tylko najwyższy poziom)
  await send(b.token, ch.id, 'odp w watku', { parentId: last.id });
  assert.equal((await getCh(a.token)).unreadCount, 2);

  const rd = await api('POST', `/api/channels/${ch.id}/read`, { messageId: last.id }, a.token);
  assert.equal(rd.status, 200);
  assert.equal(rd.body.ok, true);
  assert.equal((await getCh(a.token)).unreadCount, 0);

  // lastRead = max(obecny, messageId): cofnięcie nic nie zmienia
  await api('POST', `/api/channels/${ch.id}/read`, { messageId: 1 }, a.token);
  assert.equal((await getCh(a.token)).unreadCount, 0);

  await send(b.token, ch.id, 'b3');
  assert.equal((await getCh(a.token)).unreadCount, 1);
});

test('unread: usunięte wiadomości nie liczą się', async () => {
  const a = await register('und');
  const b = await register('une');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const m = await send(b.token, ch.id, 'zniknie');
  await send(b.token, ch.id, 'zostanie');
  await api('DELETE', `/api/messages/${m.id}`, undefined, b.token);
  const c = (await api('GET', '/api/channels', undefined, a.token)).body.channels.find((x) => x.id === ch.id);
  assert.equal(c.unreadCount, 1);
});

// ---------- 10. Search ----------
test('search: fraza bez względu na wielkość liter, tylko kanały członkowskie', async () => {
  const a = await register('sra');
  const b = await register('srb');
  const word = 'Zebra' + Math.random().toString(36).slice(2, 8);
  const pub = await createChannel(a.token);
  const priv = await createChannel(a.token, { isPrivate: true });
  const m1 = await send(a.token, pub.id, `ala ma ${word} w domu`);
  const m2 = await send(a.token, priv.id, `sekret ${word}`);
  await api('POST', `/api/channels/${pub.id}/join`, undefined, b.token);

  const q = encodeURIComponent(word.toLowerCase());
  const ra = await api('GET', `/api/search?q=${q}`, undefined, a.token);
  assert.equal(ra.status, 200);
  const idsA = ra.body.results.map((r) => r.id);
  assert.ok(idsA.includes(m1.id));
  assert.ok(idsA.includes(m2.id));
  assert.ok(idsA.indexOf(m2.id) < idsA.indexOf(m1.id), 'najnowsze pierwsze');
  const hit = ra.body.results.find((r) => r.id === m1.id);
  assert.equal(hit.channelName, pub.name);
  assert.equal(hit.user.id, a.id);

  const rb = await api('GET', `/api/search?q=${encodeURIComponent(word.toUpperCase())}`, undefined, b.token);
  const idsB = rb.body.results.map((r) => r.id);
  assert.ok(idsB.includes(m1.id));
  assert.ok(!idsB.includes(m2.id), 'prywatny kanał nie może wyciec w wyszukiwaniu');
});

test('search: usunięte wiadomości pominięte', async () => {
  const a = await register('srd');
  const ch = await createChannel(a.token);
  const word = 'kasuj' + Math.random().toString(36).slice(2, 8);
  const m = await send(a.token, ch.id, word);
  await api('DELETE', `/api/messages/${m.id}`, undefined, a.token);
  const r = await api('GET', `/api/search?q=${word}`, undefined, a.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 0);
});

test('search: q 1 znak -> 400, brak q -> 400', async () => {
  const a = await register('sre');
  assert.equal((await api('GET', '/api/search?q=a', undefined, a.token)).status, 400);
  assert.equal((await api('GET', '/api/search', undefined, a.token)).status, 400);
});

test('search: % i _ nie działają jak wildcard', async () => {
  const a = await register('srw');
  const ch = await createChannel(a.token);
  await send(a.token, ch.id, 'zwykly tekst bez znakow specjalnych');
  const pct = await api('GET', '/api/search?q=' + encodeURIComponent('%%'), undefined, a.token);
  assert.equal(pct.status, 200);
  assert.equal(pct.body.results.length, 0, '%% nie może pasować do wszystkiego');
  const us = await api('GET', '/api/search?q=' + encodeURIComponent('__'), undefined, a.token);
  assert.equal(us.status, 200);
  assert.equal(us.body.results.length, 0, '__ nie może pasować do wszystkiego');

  const lit = await send(a.token, ch.id, 'rabat 50% dzisiaj');
  const r = await api('GET', '/api/search?q=' + encodeURIComponent('50%'), undefined, a.token);
  assert.ok(r.body.results.some((x) => x.id === lit.id), 'literalne % powinno być znalezione');
});

test('search: max 50 wyników', async () => {
  const a = await register('srm');
  const ch = await createChannel(a.token);
  const word = 'masowy' + Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < 52; i++) await send(a.token, ch.id, `${word} ${i}`);
  const r = await api('GET', `/api/search?q=${word}`, undefined, a.token);
  assert.equal(r.body.results.length, 50);
});

// ---------- 11. Pliki ----------
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('pliki: upload PNG 201, GET zwraca te same bajty i content-type', async () => {
  const a = await register('fla');
  const r = await api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 }, a.token);
  assert.equal(r.status, 201);
  const f = r.body.file;
  assert.equal(f.name, 'p.png');
  assert.equal(f.mime, 'image/png');
  const bytes = Buffer.from(PNG_BASE64, 'base64');
  assert.equal(f.size, bytes.length);
  assert.match(f.id, /^[0-9a-f]{32}$/);
  assert.equal(f.url, '/files/' + f.id);

  const res = await fetch(base + f.url); // bez autoryzacji
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^image\/png/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-disposition') || '', /^inline/);
  const got = Buffer.from(await res.arrayBuffer());
  assert.ok(got.equals(bytes));
});

test('pliki: nie-obraz serwowany jako attachment', async () => {
  const a = await register('flb');
  const data = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  const r = await api('POST', '/api/files', { name: 'x.html', mime: 'text/html', dataBase64: data }, a.token);
  assert.equal(r.status, 201);
  const res = await fetch(base + r.body.file.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /^attachment/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  await res.arrayBuffer();
});

test('pliki: nieistniejący plik -> 404, upload bez tokenu -> 401', async () => {
  const res = await fetch(base + '/files/' + '0'.repeat(32));
  assert.equal(res.status, 404);
  await res.arrayBuffer();
  const r = await api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 });
  assert.equal(r.status, 401);
});

test('pliki: >5 MB -> 413', async () => {
  const a = await register('flc');
  const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1).toString('base64'); // ~6.7 MB base64 < 8 MB limit JSON
  const r = await api('POST', '/api/files', { name: 'big.bin', mime: 'application/octet-stream', dataBase64: big }, a.token);
  assert.equal(r.status, 413);
});

test('pliki: wiadomość z fileId ma file (także z pustym tekstem)', async () => {
  const a = await register('fld');
  const ch = await createChannel(a.token);
  const up = await api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 }, a.token);
  const m = await send(a.token, ch.id, '', { fileId: up.body.file.id });
  assert.ok(m.file);
  assert.equal(m.file.id, up.body.file.id);
  assert.equal(m.file.url, up.body.file.url);
  assert.equal(m.file.mime, 'image/png');
  const list = await api('GET', `/api/channels/${ch.id}/messages`, undefined, a.token);
  assert.equal(list.body.messages[0].file.id, up.body.file.id);

  const m2 = await send(a.token, ch.id, 'z podpisem', { fileId: up.body.file.id });
  assert.equal(m2.text, 'z podpisem');
  assert.ok(m2.file);

  const bad = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'x', fileId: 'f'.repeat(32) }, a.token);
  assert.ok([400, 404].includes(bad.status), 'nieistniejący fileId: ' + bad.status);
});

// ---------- 12. WebSocket ----------
test('ws: zły token -> zamknięcie 4001', async () => {
  const code = await waitForCloseQuery('?ticket=zlybilet');
  assert.equal(code, 4001);
});

test('ws: hello po połączeniu', async () => {
  const a = await register('wha');
  const c = await connectWs(a.token);
  try {
    const hello = await c.waitFor((m) => m.type === 'hello');
    assert.equal(hello.user.id, a.id);
    assert.equal(hello.user.username, a.username);
  } finally { await c.close(); }
});

test('ws: ping -> pong', async () => {
  const a = await register('wpa');
  const c = await connectWs(a.token);
  try {
    c.send({ type: 'ping' });
    await c.waitFor((m) => m.type === 'pong');
  } finally { await c.close(); }
});

test('ws: message.created trafia do członka kanału (także message.updated rodzica)', async () => {
  const a = await register('wma');
  const b = await register('wmb');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const wb = await connectWs(b.token);
  try {
    await wb.waitFor((m) => m.type === 'hello');
    const m = await send(a.token, ch.id, 'na zywo');
    const ev = await wb.waitFor((e) => e.type === 'message.created' && e.message.id === m.id);
    assert.equal(ev.message.text, 'na zywo');
    assert.equal(ev.message.channelId, ch.id);
    assert.equal(ev.message.user.id, a.id);

    const reply = await send(a.token, ch.id, 'odp', { parentId: m.id });
    await wb.waitFor((e) => e.type === 'message.created' && e.message.id === reply.id);
    const upd = await wb.waitFor((e) => e.type === 'message.updated' && e.message.id === m.id && e.message.replyCount === 1);
    assert.equal(typeof upd.message.lastReplyAt, 'string');

    await api('PATCH', `/api/messages/${m.id}`, { text: 'edytowana' }, a.token);
    await wb.waitFor((e) => e.type === 'message.updated' && e.message.id === m.id && e.message.text === 'edytowana');
  } finally { await wb.close(); }
});

test('ws: brak eventów z prywatnego kanału dla nie-członka', async () => {
  const a = await register('wpra');
  const b = await register('wprb');
  const priv = await createChannel(a.token, { isPrivate: true });
  const wb = await connectWs(b.token);
  try {
    await wb.waitFor((m) => m.type === 'hello');
    const m = await send(a.token, priv.id, 'tajemnica');
    await api('PATCH', `/api/messages/${m.id}`, { text: 'tajemnica2' }, a.token);
    await api('POST', `/api/messages/${m.id}/reactions`, { emoji: '🔒' }, a.token);
    await wb.expectNone((e) =>
      (e.message && e.message.channelId === priv.id) ||
      (e.channel && e.channel.id === priv.id) ||
      e.channelId === priv.id);
  } finally { await wb.close(); }
});

test('ws: typing trafia do drugiego członka, nie do nadawcy, nie do obcych', async () => {
  const a = await register('wta');
  const b = await register('wtb');
  const c = await register('wtc');
  const ch = await createChannel(a.token, { isPrivate: true });
  await api('POST', `/api/channels/${ch.id}/members`, { userId: b.id }, a.token);
  const wa = await connectWs(a.token);
  const wb = await connectWs(b.token);
  const wc = await connectWs(c.token);
  try {
    await Promise.all([wa, wb, wc].map((w) => w.waitFor((m) => m.type === 'hello')));
    wa.send({ type: 'typing', channelId: ch.id });
    const ev = await wb.waitFor((m) => m.type === 'typing' && m.channelId === ch.id);
    assert.equal(ev.user.id, a.id);
    assert.ok(ev.parentId === null || ev.parentId === undefined);
    await wa.expectNone((m) => m.type === 'typing', 300);
    await wc.expectNone((m) => m.type === 'typing', 100);

    wa.send({ type: 'typing', channelId: ch.id, parentId: 12345 });
    const ev2 = await wb.waitFor((m) => m.type === 'typing' && m.parentId === 12345);
    assert.equal(ev2.channelId, ch.id);
  } finally { await Promise.all([wa.close(), wb.close(), wc.close()]); }
});

test('ws: presence online:true przy połączeniu i online:false po zamknięciu', async () => {
  const a = await register('wsa');
  const b = await register('wsb');
  const wa = await connectWs(a.token);
  await wa.waitFor((m) => m.type === 'hello');
  const wb = await connectWs(b.token);
  try {
    const on = await wa.waitFor((m) => m.type === 'presence' && m.userId === b.id && m.online === true);
    assert.equal(on.online, true);
    const me = await api('GET', '/api/users', undefined, a.token);
    assert.equal(me.body.users.find((u) => u.id === b.id).online, true);

    await wb.close();
    const off = await wa.waitFor((m) => m.type === 'presence' && m.userId === b.id && m.online === false);
    assert.equal(off.online, false);
    const after = await api('GET', '/api/users', undefined, a.token);
    assert.equal(after.body.users.find((u) => u.id === b.id).online, false);
  } finally { await wa.close(); await wb.close(); }
});

test('ws: presence – offline dopiero po zamknięciu ostatniego połączenia', async () => {
  const a = await register('wda');
  const b = await register('wdb');
  const wa = await connectWs(a.token);
  await wa.waitFor((m) => m.type === 'hello');
  const b1 = await connectWs(b.token);
  const b2 = await connectWs(b.token);
  try {
    await wa.waitFor((m) => m.type === 'presence' && m.userId === b.id && m.online === true);
    await b1.close();
    await wa.expectNone((m) => m.type === 'presence' && m.userId === b.id && m.online === false, 400);
    await b2.close();
    await wa.waitFor((m) => m.type === 'presence' && m.userId === b.id && m.online === false);
  } finally { await wa.close(); await b1.close(); await b2.close(); }
});

test('ws: channel.created dla nowego kanału prywatnego z perspektywą odbiorcy; member_joined', async () => {
  const a = await register('wca');
  const b = await register('wcb');
  const c = await register('wcc');
  const wb = await connectWs(b.token);
  const wa = await connectWs(a.token);
  try {
    await Promise.all([wa.waitFor((m) => m.type === 'hello'), wb.waitFor((m) => m.type === 'hello')]);
    const ch = await createChannel(a.token, { isPrivate: true });
    await api('POST', `/api/channels/${ch.id}/members`, { userId: b.id }, a.token);
    const created = await wb.waitFor((m) => m.type === 'channel.created' && m.channel.id === ch.id);
    assert.equal(created.channel.isMember, true);

    await api('POST', `/api/channels/${ch.id}/members`, { userId: c.id }, a.token);
    const joined = await wb.waitFor((m) => m.type === 'channel.member_joined' && m.channelId === ch.id && m.user.id === c.id);
    assert.equal(joined.user.id, c.id);

    const dm = (await api('POST', '/api/dms', { userId: b.id }, a.token)).body.channel;
    const dmEv = await wb.waitFor((m) => m.type === 'channel.created' && m.channel.id === dm.id);
    assert.equal(dmEv.channel.isDm, true);
    assert.equal(dmEv.channel.dmUser.id, a.id);
  } finally { await wa.close(); await wb.close(); }
});

test('ws: channel.updated po zmianie tematu, user.updated po PATCH /me', async () => {
  const a = await register('wua');
  const b = await register('wub');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const wb = await connectWs(b.token);
  try {
    await wb.waitFor((m) => m.type === 'hello');
    await api('PATCH', `/api/channels/${ch.id}`, { topic: 'swiezy temat' }, a.token);
    const ev = await wb.waitFor((m) => m.type === 'channel.updated' && m.channel.id === ch.id);
    assert.equal(ev.channel.topic, 'swiezy temat');
    await api('PATCH', '/api/me', { status: 'zajęty' }, a.token);
    const u = await wb.waitFor((m) => m.type === 'user.updated' && m.user.id === a.id);
    assert.equal(u.user.status, 'zajęty');
  } finally { await wb.close(); }
});

// ---------- 13. XSS-niezależność ----------
test('API zapisuje i zwraca tekst z HTML dosłownie', async () => {
  const a = await register('xss');
  const ch = await createChannel(a.token);
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><b>&amp;</b>'];
  for (const text of payloads) {
    const m = await send(a.token, ch.id, text);
    assert.equal(m.text, text);
  }
  const list = await api('GET', `/api/channels/${ch.id}/messages`, undefined, a.token);
  assert.deepEqual(list.body.messages.map((m) => m.text), payloads);
  const found = await api('GET', '/api/search?q=' + encodeURIComponent('<script>'), undefined, a.token);
  assert.equal(found.body.results[0].text, '<script>alert(1)</script>');
});

test('JSON Content-Type i polski komunikat błędu w odpowiedziach błędów', async () => {
  const res = await fetch(base + '/api/me');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
});

// ======================= R1: regresje po recenzji =======================

test('R1 W1: kanał o nazwie dm-* -> 400, potem /api/dms nadal działa', async () => {
  const a = await register('w1a');
  const b = await register('w1b');
  const lo = Math.min(a.id, b.id);
  const hi = Math.max(a.id, b.id);
  for (const name of [`dm-${lo}-${hi}`, 'dm-1-2', 'dm-abc']) {
    const r = await api('POST', '/api/channels', { name }, a.token);
    assert.equal(r.status, 400, name);
    assert.equal(typeof r.body.error, 'string');
  }
  const dm = await api('POST', '/api/dms', { userId: b.id }, a.token);
  assert.ok([200, 201].includes(dm.status), 'status ' + dm.status);
  assert.equal(dm.body.channel.isDm, true);
});

test('R1 W2: hasło 201 znaków -> 400 (200 znaków ok)', async () => {
  const long = await api('POST', '/api/auth/register', { username: uniq('w2l'), password: 'a'.repeat(201) });
  assert.equal(long.status, 400);
  const ok = await api('POST', '/api/auth/register', { username: uniq('w2o'), password: 'a'.repeat(200) });
  assert.equal(ok.status, 201);
});

test('R1 W2: 10 nieudanych logowań -> 11. (nawet z dobrym hasłem) 429; inny username nadal 200', async () => {
  const victim = await register('w2v');
  const other = await register('w2w');
  for (let i = 0; i < 10; i++) {
    const r = await api('POST', '/api/auth/login', { username: victim.username, password: 'zlehaslo' + i });
    assert.equal(r.status, 401, 'próba ' + (i + 1));
  }
  const blocked = await api('POST', '/api/auth/login', { username: victim.username, password: 'haslo123' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'Zbyt wiele prób logowania. Spróbuj za kilka minut.');
  const fine = await api('POST', '/api/auth/login', { username: other.username, password: 'haslo123' });
  assert.equal(fine.status, 200);
});

test('R1 W2: udane logowanie czyści licznik nieudanych', async () => {
  const u = await register('w2c');
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 9; i++) {
      assert.equal((await api('POST', '/api/auth/login', { username: u.username, password: 'zle' + i + 'xx' })).status, 401);
    }
    assert.equal((await api('POST', '/api/auth/login', { username: u.username, password: 'haslo123' })).status, 200);
  }
});

test('R1 W2: rejestracja nie jest limitowana', async () => {
  for (let i = 0; i < 12; i++) await register('w2r');
});

test('R1 W4: logout zamyka otwarty socket kodem 4001', async () => {
  const a = await register('w4a');
  const other = await register('w4b');
  const c = await connectWs(a.token);
  const c2 = await connectWs(other.token);
  try {
    await c.waitFor((m) => m.type === 'hello');
    const closed = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('socket nie został zamknięty')), 3000);
      c.ws.once('close', (code) => { clearTimeout(t); resolve(code); });
    });
    const r = await api('POST', '/api/auth/logout', undefined, a.token);
    assert.equal(r.status, 200);
    assert.equal(await closed, 4001);
    assert.equal(c2.ws.readyState, WebSocket.OPEN, 'cudzy socket zostaje otwarty');
  } finally { await c.close(); await c2.close(); }
});

test('R1 D1: cudzy fileId -> 403', async () => {
  const a = await register('d1a');
  const b = await register('d1b');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const up = await api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 }, a.token);
  assert.equal(up.status, 201);
  const r = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'kradne', fileId: up.body.file.id }, b.token);
  assert.equal(r.status, 403);
  const own = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'moj', fileId: up.body.file.id }, a.token);
  assert.equal(own.status, 201);
});

test('R1 D3: wyszukiwanie bez rozróżniania wielkości polskich liter', async () => {
  const a = await register('d3a');
  const ch = await createChannel(a.token);
  const m = await send(a.token, ch.id, 'Jedziemy na ŁÓDŹ w piątek');
  const r = await api('GET', '/api/search?q=' + encodeURIComponent('łódź'), undefined, a.token);
  assert.equal(r.status, 200);
  assert.ok(r.body.results.some((x) => x.id === m.id));
  const r2 = await api('GET', '/api/search?q=' + encodeURIComponent('ŁÓDŹ'), undefined, a.token);
  assert.ok(r2.body.results.some((x) => x.id === m.id));
  const pct = await api('GET', '/api/search?q=' + encodeURIComponent('%%'), undefined, a.token);
  assert.equal(pct.body.results.length, 0);
});

test('R1 D4: nagłówki bezpieczeństwa na / i na API', async () => {
  for (const p of ['/', '/api/me']) {
    const res = await fetch(base + p);
    await res.arrayBuffer();
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'brak CSP na ' + p);
    for (const part of [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self' ws: wss:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ]) assert.ok(csp.includes(part), `CSP bez "${part}": ${csp}`);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  }
});

test('R1 D6: JSON >100 kB poza /api/files odrzucony (413), upload plików nadal działa', async () => {
  const a = await register('d6a');
  const ch = await createChannel(a.token);
  const r = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'x'.repeat(150 * 1024) }, a.token);
  assert.ok([400, 413].includes(r.status), 'status ' + r.status);
  const up = await api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 }, a.token);
  assert.equal(up.status, 201);
});

test('R1 D7: odpowiedź w wątku do usuniętej wiadomości -> 400', async () => {
  const a = await register('d7a');
  const ch = await createChannel(a.token);
  const parent = await send(a.token, ch.id, 'rodzic');
  await api('DELETE', `/api/messages/${parent.id}`, undefined, a.token);
  const r = await api('POST', `/api/channels/${ch.id}/messages`, { text: 'odp', parentId: parent.id }, a.token);
  assert.equal(r.status, 400);
});

test('R1 D8: leave -> pozostały członek dostaje channel.updated z memberCount-1', async () => {
  const a = await register('d8a');
  const b = await register('d8b');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const wa = await connectWs(a.token);
  try {
    await wa.waitFor((m) => m.type === 'hello');
    const leave = await api('POST', `/api/channels/${ch.id}/leave`, undefined, b.token);
    assert.equal(leave.status, 200);
    const ev = await wa.waitFor((m) => m.type === 'channel.updated' && m.channel.id === ch.id && m.channel.memberCount === 1);
    assert.equal(ev.channel.isMember, true);
  } finally { await wa.close(); }
});

test('R1 D9: PATCH /api/channels/:id na DM -> 400', async () => {
  const a = await register('d9a');
  const b = await register('d9b');
  const dm = (await api('POST', '/api/dms', { userId: b.id }, a.token)).body.channel;
  const r = await api('PATCH', `/api/channels/${dm.id}`, { topic: 'temat' }, a.token);
  assert.equal(r.status, 400);
});

test('R1 D10: typing – nadmiarowe eventy (>1/s dla user+channel+parentId) ignorowane', async () => {
  const a = await register('d10a');
  const b = await register('d10b');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  const wa = await connectWs(a.token);
  const wb = await connectWs(b.token);
  try {
    await Promise.all([wa.waitFor((m) => m.type === 'hello'), wb.waitFor((m) => m.type === 'hello')]);
    for (let i = 0; i < 5; i++) wa.send({ type: 'typing', channelId: ch.id });
    await wb.waitFor((m) => m.type === 'typing' && m.channelId === ch.id);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(wb.buffer.filter((m) => m.type === 'typing' && m.channelId === ch.id).length, 1);
  } finally { await wa.close(); await wb.close(); }
});

test('R1 D10: typing od nie-członka prywatnego kanału nie dociera do członków', async () => {
  const a = await register('d10c');
  const outsider = await register('d10d');
  const ch = await createChannel(a.token, { isPrivate: true });
  const wa = await connectWs(a.token);
  const wo = await connectWs(outsider.token);
  try {
    await Promise.all([wa.waitFor((m) => m.type === 'hello'), wo.waitFor((m) => m.type === 'hello')]);
    wo.send({ type: 'typing', channelId: ch.id });
    await wa.expectNone((m) => m.type === 'typing', 400);
  } finally { await wa.close(); await wo.close(); }
});

test('R1 D17: register normalizuje username do lowercase', async () => {
  const base0 = uniq('zen');
  const mixed = base0[0].toUpperCase() + base0.slice(1).toUpperCase();
  const r = await api('POST', '/api/auth/register', { username: mixed, password: 'haslo123' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.username, base0.toLowerCase());
  const again = await api('POST', '/api/auth/register', { username: base0.toLowerCase(), password: 'haslo123' });
  assert.equal(again.status, 409);
});

test('R1 D18: /read z ogromnym id nie psuje licznika nieprzeczytanych', async () => {
  const a = await register('d18a');
  const b = await register('d18b');
  const ch = await createChannel(a.token);
  await api('POST', `/api/channels/${ch.id}/join`, undefined, b.token);
  await send(b.token, ch.id, 'stara');
  const rd = await api('POST', `/api/channels/${ch.id}/read`, { messageId: 999999999 }, a.token);
  assert.equal(rd.status, 200);
  await send(b.token, ch.id, 'nowa');
  const c = (await api('GET', '/api/channels', undefined, a.token)).body.channels.find((x) => x.id === ch.id);
  assert.equal(c.unreadCount, 1);
});

// ======================= R2: KONTRAKT v2 =======================
const crypto = require('node:crypto');

test('R2 D11: POST /api/ws-ticket bez auth -> 401; z auth -> 64 znaki hex', async () => {
  assert.equal((await api('POST', '/api/ws-ticket')).status, 401);
  const a = await register('t1');
  const r = await api('POST', '/api/ws-ticket', undefined, a.token);
  assert.equal(r.status, 200);
  assert.match(r.body.ticket, /^[0-9a-f]{64}$/);
  const r2 = await api('POST', '/api/ws-ticket', undefined, a.token);
  assert.notEqual(r2.body.ticket, r.body.ticket);
});

test('R2 D11: bilet jest jednorazowy (drugie użycie -> 4001)', async () => {
  const a = await register('t2');
  const ticket = await getTicket(a.token);
  const c = await connectWsTicket(ticket);
  try {
    const hello = await c.waitFor((m) => m.type === 'hello');
    assert.equal(hello.user.id, a.id);
    const code = await waitForCloseQuery('?ticket=' + ticket);
    assert.equal(code, 4001);
  } finally { await c.close(); }
});

test('R2 D11: ?token= nie jest już akceptowany -> 4001', async () => {
  const a = await register('t3');
  assert.equal(await waitForCloseQuery('?token=' + a.token), 4001);
});

test('R2 D11: brak biletu / nieznany bilet -> 4001', async () => {
  assert.equal(await waitForCloseQuery(''), 4001);
  assert.equal(await waitForCloseQuery('?ticket='), 4001);
  assert.equal(await waitForCloseQuery('?ticket=' + 'ab'.repeat(32)), 4001);
});

test('R2 D11: bilet wystawiony na sesję zamkniętą przez logout nie działa', async () => {
  const a = await register('t4');
  const ticket = await getTicket(a.token);
  await api('POST', '/api/auth/logout', undefined, a.token);
  assert.equal(await waitForCloseQuery('?ticket=' + ticket), 4001);
});

test('R2 D5: wygasła sesja -> 401 (sessionTtlMs)', async () => {
  const inst = await startInstance({ sessionTtlMs: 300 });
  try {
    const u = await inst.register('exp');
    assert.equal((await inst.api('GET', '/api/me', undefined, u.token)).status, 200);
    await new Promise((r) => setTimeout(r, 800));
    const r = await inst.api('GET', '/api/me', undefined, u.token);
    assert.equal(r.status, 401);
    // ponowne logowanie działa
    const login = await inst.api('POST', '/api/auth/login', { username: u.username, password: 'haslo123' });
    assert.equal(login.status, 200);
  } finally { await inst.close(); inst.cleanup(); }
});

test('R2 D5: w bazie nie ma jawnego tokenu, tylko SHA-256 (token_hash)', async () => {
  const inst = await startInstance();
  let tokens;
  try {
    const u = await inst.register('hash');
    const login = await inst.api('POST', '/api/auth/login', { username: u.username, password: 'haslo123' });
    tokens = [u.token, login.body.token];
  } finally { await inst.close(); }
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(inst.dbPath, { readOnly: true });
    const rows = db.prepare('SELECT * FROM sessions').all();
    const cols = Object.keys(rows[0] || {});
    db.close();
    assert.ok(rows.length >= 2);
    for (const c of ['token_hash', 'user_id', 'created_at', 'expires_at', 'last_used_at']) {
      assert.ok(cols.includes(c), 'brak kolumny ' + c + ' (są: ' + cols + ')');
    }
    assert.ok(!cols.includes('token'), 'kolumna z jawnym tokenem nie powinna istnieć');
    const dump = JSON.stringify(rows);
    for (const t of tokens) {
      assert.ok(!dump.includes(t), 'jawny token w tabeli sessions');
      const h = crypto.createHash('sha256').update(t).digest('hex');
      assert.ok(rows.some((r) => r.token_hash === h), 'brak SHA-256(token) w token_hash');
    }
  } finally { inst.cleanup(); }
});

test('R2 D5: logout-all unieważnia wszystkie sesje i zamyka sockety 4001', async () => {
  const a = await register('lo');
  const other = await register('lo2');
  const login = await api('POST', '/api/auth/login', { username: a.username, password: 'haslo123' });
  const token2 = login.body.token;
  assert.notEqual(token2, a.token);
  const c1 = await connectWs(a.token);
  const c2 = await connectWs(token2);
  const co = await connectWs(other.token);
  try {
    await Promise.all([c1, c2, co].map((c) => c.waitFor((m) => m.type === 'hello')));
    const closing = [c1, c2].map((c) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('socket nie zamknięty')), 3000);
      c.ws.once('close', (code) => { clearTimeout(t); resolve(code); });
    }));
    assert.equal((await api('POST', '/api/auth/logout-all')).status, 401);
    const r = await api('POST', '/api/auth/logout-all', undefined, a.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(await Promise.all(closing), [4001, 4001]);
    assert.equal((await api('GET', '/api/me', undefined, a.token)).status, 401);
    assert.equal((await api('GET', '/api/me', undefined, token2)).status, 401);
    assert.equal((await api('GET', '/api/me', undefined, other.token)).status, 200);
    assert.equal(co.ws.readyState, WebSocket.OPEN);
  } finally { await Promise.all([c1.close(), c2.close(), co.close()]); }
});

test('R2 D2: GET /api/me/storage (usedBytes, quotaBytes)', async () => {
  const a = await register('stg');
  assert.equal((await api('GET', '/api/me/storage')).status, 401);
  const r0 = await api('GET', '/api/me/storage', undefined, a.token);
  assert.equal(r0.status, 200);
  assert.equal(r0.body.usedBytes, 0);
  assert.equal(typeof r0.body.quotaBytes, 'number');
  assert.ok(r0.body.quotaBytes > 0);
  const bytes = Buffer.from(PNG_BASE64, 'base64').length;
  await api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 }, a.token);
  const r1 = await api('GET', '/api/me/storage', undefined, a.token);
  assert.equal(r1.body.usedBytes, bytes);
});

test('R2 D2: kwota na użytkownika -> 413 z komunikatem', async () => {
  const inst = await startInstance({ uploadQuotaBytes: 1000 });
  try {
    const a = await inst.register('q1');
    const b = await inst.register('q2');
    const chunk = Buffer.alloc(600, 7).toString('base64');
    const up = (t) => inst.api('POST', '/api/files', { name: 'a.bin', mime: 'application/octet-stream', dataBase64: chunk }, t);
    assert.equal((await up(a.token)).status, 201);
    const over = await up(a.token);
    assert.equal(over.status, 413);
    assert.equal(over.body.error, 'Przekroczono limit miejsca na pliki');
    const st = await inst.api('GET', '/api/me/storage', undefined, a.token);
    assert.deepEqual(st.body, { usedBytes: 600, quotaBytes: 1000 });
    // kwota jest per użytkownik
    assert.equal((await up(b.token)).status, 201);
  } finally { await inst.close(); inst.cleanup(); }
});

test('R2 D2: usunięcie wiadomości z plikiem usuwa plik (GET -> 404) i zwalnia miejsce', async () => {
  const a = await register('dfa');
  const ch = await createChannel(a.token);
  const up = await api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 }, a.token);
  const m = await send(a.token, ch.id, 'z plikiem', { fileId: up.body.file.id });
  const before = await fetch(base + m.file.url);
  assert.equal(before.status, 200);
  await before.arrayBuffer();
  assert.equal((await api('DELETE', `/api/messages/${m.id}`, undefined, a.token)).status, 200);
  const after = await fetch(base + m.file.url);
  assert.equal(after.status, 404);
  await after.arrayBuffer();
  const st = await api('GET', '/api/me/storage', undefined, a.token);
  assert.equal(st.body.usedBytes, 0);
});

test('R2 D2: cleanupOrphans() usuwa nieprzypięty plik, zostawia przypięty', async () => {
  const inst = await startInstance({ orphanMaxAgeMs: 0 });
  try {
    assert.equal(typeof inst.srv.cleanupOrphans, 'function');
    const a = await inst.register('orp');
    const ch = (await inst.api('POST', '/api/channels', { name: uniq('orph') }, a.token)).body.channel;
    const mk = async () => (await inst.api('POST', '/api/files', { name: 'p.png', mime: 'image/png', dataBase64: PNG_BASE64 }, a.token)).body.file;
    const orphan = await mk();
    const pinned = await mk();
    const msg = await inst.api('POST', `/api/channels/${ch.id}/messages`, { text: 'x', fileId: pinned.id }, a.token);
    assert.equal(msg.status, 201);
    await new Promise((r) => setTimeout(r, 30));
    const removed = await inst.srv.cleanupOrphans();
    assert.ok(removed >= 1, 'removed=' + removed);
    const o = await fetch(inst.url + orphan.url);
    assert.equal(o.status, 404);
    await o.arrayBuffer();
    const p = await fetch(inst.url + pinned.url);
    assert.equal(p.status, 200);
    await p.arrayBuffer();
  } finally { await inst.close(); inst.cleanup(); }
});

test('R2: /api/health 200 {ok:true} bez autoryzacji', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
