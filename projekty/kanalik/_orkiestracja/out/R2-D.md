# R2-D Docker - raport weryfikacji

Pliki: Dockerfile, .dockerignore, docker-compose.yml, deploy/Caddyfile.example, README.md (tylko sekcja `## Docker`).

1. Build: sukces. Rozmiar obrazu kanalik:test = 248 MB (disk usage; sam node:22-alpine = 239 MB, warstwa aplikacji ~9 MB).
   UWAGA srodowiskowa: sandbox przechwytuje TLS (MITM), wiec `npm ci` w buildzie nie ufa CA. Build zweryfikowano Dockerfile'em tymczasowym (poza repo) rozniacym sie TYLKO linia `RUN --mount=type=secret,id=ca NODE_EXTRA_CA_CERTS=... npm ci ...` + `--secret id=ca,src=/root/.ccr/ca-bundle.crt`. Dockerfile w repo jest standardowy (na zwyklym hoscie z internetem zbuduje sie bez zmian); nie budowano go bezposrednio w tym sandboxie.
2. Run na porcie 3400: `/api/health` -> `{"ok":true}`; log "Kanalik dziala: http://localhost:3000"; `id -u` = 1000 (nie root); health status po ~43 s = healthy. Flaga `--disable-warning=ExperimentalWarning` dziala w node 22-alpine.
3. Rejestracja (zed) -> token; login zed -> token 64 znaki; POST wiadomosci na kanal 1 -> OK; login `anna`/haslo123 -> 401 (SEED=false).
4. WebSocket: bilet z /api/ws-ticket -> `ws://localhost:3400/ws?ticket=` -> zdarzenie `hello` (HELLO OK).
5. Trwalosc: `docker rm -f`, ponowny run z tym samym wolumenem -> login zed dziala, wiadomosc "docker-hello" obecna.
6. `docker stop` = 0.24 s, kod wyjscia 0 (graceful shutdown).
7. `docker compose config` OK bez profilu i z `--profile https` (DOMAIN=example.com, tymczasowy deploy/Caddyfile, usuniety po ttescie; port 3000 przypiety do 127.0.0.1). Poprawka w trakcie: `${DOMAIN:?}` psulo config bez profilu, zmieniono na `${DOMAIN:-localhost}`.
8. Sprzatanie: kontener kanalik-test i wolumen kanalik-test-data usuniete; obraz kanalik:test zostawiony.

Nazwa wolumenu w README: `kanalik_kanalik-data` (zalezy od nazwy katalogu projektu; README to zaznacza). Nie testowano realnego Caddy/certyfikatu (brak domeny/obrazu caddy).
