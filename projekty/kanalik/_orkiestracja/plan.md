# Plan: Kanalik — komunikator zespołowy podobny funkcjonalnie do Slacka

## Cel
Działająca aplikacja webowa (Node.js + przeglądarka) do komunikacji zespołowej w czasie rzeczywistym:
kanały publiczne/prywatne, wiadomości bezpośrednie (DM), wątki, reakcje emoji, edycja/usuwanie,
wzmianki @, wskaźnik pisania, obecność online, licznik nieprzeczytanych, wyszukiwanie, załączniki.
Własna nazwa ("Kanalik") i własny wygląd — NIE kopiujemy logo, nazw, kolorów ani grafik Slacka.

## Założenia (decyzje kontrolera)
- Jeden workspace "Kanalik". UI w języku polskim. Brak zewnętrznych usług (wszystko lokalnie).
- Stack: Node >= 22.5, `express@4`, `ws@8` (już zainstalowane w `package.json`), baza `node:sqlite` (wbudowana, bez kompilacji).
- Frontend: czysty HTML/CSS/JS (bez bundlera), serwowany statycznie z `public/`.
- Hasła: `crypto.scrypt` + sól. Sesje: losowy token (32 bajty hex) w tabeli `sessions`.

## Kryteria akceptacji
1. `npm start` uruchamia serwer na `PORT` (domyślnie 3000); `http://localhost:3000` pokazuje ekran logowania/rejestracji.
2. `npm test` — wszystkie testy API + WebSocket przechodzą.
3. Dwóch użytkowników w dwóch kartach: wiadomość wysłana przez A pojawia się u B bez odświeżania (< 1 s).
4. Działają: tworzenie kanału, dołączanie, DM, wątek, reakcja, edycja, usuwanie, wyszukiwanie, upload obrazka, licznik nieprzeczytanych, wskaźnik pisania, kropka obecności.
5. Brak XSS: tekst wiadomości `<img src=x onerror=alert(1)>` renderuje się jako tekst.
6. Konta demo po pierwszym starcie: `anna` / `haslo123`, `bartek` / `haslo123`.

## Struktura plików
```
kanalik/
  package.json            (istnieje — NIE nadpisywać zależności, można dopisać pola)
  server.js               T1
  src/*.js                T1 (wewnętrzny podział dowolny)
  public/index.html       T2
  public/app.js           T2
  public/styles.css       T2
  tests/api.test.js       T3
  README.md               T1
```

## KONTRAKT (obowiązuje T1, T2, T3 dosłownie)

### Punkt wejścia backendu
`src/app.js` eksportuje:
```js
async function start({ port = 3000, dbPath = './data/kanalik.db', uploadsDir = './data/uploads', seed = true } = {})
// -> Promise<{ port: number, close: () => Promise<void> }>
// port: 0 => losowy wolny port; zwracany `port` to rzeczywisty port.
module.exports = { start };
```
`server.js`: `require('./src/app').start({ port: Number(process.env.PORT) || 3000, dbPath: process.env.DB_PATH, uploadsDir: process.env.UPLOADS_DIR })` (undefined => domyślne) i loguje URL. Katalogi tworzone automatycznie.

### Obiekty (JSON, camelCase)
- **User**: `{ id: number, username: string, displayName: string, avatarColor: string ("#rrggbb"), status: string, online: boolean }`
- **File**: `{ id: string, name: string, mime: string, size: number, url: string }` gdzie `url = "/files/" + id`
- **Reaction**: `{ emoji: string, count: number, userIds: number[] }`
- **Message**: `{ id: number, channelId: number, user: User, parentId: number|null, text: string, createdAt: string (ISO), editedAt: string|null, deleted: boolean, reactions: Reaction[], replyCount: number, lastReplyAt: string|null, file: File|null }`
  - usunięta wiadomość: `deleted: true`, `text: ""`, `file: null`, `reactions: []`.
- **Channel** (liczony z perspektywy bieżącego użytkownika): `{ id: number, name: string, topic: string, isPrivate: boolean, isDm: boolean, dmUser: User|null, memberCount: number, unreadCount: number, isMember: boolean, createdAt: string }`
  - DM: `name` = `"dm-<minId>-<maxId>"`, `dmUser` = drugi uczestnik (dla DM z samym sobą — ja), `isPrivate: true`.
  - `unreadCount` = liczba wiadomości najwyższego poziomu (parentId null, nieusuniętych) innych użytkowników o id > lastReadMessageId członka.

### Zasady ogólne
- Wszystkie trasy `/api/*` poza register/login wymagają nagłówka `Authorization: Bearer <token>`; brak/zły token => `401`.
- Błędy: status 4xx + `{ "error": "<komunikat po polsku>" }`. 400 walidacja, 401 auth, 403 brak uprawnień, 404 nie istnieje, 409 konflikt.
- Body JSON, limit `8mb`.
- Walidacja: `username` `^[a-z0-9_.]{3,20}$` (lowercase), `password` min 6 znaków, `displayName` 1–40 znaków (domyślnie = username), nazwa kanału `^[a-z0-9][a-z0-9_-]{0,79}$`, tekst wiadomości 1–4000 znaków po trim (pusty dozwolony tylko gdy jest `fileId`).

### REST
| Metoda i ścieżka | Body / query | Odpowiedź |
|---|---|---|
| POST /api/auth/register | `{username, password, displayName?}` | 201 `{token, user}`; 409 gdy username zajęty. Nowy user automatycznie dołącza do kanałów domyślnych (`ogolny`, `luzne-rozmowy`). |
| POST /api/auth/login | `{username, password}` | 200 `{token, user}`; 401 złe dane |
| POST /api/auth/logout | — | `{ok: true}` (usuwa token) |
| GET /api/me | — | `{user}` |
| PATCH /api/me | `{displayName?, status?}` (status 0–100 znaków) | `{user}`; broadcast `user.updated` |
| GET /api/users | — | `{users: User[]}` (wszyscy, sort po displayName) |
| GET /api/channels | — | `{channels: Channel[]}` — kanały i DM, których jestem członkiem; sort: najpierw nie-DM po name, potem DM |
| GET /api/channels/browse | — | `{channels: Channel[]}` — wszystkie publiczne nie-DM (z `isMember`) |
| POST /api/channels | `{name, topic?, isPrivate?}` | 201 `{channel}`; 409 nazwa zajęta; twórca = członek. Broadcast `channel.created` do członków (dla publicznych: do wszystkich podłączonych — z ich perspektywą `isMember`). |
| POST /api/channels/:id/join | — | `{channel}`; prywatny/DM => 403; event `channel.member_joined` do członków |
| POST /api/channels/:id/leave | — | `{ok: true}`; DM => 400 |
| PATCH /api/channels/:id | `{topic}` (0–250) | `{channel}`; tylko członek; event `channel.updated` do członków |
| GET /api/channels/:id/members | — | `{users: User[]}`; tylko członek (lub publiczny) |
| POST /api/channels/:id/members | `{userId}` | `{ok: true}`; tylko członek; nie dla DM; nowy członek dostaje `channel.created`, pozostali `channel.member_joined` |
| POST /api/dms | `{userId}` | `{channel}` — znajdź albo utwórz DM (userId == ja dozwolone). Przy utworzeniu: drugi uczestnik dostaje `channel.created`. |
| GET /api/channels/:id/messages | `?before=<msgId>&limit=<1..100, dom. 50>` | `{messages: Message[]}` — tylko parentId null, rosnąco po id, ostatnie `limit` o id < before. Tylko członek (403). |
| POST /api/channels/:id/messages | `{text, parentId?, fileId?}` | 201 `{message}`; tylko członek; parentId musi być wiadomością najwyższego poziomu w tym kanale (400). Event `message.created` do członków; przy odpowiedzi w wątku dodatkowo `message.updated` rodzica (replyCount/lastReplyAt). |
| GET /api/messages/:id/thread | — | `{parent: Message, replies: Message[]}` (rosnąco) |
| PATCH /api/messages/:id | `{text}` | `{message}` (editedAt ustawione); tylko autor (403); event `message.updated` |
| DELETE /api/messages/:id | — | `{ok: true}`; tylko autor; soft delete; event `message.updated` |
| POST /api/messages/:id/reactions | `{emoji}` (1–16 znaków) | `{message}` — przełącza (toggle) moją reakcję; event `message.updated` |
| POST /api/channels/:id/read | `{messageId}` | `{ok: true}` — ustawia lastReadMessageId = max(obecny, messageId) |
| GET /api/search | `?q=` (min 2 znaki) | `{results: (Message & {channelName: string})[]}` — LIKE bez rozróżniania wielkości liter, tylko kanały, których jestem członkiem, bez usuniętych, max 50, najnowsze pierwsze |
| POST /api/files | `{name, mime, dataBase64}` | 201 `{file}`; max 5 MB po dekodowaniu (413 gdy więcej) |
| GET /files/:id | — | plik z poprawnym Content-Type; bez autoryzacji (id = 32 znaki hex, losowe); `Content-Disposition: inline` tylko dla image/*, inaczej attachment; nagłówek `X-Content-Type-Options: nosniff` |

### WebSocket
- URL: `ws(s)://<host>/ws?token=<token>`; zły token => zamknięcie z kodem 4001.
- Serwer → klient (JSON `{type, ...}`):
  - `{type:"hello", user}` po połączeniu
  - `{type:"message.created", message}`
  - `{type:"message.updated", message}`
  - `{type:"channel.created", channel}` (perspektywa odbiorcy)
  - `{type:"channel.updated", channel}`
  - `{type:"channel.member_joined", channelId, user}`
  - `{type:"presence", userId, online}` (do wszystkich; online = ma ≥1 otwarte połączenie)
  - `{type:"typing", channelId, parentId, user}` (do pozostałych członków kanału, nie do nadawcy)
  - `{type:"user.updated", user}`
  - `{type:"pong"}`
- Klient → serwer: `{type:"typing", channelId, parentId?}`, `{type:"ping"}`.
- Eventy kanałowe trafiają WYŁĄCZNIE do członków danego kanału (prywatność!).

### Seed (gdy `seed: true` i baza nie ma użytkowników)
Użytkownicy `anna` (Anna Nowak) i `bartek` (Bartek Kowalski), hasło `haslo123`. Kanały domyślne `ogolny` (temat "Sprawy całego zespołu") i `luzne-rozmowy` (temat "Kawa, memy, weekend"), obaj członkami. Kilka (3–5) wiadomości powitalnych po polsku w `ogolny`, w tym jedna z odpowiedzią w wątku i reakcją.

## Zadania
| Zadanie | Wejście | Wyjście | Zależności | Agent | Model |
|---|---|---|---|---|---|
| T1 Backend | plan.md, briefs/T1.md | server.js, src/*, README.md | — | general-purpose | sonnet |
| T2 Frontend | plan.md, briefs/T2.md | public/* | — | general-purpose | sonnet |
| T3 Testy API/WS | plan.md, briefs/T3.md | tests/api.test.js | — | general-purpose | sonnet |
| T4 Integracja: `npm test` + poprawki backendu | wyniki T1, T3 | zielone testy | T1, T3 | wznowiony T1 | sonnet |
| T5 E2E w przeglądarce (Playwright, 2 użytkowników) | całość | out/T5.md + zrzuty | T1, T2 | general-purpose | sonnet |
| T6 Niezależna recenzja (bezpieczeństwo, zgodność z kontraktem) | plan, kod | out/T6.md | T4, T5 | general-purpose | opus |
| T7 Weryfikacja końcowa kontrolera | wszystko | ledger | T6 | kontroler | — |

## Fale
- Fala 1 (równolegle): T1, T2, T3
- Fala 2: T4 (kontroler uruchamia testy, poprawki robi wykonawca T1/T3), T5
- Fala 3: T6, poprawki, T7

## Ograniczenia globalne
- Nazwa produktu: "Kanalik". Zakaz używania nazwy "Slack", logo, palety (aubergine #4A154B) i grafik Slacka.
- Język UI i komunikatów błędów: polski.
- Zero zależności poza `express`, `ws` (runtime) — nie dodawać innych pakietów.
- Nie modyfikować plików należących do innego zadania.
- Niczego nie publikować, nie pushować, nie usuwać poza własnymi plikami.
