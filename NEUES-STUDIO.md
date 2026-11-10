# Neues Studio anlegen

Kurzanleitung für ein weiteres Studio. Der Kern (`Inkform/`) bleibt dabei unverändert. Alle Studiodaten liegen nur im Studio-Ordner.

## 1. Beispiel kopieren

```sh
cd "<Projekte>"
cp -R Inkform/profiles/beispiel Inkform-Studios/<studio>
```

`<studio>` ist ein kurzer Name aus Kleinbuchstaben, Ziffern und Bindestrich, zum Beispiel `atelier-nord`.

## 2. Eigenes Git-Repo für das Studio

```sh
cd Inkform-Studios/<studio>
git init -b main
git config user.name "Sven"
git config user.email "sven@inkform.invalid"
```

Eine `.gitignore` anlegen. Vorlage: die `.gitignore` des Kerns. Zusätzlich müssen `build/` und `test-results/` ausgeschlossen werden. Kein Remote einrichten.

## 3. Felder anpassen

In `profile.json`:

- `id`: genau der Ordnername `<studio>`.
- `name`, `description`.
- `markers`: **alle** Kennzeichen des Studios: Studioname in allen Schreibweisen, Inhaber, Straße, PLZ und Ort, E-Mail, Website, Social-Media-Namen. Damit wird geprüft, dass nichts davon in den Kern oder in andere Studios gerät. Allgemeine Wörter wie `gmail` oder eine Stadt, die auch ein anderes Studio nutzt, nur aufnehmen, wenn sie wirklich eindeutig sind.
- `text`: alle Texte ersetzen. Kein Text darf auf das Musterstudio verweisen (`Musterstudio`, `Max Mustermann`, `musterstudio.example`). Die Leak-Tests prüfen das. Aufbewahrung, Zugriff und Aufsichtsbehörde müssen dem echten Ablauf entsprechen und rechtlich geprüft sein.
- `guide`: Kopfzeile, Datum, Autor der Anleitung.

Außerdem ersetzen: `logo.png`, `icons/icon-192.png` und `icon-512.png`, `manifest.webmanifest` (Name, Farben, `display` bleibt `standalone`), `README.md` und `Dokumente/`. Die Anleitung anpassen und neu erzeugen mit `python3 scripts/anleitung.py ../Inkform-Studios/<studio>`, das braucht ReportLab.

## 4. Bauen und prüfen

Im Kern:

```sh
cd Inkform
node scripts/build.mjs --profile ../Inkform-Studios/<studio>
npm test
npm run test:browser -- --profile ../Inkform-Studios/<studio>
```

`npm test` muss grün sein. Besonders wichtig sind die Leak-Tests: Der neue Build darf nichts aus anderen Studios oder dem Musterstudio enthalten, und der Kern nichts aus dem neuen Studio.

## 5. Ausliefern

Ausgeliefert wird **nur** `Inkform-Studios/<studio>/build/`:

- `dist/` für die Installation auf dem iPad (Home-Bildschirm, offline),
- `index.html` als Einzeldatei.

Nie ausliefern: andere Studio-Ordner, `test-results/`, Exporte oder Sicherungen. Soll das Studio auch den Quelltext bekommen, dann nur den Kern `Inkform/` (enthält kein echtes Studio) plus seinen eigenen Studio-Ordner, ohne `build/` und `test-results/` anderer Studios.

## 6. Committen

Im Studio-Ordner `git add -A` und `git commit`. Vorher mit `git status` prüfen, dass keine Exporte, PDFs von Kunden oder Sicherungen dabei sind.
