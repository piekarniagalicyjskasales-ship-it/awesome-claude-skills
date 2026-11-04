# Kanalik

Kanalik to komunikator zespołowy działający w czasie rzeczywistym (Node.js + przeglądarka): kanały publiczne i prywatne, wiadomości bezpośrednie, wątki, reakcje emoji, wzmianki, wskaźnik pisania, obecność online, licznik nieprzeczytanych, wyszukiwanie i załączniki.

## Funkcje

- kanały publiczne i prywatne, przeglądanie i dołączanie do kanałów, zmiana tematu, dodawanie osób
- wiadomości bezpośrednie (DM, także do samego siebie)
- wątki (odpowiedzi do wiadomości), edycja i usuwanie własnych wiadomości
- reakcje emoji (przełączanie), wzmianki `@użytkownik`
- wskaźnik pisania, obecność online, licznik nieprzeczytanych
- wyszukiwanie wiadomości, załączniki (do 5 MB)
- aktualizacje na żywo przez WebSocket

## Wymagania

- Node.js >= 22.5 (używany jest wbudowany moduł `node:sqlite`; ostrzeżenie o eksperymentalności jest wyciszone)
- zależności: `express`, `ws`

## Uruchomienie

```
npm install
npm start
```

Aplikacja nasłuchuje na `http://localhost:3000`.

### Konta demo (po pierwszym starcie)

| Użytkownik | Hasło |
|---|---|
| `anna` | `haslo123` |
| `bartek` | `haslo123` |

### Zmienne środowiskowe

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3000` | port HTTP/WebSocket |
| `DB_PATH` | `./data/kanalik.db` | plik bazy SQLite |
| `UPLOADS_DIR` | `./data/uploads` | katalog załączników |
| `HOST` | `0.0.0.0` | adres nasłuchiwania |
| `SEED` | `true` | `false` wyłącza konta demo i wiadomości powitalne |
| `TRUST_PROXY` | wyłączone | liczba proxy przed aplikacją, np. `1` za jednym proxy (patrz sekcja Reverse proxy); limiter logowań używa wtedy prawdziwego IP klienta |
| `SESSION_TTL_DAYS` | `30` | ważność sesji (przesuwana przy użyciu) |
| `UPLOAD_QUOTA_MB` | `100` | kwota plików na użytkownika |
| `UPLOADS_TOTAL_MB` | `5000` | globalny limit miejsca na pliki (po przekroczeniu 507) |
| `REGISTRATION` | `open` (w Dockerze `code`) | `open`, `code` (wymaga kodu zaproszenia) lub `closed` |
| `REGISTRATION_CODE` | — | kod zaproszenia, min. 16 znaków (np. `openssl rand -hex 16`); wymagany przy `REGISTRATION=code` (bez niego serwer się nie uruchomi) |
| `REGISTER_LIMIT_PER_HOUR` | `5` | maks. udanych rejestracji na IP na godzinę (429 po przekroczeniu) |

Niepoprawne wartości (liczby < 1, nieznany `REGISTRATION`, `SEED` inne niż `true`/`false`) kończą start czytelnym komunikatem i kodem wyjścia 1.

## Testy

```
npm test
```

## Struktura projektu

```
server.js          punkt wejścia (czyta zmienne środowiskowe)
src/app.js         start({port, host, dbPath, uploadsDir, seed, registration, ...}) -> {port, close, cleanupOrphans}
src/db.js          otwarcie bazy i schemat SQL
src/models.js      zapytania i serializery (User, Channel, Message, File)
src/auth.js        hasła (scrypt) i tokeny
src/routes.js      trasy REST /api/* oraz /files/:id
src/realtime.js    serwer WebSocket (/ws), obecność, rozsyłanie zdarzeń
src/seed.js        konta demo, kanały domyślne i wiadomości powitalne
public/            frontend (HTML/CSS/JS)
tests/             testy API i WebSocket
```

## API (skrót)

Wszystkie trasy `/api/*` poza rejestracją i logowaniem wymagają nagłówka `Authorization: Bearer <token>`. Błędy: `{ "error": "..." }`.

| Metoda i ścieżka | Opis |
|---|---|
| POST `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | konto i sesja |
| POST `/api/auth/logout-all` | wylogowanie ze wszystkich urządzeń (zamyka też wszystkie WebSockety użytkownika) |
| POST `/api/ws-ticket` | jednorazowy bilet do WebSocket (ważny 30 s) |
| GET `/api/me/storage` | `{usedBytes, quotaBytes}` — zajęte miejsce na pliki |
| POST `/api/me/password` | zmiana hasła `{currentPassword, newPassword}`; kończy wszystkie sesje, zwraca `{ok, token}` nowej sesji |
| GET `/api/config` | `{registration}` bez autoryzacji (tryb rejestracji: `open`/`code`/`closed`) |
| GET `/api/health` | `{ok:true}` bez autoryzacji (healthcheck) |
| GET/PATCH `/api/me` | profil (displayName, status) |
| GET `/api/users` | wszyscy użytkownicy |
| GET `/api/channels`, `/api/channels/browse` | moje kanały i DM / publiczne kanały |
| POST `/api/channels` | utworzenie kanału |
| POST `/api/channels/:id/join`, `/leave` | dołączenie / opuszczenie |
| PATCH `/api/channels/:id` | zmiana tematu |
| GET/POST `/api/channels/:id/members` | członkowie / dodanie osoby |
| POST `/api/dms` | znajdź lub utwórz DM |
| GET/POST `/api/channels/:id/messages` | historia (`before`, `limit`) / nowa wiadomość |
| GET `/api/messages/:id/thread` | wątek |
| PATCH/DELETE `/api/messages/:id` | edycja / usunięcie |
| POST `/api/messages/:id/reactions` | przełączenie reakcji |
| POST `/api/channels/:id/read` | oznaczenie jako przeczytane |
| GET `/api/search?q=` | wyszukiwanie |
| POST `/api/files`, GET `/files/:id` | załączniki |

### WebSocket

Limity: 20 aktywnych biletów na sesję, 30 biletów na minutę na sesję (429), 10 jednoczesnych połączeń na użytkownika (nadmiarowe zamykane kodem 4008). Połączenie: najpierw `POST /api/ws-ticket` (z nagłówkiem Bearer), potem `ws://host/ws?ticket=<ticket>`. Bilet jest jednorazowy i ważny 30 s; brak, zły, zużyty lub wygasły bilet (a także parametr `token`) powoduje zamknięcie kodem 4001. Wylogowanie lub wygaśnięcie sesji zamyka jej sockety kodem 4001.

| Kierunek | Zdarzenie |
|---|---|
| serwer -> klient | `hello`, `message.created`, `message.updated`, `channel.created`, `channel.updated`, `channel.member_joined`, `presence`, `typing`, `user.updated`, `pong` |
| klient -> serwer | `{type:"typing", channelId, parentId?}`, `{type:"ping"}` |

Zdarzenia kanałowe trafiają wyłącznie do członków danego kanału.

## Rejestracja

Tryb ustawia `REGISTRATION`:

- `open` — każdy może założyć konto (domyślnie przy `npm start`)
- `code` — rejestracja wymaga pola `inviteCode` zgodnego z `REGISTRATION_CODE` (błędny kod: 403); tryb domyślny w Dockerze
- `closed` — rejestracja wyłączona (403); konta trzeba utworzyć wcześniej

Dodatkowo, niezależnie od trybu: max `REGISTER_LIMIT_PER_HOUR` udanych rejestracji na IP na godzinę (domyślnie 5). Uwaga: biuro za jednym adresem publicznym (NAT) dzieli ten limit — przy wdrażaniu zespołu podnieś `REGISTER_LIMIT_PER_HOUR`. W trybie `code` dodatkowo 10 błędnych kodów na IP w 15 minut blokuje dalsze próby (429, także z poprawnym kodem). Kod zaproszenia wygeneruj losowo, np. `openssl rand -hex 16`.

## Reverse proxy i `TRUST_PROXY`

Aplikacja nie obsługuje HTTPS — wystaw ją za reverse proxy z TLS (Caddy, nginx). Port aplikacji nie może być dostępny publicznie: wiąż go z `127.0.0.1` (`HOST=127.0.0.1`) albo trzymaj w sieci compose.

| Sytuacja | `TRUST_PROXY` |
|---|---|
| bez proxy (aplikacja bezpośrednio) | nie ustawiaj |
| jedno proxy (Caddy/nginx) przed aplikacją | `1` |
| dwa proxy (np. Cloudflare + Caddy) | `2` |

Skutki błędnej konfiguracji: `true` ufa nagłówkowi `X-Forwarded-For` od każdego klienta (limiter logowań i rejestracji da się obejść podrabianym IP; serwer ostrzega przy starcie); ustawienie `1`, gdy aplikacja jest dostępna bezpośrednio, ma ten sam skutek; brak `TRUST_PROXY` za proxy sprawia, że wszyscy klienci mają IP proxy, więc 10 błędnych prób jednej osoby blokuje logowanie danego konta wszystkim.

## Bezpieczeństwo i znane ograniczenia

Zabezpieczenia:

- limit nieudanych logowań: 10 prób w 10 minut na parę IP + nazwa użytkownika, potem 429 (także dla poprawnego hasła); udane logowanie zeruje licznik; hasła haszowane asynchronicznie (scrypt), maks. 200 znaków; zmiana hasła kończy wszystkie sesje
- rejestracja: tryby `open`/`code`/`closed` i limit na IP
- sesje: maks. 20 na użytkownika (najstarsze są usuwane); w bazie leży tylko `SHA-256(token)`; ważność przesuwana (`SESSION_TTL_DAYS`, zapis do bazy najwyżej raz na godzinę), wygasłe sesje są sprzątane; `logout-all` kończy wszystkie sesje użytkownika
- WebSocket bez tokenu w URL: jednorazowe bilety (30 s, tylko w pamięci serwera, limity na sesję); heartbeat (ping co 30 s), limit ramki 16 KB, limit 10 połączeń na użytkownika, zamykanie socketów wygasłych lub wylogowanych sesji
- pliki: upload wymaga uwierzytelnienia przed odczytem body, sprawdza `Content-Length` względem kwoty (413) i miejsca na serwerze (507), maks. 2 równoległe uploady na użytkownika (429); kwota na użytkownika (`UPLOAD_QUOTA_MB`); usunięcie wiadomości usuwa jej załącznik; pliki-sieroty starsze niż 24 h (także pliki bez wiersza w bazie) są sprzątane przy starcie i co godzinę
- Content-Security-Policy (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'` itd.), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`; `Cache-Control: no-store` dla `/api/*`; pliki użytkowników są serwowane z własnym CSP `sandbox`
- limit JSON 100 kB (8 MB tylko dla wysyłania plików)
- łagodne zamykanie na SIGTERM/SIGINT: koniec przyjmowania połączeń, WebSockety kodem 1001, do 8 s łącznie na zamknięcie WebSocketów i żądania w toku, potem zamknięcie bazy; `GET /api/health` do healthchecków

Znane ograniczenia:

- jedna instancja: bilety WebSocket i limity działają w pamięci procesu, więc aplikacji nie da się skalować poziomo (kilka instancji za load balancerem nie zadziała poprawnie)
- `SEED` domyślnie `true` przy `npm start` (wygoda lokalna: konta `anna`/`bartek` z hasłem `haslo123`); w Dockerze domyślnie `false`. Przed wystawieniem poza localhost ustaw `SEED=false`
- socket wygasłej sesji może żyć do 30 s (do najbliższego sprawdzenia heartbeat)
- aplikacja nie terminuje HTTPS — patrz sekcja o reverse proxy

## Docker

Gotowy obraz zawiera aplikację z domyślnymi ustawieniami produkcyjnymi: dane (baza i załączniki) w wolumenie `/data`, działa jako użytkownik `node`, konta demo wyłączone (`SEED=false`), rejestracja z kodem zaproszenia (`REGISTRATION=code`), healthcheck na `/api/health`.

### Uruchomienie

Kod zaproszenia (min. 16 znaków) trzymaj w pliku `.env` obok `docker-compose.yml` — bez niego kontener nie wystartuje, a w logach zobaczysz komunikat o błędzie konfiguracji.

1. Wygeneruj kod (jednorazowo; `cat .env` pokaże kod do przekazania zespołowi):

   ```
   echo "REGISTRATION_CODE=$(openssl rand -hex 16)" > .env
   ```

2. Uruchom:

   ```
   docker compose up -d --build
   ```

Zmiana kodu = edycja `.env` i `docker compose up -d`. Tryb rejestracji zmienisz zmienną `REGISTRATION=open|closed` w tym samym pliku.

Aplikacja jest dostępna na `http://localhost:3000` (port jest domyślnie przypięty tylko do `127.0.0.1` — publicznie udostępniaj ją przez reverse proxy z TLS; w compose ustawiono `TRUST_PROXY=1`).

### Wersja z HTTPS (Caddy)

```
cp deploy/Caddyfile.example deploy/Caddyfile
echo "DOMAIN=czat.firma.pl" >> .env
docker compose --profile https up -d --build
```

Wymagania: domena wskazuje na serwer, porty 80 i 443 (TCP i UDP dla HTTP/3) są otwarte. Caddy sam pobiera i odnawia certyfikat.

### Pierwsze konto

Konta demo są wyłączone (`SEED=false`). Pierwsze konto utwórz przez rejestrację w przeglądarce, podając kod zaproszenia (`REGISTRATION_CODE`).

### Kopia zapasowa

```
docker run --rm -v kanalik_kanalik-data:/data -v "$PWD":/backup alpine tar czf /backup/kanalik-backup.tgz -C /data .
```

Nazwa wolumenu to `<katalog projektu>_kanalik-data` (sprawdź: `docker volume ls`). Dla spójnej kopii zatrzymaj wcześniej aplikację (`docker compose stop kanalik`).

### Aktualizacja

```
git pull
docker compose up -d --build
```

Dane w wolumenie `kanalik-data` zostają zachowane.

### Logi

```
docker compose logs -f kanalik
```
