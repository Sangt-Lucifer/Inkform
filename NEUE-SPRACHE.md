# Neue Sprache hinzufügen

Eine Sprache besteht aus einer Sprachdatei im Kern (Oberfläche) und den Formulartexten des Studios (Begrüßung, Gesundheitsfragen, Einwilligungen, Datenschutz). Deutsch bleibt die Grundsprache. Angeboten wird eine Sprache Kunden erst, wenn alle Formulartexte in ihr vorliegen, keiner veraltet ist und der Inhaber sie ankreuzt.

## 1. Sprachdatei anlegen

`src/sprachen/en.js` nach `src/sprachen/<code>.js` kopieren. `<code>` ist ein Sprachcode wie `fr`, `tr` oder `pl`. Oben in der Datei:

- `name`: Name der Sprache in ihr selbst, z. B. `"Français"`. So erscheint sie in der Sprachauswahl, ohne Flagge.
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
