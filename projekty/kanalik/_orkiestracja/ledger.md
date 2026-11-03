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
| T1 Backend | W TOKU (fala 1) | server.js, src/ | sonnet |
| T2 Frontend | W TOKU (fala 1) | public/ | sonnet |
| T3 Testy | W TOKU (fala 1) | tests/api.test.js | sonnet |
