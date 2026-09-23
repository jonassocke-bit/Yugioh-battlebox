# Yu-Gi-Oh! Battle Box Library v0.6

Diese Version trennt die Aufgaben:

- GitHub Pages (`index.html`) = Deckansicht, Kartenstatus, PDF-Layout im Browser.
- `decks.json` = dauerhafte Deckbibliothek.
- `cards/` = dauerhafte gerenderte Karten.
- Render.com (`server.mjs`) = rendert nur fehlende Karten in ca. 450 dpi.
- Optional kann Render neue PNGs automatisch als **einen Commit** nach GitHub zurückschreiben.

## Dateien ins Repo
Alle Dateien aus diesem ZIP in den Root von `jonassocke-bit/Yugioh-battlebox` kopieren.
Der Ordner `cards/` muss ebenfalls vorhanden sein; `.gitkeep` hält ihn zunächst im Repo.

## Render.com
Der bestehende Service kann weiterverwendet werden:
- Build Command: `npm install`
- Start Command: `npm start`

### Für automatische GitHub-Speicherung
Auf Render unter Environment setzen:
- `GITHUB_TOKEN` = Fine-grained GitHub Token, nur für dieses Repo, Berechtigung **Contents: Read and write**
- `GITHUB_REPO` = `jonassocke-bit/Yugioh-battlebox`
- `GITHUB_BRANCH` = `main`

Ohne Token funktioniert das Rendern ebenfalls. Die Bilder bleiben dann aber nur temporär auf Render und gehen bei einem Neustart verloren.

## Deckdaten
Neue Decks werden künftig nur noch in `decks.json` ergänzt.
Der Renderer und das PDF-Layout müssen dafür nicht neu gebaut werden.

### Kartenobjekt
```json
{
  "key": "optional-eigener-asset-key",
  "set": "SD1-DE011",
  "en": "Mystical Space Typhoon",
  "de": "Mystischer Raum-Taifun",
  "type": "Zauber",
  "qty": 1
}
```

Wenn `key` fehlt, wird der Setcode als Bildschlüssel genutzt. Dadurch kann ein offizielles Deck exakt seinen eigenen Setcode auf der Karte behalten.
