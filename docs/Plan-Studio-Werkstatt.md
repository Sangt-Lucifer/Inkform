# Plan: Studio-Werkstatt

Stand: 12.11.2026 · Phase 1 bis 4 umgesetzt · offen: erster Test mit einem echten Test-iPad

Die Werkstatt ist eine lokale Oberfläche auf dem Mac. Mit ihr bereitest du die iPad-App für jedes Studio einzeln vor, prüfst sie, exportierst sie und installierst sie vor Ort.

## Grundsätze

- **Ort im Kern:** Die Werkstatt liegt im Kern unter `Inkform/werkstatt/` und enthält keine Studiodaten. Studios findet sie wie die Tests über `../Inkform-Studios/` bzw. `INKFORM_STUDIOS`.
- **Technik:** nur Node und Bordmittel von macOS (`openssl`, `dns-sd`, `sips`, `ditto`, `shasum`, `git`). Keine neuen Abhängigkeiten, kein Internet, keine Cloud.
- **Erreichbarkeit:** Die Oberfläche läuft nur auf `127.0.0.1`. Ins WLAN geht ausschließlich der Vor-Ort-Server (Phase 4), und zwar nur, solange er läuft.
- **Wiederverwendung:** `build.mjs` (bauen und prüfen) und `serve.mjs` (ausliefern) bleiben die einzigen Werkzeuge für diese Aufgaben. Die Werkstatt ruft sie auf, statt sie nachzubauen. `serve.mjs` bekommt nur zwei Optionen dazu: Zertifikatsordner und Netz-Schnittstelle.
- **Keine Kundendaten auf dem Mac:** Die Werkstatt liest und speichert keine JSON-Sicherungen, PDFs oder Einnahmen. Der Vor-Ort-Server liefert nur die statische App aus und nimmt nichts entgegen (nur GET/HEAD).
- **Werkstatt-Zustand außerhalb der Repos:** Zuletzt gebaut, Testergebnis, letzter Export, installierte Version liegen unter `~/Library/Application Support/Inkform/werkstatt/`. Sie stehen damit weder im Kern noch in einem Studio-Repo.
- **Schutz der lokalen Oberfläche:** Jede Anfrage muss den richtigen `Host` (`127.0.0.1:<port>`) und ein zufälliges Sitzungs-Token mitbringen. Sonst könnte eine fremde Webseite im Browser Aktionen der Werkstatt auslösen (Schutz gegen DNS-Rebinding und CSRF).

---

## Bestandsstudio: geschützt

Das bereits installierte Studio (Ordner unter `../Inkform-Studios/`) bleibt unverändert und wird in der Werkstatt **nur angezeigt**.

- **Nichts wird angefasst:** Profil, Texte, Git-Repo, Build und Zertifikat bleiben, wie sie sind.
- **Keine Aktionen:** Die Werkstatt bietet für das Bestandsstudio weder Bauen noch Browser-Prüfungen, Export, Bearbeiten oder Vor-Ort-Modus an. Sie würden in dessen `build/` bzw. `test-results/` schreiben.
- **Anzeige ohne Schreiben:** Gelesen werden Git-Stand, `build.mjs --check` und das Zertifikats-Ablaufdatum.
- **Leak-Tests:** Der Leak-Test über Kreuz liest das Profil des Bestandsstudios weiterhin, nur lesend und im Arbeitsspeicher. So bleibt sichergestellt, dass kein neues Studio Daten des Bestandsstudios enthält und umgekehrt.
- **Adresse:** Die iPad-Adresse bleibt **die bisherige, auf den Gerätenamen des Macs ausgestellte Adresse (Port 8443)**, mit dem vorhandenen Zertifikat unter `~/Library/Application Support/Inkform/zertifikat/`. Ein Umzug auf einen neutralen Namen passiert nur, wenn du ausdrücklich zustimmst.
- **Bestehende Befehle:** `serve.mjs --lan` und `lokales-zertifikat.mjs` funktionieren für das Bestandsstudio genau wie heute weiter. Neue Optionen in Phase 4 sind rein zusätzlich; ohne sie ändert sich am Verhalten nichts. Das sichert ein eigener Test ab.
- **Markierung (umgesetzt in Phase 1, sicherer als ursprünglich geplant):** Jedes Studio ist standardmäßig **nur Anzeige**. Aktionen gibt es nur für Blanko und für Studios, die in `~/Library/Application Support/Inkform/werkstatt/freigegeben.json` stehen, also außerhalb der Repos. Kein Studioname steht im Kern, und das Repo des Bestandsstudios muss nicht geändert werden.

Hinweis ohne Änderung: Schritt A5 in der Umzugsanleitung im Repo dieses Studios (JSON-Sicherungen per AirDrop auf den Mac) passt nicht zur neuen Vorgabe „Kundendaten nie auf den Mac“. Ob du die Datei anpasst, entscheidest du; die Werkstatt fasst sie nicht an.

---

## Die vier Prüfpunkte

### 1. Fester, neutraler Hostname

- **Name:** **`inkform-app.local`**, Port **8443**, für alle **neuen** Studios gleich. Er wird nie geändert. Jedes Studio hat sein eigenes iPad, deshalb stört die gleiche Adresse nicht.
- **Das Bestandsstudio behält den bisherigen Gerätenamen des Macs.** Die Adresse wird pro Studio gespeichert. Für das Bestandsstudio ist sie fest eingetragen und in der Werkstatt nicht änderbar.
- **Ohne Umbenennen des Macs:** macOS kann einen zusätzlichen Bonjour-Namen ankündigen, solange der Vor-Ort-Modus läuft (`dns-sd -P … inkform-app.local <aktuelle-IP>`). Dein Gerätename bleibt, wie er ist. Wechselt die IP, weil du in einem anderen WLAN bist, ist das egal; der Name zeigt immer auf die aktuelle IP.
- **Namenskonflikt:** Gibt es den Namen im Studio-WLAN schon, würde Bonjour ihn still in `inkform-app-2.local` umbenennen. Das wäre eine neue Adresse und für das iPad ein leerer Speicher. Deshalb prüft die Werkstatt vor dem Start, ob der Name im Netz schon antwortet, und bricht dann ab. Sie weicht nie auf einen anderen Namen aus.
- **Nicht geprüft:** ob das iPad einen so angekündigten Namen zuverlässig findet. Das ist der erste Test in Phase 4. Ausweichlösung: den Mac fest auf den neutralen Namen umbenennen (Systemeinstellungen → Allgemein → Freigaben → Lokaler Hostname).

### 2. Ablauf des Zertifikats

- **Laufzeiten:** Das Stammzertifikat gilt 10 Jahre, das Serverzertifikat 825 Tage, das Maximum, das iPadOS hier akzeptiert.
- **Alltag am iPad:** Ein abgelaufenes Zertifikat stört dort nicht. Die App läuft komplett aus dem Offline-Speicher; der Mac ist ja meist gar nicht da.
- **Updates:** Mit abgelaufenem Serverzertifikat scheitert die Verbindung. Das iPad nutzt dann einfach weiter die alte Version; es gehen keine Daten verloren, aber das Update kommt nicht an.
  - *Lösung:* Die Werkstatt warnt ab 60 Tagen vor Ablauf. Erneuern geht mit einem Klick und demselben Stammzertifikat; am iPad ist dafür nichts zu tun.
- **Ablauf des Stammzertifikats** (nach 10 Jahren): ein neues Stammzertifikat erzeugen und einmal neu aufs iPad bringen. Die Adresse bleibt gleich, die Daten bleiben erhalten. Die Werkstatt erinnert ein Jahr vorher.

### 3. Sichere Ablage des Zertifikatsschlüssels

- **Ein Stammzertifikat pro Studio**, begrenzt auf `inkform-app.local`. Selbst ein gestohlener Schlüssel kann dann keine fremde Website fälschen und betrifft nur ein Studio.
- **Ablageort:** `~/Library/Application Support/Inkform/zertifikate/<studio>/`. Der Ordner ist nur für deinen Benutzer lesbar (Rechte `700`/`600`) und liegt außerhalb aller Repos.
- **Passwort:** Der Schlüssel des Stammzertifikats wird mit einem Passwort verschlüsselt (AES-256). Gebraucht wird es nur beim Erneuern. Ohne Passwort ist eine Kopie des Schlüssels wertlos, auch in einem Time-Machine-Backup. Das Passwort gehört in deinen Passwortmanager.
- **Serverschlüssel:** Er bleibt unverschlüsselt, damit der Server starten kann. Er ist begrenzt und kurzlebig.
- **Voraussetzungen und Kontrolle:** FileVault und ein verschlüsseltes Time-Machine-Backup sind Pflicht. Die Werkstatt prüft beides und zeigt den Stand an. Der Leak-Test bekommt dazu die Prüfung, dass in keinem Repo eine `.key`- oder `.crt`-Datei liegt.
- **Das Zertifikat des Bestandsstudios** im bisherigen Ordner bleibt unverändert und wird nicht verschoben. Erneuern geht wie heute mit `node scripts/lokales-zertifikat.mjs --renew`, außerhalb der Werkstatt.

### 4. Updates ohne Datenverlust am iPad

- **Gleiche Adresse:** immer `https://inkform-app.local:8443/`, mit demselben Stammzertifikat.
- **Nur getestete Pakete:** Ausgeliefert wird das exportierte Paket (Phase 3), nicht ein frischer Build. So kommt genau das aufs iPad, was getestet wurde.
- **Kein Rückschritt:** Die Werkstatt merkt sich pro Studio die zuletzt installierte Version und verweigert das Ausliefern einer älteren. Eine ältere App kann neuere Daten nicht lesen.
- **Ablauf am iPad:**
  1. In der App die Einnahmen und Einstellungen als JSON sichern, auf einem Datenträger des Studios.
  2. Den Vor-Ort-Modus starten.
  3. Die App am iPad öffnen. Die neue Version übernimmt, sobald nichts in Arbeit ist; das gibt es seit Phase 4 der App.
  4. Die App ganz schließen und den Flugmodus-Test machen.
  5. In der Werkstatt „installiert am …“ bestätigen.
- **Datenformat:** Ändert sich in einer künftigen App-Version das Datenformat, muss sie die alten Daten lesen können. Das wird zur festen Prüfung: ein Test mit Daten aus dem vorigen Export.

---

## Phase 1 – Übersicht, Bauen und Prüfen

**Oberfläche:** `node werkstatt/server.mjs` startet sie unter `http://127.0.0.1:8090`, gebaut mit reinem HTML, CSS und JS wie die App.

**Übersicht:** eine Karte je Studio (nicht freigegebene als „geschützt, nur Anzeige“) und eine für „Blanko“ (`profiles/beispiel`, deutlich als Demo markiert). Jede Karte zeigt:
- Name und Ordner,
- Git-Stand des Studio-Repos (sauber oder geändert, letzter Commit),
- den letzten Build (Zeit, aktuell ja oder nein, über `build.mjs --check`),
- Tests grün oder rot mit Zeitpunkt,
- den letzten Export und die installierte Version (ab Phase 3 und 4),
- Warnungen: Zertifikat läuft bald ab, Profil enthält noch Musterstudio-Texte, Anleitungs-PDF ist älter als `Anleitung.md`.

**Knöpfe je Studio** (nicht für geschützte Studios):
- **Bauen:** `build.mjs --profile <studio>`.
- **Prüfen:**
  - `npm test`, die Unit- und Leak-Tests über Kreuz für alle Studios, denn ein Leak ist nur über Kreuz erkennbar;
  - die Browser-Prüfungen `tests/browser/run.mjs --profile <studio>`.

**Ergebnisanzeige:** Läuft live mit. Am Ende steht eine verständliche Zusammenfassung: „7/7 Browser-Prüfungen bestanden“ oder „Leak-Test: Profil A enthält ‚…‘ aus Studio B (Datei …)“. Das ausführliche Protokoll ist aufklappbar.

**Ergebnis-Datensatz:** je Lauf mit den Git-Commits von Kern und Studio. Damit weiß Phase 3, ob die Tests zum aktuellen Stand gehören.

**Parallel laufen nicht:** Gleichzeitig darf nur ein Lauf aktiv sein, weil die Browser-Prüfungen Ports und Chrome nutzen.

**Schutz-Test:** Ein Test bestätigt, dass die Werkstatt bei einem geschützten Studio keine Aktion auslöst und in dessen Ordner nichts schreibt. Geprüft wird der Ordnerinhalt vor und nach dem Lauf.

**Tests der Werkstatt:** Unit-Tests für das Einlesen der Studios und für das Auswerten der Testausgaben. Dazu ein Browser-Test der Oberfläche, der ein Wegwerf-Studio in einem Testordner anlegt, nie in `Inkform-Studios/`.

## Phase 2 – Neues Studio und Profil-Editor

**Umgesetzt** (`werkstatt/profile.mjs`). Abweichungen vom Plan: Blanko wird im Editor nicht bearbeitet, weil es zum Kern gehört. Ein neues Studio wird automatisch freigegeben. README und Prüfbericht der Beispiel-Fassung werden nicht mitkopiert, weil sie das Musterstudio nennen. Kennzeichen dürfen außerdem nicht in der neutralen Beispiel-Fassung vorkommen, sonst wären sie zu allgemein.

**Neues Studio:**
- Kennung eingeben, nur `a-z0-9-`.
- Die Werkstatt kopiert `profiles/beispiel` nach `../Inkform-Studios/<id>/`, setzt `id`, legt `.gitignore` an (`build/`, `test-results/`, `*.key`, Exporte) und führt `git init` aus.
- Kein Remote. Autor ist Sven mit der neutralen Adresse.
- Der erste Commit kommt erst nach deiner Bestätigung in der Oberfläche.

**Editor** mit Abschnitten:
- **Texte:** alle Felder aus `profile.json → text`. Die Liste der Felder kommt aus dem Beispielprofil; alle Profile müssen dieselben haben.
- **Kennzeichen** (`markers`): Text oder Regex, mit Live-Probe „findet … in deinem Build“.
- **Anleitung:** Kopfzeile, Datum und Autor (`guide`) sowie `Dokumente/Anleitung.md`.
- **Logo:** nur PNG. Die Icons in 192 und 512 Pixeln erzeugt `sips` aus dem Logo, mit Vorschau.
- **Manifest:** Name, Kurzname, Beschreibung, `theme_color` und `background_color`. `id`, `start_url`, `scope` und `display` bleiben fest, weil die Adresse und das Verhalten auf dem iPad daran hängen.

**Prüfung beim Speichern:** Sie nutzt dieselben Regeln wie `build.mjs` und speichert nichts, solange ein Fehler offen ist.
- Verbotene Zeichen (`"` `` ` `` `\` `<` `>` `${`, Zeilenumbruch) und fehlende oder überzählige Texte.
- Verweise auf das Musterstudio: Die Kennzeichen von Blanko (Musterstudio, Max Mustermann, …) dürfen in keinem anderen Profil vorkommen.
- Fremde Kennzeichen: Kein Profil darf Kennzeichen eines anderen Studios enthalten.
- Gültige Farben und eine erlaubte Logo-Größe.

**Anleitungs-PDF:** Das Erzeugen braucht ReportLab, das noch nicht installiert ist. Das bleibt deine Entscheidung. Bis dahin zeigt die Werkstatt „PDF veraltet“ an.

## Phase 3 – Export

**Umgesetzt** (`werkstatt/export.mjs`). Ergänzungen: Die Leak-Prüfung vergleicht auch Logos, Icons und Anleitungs-PDFs. Regex-Kennzeichen laufen mit Zeitlimit. `-p<n>` zählt die verschiedenen exportierten Stände (Kern- und Studio-Commit) je Kernversion, damit auch eine Kernänderung ohne neue Versionsnummer einen neuen Namen bekommt. Exporte sind schreibgeschützt.

**Voraussetzungen**, sonst ist der Knopf gesperrt und die Werkstatt sagt, warum:
- beide Repos sauber,
- Tests grün für genau diese Commits,
- Build aktuell.

**Inhalt:** Das Paket wird aus der Dateiliste von `buildProfile()` erzeugt, nicht durch Kopieren eines Ordners. Darin sind nur `index.html`, `dist/` mit genau den Dateien, die der Build erzeugt, und:
- `PRUEFBERICHT.txt`: Kern- und Studio-Commit, Testergebnis, Datum;
- `SHA256SUMS`.

Nie enthalten sind `test-results/`, Exporte, Sicherungen, Zertifikate oder Daten anderer Studios.

**Leak-Prüfung:** Vor dem Abschluss läuft der Leak-Scan über das fertige Paket, mit den Kennzeichen aller anderen Profile einschließlich Blanko. Bei Blanko-Exporten prüft er gegen alle Studios.

**Name:** `inkform-<studio>-<version>-<JJJJ-MM-TT>`, zum Beispiel `inkform-studio-a-1.3.0-2026-11-20`.
- Die Version ist die Kernversion aus `package.json` mit dem Zusatz `-p<n>` für die n-te Profiländerung desselben Kerns.
- Exporte sind unveränderlich; ein neuer Export bekommt einen neuen Namen.

**Ablage:** `../Inkform-Exporte/<studio>/`, außerhalb aller Repos. Auf Wunsch zusätzlich als ZIP über `ditto`.

## Phase 4 – Vor-Ort-Modus

**Umgesetzt** (`werkstatt/certs.mjs`, `onsite.mjs`, `qr.mjs`). Abweichungen: `serve.mjs` bekommt drei statt zwei Optionen (zusätzlich `--log-requests` für das Anfrage-Protokoll ohne Adressen). Die Bonjour-Ankündigung nutzt `_https._tcp`. Ob der Name im Netz frei ist, prüft eine mDNS-Abfrage (bis 6 Sekunden). Time Machine-Verschlüsselung wird nicht automatisch geprüft. Studios können den neutralen Namen erst nutzen, wenn er mit Blanko an einem Test-iPad freigegeben wurde. Am echten iPad ist noch nichts geprüft.

**Vorbereitung im Studio-WLAN:**
1. Studio und Export auswählen; vorgeschlagen ist der neueste.
2. Die Werkstatt prüft:
   - Zertifikat gültig, mit Tagen bis zum Ablauf;
   - `inkform-app.local` im Netz frei;
   - aktuelle WLAN-IP;
   - kein Rückschritt gegenüber der installierten Version;
   - FileVault an.
3. Start: Bonjour-Name ankündigen (`dns-sd -P`). `serve.mjs --lan --dir <export>/dist` mit dem Zertifikat des Studios startet, gebunden nur an die WLAN-Schnittstelle, nicht an alle.
4. **Automatisches Ende:** nach 30 Minuten ohne Anfrage oder per Knopf. Beim Beenden der Werkstatt endet alles mit.

**Anzeige:**
- **Adresse groß, dazu ein QR-Code.** Der QR-Code entsteht mit einem kleinen eigenen Encoder ohne Abhängigkeit und wird mit festen Testvektoren geprüft.
- **Alternative zum QR-Code:** eine `.webloc`-Datei mit der Adresse zum AirDrop; sie öffnet direkt in Safari.
- **Zertifikat:** Knopf „Im Finder zeigen“ für `<studio>.crt` zum AirDrop. Den Schlüssel zeigt die Werkstatt nie an.
- **Checkliste fürs iPad**, zum Abhaken:
  - Zertifikat installieren und vertrauen;
  - Adresse in Safari öffnen;
  - zum Home-Bildschirm hinzufügen;
  - PIN festlegen bzw. bei Updates vorher sichern;
  - „Offline bereit“ abwarten;
  - Flugmodus-Test;
  - Sicherheits-Checkliste der App abarbeiten.

  Abgehakt wird nur, was du am iPad gesehen hast, und gespeichert wird nur Datum und Version, keine Kundendaten.
- **Protokoll:** Anfragen erscheinen als „iPad hat App geladen (index.html, sw.js)“, nur mit Pfad und Uhrzeit, ohne IP-Speicherung.

**Erster Test der Phase:** ein echtes iPad im WLAN. Findet es `inkform-app.local`, und nimmt es das Zertifikat an? Erst danach gibt die Werkstatt den neutralen Namen für neue Studios frei. Gerät dafür ist ein Test-iPad, nicht das iPad des Bestandsstudios.

---

## Reihenfolge und Aufwand

| Phase | Inhalt | Aufwand | Vorbedingung |
|---|---|---|---|
| 1 | Übersicht, Bauen, Prüfen | mittel | – |
| 2 | Neues Studio, Profil-Editor | mittel bis groß | Phase 1 |
| 3 | Export | mittel | Phase 1 |
| 4 | Vor-Ort-Modus, neutraler Name, Zertifikate je Studio | mittel | Phase 3, iPad zum Testen |

Das Bestandsstudio ist von keiner Phase betroffen; sein Umzug auf die Adresse mit dem bisherigen Gerätenamen kann unabhängig davon stattfinden.

## Offene Entscheidungen

1. Neutraler Name: `inkform-app.local` in Ordnung?
2. Bestandsstudio: als „geschützt, nur Anzeige“ wie oben beschrieben, in Ordnung?
3. Ein Stammzertifikat pro Studio, mit Passwort für den Schlüssel: einverstanden?
4. Exportordner `../Inkform-Exporte/` neben `Inkform-Studios/`: in Ordnung?
5. Anleitungs-PDF: ReportLab installieren oder einen anderen Weg suchen?
