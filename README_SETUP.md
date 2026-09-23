# Yu-Gi-Oh! Battle Box Library v0.9

Enthalten: **29 Deck-Einträge**

- 12 klassische Structure Decks (Dragon's Roar ist bereits aufgelöst; die übrigen werden beim ersten Öffnen einmalig importiert)
- 3 Starter Decks (einmaliger Import)
- 14 historische Themendecks aus GX Tag Force 2 und World Championship 2008
- Kartenarchiv `cards/` auf GitHub
- Render.com rendert nur fehlende Karten in ca. 450 dpi
- PDF wird lokal im Browser erstellt
- Vollbildansicht durch Antippen einer Karte
- sichtbarer PDF-Öffnen/Download-Button
- Server- und GitHub-Token-Status
- Main-/Extra-Deck-Unterstützung

## Upload
Diese vier Dateien im Repo-Root ersetzen:
- `index.html`
- `decks.json`
- `server.mjs`
- `package.json`

Render baut danach wegen der neuen Abhängigkeit `cheerio` einmal neu.

## Wichtig
Die automatischen GitHub-Commits des Servers verwenden `[skip render]`.
Dadurch lösen neu archivierte Karten und einmalig importierte Decklisten keinen unnötigen Render-Neustart aus.

## Persistenz
Für dauerhafte Kartenspeicherung muss auf Render weiterhin `GITHUB_TOKEN`
mit `Contents: Read and write` für `jonassocke-bit/Yugioh-battlebox` gesetzt sein.
