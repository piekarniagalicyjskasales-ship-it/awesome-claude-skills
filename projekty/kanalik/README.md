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

Połączenie: `ws://host/ws?token=<token>` (zły token: zamknięcie kodem 4001).

| Kierunek | Zdarzenie |
|---|---|
| serwer -> klient | `hello`, `message.created`, `message.updated`, `channel.created`, `channel.updated`, `channel.member_joined`, `presence`, `typing`, `user.updated`, `pong` |
| klient -> serwer | `{type:"typing", channelId, parentId?}`, `{type:"ping"}` |

Zdarzenia kanałowe trafiają wyłącznie do członków danego kanału.
