# R2-REV — Niezależna recenzja zmian R2 (gotowość do internetu)

Recenzent: niezależny, tylko odczyt. Data: 2026-11-04.
Zakres: zmiany R2 (bilety WS, hashowane sesje z wygasaniem, `logout-all`, kwota i sprzątanie plików, zmienne wdrożeniowe, frontend biletów i profilu), na tle `briefs/R2.md` (KONTRAKT v2) i `out/T6.md`. Pliki Dockera pominięto (inny agent je zmienia). Odczytano z nich tylko dwie wartości (`TRUST_PROXY: "1"`, port `127.0.0.1:3000`), żeby opisać ryzyko konfiguracji.

## Metoda
- `npm test` (z `TMPDIR=/tmp/claude-0/r2rev/tmp`): **84/84 pass**.
- Własne instancje `start({port:3500, dbPath:/tmp/claude-0/r2rev/<x>/k.db, ...})`, uruchamiane w procesie albo jako osobny proces (do pomiaru RSS przez `/proc/<pid>/status`). Wszystkie zatrzymane.
- Skrypty sond leżą w `/tmp/claude-0/-home-user/a4327937-42fa-5a48-8e9f-5fa1a09e6e77/scratchpad/r2rev/`:
  - `p1.js`: bilety, `?token=`, wyścig biletu, logout, logout-all, brak jawnego tokenu w DB i WAL
  - `p2.js`, `flood.js`: zalew `POST /api/ws-ticket`
  - `p3.js`: wyścig kwoty, plik współdzielony, sieroty, traversal
  - `p4.js`: `TRUST_PROXY`, wygaśnięcie sesji, heartbeat
  - `p5.js`: migracja bazy z kodu R1 (`/tmp/claude-0/r2old`)
  - `p6.js`: wiele kont kontra kwota, wiele socketów
  - `p7.js`, `p7b.js`: pamięć przy równoległych uploadach
  - `p8.js`: pliki z wiadomości usuniętych przed R2
  - `p9.js`: wygaśnięcie biletu, nagłówki
  - `sig.js`: `server.js` z SIGTERM i SEED=false
  - `storm.js`: prawdziwy frontend w Chromium (Playwright)
- **POTWIERDZONE** = odtworzone skryptem (wynik podany). **PRAWDOPODOBNE** = wynika z kodu, nie odtworzone na żywo.

## Podsumowanie
Rdzeń R2 jest zrobiony poprawnie i wytrzymał wszystkie próby:
- bilety są naprawdę jednorazowe (także przy wyścigu dwóch połączeń), wygasają i są związane z sesją;
- `?token=` jest odrzucany;
- w bazie i w pliku WAL nie ma jawnego tokenu;
- wygasłej sesji nie da się przedłużyć;
- migracja z bazy R1 działa;
- wyścig kwoty jest zamknięty (drugi check i INSERT są synchroniczne);
- usuwanie pliku przy kasowaniu wiadomości nie rusza pliku używanego gdzie indziej.

**Krytycznych luk w uwierzytelnianiu ani wycieku danych nie znaleziono.** Przed wystawieniem w internecie blokują jednak trzy sprawy dostępności i nadużyć:
- (W1) DoS pamięci bez logowania przez `POST /api/files` (problem sprzed R2, ale niezałatany);
- (W2) burza żądań z frontendu, gdy bilety są stale odrzucane;
- (W3) otwarta rejestracja, przez którą kwota per użytkownik nie chroni dysku.

Do tego dochodzi ryzyko konfiguracji `TRUST_PROXY` (W4).

---

## Krytyczne

Brak.

---

## Ważne

### W1. DoS pamięci bez logowania: parser JSON 8 MB dla `POST /api/files` działa przed autoryzacją i przed kwotą — POTWIERDZONE
- **Plik:linia:** `src/app.js:70-72` (globalny `bigJson` dla `POST /api/files`, zamontowany przed `app.use('/api', api)` w `:75`, więc przed `auth` z `src/routes.js:128`); `src/routes.js:444-449` (limit 5 MB i kwota sprawdzane dopiero po sparsowaniu całego body i `Buffer.from(base64)`).
- **Scenariusz:** atakujący bez konta wysyła równolegle wiele żądań `POST /api/files` z body około 6,7 MB. Każde jest w całości buforowane i parsowane (string plus obiekt), a dopiero potem dostaje 401. Zalogowany użytkownik z wyczerpaną kwotą robi to samo i dostaje 413. Wolne wysyłanie body (Node `requestTimeout` to 300 s) pozwala trzymać tę pamięć długo przy małym paśmie. Kontener z limitem 1–2 GB dostaje OOM-kill.
- **Dowód (`p7b.js`, `p7.js`):**
  - bez autoryzacji, 80 równoległych żądań: wszystkie 401, RSS serwera **81 → 1083 MB** (VmHWM);
  - bez autoryzacji, kolejne 150 żądań: wszystkie 401, RSS **1769 MB**;
  - użytkownik z kwotą 1 MB, 80 żądań: wszystkie 413, VmHWM **1045 MB**.
- **Poprawka:**
  1. Dla `/api/files` najpierw `auth`, potem parser: wyjąć `auth` z routera (eksport) i zamontować `app.post('/api/files', auth, preQuota, bigJson, handler)`. `preQuota` odrzuca 413 na podstawie `Content-Length`: brak nagłówka albo więcej niż `ceil(MAX_FILE*4/3)+1 KB`, albo `usedBytes + Content-Length*3/4 > quota`.
  2. Limit równoległych uploadów: na użytkownika (np. 2) i globalny (np. 8). Powyżej limitu 429.
  3. Docelowo upload strumieniowy (`express.raw` albo `req.pipe` do pliku tymczasowego z licznikiem bajtów i przerwaniem po `min(MAX_FILE, quota - used)`) zamiast base64 w JSON.
  4. W README i Caddyfile dodać `request_body { max_size 8MB }`. To ogranicza rozmiar, nie liczbę żądań.

### W2. Frontend: pętla reconnectów bez opóźnienia, gdy serwer stale odrzuca bilet (kod 4001) — POTWIERDZONE
- **Plik:linia:** `public/app.js:1352-1354` (`onopen` zeruje `state.ticketRetried` i `backoff`), `public/app.js:1370-1375` (4001 → natychmiast `connectWs()` bez opóźnienia), `src/realtime.js:69-74`. Serwer robi `handleUpgrade`, a dopiero potem `close(4001)`, więc przeglądarka **zawsze dostaje `open` przed `close(4001)`**.
- **Opis:** zabezpieczenie „spróbuj raz, potem wyloguj” nigdy nie zadziała, bo `onopen` kasuje flagę przed nadejściem 4001. Każdy cykl wygląda tak:
  1. `POST /api/ws-ticket`;
  2. upgrade WS;
  3. `refreshAfterReconnect()` (`/api/users`, `/api/channels`, wiadomości bieżącego kanału).

  Wszystko to dzieje się bez żadnego opóźnienia. Wyzwalacze to każda sytuacja, w której bilet jest stale nieważny przy ważnej sesji:
  - więcej niż jedna instancja aplikacji (bilety żyją w pamięci procesu; `docker compose --scale`, load balancer, k8s);
  - proxy, które gubi query string na ścieżce `/ws`;
  - przyszły błąd po stronie serwera.

  Każda otwarta karta każdego użytkownika zamienia się wtedy w generator obciążenia.
- **Dowód (`storm.js`, prawdziwy `public/app.js` w Chromium, logowanie przez formularz):**
  - tryb normalny: 0 dodatkowych żądań w 5 s;
  - tryb z odrzucaniem biletu (upgrade bez query, symulacja proxy lub drugiej instancji): w 5 s z jednej karty **416 × `POST /api/ws-ticket`, 417 upgrade’ów, 416 × `GET /api/users`, 416 × `GET /api/channels`**. Ekranu logowania nie ma, pętla trwa w nieskończoność.
  - Kontrolnie: `logout-all` z innego urządzenia daje 1 żądanie biletu → 401 → ekran logowania. Ta ścieżka działa poprawnie.
- **Poprawka (frontend):**
  - zerować `ticketRetried` i `backoff` dopiero po otrzymaniu zdarzenia `hello` (serwer wysyła je wyłącznie po udanej autoryzacji, `src/realtime.js:106`), a nie w `onopen`;
  - `refreshAfterReconnect()` też wołać po `hello`;
  - przy drugim 4001 z rzędu, gdy pobranie biletu zwróciło 200, nie wylogowywać, tylko `scheduleReconnect()` z backoffem i jitterem.

  **Opcjonalnie (serwer):** przy braku lub złym bilecie odpowiadać na upgrade `HTTP 401` bez zestawiania WS. Zmienia to KONTRAKT (4001), więc wymaga decyzji kontrolera. Do README dopisać, że aplikacja musi działać jako jedna instancja, bo bilety i limiter są w pamięci.

### W3. Otwarta, nielimitowana rejestracja: kwota per użytkownik nie chroni dysku, a każdy z internetu dostaje dostęp do zespołu — POTWIERDZONE
- **Plik:linia:** `src/routes.js:77-107` (rejestracja bez uwierzytelnienia i bez limitu żądań), `src/routes.js:448` (kwota liczona tylko per `user_id`); README, sekcja „Pierwsze konto” (przy `SEED=false` jedyną drogą jest publiczna rejestracja).
- **Scenariusz:** skrypt rejestruje N kont i każdym wgrywa pliki do pełnej kwoty, bo pliki-sieroty wystarczą (żyją 24 h i są odnawialne). Przy domyślnych 100 MB na konto dysk zapełnia się bez ograniczeń, a baza z wolumenem przestaje przyjmować zapisy. Niezależnie od dysku: każdy obcy po rejestracji czyta wszystkie kanały publiczne i katalog użytkowników (`GET /api/users`) „zespołowego” czatu i może pisać DM do każdego.
- **Dowód (`p6.js`):** 10 świeżych kont przy kwocie 1 MB na konto zapisało **8,8 MB w 731 ms**. Rejestracja nie ma żadnego limitu (scrypt jest asynchroniczny, więc tylko obciąża pulę wątków).
- **Poprawka:**
  - env `REGISTRATION=open|invite|closed` (dla Dockera domyślnie `invite` albo `closed`), kod zaproszenia `INVITE_CODE` sprawdzany przy rejestracji, ewentualnie `ADMIN_USERS`;
  - limiter rejestracji per IP (np. 5 na godzinę);
  - globalny limit dysku `UPLOAD_TOTAL_QUOTA_MB` (suma `files.size`, 413/507 po przekroczeniu);
  - opcjonalnie kwota liczona także od sierot z krótszym TTL (np. 1 h zamiast 24 h).

### W4. `TRUST_PROXY`: łatwe do popełnienia błędne konfiguracje albo pozwalają obejść limiter logowań, albo dają blokadę dowolnego konta — POTWIERDZONE
- **Plik:linia:** `server.js:4-10, 18` (`parseTrustProxy` przepuszcza `true`), `src/app.js:28`, `src/routes.js:117-118` (klucz limitera `req.ip:username`; po 10 błędach 429 także dla poprawnego hasła), `server.js:14` (`HOST` domyślnie `0.0.0.0`). README podaje tylko „np. `1` lub `loopback`”.
- **Dowód (`p4.js`, 30 błędnych logowań na konto `victim` z rotowanym `X-Forwarded-For`; `sig.js`):**

  | Konfiguracja | Wynik |
  |---|---|
  | brak `TRUST_PROXY` | 10×401, 20×429 (limiter działa) |
  | `TRUST_PROXY=true` | **30×401, 0×429**: limiter obejściony. Express bierze skrajny lewy XFF, który ustawia klient, także za nginx z `$proxy_add_x_forwarded_for`. |
  | `1` lub `loopback`, a klient łączy się z aplikacją bezpośrednio (port wystawiony, `HOST=0.0.0.0` poza Dockerem) | **30×401, 0×429**: IP podrabiane dowolnie |
  | `loopback` i nagłówek `"spoof, 127.0.0.1"` | również obejście. Adresy loopback w łańcuchu są zaufane, więc w Dockerze, gdzie Caddy nie jest na loopbacku, `loopback` jest po prostu złym wyborem. |
  | brak lub zły `TRUST_PROXY` za proxy (wszyscy klienci mają IP proxy) | `sig.js`: 10 błędnych prób z jednego IP, potem **poprawne hasło → 429**. Każdy może zablokować logowanie dowolnemu użytkownikowi na 10 min (i odnawiać blokadę). |

  Konfiguracja domyślna z compose (`TRUST_PROXY=1`, port tylko na `127.0.0.1`, Caddy nadpisuje XFF) jest poprawna.
- **Poprawka:**
  - odrzucać `TRUST_PROXY=true` (log z ostrzeżeniem albo błąd startu); akceptować liczbę hopów albo listę CIDR proxy;
  - w README opisać tabelę „kiedy jaka wartość”: Caddy lub nginx na tym samym hoście → `1` i `HOST=127.0.0.1`; Docker → `1` i port aplikacji niewystawiony publicznie; Cloudflare przed proxy → `2` albo CIDR;
  - przy ustawionym `TRUST_PROXY` logować przy starcie ostrzeżenie, jeśli `HOST=0.0.0.0` poza kontenerem;
  - rozważyć zmianę limitera, żeby blokada nie dotyczyła poprawnego hasła z nowego IP: osobny licznik per IP (globalny) i per username z opóźnieniem zamiast twardego 429, albo CAPTCHA lub backoff.

---

## Drobne

1. **Zalew biletów WS: brak limitu na sesję i sprzątanie O(n) przy każdym `createTicket`** — POTWIERDZONE.
   - **Gdzie:** `src/realtime.js:79-84`, `src/routes.js:142`.
   - **Dowód (`flood.js`, 1 konto, 128 równoległych klientów, 45 s):** w Mapie żyje stale około 30 tys. biletów. Przepustowość spadła z około 1700/s do około 850/s w miarę zapełniania Mapy (pełne przejście Mapy na każde żądanie). RSS serwera wzrósł o około 95 MB.
   - **Ocena:** zjawisko samoograniczające (TTL 30 s, plateau RSS, brak trwałego wycieku), ale jedno konto może trzymać serwer pod stałym obciążeniem.
   - **Poprawka:** maks. np. 5 aktywnych biletów na `tokenHash` (najstarszy usuwany). Sprzątanie z wczesnym `break`: Mapa ma kolejność wstawiania, a TTL jest stały, więc pierwszy niewygasły wpis kończy pętlę.
2. **Brak limitu połączeń WS na użytkownika** — POTWIERDZONE.
   - **Dowód (`p6.js`):** jedno konto otworzyło 1500 socketów (RSS +29 MB); jeden `PATCH /api/me` dał 1500 ramek. Każdy socket to też zapytanie do bazy co 30 s w heartbeat.
   - **Poprawka:** limit np. 10 socketów na użytkownika (przy przekroczeniu zamykać najstarszy) oraz rate limit `POST /api/ws-ticket`.
3. **Pliki z wiadomości usuniętych przed R2 zostają publiczne, liczą się do kwoty i nigdy nie są sprzątane** — POTWIERDZONE.
   - **Gdzie:** `src/app.js:44` (sierota to plik bez *jakiejkolwiek* wiadomości, także usuniętej), `src/routes.js:386` (ponowny DELETE jest no-op).
   - **Dowód (`p8.js`):** baza z kodu R1 z usuniętą wiadomością z plikiem. Po starcie R2 `cleanupOrphans()` usunął 0 plików, `GET /files/<id>` bez autoryzacji zwraca 200, `usedBytes` nadal liczy plik, a ponowny DELETE nie pomaga.
   - **Poprawka:** w zapytaniu sierot `NOT EXISTS (SELECT 1 FROM messages WHERE file_id = f.id AND deleted = 0)`. Usuwany plik zostawia `file_id` NULL dzięki FK `ON DELETE SET NULL`.
4. **Sprzątanie sierot: okno między SELECT a DELETE oraz pliki na dysku bez wiersza** — PRAWDOPODOBNE.
   - **Okno:** `src/app.js:42-49` pobiera listę jednym SELECT, potem w pętli z `await unlink`. Wiadomość wysłana w tej przerwie z plikiem z listy (plik starszy niż 24 h, np. karta z załącznikiem w kompozytorze otwarta przez noc) zostanie po cichu odpięta przez FK SET NULL, a plik skasowany. Przy maxAge 0 test w `p3.js` pokazał 400 „Nieprawidłowy plik” dla właśnie wysłanego pliku. Poprawka: `DELETE FROM files WHERE id = ? AND NOT EXISTS(...)` w pętli i `unlink` tylko przy `changes === 1`.
   - **Pliki bez wiersza:** awaria lub SIGTERM między `writeFile` a `INSERT` (`src/routes.js:452-457`) albo nieudany `unlink` w `removeFile` (`src/app.js:35-38`, błąd połykany) zostawia plik na dysku bez wiersza. Takiego pliku sprzątanie (oparte na bazie) nigdy nie zobaczy. Poprawka: zapisywać do `<id>.part` i robić rename po INSERT; okresowo skanować `uploadsDir` w poszukiwaniu nazw bez wiersza, starszych niż 24 h.
5. **Graceful shutdown nie jest łagodny** — POTWIERDZONE.
   - **Gdzie:** `src/app.js:102` (`closeAllConnections()` od razu zrywa żądania w toku), `src/realtime.js:138` (`terminate()`: klienci dostają 1006 zamiast 1001).
   - **Dowód (`sig.js`):** SIGTERM → exit 0 po 31 ms, WS zamknięty kodem 1006. Do tego `housekeeping` w toku może trafić na zamkniętą bazę (błąd tylko w logu).
   - **Poprawka:** `server.close()` i `closeIdleConnections()`, czekanie na żądania w toku z limitem (np. 10 s, mniej niż `stop_grace_period`), dopiero potem `closeAllConnections()`. Sockety zamykać `ws.close(1001, 'Restart serwera')`.
6. **Brak walidacji zmiennych środowiskowych** — POTWIERDZONE (TTL 1,5 s w `p4.js`).
   - **Gdzie:** `src/app.js:19-20`.
   - **Objawy:**
     - `SESSION_TTL_DAYS=-1` daje ujemny TTL: każda sesja jest martwa od razu i nikt się nie zaloguje;
     - `SESSION_TTL_DAYS=0` po cichu daje 30;
     - TTL krótszy niż 1 h nigdy się nie przesuwa, bo zapis jest najwyżej raz na godzinę (`src/routes.js:55`). Dowód: żądania co 0,5 s, a po 1,5 s 401;
     - `UPLOAD_QUOTA_MB=0` daje 100 (nie da się wyłączyć uploadu).
   - **Poprawka:** walidacja przy starcie (liczba większa od 0, inaczej błąd startu) i próg zapisu `min(HOUR, ttl/10)`.
7. **`SEED` domyślnie `true` dla `npm start`.**
   - **Gdzie:** `server.js:17`.
   - **Ryzyko:** wystawienie bez Dockera na pustej bazie tworzy publiczne konta `anna`/`bartek` z hasłem `haslo123`.
   - **Dowód:** `SEED=false` działa (`sig.js`: logowanie `anna` → 401).
   - **Poprawka:** domyślnie `false` przy `NODE_ENV=production` i wyraźny log „Utworzono konta demo” przy seedowaniu.
8. **Brak `Cache-Control: no-store`** na odpowiedziach z tokenem i biletem (`/api/auth/login`, `/register`, `/ws-ticket`) — POTWIERDZONE (`p9.js`: brak nagłówka). Poprawka: middleware `no-store` dla `/api/*`.
9. **Socket wygasłej sesji żyje do 30 s.**
   - **Gdzie:** `src/routes.js:51-53`. `auth()` usuwa wygasłą sesję, ale nie woła `rt.dropSession`, a zamknięcie zależy od heartbeat (`src/realtime.js:20`).
   - **Dowód (`p4.js`):** zaraz po wygaśnięciu `readyState=1`, po 31 s kod 4001. Zgodne z kontraktem.
   - **Poprawka:** jedna linia, `rt.dropSession(tokenHash)` w gałęzi wygaśnięcia.
10. **Brak zmiany hasła.** `logout-all` odcina skradziony token, ale nie pomaga po wycieku hasła. Napastnik loguje się ponownie. Poprawka: `POST /api/me/password` (stare i nowe hasło), a po zmianie usunięcie pozostałych sesji.
11. **Frontend: stan reconnectu nie jest czyszczony przy wylogowaniu; brak jitteru** — PRAWDOPODOBNE.
    - **Gdzie:** `public/app.js:262-281`. `resetState()` i `logout()` nie zerują `ticketRetried` ani `backoff`.
    - **Jitter:** po restarcie serwera wszyscy klienci łączą się w tych samych chwilach (1, 2, 4… s), za każdym razem z `refreshAfterReconnect`.
    - **Poprawka:** zerować oba pola w `resetState()` i dodać losowe opóźnienie ±30% w `scheduleReconnect()`.
12. **CSP `connect-src 'self' ws: wss:`** (`src/app.js:63`) pozwala łączyć się z dowolnym hostem WS. Przy ewentualnym XSS to gotowy kanał eksfiltracji tokenu z `localStorage`. Poprawka: samo `connect-src 'self'` (CSP3 obejmuje ws/wss tego samego originu) albo jawne `wss://<host>`.

---

## Co sprawdzono i działa (bez uwag)

**Bilety WS (`p1.js`, `p9.js`)**
- `?token=<ważny>` → 4001; brak biletu → 4001; `POST /api/ws-ticket` bez Bearer → 401.
- Wyścig: dwa równoległe połączenia z tym samym biletem → dokładnie jedno dostaje `hello`, drugie 4001. Bilet jest usuwany synchronicznie przed `handleUpgrade`.
- Bilet wielkimi literami → 4001; bilet po 31 s → 4001.
- `logout` zamyka socket tej sesji (4001) i unieważnia jej niewykorzystane bilety.
- `logout-all` zamyka sockety obu sesji (4001), a obie sesje dostają 401.
- Mapa biletów nie cieknie: plateau po 30 s, sprzątanie w `createTicket` i heartbeat.

**Sesje (`p1.js`, `p4.js`, `p5.js`)**
- Tabela `sessions` ma kolumny `token_hash, user_id, created_at, expires_at, last_used_at`. Ani wiersze, ani surowe pliki `k.db` i `k.db-wal` nie zawierają jawnego tokenu.
- Token nie jest nigdzie logowany.
- Porównanie przez lookup `SHA-256` (bez problemu timingu).
- Wygasła sesja → 401 i wiersz usunięty. Przedłużenie nie jest możliwe, bo sprawdzenie `expires_at` następuje przed zapisem.
- Zapis sliding najwyżej raz na godzinę.
- Heartbeat zamyka socket wygasłej sesji.
- Migracja z bazy utworzonej kodem R1 (kolumna `token`): start bez błędów, stary token → 401, nowe logowanie 200, ponowny start idempotentny.

**Pliki (`p3.js`)**
- Wyścig kwoty: 20 równoległych uploadów po 300 KB przy kwocie 1 MB → 3×201 i 17×413 z komunikatem z kontraktu. Na dysku 3 pliki, bez osieroconych zapisów (unlink przy odrzuceniu).
- Plik w dwóch wiadomościach: po usunięciu pierwszej → 200, po usunięciu drugiej → 404 i plik usunięty z dysku. `usedBytes` maleje.
- Cudzy plik w wiadomości → 403.
- `cleanupOrphans()` usuwa sierotę i zostawia plik przypięty.
- Traversal `/files/..%2fk.db` → 404. Id jest walidowane `^[a-f0-9]{32}$` przy serwowaniu i przy podpinaniu, a `removeFile` dostaje tylko id z bazy.
- `/api/me/storage` zgodne z kontraktem.

**Wdrożenie**
- `/api/health` → `{"ok":true}` bez danych, z nagłówkami bezpieczeństwa.
- SIGTERM → exit 0.
- `SEED=false` → brak kont demo.
- `HOST` i `TRUST_PROXY` przekazywane do `start()`.

**Frontend**
- Bilet pobierany przed każdym połączeniem.
- 401 przy pobieraniu biletu → ekran logowania. Potwierdzone w Chromium po `logout-all` z innego urządzenia: 1 żądanie, potem ekran logowania.
- Toast z komunikatem 413 z API.
- Nowe elementy profilu (tekst miejsca, pasek, przycisk) idą przez `textContent`, więc nie ma XSS.

---

## Werdykt: czy można wystawić w internecie za HTTPS proxy?

**Jeszcze nie w obecnej postaci. Tak po poprawkach W1–W3 i udokumentowaniu W4.** Zmiany R2 (bilety, hashowane i wygasające sesje, `logout-all`, kwota, sprzątanie) są poprawne i nie otwierają żadnej luki w uwierzytelnianiu. Problemy blokujące dotyczą dostępności i nadużyć:
- **W1:** jeden anonimowy klient może wyczerpać pamięć serwera (1,7 GB przy 150 żądaniach);
- **W3:** otwarta rejestracja unieważnia kwotę i otwiera zespołowy czat dla każdego;
- **W2:** przy dowolnej awarii biletów (np. dwie instancje) każda karta przeglądarki generuje około 80 cykli żądań na sekundę.

Każda z tych poprawek to kilkadziesiąt linii. Po nich, przy konfiguracji z compose (`TRUST_PROXY=1`, port na `127.0.0.1`, Caddy) i jednej instancji, aplikację można wystawić. Drobne 1–3 i 5–7 warto zrobić od razu, bo są tanie.
