'use strict';
(() => {
  // ---------- Stałe i stan ----------
  const TOKEN_KEY = 'kanalik.token';
  const EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏', '✅'];
  const PAGE = 50;
  const MAX_FILE = 5 * 1024 * 1024;

  const state = {
    token: null,
    me: null,
    users: new Map(),
    channels: [],
    currentId: null,
    messages: [],
    hasMore: false,
    loadingOlder: false,
    loadSeq: 0,
    stick: true,
    panel: null, // null | 'thread' | 'search'
    thread: null, // {parent, replies}
    search: { q: '', results: null },
    editing: null, // {id, ctx}
    editDraft: '',
    picker: null, // {id, ctx}
    editingTopic: false,
    readSent: {},
    typing: new Map(), // key -> Map(userId -> {name, timer})
    ws: null,
    wsEverOpen: false,
    backoff: 1,
    pingTimer: null,
    reconnectTimer: null,
  };

  const $ = (s, r = document) => r.querySelector(s);

  // ---------- Pomocnicze ----------
  function h(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.append(typeof c === 'object' && c.nodeType ? c : String(c));
    }
    return e;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (n === 1) return one;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
    return many;
  }

  function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* brak dostępu */ }
  }

  function toast(msg) {
    const box = $('#toasts');
    const t = h('div', { class: 'toast', role: 'status', text: String(msg) });
    box.append(t);
    setTimeout(() => t.remove(), 4500);
  }

  async function api(method, path, body, opts = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      const err = new Error('Brak połączenia z serwerem.');
      err.network = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* pusta odpowiedź */ }
    if (!res.ok) {
      if (res.status === 401 && !opts.noLogout) logout(true);
      const err = new Error((data && data.error) || 'Błąd ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data || {};
  }

  async function act(fn) {
    try { return await fn(); } catch (e) {
      if (e.status !== 401) toast(e.message);
      return undefined;
    }
  }

  // ---------- Formatowanie tekstu (najpierw escape) ----------
  function formatText(raw, myUsername) {
    let s = escapeHtml(String(raw).replace(/\u0000/g, ''));
    const stash = [];
    const put = (html) => { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; };
    s = s.replace(/```([\s\S]*?)```/g, (m, c) => put('<pre><code>' + c.replace(/^\n/, '') + '</code></pre>'));
    s = s.replace(/`([^`\n]+)`/g, (m, c) => put('<code>' + c + '</code>'));
    s = s.replace(/https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s\u0000])+/g, (m) => {
      let url = m, tail = '';
      const t = url.match(/[.,:!?)\]]+$/);
      if (t) { tail = t[0]; url = url.slice(0, -tail.length); }
      return put('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>') + tail;
    });
    s = s.replace(/(^|[^\w*])\*([^*\n]+?)\*(?![\w*])/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^\w_])_([^_\n]+?)_(?![\w_])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w~])~([^~\n]+?)~(?![\w~])/g, '$1<del>$2</del>');
    s = s.replace(/(^|[^\w@.])@([a-z0-9_.]*[a-z0-9_])/gi, (m, pre, name) => {
      const me = myUsername && name.toLowerCase() === myUsername.toLowerCase();
      return pre + '<span class="mention' + (me ? ' me' : '') + '">@' + name + '</span>';
    });
    s = s.replace(/\n/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
  }

  // ---------- Daty ----------
  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(iso) {
    const d = new Date(iso);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function dayKey(iso) {
    const d = new Date(iso);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }
  function dayLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayKey(iso) === dayKey(now.toISOString())) return 'Dzisiaj';
    if (dayKey(iso) === dayKey(y.toISOString())) return 'Wczoraj';
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('pl-PL', opts);
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---------- Użytkownicy, kanały ----------
  function upsertUser(u) {
    if (!u || u.id == null) return;
    const old = state.users.get(u.id);
    state.users.set(u.id, old ? Object.assign(old, u) : Object.assign({}, u));
    if (state.me && state.me.id === u.id) state.me = state.users.get(u.id);
  }
  function userById(id) { return state.users.get(id); }
  function curChan() { return state.channels.find((c) => c.id === state.currentId) || null; }
  function getChan(id) { return state.channels.find((c) => c.id === id) || null; }
  function dmUserOf(c) {
    if (!c.dmUser) return null;
    return userById(c.dmUser.id) || c.dmUser;
  }
  function chanLabel(c) {
    if (c.isDm) {
      const u = dmUserOf(c);
      return u ? u.displayName + (state.me && u.id === state.me.id ? ' (Ty)' : '') : 'Wiadomość bezpośrednia';
    }
    return c.name;
  }
  function upsertChannel(c) {
    if (c.dmUser) upsertUser(c.dmUser);
    const i = state.channels.findIndex((x) => x.id === c.id);
    if (i >= 0) state.channels[i] = c; else state.channels.push(c);
    sortChannels();
  }
  function sortChannels() {
    state.channels.sort((a, b) => {
      if (a.isDm !== b.isDm) return a.isDm ? 1 : -1;
      if (a.isDm) return chanLabel(a).localeCompare(chanLabel(b), 'pl');
      return a.name.localeCompare(b.name, 'pl');
    });
  }
  function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  }
  function avatar(user, size, withDot) {
    const color = /^#[0-9a-f]{6}$/i.test(user.avatarColor || '') ? user.avatarColor : '#5b7f86';
    const name = (user.displayName || user.username || '?').trim();
    const ini = name.split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] || '').join('').toUpperCase() || '?';
    const a = h('span', { class: 'avatar avatar-' + size, 'aria-hidden': 'true', text: ini });
    a.style.background = color;
    a.style.color = lum(color) > 0.4 ? '#1d2329' : '#ffffff';
    if (withDot) a.append(h('span', { class: 'dot' + (user.online ? ' online' : '') }));
    return a;
  }
  function presenceDot(user) {
    return h('span', { class: 'dot' + (user && user.online ? ' online' : ''), title: user && user.online ? 'Online' : 'Offline' });
  }

  // ---------- Ekran logowania ----------
  let authMode = 'login';
  function setAuthMode(m) {
    authMode = m;
    $('#tab-login').setAttribute('aria-selected', String(m === 'login'));
    $('#tab-register').setAttribute('aria-selected', String(m === 'register'));
    $('#f-display-wrap').hidden = m !== 'register';
    $('#auth-submit').textContent = m === 'login' ? 'Zaloguj się' : 'Utwórz konto';
    $('#f-password').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    showAuthError('');
  }
  function showAuthError(msg) {
    const e = $('#auth-error');
    e.textContent = msg;
    e.hidden = !msg;
  }
  function showAuth() {
    $('#app').hidden = true;
    $('#auth').hidden = false;
    document.title = 'Kanalik';
  }

  async function submitAuth(ev) {
    ev.preventDefault();
    const username = $('#f-username').value.trim().toLowerCase();
    const password = $('#f-password').value;
    if (!username || !password) { showAuthError('Podaj nazwę użytkownika i hasło.'); return; }
    const body = { username, password };
    if (authMode === 'register') {
      const dn = $('#f-display').value.trim();
      if (dn) body.displayName = dn;
    }
    const btn = $('#auth-submit');
    btn.disabled = true;
    try {
      const data = await api('POST', authMode === 'login' ? '/api/auth/login' : '/api/auth/register', body, { noLogout: true });
      state.token = data.token;
      setToken(data.token);
      $('#f-password').value = '';
      await enterApp(data.user);
    } catch (e) {
      showAuthError(e.message);
    } finally {
      btn.disabled = false;
    }
  }

  function resetState() {
    state.me = null;
    state.users = new Map();
    state.channels = [];
    state.currentId = null;
    state.messages = [];
    state.hasMore = false;
    state.panel = null;
    state.thread = null;
    state.search = { q: '', results: null };
    state.editing = null;
    state.picker = null;
    state.readSent = {};
    for (const m of state.typing.values()) for (const t of m.values()) clearTimeout(t.timer);
    state.typing = new Map();
    state.wsEverOpen = false;
  }

  function logout(local) {
    const tok = state.token;
    if (!local && tok) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }).catch(() => {});
    }
    state.token = null;
    setToken(null);
    closeWs();
    closeModal();
    resetState();
    $('#search').value = '';
    $('#panel').hidden = true;
    $('#messages').replaceChildren();
    $('#chan-header').replaceChildren();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignoruj */ }
    showAuth();
  }

  // ---------- Start aplikacji ----------
  async function enterApp(user) {
    resetState();
    state.me = user;
    upsertUser(user);
    $('#auth').hidden = true;
    $('#app').hidden = false;
    renderProfile();
    mainComposer.setTarget(null);
    await Promise.all([loadUsers(), loadChannels()]);
    connectWs();
    renderSidebar();
    await routeFromHash(true);
  }

  async function loadUsers() {
    const d = await act(() => api('GET', '/api/users'));
    if (d) d.users.forEach(upsertUser);
  }
  async function loadChannels() {
    const d = await act(() => api('GET', '/api/channels'));
    if (!d) return;
    // zachowaj nieprzeczytane dla otwartego kanału zgodnie z serwerem
    state.channels = [];
    d.channels.forEach(upsertChannel);
    renderSidebar();
    renderHeader();
  }

  async function routeFromHash(initial) {
    const m = /^#\/c\/(\d+)$/.exec(location.hash);
    let id = m ? Number(m[1]) : null;
    if (id && !getChan(id)) id = null;
    if (!id) {
      const gen = state.channels.find((c) => c.name === 'ogolny' && !c.isDm) || state.channels[0];
      id = gen ? gen.id : null;
    }
    if (id && (initial || id !== state.currentId)) await openChannel(id);
    else if (!id) renderEmptyMain();
  }

  function renderEmptyMain() {
    state.currentId = null;
    state.messages = [];
    renderHeader();
    $('#messages').replaceChildren(h('div', { class: 'empty', text: 'Nie należysz jeszcze do żadnego kanału. Dołącz do kanału lub utwórz własny.' }));
    mainComposer.setTarget(null);
  }

  // ---------- Panel boczny, sidebar ----------
  function totalUnread() { return state.channels.reduce((n, c) => n + (c.unreadCount || 0), 0); }
  function updateTitle() {
    const n = totalUnread();
    document.title = n > 0 ? '(' + n + ') Kanalik' : 'Kanalik';
  }

  function renderProfile() {
    const me = state.me;
    const b = $('#profile-btn');
    b.replaceChildren();
    if (!me) return;
    b.append(
      avatar(me, 'm', true),
      h('span', { class: 'profile-info' },
        h('span', { class: 'profile-name', text: me.displayName }),
        h('span', { class: 'profile-status', text: me.status || 'Brak statusu' }))
    );
  }

  function navItem(c) {
    const unread = c.unreadCount > 0;
    const prefix = c.isDm
      ? h('span', { class: 'nav-prefix' }, presenceDot(dmUserOf(c)))
      : h('span', { class: 'nav-prefix', 'aria-hidden': 'true', text: c.isPrivate ? '🔒' : '#' });
    const btn = h('button', {
      type: 'button',
      class: 'nav-item' + (unread ? ' unread' : ''),
      'aria-current': c.id === state.currentId ? 'true' : null,
      onclick: () => { openChannel(c.id); },
    },
    prefix,
    h('span', { class: 'nav-name', text: chanLabel(c) }),
    unread ? h('span', { class: 'badge', 'aria-label': c.unreadCount + ' nieprzeczytanych', text: c.unreadCount > 99 ? '99+' : String(c.unreadCount) }) : null);
    return h('li', null, btn);
  }

  function renderSidebar() {
    const cl = $('#channel-list'), dl = $('#dm-list');
    cl.replaceChildren(...state.channels.filter((c) => !c.isDm).map(navItem));
    dl.replaceChildren(...state.channels.filter((c) => c.isDm).map(navItem));
    updateTitle();
  }

  function setNavOpen(open) { $('#app').classList.toggle('nav-open', open); }

  // ---------- Nagłówek kanału ----------
  function renderHeader() {
    const hd = $('#chan-header');
    hd.replaceChildren();
    const menu = h('button', { type: 'button', class: 'icon-btn menu-btn', 'aria-label': 'Pokaż menu', title: 'Menu', onclick: () => setNavOpen(true), text: '☰' });
    hd.append(menu);
    const c = curChan();
    if (!c) return;
    const title = h('h2', { class: 'chan-title' });
    if (c.isDm) {
      title.append(presenceDot(dmUserOf(c)), chanLabel(c));
    } else {
      title.append(c.isPrivate ? '🔒 ' : '# ', c.name);
    }
    hd.append(title);

    if (!c.isDm) {
      const topic = h('div', { class: 'topic' });
      if (state.editingTopic) {
        const inp = h('input', { type: 'text', maxlength: '250', value: c.topic || '', 'aria-label': 'Temat kanału', placeholder: 'Temat kanału' });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveTopic(c, inp.value.trim());
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            state.editingTopic = false;
            renderHeader();
          }
        });
        inp.addEventListener('blur', () => { if (state.editingTopic) { state.editingTopic = false; renderHeader(); } });
        topic.append(inp);
        hd.append(topic);
        setTimeout(() => inp.focus(), 0);
      } else {
        topic.append(h('button', {
          type: 'button', class: 'topic-btn', title: 'Kliknij, aby edytować temat',
          onclick: () => { state.editingTopic = true; renderHeader(); },
          text: c.topic || 'Dodaj temat',
        }));
        hd.append(topic);
      }
    } else {
      hd.append(h('div', { class: 'topic' }));
    }

    const actions = h('div', { class: 'header-actions' });
    actions.append(h('span', { class: 'topic', style: 'flex:none', text: c.memberCount + ' ' + plural(c.memberCount, 'członek', 'członków', 'członków') }));
    if (!c.isDm) {
      actions.append(h('button', { type: 'button', class: 'btn small', onclick: () => openAddPersonModal(c), text: 'Dodaj osobę' }));
      actions.append(h('button', { type: 'button', class: 'btn small', onclick: () => leaveChannel(c), text: 'Opuść kanał' }));
    }
    hd.append(actions);
  }

  async function saveTopic(c, topic) {
    state.editingTopic = false;
    const d = await act(() => api('PATCH', '/api/channels/' + c.id, { topic }));
    if (d && d.channel) { upsertChannel(Object.assign({}, getChan(c.id) || {}, d.channel)); }
    renderHeader();
  }

  async function leaveChannel(c) {
    if (!confirm('Opuścić kanał #' + c.name + '?')) return;
    const d = await act(() => api('POST', '/api/channels/' + c.id + '/leave'));
    if (!d) return;
    state.channels = state.channels.filter((x) => x.id !== c.id);
    state.currentId = null;
    renderSidebar();
    location.hash = '';
    await routeFromHash(true);
  }

  // ---------- Otwieranie kanału ----------
  async function openChannel(id) {
    const c = getChan(id);
    if (!c) return;
    const seq = ++state.loadSeq;
    state.currentId = id;
    state.messages = [];
    state.hasMore = false;
    state.editing = null;
    state.picker = null;
    state.editingTopic = false;
    state.stick = true;
    if (state.panel === 'thread') closePanel();
    if (location.hash !== '#/c/' + id) {
      try { history.replaceState(null, '', '#/c/' + id); } catch (e) { location.hash = '#/c/' + id; }
    }
    setNavOpen(false);
    renderSidebar();
    renderHeader();
    mainComposer.setTarget({ channelId: id, parentId: null }, 'Napisz do ' + (c.isDm ? chanLabel(c) : '#' + c.name));
    renderTypingFor();
    $('#messages').replaceChildren(h('div', { class: 'older-note', text: 'Ładowanie…' }));
    const d = await act(() => api('GET', '/api/channels/' + id + '/messages?limit=' + PAGE));
    if (seq !== state.loadSeq) return;
    if (!d) { $('#messages').replaceChildren(h('div', { class: 'empty', text: 'Nie udało się załadować wiadomości.' })); return; }
    state.messages = d.messages;
    state.hasMore = d.messages.length >= PAGE;
    renderMessages({ bottom: true });
    markRead();
    if (window.matchMedia('(min-width: 760px)').matches) mainComposer.focus();
  }

  async function reloadCurrent() {
    const id = state.currentId;
    if (!id) return;
    const d = await act(() => api('GET', '/api/channels/' + id + '/messages?limit=' + PAGE));
    if (!d || state.currentId !== id) return;
    state.messages = d.messages;
    state.hasMore = d.messages.length >= PAGE;
    renderMessages({ bottom: state.stick });
    markRead();
    if (state.panel === 'thread' && state.thread) {
      const t = await act(() => api('GET', '/api/messages/' + state.thread.parent.id + '/thread'));
      if (t && state.thread) { state.thread = t; renderPanel(); }
    }
  }

  function markRead() {
    const c = curChan();
    if (!c || document.visibilityState !== 'visible') return;
    const last = state.messages.length ? state.messages[state.messages.length - 1].id : 0;
    if (c.unreadCount > 0) { c.unreadCount = 0; renderSidebar(); }
    if (!last || (state.readSent[c.id] || 0) >= last) return;
    state.readSent[c.id] = last;
    api('POST', '/api/channels/' + c.id + '/read', { messageId: last }).catch(() => {});
  }

  // ---------- Lista wiadomości ----------
  function atBottom(box) { return box.scrollHeight - box.scrollTop - box.clientHeight < 80; }

  function renderMessages(opts = {}) {
    const box = $('#messages');
    const editEl = box.querySelector('.edit-box textarea');
    const hadFocus = editEl && document.activeElement === editEl;
    if (editEl) state.editDraft = editEl.value;
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    box.replaceChildren();
    const c = curChan();
    if (state.hasMore) {
      box.append(h('div', { class: 'older-note', text: state.loadingOlder ? 'Ładowanie starszych…' : 'Przewiń w górę, aby załadować starsze wiadomości' }));
    } else if (c) {
      box.append(h('div', { class: 'chan-intro' }, 'To początek ', h('strong', { text: c.isDm ? 'rozmowy z ' + chanLabel(c) : '#' + c.name }), '.'));
    }
    if (!state.messages.length) box.append(h('div', { class: 'empty', text: 'Brak wiadomości. Napisz pierwszą!' }));
    let prev = null, lastDay = null;
    for (const m of state.messages) {
      const dk = dayKey(m.createdAt);
      if (dk !== lastDay) {
        box.append(h('div', { class: 'day-sep', role: 'separator' }, dayLabel(m.createdAt)));
        lastDay = dk;
        prev = null;
      }
      box.append(messageEl(m, 'main', prev));
      prev = m;
    }
    if (opts.bottom) box.scrollTop = box.scrollHeight;
    else if (opts.anchor) box.scrollTop = prevTop + (box.scrollHeight - prevH);
    else box.scrollTop = prevTop;
    if (hadFocus) focusEdit(box);
  }

  function focusEdit(root) {
    const ta = root.querySelector('.edit-box textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  function rerender() {
    renderMessages({ bottom: state.stick });
    if (state.panel === 'thread') renderPanel(true);
  }

  async function loadOlder() {
    if (state.loadingOlder || !state.hasMore || !state.messages.length) return;
    const id = state.currentId;
    state.loadingOlder = true;
    const first = state.messages[0].id;
    const d = await act(() => api('GET', '/api/channels/' + id + '/messages?limit=' + PAGE + '&before=' + first));
    state.loadingOlder = false;
    if (!d || state.currentId !== id) return;
    const have = new Set(state.messages.map((m) => m.id));
    const older = d.messages.filter((m) => !have.has(m.id));
    state.hasMore = d.messages.length >= PAGE;
    state.messages = older.concat(state.messages);
    renderMessages({ anchor: true });
  }

  function groupable(prev, m) {
    return prev && prev.user.id === m.user.id && dayKey(prev.createdAt) === dayKey(m.createdAt) &&
      new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60 * 1000;
  }

  function messageEl(m, ctx, prev) {
    const grouped = groupable(prev, m);
    const isMine = state.me && m.user.id === state.me.id;
    const user = userById(m.user.id) || m.user;
    const el = h('div', {
      class: 'msg' + (grouped ? ' grouped' : '') + (m.deleted ? ' deleted' : '') + (state.picker && state.picker.id === m.id && state.picker.ctx === ctx ? ' picker-open' : ''),
      'data-id': String(m.id),
    });
    el.append(h('div', { class: 'msg-side' }, grouped ? h('span', { class: 'hover-time', text: fmtTime(m.createdAt) }) : avatar(user, 'm', false)));
    const body = h('div', { class: 'msg-body' });
    if (!grouped) {
      body.append(h('div', { class: 'msg-head' },
        h('span', { class: 'msg-author', text: user.displayName }),
        h('time', { class: 'msg-time', datetime: m.createdAt, title: new Date(m.createdAt).toLocaleString('pl-PL'), text: fmtTime(m.createdAt) })));
    }
    if (m.deleted) {
      body.append(h('div', { class: 'msg-text deleted-text', text: 'Ta wiadomość została usunięta.' }));
    } else if (state.editing && state.editing.id === m.id && state.editing.ctx === ctx) {
      body.append(editBox(m));
    } else {
      const t = h('div', { class: 'msg-text' });
      t.innerHTML = formatText(m.text, state.me && state.me.username); // tekst jest zescapowany w formatText
      if (m.editedAt) t.append(' ', h('span', { class: 'msg-edited', text: '(edytowano)' }));
      body.append(t);
      if (m.file) body.append(fileEl(m.file));
    }
    if (!m.deleted && m.reactions && m.reactions.length) {
      body.append(h('div', { class: 'reactions' }, m.reactions.map((r) => reactionPill(m, r))));
    }
    if (ctx === 'main' && m.replyCount > 0) {
      body.append(h('button', { type: 'button', class: 'reply-link', onclick: () => openThread(m.id) },
        m.replyCount + ' ' + plural(m.replyCount, 'odpowiedź', 'odpowiedzi', 'odpowiedzi'),
        m.lastReplyAt ? h('small', { text: 'ostatnia ' + fmtTime(m.lastReplyAt) }) : null));
    }
    el.append(body);
    if (!m.deleted) {
      const actions = h('div', { class: 'msg-actions' });
      actions.append(h('button', {
        type: 'button', class: 'icon-btn act-react', title: 'Dodaj reakcję', 'aria-label': 'Dodaj reakcję',
        onclick: (e) => {
          e.stopPropagation();
          state.picker = state.picker && state.picker.id === m.id && state.picker.ctx === ctx ? null : { id: m.id, ctx };
          rerender();
        },
        text: '🙂',
      }));
      if (ctx === 'main') {
        actions.append(h('button', { type: 'button', class: 'icon-btn', title: 'Odpowiedz w wątku', 'aria-label': 'Odpowiedz w wątku', onclick: () => openThread(m.id), text: '💬' }));
      }
      if (isMine) {
        actions.append(h('button', {
          type: 'button', class: 'icon-btn', title: 'Edytuj', 'aria-label': 'Edytuj wiadomość',
          onclick: () => { state.editing = { id: m.id, ctx }; state.editDraft = m.text; state.picker = null; rerender(); focusEditSoon(); },
          text: '✏️',
        }));
        actions.append(h('button', { type: 'button', class: 'icon-btn del', title: 'Usuń', 'aria-label': 'Usuń wiadomość', onclick: () => deleteMessage(m), text: '🗑️' }));
      }
      el.append(actions);
      if (state.picker && state.picker.id === m.id && state.picker.ctx === ctx) {
        el.append(h('div', { class: 'emoji-picker', role: 'menu', 'aria-label': 'Wybierz reakcję' },
          EMOJIS.map((em) => h('button', {
            type: 'button', role: 'menuitem', 'aria-label': 'Reakcja ' + em,
            onclick: (e) => { e.stopPropagation(); state.picker = null; rerender(); react(m.id, em); },
            text: em,
          }))));
      }
    }
    return el;
  }

  function focusEditSoon() {
    setTimeout(() => { focusEdit($('#messages')); focusEdit($('#panel-body')); }, 0);
  }

  function editBox(m) {
    const ta = h('textarea', { rows: '2', 'aria-label': 'Edytuj wiadomość', maxlength: '4000' });
    ta.value = state.editDraft != null ? state.editDraft : m.text;
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        saveEdit(m, ta.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        state.editing = null;
        rerender();
      }
    });
    return h('div', { class: 'edit-box' }, ta, h('div', { class: 'edit-hint', text: 'Enter — zapisz, Esc — anuluj, Shift+Enter — nowa linia' }));
  }

  async function saveEdit(m, text) {
    text = text.trim();
    if (!text) { toast('Wiadomość nie może być pusta.'); return; }
    if (text === m.text) { state.editing = null; rerender(); return; }
    const d = await act(() => api('PATCH', '/api/messages/' + m.id, { text }));
    state.editing = null;
    if (d && d.message) updateMessage(d.message); else rerender();
  }

  async function deleteMessage(m) {
    if (!confirm('Usunąć tę wiadomość?')) return;
    const d = await act(() => api('DELETE', '/api/messages/' + m.id));
    if (d) updateMessage(Object.assign({}, m, { deleted: true, text: '', file: null, reactions: [] }));
  }

  async function react(id, emoji) {
    const d = await act(() => api('POST', '/api/messages/' + id + '/reactions', { emoji }));
    if (d && d.message) updateMessage(d.message);
  }

  function reactionPill(m, r) {
    const mine = state.me && r.userIds.includes(state.me.id);
    const names = r.userIds.map((id) => (userById(id) || {}).displayName || '?').join(', ');
    return h('button', {
      type: 'button', class: 'pill' + (mine ? ' mine' : ''), title: names, 'aria-pressed': String(!!mine),
      'aria-label': r.emoji + ' ' + r.count + (mine ? ' (Twoja reakcja)' : ''),
      onclick: () => react(m.id, r.emoji),
    }, r.emoji, h('span', { class: 'count', text: String(r.count) }));
  }

  function fileEl(f) {
    const url = typeof f.url === 'string' && f.url.startsWith('/files/') ? f.url : '#';
    if (/^image\//.test(f.mime || '')) {
      const img = h('img', { src: url, alt: f.name, loading: 'lazy' });
      img.addEventListener('load', () => { if (state.stick) { const b = $('#messages'); b.scrollTop = b.scrollHeight; } });
      return h('a', { class: 'attach-img', href: url, target: '_blank', rel: 'noopener noreferrer', title: f.name }, img);
    }
    return h('a', { class: 'attach-file', href: url, download: f.name, target: '_blank', rel: 'noopener noreferrer' },
      h('span', { 'aria-hidden': 'true', text: '📄' }), h('span', { text: f.name }), h('small', { text: fmtSize(f.size || 0) }));
  }

  // ---------- Aktualizacje wiadomości ----------
  function upsertSorted(list, m) {
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) { list[i] = m; return; }
    let j = list.length;
    while (j > 0 && list[j - 1].id > m.id) j--;
    list.splice(j, 0, m);
  }

  function handleNewMessage(m) {
    upsertUser(m.user && !userById(m.user.id) ? m.user : null);
    clearTyping(m.channelId, m.parentId || 0, m.user.id);
    if (m.parentId) {
      if (state.panel === 'thread' && state.thread && state.thread.parent.id === m.parentId) {
        upsertSorted(state.thread.replies, m);
        renderPanel(true);
      }
      return;
    }
    const ch = getChan(m.channelId);
    if (!ch) { loadChannels(); return; }
    const mine = state.me && m.user.id === state.me.id;
    if (m.channelId === state.currentId) {
      const stick = state.stick || mine;
      upsertSorted(state.messages, m);
      state.stick = stick;
      renderMessages({ bottom: stick });
      if (document.visibilityState === 'visible') markRead();
      else if (!mine) { ch.unreadCount = (ch.unreadCount || 0) + 1; renderSidebar(); }
    } else if (!mine) {
      ch.unreadCount = (ch.unreadCount || 0) + 1;
      renderSidebar();
    }
  }

  function updateMessage(m) {
    let changed = false;
    if (m.channelId === state.currentId && !m.parentId) {
      const i = state.messages.findIndex((x) => x.id === m.id);
      if (i >= 0) { state.messages[i] = m; changed = true; }
    }
    if (state.thread) {
      if (state.thread.parent.id === m.id) { state.thread.parent = m; changed = true; }
      else if (m.parentId === state.thread.parent.id) {
        const i = state.thread.replies.findIndex((x) => x.id === m.id);
        if (i >= 0) { state.thread.replies[i] = m; changed = true; }
      }
    }
    if (changed) {
      if (state.editing && state.editing.id === m.id && m.deleted) state.editing = null;
      rerender();
    }
  }

  // ---------- Wątek / wyszukiwanie ----------
  function closePanel() {
    state.panel = null;
    state.thread = null;
    state.search.results = null;
    state.editing = state.editing && state.editing.ctx === 'thread' ? null : state.editing;
    $('#panel').hidden = true;
  }

  async function openThread(id) {
    const d = await act(() => api('GET', '/api/messages/' + id + '/thread'));
    if (!d) return;
    state.thread = d;
    state.panel = 'thread';
    state.picker = null;
    $('#panel').hidden = false;
    threadComposer.setTarget({ channelId: d.parent.channelId, parentId: d.parent.id }, 'Odpowiedz w wątku…');
    renderPanel(false);
    renderTypingFor();
    const b = $('#panel-body');
    b.scrollTop = b.scrollHeight;
    if (window.matchMedia('(min-width: 760px)').matches) threadComposer.focus();
  }

  function renderPanel(keepScroll) {
    const body = $('#panel-body');
    const top = body.scrollTop;
    const wasBottom = atBottom(body);
    body.replaceChildren();
    $('#panel-composer').hidden = state.panel !== 'thread';
    if (state.panel === 'thread' && state.thread) {
      $('#panel-title').textContent = 'Wątek';
      const t = state.thread;
      body.append(messageEl(t.parent, 'thread', null));
      const n = t.replies.length;
      body.append(h('div', { class: 'thread-sep', text: n + ' ' + plural(n, 'odpowiedź', 'odpowiedzi', 'odpowiedzi') }));
      let prev = null;
      for (const r of t.replies) { body.append(messageEl(r, 'thread', prev)); prev = r; }
      if (keepScroll) body.scrollTop = wasBottom ? body.scrollHeight : top;
      if (state.editing && state.editing.ctx === 'thread') focusEdit(body);
    } else if (state.panel === 'search') {
      $('#panel-title').textContent = 'Wyniki wyszukiwania';
      const res = state.search.results;
      if (!res) body.append(h('div', { class: 'empty', text: 'Szukanie…' }));
      else if (!res.length) body.append(h('div', { class: 'empty', text: 'Brak wyników dla „' + state.search.q + '”.' }));
      else for (const r of res) body.append(resultEl(r));
    }
  }

  function resultEl(r) {
    const ch = getChan(r.channelId);
    const where = ch ? (ch.isDm ? chanLabel(ch) : '#' + ch.name) : (/^dm-\d+-\d+$/.test(r.channelName) ? 'Wiadomość bezpośrednia' : '#' + r.channelName);
    const user = userById(r.user.id) || r.user;
    const text = h('div', { class: 'msg-text' });
    text.innerHTML = formatText(r.text, state.me && state.me.username);
    return h('button', {
      type: 'button', class: 'result',
      onclick: async () => {
        closePanel();
        if (r.channelId !== state.currentId) await openChannel(r.channelId);
        setNavOpen(false);
        if (r.parentId) openThread(r.parentId);
      },
    }, h('div', { class: 'result-meta' }, h('strong', { text: where }), h('span', { text: user.displayName }), h('span', { text: dayLabel(r.createdAt) + ', ' + fmtTime(r.createdAt) })), text);
  }

  let searchTimer = null;
  function onSearchInput() {
    clearTimeout(searchTimer);
    const q = $('#search').value.trim();
    if (q.length < 2) {
      if (state.panel === 'search') closePanel();
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 350);
  }
  async function runSearch(q) {
    state.search = { q, results: null };
    state.panel = 'search';
    state.thread = null;
    $('#panel').hidden = false;
    renderPanel();
    const d = await act(() => api('GET', '/api/search?q=' + encodeURIComponent(q)));
    if (state.search.q !== q || state.panel !== 'search') return;
    state.search.results = d ? d.results : [];
    renderPanel();
  }

  // ---------- Pisanie (typing) ----------
  function typingKey(channelId, parentId) { return channelId + ':' + (parentId || 0); }
  function noteTyping(channelId, parentId, user) {
    if (state.me && user.id === state.me.id) return;
    const key = typingKey(channelId, parentId);
    let m = state.typing.get(key);
    if (!m) { m = new Map(); state.typing.set(key, m); }
    const old = m.get(user.id);
    if (old) clearTimeout(old.timer);
    const timer = setTimeout(() => { m.delete(user.id); renderTypingFor(); }, 4000);
    m.set(user.id, { name: (userById(user.id) || user).displayName, timer });
    renderTypingFor();
  }
  function clearTyping(channelId, parentId, userId) {
    const m = state.typing.get(typingKey(channelId, parentId));
    if (!m || !m.has(userId)) return;
    clearTimeout(m.get(userId).timer);
    m.delete(userId);
    renderTypingFor();
  }
  function typingText(key) {
    const m = state.typing.get(key);
    if (!m || !m.size) return '';
    const names = Array.from(m.values()).map((v) => v.name);
    if (names.length === 1) return names[0] + ' pisze…';
    if (names.length === 2) return names[0] + ' i ' + names[1] + ' piszą…';
    return 'Kilka osób pisze…';
  }
  function renderTypingFor() {
    if (state.currentId != null) mainComposer.setTyping(typingText(typingKey(state.currentId, 0)));
    else mainComposer.setTyping('');
    if (state.thread) threadComposer.setTyping(typingText(typingKey(state.thread.parent.channelId, state.thread.parent.id)));
    else threadComposer.setTyping('');
  }

  // ---------- Kompozytor ----------
  function makeComposer() {
    let target = null;
    let key = '';
    let pending = null;
    let uploading = false;
    let sending = false;
    let lastTyping = 0;
    const drafts = new Map();

    const ta = h('textarea', { class: 'composer-input', rows: '1', 'aria-label': 'Treść wiadomości', maxlength: '4000' });
    const fileInput = h('input', { type: 'file', hidden: true });
    const attachBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Dodaj załącznik', 'aria-label': 'Dodaj załącznik', text: '📎' });
    const sendBtn = h('button', { type: 'button', class: 'send-btn', title: 'Wyślij (Enter)', 'aria-label': 'Wyślij', text: 'Wyślij' });
    const chipBar = h('div', { class: 'grow' });
    const typingEl = h('div', { class: 'typing', 'aria-live': 'polite' });
    const el = h('div', { class: 'composer' }, typingEl,
      h('div', { class: 'composer-box' }, ta, h('div', { class: 'composer-bar' }, attachBtn, chipBar, sendBtn), fileInput));

    function grow() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
    function renderChip(label, removable) {
      chipBar.replaceChildren();
      if (!label) return;
      const chip = h('span', { class: 'file-chip' }, h('span', { text: '📎 ' + label }));
      if (removable) chip.append(h('button', { type: 'button', class: 'icon-btn', title: 'Usuń załącznik', 'aria-label': 'Usuń załącznik', onclick: () => { pending = null; renderChip(null); }, text: '✕' }));
      chipBar.append(chip);
    }

    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      if (f.size > MAX_FILE) { toast('Plik jest za duży (limit 5 MB).'); return; }
      uploading = true;
      renderChip(f.name + ' (wysyłanie…)', false);
      try {
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] || '');
          r.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
          r.readAsDataURL(f);
        });
        const d = await api('POST', '/api/files', { name: f.name, mime: f.type || 'application/octet-stream', dataBase64: b64 });
        pending = d.file;
        renderChip(d.file.name + ' · ' + fmtSize(d.file.size), true);
      } catch (e) {
        pending = null;
        renderChip(null);
        if (e.status !== 401) toast(e.status === 413 ? 'Plik jest za duży (limit 5 MB).' : e.message);
      } finally {
        uploading = false;
      }
    });

    async function send() {
      if (sending || uploading || !target) return;
      const text = ta.value.trim();
      if (!text && !pending) return;
      const tgt = target;
      const body = { text };
      if (tgt.parentId) body.parentId = tgt.parentId;
      if (pending) body.fileId = pending.id;
      sending = true;
      sendBtn.disabled = true;
      try {
        const d = await api('POST', '/api/channels/' + tgt.channelId + '/messages', body);
        if (target === tgt) {
          ta.value = '';
          pending = null;
          renderChip(null);
          grow();
        }
        drafts.delete(typingKey(tgt.channelId, tgt.parentId));
        state.stick = true;
        handleNewMessage(d.message);
      } catch (e) {
        if (e.status !== 401) toast(e.message);
      } finally {
        sending = false;
        sendBtn.disabled = false;
        ta.focus();
      }
    }

    sendBtn.addEventListener('click', send);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    ta.addEventListener('input', () => {
      grow();
      if (!target || !ta.value.trim()) return;
      const now = Date.now();
      if (now - lastTyping >= 3000) {
        lastTyping = now;
        wsSend({ type: 'typing', channelId: target.channelId, parentId: target.parentId || undefined });
      }
    });

    return {
      el,
      focus() { ta.focus(); },
      setTyping(t) { typingEl.textContent = t; },
      setTarget(t, placeholder) {
        if (target) drafts.set(key, { text: ta.value, file: pending });
        target = t;
        key = t ? typingKey(t.channelId, t.parentId) : '';
        const d = drafts.get(key);
        ta.value = d ? d.text : '';
        pending = d ? d.file : null;
        renderChip(pending ? pending.name + ' · ' + fmtSize(pending.size) : null, !!pending);
        ta.placeholder = placeholder || '';
        ta.disabled = !t;
        sendBtn.disabled = !t;
        grow();
      },
    };
  }

  const mainComposer = makeComposer();
  const threadComposer = makeComposer();

  // ---------- Modale ----------
  let modalState = null;
  function closeModal() {
    if (!modalState) return;
    modalState.back.remove();
    const prev = modalState.prevFocus;
    modalState = null;
    if (prev && prev.focus && document.contains(prev)) prev.focus();
  }
  function openModal(title, build) {
    closeModal();
    const prevFocus = document.activeElement;
    const back = h('div', { class: 'modal-backdrop' });
    back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
    const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    dlg.append(h('h2', { text: title }));
    back.append(dlg);
    $('#modal-root').append(back);
    modalState = { back, prevFocus };
    const focusEl = build(dlg, closeModal);
    setTimeout(() => { if (focusEl) focusEl.focus(); }, 0);
  }

  function normalizeChannelName(v) {
    return v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  }

  function openCreateChannelModal() {
    openModal('Utwórz kanał', (dlg, close) => {
      const name = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', placeholder: 'np. projekt-alfa' });
      name.addEventListener('input', () => {
        const pos = name.selectionStart;
        const n = normalizeChannelName(name.value);
        if (n !== name.value) { name.value = n; try { name.setSelectionRange(pos, pos); } catch (e) { /* ignoruj */ } }
      });
      const topic = h('input', { type: 'text', maxlength: '250', autocomplete: 'off' });
      const priv = h('input', { type: 'checkbox', id: 'cc-private' });
      const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const form = h('form', { novalidate: true },
        h('label', { class: 'field' }, 'Nazwa kanału', name),
        h('label', { class: 'field' }, 'Temat (opcjonalnie)', topic),
        h('div', { class: 'check' }, priv, h('label', { for: 'cc-private', text: 'Kanał prywatny (🔒 tylko dla zaproszonych)' })),
        err,
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', onclick: close, text: 'Anuluj' }),
          h('button', { type: 'submit', class: 'btn primary', text: 'Utwórz' })));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const n = normalizeChannelName(name.value);
        if (!n || !/^[a-z0-9]/.test(n)) { err.textContent = 'Nazwa musi zaczynać się od litery lub cyfry (a–z, 0–9, - i _).'; err.hidden = false; return; }
        try {
          const d = await api('POST', '/api/channels', { name: n, topic: topic.value.trim(), isPrivate: priv.checked });
          upsertChannel(d.channel);
          close();
          renderSidebar();
          openChannel(d.channel.id);
        } catch (ex) {
          if (ex.status !== 401) { err.textContent = ex.message; err.hidden = false; }
        }
      });
      dlg.append(form);
      return name;
    });
  }

  async function openBrowseModal() {
    const d = await act(() => api('GET', '/api/channels/browse'));
    if (!d) return;
    openModal('Przeglądaj kanały', (dlg, close) => {
      const list = h('ul', { class: 'list' });
      if (!d.channels.length) list.append(h('li', { class: 'empty', text: 'Brak kanałów publicznych.' }));
      for (const c of d.channels) {
        const joined = getChan(c.id) != null || c.isMember;
        const btn = h('button', { type: 'button', class: 'btn small' + (joined ? '' : ' primary'), text: joined ? 'Otwórz' : 'Dołącz' });
        btn.addEventListener('click', async () => {
          if (joined && getChan(c.id)) { close(); openChannel(c.id); return; }
          const r = await act(() => api('POST', '/api/channels/' + c.id + '/join'));
          if (!r) return;
          upsertChannel(r.channel);
          close();
          renderSidebar();
          openChannel(r.channel.id);
        });
        list.append(h('li', null, h('div', { class: 'list-row' },
          h('div', { class: 'grow' }, h('b', { text: '# ' + c.name }), h('small', { text: (c.topic ? c.topic + ' · ' : '') + c.memberCount + ' ' + plural(c.memberCount, 'członek', 'członków', 'członków') })),
          btn)));
      }
      dlg.append(list, h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn', onclick: close, text: 'Zamknij' })));
    });
  }

  function userRow(u, onPick) {
    return h('li', null, h('button', { type: 'button', class: 'list-row', onclick: () => onPick(u) },
      avatar(u, 'm', true),
      h('div', { class: 'grow' }, h('b', { text: u.displayName + (state.me && u.id === state.me.id ? ' (Ty)' : '') }), h('small', { text: '@' + u.username + (u.status ? ' · ' + u.status : '') }))));
  }

  function pickUserModal(title, users, onPick) {
    openModal(title, (dlg, close) => {
      const filter = h('input', { type: 'search', placeholder: 'Szukaj osoby', 'aria-label': 'Szukaj osoby', autocomplete: 'off' });
      const list = h('ul', { class: 'list' });
      const draw = () => {
        const q = filter.value.trim().toLowerCase();
        const items = users.filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
        list.replaceChildren(...(items.length ? items.map((u) => userRow(u, (x) => { close(); onPick(x); })) : [h('li', { class: 'empty', text: 'Nie znaleziono osób.' })]));
      };
      filter.addEventListener('input', draw);
      draw();
      dlg.append(h('div', { class: 'field' }, filter), list,
        h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn', onclick: close, text: 'Anuluj' })));
      return filter;
    });
  }

  function openDmModal() {
    const users = Array.from(state.users.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, 'pl'));
    pickUserModal('Nowa wiadomość bezpośrednia', users, async (u) => {
      const d = await act(() => api('POST', '/api/dms', { userId: u.id }));
      if (!d) return;
      if (!getChan(d.channel.id)) upsertChannel(d.channel);
      renderSidebar();
      openChannel(d.channel.id);
    });
  }

  async function openAddPersonModal(c) {
    const d = await act(() => api('GET', '/api/channels/' + c.id + '/members'));
    if (!d) return;
    const memberIds = new Set(d.users.map((u) => u.id));
    const users = Array.from(state.users.values()).filter((u) => !memberIds.has(u.id)).sort((a, b) => a.displayName.localeCompare(b.displayName, 'pl'));
    if (!users.length) { toast('Wszyscy użytkownicy są już w tym kanale.'); return; }
    pickUserModal('Dodaj osobę do #' + c.name, users, async (u) => {
      const r = await act(() => api('POST', '/api/channels/' + c.id + '/members', { userId: u.id }));
      if (r) { toast('Dodano: ' + u.displayName); refreshMemberCount(c.id); }
    });
  }

  async function refreshMemberCount(channelId) {
    try {
      const d = await api('GET', '/api/channels/' + channelId + '/members');
      const c = getChan(channelId);
      if (c) { c.memberCount = d.users.length; d.users.forEach(upsertUser); if (channelId === state.currentId) renderHeader(); }
    } catch (e) { /* ignoruj */ }
  }

  function openProfileModal() {
    openModal('Edytuj profil', (dlg, close) => {
      const name = h('input', { type: 'text', maxlength: '40', value: state.me.displayName });
      const status = h('input', { type: 'text', maxlength: '100', value: state.me.status || '', placeholder: 'np. Pracuję zdalnie' });
      const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const form = h('form', { novalidate: true },
        h('label', { class: 'field' }, 'Wyświetlana nazwa', name),
        h('label', { class: 'field' }, 'Status', status),
        err,
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', onclick: close, text: 'Anuluj' }),
          h('button', { type: 'submit', class: 'btn primary', text: 'Zapisz' })));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dn = name.value.trim();
        if (!dn) { err.textContent = 'Nazwa nie może być pusta.'; err.hidden = false; return; }
        try {
          const d = await api('PATCH', '/api/me', { displayName: dn, status: status.value.trim() });
          upsertUser(d.user);
          close();
          refreshAllViews();
        } catch (ex) {
          if (ex.status !== 401) { err.textContent = ex.message; err.hidden = false; }
        }
      });
      dlg.append(form);
      return name;
    });
  }

  function refreshAllViews() {
    renderProfile();
    renderSidebar();
    renderHeader();
    if (state.currentId != null) renderMessages();
    if (state.panel) renderPanel(true);
  }

  // ---------- WebSocket ----------
  function wsSend(obj) {
    if (state.ws && state.ws.readyState === 1) {
      try { state.ws.send(JSON.stringify(obj)); } catch (e) { /* ignoruj */ }
    }
  }
  function closeWs() {
    clearInterval(state.pingTimer);
    clearTimeout(state.reconnectTimer);
    const ws = state.ws;
    state.ws = null;
    if (ws) { try { ws.close(); } catch (e) { /* ignoruj */ } }
  }
  function connectWs() {
    if (!state.token) return;
    clearTimeout(state.reconnectTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws?token=' + encodeURIComponent(state.token));
    state.ws = ws;
    ws.onopen = () => {
      state.backoff = 1;
      clearInterval(state.pingTimer);
      state.pingTimer = setInterval(() => wsSend({ type: 'ping' }), 25000);
      if (state.wsEverOpen) refreshAfterReconnect();
      state.wsEverOpen = true;
    };
    ws.onmessage = (e) => {
      let d;
      try { d = JSON.parse(e.data); } catch (err) { return; }
      if (d && d.type) onWs(d);
    };
    ws.onclose = (ev) => {
      clearInterval(state.pingTimer);
      if (state.ws !== ws) return;
      state.ws = null;
      if (!state.token) return;
      if (ev.code === 4001) { logout(true); return; }
      const delay = state.backoff * 1000;
      state.backoff = Math.min(state.backoff * 2, 15);
      state.reconnectTimer = setTimeout(connectWs, delay);
    };
    ws.onerror = () => { /* onclose obsłuży ponowne łączenie */ };
  }

  async function refreshAfterReconnect() {
    await loadUsers();
    await loadChannels();
    renderTypingFor();
    await reloadCurrent();
  }

  function onWs(ev) {
    switch (ev.type) {
      case 'hello':
        upsertUser(ev.user);
        renderProfile();
        break;
      case 'message.created':
        handleNewMessage(ev.message);
        break;
      case 'message.updated':
        updateMessage(ev.message);
        break;
      case 'channel.created': {
        const c = ev.channel;
        if (c.isMember === false) break;
        upsertChannel(c);
        renderSidebar();
        break;
      }
      case 'channel.updated': {
        const c = ev.channel;
        const old = getChan(c.id);
        if (old) {
          const unread = c.id === state.currentId ? 0 : c.unreadCount;
          upsertChannel(Object.assign({}, old, c, { unreadCount: unread }));
        } else if (c.isMember !== false) upsertChannel(c);
        renderSidebar();
        if (c.id === state.currentId && !state.editingTopic) renderHeader();
        break;
      }
      case 'channel.member_joined':
        upsertUser(ev.user);
        if (getChan(ev.channelId)) refreshMemberCount(ev.channelId);
        break;
      case 'presence': {
        const u = userById(ev.userId);
        if (u) u.online = !!ev.online; else loadUsers().then(refreshAllViews);
        renderProfile();
        renderSidebar();
        renderHeader();
        break;
      }
      case 'typing':
        upsertUser(!userById(ev.user.id) ? ev.user : null);
        noteTyping(ev.channelId, ev.parentId || 0, ev.user);
        break;
      case 'user.updated':
        upsertUser(ev.user);
        sortChannels();
        refreshAllViews();
        break;
      default:
        break;
    }
  }

  // ---------- Zdarzenia interfejsu ----------
  function bindUi() {
    $('#tab-login').addEventListener('click', () => setAuthMode('login'));
    $('#tab-register').addEventListener('click', () => setAuthMode('register'));
    $('#auth-form').addEventListener('submit', submitAuth);
    $('#logout-btn').addEventListener('click', () => logout(false));
    $('#profile-btn').addEventListener('click', openProfileModal);
    $('#add-channel').addEventListener('click', openCreateChannelModal);
    $('#browse-btn').addEventListener('click', openBrowseModal);
    $('#add-dm').addEventListener('click', openDmModal);
    $('#panel-close').addEventListener('click', () => { closePanel(); if (state.search) $('#search').value = state.panel === 'search' ? $('#search').value : $('#search').value; });
    $('#scrim').addEventListener('click', () => setNavOpen(false));
    $('#search').addEventListener('input', onSearchInput);
    $('#search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); const q = $('#search').value.trim(); if (q.length >= 2) runSearch(q); }
      else if (e.key === 'Escape') { $('#search').value = ''; if (state.panel === 'search') closePanel(); }
    });
    $('#composer-slot').append(mainComposer.el);
    $('#panel-composer').append(threadComposer.el);

    const box = $('#messages');
    box.addEventListener('scroll', () => {
      state.stick = atBottom(box);
      if (box.scrollTop < 80) loadOlder();
    });

    document.addEventListener('click', (e) => {
      if (state.picker && !e.target.closest('.emoji-picker') && !e.target.closest('.act-react')) {
        state.picker = null;
        rerender();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (modalState) { e.preventDefault(); closeModal(); return; }
      if (state.picker) { state.picker = null; rerender(); return; }
      if (state.editing) { state.editing = null; rerender(); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') markRead();
    });
    window.addEventListener('hashchange', () => {
      if (!state.me) return;
      const m = /^#\/c\/(\d+)$/.exec(location.hash);
      if (m && Number(m[1]) !== state.currentId && getChan(Number(m[1]))) openChannel(Number(m[1]));
    });
  }

  // ---------- Inicjalizacja ----------
  async function init() {
    bindUi();
    setAuthMode('login');
    const tok = getToken();
    if (!tok) { showAuth(); return; }
    state.token = tok;
    try {
      const d = await api('GET', '/api/me', undefined, { noLogout: true });
      await enterApp(d.user);
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        state.token = null;
        setToken(null);
      }
      showAuth();
      if (e.network) showAuthError(e.message);
    }
  }

  init();
})();
