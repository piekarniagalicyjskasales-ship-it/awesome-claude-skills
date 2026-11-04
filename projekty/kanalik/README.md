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
| `TRUST_PROXY` | wyłączone | np. `1` lub `loopback` — za reverse proxy; limiter logowań używa wtedy prawdziwego IP klienta |
| `SESSION_TTL_DAYS` | `30` | ważność sesji (przesuwana przy użyciu) |
| `UPLOAD_QUOTA_MB` | `100` | kwota plików na użytkownika |

## Testy

```
npm test
```

## Struktura projektu

```
server.js          punkt wejścia (czyta zmienne środowiskowe)
src/app.js         start({port, dbPath, uploadsDir, seed}) -> {port, close}
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

Połączenie: najpierw `POST /api/ws-ticket` (z nagłówkiem Bearer), potem `ws://host/ws?ticket=<ticket>`. Bilet jest jednorazowy i ważny 30 s; brak, zły, zużyty lub wygasły bilet (a także parametr `token`) powoduje zamknięcie kodem 4001. Wylogowanie lub wygaśnięcie sesji zamyka jej sockety kodem 4001.

| Kierunek | Zdarzenie |
|---|---|
| serwer -> klient | `hello`, `message.created`, `message.updated`, `channel.created`, `channel.updated`, `channel.member_joined`, `presence`, `typing`, `user.updated`, `pong` |
| klient -> serwer | `{type:"typing", channelId, parentId?}`, `{type:"ping"}` |

Zdarzenia kanałowe trafiają wyłącznie do członków danego kanału.

## Bezpieczeństwo i znane ograniczenia

Zabezpieczenia:

- limit nieudanych logowań: 10 prób w 10 minut na parę IP + nazwa użytkownika, potem 429 (także dla poprawnego hasła); udane logowanie zeruje licznik; hasła haszowane asynchronicznie (scrypt), maks. 200 znaków
- sesje: w bazie leży tylko `SHA-256(token)`; ważność przesuwana (`SESSION_TTL_DAYS`, zapis do bazy najwyżej raz na godzinę), wygasłe sesje są sprzątane; `logout-all` kończy wszystkie sesje użytkownika
- WebSocket bez tokenu w URL: jednorazowe bilety (30 s, tylko w pamięci serwera); heartbeat (ping co 30 s), limit ramki 16 KB, zamykanie socketów wygasłych lub wylogowanych sesji
- pliki: kwota na użytkownika (`UPLOAD_QUOTA_MB`, 413 po przekroczeniu); usunięcie wiadomości usuwa jej załącznik; pliki-sieroty starsze niż 24 h są sprzątane przy starcie i co godzinę
- Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'` itd.), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`; pliki użytkowników są serwowane z własnym CSP `sandbox`
- limit JSON 100 kB (8 MB tylko dla wysyłania plików)
- graceful shutdown na SIGTERM/SIGINT; `GET /api/health` do healthchecków

Znane ograniczenia:

- limiter logowań i bilety WebSocket działają w pamięci jednego procesu (nie przeżywają restartu ani nie działają między instancjami)
- aplikacja nie terminuje HTTPS — w internecie uruchamiaj ją za reverse proxy z TLS (i ustaw `TRUST_PROXY`)

## Docker

Gotowy obraz zawiera aplikację z domyślnymi ustawieniami produkcyjnymi: dane (baza i załączniki) w wolumenie `/data`, działa jako użytkownik `node`, konta demo wyłączone (`SEED=false`), healthcheck na `/api/health`.

### Uruchomienie

```
docker compose up -d --build
```

Aplikacja jest dostępna na `http://localhost:3000` (port jest domyślnie przypięty tylko do `127.0.0.1` — publicznie udostępniaj ją przez reverse proxy z TLS).

### Wersja z HTTPS (Caddy)

```
cp deploy/Caddyfile.example deploy/Caddyfile
DOMAIN=czat.firma.pl docker compose --profile https up -d --build
```

Wymagania: domena wskazuje na serwer, porty 80 i 443 (TCP i UDP dla HTTP/3) są otwarte. Caddy sam pobiera i odnawia certyfikat.

### Pierwsze konto

Konta demo są wyłączone (`SEED=false`). Pierwsze konto utwórz przez rejestrację w przeglądarce.

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
