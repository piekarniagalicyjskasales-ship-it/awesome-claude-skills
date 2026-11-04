# R2-REV — Niezależna recenzja zmian R2 (gotowość do internetu)

Nie widziałeś procesu tworzenia. Wejście: `briefs/R2.md` (KONTRAKT v2 i wymagania), `out/T6.md` (poprzednia recenzja — dla kontekstu, co już naprawiono), kod `server.js`, `src/`, `public/app.js`, `tests/api.test.js`, `README.md`.

Tylko czytasz — NIE edytujesz plików projektu. Do potwierdzania hipotez uruchamiaj własną instancję na porcie 3500 z bazą w `/tmp/claude-0/r2rev/` (nie 3000/3100/3400). Zatrzymaj ją na koniec.

## Skup się na
1. **Bilety WS**: jednorazowość (wyścig dwóch równoległych połączeń z tym samym biletem), wygasanie, sprzątanie Map (wyciek pamięci przy masowym `POST /api/ws-ticket`?), wiązanie z sesją (logout / wygaśnięcie zamyka socket), czy `?token=` naprawdę odrzucany.
2. **Sesje**: czy nigdzie nie zapisuje się / nie loguje jawnego tokenu; porównanie hashy; sliding expiry (czy zapis max raz/h działa i czy wygasła sesja nie może się „przedłużyć”); migracja ze starej bazy; `logout-all`.
3. **Pliki**: obejście kwoty (równoległe uploady — wyścig check-then-insert), usuwanie pliku przy kasowaniu wiadomości (czy nie usuwa pliku używanego przez inną wiadomość), path traversal przy usuwaniu, sprzątanie sierot (czy nie usuwa pliku właśnie wysyłanego przed przypięciem — okno 24 h), `/api/me/storage`.
4. **Wdrożenie**: `TRUST_PROXY` (czy bez proxy można sfałszować IP przez `X-Forwarded-For`, gdy zmienna jest ustawiona — opisz ryzyko konfiguracji), `SEED` domyślne wartości, graceful shutdown, `/api/health` nie ujawnia danych.
5. **Frontend**: obsługa biletów i 4001 (pętla reconnectów? burza żądań?), nowe elementy profilu — escape danych.

Każde znalezisko: plik:linia, scenariusz awarii, konkretna poprawka, POTWIERDZONE (z dowodem/skryptem) lub PRAWDOPODOBNE.

## Wyjście
`/home/user/kanalik/_orkiestracja/out/R2-REV.md`: **Krytyczne / Ważne / Drobne** + werdykt: czy można wystawić w internecie za HTTPS proxy.
