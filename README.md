# INKFORM

Lokale Tattoo-Einwilligung mit Unterschrift, PDF-Ablage und Einnahmenübersicht je Artist. Die App läuft vollständig auf dem Gerät und funktioniert offline. Kundendaten verlassen das Gerät nie: keine Cloud, kein Tracking, keine Bibliotheken oder Schriften aus dem Netz.

Dieses Repository ist der **neutrale Kern**. Er enthält keine Daten eines echten Studios, weder im Code noch in der Git-Historie. Echte Studios liegen als eigene Profile außerhalb, standardmäßig in `../Inkform-Studios/<studio>/`, jedes mit eigenem lokalen Git-Repo. Wie ein neues Studio entsteht, steht in [NEUES-STUDIO.md](NEUES-STUDIO.md).

Bedienung, Kundenablauf und Sicherungen stehen in `profiles/beispiel/README.md` und in der eingebetteten Anleitung (`profiles/beispiel/Dokumente/Anleitung.md`).

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/` | Gemeinsamer Code für alle Studios: Formular, Admin, PIN-Schutz, Einnahmen, PDF |
| `public/vendor/` | Gebündelte Bibliotheken (jsPDF 4.2.1, Tailwind CSS Browser 4.3.4) samt Lizenzen |
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

## Leak-Tests

`npm test` findet Studio-Profile über `INKFORM_STUDIOS` (Liste von Ordnern, getrennt durch `:`) oder in `../Inkform-Studios/`. Geprüft wird:

- **Über Kreuz** (`tests/profiles.test.mjs`): Kein Build und kein Profilordner enthält Kennzeichen eines anderen Profils oder dessen Logo, Icons oder Anleitung, auch nicht als eingebettetes Base64.
- **Kern-Repo** (`tests/core-leaks.test.mjs`): Alle Dateien des Arbeitsordners und die komplette Git-Datenbank (alle Commits, Bäume, Dateien und Tags, auch nicht mehr erreichbare) sowie Refs und Reflogs enthalten keine Kennzeichen und keine Logo-, Icon- oder Anleitungsdateien eines Studios.
- **Gegentests**: Eigene Kennzeichen und Logos werden im eigenen Build gefunden. Eine absichtlich eingeschleuste und wieder gelöschte Datei wird in einem Wegwerf-Repo erkannt. Ein eingeschleustes Kennzeichen samt Logo wird in einem fremden Build erkannt.

Durchsucht werden Text, dekodierte Base64-Blöcke, PNG-Textfelder und der Text von PDFs, einschließlich Teil-Schriften über ihre ToUnicode-Tabellen. Pixel- und Schriftdaten werden nur per Dateivergleich geprüft. Ohne Studio-Profile neben dem Kern werden die Kern-Prüfungen sichtbar übersprungen.

Die **Browser-Prüfungen** starten Google Chrome headless mit leerem Wegwerf-Profil, die Vorschau nur auf `127.0.0.1`, und verwenden ausschließlich erfundene Testdaten. Ihre Ausgaben landen im `test-results/` des jeweiligen Profils (Kern oder Studio-Ordner). Details stehen in `tests/browser/README.md`.

## Anleitung als PDF

Sie wird aus `<profil>/Dokumente/Anleitung.md` erzeugt (ReportLab und Arial nötig). Danach muss neu gebaut werden:

```sh
python3 scripts/anleitung.py beispiel
python3 scripts/anleitung.py ../Inkform-Studios/<studio>
```

## Git und Daten

Git ist rein lokal (keine Remotes), gesichert wird über Time Machine. `.gitignore` schließt alle App-Exporte (Einwilligungs-PDFs, Einnahmen-CSV/JSON, Einstellungen) sowie grundsätzlich PDF-, CSV-, JSON-, Tabellen-, Foto- und ZIP-Dateien aus; erlaubt sind nur ausdrücklich freigegebene Projektdateien. Echte Kundendaten gehören nie in diesen Ordner.
