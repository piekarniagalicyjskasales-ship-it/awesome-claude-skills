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
| T2 Frontend | W TOKU (fala 1) | public/ | sonnet |
| T3 Testy | DONE_WITH_CONCERNS | tests/api.test.js | ~50 testów; jeszcze nieuruchomione (brak backendu); kilka tolerancji statusów, ścisłe 403 dla nie-członka publicznego kanału |
| T4 Integracja | W TOKU | npm test | 1. przebieg: 53/54; skrypt test poprawiony (glob tests/*.test.js) |

- Decyzja: przy utworzeniu członkostwa last_read = MAX(id) w kanale — dlaczego: dołączający nie powinien widzieć historii jako nieprzeczytanej (test unread); koszt pomyłki: niski. Poprawkę robi wykonawca T1.
