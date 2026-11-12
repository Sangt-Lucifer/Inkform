# INKFORM

Lokale Tattoo-Einwilligung mit Unterschrift, PDF-Ablage und Einnahmenliste je Artist. Die App läuft vollständig auf dem Gerät und offline. Kundendaten verlassen das Gerät nie: keine Cloud, kein Tracking, keine Bibliotheken oder Schriften aus dem Netz.

Dieses Repository ist der **neutrale Kern**. Er enthält keine Daten eines echten Studios, weder im Code noch in der Git-Historie. Studios liegen außerhalb, standardmäßig in `../Inkform-Studios/<studio>/`, jedes mit eigenem lokalen Git-Repo. Ein neues Studio legt die Werkstatt an, siehe [NEUES-STUDIO.md](NEUES-STUDIO.md). Bedienung und Kundenablauf beschreibt die eingebettete Anleitung (`profiles/beispiel/Dokumente/Anleitung.md`).

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/` | App-Code für alle Studios: Formular, Admin mit PIN, Einnahmen, Aufbewahrung, PDF, Service Worker |
| `public/vendor/` | jsPDF 4.2.1, Tailwind CSS Browser 4.3.4, Schrift Noto Sans 2.015 (SIL OFL 1.1), jeweils mit Lizenz |
| `profiles/beispiel/` | „Blanko“: Beispielprofil mit einem erfundenen Musterstudio, Vorlage für neue Studios |
| `scripts/` | Build, Vorschau und Auslieferung (`serve.mjs`), lokales Zertifikat, Anleitung als PDF |
| `werkstatt/` | Lokale Oberfläche zum Anlegen, Bearbeiten, Prüfen, Exportieren und Ausliefern |
| `tests/` | Unit-, Profil-, Leak- und Werkstatt-Tests; `tests/browser/` Browser-Prüfungen |
| `docs/` | Frühere Pläne und Vorschläge (nicht der Ist-Stand) |
| `build/` | Erzeugte Blanko-App (nicht in Git) |

Ein Profil besteht aus `profile.json`, `logo.png`, `icons/`, `manifest.webmanifest`, `Anleitung-iPad-und-Admin.pdf` und `Dokumente/`. In `profile.json` stehen:

- `text`: alle studiospezifischen Texte für die Platzhalter `%%name%%` im Code. Der Build bricht ab bei fehlenden oder ungenutzten Texten und bei Zeichen, die aus JavaScript oder HTML ausbrechen könnten (`"`, `` ` ``, `\`, `<`, `>`, `${`, Zeilenumbruch). Alle Profile haben dieselben Texte.
- `markers`: die eigenen Kennzeichen des Studios (Name, Inhaber, Adresse, Domains …) als Text oder `{"regex": "…"}`. Die Leak-Tests lesen sie von dort; im Kern steht keine Liste echter Studios.
- `guide`: Kopfzeile, Datum und Autor der PDF-Anleitung.

## Bauen und prüfen

Node.js ab Version 22, keine Paketinstallation.

```sh
npm run build                                                 # Blanko nach build/beispiel/
node scripts/build.mjs --profile ../Inkform-Studios/<studio>  # nach <studio>/build/
npm run check                                                 # Syntax und Aktualität des Blanko-Builds
npm test                                                      # alle Tests, nacheinander (~35 s)
npm run test:browser                                          # Browser-Prüfungen mit Blanko
npm run preview                                               # Vorschau auf http://127.0.0.1:8080
npm run werkstatt                                             # Werkstatt auf http://127.0.0.1:8090
```

Je Profil entstehen `index.html` (Einzeldatei, ohne Server nutzbar) und `dist/` (Web-App mit Service Worker für den Offline-Betrieb). Ein Studio-Build landet nie im Kern. Der Build ersetzt nur einen vorhandenen Build und bricht ab, wenn der Zielordner andere Dateien enthält. Die Version des Service Workers hängt von allen Dateien ab, die er speichert; jede Änderung erreicht so auch installierte Geräte.

## Verhalten der App

- **PDF-Schrift:** Noto Sans ist eingebettet, Namen wie Gül Şahin oder Łukasz Ćwik funktionieren. Zeichen, die die Schrift nicht kann (Emojis, Arabisch, Devanagari …), meldet die App vor dem Erstellen.
- **Abschluss:** Die Einnahme wird erst gebucht, wenn der Inhaber die Ablage des PDFs bestätigt, genau einmal je Einwilligung. Bis dahin bleiben Metadaten (`inkform.pending.v1`) und PDF (IndexedDB `inkform-pending`) auf dem Gerät; danach werden sie gelöscht. Ist das PDF nicht mehr lesbar, lässt sich die Einnahme als „PDF fehlt“ buchen.
- **Export nach Zeitraum:** Beim Bestätigen der Ablage kommt das PDF zusätzlich in die IndexedDB `inkform-archive` (Schlüssel = Einnahmen-Eintrag). Die Admin-Seite „Export“ erstellt daraus für einen Monat, ein Jahr oder einen freien Zeitraum (Termindatum) eine unkomprimierte ZIP-Datei ohne Bibliothek: `Einwilligungen/JJJJ-MM-TT_Nachname_Vorname.pdf` und `Einnahmen/` mit Übersicht als PDF und CSV, mit Vorschau von Anzahl und Größe. Gespeichert wird über das Teilen-Menü. Wird ein Eintrag als gelöscht markiert, als „PDF fehlt“ gebucht, entfernt oder anonymisiert, löscht die App auch diese Kopie. Einwilligungen, die vor diesem Update abgelegt wurden, haben keine Kopie.
- **PIN-Sperre:** Nach 5 Fehlversuchen 30 Sekunden, gespeichert in `inkform.admin.lock.v1` und damit auch nach einem Neuladen wirksam. Eine zurückgestellte Uhr verlängert die Sperre nicht. Bekannte Grenze: Mit zwei gleichzeitig offenen Fenstern kann eine Sperre überschrieben werden oder bis zu 30 Sekunden länger dauern; auf dem iPad läuft die App in einem Fenster.
- **Aufbewahrung:** Zwei Fristen in Jahren (`inkform.retention.v1`). Die Löschliste zeigt fällige PDFs; Anonymisieren entfernt Name und Dateiname, Beträge bleiben. Anonymisiert wird nur, wenn das PDF als gelöscht markiert oder als „PDF fehlt“ gebucht ist, und es ist endgültig. Die Übersicht erinnert an offene Einwilligungen und an die letzte Sicherung (`inkform.backup.v1`).
- **Updates:** Eine neue Version übernimmt erst, wenn die App leer ist (kein Formular in Arbeit, keine offene Einwilligung, keine ungespeicherten Änderungen), und löscht dann die alte aus dem Offline-Speicher. Ältere Versionen kennen die Felder `pdfMissing`, `pdfDeletedAt` und `anonymizedAt` nicht: alle Geräte gemeinsam aktualisieren.
- **Schriftgrößen:** Im Kundenbereich mindestens 16 px für Eingaben und Fließtext, nichts unter 14 px.

## Leak-Tests

`npm test` findet Studios über `INKFORM_STUDIOS` (Ordner, getrennt durch `:`) oder in `../Inkform-Studios/`.

- **Über Kreuz:** Kein Build und kein Profilordner enthält Kennzeichen, Logo, Icons oder Anleitung eines anderen Profils, auch nicht als eingebettetes Base64.
- **Kern:** Arbeitsordner und die komplette Git-Datenbank (auch nicht mehr erreichbare Objekte, Refs, Reflogs) enthalten nichts von einem Studio.
- **Gegentests:** Eingeschleuste Kennzeichen und Dateien werden erkannt.

Durchsucht werden Text, Base64-Blöcke, PNG-Textfelder und der Text von PDFs. Die Browser-Prüfungen nutzen ein leeres Wegwerf-Profil von Chrome und nur erfundene Daten; Details in `tests/browser/README.md`.

## Werkstatt

`npm run werkstatt` startet eine Oberfläche nur auf `127.0.0.1`. Jede Anfrage braucht den richtigen Host und ein Sitzungs-Token, dazu gilt eine strenge CSP. Kundendaten liest oder speichert die Werkstatt nicht. Ihr Zustand liegt außerhalb der Repos unter `~/Library/Application Support/Inkform/` (`werkstatt/`, `zertifikate/`).

**Schutz:** Studios sind nur Anzeige, bis ihr Ordner in `werkstatt/freigegeben.json` steht (`{"studios": ["/pfad"]}`); neu angelegte Studios werden automatisch eingetragen. Blanko kann immer gebaut und geprüft, aber nicht bearbeitet werden. Vor jedem Schreiben prüft die Werkstatt, dass der Ordner genau so freigegeben ist, keine Verknüpfung ist und in Wirklichkeit kein geschütztes Studio. Die Studio-Kennung muss 3 bis 40 Zeichen aus `a–z`, `0–9` und `-` haben.

**Funktionen:**

- **Bauen und Prüfen:** Build, `npm test` und Browser-Prüfungen, mit kurzer Zusammenfassung und aufklappbarem Protokoll. Es läuft immer nur ein Lauf.
- **Neues Studio:** kopiert Blanko nach `../Inkform-Studios/<kennung>/`, legt `.gitignore` und ein Git-Repo ohne Remote an. Ein vorhandener Ordner wird nie angefasst.
- **Profil-Editor:** Texte, Kennzeichen (mit Probe im eigenen Build), Anleitung, Logo (quadratisches PNG; die Icons erzeugt `sips`) und die änderbaren Manifest-Felder. Gespeichert wird nur ohne Fehler, ganz oder gar nicht, und nur wenn sich die Dateien seit dem Laden nicht geändert haben.
- **Commit:** genau die angezeigten Dateien, lokal als `Sven <sven@inkform.invalid>`, ohne Hooks. Nicht committet werden Build-Ordner, Zertifikate, Schlüssel und Kundendaten-Exporte, ebenso wenig in Repos mit Git-Filtern.
- **Export:** nur bei sauber committetem Kern und Studio, grünen Tests für genau diese Commits und aktuellem Build. Das Paket (`index.html`, `dist/`, `PRUEFBERICHT.txt`, `SHA256SUMS`) entsteht unter `../Inkform-Exporte/<studio>/inkform-<studio>-<version>-<datum>/`, ist schreibgeschützt und wird nie überschrieben. Vorher läuft die Leak-Prüfung gegen alle anderen Profile. Geschrieben wird das Paket von `werkstatt/publish.py` (python3 der Command Line Tools), das keine Verknüpfungen verfolgt und exklusiv umbenennt.
- **Vor Ort:** liefert einen gültigen Export im WLAN unter `https://inkform-app.local:8443/` aus, nur solange er läuft. Er nutzt ein Zertifikat je Studio, dessen Schlüssel mit einem Passwort verschlüsselt ist, das nirgends gespeichert wird. Vorher prüft die Werkstatt Zertifikat, WLAN, freien Namen, keinen Rückschritt der Version und FileVault. Die Anzeige bietet Adresse mit QR-Code, `.webloc` und Zertifikat zum AirDrop sowie eine Checkliste. Nach 30 Minuten ohne Anfrage endet der Modus.

**Noch nicht geprüft:** ob ein echtes iPad `inkform-app.local` findet und das Zertifikat annimmt. Bis das mit Blanko an einem Test-iPad bestätigt ist, bleibt der Vor-Ort-Modus für Studios gesperrt.

## Bestehende Installation ohne Werkstatt

Für eine bereits installierte App liefert der Mac den Build im WLAN unter seinem eigenen Bonjour-Namen aus, solange der Befehl läuft:

```sh
node scripts/lokales-zertifikat.mjs                                  # einmalig
node scripts/serve.mjs --profile ../Inkform-Studios/<studio> --lan   # https://<mac>.local:8443/
```

Das Stammzertifikat gilt nur für den Namen dieses Macs; die Schlüssel liegen in `~/Library/Application Support/Inkform/zertifikat/`. Rechnername und Port nicht ändern: Das iPad speichert die App-Daten pro Adresse.

## Anleitung als PDF

`python3 scripts/anleitung.py <profil>` erzeugt das PDF aus `Dokumente/Anleitung.md`. Dafür sind ReportLab und Arial nötig; ReportLab ist derzeit nicht installiert. Ohne neues PDF bleibt der Leak-Test für ein neues Studio rot, weil es noch das PDF der Beispiel-Fassung enthält.

## Git und Daten

Git ist rein lokal, ohne Remotes; gesichert wird über Time Machine. `.gitignore` schließt App-Exporte sowie PDF-, CSV-, JSON-, Tabellen-, Foto- und ZIP-Dateien aus; erlaubt sind nur ausdrücklich freigegebene Projektdateien. Kundendaten gehören nie in diese Ordner.
