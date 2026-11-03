// E2E Kanalik. Uruchom: node _orkiestracja/out/e2e.js (z katalogu /home/user/kanalik)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = '/home/user/kanalik';
const OUT = path.join(ROOT, '_orkiestracja/out');
const SHOTS = path.join(OUT, 'shots');
const TMP = '/tmp/claude-0/e2e';
const BASE = 'http://localhost:3100';
const RUN = Date.now().toString(36);
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const results = [];
const consoleErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario(n, name, fn) {
  try {
    const evidence = await fn();
    results.push({ n, name, ok: true, evidence: evidence || '' });
    console.log('PASS', n, name, '-', evidence || '');
  } catch (e) {
    results.push({ n, name, ok: false, evidence: String(e.message || e).split('\n')[0] });
    console.log('FAIL', n, name, '-', String(e.message || e).split('\n')[0]);
  }
}

async function login(page, user, pass = 'haslo123') {
  await page.goto(BASE + '/');
  await page.waitForSelector('#auth:not([hidden])');
  await page.fill('#f-username', user);
  await page.fill('#f-password', pass);
  await page.click('#auth-submit');
  await page.waitForSelector('#app:not([hidden])');
}
const chan = (page, name) => page.locator('#channel-list .nav-item', { has: page.locator('.nav-name', { hasText: new RegExp('^' + name + '$') }) });
async function openChan(page, name) { await chan(page, name).click(); await page.waitForTimeout(300); }
async function send(page, text, sel = '#composer-slot') {
  const ta = page.locator(sel + ' .composer-input');
  await ta.fill(text);
  await ta.press('Enter');
}
const msgRow = (page, text, scope = '#messages') => page.locator(scope + ' .msg', { hasText: text }).first();

(async () => {
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '3100', DB_PATH: TMP + '/k.db', UPLOADS_DIR: TMP + '/up' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let slog = '';
  server.stdout.on('data', (d) => (slog += d));
  server.stderr.on('data', (d) => (slog += d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch {}
    await sleep(200);
  }

  const browser = await chromium.launch();
  try {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const A = await ctxA.newPage(), B = await ctxB.newPage();
    for (const [who, p] of [['anna', A], ['bartek', B]]) {
      p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${who}] ${m.text()}`); });
      p.on('pageerror', (e) => consoleErrors.push(`[${who}] pageerror: ${e.message}`));
      p.on('dialog', (d) => d.accept());
    }

    // login screen shot
    await A.goto(BASE + '/');
    await A.waitForSelector('#auth:not([hidden])');
    await A.screenshot({ path: SHOTS + '/01-login.png' });

    await scenario(1, 'Logowanie anna i bartek; #ogolny z wiadomościami seed', async () => {
      await login(A, 'anna'); await login(B, 'bartek');
      for (const p of [A, B]) {
        await p.waitForSelector('#messages .msg');
        const title = await p.locator('#chan-header').innerText();
        if (!/ogolny/.test(title)) throw new Error('nagłówek: ' + title);
      }
      const nA = await A.locator('#messages .msg').count(), nB = await B.locator('#messages .msg').count();
      if (nA < 3 || nB < 3) throw new Error(`za mało wiadomości seed: ${nA}/${nB}`);
      await A.screenshot({ path: SHOTS + '/02-anna-main.png' });
      return `#ogolny, wiadomości: anna=${nA}, bartek=${nB}`;
    });

    await scenario(2, 'Wiadomość Anny u Bartka < 1 s', async () => {
      const text = 'Cześć Bartek ' + RUN;
      const t0 = Date.now();
      await send(A, text);
      await B.waitForFunction((t) => document.querySelector('#messages').innerText.includes(t), text, { timeout: 5000, polling: 20 });
      const dt = Date.now() - t0;
      if (dt >= 1000) throw new Error('czas ' + dt + ' ms');
      return `dostarczono w ${dt} ms`;
    });

    await scenario(3, 'Badge nieprzeczytanych przy ogolny, znika po wejściu', async () => {
      await openChan(B, 'luzne-rozmowy');
      await send(A, 'Nieprzeczytana ' + RUN);
      const badge = chan(B, 'ogolny').locator('.badge');
      await badge.waitFor({ timeout: 3000 });
      const v = await badge.innerText();
      await openChan(B, 'ogolny');
      await B.waitForTimeout(500);
      const n = await chan(B, 'ogolny').locator('.badge').count();
      if (n !== 0) throw new Error('badge nie zniknął');
      return `badge=${v}, po wejściu zniknął`;
    });

    await scenario(4, 'Wskaźnik pisania', async () => {
      await A.waitForTimeout(3500); // klient throttluje sygnał typing do 1/3 s (lastTyping nie jest zerowany po wysłaniu)
      await A.locator('#composer-slot .composer-input').pressSequentially('piszę coś', { delay: 30 });
      await B.waitForFunction(() => /pisze/.test(document.querySelector('#composer-slot .typing').textContent), null, { timeout: 3000 });
      const t = await B.locator('#composer-slot .typing').innerText();
      await A.locator('#composer-slot .composer-input').fill('');
      return 'u Bartka: "' + t + '"';
    });

    const reactText = 'Reakcja-wątek ' + RUN;
    await scenario(5, 'Reakcja 👍 Bartka widoczna u Anny z licznikiem 1', async () => {
      await send(A, reactText);
      await msgRow(B, reactText).waitFor();
      const row = msgRow(B, reactText);
      await row.hover();
      await row.locator('.act-react').click();
      await B.locator('.emoji-picker button', { hasText: '👍' }).first().click();
      const pill = msgRow(A, reactText).locator('.pill');
      await pill.waitFor({ timeout: 3000 });
      const txt = (await pill.innerText()).replace(/\s+/g, '');
      if (!/👍1/.test(txt)) throw new Error('pigułka: ' + txt);
      return 'pigułka u Anny: ' + txt;
    });

    await scenario(6, 'Wątek: odpowiedź Bartka → Anna widzi "1 odpowiedź" i treść', async () => {
      const row = msgRow(B, reactText);
      await row.hover();
      await row.locator('button[aria-label="Odpowiedz w wątku"]').click();
      await B.waitForSelector('#panel:not([hidden]) .composer-input');
      await send(B, 'Odpowiedź w wątku ' + RUN, '#panel-composer');
      const link = msgRow(A, reactText).locator('.reply-link');
      await link.waitFor({ timeout: 3000 });
      const t = (await link.innerText());
      if (!/1 odpowiedź/.test(t)) throw new Error('link: ' + t);
      await link.click();
      await A.waitForSelector('#panel:not([hidden])');
      await A.waitForFunction((x) => document.querySelector('#panel-body').innerText.includes(x), 'Odpowiedź w wątku ' + RUN);
      await A.screenshot({ path: SHOTS + '/03-anna-thread.png' });
      return 'link: "' + t.split('\n')[0] + '", treść w panelu';
    });
    await A.click('#panel-close'); await B.click('#panel-close');

    await scenario(7, 'Edycja i usunięcie wiadomości Anny widoczne u Bartka', async () => {
      const orig = 'Do edycji ' + RUN;
      await send(A, orig);
      await msgRow(B, orig).waitFor();
      const row = msgRow(A, orig);
      await row.hover();
      await row.locator('button[aria-label="Edytuj wiadomość"]').click();
      const ta = A.locator('#messages .edit-box textarea');
      await ta.fill('Po edycji ' + RUN);
      await ta.press('Enter');
      const rb = msgRow(B, 'Po edycji ' + RUN);
      await rb.waitFor({ timeout: 3000 });
      if (!/\(edytowano\)/.test(await rb.innerText())) throw new Error('brak (edytowano)');
      const ra = msgRow(A, 'Po edycji ' + RUN);
      await ra.hover();
      await ra.locator('button[aria-label="Usuń wiadomość"]').click();
      await B.waitForFunction(() => document.querySelector('#messages').innerText.includes('Ta wiadomość została usunięta.'), null, { timeout: 3000 });
      if (await B.locator('#messages').innerText().then((t) => t.includes('Po edycji ' + RUN))) throw new Error('tekst nadal widoczny');
      return '(edytowano) i "Ta wiadomość została usunięta." u Bartka';
    });

    const newCh = 'projekt-' + RUN;
    await scenario(8, 'Anna tworzy kanał, Bartek dołącza przez Przeglądaj kanały', async () => {
      await A.click('#add-channel');
      await A.fill('.modal input[type=text] >> nth=0', newCh);
      await A.click('.modal button[type=submit]');
      await A.waitForFunction((n) => document.querySelector('#chan-header').innerText.includes(n), newCh);
      await B.click('#browse-btn');
      const row = B.locator('.modal .list-row', { hasText: newCh });
      await row.waitFor();
      await row.locator('button').click();
      await B.waitForFunction((n) => document.querySelector('#chan-header').innerText.includes(n), newCh);
      await send(A, 'witaj w nowym ' + RUN);
      await msgRow(B, 'witaj w nowym ' + RUN).waitFor({ timeout: 3000 });
      return `kanał #${newCh}, Bartek dołączył i widzi wiadomość Anny`;
    });

    await scenario(9, 'DM Anna → Bartek', async () => {
      await A.click('#add-dm');
      await A.locator('.modal .list-row', { hasText: 'Bartek' }).click();
      await A.waitForSelector('#dm-list .nav-item');
      const t = 'DM-tajne ' + RUN;
      await send(A, t);
      await B.locator('#dm-list .nav-item').first().waitFor({ timeout: 3000 });
      const nm = await B.locator('#dm-list .nav-item').first().innerText();
      if (!/Anna/.test(nm)) throw new Error('DM w sidebarze: ' + nm);
      await B.locator('#dm-list .nav-item').first().click();
      await msgRow(B, t).waitFor({ timeout: 3000 });
      return 'DM w sidebarze Bartka: "' + nm.replace(/\s+/g, ' ') + '", wiadomość widoczna';
    });

    await scenario(10, 'Wyszukiwanie → wyniki w panelu, klik przenosi do kanału', async () => {
      await openChan(A, 'luzne-rozmowy');
      await A.fill('#search', 'Nieprzeczytana ' + RUN);
      await A.locator('#panel .result').first().waitFor({ timeout: 4000 });
      const n = await A.locator('#panel .result').count();
      await A.screenshot({ path: SHOTS + '/04-search.png' });
      await A.locator('#panel .result').first().click();
      await A.waitForFunction(() => /ogolny/.test(document.querySelector('#chan-header').innerText), null, { timeout: 3000 });
      return `wyników: ${n}, przeniesiono do #ogolny`;
    });
    await A.fill('#search', ''); 
    if (await A.locator('#panel:not([hidden])').count()) await A.click('#panel-close');

    await scenario(11, 'Upload PNG → miniatura u obu', async () => {
      await openChan(A, 'ogolny'); await openChan(B, 'ogolny');
      // 1x1 PNG
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      const f = TMP + '/pixel-' + RUN + '.png';
      fs.writeFileSync(f, png);
      await A.locator('#composer-slot input[type=file]').setInputFiles(f);
      await A.waitForSelector('#composer-slot .file-chip button');
      await A.locator('#composer-slot .composer-input').fill('obrazek ' + RUN);
      await A.locator('#composer-slot .composer-input').press('Enter');
      for (const [who, p] of [['anna', A], ['bartek', B]]) {
        const img = msgRow(p, 'obrazek ' + RUN).locator('img');
        await img.waitFor({ timeout: 4000 });
        const ok = await img.evaluate((i) => new Promise((r) => (i.complete ? r(i.naturalWidth > 0) : (i.onload = () => r(true), i.onerror = () => r(false)))));
        if (!ok) throw new Error('obraz nie załadowany u ' + who);
      }
      return 'img załadowany u obu';
    });

    await scenario(12, 'XSS: tekst dosłownie, brak wykonania', async () => {
      const p1 = '<img src=x onerror="window.__xss=1">', p2 = '<script>window.__xss=1</script>';
      await send(A, p1); await send(A, p2);
      await B.waitForFunction((t) => document.querySelector('#messages').innerText.includes(t), p2, { timeout: 3000 });
      await A.waitForTimeout(300);
      for (const [who, p] of [['anna', A], ['bartek', B]]) {
        const x = await p.evaluate(() => window.__xss);
        if (x !== undefined) throw new Error('window.__xss=' + x + ' u ' + who);
        const txt = await p.locator('#messages').innerText();
        if (!txt.includes(p1) || !txt.includes(p2)) throw new Error('tekst nie widoczny dosłownie u ' + who);
        if (await p.locator('#messages img[src="x"]').count()) throw new Error('wstrzyknięty <img> u ' + who);
      }
      // po przeładowaniu (historia z REST)
      await B.reload(); await B.waitForSelector('#messages .msg');
      if ((await B.evaluate(() => window.__xss)) !== undefined) throw new Error('XSS po reload');
      return 'window.__xss undefined u obu (też po reload), tekst dosłowny';
    });

    await scenario(13, 'Obecność: zamknięcie strony Bartka → kropka offline u Anny', async () => {
      await A.click('#add-dm').catch(() => {});
      await A.keyboard.press('Escape');
      const dot = A.locator('#dm-list .nav-item', { hasText: 'Bartek' }).locator('.dot');
      await dot.waitFor();
      // Bartek musi być online (po reload)
      await A.waitForFunction(() => document.querySelector('#dm-list .dot.online'), null, { timeout: 4000 });
      await B.close();
      await A.waitForFunction(() => !document.querySelector('#dm-list .dot.online'), null, { timeout: 5000 });
      return 'kropka online → offline po zamknięciu karty Bartka';
    });

    await scenario(14, 'Mobile 390x844: sidebar schowany, ☰ otwiera, brak poziomego scrolla', async () => {
      const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const M = await ctxM.newPage();
      M.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[mobile] ' + m.text()); });
      M.on('pageerror', (e) => consoleErrors.push('[mobile] pageerror: ' + e.message));
      await login(M, 'anna'); await M.waitForSelector('#messages .msg');
      const vis = () => M.locator('#sidebar').evaluate((e) => { const r = e.getBoundingClientRect(); return r.right > 5 && r.left < 385; });
      if (await vis()) throw new Error('sidebar widoczny domyślnie');
      const sw = await M.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sw > 0) throw new Error('poziomy scroll ' + sw + 'px');
      await M.screenshot({ path: SHOTS + '/05-mobile.png' });
      await M.click('.menu-btn');
      await M.waitForTimeout(500);
      if (!(await vis())) throw new Error('☰ nie otwiera sidebara');
      await M.screenshot({ path: SHOTS + '/06-mobile-nav.png' });
      await ctxM.close();
      return 'sidebar ukryty, ☰ otwiera, scrollWidth-clientWidth=' + sw;
    });

    await scenario(15, 'Wylogowanie i rejestracja nowego konta → #ogolny', async () => {
      await A.click('#logout-btn');
      await A.waitForSelector('#auth:not([hidden])');
      await A.click('#tab-register');
      const u = 'nowy' + RUN.slice(-5);
      await A.fill('#f-username', u);
      await A.fill('#f-display', 'Nowy Użytkownik');
      await A.fill('#f-password', 'tajne123');
      await A.click('#auth-submit');
      await A.waitForSelector('#app:not([hidden])');
      await A.waitForFunction(() => /ogolny/.test(document.querySelector('#chan-header').innerText), null, { timeout: 4000 });
      await A.screenshot({ path: SHOTS + '/07-register-ogolny.png' });
      return `konto ${u} utworzone, widok #ogolny`;
    });
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(500);
  }

  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  const md = [];
  md.push('# T5 — E2E w przeglądarce (Playwright)\n');
  md.push(`Wynik: **${pass} PASS / ${fail} FAIL** (${results.length} scenariuszy). Skrypt: \`_orkiestracja/out/e2e.js\`, serwer na :3100, baza w ${TMP}.\n`);
  md.push('| # | Scenariusz | Wynik | Dowód |\n|---|---|---|---|');
  for (const r of results) md.push(`| ${r.n} | ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.evidence.replace(/\|/g, '/')} |`);
  md.push('\n## Błędy konsoli / pageerror\n');
  md.push(consoleErrors.length ? consoleErrors.map((e) => '- ' + e).join('\n') : 'Brak.');
  md.push('\n## Zrzuty\n\n' + fs.readdirSync(SHOTS).sort().map((f) => '- shots/' + f).join('\n'));
  fs.writeFileSync(OUT + '/T5.md', md.join('\n') + '\n');
  console.log(`\n${pass} PASS / ${fail} FAIL; console errors: ${consoleErrors.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
