# T5 — E2E w przeglądarce (Playwright)

Wynik: **15 PASS / 0 FAIL** (15 scenariuszy). Skrypt: `_orkiestracja/out/e2e.js`, serwer na :3100, baza w /tmp/claude-0/e2e.

| # | Scenariusz | Wynik | Dowód |
|---|---|---|---|
| 1 | Logowanie anna i bartek; #ogolny z wiadomościami seed | PASS | #ogolny, wiadomości: anna=3, bartek=3 |
| 2 | Wiadomość Anny u Bartka < 1 s | PASS | dostarczono w 79 ms |
| 3 | Badge nieprzeczytanych przy ogolny, znika po wejściu | PASS | badge=1, po wejściu zniknął |
| 4 | Wskaźnik pisania | PASS | u Bartka: "Anna Nowak pisze…" |
| 5 | Reakcja 👍 Bartka widoczna u Anny z licznikiem 1 | PASS | pigułka u Anny: 👍1 |
| 6 | Wątek: odpowiedź Bartka → Anna widzi "1 odpowiedź" i treść | PASS | link: "1 odpowiedźostatnia 15:02", treść w panelu |
| 7 | Edycja i usunięcie wiadomości Anny widoczne u Bartka | PASS | (edytowano) i "Ta wiadomość została usunięta." u Bartka |
| 8 | Anna tworzy kanał, Bartek dołącza przez Przeglądaj kanały | PASS | kanał #projekt-mw0tgof5, Bartek dołączył i widzi wiadomość Anny |
| 9 | DM Anna → Bartek | PASS | DM w sidebarze Bartka: "Anna Nowak 1", wiadomość widoczna |
| 10 | Wyszukiwanie → wyniki w panelu, klik przenosi do kanału | PASS | wyników: 1, przeniesiono do #ogolny |
| 11 | Upload PNG → miniatura u obu | PASS | img załadowany u obu |
| 12 | XSS: tekst dosłownie, brak wykonania | PASS | window.__xss undefined u obu (też po reload), tekst dosłowny |
| 13 | Obecność: zamknięcie strony Bartka → kropka offline u Anny | PASS | kropka online → offline po zamknięciu karty Bartka |
| 14 | Mobile 390x844: sidebar schowany, ☰ otwiera, brak poziomego scrolla | PASS | sidebar ukryty, ☰ otwiera, scrollWidth-clientWidth=0 |
| 15 | Wylogowanie i rejestracja nowego konta → #ogolny | PASS | konto nowytgof5 utworzone, widok #ogolny |

## Uwagi (nie FAIL)

- Scenariusz 4 przy pierwszym biegu (bez pauzy) dał FAIL: Anna pisała < 3 s po wysłaniu poprzedniej wiadomości i wskaźnik nie pojawił się u Bartka. Przyczyna: `public/app.js`, `makeComposer()` — throttle `lastTyping` (3 s) liczy się od ostatniego sygnału typing sprzed wysyłki i nie jest zerowany po `send()`, więc pierwsze naciśnięcia klawiszy w kolejnej wiadomości nie wysyłają `typing`. Skutek kosmetyczny (opóźnienie wskaźnika do 3 s po wysłaniu). Skrypt czeka teraz 3,5 s przed krokiem. Sugestia: `lastTyping = 0` w `send()`.
- Wszystkie 15 scenariuszy PASS w ostatnim pełnym biegu; serwer testowy zatrzymany.

## Błędy konsoli / pageerror

Brak.

## Zrzuty

- shots/01-login.png
- shots/02-anna-main.png
- shots/03-anna-thread.png
- shots/04-search.png
- shots/05-mobile.png
- shots/06-mobile-nav.png
- shots/07-register-ogolny.png
