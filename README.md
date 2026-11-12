# INKFORM

Lokale Tattoo-Einwilligung mit Unterschrift, PDF-Ablage und Einnahmenliste je Artist. Die App läuft vollständig auf dem Gerät und offline. Kundendaten verlassen das Gerät nie: keine Cloud, kein Tracking, keine Bibliotheken oder Schriften aus dem Netz.

Dieses Repository ist der **neutrale Kern**. Er enthält keine Daten eines echten Studios, weder im Code noch in der Git-Historie. Studios liegen außerhalb, standardmäßig in `../Inkform-Studios/<studio>/`, jedes mit eigenem lokalen Git-Repo. Ein neues Studio legt die Werkstatt an, siehe [NEUES-STUDIO.md](NEUES-STUDIO.md). Bedienung und Kundenablauf beschreibt die eingebettete Anleitung (`profiles/beispiel/Dokumente/Anleitung.md`).

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/` | App-Code für alle Studios: Formular, Admin mit PIN, Einnahmen, Aufbewahrung, PDF, Service Worker |
| `public/vendor/` | jsPDF 4.2.1, Tailwind CSS Browser 4.3.4, Schrift Noto Sans 2.015 (SIL OFL 1.1), jeweils mit Lizenz |
| `profiles/beispiel/` | „Beispiel“: Profil mit einem erfundenen Musterstudio, Vorlage für neue Studios |
| `profiles/blanko/` | „Blanko“: neutrale Fassung ohne Studio, ohne Daten und ohne Anleitung; Einrichtung beim ersten Start auf dem Gerät |
| `scripts/` | Build, Vorschau und Auslieferung (`serve.mjs`), lokales Zertifikat, Anleitung als PDF |
| `werkstatt/` | Lokale Oberfläche zum Anlegen, Bearbeiten, Prüfen, Exportieren und Ausliefern |
| `tests/` | Unit-, Profil-, Leak- und Werkstatt-Tests; `tests/browser/` Browser-Prüfungen |
| `docs/` | Frühere Pläne und Vorschläge (nicht der Ist-Stand) |
| `build/` | Erzeugte Apps der eingebauten Profile (nicht in Git) |

Ein Profil besteht aus `profile.json`, `logo.png`, `icons/`, `manifest.webmanifest`, `Anleitung-iPad-und-Admin.pdf` und `Dokumente/`. In `profile.json` stehen:

- `text`: alle studiospezifischen Texte für die Platzhalter `%%name%%` im Code. Der Build bricht ab bei fehlenden oder ungenutzten Texten und bei Zeichen, die aus JavaScript oder HTML ausbrechen könnten (`"`, `` ` ``, `\`, `<`, `>`, `${`, Zeilenumbruch). Alle Profile haben dieselben Texte.
- `markers`: die eigenen Kennzeichen des Studios (Name, Inhaber, Adresse, Domains …) als Text oder `{"regex": "…"}`. Die Leak-Tests lesen sie von dort; im Kern steht keine Liste echter Studios.
- `guide`: Kopfzeile, Datum und Autor der PDF-Anleitung.

## Bauen und prüfen

Node.js ab Version 22, keine Paketinstallation.

```sh
npm run build                                                 # Beispiel und Blanko nach build/<profil>/
node scripts/build.mjs --profile ../Inkform-Studios/<studio>  # nach <studio>/build/
npm run check                                                 # Syntax und Aktualität der eingebauten Builds
node scripts/blanko-pruefen.mjs                               # Blanko-Build auf Privates prüfen
npm test                                                      # alle Tests, nacheinander (~35 s)
npm run test:browser                                          # Browser-Prüfungen mit Beispiel, dann Blanko
npm run preview                                               # Vorschau auf http://127.0.0.1:8080
npm run werkstatt                                             # Werkstatt auf http://127.0.0.1:8090
```

Je Profil entstehen `index.html` (Einzeldatei, ohne Server nutzbar) und `dist/` (Web-App mit Service Worker für den Offline-Betrieb). Ein Studio-Build landet nie im Kern. Der Build ersetzt nur einen vorhandenen Build und bricht ab, wenn der Zielordner andere Dateien enthält. Die Version des Service Workers hängt von allen Dateien ab, die er speichert; jede Änderung erreicht so auch installierte Geräte.

## Verhalten der App

- **PDF-Schrift:** Noto Sans ist eingebettet, Namen wie Gül Şahin oder Łukasz Ćwik funktionieren. Zeichen, die die Schrift nicht kann (Emojis, Arabisch, Devanagari …), meldet die App vor dem Erstellen.
- **Abschluss:** Die Einnahme wird erst gebucht, wenn der Inhaber die Ablage des PDFs bestätigt, genau einmal je Einwilligung. Bis dahin bleiben Metadaten (`inkform.pending.v1`) und PDF (IndexedDB `inkform-pending`) auf dem Gerät; danach werden sie gelöscht. Ist das PDF nicht mehr lesbar, lässt sich die Einnahme als „PDF fehlt“ buchen.
- **Export nach Zeitraum:** Beim Bestätigen der Ablage kommt das PDF zusätzlich in die IndexedDB `inkform-archive` (Schlüssel = Einnahmen-Eintrag). Die Admin-Seite „Export“ erstellt daraus für einen Monat, ein Jahr oder einen freien Zeitraum (Termindatum) eine unkomprimierte ZIP-Datei ohne Bibliothek: `Einwilligungen/JJJJ-MM-TT_Nachname_Vorname.pdf` und `Einnahmen/` mit Übersicht als PDF und CSV, mit Vorschau von Anzahl und Größe. Gespeichert wird über das Teilen-Menü. Wird ein Eintrag als gelöscht markiert, als „PDF fehlt“ gebucht, entfernt oder anonymisiert, löscht die App auch diese Kopie. Einwilligungen, die vor diesem Update abgelegt wurden, haben keine Kopie.
- **Gesamtsicherung:** Eine JSON-Datei mit Einstellungen, Farbschema, Einnahmen, Fristen, Export-Protokoll (`inkform.export.v1`), Erinnerungsabstand (`inkform.backup.interval.v1`) und den PDFs für den Export (Base64). Nicht enthalten: PIN und offene Einwilligung. Gespeichert wird in zwei Schritten (erstellen, dann über das Teilen-Menü sichern), damit Safari das Teilen zulässt. Wiederherstellen prüft die ganze Datei vorher, fragt mit Datum und Inhalt nach, ersetzt dann alles außer der PIN und lädt die App neu. Die Übersicht erinnert, wenn die letzte Gesamtsicherung (`inkform.backup.v1`) älter als der eingestellte Abstand (1 bis 30 Tage) ist, und nennt abgeschlossene Monate mit PDFs, die noch in keiner gespeicherten ZIP-Datei mit Einwilligungen enthalten waren.
- **PIN:** 6 bis 12 Ziffern. Andere Zeichen werden schon beim Tippen entfernt; bei der Einrichtung gibt es getrennte Meldungen für „nur Ziffern“, „zu kurz“ und „zu lang“.
- **PIN-Sperre:** Nach 5 Fehlversuchen 30 Sekunden, gespeichert in `inkform.admin.lock.v1` und damit auch nach einem Neuladen wirksam. Eine zurückgestellte Uhr verlängert die Sperre nicht. Bekannte Grenze: Mit zwei gleichzeitig offenen Fenstern kann eine Sperre überschrieben werden oder bis zu 30 Sekunden länger dauern; auf dem iPad läuft die App in einem Fenster.
- **Aufbewahrung:** Zwei Fristen in Jahren (`inkform.retention.v1`). Die Löschliste zeigt fällige PDFs; Anonymisieren entfernt Name und Dateiname, Beträge bleiben. Anonymisiert wird nur, wenn das PDF als gelöscht markiert oder als „PDF fehlt“ gebucht ist, und es ist endgültig. Die Übersicht erinnert an offene Einwilligungen.
- **Updates:** Eine neue Version übernimmt erst, wenn die App leer ist (kein Formular in Arbeit, keine offene Einwilligung, keine ungespeicherten Änderungen), und löscht dann die alte aus dem Offline-Speicher. Ältere Versionen kennen die Felder `pdfMissing`, `pdfDeletedAt` und `anonymizedAt` nicht: alle Geräte gemeinsam aktualisieren.
- **Schriftgrößen:** Im Kundenbereich mindestens 16 px für Eingaben und Fließtext, nichts unter 14 px.

## Blanko

`profiles/blanko/` hat `"blank": true`: leere Studioangaben, neutrale Texte, eigenes Logo, keine eingebettete Anleitung. Die App zeigt dann nach der PIN einen Einrichtungsassistenten (Studio, Kontakt, Anschrift, Ort, optional Fristen), bis ein Studioname gespeichert ist; alles bleibt im Browser-Speicher des Geräts und ist unter „Studio & Kontakt“ änderbar. Mac-Hinweise und der Anleitungs-Knopf sind ausgeblendet. „Beispieldaten laden“ legt sechs erfundene Einwilligungen mit PDFs an (Kennungen `beispiel-…`), „Beispieldaten entfernen“ löscht sie samt PDFs.

`node scripts/blanko-pruefen.mjs` (oder `--dir <ordner>` für einen geschriebenen Build, `--sha256 <datei>` für die Prüfsummen der geprüften Dateien) prüft in zwei Ebenen:

- **Herkunft:** Der Kern muss ohne Änderungen committet sein, und jede Datei muss Byte für Byte dem Build entsprechen, den `build.mjs` daraus erzeugt. Privates könnte dann nur aus committeten Kerndateien stammen, und die prüfen die Leak-Tests samt Git-Historie. Ein Ordner darf nur die festen Dateien enthalten, keine versteckten Einträge, weiteren Ordner oder Verknüpfungen.
- **Suche:** Kennzeichen und Studiotexte (Name, Anschrift, Kontakt …), Logos, Icons, Anleitungen und andere Bilder des Beispiels und aller Studios; Benutzername, Rechnername, Home-Pfad und Git-E-Mail dieses Macs; alle Dateien unter `~/Library/Application Support/Inkform/zertifikat(e)/` (auch DER) und PEM-Blöcke; Werkstatt- und Vor-Ort-Bezüge; E-Mail-Adressen außer den zwei Platzhaltern und den Angaben in `public/vendor/`; eine eingebettete Konfiguration; PNG-Metadaten; Studioangaben im Profil. Gesucht wird auch nach Prozent-, HTML- und JavaScript-Dekodierung, ohne Zeichen ohne Breite, als UTF-16 und in kurzen Base64-Blöcken.

Die gesuchten Namen liest das Skript zur Laufzeit; im Kern stehen sie nicht. Ein nicht lesbarer Studio-Ordner bricht ab, ebenso das Fehlen jedes Studio-Profils (bewusst ohne: `--ohne-studios`). Nicht erkennbar sind ein neu kodiertes oder skaliertes Studio-Logo und Kundendaten ohne Kennzeichen; beides kann nur über committete Kerndateien hineinkommen.

## Leak-Tests

`npm test` findet Studios über `INKFORM_STUDIOS` (Ordner, getrennt durch `:`) oder in `../Inkform-Studios/`.

- **Über Kreuz:** Kein Build und kein Profilordner enthält Kennzeichen, Logo, Icons oder Anleitung eines anderen Profils, auch nicht als eingebettetes Base64.
- **Kern:** Arbeitsordner und die komplette Git-Datenbank (auch nicht mehr erreichbare Objekte, Refs, Reflogs) enthalten nichts von einem Studio.
- **Gegentests:** Eingeschleuste Kennzeichen und Dateien werden erkannt.

Durchsucht werden Text, Base64-Blöcke, PNG-Textfelder und der Text von PDFs. Die Browser-Prüfungen nutzen ein leeres Wegwerf-Profil von Chrome und nur erfundene Daten; Details in `tests/browser/README.md`.

## Werkstatt

`npm run werkstatt` startet eine Oberfläche nur auf `127.0.0.1`. Jede Anfrage braucht den richtigen Host und ein Sitzungs-Token, dazu gilt eine strenge CSP. Kundendaten liest oder speichert die Werkstatt nicht. Ihr Zustand liegt außerhalb der Repos unter `~/Library/Application Support/Inkform/` (`werkstatt/`, `zertifikate/`).

**Schutz:** Studios sind nur Anzeige, bis ihr Ordner in `werkstatt/freigegeben.json` steht (`{"studios": ["/pfad"]}`); neu angelegte Studios werden automatisch eingetragen. Das Beispiel kann immer gebaut und geprüft, aber nicht bearbeitet werden. Blanko erscheint nicht in der Werkstatt. Vor jedem Schreiben prüft die Werkstatt, dass der Ordner genau so freigegeben ist, keine Verknüpfung ist und in Wirklichkeit kein geschütztes Studio. Die Studio-Kennung muss 3 bis 40 Zeichen aus `a–z`, `0–9` und `-` haben.

**Funktionen:**

- **Bauen und Prüfen:** Build, `npm test` und Browser-Prüfungen, mit kurzer Zusammenfassung und aufklappbarem Protokoll. Es läuft immer nur ein Lauf.
- **Neues Studio:** kopiert das Beispiel nach `../Inkform-Studios/<kennung>/`, legt `.gitignore` und ein Git-Repo ohne Remote an. Ein vorhandener Ordner wird nie angefasst.
- **Profil-Editor:** Texte, Kennzeichen (mit Probe im eigenen Build), Anleitung, Logo (quadratisches PNG; die Icons erzeugt `sips`) und die änderbaren Manifest-Felder. Gespeichert wird nur ohne Fehler, ganz oder gar nicht, und nur wenn sich die Dateien seit dem Laden nicht geändert haben.
- **Commit:** genau die angezeigten Dateien, lokal als `Sven <sven@inkform.invalid>`, ohne Hooks. Nicht committet werden Build-Ordner, Zertifikate, Schlüssel und Kundendaten-Exporte, ebenso wenig in Repos mit Git-Filtern.
- **Export:** nur bei sauber committetem Kern und Studio, grünen Tests für genau diese Commits und aktuellem Build. Das Paket (`index.html`, `dist/`, `PRUEFBERICHT.txt`, `SHA256SUMS`) entsteht unter `../Inkform-Exporte/<studio>/inkform-<studio>-<version>-<datum>/`, ist schreibgeschützt und wird nie überschrieben. Vorher läuft die Leak-Prüfung gegen alle anderen Profile. Geschrieben wird das Paket von `werkstatt/publish.py` (python3 der Command Line Tools), das keine Verknüpfungen verfolgt und exklusiv umbenennt.
- **Vor Ort:** liefert einen gültigen Export im WLAN unter `https://inkform-app.local:8443/` aus, nur solange er läuft. Er nutzt ein Zertifikat je Studio, dessen Schlüssel mit einem Passwort verschlüsselt ist, das nirgends gespeichert wird. Vorher prüft die Werkstatt Zertifikat, WLAN, freien Namen, keinen Rückschritt der Version und FileVault. Die Anzeige bietet Adresse mit QR-Code, `.webloc` und Zertifikat zum AirDrop sowie eine Checkliste. Nach 30 Minuten ohne Anfrage endet der Modus.

**Noch nicht geprüft:** ob ein echtes iPad `inkform-app.local` findet und das Zertifikat annimmt. Bis das mit dem Beispiel an einem Test-iPad bestätigt ist, bleibt der Vor-Ort-Modus für Studios gesperrt.

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
