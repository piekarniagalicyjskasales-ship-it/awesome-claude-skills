# Ledger — Kanalik (orkiestrator)

## Stan
- Projekt roboczy: /home/user/kanalik
- Kopia trwała (pamięć): repo `piekarniagalicyjskasales-ship-it/awesome-claude-skills`, gałąź `claude/happy-noether-a0xnz3`, katalog `projekty/kanalik/` (bez node_modules i data/).
- Po utracie kontekstu: przeczytaj ten plik + plan.md; nie zlecaj ponownie zadań oznaczonych DONE.

## Decyzje
- Decyzja: nazwa "Kanalik", własny wygląd (granat-zieleń + bursztyn), bez marki Slack — dlaczego: klon funkcji, nie marki; koszt pomyłki: niski.
- Decyzja: stack Node 22 + express + ws + node:sqlite (bez kompilacji natywnej) — dlaczego: działa od ręki w kontenerze; koszt: niski.
- Decyzja: UI po polsku, konta demo anna/bartek — dlaczego: użytkownik pisze po polsku; koszt: niski.
- Decyzja (prośba użytkownika "zapisuj wszystko w pamięci"): interpretuję jako trwałe zapisywanie postępu — ledger aktualizowany po każdej fali + commit i push do gałęzi roboczej po każdym kamieniu milowym, bo kontener jest ulotny. Repo awesome-claude-skills wybrane jako kolekcja osobista użytkownika; aplikacja w osobnym katalogu `projekty/kanalik/`, nie dotyka istniejących skilli. Koszt pomyłki: niski (gałąź robocza, łatwo przenieść).

## Zadania
| Zadanie | Status | Plik | Uwagi |
|---|---|---|---|
| T0 Plan + kontrakt + briefy | DONE | _orkiestracja/plan.md, briefs/T1-3.md | package.json + express/ws zainstalowane |
| T1 Backend | DONE | server.js, src/, README.md | smoke OK; drobne rozstrzygnięcia w out/T1.md |
| T2 Frontend | DONE | public/ | Playwright: XSS ok, realtime A->B ok; brak testu mobile/upload, brak focus trap |
| T3 Testy | DONE_WITH_CONCERNS | tests/api.test.js | ~50 testów; jeszcze nieuruchomione (brak backendu); kilka tolerancji statusów, ścisłe 403 dla nie-członka publicznego kanału |
| T4 Integracja | DONE | npm test | 54/54 zielone (zweryfikowane przez kontrolera) |

- Decyzja: przy utworzeniu członkostwa last_read = MAX(id) w kanale — dlaczego: dołączający nie powinien widzieć historii jako nieprzeczytanej (test unread); koszt pomyłki: niski. Poprawkę robi wykonawca T1.
- Decyzja: wysłanie wiadomości najwyższego poziomu przesuwa last_read nadawcy — dlaczego: piszący widział kanał; test :639 zostaje. Koszt: niski.
| T5 E2E przeglądarka | DONE_WITH_CONCERNS | out/T5.md, out/shots/ | 15/15 PASS, 0 błędów konsoli, dostarczenie 68 ms; drobne: throttle typing nie resetowany po wysłaniu (app.js makeComposer) |
| T6 Recenzja niezależna | DONE | out/T6.md | Krytyczne 0, Ważne 5 (4 potw.), Drobne 19; kryteria 1–6 spełnione z zastrzeżeniami |
| R1 Poprawki po recenzji | DONE (runda 1/3) | briefs/R1.md | backend W1–W5,D1,3,4,6–10,17–19; frontend D12–16+CSP; testy regresji — równolegle przez wznowionych wykonawców |

- Decyzja: odłożone D2 (kwota plików), D5 (wygasanie sesji/hash tokenów), D11 (token w URL WS, wymóg kontraktu) — opisane w README jako znane ograniczenia; dlaczego: niski wpływ dla wersji lokalnej/demo; koszt: średni przy wdrożeniu publicznym.
| T7 Weryfikacja kontrolera | DONE | — | npm test 71/71 ×3; E2E 15/15 pod CSP, 0 błędów konsoli, dostarczenie 48 ms; npm start + login anna OK; nagłówki CSP/XFO obecne; brak marki Slack w kodzie |

## Kryteria akceptacji (plan.md)
1. npm start → ekran logowania: SPEŁNIONE
2. npm test zielony: SPEŁNIONE (71/71)
3. Realtime < 1 s: SPEŁNIONE (48 ms)
4. Funkcje: SPEŁNIONE (E2E 1–15)
5. Brak XSS: SPEŁNIONE (E2E 12 + fuzz 300k w T6)
6. Konta demo: SPEŁNIONE

## Znane ograniczenia (świadomie odłożone)
D2 kwota plików / sprzątanie sierot; D5 wygasanie sesji, tokeny jawne w bazie; D11 token w URL WebSocket.

## Runda R2 — wdrożenie publiczne (prośba użytkownika: „zrób dokera i wykonaj odłożone punkty”)
- Decyzja: D11 → jednorazowe bilety WS (`POST /api/ws-ticket`, 30 s), `?token=` usunięty — dlaczego: token sesji nie trafia do logów proxy; bilet jest bezużyteczny po użyciu. Koszt: niski.
- Decyzja: D5 → w bazie tylko SHA-256 tokenu, wygasanie przesuwane 30 dni (SESSION_TTL_DAYS), migracja kasuje stare sesje (wszyscy logują się ponownie), nowe `logout-all`. Koszt: niski.
- Decyzja: D2 → kwota 100 MB/użytkownik (UPLOAD_QUOTA_MB), plik usuwany razem z wiadomością, sieroty > 24 h sprzątane co godzinę. Koszt: niski.
- Decyzja: w Dockerze SEED=false (konta demo ze znanym hasłem w internecie = luka), port 127.0.0.1:3000, HTTPS przez Caddy w profilu `https`, TRUST_PROXY=1. Koszt pomyłki: niski.
- Decyzja: dockerd uruchomiony ręcznie w kontenerze sesji (był zainstalowany, nie działał) — tylko do testu obrazu.

| Zadanie | Status | Plik | Uwagi |
|---|---|---|---|
| R2-B Backend | DONE | src/, server.js, README | migracja starej bazy OK; dodatkowo: wygasłe sesje zamykają WS w heartbeat |
| R2-F Frontend | DONE | public/ | bilety WS, storage, logout-all. Flaky scen. 12 = prawdziwy błąd: druga szybko wpisana wiadomość ginęła (guard `sending` + czyszczenie pola po POST) — naprawione w makeComposer().send; kontroler: E2E 15/15 ×3 |
| R2-T Testy | DONE | tests/ | 84/84 ×2 (kontroler) |
| R2-D Docker | DONE | Dockerfile, compose, deploy/, README#Docker | obraz 248 MB, healthy, uid 1000, trwałość OK, stop 0,24 s. Kontroler: Dockerfile repo ≠ testowy tylko linią CA sandboxa; stack compose --profile https (Caddy, DOMAIN=localhost): 308→https, /api/health OK, wss + bilet → hello, limiter za proxy 429 przy 11. próbie |
| R2-REV Recenzja R2 | W TOKU (fala B) | out/R2-REV.md | opus, port 3500 |
- Decyzja: `deploy/Caddyfile` w .gitignore (konfiguracja lokalna użytkownika; w repo tylko .example). Koszt: niski.
| R2-REV Recenzja R2 | DONE | out/R2-REV.md | Krytyczne 0, Ważne 4, Drobne 12; werdykt: NIE do internetu przed W1–W3; zmiany auth R2 poprawne |

## Runda R3 — poprawki po R2-REV (briefs/R3.md, KONTRAKT v3)
- Decyzja: rejestracja `open|code|closed`, w Dockerze `code` z REGISTRATION_CODE (min 8 znaków, bez niego serwer nie startuje) + limit 5 rejestracji/IP/h — dlaczego: otwarta rejestracja w internecie = obcy w czacie zespołu i obejście kwot. Koszt pomyłki: niski (zmiana env).
- Decyzja: upload — auth i kontrola Content-Length przed parsowaniem body, max 2 równoległe, globalny limit dysku 5 GB (507).
- Decyzja: frontend — backoff resetowany dopiero po `hello`, jitter, baner po 5 porażkach; 4008 przy >10 połączeniach.
- Decyzja: odłożone D7 (SEED przy npm start), D9 (≤30 s życia socketu wygasłej sesji), skalowanie poziome — README.
| R3-B Backend | W TOKU | src/, server.js, README, compose | wznowiony T1 |
| R3-F Frontend | W TOKU | public/ | wznowiony T2 |
| R3-T Testy | W TOKU | tests/ | wznowiony T3 |
| R3-V Ponowna weryfikacja recenzenta R2 | CZEKA | out/R3-V.md | po R3-B/F/T |
