# INKFORM – neutrale Vorlage

Lokale Tattoo-Einwilligung mit Unterschrift, PDF-Ablage und Einnahmenübersicht je Artist.

## Öffnen und bedienen

Auf dem Mac `index.html` per Doppelklick im Browser öffnen. Auch der erste Start funktioniert ohne Internet. Bei der ersten Einrichtung legt der Inhaber seine PIN mit 6 bis 12 Ziffern fest. Die gesamte Admin-Oberfläche benötigt die PIN. Über **Zum Formular** wird der gesperrte Kundenmodus freigegeben.

Die ausführliche **[Anleitung für iPad und Admin](Anleitung-iPad-und-Admin.pdf)** erklärt sämtliche Admin-Reiter, Einrichtung, Kundenablauf, Einnahmen, Sicherungen und Wiederherstellung. Sie ist auch direkt im Admin über **Anleitung (PDF)** verfügbar und in die Einzeldatei eingebettet. Die bearbeitbare Fassung liegt unter `Dokumente/Anleitung.md`.

## Kundenablauf

Nach **PDF erstellen & sichern** entsteht das unterschriebene PDF lokal, ein finanzieller Verweis wird in der Einnahmenliste gespeichert und der schwarze **Vielen Dank**-Bildschirm sperrt die Oberfläche. Der Inhaber entsperrt mit PIN und prüft bzw. wiederholt die tatsächliche PDF-Ablage. Erst nach **PDF ist gespeichert / Nächster Kunde** wird ein leeres Formular freigegeben. Die App kann das Speichern im Systemordner nicht selbst bestätigen.

Name, Termin, Artist und Preise werden in der Einnahmenliste lokal gespeichert. Gesundheitsangaben, Unterschriften und das PDF selbst bleiben im Arbeitsspeicher und werden nicht im Browser archiviert. Beim Schließen oder Neuladen vor der PDF-Ablage können sie verloren gehen. Die PIN ist ein Schutz der Bedienoberfläche, keine Verschlüsselung der Browserdaten. Betriebssystem-Gerätesperre und separate lokale Sicherungen bleiben notwendig. Es gibt keinen Online-PIN-Reset.

## Einnahmen und Sicherungen

Im Reiter **Einnahmen** Artist, Jahr und Monat auswählen. Summiert wird der **Gesamtpreis am Tattoo-Termin**. Anzahlungen sind nur Zusatzinformation und werden nicht zusätzlich summiert. Die Anzeige ist weder eine Zahlungseingangsabrechnung noch der persönliche Gewinn eines Artists.

Einwilligungen ohne Gesamtpreis bleiben als **Preis offen** in der Liste. Über **Bearbeiten** lassen sich Preise später ergänzen. **Einwilligung nachtragen** erfasst ältere PDFs manuell; es gibt keinen automatischen Scan der Dateien-App. Änderungen in der Liste ändern kein unterschriebenes PDF. Gefilterte Listen lassen sich als PDF und CSV ausgeben.

Drei Datenbestände getrennt sichern:

- Unterschriebene PDFs in der Dateien-App; bei ausschließlich lokaler Ablage **Auf meinem iPad** verwenden.
- Alle Einnahmen über die separate JSON-Sicherung im Einnahmen-Reiter. Ein Import ergänzt identische Daten ohne Duplikate; abweichende bestehende Einträge werden nicht überschrieben.
- Studioeinstellungen über JSON oder vollständigen HTML-Export unter **Design & Sicherung**. Diese enthalten keine Einnahmendaten und keine PIN.

Browserdaten löschen, Datei-/Browserwechsel oder ein anderes Gerät können einen anderen Datenbestand bedeuten. Regelmäßig auf einen zusätzlichen lokalen Datenträger sichern und die Wiederherstellung testen. Ein Export allein bestätigt keine erfolgreiche Dateiablage.

## iPad und Offline-Betrieb

Die Einzeldatei enthält alle Bibliotheken und die Anleitung. Es erfolgt keine Veröffentlichung. Die Ausführung lokaler HTML-Dateien über Dateien-App/Kurzbefehle sowie PIN-Speicher und PDF-Ablage müssen am verwendeten iPad geprüft werden. `dist/` ist zusätzlich eine Browser-Ausgabe; ein Safari-Home-Bildschirm-Lesezeichen benötigt eine erreichbare Startadresse. Im Admin hilft **Zum Home-Bildschirm** mit den von iPadOS verlangten Schritten: **Teilen → Zum Home-Bildschirm → Hinzufügen**. Über das Symbol starten, **Offline bereit** abwarten und im Flugmodus vollständig testen.

Beim ersten Abruf über einen Weblink erhält der Hostinganbieter übliche Verbindungsdaten. Formularverarbeitung und Kundendaten bleiben auf dem Gerät. Logo, Bibliotheken und Anleitung sind eingebettet; keine CDN-, Analyse- oder Kundendaten-Uploads. Der Service Worker speichert ausschließlich statische App-Dateien. Updates laden ein geöffnetes Formular nicht automatisch neu. iPadOS kann Browserdaten entfernen; den Offline-Start vor dem Einsatz prüfen.

Safari und Home-Bildschirm-App können getrennte lokale Daten verwenden. Studio-JSON und Einnahmen-JSON jeweils separat importieren und bei Bedarf die PIN in der neuen Umgebung vergeben. Die reine Dateien-Vorschau ist kein verlässlicher Browser für die App. Apple-Pencil-Eingabe, Home-Bildschirm-Installation und Systemdialog zur Ablage müssen am echten iPad getestet werden.

## Studioangaben und Texte

Studioangaben, Datenschutzkontakt, Aufbewahrung und Empfänger sind mit dem **erfundenen Musterstudio** (Max Mustermann, Musterstadt, `datenschutz@musterstudio.example`) vorbelegt. Alle Angaben sind fiktiv und müssen vor dem Einsatz vollständig durch die echten Studioangaben ersetzt werden. Vorlage 1.2 ersetzt einen Haftungsverzicht durch eine Nachsorge-Erklärung mit unveränderten gesetzlichen Ansprüchen. Die dokumentierte Vorprüfung und verbleibende Punkte stehen unter `Dokumente/Rechtstexte-Pruefung.md`; es gibt keine anwaltliche Freigabe.

Eigene ältere Studioeinstellungen werden erhalten. Vor einem Wechsel auf die aktuelle Standardvorlage zuerst als JSON sichern, dann unter **Design & Sicherung** die Vorlage als Entwurf laden, vergleichen und speichern. PDF-Dateien und Einnahmenliste werden dadurch nicht überschrieben. Die App führt keinen automatischen Löschlauf für gespeicherte PDFs aus.

## Entwickeln und prüfen

Build, Tests und Anleitung sind für alle Profile gleich und in der [README im Hauptordner](../../README.md) beschrieben. Die fertige App für dieses Profil entsteht mit `npm run build` unter `build/beispiel/`. Die gezeichnete Unterschrift und Gerätezeit sind keine qualifizierte elektronische Signatur bzw. kein externer vertrauenswürdiger Zeitstempel.
