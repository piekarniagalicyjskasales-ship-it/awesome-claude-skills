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
