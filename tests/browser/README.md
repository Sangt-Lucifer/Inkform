# Browser-Prüfungen

`npm run test:browser` baut das gewählte Profil, startet die Vorschau auf `127.0.0.1` und Google Chrome headless mit einem leeren, temporären Profil (wird danach gelöscht) und führt die Prüfungen über das DevTools-Protokoll aus. Es gibt keine Paket-Abhängigkeiten. Ein anderer Chrome-Pfad lässt sich über `CHROME_PATH` angeben.

| Datei | Herkunft im Website-Archiv | Prüft |
|---|---|---|
| `formular.mjs` | `Pruefungen-Inkform-Preise-2026-11-06/Browserpruefung.mjs` | Einzeldatei offline, Profiltexte, Logo, keine externen Anfragen, Validierung, Preise, PDF, HTML-Export ohne Kundendaten, Layout 320/390/768 px, Web-App-Offline-Neustart |
| `pin-einnahmen.mjs` | `Pruefungen-Inkform-Einnahmen-PIN-2026-11-06/Browser-Gesamtpruefung.mjs` | PIN-Ersteinrichtung, falsche PIN, Vielen-Dank-Sperre, ausstehendes Original-PDF, Speicherfehler, Einnahmen, Filter, CSV/PDF/JSON, Import, HTML-Export ohne PIN-Hash und Namen |
| `offline.mjs` | `Pruefungen-Inkform-Einnahmen-PIN-2026-11-06/Browser-Offlinepruefung.mjs` | Offline-Cache der Web-App, eingebettete Anleitung, Neustart ohne Netz, PIN und Einnahmen offline |
| `../income-independent.test.mjs` | `Pruefungen-Inkform-Einnahmen-PIN-2026-11-06/Unabhaengige-Einnahmenpruefung.mjs` | Grenzfälle des Einnahmenmoduls (läuft mit `npm test`) |

Die Skripte `Pruefungen-Inkform-2026-11-06/Browserpruefung.mjs` und `Pruefungen-Inkform-Rechtstexte-2026-11-06/Browserpruefung.mjs` wurden nicht einzeln übernommen. Ihre Prüfungen sind vollständig in `formular.mjs` enthalten, abgesehen von einer veralteten Prüfung auf leere Datenschutzfelder.

Anpassungen gegenüber dem Archiv: Pfade, Ports und Ausgabeordner kommen aus Umgebungsvariablen (`INKFORM_*`, gesetzt von `run.mjs`). Studiotexte werden aus `profiles/<profil>/profile.json` gelesen statt fest eingetragen. Der Artist-Testname ist `Alex`. Alle Kundendaten sind erfunden (`LOKALTEST`, `QA-SENTINEL-4892`, `LEDGER-TEST PERSON`, `Import-Test`, `OLD-LEDGER`).

Bekannte Grenze: `formular.mjs` stammt aus der Zeit vor dem PIN-Schutz. Die Prüfungen selbst laufen, die Screenshots `inkform-light.png` und `inkform-admin-dark.png` zeigen aber den PIN-Dialog der Ersteinrichtung.

Nicht prüfbar ohne echtes iPad: Safari auf iPadOS, Home-Bildschirm-Installation, Apple Pencil, Teilen-Dialog „In Dateien sichern“, Verhalten der Dateien-App und Speicherverwaltung von iPadOS.
