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


## v0.11 Patch
- adaptive Textkompression für lange deutsche Effekte
- korrigierte Zauber-/Fallensymbole (z. B. Permanent/Konter/Spielfeld etc.)


## v0.12 Patch
- neuer Button **Deck neu rendern**
- überschreibt vorhandene Karten im Archiv direkt neu
- kein Löschen vorher nötig


## v0.13 Patch
- Monster-Typzeile im Renderer per Postinstall-Patch auf **90 %** verkleinert
- Normale Monster zeigen jetzt nur noch den Typ, also z. B. **[DRACHE]** statt **[DRACHE / NORMAL]**
- ideal vor einem späteren 'Alle rendern'-Button

## v0.14 – Final-Polish-Test

Vor einem späteren Mass-Render sind jetzt die aktuell bekannten Darstellungsfehler zusammengezogen:

- Monster-Typzeile auf **81 %** der ursprünglichen Renderer-Größe
- Typzeilen ohne Leerzeichen um `/`, z. B. `[PYRO/EFFEKT]`
- `Normal` wird bei normalen Monstern weiterhin weggelassen
- `typeline` der Kartendaten wird vollständig übersetzt:
  Effekt, Ritual, Fusion, Toon, Spirit, Union, Zwilling, Empfänger, Flipp usw.
- Kartennummer/Passcode immer achtstellig (`00980973`)
- Sicherheits-Hologramm unten rechts (`laser1`)
- deutsche Attributbeschriftungen: FINSTERNIS, LICHT, ERDE, WASSER, FEUER, WIND, GÖTTLICH
- deutsche ZAUBER-/FALLE-Beschriftung im Attributsymbol
- aggressives First-Line-Autoscaling entfernt
- Renderer wechselt bei langen Texten früher auf die kleinere Textgröße statt alles horizontal zusammenzuquetschen
- „Deck komplett neu rendern“ umgeht jetzt wirklich den Render-Cache
- Browser verwendet nach Neu-Rendern Cache-Busting, damit nicht weiter alte GitHub-PNGs angezeigt werden

### Testempfehlung
Vor dem kompletten Leeren von `cards/` zuerst ein einzelnes Deck komplett neu rendern und
mindestens diese Fälle ansehen:
1. normales Monster
2. langes Effektmonster (z. B. Babyspieldrache der Harpyien)
3. sehr langer Text (z. B. Infernaler Flammenherrscher)
4. Permanent-/Konterkarte
5. Toon/Union/Flipp/Tuner, sobald im gewählten Deck vorhanden

## v0.15 – Kartenarchiv leeren

Neue Funktion **Kartenarchiv leeren**:

- löscht ausschließlich Dateien unter `cards/`
- `decks.json`, App und Servercode bleiben unangetastet
- zwei Sicherheitsabfragen im Browser
- serverseitig zusätzlich feste Bestätigungsphrase
- Löschung erfolgt als **ein GitHub-Commit**
- Render-Cache wird ebenfalls geleert
- danach prüft die Seite den Kartenstatus neu

Die Funktion benötigt denselben GitHub-Token mit `Contents: Read and write`,
der bereits für das Speichern gerenderter Karten verwendet wird.

## v0.16 – Zuverlässiger Renderer-Fix

Die problematischen optischen Fixes werden jetzt direkt an den gerenderten
Kartenobjekten gesetzt und hängen nicht mehr davon ab, ob ein Patch in
`node_modules` greift.

- Monstertyp-Zeile direkt auf **80 %**
- lange deutsche Effekte bekommen Satz-/Aufzählungsumbrüche
- Text wird gleichmäßig verkleinert statt horizontal in eine Mini-Zeile gequetscht
- Sicherheits-Hologramm wird explizit sichtbar gesetzt
- deutsche Attributgrafiken werden beim Build erzeugt und direkt verwendet
- sicherer englischer Fallback, falls ein deutsches Attributbild fehlt
- Serverstatus zeigt die konkrete Backend-Version
- Kartenarchiv-leeren-Funktion bleibt enthalten

Vor dem kompletten Leeren des Archivs:
1. oben muss `v0.16-reliable-render` stehen
2. ein Deck komplett neu rendern
3. lange Texte, Typzeile, Attribut und Hologramm kontrollieren
4. erst dann Kartenarchiv leeren
