# Browser-Prüfungen

`npm run test:browser` baut das gewählte Profil, startet die Vorschau auf `127.0.0.1` und Google Chrome headless mit einem leeren, temporären Profil (wird danach gelöscht) und führt die Prüfungen über das DevTools-Protokoll aus. Keine Paket-Abhängigkeiten; ein anderer Chrome-Pfad lässt sich über `CHROME_PATH` angeben. Einzelne Prüfungen: `npm run test:browser -- offline update`.

| Datei | Prüft |
|---|---|
| `formular.mjs` | Einzeldatei offline, Profiltexte, Logo, keine externen Anfragen, Validierung, Preise, PDF, HTML-Export ohne Kundendaten, Layout 320/390/768 px, Offline-Neustart der Web-App |
| `pin-einnahmen.mjs` | PIN-Ersteinrichtung, falsche PIN, „Vielen Dank“-Sperre, Buchung erst nach Bestätigung, Speicherfehler, Einnahmen, Filter, CSV/PDF/JSON, Import, HTML-Export ohne PIN-Hash und Namen |
| `offline.mjs` | Offline-Speicher der Web-App, eingebettete Anleitung, Neustart ohne Netz, PIN und Einnahmen offline |
| `abschluss.mjs` | Validierung, Unicode-Namen im PDF, Buchung genau einmal, Neuladen auf „Vielen Dank“, „PDF fehlt“, nicht darstellbare Zeichen, PIN-Sperre über Neuladen; alles im Flugmodus |
| `aufbewahrung.mjs` | Erinnerung an offene Einwilligung, Sicherheits-Checkliste, Fristen, Löschliste, Anonymisieren, Sicherungsdatum |
| `sicherung.mjs` | Erinnerung ohne Sicherung und nach dem Abstand, Hinweis auf nicht exportierte Monate, Inhalt der Gesamtsicherung ohne PIN, Abbrechen und beschädigte Dateien ändern nichts, Wiederherstellen ersetzt alles außer der PIN; im Flugmodus |
| `export.mjs` | PDF-Kopie für den Export beim Bestätigen, Entfernen bei „PDF fehlt“ und gelöschtem Eintrag, Vorschau, leerer Zeitraum, Monat/Jahr/von–bis, Filter, ZIP mit `unzip`, `ditto` und Python geprüft; im Flugmodus |
| `schriftgroessen.mjs` | Kundenbereich auf vier iPad-Größen: Eingaben und Fließtext ≥ 16 px, nichts < 14 px, kein seitliches Scrollen; mit `INKFORM_FONT_BASELINE=<datei>` zusätzlich keine Schrift kleiner als vorher |
| `update.mjs` | App-Update: wartet bei angefangenem Formular, übernimmt im Leerlauf ohne Neuladen und löscht die alte Version aus dem Offline-Speicher |
| `werkstatt.mjs` | Werkstatt mit Wegwerf-Studios: Schutz (keine Knöpfe), Bauen, neues Studio, Editor (Fehler, Probe, Sperre beim Speichern), Commit, Export-Dialog, Vor-Ort-Fenster mit QR-Code, keine CSP-Fehler. Läuft nur mit Blanko. |
| `lib.mjs` | gemeinsamer DevTools-Client |

Pfade, Ports und Ausgabeordner kommen aus Umgebungsvariablen (`INKFORM_*`, gesetzt von `run.mjs`). Alle Kundendaten sind erfunden (`LOKALTEST`, `QA-SENTINEL-4892`, `LEDGER-TEST PERSON` …). Ausgaben landen in `test-results/` des jeweiligen Profils.

Bekannte Grenze: Die Screenshots `inkform-light.png` und `inkform-admin-dark.png` aus `formular.mjs` zeigen den PIN-Dialog der Ersteinrichtung.

Nicht prüfbar ohne echtes iPad: Safari auf iPadOS, Home-Bildschirm-Installation, Apple Pencil, „In Dateien sichern“, die Dateien-App und die Speicherverwaltung von iPadOS.
