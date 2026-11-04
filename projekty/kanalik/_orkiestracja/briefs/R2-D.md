# R2-D — Docker dla Kanalik

Kontekst: `/home/user/kanalik` — aplikacja Node 22 (express, ws, node:sqlite — bez modułów natywnych). Przeczytaj `briefs/R2.md` (sekcja „Wdrożenie” i env) oraz `README.md`.

## Pliki
1. **`Dockerfile`** (multi-stage nie jest konieczny, ale obraz ma być mały):
   - `FROM node:22-alpine` (już pobrany lokalnie).
   - `WORKDIR /app`; kopiuj `package.json` + `package-lock.json`, `npm ci --omit=dev`, potem `server.js`, `src/`, `public/` (nie kopiuj tests/, _orkiestracja/, node_modules hosta).
   - `ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DB_PATH=/data/kanalik.db UPLOADS_DIR=/data/uploads SEED=false`.
   - Katalog `/data` należący do użytkownika `node`; `USER node`; `VOLUME /data`; `EXPOSE 3000`.
   - `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`.
   - `CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]` (sprawdź, że flaga działa w node 22-alpine; jeśli nie — zwykłe `node server.js`).
   - Etykiety OCI (title, description, source opcjonalnie pomiń).
2. **`.dockerignore`**: node_modules, data, *.db*, tests, _orkiestracja, .git, *.md poza README.md niepotrzebne itp.
3. **`docker-compose.yml`**:
   - usługa `kanalik`: `build: .`, `image: kanalik:latest`, `restart: unless-stopped`, port `127.0.0.1:3000:3000` (domyślnie tylko localhost — publicznie przez proxy), wolumen nazwany `kanalik-data:/data`, env: `TRUST_PROXY=1`, `SESSION_TTL_DAYS=30`, `UPLOAD_QUOTA_MB=100`, `SEED=${SEED:-false}`.
   - usługa `caddy` w profilu `https` (`profiles: ["https"]`): `caddy:2-alpine`, porty 80/443 (+443/udp), wolumeny `./deploy/Caddyfile:/etc/caddy/Caddyfile:ro`, `caddy-data`, `caddy-config`; `depends_on: kanalik`; env `DOMAIN`. Gdy profil https używany, Caddy łączy się z `kanalik:3000` w sieci compose.
4. **`deploy/Caddyfile.example`**: `{$DOMAIN} { encode zstd gzip; reverse_proxy kanalik:3000 }` (WebSocket działa automatycznie) + komentarz po polsku, że trzeba skopiować do `deploy/Caddyfile` i ustawić `DOMAIN`.
5. **README.md** — zastąp linijkę „(uzupełnione w R2-D)” w sekcji `## Docker` instrukcją po polsku: build/uruchomienie (`docker compose up -d --build`), wersja z HTTPS (`cp deploy/Caddyfile.example deploy/Caddyfile`, `DOMAIN=czat.firma.pl docker compose --profile https up -d --build`, wymagania: domena wskazująca na serwer, porty 80/443), pierwsze konto (rejestracja przez UI; SEED=false), kopia zapasowa (`docker run --rm -v kanalik_kanalik-data:/data -v "$PWD":/backup alpine tar czf /backup/kanalik-backup.tgz -C /data .` — sprawdź właściwą nazwę wolumenu), aktualizacja, logi. Nie zmieniaj innych sekcji README.

## Weryfikacja (wymagana, z dowodami w raporcie)
Daemon Docker działa (`docker info`). Wykonaj:
1. `docker build -t kanalik:test .` — sukces; podaj rozmiar obrazu.
2. `docker run -d --name kanalik-test -p 3400:3000 -v kanalik-test-data:/data kanalik:test`; po ~5 s: `curl localhost:3400/api/health` → `{"ok":true}`; `docker inspect --format '{{.State.Health.Status}}'` po ~40 s → healthy; `docker exec kanalik-test id -u` ≠ 0.
3. Rejestracja + login + wysłanie wiadomości curl-em przez port 3400; login `anna` → 401 (SEED=false).
4. WebSocket: skrypt node (pakiet `ws` z `/home/user/kanalik/node_modules`) — bilet → połączenie do `ws://localhost:3400/ws?ticket=` → `hello`.
5. Trwałość: `docker rm -f kanalik-test`, ponowny `docker run` z tym samym wolumenem → login zarejestrowanego użytkownika działa, wiadomość jest.
6. `docker stop` kończy się w < 10 s (graceful shutdown) — podaj czas.
7. `docker compose config` przechodzi (z i bez `--profile https`; dla https z `DOMAIN=example.com` i skopiowanym Caddyfile tymczasowo — usuń kopię po teście, jeśli deploy/Caddyfile nie istniał).
8. Posprzątaj: usuń kontenery i wolumen testowy `kanalik-test-data`, obraz `kanalik:test` możesz zostawić.

## Wyjście
Pliki jw. + raport `/home/user/kanalik/_orkiestracja/out/R2-D.md` z wynikami punktów 1–8.
