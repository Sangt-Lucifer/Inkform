# Inkform

Tattoo-Einwilligung mit Unterschrift, PDF-Ablage und Einnahmenliste für das iPad. Inkform läuft vollständig auf dem Gerät: keine Anmeldung, kein Server, keine Cloud, keine Bibliotheken oder Schriften aus dem Netz. Kundendaten verlassen das iPad nur, wenn du selbst eine Datei teilst oder sicherst.

Dieses Repository enthält nur die fertige, neutrale App (ohne Studio und ohne Daten). Sie besteht aus statischen Dateien und funktioniert an jeder HTTPS-Adresse, auch unter einem Unterpfad.

## Einrichten

1. Die Adresse der App einmal in **Safari** öffnen, mit Internetverbindung.
2. Warten, bis unten „Offline bereit“ steht.
3. Teilen → **Zum Home-Bildschirm**, „Als Web-App öffnen“ aktiviert lassen, Hinzufügen.
4. Inkform über das neue Symbol starten (nicht mehr über den Safari-Tab: das Symbol hat einen eigenen Speicher).
5. Eine **PIN** festlegen: 6 bis 12 Ziffern. Es gibt keinen Online-Reset.
6. Im **Einrichtungsassistenten** Studio, Datenschutzkontakt, Anschrift und Ort der Unterschrift eintragen, optional die Aufbewahrungsfristen. Alles bleibt auf dem iPad und ist später unter „Studio & Kontakt“ änderbar.
7. Formulartexte, Gesundheitsfragen und Datenschutzhinweise prüfen und an das Studio anpassen. Sie sind neutral vorbereitet und vor dem Einsatz rechtlich zu prüfen.
8. Unter „iPad & Dateien“ die PDF-Ablage testen.

Zum Ausprobieren gibt es in der Übersicht „Beispieldaten laden“ (erfundene Einträge mit PDFs). „Beispieldaten entfernen“ löscht sie wieder vollständig.

## Offline nutzen

Nach dem ersten Start mit Internet läuft Inkform auch im Flugmodus. Zum Prüfen: Flugmodus an, App vom Home-Bildschirm öffnen, eine Test-Einwilligung ausfüllen.

## Daten und Sicherung

Alles liegt im Speicher dieser App auf diesem iPad: Einstellungen, PIN, Einnahmenliste und die unterschriebenen PDFs für den ZIP-Export. Die Daten gehören zur Adresse der App. Wechselt die Adresse oder wird die App vom Home-Bildschirm entfernt oder werden die Safari-Websitedaten gelöscht, sind sie weg.

- **Gesamtsicherung** (Übersicht): eine Datei mit Einstellungen, Einnahmen, Fristen und PDFs. Sie enthält Gesundheitsangaben und Unterschriften; nur auf dem iPad („Auf meinem iPad“) oder einem eigenen Rechner ablegen, nicht in iCloud Drive. Die PIN ist nicht enthalten.
- **Erinnerung:** Die Übersicht erinnert, wenn die letzte Gesamtsicherung älter als der eingestellte Abstand ist.
- **Wiederherstellen:** prüft die Datei, fragt nach und ersetzt dann alle Daten außer der PIN. So zieht Inkform auch auf ein neues Gerät oder eine neue Adresse um.

## Exportieren

Unter „Export“ entsteht für einen Monat, ein Jahr oder einen freien Zeitraum eine ZIP-Datei mit den Einwilligungs-PDFs und der Einnahmenübersicht (PDF und CSV). Gespeichert wird über das Teilen-Menü („In Dateien sichern“). Die Übersicht erinnert an abgeschlossene Monate, die noch nicht exportiert wurden.

## PDF-Kopien in der App löschen

Damit der Speicher nicht dauerhaft wächst, lassen sich die PDF-Kopien in der App löschen, wenn ein Zeitraum als ZIP gesichert und geprüft ist: nach dem Export, nach Zeitraum oder einzeln. Vorher kommt ein Prüfschritt. Gelöscht werden nur die Kopien in der App, nie Dateien in der Dateien-App, auf einem Rechner oder auf USB-Sticks. Die Einträge in der Einnahmenliste bleiben vollständig.

## Updates

Eine neue Version erscheint unter derselben Adresse. Die App lädt sie, wenn sie mit Internet geöffnet ist, und übernimmt sie erst, wenn nichts in Arbeit ist (kein Formular, keine offene Einwilligung). Die Daten bleiben erhalten. Vor einem Update ist eine Gesamtsicherung sinnvoll. Alle Geräte möglichst gemeinsam aktualisieren.

## English

Inkform is a tattoo consent form with signature, PDF filing and an income list for the iPad. It runs entirely on the device and offline: no account, no server, no cloud.

**Set up**

1. Open the app's address once in **Safari**, with an internet connection, and wait for “Ready offline”.
2. Share → **Add to Home Screen**, keep “Open as Web App” on, then start Inkform from the new icon (it has its own storage, separate from the Safari tab).
3. Choose a **PIN** of 6 to 12 digits. There is no online reset.
4. In the setup assistant, enter the studio, privacy contact, address and place of signature. Everything stays on the iPad and can be changed later under “Studio & Contact”.
5. Check the form texts, health questions and privacy notice and adapt them to the studio. They are neutral drafts and need a legal review before use.
6. Test PDF filing under “iPad & Files”.

**Languages**

- The admin area follows the language chosen under “Appearance & Backup” → “Language of this Device”. This applies to this iPad only and is not part of the backup.
- The customer form starts in the studio language. Under “Studio & Contact” → “Languages and Currency”, tick further **Languages for Customers**; a language selector then appears on the form.
- English form texts are included as a **draft, not legally reviewed**, also after updating an existing installation. They are not offered to customers until you tick English. Have them reviewed first, then tick “Legally reviewed” next to the language.
- To edit the English texts, use the “Deutsch | English” switch on the text pages (Form & Texts, Health Questions, Consent, Privacy). The German text is shown below each field as a reference.
- If you change a German text, its English version is kept but marked, and English is not offered until you have checked it: the admin area shows “English: check 2 texts”, jumps to each one and shows the old and the new German text. Edit the English text or tap “Translation fits”. A new health question or declaration needs its English text before English is offered again.
- Switching the language keeps the customer's details and health answers; declarations, photo choice and signature start again. The PDF is created in the customer's language.

**Data and backup**

Everything is stored in this app on this iPad and belongs to the app's address. Make a **full backup** regularly (Overview) and keep it on the iPad (“On My iPad”) or your own computer, not in iCloud Drive: it contains health information and signatures. Restoring replaces all data except the PIN. Under “Export”, ZIP files with the consent PDFs and the income overview are created per month, year or period.

## Inhalt

| Datei | Inhalt |
|---|---|
| `index.html` | die App (alle Skripte, Stile, Schriften und Bilder eingebettet) |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `manifest.webmanifest`, `icons/` | Home-Bildschirm-Symbol |
| `licenses/` | Lizenzen von jsPDF, Tailwind CSS und Noto Sans |
