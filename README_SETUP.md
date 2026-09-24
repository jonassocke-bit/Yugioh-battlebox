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

## v0.17 – Abkürzungen + Monstertyp

- Monstertyp-Zeile von 80 % auf **85 %** angehoben
- automatische Satzumbrüche ignorieren jetzt typische Abkürzungen, u. a.:
  `max.`, `min.`, `mind.`, `bzw.`, `usw.`, `ca.`, `ggf.`, `Nr.`, `St.`,
  `z. B.`, `d. h.` und `u. a.`
- dadurch kein falscher Umbruch mehr bei Texten wie `max. 3`

## v0.18 – A4 + randloser PDF-Export

Neu im PDF-Export:
- zusätzliches Layout **A4 · 9/Bogen**
- neue Exportoption **Kartenrand**
  - **Mit äußerem grauen Rand**
  - **Ohne äußeren grauen Rand**

Bei der randlosen Variante wird beim PDF-Export nur der äußere bläulich-graue
Sicherheits-/Glowe-Rand der Render-PNG abgeschnitten. Der eigentliche
Yu-Gi-Oh!-Kartenrahmen bleibt erhalten.

Wichtig:
- das betrifft **nur den PDF-Export**
- die gespeicherten PNGs in `cards/` bleiben unverändert


## v0.19 – Kartenbilder selbst randlos

Wichtige Änderung:
- der **Renderer selbst** schneidet jetzt den äußeren bläulich-grauen Render-Rand ab
- dadurch sind die gespeicherten PNGs unter `cards/` bereits randlos
- Vorschau, Vollbildansicht **und** PDF nutzen damit dieselben randlosen Kartenbilder

Hinweis:
- bereits vorhandene Karten im `cards/`-Ordner bleiben so, wie sie gerendert wurden
- damit alle Karten wirklich randlos sind, müssen die betroffenen Karten **neu gerendert** werden
- am saubersten: erst mit einem Deck testen, danach bei Bedarf **Kartenarchiv leeren** und neu aufbauen

Die frühere PDF-Option wurde deshalb sprachlich angepasst:
- **Wie Kartenbild** = keine zusätzliche Beschneidung
- **Zusätzlich enger beschneiden** = beschneidet die PDF noch etwas stärker

## v0.20 – Dynamischer Overlay-Export

Die Druckbögen reagieren jetzt dynamisch auf zwei neue Layout-Parameter:

- **Overlay-Beschnitt (0,0–2,5 mm)**  
  Schneidet das bereits vorhandene Karten-PNG für den PDF-Export innen zu.
  Es wird **nicht neu gerendert**.

- **Abstand zwischen Karten (mm)**  
  Fügt frei wählbaren Weißraum zwischen den Karten ein.

Wichtig:
- Die bestehenden PNGs in `cards/` bleiben unverändert.
- Der PDF-Export berechnet daraus dynamisch:
  - die physische Kartengröße auf dem Bogen
  - wie viele Karten auf die Seite passen
  - die Positionen mit einem festen Mindestrand
- Auf jeder PDF-Seite steht oben:
  - **Deckname**
  - **Seite X / Y**
  - sowie klein Format, Beschnitt und Abstand

Formate:
- **A3**
- **A4**
- **SRA3**

Empfehlung für dein Overlay-Ziel:
- Beschnitt zunächst mit **2,0 mm**
- Abstand z. B. **0,8–1,2 mm**


## v0.21 – PDF-DPI + Seiteninfo

Neu:
- **PDF-DPI** frei einstellbar (72–450), ohne Neurendern
- Das bestehende Karten-PNG wird beim PDF-Export nur **neu skaliert**
- Live-Anzeige in der Oberfläche:
  - **Karten pro Seite**
  - **Spalten × Reihen**
  - **PDF-Seitenanzahl**

Wichtig:
- 450 dpi bleibt die Obergrenze, weil das Kartenarchiv in dieser Qualität vorliegt
- z. B. 300 dpi spart Dateigröße und Rechenzeit beim PDF-Export


## v0.22 – Vollständige Kartenrender wiederhergestellt

Fix:
- neue Karten werden wieder als **vollständige Karten-PNGs** gerendert
- der äußere graue / dunkle Kartenrand bleibt vollständig erhalten
- nur der **PDF-Export** darf weiterhin per Overlay-Beschnitt zuschneiden

Wichtig:
- bereits fehlerhaft gerenderte Karten im `cards/`-Ordner bleiben fehlerhaft
- diese Karten müssen **neu gerendert** werden
- wenn du ganz sicher gehen willst, kannst du das Archiv leeren und die betroffenen Decks neu rendern
