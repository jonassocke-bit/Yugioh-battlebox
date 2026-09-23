# Yu-Gi-Oh! Battle Box Library v0.10

Diese Version hat **keine Laufzeit-Deckimports mehr**.

Enthalten:
- 12 Structure Decks
- 3 Starter Decks
- 23 historische Themendecks
- insgesamt **38 Decks**

Alle Kartenlisten stehen direkt in `decks.json`.

## Upload
Im Repo-Root ersetzen:
- `index.html`
- `decks.json`
- `server.mjs`
- `package.json`

Render deployt danach automatisch neu.

## Architektur
- GitHub Pages: Deckansicht + lokales PDF
- `decks.json`: komplette Deckbibliothek
- `cards/`: dauerhaftes 450-dpi-Kartenarchiv
- Render.com: rendert nur fehlende Bilder und schreibt sie nach GitHub

Der Server-Status prüft jetzt nicht nur, ob `GITHUB_TOKEN` gesetzt ist,
sondern fragt GitHub ab und zeigt `Schreibzugriff ✓`, wenn die Berechtigung
vom Repository bestätigt wird.
