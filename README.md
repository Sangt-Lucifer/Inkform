# Inkform

Tattoo-Einwilligung mit Unterschrift, PDF-Ablage und Einnahmenliste für das iPad. Inkform läuft vollständig auf dem Gerät: keine Anmeldung, kein Server, keine Cloud, keine Bibliotheken oder Schriften aus dem Netz. Kundendaten verlassen das iPad nur, wenn du selbst eine Datei teilst oder sicherst.

Dieses Repository enthält den Quellcode der neutralen App, ohne Studio und ohne Daten. Die fertige App liegt im Zweig `gh-pages` und wird über GitHub Pages ausgeliefert, unter [https://sangt-lucifer.github.io/Inkform/](https://sangt-lucifer.github.io/Inkform/). Diese Adresse bleibt für immer dieselbe, denn die Daten auf dem iPad gehören zu ihr: Konto und Repository werden nicht umbenannt, und neben Inkform läuft in diesem Konto kein anderes Pages-Projekt (alle teilen sich `sangt-lucifer.github.io` und damit den Speicher).

Ein Studio entsteht nur auf dem iPad: über den Einrichtungsassistenten oder aus einer Gesamtsicherung bzw. Studio-Einstellungen-Datei. Im Repository liegen nie Studio- oder Kundendaten.

## Einrichten

1. Die Adresse der App ([https://sangt-lucifer.github.io/Inkform/](https://sangt-lucifer.github.io/Inkform/)) einmal in **Safari** öffnen, mit Internetverbindung. Es erscheint „INKFORM auf den Home-Bildschirm“.
2. **Symbol wählen:** deine Studio-Einstellungen-Datei, falls du schon eine hast, oder ein Bild. Hier nur die Studio-Einstellungen, nicht die Gesamtsicherung mit Kundendaten. Im Safari-Tab wird nichts gespeichert.
3. Teilen → **Zum Home-Bildschirm**. Den Namen unter dem Symbol kannst du dort ändern, zum Beispiel in den Studionamen. „Als Web-App öffnen“ aktiviert lassen, Hinzufügen.
4. Inkform über das neue Symbol starten, beim ersten Mal mit Internet. Safari-Tab und Home-Bildschirm-App haben **getrennte Speicher**; ab jetzt nur noch das Symbol benutzen.
5. Eine **PIN** festlegen: 6 bis 12 Ziffern. Sie steht in keiner Datei, es gibt keinen Online-Reset. Ändern lässt sie sich unter „iPad & Einstellungen“.
6. Einen der zwei Wege wählen:
   - **Neu einrichten:** Studio, Datenschutzkontakt, Anschrift und Ort der Unterschrift eintragen, optional Fristen, Logo und App-Symbol.
   - **Aus Datei übernehmen:** eine Gesamtsicherung (alles von einem anderen Gerät, auch Einnahmen und PDFs) oder Studio-Einstellungen (dieselbe Datei wie in Schritt 2, nur die Anpassungen; die Einnahmenliste bleibt leer).
   Vor dem Übernehmen zeigt die App, was in der Datei steckt. Eine falsche Datei ändert nichts.
7. Formulartexte, Gesundheitsfragen und Datenschutzhinweise prüfen und an das Studio anpassen. Sie sind neutral vorbereitet und vor dem Einsatz rechtlich zu prüfen. Woher die Vorlage kommt: [docs/QUELLEN.md](docs/QUELLEN.md).
8. Unter „iPad & Einstellungen“ die PDF-Ablage testen.

Zum Ausprobieren gibt es in der Übersicht „Beispieldaten laden“ (erfundene Einträge mit PDFs). „Beispieldaten entfernen“ löscht sie wieder vollständig.

## Offline nutzen

Nach dem ersten Start mit Internet läuft Inkform auch im Flugmodus. Zum Prüfen: Flugmodus an, App vom Home-Bildschirm öffnen, eine Test-Einwilligung ausfüllen.

## Daten und Sicherung

Alles liegt im Speicher dieser App auf diesem iPad: Einstellungen, PIN, Einnahmenliste und die unterschriebenen PDFs für den ZIP-Export. Die Daten gehören zur Adresse der App. Wechselt die Adresse oder wird die App vom Home-Bildschirm entfernt oder werden die Safari-Websitedaten gelöscht, sind sie weg.

- **Logo:** im Einrichtungsassistenten oder unter „Studio & Kontakt“ als PNG oder JPEG hochladen; die App verkleinert es selbst.
- **App-Symbol:** ebenda ein quadratisches Symbol für den Home-Bildschirm hochladen (Vorschau, heller oder dunkler Hintergrund). iPadOS übernimmt es nur beim Hinzufügen aus dem Safari-Tab (Schritt 2 oben). Ein späterer Wechsel braucht: Gesamtsicherung, App vom Home-Bildschirm entfernen, mit dem neuen Symbol neu hinzufügen, wiederherstellen.
- **Gesamtsicherung** (Sichern & Wiederherstellen): eine Datei mit Einstellungen, Logo, App-Symbol, Einnahmen, Fristen und PDFs. Sie enthält Gesundheitsangaben und Unterschriften; nur auf dem iPad („Auf meinem iPad“) oder einem eigenen Rechner ablegen, nicht in iCloud Drive. Die PIN ist nicht enthalten.
- **Studio-Einstellungen** (Sichern & Wiederherstellen, „Nur Studio-Einstellungen weitergeben“): eine Datei nur mit deinen Anpassungen (Studioangaben, Logo, App-Symbol, Texte, Fragen, Sprachen, Farbschema, Fristen), ohne Kundendaten. Damit richtest du ein zweites iPad ein oder gibst die Einrichtung weiter. Eingespielt wird sie über „Aus Datei wiederherstellen“; die App zeigt, was ersetzt wird, Einnahmen, PDFs und PIN bleiben unberührt.
- **Erinnerung:** Die Übersicht zeigt den Stand und erinnert, wenn die letzte Gesamtsicherung älter als der eingestellte Abstand ist.
- **Zurücksetzen:** unter „Aufbewahren & Löschen“ löscht „App auf diesem iPad zurücksetzen“ alle Daten dieser App, auch die PIN (vorher Gesamtsicherung erstellen).
- **Wiederherstellen:** prüft die Datei, fragt nach und ersetzt dann alle Daten außer der PIN. So zieht Inkform auch auf ein neues Gerät oder eine neue Adresse um.

## Exportieren

Unter „Export“ entsteht für einen Monat, ein Jahr oder einen freien Zeitraum eine ZIP-Datei mit den Einwilligungs-PDFs und der Einnahmenübersicht (PDF und CSV). Gespeichert wird über das Teilen-Menü („In Dateien sichern“). Die Übersicht erinnert an abgeschlossene Monate, die noch nicht exportiert wurden.

## PDF-Kopien in der App löschen

Damit der Speicher nicht dauerhaft wächst, lassen sich die PDF-Kopien in der App löschen, wenn ein Zeitraum als ZIP gesichert und geprüft ist: nach dem Export, nach Zeitraum oder einzeln. Vorher kommt ein Prüfschritt. Gelöscht werden nur die Kopien in der App, nie Dateien in der Dateien-App, auf einem Rechner oder auf USB-Sticks. Die Einträge in der Einnahmenliste bleiben vollständig.

## Updates

Eine neue Version erscheint unter derselben Adresse. Die App sucht einmal am Tag beim ersten Öffnen mit Internet danach, jederzeit über „Nach Update suchen“ unter „iPad & Einstellungen“, lädt sie und übernimmt sie erst, wenn nichts in Arbeit ist (kein Formular, keine offene Einwilligung); über den Knopf lädt sie sofort. Die Daten bleiben erhalten. Vor einem Update ist eine Gesamtsicherung sinnvoll. Alle Geräte möglichst gemeinsam aktualisieren.

## English

Inkform is a tattoo consent form with signature, PDF filing and an income list for the iPad. It runs entirely on the device and offline: no account, no server, no cloud.

**Set up**

1. Open the app's address (https://sangt-lucifer.github.io/Inkform/) once in **Safari**, with an internet connection, and wait for “Ready offline”.
2. Share → **Add to Home Screen**, keep “Open as Web App” on, then start Inkform from the new icon (it has its own storage, separate from the Safari tab).
3. Choose a **PIN** of 6 to 12 digits. There is no online reset; change it under “iPad & Settings”.
4. In the setup assistant, enter the studio, privacy contact, address and place of signature. Everything stays on the iPad and can be changed later under “Studio & Contact”.
5. Check the form texts, health questions and privacy notice and adapt them to the studio. They are neutral drafts and need a legal review before use.
6. Test PDF filing under “iPad & Settings”.

**Languages**

- The admin area follows the language chosen under “iPad & Settings” → “Language of this Device”. This applies to this iPad only and is not part of the backup.
- The customer form starts in the studio language. Under “Studio & Contact” → “Languages and Currency”, tick further **Languages for Customers**; a language selector then appears on the form.
- English form texts are included as a **draft, not legally reviewed**, also after updating an existing installation. They are not offered to customers until you tick English. Have them reviewed first, then tick “Legally reviewed” next to the language.
- To edit the English texts, use the “Deutsch | English” switch under “Texts” (Welcome & Signature, Health Questions, Consent Texts, Privacy). The German text is shown below each field as a reference.
- If you change a German text, its English version is kept but marked, and English is not offered until you have checked it: the admin area shows “English: check 2 texts”, jumps to each one and shows the old and the new German text. Edit the English text or tap “Translation fits”. A new health question or declaration needs its English text before English is offered again.
- Switching the language keeps the customer's details and health answers; declarations, photo choice and signature start again. The PDF is created in the customer's language.

**Data and backup**

Everything is stored in this app on this iPad and belongs to the app's address. Make a **full backup** regularly (Back Up & Restore) and keep it on the iPad (“On My iPad”) or your own computer, not in iCloud Drive: it contains health information and signatures. Restoring replaces all data except the PIN. Under “Export”, ZIP files with the consent PDFs and the income overview are created per month, year or period.

## Für Entwickler

Node.js ab Version 22, keine Paketinstallation, keine Abhängigkeiten aus dem Netz.

```sh
npm run build          # Beispiel und Blanko nach build/<profil>/
npm run check          # Syntax, Sprachdateien, Aktualität der Builds
npm test               # Unit-, Profil- und Leak-Tests
npm run test:browser   # Browser-Prüfungen mit Chrome headless (Beispiel, dann Blanko)
npm run pages          # geprüften Blanko-Build als Commit in den lokalen Zweig gh-pages schreiben
```

`npm run pages` (`scripts/pages-bauen.mjs`) arbeitet nur mit einem vollständig committeten Stand, baut die Blanko-App, prüft sie (`scripts/blanko-pruefen.mjs`) und führt die Leak-Tests aus. Erst wenn beides grün ist, schreibt es genau diese Dateien mit `.nojekyll` über ein temporäres `git worktree` in `gh-pages`; `main` bleibt unberührt. Der Commit-Text nennt die Kern-Version (`Inkform blanko <version> (Kern <hash>)`). Das Skript legt kein Remote an und pusht nie. Ohne Studio-Profile auf dem Rechner bricht es ab; nur mit den neutralen Prüfungen: `node scripts/pages-bauen.mjs --ohne-studios`. In einem Klon ohne Studio-Profile laufen die Leak-Tests mit `INKFORM_NUR_NEUTRAL=1 npm test`.

| Ordner | Inhalt |
|---|---|
| `src/` | App: Formular, Verwaltung mit PIN, Einnahmen, Aufbewahrung, PDF, Sicherung, Service Worker |
| `src/sprachen/` | Texte der Oberfläche, eine Datei je Sprache, siehe [NEUE-SPRACHE.md](NEUE-SPRACHE.md) |
| `public/vendor/` | jsPDF, Tailwind CSS Browser, Noto Sans, jeweils mit Lizenz |
| `profiles/blanko/` | die neutrale App, die GitHub Pages ausliefert |
| `profiles/beispiel/` | erfundenes Musterstudio für Tests und die Beispiel-Anleitung |
| `scripts/` | Build, Prüfung, `gh-pages`, lokale Vorschau, lokales Zertifikat |
| `tests/` | Unit-, Migrations-, Profil- und Leak-Tests, `tests/browser/` Browser-Prüfungen, `tests/fixtures/` Dateien älterer Formate |

Aufbau, Verhalten der App, Migration der Einstellungen und Prüfungen im Detail: [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md).

## Lizenz

[MIT mit Commons Clause](LICENSE): Nutzen, verändern und kostenlos weitergeben darf jeder, privat wie im Unternehmen, also auch ein Studio für seine Einwilligungen. Nicht erlaubt ist, Inkform zu verkaufen: gegen Geld oder eine andere Gegenleistung ein Produkt oder einen Dienst anzubieten, dessen Wert ganz oder wesentlich aus Inkform kommt, etwa die App selbst oder ihr Hosting. Bezahlte Einrichtung oder bezahlter Support fallen darunter, wenn ihr Wert im Wesentlichen aus Inkform kommt. Wer Inkform weitergibt, gibt die Lizenz mit; die App liefert sie als `licenses/Inkform.txt` mit. Fremde Teile in `public/vendor/` behalten ihre eigenen Lizenzen (jsPDF und Tailwind MIT, Noto Sans SIL OFL 1.1).
