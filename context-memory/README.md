# context-memory

Plugin Claude Code, który **pamięta kontekst między sesjami** i **wyciąga informacje z innych rozmów**, także tych otwartych w tej chwili w innych oknach.

| Element | Co robi |
|---|---|
| Skill `context-memory` | Notatki trwałe (decyzje, preferencje, fakty, todo) + automatyczny handoff przed kompaktowaniem i na koniec sesji |
| Skill `session-recall` | Przeszukiwanie, czytanie i ekstrakcja informacji z transkryptów wszystkich sesji w `~/.claude/projects` oraz lista sesji otwartych teraz |
| Hooki | `SessionStart` wstrzykuje pamięć i listę innych otwartych sesji, `PreCompact` i `SessionEnd` zapisują handoff |
| Komendy | `/sessions`, `/recall <słowa>`, `/remember <notatka>`, `/handoff`, `/resume` |

Wszystko to czysty Python ze standardowej biblioteki, działa lokalnie, nic nie wysyła na zewnątrz. Pliki pamięci to zwykły Markdown, który możesz czytać i edytować ręcznie.

## Instalacja

Z katalogu głównego tego repozytorium:

```bash
claude plugin marketplace add ./
```

```bash
claude plugin install context-memory@awesome-claude-skills --scope user
```

Albo jednym skryptem, który dodatkowo podnosi `cleanupPeriodDays` do 365 (Claude Code domyślnie usuwa transkrypty po 30 dniach, a bez nich nie ma czego przeszukiwać):

```bash
bash context-memory/install.sh
```

Opcjonalnie `--with-claude-mem` doinstaluje [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem), czyli automatyczną pamięć kompresowaną przez AI. Oba pluginy się uzupełniają: claude-mem zapisuje obserwacje z każdego wywołania narzędzia, context-memory daje jawne notatki, handoff i czytanie transkryptów innych sesji.

Wymagania: Claude Code 2.x, `python3` w PATH. Na Windows, jeśli masz tylko `python`, zamień `python3` na `python` w `hooks/hooks.json`.

## Użycie

Zacznij nową sesję po instalacji. Hook `SessionStart` sam wstrzyknie globalne notatki, notatki projektu, ostatni handoff i listę innych otwartych sesji.

| Chcesz | Powiedz lub wpisz |
|---|---|
| Zobaczyć, co robią inne okna Claude Code | `/sessions` albo „co się dzieje w drugim oknie?” |
| Znaleźć wcześniejszą rozmowę | `/recall faktury` albo „w której rozmowie ustalaliśmy format faktur?” |
| Przenieść tu decyzje, pliki lub komendy z innej sesji | „wyciągnij z sesji 3fa2 listę zmienionych plików” |
| Zapamiętać coś na stałe | `/remember zawsze odpowiadaj po polsku --global` albo „zapamiętaj: używamy pnpm” |
| Zamknąć sesję z notatką dla następnej | `/handoff migracja gotowa, zostały testy` |
| Wrócić do pracy | `/resume` albo „kontynuujmy” |

### Skrypty bezpośrednio

```bash
python3 context-memory/skills/session-recall/scripts/recall.py open
python3 context-memory/skills/session-recall/scripts/recall.py search "słowa" --since 2w
python3 context-memory/skills/session-recall/scripts/recall.py extract <prefiks-id-sesji>
python3 context-memory/skills/session-recall/scripts/recall.py show <prefiks-id-sesji> --last 10
python3 context-memory/skills/context-memory/scripts/memory.py add "tekst" --tag decision
python3 context-memory/skills/context-memory/scripts/memory.py resume
```

Każda komenda ma `-h` i `--json`.

## Gdzie leżą dane

| Plik | Zawartość |
|---|---|
| `~/.claude/memory/global.md` | notatki wspólne dla wszystkich projektów |
| `~/.claude/projects/<projekt>/memory/notes.md` | notatki projektu |
| `~/.claude/projects/<projekt>/memory/handoff.md` | 5 ostatnich handoffów, najnowszy na górze |
| `~/.claude/projects/<projekt>/*.jsonl` | transkrypty sesji (tylko czytane) |
| `~/.claude/sessions/*.json` | rejestr uruchomionych sesji (tylko czytany) |

`<projekt>` to ścieżka katalogu roboczego z każdym znakiem innym niż litera lub cyfra zamienionym na `-`. To ten sam folder, w którym Claude Code trzyma własną auto‑pamięć `MEMORY.md`; plugin jej nie nadpisuje.

## Bezpieczeństwo

Transkrypty innych sesji mogą zawierać sekrety, które tamte sesje wypisały. Skill ma zakaz kopiowania tokenów i haseł do bieżącej rozmowy. Skrypty nic nie usuwają ani nie modyfikują w `~/.claude/projects` poza własnym folderem `memory/`.

## Jako osobne repozytorium

Folder jest samowystarczalny. Aby zrobić z niego osobne repo:

```bash
git subtree split --prefix=context-memory -b context-memory-only
```

```bash
gh repo create piekarniagalicyjskasales-ship-it/claude-context-memory --public --source=. --push
```

Wtedy instalacja to `claude plugin marketplace add piekarniagalicyjskasales-ship-it/claude-context-memory` po dodaniu do nowego repo pliku `.claude-plugin/marketplace.json` z jednym wpisem `"source": "./"`.

## Licencja

MIT, patrz [LICENSE](./LICENSE).
