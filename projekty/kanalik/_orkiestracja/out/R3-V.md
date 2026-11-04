# R3-V — Weryfikacja poprawek po R2-REV

Recenzent: ten sam co w R2-REV, tylko odczyt. Data: 2026-11-04.
Wejście: `briefs/R3.md` (KONTRAKT v3), `out/R2-REV.md`, bieżący kod (`server.js`, `src/*`, `public/*`, `README.md`). Pliki Dockera pominięto.

## Metoda
- `npm test` (`TMPDIR=/tmp/claude-0/r2rev/tmp`): **100/100 pass**.
- Własne instancje na porcie 3500, bazy w `/tmp/claude-0/r2rev/*`, wszystkie zatrzymane. Skrypty leżą w `/tmp/claude-0/-home-user/a4327937-42fa-5a48-8e9f-5fa1a09e6e77/scratchpad/r2rev/`:
  - skrypty z R2-REV uruchomione ponownie bez zmian;
  - `lib.js` dostał domyślne `registerRateLimit:false`, żeby stare sondy mogły rejestrować wiele kont;
  - nowe skrypty:
    - `p10.js`: nowe ścieżki kodu (rejestracja, upload, bilety, 4008, hasło);
    - `p11.js`: limiter rejestracji;
    - `p12.js`, `p12idx.js`: koszt sprzątania przy dużej bazie;
    - `p13.js`: pliki na dysku bez wiersza w bazie;
    - `fe.js`: frontend w Chromium (Playwright).
- POTWIERDZONE = odtworzone skryptem. PRAWDOPODOBNE = wynika z kodu.

## 1. Status znalezisk z R2-REV

| # | Znalezisko | Status | Dowód |
|---|---|---|---|
| W1 | DoS pamięci przez `POST /api/files` (parser 8 MB przed auth i kwotą) | **FIXED** | `p7b.js`: 150 równoległych żądań po 6,7 MB bez auth → 401, RSS 81 → **96 MB** (przed poprawką: 1769 MB). `p7.js`: 80 żądań przy kwocie 1 MB → 413, RSS → **88 MB** (przed: 1045 MB). `p10.js`: brak `Content-Length` (chunked) → 411; CL+TE → 400; CL ujemny, `1e3` lub podwójny → 400; CL 1e9 → 413; CL ponad globalny limit → 413; zaniżony CL → body ucięte → 400. Trzecie równoległe żądanie tego samego użytkownika → 429, inny użytkownik w tym czasie → 201. Po przerwaniu 2 wiszących uploadów i po 3 błędnych JSON-ach licznik się zwalnia (201). |
| W2 | Frontend: pętla reconnectów bez opóźnienia przy odrzucanych biletach | **FIXED** | `fe.js` (Chromium, upgrade bez query string): w 20 s **5** żądań biletu i 5 upgrade’ów (przed poprawką: 416 w 5 s), 1× `/api/users`. Po 5 porażkach baner „Brak połączenia z serwerem — ponawiam… / Połącz teraz”. Po naprawie i kliknięciu baner znika. |
| W3 | Otwarta rejestracja, kwota nie chroni dysku | **FIXED** (wg KONTRAKTU v3) | `fe.js` i `p10.js`: tryb `closed` → 403, ukryta zakładka i komunikat; `code` → zły lub brak kodu 403, dobry kod 201; `start()` z kodem krótszym niż 8 znaków, pustym albo z nieznanym trybem → odmowa. `p11.js`: 5 rejestracji na godzinę na IP, potem 429. `p10.js`: globalny limit → 507 „Brak miejsca na serwerze”. Uwaga: `npm start` zostaje domyślnie w trybie `open` (decyzja kontrolera); patrz też nowe W-N2. |
| W4 | Ryzyka `TRUST_PROXY` | **FIXED** (ostrzeżenie i dokumentacja, zgodnie z decyzją) | Ostrzeżenie „UWAGA: TRUST_PROXY=true…” przy starcie. README ma sekcję „Reverse proxy i `TRUST_PROXY`” z tabelą i skutkami błędnej konfiguracji. Zachowanie limitera bez zmian (`p4.js` jak w R2-REV), czego należało się spodziewać. Drobna niespójność README: patrz D-N5. |
| D1 | Zalew biletów (O(n) sweep, brak limitu) | **FIXED** | `flood.js` (1 sesja, 128 klientów, 15 s): odpowiedzi to głównie 429, przepustowość 6650 żądań/s, opóźnienie `/api/health` 5–28 ms (przed poprawką: 120–200 ms). `p10.js`: 21. bilet unieważnia pierwszy (4001), żądania 31–33 w tej samej minucie → 429. Obejście przez wiele sesji: patrz D-N1. |
| D2 | Brak limitu socketów na użytkownika | **FIXED** | `p6.js`: z 1500 prób otwarte zostaje 10. `p10.js`: nadmiarowe → 4008, bez `hello`. `fe.js`: 11 kontekstów przeglądarki → dokładnie 1 baner „Za dużo otwartych kart…”, 0 automatycznych reconnectów w 5 s. |
| D3 | Pliki z wiadomości usuniętych przed R2 | **FIXED** | `p8.js` (baza z kodu R1): po starcie `GET /files/<id>` → **404**, `usedBytes` 0 (przed poprawką: 200 i plik nadal liczony do kwoty). |
| D4 | Wyścig przy sprzątaniu sierot, pliki bez wiersza w bazie | **FIXED** | DELETE warunkowy (`src/app.js:56-62`). `p13.js`: plik na dysku bez wiersza usunięty, plik o nazwie nie-hex zostawiony, plik przypięty zostaje (200). **Ale** nowa ścieżka jest bardzo kosztowna: patrz W-N1. |
| D5 | Graceful shutdown | **FIXED** | `sig.js`: SIGTERM w trakcie uploadu 5 MB → upload **201**, plik na dysku, WS zamknięty kodem **1001**, exit 0. Uwaga o czasie: D-N4. |
| D6 | Walidacja env | **FIXED** | `SESSION_TTL_DAYS=-1` i `0`, `UPLOAD_QUOTA_MB=0`, `UPLOADS_TOTAL_MB=abc`, `PORT=abc` i `0`, `SEED=yes`, `REGISTRATION=code` bez kodu albo z 7 znakami, `REGISTER_LIMIT_PER_HOUR=1.5` → „Błąd konfiguracji: …”, exit 1. `PORT=70000` → ogólny błąd, też exit 1. |
| D8 | `Cache-Control: no-store` | **FIXED** | `p9.js` i `p10.js`: `no-store` na `/api/auth/login`, `/api/me`, `/api/health`. |
| D10 | Brak zmiany hasła | **FIXED** | `p10.js`: złe obecne hasło → 403; po zmianie stary token 401, druga sesja 401, socket 4001, nowy token 200, logowanie starym hasłem 401, nowym 200, nowe hasło za krótkie → 400. `fe.js`: urządzenie A dostaje toast „Hasło zmienione — wylogowano inne urządzenia” i ma działające WS (bez banera); urządzenie B ląduje na ekranie logowania. |
| D11 | Frontend: reset stanu, jitter | **FIXED** | `resetState()` zeruje `wsFailures`, `closeWs()` czyści timery i baner, backoff 1…30 s z jitterem ±30% (`public/app.js:1398-1409`). `fe.js`: po zatrzymaniu serwera baner po **17,7 s** (5 porażek), po restarcie „Połącz teraz” → 1 bilet, baner znika. |
| D12 | CSP `connect-src` | **FIXED** | `connect-src 'self'` (`p10.js`). Frontend w Chromium łączy WS bez błędów CSP. |
| D7 | SEED=true przy `npm start` | odłożone (udokumentowane w README:154) | — |
| D9 | Socket wygasłej sesji do 30 s | odłożone, **w praktyce poprawione** | `auth()` woła teraz `rt.dropSession` przy wygaśnięciu (`src/routes.js:59`). `p4.js`: socket zamknięty od razu po pierwszym żądaniu z wygasłym tokenem. Bez żądań nadal działa limit heartbeat 30 s. |

**Wynik: 15/15 sprawdzanych pozycji FIXED. Żadna nie jest NOT FIXED ani PARTIAL.**

## 2. Przegląd nowego kodu: nowe znaleziska

### Krytyczne
Brak.

### Ważne

#### W-N1. Sprzątanie plików blokuje pętlę zdarzeń na dziesiątki sekund co godzinę, a start na prawie minutę (koszt O(pliki × wiadomości), brak indeksu `messages(file_id)`) — POTWIERDZONE
- **Plik:linia:**
  - `src/app.js:64-68`: dla *każdego* pliku starszego niż 24 h, także przypiętego, osobny `DELETE … AND NOT EXISTS (SELECT 1 FROM messages WHERE file_id = ?)`;
  - `src/app.js:85-91`: `cleanupDeletedMessageFiles()` wykonywany przy każdym starcie;
  - `src/db.js` (SCHEMA): brak indeksu na `messages.file_id`.

  Każde sprawdzenie skanuje całą tabelę `messages`. Pętla jest synchroniczna: `dropOrphanRow` zwraca od razu, gdy nic nie usuwa, więc do pętli zdarzeń nic nie wraca.
- **Dowód (`p12.js`, pliki przypięte do najnowszych wiadomości, realny układ czatu):**

  | Pliki | Wiadomości | `start()` | `cleanupOrphans()` co godzinę |
  |---|---|---|---|
  | 1000 | 50 000 | 3,9 s | 1,8 s zamrożenia pętli |
  | 3000 | 200 000 | **46,4 s** | **21,6 s** zamrożenia pętli |
  | 3000 + `CREATE INDEX idx_messages_file ON messages(file_id)` (`p12idx.js`) | 200 000 | **20 ms** | **13 ms** |

  Koszt rośnie kwadratowo. Po roku używania przez zespół serwer co godzinę przestaje odpowiadać (HTTP i WS, heartbeat zrywa sockety), a restart z healthcheckiem może się zapętlić.

  Wersja z R2 robiła jedno zapytanie zbiorcze. Regresję wprowadziła poprawka D4 (zapytanie per wiersz dla wszystkich starych plików).
- **Poprawka:**
  - w `SCHEMA`: `CREATE INDEX IF NOT EXISTS idx_messages_file ON messages(file_id);`;
  - kandydatów wybierać jednym zapytaniem: `SELECT id FROM files f WHERE created_at <= ? AND NOT EXISTS (SELECT 1 FROM messages WHERE file_id = f.id)`, a warunkowy DELETE zostawić tylko jako zabezpieczenie;
  - w pętli co np. 200 wierszy robić `await setImmediate`.

#### W-N2. Kod zaproszenia można zgadywać bez limitu — POTWIERDZONE
- **Plik:linia:** `src/routes.js:89-96` i `:123`. Limiter rejestracji liczy tylko *udane* rejestracje (`fail()` po sukcesie), a porównanie kodu następuje przed scryptem, więc próba jest bardzo tania.
- **Dowód (`p10.js`):** **2000 błędnych kodów z jednego IP w 2,55 s → 2000×403, 0×429.** To około 800 prób/s na jedno połączenie, a równolegle kilka tysięcy na sekundę.

  README podaje jako przykład kod-frazę `tajny-kod-zespolu` (README:167, :178), a minimum to tylko 8 znaków. Kod wymyślony przez człowieka jest podatny na ataki słownikowe i celowane. Kod jest długożyjący i wspólny dla całego zespołu, a po jego odgadnięciu napastnik ma konto, czyli dostęp do kanałów publicznych i listy użytkowników.
- **Poprawka:**
  - liczyć *nieudane* próby kodu per IP (np. 10 na godzinę → 429, sprawdzane przed porównaniem);
  - w README zastąpić przykład poleceniem `REGISTRATION_CODE=$(openssl rand -hex 16)`;
  - podnieść minimum do 16 znaków albo ostrzegać przy krótszym kodzie.

### Drobne
1. **Liczba sesji na użytkownika jest nieograniczona, co pozwala obejść limity biletów per sesja** — POTWIERDZONE.
   - **Gdzie:** `src/routes.js:128-145` (logowanie poprawnym hasłem nie jest limitowane), limity biletów w `src/routes.js:161-168` i `src/realtime.js:101-108` liczone per `tokenHash`.
   - **Dowód (`p10.js`):** 20 logowań × 30 biletów = **600 biletów w 1,6 s**.
   - **Skutek:** każda sesja to wiersz w bazie na 30 dni, więc jedno konto może bez końca rozpychać tabelę `sessions`.
   - **Poprawka:** maks. np. 50 sesji na użytkownika (najstarsza usuwana przy logowaniu) i limit biletów także per użytkownik.
2. **Limiter zmiany hasła ma klucz per użytkownik, więc posiadacz skradzionego tokenu może zablokować właścicielowi zmianę hasła** — POTWIERDZONE.
   - **Gdzie:** `src/routes.js:178`.
   - **Dowód (`p10.js`):** po 10 złych próbach poprawne hasło → 429, także z innej sesji tego samego użytkownika (429).
   - **Ocena:** właściciel ma obejście (`logout-all` odcina token napastnika).
   - **Poprawka:** klucz `pw:<tokenHash>` albo osobny licznik per sesja.
3. **Limiter rejestracji ma klucz per IP, co uderza w zespół za jednym NAT-em** — PRAWDOPODOBNE (mechanizm potwierdzony w `p11.js`).
   - **Skutek:** całe biuro za jednym adresem publicznym albo błędny `TRUST_PROXY` (wszyscy z IP proxy) daje razem 5 rejestracji na godzinę. Wdrożenie zespołu 20 osób trwa wtedy 4 godziny.
   - **Poprawka:** w README (sekcja „Pierwsze konto”) wspomnieć o `REGISTER_LIMIT_PER_HOUR`. Rozważyć, żeby limiter w trybie `code` liczył tylko nieudane próby (to rozwiązuje też W-N2), a udane z poprawnym kodem przepuszczał.
4. **Czas shutdownu może przekroczyć domyślny `stop_grace_period` Dockera (10 s)** — PRAWDOPODOBNE.
   - **Gdzie:** `src/realtime.js:167` (do 1,5 s na WS) i `src/app.js:160` (do 10 s na żądania).
   - **Skutek:** wolny upload trzymany przez klienta powoduje SIGKILL przed `db.close()`. WAL jest bezpieczny, ale żądanie w toku przepada, a plik może zostać bez wiersza w bazie. Sprzątanie z D4 go później usunie.
   - **Poprawka:** czekać łącznie najwyżej około 8 s albo ustawić w compose `stop_grace_period: 15s`. To sprawa dla kontrolera (Docker).
5. **Niespójności w README.**
   - **Gdzie:** README:45 nadal mówi „np. `1` lub `loopback`”, co przeczy nowej sekcji o proxy (`loopback` jest błędny, gdy proxy działa w osobnym kontenerze). README:65 opisuje `start({port, dbPath, uploadsDir, seed}) -> {port, close}` (nieaktualne).
   - **Poprawka:** w README:45 zostawić „`1` za jednym proxy (patrz sekcja Reverse proxy)”.

### Sprawdzone w nowym kodzie, bez uwag
- **Porównanie kodu zaproszenia:** SHA-256 obu stron i `timingSafeEqual` na buforach równej długości. Kod niebędący stringiem (np. liczba) → 403 bez wyjątku. Kod sprawdzany jest przed sprawdzeniem zajętości nazwy, więc bez kodu nie da się enumerować nazw użytkowników przez 409. `GET /api/config` ujawnia tylko tryb.
- **Ochrona uploadu przed parsowaniem:**
  - auth przed parserem, a 401 i 413 z `Connection: close`, gdy body nie zostało przeczytane;
  - framing `Content-Length` egzekwuje parser Node (zaniżony CL ucina body, CL+TE → 400);
  - licznik równoległych uploadów zwalniany na `res 'close'`, co obejmuje sukces, błąd i zerwane połączenie (sprawdzone);
  - podwójne sprawdzenie kwoty i limitu globalnego po zapisie jest synchroniczne z INSERT;
  - `pendingIds` chroni plik w oknie między zapisem a INSERT.
- **Bilety:** sprzątanie co 10 s z wczesnym `break` (stały TTL, więc kolejność wstawiania jest kolejnością wygasania). Limit 20 na sesję usuwa najstarszy. Cofnięcie przy logout i logout-all działa (`p1.js`: wszystkie wyniki jak w R2-REV).
- **Kod 4008:** nadmiarowy socket nie dostaje `hello` ani eventów i nie trafia do `conns`.
- **Zmiana hasła:** walidacja jak przy rejestracji. Usuwa wszystkie sesje i sockety, zwraca nową sesję. Frontend nie reaguje na 4001 w trakcie zmiany (`pwChanging`) i łączy WS nowym tokenem.
- **Frontend:** logowanie w trybie `closed` (ukryta zakładka i komunikat) oraz rejestracja w trybie `code` (pole kodu, komunikat 403, sukces) działają w Chromium. Nowe elementy idą przez `textContent`.

## 3. Werdykt: czy można wystawić w internecie za HTTPS proxy?

**Tak, warunkowo:** po dodaniu indeksu `messages(file_id)` (W-N1, jedna linia, bez niej serwer z czasem zamarza co godzinę) i z losowym kodem zaproszenia o długości co najmniej 16 znaków, dopóki W-N2 nie jest poprawione.

Wszystkie blokery z R2-REV (W1–W4) i wybrane drobne pozycje zostały naprawione i potwierdzone. Docelowa konfiguracja: compose z `REGISTRATION=code`, `TRUST_PROXY=1`, port na `127.0.0.1` i jedna instancja.
