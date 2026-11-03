'use strict';
const { hashPassword } = require('./auth');

const DEFAULT_CHANNELS = [
  { name: 'ogolny', topic: 'Sprawy całego zespołu' },
  { name: 'luzne-rozmowy', topic: 'Kawa, memy, weekend' },
];

function ensureDefaultChannels(db) {
  const now = new Date().toISOString();
  for (const c of DEFAULT_CHANNELS) {
    db.prepare('INSERT OR IGNORE INTO channels (name, topic, is_default, created_at) VALUES (?, ?, 1, ?)')
      .run(c.name, c.topic, now);
  }
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;
  const t0 = Date.now() - 3 * 3600 * 1000;
  const at = (min) => new Date(t0 + min * 60000).toISOString();
  db.exec('BEGIN');
  try {
    const addUser = db.prepare(
      'INSERT INTO users (username, password_hash, salt, display_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const ids = {};
    for (const [username, name, status] of [['anna', 'Anna Nowak', 'Pracuję zdalnie'], ['bartek', 'Bartek Kowalski', '']]) {
      const { salt, hash } = hashPassword('haslo123');
      ids[username] = Number(addUser.run(username, hash, salt, name, status, at(0)).lastInsertRowid);
    }
    const chans = {};
    for (const c of db.prepare('SELECT id, name FROM channels WHERE is_default = 1').all()) {
      chans[c.name] = c.id;
      for (const uid of Object.values(ids)) {
        db.prepare('INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)').run(c.id, uid, at(0));
      }
    }
    const addMsg = db.prepare(
      'INSERT INTO messages (channel_id, user_id, parent_id, text, created_at) VALUES (?, ?, ?, ?, ?)');
    const post = (ch, user, parent, text, min) =>
      Number(addMsg.run(chans[ch], ids[user], parent, text, at(min)).lastInsertRowid);

    post('ogolny', 'anna', null, 'Witajcie w Kanaliku! To nasze miejsce do rozmów całego zespołu.', 5);
    const m2 = post('ogolny', 'bartek', null, 'Cześć Anna, super że już działa. Kto robi dziś kawę?', 10);
    post('ogolny', 'anna', m2, 'Ja stawiam kawę, daj znać o której.', 12);
    post('ogolny', 'bartek', null, 'Przypominam o spotkaniu zespołu jutro o 10:00. Wspomnijcie @anna jeśli macie tematy.', 20);
    post('luzne-rozmowy', 'bartek', null, 'Jakie plany na weekend?', 25);

    db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
      .run(m2, ids.anna, '👍', at(11));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { seed, ensureDefaultChannels, DEFAULT_CHANNELS };
