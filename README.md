# INKFORM

Lokale Tattoo-Einwilligung mit Unterschrift, PDF-Ablage und Einnahmenübersicht je Artist. Die App läuft vollständig auf dem Gerät und funktioniert offline. Kundendaten verlassen das Gerät nie: keine Cloud, kein Tracking, keine Bibliotheken oder Schriften aus dem Netz.

Dieses Repository ist der **neutrale Kern**. Er enthält keine Daten eines echten Studios, weder im Code noch in der Git-Historie. Echte Studios liegen als eigene Profile außerhalb, standardmäßig in `../Inkform-Studios/<studio>/`, jedes mit eigenem lokalen Git-Repo. Wie ein neues Studio entsteht, steht in [NEUES-STUDIO.md](NEUES-STUDIO.md).

Bedienung, Kundenablauf und Sicherungen stehen in `profiles/beispiel/README.md` und in der eingebetteten Anleitung (`profiles/beispiel/Dokumente/Anleitung.md`).

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/` | Gemeinsamer Code für alle Studios: Formular, Admin, PIN-Schutz, Einnahmen, PDF |
| `public/vendor/` | Gebündelte Bibliotheken (jsPDF 4.2.1, Tailwind CSS Browser 4.3.4) und die PDF-Schrift Noto Sans 2.015 (SIL OFL 1.1) samt Lizenzen |
| `profiles/beispiel/` | Eingebautes Beispielprofil mit einem **erfundenen Musterstudio** (Vorlage für neue Studios und neutrale Demo-Version) |
| `scripts/` | Build, lokale Vorschau, Anleitung als PDF |
| `tests/` | Unit-, Profil- und Leak-Tests; `tests/browser/` Browser-Prüfungen; `tests/lib/` Scan-Hilfen |
| `build/` | Erzeugte Beispiel-App (nicht in Git) |

Ein Profil besteht aus `profile.json`, `logo.png`, `icons/`, `manifest.webmanifest`, `Anleitung-iPad-und-Admin.pdf` und `Dokumente/`. `profile.json` enthält:

- `text`: alle studiospezifischen Texte. Im Code stehen dafür Platzhalter wie `%%studioName%%`. Der Build bricht ab, wenn ein Platzhalter fehlt, ein Text ungenutzt ist oder Zeichen enthält, die aus JavaScript oder HTML ausbrechen könnten (`"`, `` ` ``, `\`, `<`, `>`, `${`, Zeilenumbruch). Alle Profile müssen dieselben Texte definieren.
- `markers`: die **eigenen Kennzeichen** des Studios (Name, Inhaber, Adresse, E-Mail, Domains, Social-Media-Namen …) als Text oder `{"regex": "…"}`. Die Leak-Tests lesen sie aus dem Profil; im Kern steht keine Liste echter Studios.
- `guide`: Kopfzeile, Datum und Autor der PDF-Anleitung.

## Bauen und prüfen

Node.js ab Version 22, keine Paketinstallation:

```sh
npm run build                                              # Beispiel nach build/beispiel/
node scripts/build.mjs --profile ../Inkform-Studios/<studio>   # nach ../Inkform-Studios/<studio>/build/
node scripts/build.mjs --profile ../Inkform-Studios/<studio> --out <ziel>
npm run check                                              # Syntax und Aktualität des Beispiel-Builds
npm test                                                   # Unit-, Profil- und Leak-Tests
npm run test:browser                                       # Browser-Prüfungen, Beispiel
npm run test:browser -- --profile ../Inkform-Studios/<studio>
npm run preview                                            # Vorschau Beispiel auf http://127.0.0.1:8080
node scripts/serve.mjs --profile ../Inkform-Studios/<studio>
```

Je Profil entstehen `index.html` (Einzeldatei, alles eingebettet, ohne Server nutzbar) und `dist/` (Web-App mit Service Worker für den Offline-Betrieb auf dem iPad). Ein Studio-Build darf nicht im Kern landen: Der Build verweigert ein `--out` innerhalb dieses Repos. Er überschreibt nur einen vorhandenen Build (`index.html`, `dist/`) und bricht ab, wenn der Zielordner andere Dateien enthält.

## PDF-Schrift, Abschluss und PIN-Sperre

- **Schrift:** PDFs werden mit der eingebetteten Noto Sans (Normal und Fett) gesetzt, deshalb funktionieren Namen wie Gül Şahin, Łukasz Ćwik oder Ayşe Yıldız. jsPDF übernimmt nur die benutzten Zeichen ins PDF. Zeichen, die die Schrift nicht darstellen kann (z. B. ✓, Emojis, Arabisch, Devanagari), meldet die App vor dem Erstellen, statt sie stillschweigend wegzulassen.
- **Abschluss:** Die Einnahme wird erst gebucht, wenn der Inhaber die Ablage des PDFs bestätigt, und zwar genau einmal je Einwilligung. Bis dahin bleibt die offene Einwilligung auf dem Gerät: Metadaten ohne Gesundheitsdaten in `inkform.pending.v1`, das PDF in IndexedDB (`inkform-pending`). Nach der Bestätigung wird beides gelöscht. Ein Neuladen auf „Vielen Dank“ verliert nichts. Ist das PDF nicht mehr lesbar, kann der Inhaber die Einnahme als „PDF fehlt“ buchen; der Vermerk steht in Liste, CSV und Einnahmen-PDF und lässt sich im Eintrag wieder entfernen.
- **PIN-Sperre:** Nach 5 Fehlversuchen 30 Sekunden Sperre, gespeichert in `inkform.admin.lock.v1`, also auch nach einem Neuladen wirksam. Eine zurückgestellte Uhr verlängert die Sperre nicht. Ist der Speicher vorübergehend nicht beschreibbar (z. B. voll), zählt die App im Arbeitsspeicher weiter und speichert nach, sobald es wieder geht.
  - *Bekannte Grenzen (bewusst akzeptiert):* Nur wenn die App in **zwei Fenstern gleichzeitig** offen ist, kann (1) bei gleichzeitig scheiterndem Speichern ein Fenster die eben gesetzte Sperre des anderen überschreiben und (2) bei zurückgestellter Uhr eine laufende Sperre bis zu 30 Sekunden länger dauern. Auf dem iPad läuft die Home-Bildschirm-App in einem Fenster. Die Sperre ist nur eine Bremse gegen Durchprobieren; Schutz des Geräts bieten Gerätecode und Geführter Zugriff.
- **Aufbewahrung (Admin):** Zwei Fristen in Jahren (Einwilligungs-PDFs, Namen in der Einnahmenliste), gespeichert in `inkform.retention.v1`, ohne Vorgabe. Die Löschliste zeigt fällige PDFs zum Löschen in der Dateien-App und Abhaken (`pdfDeletedAt`); Anonymisieren entfernt Name und PDF-Dateiname, Beträge bleiben (`anonymizedAt`). Die Übersicht erinnert an eine seit 7 Tagen offene Einwilligung und zeigt eine Sicherheits-Checkliste mit dem Datum der letzten Einnahmen-Sicherung (`inkform.backup.v1`). Logik in `src/retention.js`.
- **App-Updates:** Der Service Worker einer neuen Version übernimmt erst, wenn die App leer ist (kein Formular in Arbeit, keine offene Einwilligung, keine ungespeicherten Admin-Änderungen, kein offener Dialog), und löscht dann die alte Version aus dem Offline-Speicher. So startet nach einem Update keine ältere Version mehr auf neueren Daten. Ältere Versionen lesen die seit Phase 3/4 möglichen Felder (`pdfMissing`, `pdfDeletedAt`, `anonymizedAt`) nicht; alle Geräte gemeinsam aktualisieren.
- **Anonymisierung:** Nur für Einträge, deren PDF als gelöscht markiert ist oder die als „PDF fehlt“ gebucht wurden. Auch ohne Dateinamen gilt ein PDF bis dahin als möglicherweise vorhanden. Anonymisieren ist endgültig: Kein Weg (Bearbeiten, Import, veraltete Bestätigung aus einem zweiten Fenster) bringt Namen oder Dateinamen zurück.
- **Schriftgrößen:** Im Kundenbereich sind Eingaben, Beschriftungen und Fließtext mindestens 16 px groß, nichts ist kleiner als 14 px. Die Browser-Prüfung `schriftgroessen` misst das auf mehreren iPad-Größen.

## Leak-Tests

`npm test` findet Studio-Profile über `INKFORM_STUDIOS` (Liste von Ordnern, getrennt durch `:`) oder in `../Inkform-Studios/`. Geprüft wird:

- **Über Kreuz** (`tests/profiles.test.mjs`): Kein Build und kein Profilordner enthält Kennzeichen eines anderen Profils oder dessen Logo, Icons oder Anleitung, auch nicht als eingebettetes Base64.
- **Kern-Repo** (`tests/core-leaks.test.mjs`): Alle Dateien des Arbeitsordners und die komplette Git-Datenbank (alle Commits, Bäume, Dateien und Tags, auch nicht mehr erreichbare) sowie Refs und Reflogs enthalten keine Kennzeichen und keine Logo-, Icon- oder Anleitungsdateien eines Studios.
- **Gegentests**: Eigene Kennzeichen und Logos werden im eigenen Build gefunden. Eine absichtlich eingeschleuste und wieder gelöschte Datei wird in einem Wegwerf-Repo erkannt. Ein eingeschleustes Kennzeichen samt Logo wird in einem fremden Build erkannt.

Durchsucht werden Text, dekodierte Base64-Blöcke, PNG-Textfelder und der Text von PDFs, einschließlich Teil-Schriften über ihre ToUnicode-Tabellen. Pixel- und Schriftdaten werden nur per Dateivergleich geprüft. Ohne Studio-Profile neben dem Kern werden die Kern-Prüfungen sichtbar übersprungen.

Die **Browser-Prüfungen** starten Google Chrome headless mit leerem Wegwerf-Profil, die Vorschau nur auf `127.0.0.1`, und verwenden ausschließlich erfundene Testdaten. Ihre Ausgaben landen im `test-results/` des jeweiligen Profils (Kern oder Studio-Ordner). Details stehen in `tests/browser/README.md`.

## Werkstatt (lokal, Phase 1 und 2)

```sh
npm run werkstatt          # http://127.0.0.1:8090, nur auf diesem Mac
```

**Übersicht:** Blanko (`profiles/beispiel`) und alle Studios neben dem Kern. Jede Karte zeigt Git-Stand, ob der Build aktuell ist, die letzten Ergebnisse von Tests und Browser-Prüfungen sowie Warnungen: noch Musterstudio-Texte im Studio, Anleitungs-PDF älter als `Anleitung.md`. Dazu Restlaufzeit des Vor-Ort-Zertifikats.

**Knöpfe:** Bauen (`build.mjs`), Unit- und Leak-Tests über Kreuz (`npm test`) und Browser-Prüfungen (`tests/browser/run.mjs`). Das Ergebnis wird verständlich zusammengefasst, das ausführliche Protokoll ist aufklappbar. Es läuft immer nur eine Prüfung gleichzeitig.

**Schutz:** Studios sind standardmäßig **nur Anzeige**. Aktionen gibt es für Blanko und für Studios, deren Ordner in `~/Library/Application Support/Inkform/werkstatt/freigegeben.json` steht (`{"studios": ["/pfad/zum/studio"]}`). Bestehende Installationen werden so nie aus Versehen neu gebaut.

**Neues Studio:** Knopf „Neues Studio“, Kennung (`a-z0-9-`) und Name eingeben. Die Werkstatt kopiert die Beispiel-Fassung nach `../Inkform-Studios/<kennung>/` (ohne deren README und Prüfbericht), setzt die Kennung, legt `.gitignore` an und führt `git init` aus, ohne Remote und ohne Commit. Das neue Studio wird automatisch freigegeben. Einen vorhandenen Ordner fasst sie nie an.

**Profil-Editor** (nur freigegebene Studios, nicht Blanko): Name, Kennzeichen mit Live-Probe, alle Texte, Anleitung (Kopfzeile, Datum, Autor, `Anleitung.md`), Logo und Manifest. Gespeichert wird erst, wenn die Prüfung keinen Fehler mehr findet:
- dieselben Zeichenregeln und dieselben Textfelder wie `build.mjs`; der Entwurf wird zur Probe in einem temporären Ordner gebaut;
- keine Texte oder Kennzeichen des Musterstudios und keine Kennzeichen anderer Studios (die nur gelesen werden);
- jedes Kennzeichen darf weder in der neutralen Beispiel-Fassung noch in einem anderen Studio vorkommen, und mindestens eines muss im eigenen Build stehen;
- Logo nur als quadratisches PNG (512 bis 4096 Pixel, höchstens 2 MB); die Icons in 192 und 512 Pixeln erzeugt `sips`;
- im Manifest sind nur Name, Kurzname, Beschreibung und die beiden Farben änderbar. `id`, `start_url`, `scope` und `display` bleiben fest.

Hat sich eine Profildatei geändert, seit der Editor sie geladen hat, wird nicht gespeichert; geprüft wird vor und direkt nach der Probe. Gespeichert wird ganz oder gar nicht: Scheitert eine Datei, kommen die alten zurück. Verknüpfungen (Symlinks) im Studio-Ordner werden nicht beschrieben. Regex-Kennzeichen ohne wiederholte Gruppen und Rückverweise, Wiederholungen höchstens {0,50}; die Probe läuft in einem eigenen Thread mit Zeitlimit, zu langsame werden abgelehnt. Bearbeitet wird nur ein Studio, das genau unter diesem Pfad freigegeben ist und in Wirklichkeit kein geschütztes Studio ist; committet nur in sein eigenes `.git`. Noch übernommenes Logo oder Anleitungs-PDF der Beispiel-Fassung zeigt der Editor als Warnung an; der Leak-Test bleibt dann rot.

**Commit:** „Änderungen committen …“ zeigt die geänderten Dateien. Committet wird genau diese Liste (über einen eigenen temporären Index, später entstandene Dateien bleiben draußen), lokal, als `Sven <sven@inkform.invalid>`. Build-Ordner, Zertifikate, Schlüssel und Kundendaten-Exporte werden verweigert, auch wenn `.gitignore` sie nicht abfangen würde.

**Zugriff:** Die Oberfläche lauscht nur auf `127.0.0.1`. Jede Anfrage muss den richtigen Host und ein Sitzungs-Token tragen; dazu kommt eine strenge CSP. So kann keine andere Webseite im Browser die Werkstatt auslesen oder Aktionen starten.

**Ablage:** Laufprotokolle liegen unter `~/Library/Application Support/Inkform/werkstatt/laeufe/`. Kundendaten liest oder speichert die Werkstatt nicht. Der Plan für die weiteren Phasen steht in [docs/Plan-Studio-Werkstatt.md](docs/Plan-Studio-Werkstatt.md).

## Aufs iPad bringen, ohne Cloud

Die Web-App braucht für den Offline-Betrieb einmalig HTTPS. Statt eines Hosters liefert der Mac sie im eigenen WLAN aus, nur solange der Befehl läuft:

```sh
node scripts/lokales-zertifikat.mjs                               # einmalig: lokales Zertifikat
node scripts/serve.mjs --profile ../Inkform-Studios/<studio> --lan   # https://<mac>.local:8443/
```

- **Zertifikat:** Das Stammzertifikat ist per Namensbeschränkung nur für den Bonjour-Namen dieses Macs gültig. Es kommt einmal aufs iPad: AirDrop, Profil installieren, dann unter Allgemein → Info → Zertifikatsvertrauenseinstellungen vertrauen.
- **Schlüssel:** Sie liegen unter `~/Library/Application Support/Inkform/zertifikat/`, außerhalb aller Repos und nur für den eigenen Benutzer lesbar.
- **Server:** Er liefert nur den statischen App-Ordner aus; Kundendaten laufen nie über ihn.
- **Adresse:** Rechnername und Port nicht ändern. Das iPad speichert die App-Daten pro Adresse.
- **Studio-Anleitung:** Die Schritt-für-Schritt-Anleitung, auch für den Umzug von einer alten Adresse per JSON, gehört ins jeweilige Studio-Repo.

## Anleitung als PDF

Sie wird aus `<profil>/Dokumente/Anleitung.md` erzeugt (ReportLab und Arial nötig). Danach muss neu gebaut werden:

```sh
python3 scripts/anleitung.py beispiel
python3 scripts/anleitung.py ../Inkform-Studios/<studio>
```

## Git und Daten

Git ist rein lokal (keine Remotes), gesichert wird über Time Machine. `.gitignore` schließt alle App-Exporte (Einwilligungs-PDFs, Einnahmen-CSV/JSON, Einstellungen) sowie grundsätzlich PDF-, CSV-, JSON-, Tabellen-, Foto- und ZIP-Dateien aus; erlaubt sind nur ausdrücklich freigegebene Projektdateien. Echte Kundendaten gehören nie in diesen Ordner.
