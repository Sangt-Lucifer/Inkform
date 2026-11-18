# Neue Sprache hinzufügen

Eine Sprache besteht aus einer Sprachdatei im Kern (Oberfläche) und den Formulartexten des Studios (Begrüßung, Gesundheitsfragen, Einwilligungen, Datenschutz). Deutsch bleibt die Grundsprache. Angeboten wird eine Sprache Kunden erst, wenn alle Formulartexte in ihr vorliegen, keiner veraltet ist und der Inhaber sie ankreuzt.

Drei Wege:

- **In der App** (Verwaltung → Gerät → „Sprachen“): Der Inhaber wählt Sprache und auf Wunsch das Land für die Flagge und übersetzt die Texte direkt in der App. Jede Eingabe wird wie ein Paket geprüft (Platzhalter, Mehrzahlformen, Auszeichnung) und sofort auf dem Gerät gespeichert; die Sprache wandert mit den Studio-Einstellungen und der Gesamtsicherung. Pflicht sind nur die rund 250 Texte des Formulars, seiner Meldungen und des PDFs (`isFormKey` in `src/languages.js`); fehlende Texte der Verwaltung erscheinen auf Englisch. Kunden bekommen die Sprache erst, wenn alle Formulartexte da sind und die PDF-Schrift die Texte fürs PDF drucken kann. Geladene Pakete lassen sich dort genauso nachbessern. Außerdem gibt es dort eine **Übersetzungsdatei** (JSON, `kind: "inkform-uebersetzung"`): jeder Text mit Deutsch und Englisch als Vorlage und einem Feld `translation`, Formulartexte mit `form: true`. Außerhalb übersetzt und wieder hochgeladen, zeigt eine Vorschau Neues, Geändertes, Unverändertes und Abgelehntes mit Grund; erst „Übernehmen“ speichert. Leere Felder lassen vorhandene Übersetzungen stehen, so lassen sich Datei und Bearbeiten in der App mischen. Eine Datei für eine Sprache, die das Gerät noch nicht hat, legt sie an; ein Sprachpaket (`sprachen/<code>.json`) lässt sich bei einer geöffneten Sprache ebenso einspielen. Kein Eingriff in den Kern.
- **Eingebaut** (`src/sprachen/<code>.js`): Die Sprache ist in jeder Installation sofort da, auch auf der Installationsseite und im ersten PIN-Dialog als Auswahl. Macht die App größer und braucht ein Update der App.
- **Als Sprachpaket** (`sprachpakete/<code>.js`): gleiche Datei, gleiche Regeln, aber nicht eingebaut. Die App lädt das Paket von ihrer eigenen Seite, sobald ein Gerät in dieser Sprache „Automatisch“ wählt, und behält es offline. Ein neues Paket braucht kein App-Update. Für alle Sprachen außer Deutsch und Englisch ist das der vorgesehene Weg.

Die Schritte unten gelten für beide; für ein Paket die Datei unter `sprachpakete/` statt `src/sprachen/` anlegen.

## 1. Sprachdatei anlegen

`src/sprachen/en.js` nach `src/sprachen/<code>.js` kopieren. `<code>` ist ein Sprachcode wie `fr`, `tr` oder `pl`. Oben in der Datei:

- `name`: Name der Sprache in ihr selbst, z. B. `"Français"`. Vorlesehilfen und der Tooltip des Sprachknopfs im Kundenformular nennen ihn.
- Flagge: Deutsch und Englisch haben eigene SVG-Flaggen in `FLAGS` in `src/languages.js`. Jede andere Sprache zeigt die Landesflagge als Emoji: aus der Region im Code (`pt-BR`, `sr-Latn-RS`) oder aus `REGIONS` in derselben Datei. Sprachen ohne eindeutiges Land (z. B. Arabisch, Spanisch) zeigen ihr Kürzel als Text, außer der Code nennt eine Region (`es-MX`). Eine Flagge steht für ein Land, nicht für eine Sprache; im Zweifel beim Kürzel bleiben. Im Kundenformular stehen bis zu drei Sprachen als Knöpfe nebeneinander, ab vier als Liste mit Flagge und Name.
- `locale`: für Datum, Zahlen, Geld und Mehrzahl über `Intl`, z. B. `"fr-FR"`.
- `dir`: `"ltr"`, bei Arabisch, Hebräisch oder Persisch `"rtl"`.
- `pdfFont`: derzeit nur `"NotoSans"` (lateinische, griechische und kyrillische Schrift). Für andere Schriften muss zuerst eine passende Schrift mit Lizenz nach `public/vendor/` und in `scripts/fonts.mjs` (`PDF_FONT_NAMES`); das ist eine Änderung am Kern.

Dann alle Texte unter `texts` übersetzen:

- Schlüssel nicht ändern, keine weglassen oder hinzufügen.
- Platzhalter genau übernehmen: `{wert}` füllt die App, `%%name%%` der Build aus dem Profil.
- Mehrzahl als `{ one: "…", other: "…" }` mit den Formen, die `Intl.PluralRules` für die Sprache verlangt (Polnisch z. B. `one`, `few`, `many`, `other`). Die Zahl steht in `{anzahl}`.
- An Auszeichnung sind nur `<b>`, `<strong>` und `<code>` erlaubt.
- Typografische Anführungszeichen der Sprache verwenden.

## 2. Prüfen

```sh
npm run build
npm test
npm run check
npm run test:browser
```

Build und Tests nennen fehlende, überzählige oder ungenutzte Schlüssel, falsche Platzhalter und fehlende Mehrzahlformen mit Datei und Schlüssel. Die Browser-Prüfung „sprachen“ prüft mit einer langen Pseudosprache von rechts nach links, dass nichts breiter als der Bildschirm wird.

## 3. Formulartexte übersetzen

Zwei Wege, beide ergeben dasselbe:

- **In der App:** Auf „Formular & Texte“, „Gesundheitsfragen“, „Einwilligungen“ und „Datenschutz“ oben die Sprache umschalten und die Felder füllen. Unter jedem Feld steht der deutsche Text als Vorlage.
- **Im Profil:** In `profile.json` unter `translations.<code>` mit `app`, `studio`, `medical` und `legal` (Einträge nach `id`), mit denselben Platzhaltern `{{studio.…}}` wie im deutschen Text, ohne `<` und `>`. Dazu `"draft": true`, solange die Texte nicht juristisch geprüft sind, und `basedOn` mit den Profiltexten (`%%name%%`), von denen übersetzt wurde. Fehlt `basedOn`, nennt der Build die nötigen Profiltexte. Vorlage: `translations.en` in `profiles/beispiel/profile.json`.

Rechtstexte jeder Sprache vor dem Einsatz juristisch prüfen lassen und danach in der App neben der Sprache „Juristisch geprüft“ ankreuzen.

## 4. Anbieten

In der App unter „Studio & Kontakt“ → „Sprachen und Währung“ die Sprache ankreuzen, optional mit einem Hinweis fürs PDF (z. B. „Maßgeblich ist die deutsche Fassung“). Für neue Installationen geht das auch im Profil: `languages.customer` und `languages.note`.

Ändert der Inhaber später einen deutschen Text, wird die Übersetzung markiert und die Sprache nicht mehr angeboten, bis sie angepasst oder mit „Übersetzung passt“ bestätigt ist.

## 5. Ausliefern

Wie jede Kernänderung: committen, Studios neu bauen und prüfen, exportieren. Installierte Geräte übernehmen die neue Sprache mit dem nächsten Update; vorhandene Übersetzungen aus dem Profil ergänzt die App dort, wo die deutschen Texte noch die des Profils sind.
