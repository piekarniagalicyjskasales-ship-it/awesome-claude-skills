'use strict';
// Zapytania i serializery (User, Channel, Message, File).
const PALETTE = ['#2a9d8f', '#e76f51', '#457b9d', '#8e6bbf', '#d4a017', '#c9485b', '#3f8f5a', '#5f6caf'];

function createModels(db, isOnline) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const get = (sql, ...p) => stmt(sql).get(...p);
  const all = (sql, ...p) => stmt(sql).all(...p);
  const run = (sql, ...p) => stmt(sql).run(...p);

  function userOut(row) {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: PALETTE[(row.id - 1) % PALETTE.length],
      status: row.status || '',
      online: isOnline(row.id),
    };
  }
  const getUserRow = (id) => get('SELECT * FROM users WHERE id = ?', id);
  const getUser = (id) => { const r = getUserRow(id); return r ? userOut(r) : null; };

  function fileOut(row) {
    if (!row) return null;
    return { id: row.id, name: row.name, mime: row.mime, size: row.size, url: '/files/' + row.id };
  }

  function messageOut(row) {
    const user = getUser(row.user_id);
    const stats = get(
      'SELECT COUNT(*) AS c, MAX(created_at) AS last FROM messages WHERE parent_id = ? AND deleted = 0', row.id);
    let reactions = [];
    let file = null;
    if (!row.deleted) {
      const map = new Map();
      for (const r of all('SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY rowid', row.id)) {
        if (!map.has(r.emoji)) map.set(r.emoji, []);
        map.get(r.emoji).push(r.user_id);
      }
      reactions = [...map].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
      if (row.file_id) file = fileOut(get('SELECT * FROM files WHERE id = ?', row.file_id));
    }
    return {
      id: row.id,
      channelId: row.channel_id,
      user,
      parentId: row.parent_id,
      text: row.deleted ? '' : row.text,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deleted: !!row.deleted,
      reactions,
      replyCount: stats.c,
      lastReplyAt: stats.last || null,
      file,
    };
  }
  const getMessageRow = (id) => get('SELECT * FROM messages WHERE id = ?', id);
  const getMessage = (id) => { const r = getMessageRow(id); return r ? messageOut(r) : null; };

  const getChannelRow = (id) => get('SELECT * FROM channels WHERE id = ?', id);
  const getMember = (channelId, userId) =>
    get('SELECT * FROM channel_members WHERE channel_id = ? AND user_id = ?', channelId, userId);
  const memberIds = (channelId) =>
    all('SELECT user_id FROM channel_members WHERE channel_id = ?', channelId).map((r) => r.user_id);

  function channelOut(row, userId) {
    const member = getMember(row.id, userId);
    let dmUser = null;
    if (row.is_dm) {
      const m = /^dm-(\d+)-(\d+)$/.exec(row.name);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        dmUser = getUser(a === userId ? b : a);
      }
    }
    let unread = 0;
    if (member) {
      unread = get(
        `SELECT COUNT(*) AS c FROM messages WHERE channel_id = ? AND parent_id IS NULL AND deleted = 0
         AND user_id != ? AND id > ?`, row.id, userId, member.last_read_message_id).c;
    }
    return {
      id: row.id,
      name: row.name,
      topic: row.topic,
      isPrivate: !!row.is_private,
      isDm: !!row.is_dm,
      dmUser,
      memberCount: get('SELECT COUNT(*) AS c FROM channel_members WHERE channel_id = ?', row.id).c,
      unreadCount: unread,
      isMember: !!member,
      createdAt: row.created_at,
    };
  }

  return {
    get, all, run, PALETTE,
    userOut, getUserRow, getUser, fileOut, messageOut, getMessageRow, getMessage,
    getChannelRow, getMember, memberIds, channelOut,
  };
}

module.exports = { createModels, PALETTE };
