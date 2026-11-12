# Phase 4 – Datenschutz: Vorschlag

> Historisches Dokument: der damalige Plan bzw. Vorschlag. Der umgesetzte Stand steht in der README.

Stand: 11.11.2026 · nur Vorschlag, noch kein Code · Grundsatz: alles bleibt lokal auf dem iPad, keine Cloud, kein Tracking.

Keine Rechtsberatung. Fristen und Texte muss das Studio selbst festlegen, im Zweifel mit Datenschutz- oder Steuerberatung.

## Was die App heute speichert

| Ort | Inhalt | Gesundheitsdaten? | Wie lange |
|---|---|---|---|
| Dateien-App („Auf meinem iPad“) | unterschriebene Einwilligungs-PDFs | **ja** | bis der Inhaber sie löscht; die App kann sie weder sehen noch löschen |
| Browser-Speicher: Einnahmenliste | Name, Termin, Artist, Preise, PDF-Dateiname, ggf. „PDF fehlt“ | nein | unbegrenzt |
| Browser-Speicher: offene Einwilligung | PDF + Eckdaten bis zur Bestätigung | **ja** | bis zur Bestätigung; Reste werden beim App-Start gelöscht |
| Browser-Speicher: Einstellungen, PIN-Hash, PIN-Sperre | Studiotexte, keine Kundendaten | nein | unbegrenzt |
| JSON-/CSV-Sicherungen (vom Inhaber erstellt) | Einnahmenliste | nein | wo der Inhaber sie ablegt |

Die eigentlichen Gesundheitsdaten liegen also fast nur in den PDFs in der Dateien-App. Dort setzt der wichtigste Schutz an: Gerätecode, Ablageort und Backups.

---

## 1. PDFs mit Passwort

**Befund:** Die eingebaute PDF-Bibliothek (jsPDF 4.2.1) kann nur die alte RC4-Verschlüsselung mit 40 Bit (PDF 1.3). Die lässt sich in Sekunden knacken. Das Passwort müsste außerdem irgendwo stehen. Geht es verloren, ist die Einwilligung nicht mehr lesbar, obwohl sie unter Umständen jahrelang als Nachweis gebraucht wird.

| Option | Schutz | Aufwand | Risiko |
|---|---|---|---|
| A. Kein PDF-Passwort; Schutz über Gerätecode und Ablage „Auf meinem iPad“ | iPad-Datenschutz (Verschlüsselung, sobald gesperrt) | keiner | gering |
| B. jsPDF-Passwort (RC4 40 Bit) | nur scheinbar | klein | täuscht Sicherheit vor, Passwortverlust |
| C. Eigene AES-256-Verschlüsselung (PDF 2.0) über WebCrypto, offline | stark | groß (ca. 1–2 Tage plus Tests in Vorschau/Acrobat) | Passwortverwaltung, Kompatibilität, Verlust |

**Empfehlung: A.** B nicht umsetzen. C nur, wenn PDFs das iPad verlassen sollen, zum Beispiel als Kopie für Kundinnen und Kunden. Das tut die App heute nicht.

## 2. Löschhilfe und Anonymisierung

Die App kann PDFs in der Dateien-App nicht löschen; das kann eine Web-App unter iPadOS nicht. Sie kann den Inhaber aber an Fristen erinnern und ihre eigene Liste bereinigen.

**2a. Löschliste für Einwilligungs-PDFs** *(empfohlen)*
- Neue Admin-Seite „Aufbewahrung“ mit einer Frist in Jahren für Einwilligungs-PDFs. Standard: leer, also keine Erinnerung, bis das Studio eine Frist festlegt.
- Die App zeigt alle Einwilligungen, deren Termin älter als die Frist ist, mit Datum und PDF-Dateinamen aus der Einnahmenliste.
- Der Inhaber löscht die Dateien in der Dateien-App und hakt sie in der App ab („gelöscht am …“).
- Optional als Löschprotokoll (PDF/CSV) nur mit Referenz und Datum, ohne Namen.

**2b. Anonymisierung der Einnahmenliste** *(empfohlen, mit eigener Frist)*
- Eigene Frist, getrennt von 2a. Ob und wie lange Umsatzdaten aufzubewahren sind, sollte die Steuerberatung festlegen. Die App ersetzt keine Buchhaltung.
- Nach Ablauf werden der Name durch „anonymisiert“ ersetzt und der PDF-Dateiname geleert. Datum, Artist und Beträge bleiben für Summen und Statistik.
- Ablauf: Vorschau der betroffenen Einträge, Pflicht-Sicherung (JSON) anbieten, Bestätigung mit PIN. Nicht umkehrbar.
- Hinweis in der App: Ältere JSON-Sicherungen auf anderen Datenträgern müssen separat gelöscht werden.

**2c. Erinnerung an offene Einwilligung** *(empfohlen, klein)*
- Ist eine Einwilligung länger als z. B. 7 Tage nicht bestätigt, zeigt die Admin-Übersicht einen deutlichen Hinweis. Das PDF mit Gesundheitsdaten soll nicht unbemerkt im Browser-Speicher liegen bleiben.

**2d. „Alle App-Daten auf diesem iPad löschen“** *(optional)*
- Für Geräteabgabe oder -wechsel: löscht Einnahmenliste, offene Einwilligung, Einstellungen, PIN und Sperre.
- Nur mit PIN, Eingabe eines Bestätigungsworts und vorheriger Sicherungsaufforderung. PDFs in der Dateien-App bleiben unberührt; der Hinweis sagt das ausdrücklich.

## 3. Ergänzungen der Anleitung

Für die Anleitung je Profil (`Dokumente/Anleitung.md` und PDF) und als kurze Checkliste „Sicherheit des iPads“ in der Admin-Übersicht:

1. **Gerätecode**, mindestens 6-stellig. Erst damit verschlüsselt das iPad seine Daten, wenn es gesperrt ist. Unter Einstellungen → Face ID & Code steht dann „Datenschutz ist aktiviert“. Automatische Sperre kurz halten.
2. **Geführter Zugriff** für die Kundenübergabe: Einstellungen → Bedienungshilfen → Geführter Zugriff, eigener Code (nicht die App-PIN). Start durch dreimaliges Drücken der Seiten- bzw. Home-Taste in der App; der Kunde kann die App dann nicht verlassen.
3. **Ablage nur „Auf meinem iPad“**, nicht iCloud Drive. Sonst liegen Gesundheitsdaten in der Apple-Cloud, entgegen dem Grundsatz der App.
4. **iCloud-Backup des Studio-iPads ausschalten** und stattdessen regelmäßig ein **verschlüsseltes lokales Backup über den Mac** machen (Finder → iPad → „Lokales Backup verschlüsseln“), das von Time Machine mitgesichert wird. *Nicht geprüft:* welche Website- bzw. App-Daten ein iCloud-Backup genau enthält; das sollte auf dem Gerät nachgesehen werden.
5. **Wöchentliche Sicherung:** Einnahmen als JSON und Einstellungen als JSON exportieren; PDF-Ordner per Kabel oder Finder auf den Mac kopieren. Auf dem Mac in einem verschlüsselten Ordner oder Volume ablegen; alte Sicherungen nach der Frist mitlöschen.
6. **Warnung:** „Verlauf und Websitedaten löschen“ in Safari oder das Entfernen der Home-Bildschirm-App löscht Einnahmenliste, PIN und offene Einwilligung. Vorher sichern.
7. **Die App regelmäßig öffnen.** iPadOS kann Website-Daten länger nicht genutzter Web-Apps entfernen. *Nicht auf dem Gerät geprüft;* die regelmäßige Sicherung (Punkt 5) fängt das ab.

Hinweis: Das PDF der Anleitung wird mit ReportLab erzeugt, das auf diesem Mac nicht installiert ist. Für neue PDFs braucht es entweder dessen Installation (Download, nur mit deinem Okay) oder einen anderen Weg.

## Vorschlag zur Reihenfolge (Phase 5, nach deiner Freigabe)

| # | Paket | Aufwand | Nutzen |
|---|---|---|---|
| 1 | Anleitung und Sicherheits-Checkliste (3) | klein | hoch: schützt die PDFs mit Gesundheitsdaten |
| 2 | Erinnerung offene Einwilligung (2c) | klein | mittel |
| 3 | Löschliste (2a) | mittel | hoch |
| 4 | Anonymisierung der Einnahmenliste (2b) | mittel | mittel |
| 5 | Alle App-Daten löschen (2d) | klein | gering bis mittel |
| – | PDF-Passwort (1) | – | nicht umsetzen (Option A) |

## Offene Entscheidungen für dich

- Welche Pakete umsetzen, und in welcher Reihenfolge?
- Fristen: Soll die App feste Vorschläge machen, oder bleiben die Felder leer, bis das Studio Werte einträgt? Empfehlung: leer lassen.
- Anleitung als PDF: ReportLab installieren oder einen anderen Weg suchen?
- Die iPad-Adresse, unter der die App heute läuft (für das Update ohne Datenverlust).
