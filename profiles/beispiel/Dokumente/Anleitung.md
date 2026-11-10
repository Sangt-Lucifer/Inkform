# 1. Start und erste Einrichtung

INKFORM – neutrale Vorlage. Anleitung für die Studioverwaltung. Stand: 7. November 2026.

Mit Inkform füllt der Kunde seine Tattoo-Einwilligung aus und unterschreibt auf dem Gerät. Das PDF entsteht lokal. Eine separate Einnahmenliste enthält nur Name, Termin, Artist und Preise. Gesundheitsangaben und Unterschriften landen nicht in dieser Liste.

## Jetzt auf dem Mac testen

- Im Ordner Inkform die Datei index.html per Doppelklick im Browser öffnen. Alle Bibliotheken und das Logo sind enthalten; Internet ist nicht erforderlich.
- Beim ersten Start als Inhaber eine eigene PIN mit 6 bis 12 Ziffern eingeben und wiederholen. Die PIN sicher verwahren und nicht an Kunden weitergeben.
- Es öffnet sich die Admin-Konsole. Zuerst Studio & Kontakt und Datenschutz prüfen. Eigene Änderungen mit Änderungen speichern übernehmen.
- Über Zum Formular den Kundenmodus öffnen. Dadurch wird der gesamte Admin-Bereich wieder gesperrt. Zum erneuten Öffnen der Admin-Konsole ist die PIN nötig.

## Für den täglichen Einsatz vorbereiten

- Einen lokalen Ordner INKFORM / Einwilligungen anlegen und unter iPad & Dateien eine Test-PDF speichern. Die tatsächlich gespeicherte Datei anschließend öffnen.
- Alle Erklärungen, Pflegehinweise und tatsächlichen Studioabläufe vor dem Kundeneinsatz abstimmen. Ein Formular ersetzt kein persönliches Aufklärungsgespräch.
- Bei einer bereits früher verwendeten Version zuerst die Studioeinstellungen als JSON sichern. Alte gespeicherte Texte werden nicht automatisch überschrieben; unter Design & Sicherung die aktuelle Standardvorlage vergleichen und bei Bedarf übernehmen.

Wichtig: Einwilligungs-PDFs, Einnahmenliste und Studioeinstellungen sind drei getrennte Datenbestände. Nur die PDF-Ablage in Dateien ist die unterschriebene Einwilligung.

# 2. Auf dem iPad einrichten und offline verwenden

## Vom Weblink zum Home-Bildschirm

Für den gewünschten Start über ein Symbol muss die vorbereitete Ausgabe dist/ zunächst über eine HTTPS-Adresse bereitgestellt werden. Diese Projektfassung wurde nicht veröffentlicht; ein neuer iPad-Weblink ist noch einzurichten. Ein Mac-Link mit 127.0.0.1 ist auf dem iPad nicht derselbe Rechner.

- Den eingerichteten HTTPS-Link auf dem iPad in Safari öffnen.
- Beim ersten Start die Inhaber-PIN festlegen und die Studioangaben prüfen.
- Im Admin den Button Zum Home-Bildschirm wählen. Er zeigt die Anleitung; iPadOS verlangt die Bestätigung selbst.
- In Safari Teilen, gegebenenfalls Mehr, dann Zum Home-Bildschirm wählen. Als Web-App öffnen aktiviert lassen, falls die Auswahl erscheint, und Hinzufügen bestätigen.
- Inkform über das INKFORM-Symbol starten. Falls dieser Start eine getrennte Browserablage verwendet, PIN und Einstellungen auch dort einrichten. Studioeinstellungen und Einnahmen lassen sich jeweils über ihre eigene JSON-Sicherung übernehmen.
- Unter iPad & Dateien auf Offline bereit warten. Danach Flugmodus einschalten, App neu starten und ein vollständiges Testformular einschließlich Unterschrift und PDF prüfen.

## Was lokal bleibt

Formularverarbeitung, Unterschrift, PDF und Einnahmenliste bleiben auf dem Gerät. Beim ersten Abruf über den Weblink erhält der Hostinganbieter übliche Verbindungsdaten. Es gibt keine Kundendaten-Uploads durch die App. Die lokale Mac-Datei benötigt auch beim ersten Start keinen Webzugriff.

PDFs unter Auf meinem iPad sichern, wenn keine Cloud-Ablage gewünscht ist. Geräte-Backups und Synchronisierung werden durch iPadOS gesteuert und müssen separat geprüft werden. Die Dateien-Vorschau allein ist kein verlässlicher Browser für diese App.

Safari kann Offline-Daten entfernen. Deshalb vor jedem Arbeitstag den Offline-Start prüfen. Die echte iPad-Installation, Apple-Pencil-Eingabe und Dateien-Ablage müssen auf dem vorgesehenen Gerät getestet werden.

Apple-Anleitung: [Website auf dem iPad in eine App verwandeln](https://support.apple.com/de-de/guide/ipad/ipad8f1f7a29/ipados).

# 3. Der Ablauf mit dem Kunden

## Ausfüllen und unterschreiben

- Der Inhaber gibt über Zum Formular einen leeren Kundenbogen frei. Die Admin-Konsole ist dann gesperrt.
- Der Kunde ergänzt seine Angaben, Tattoo-Termin, Artist, Körperstelle und Motiv. Die Gesundheitsfragen werden im persönlichen Gespräch geklärt.
- Gesamtkosten und Bereits angezahlt sind optional. Eingetragen wird der besprochene Gesamtpreis, keine unverbindliche Schätzung. Für keine Anzahlung ausdrücklich 0 eintragen; ohne Preisvereinbarung beide Felder leer lassen.
- Alle Pflicht-Erklärungen lesen und bestätigen. Die Fotoverwendung ist freiwillig: Ein Nein hat keine Nachteile für die Tätowierung.
- Erst nach der endgültigen Prüfung unterschreiben. Jede spätere Änderung an Formularangaben entfernt die Unterschrift und verlangt eine neue.

## PDF speichern und Gerät zurückgeben

- PDF erstellen & sichern wählen. Das Dokument wird auf diesem Gerät erzeugt. Name, Tattoo-Termin, Artist und Preise werden dabei in die lokale Einnahmenliste übernommen.
- Wenn iPadOS den Systemdialog öffnet: In Dateien sichern, Auf meinem iPad, den Studioordner und Sichern wählen. Alternativ wird der PDF-Download verwendet.
- Die App zeigt jetzt den schwarzen Bildschirm Vielen Dank. Der Kunde kann das Formular oder den Admin-Bereich nicht weiter über die Oberfläche bedienen.
- Der Inhaber wählt Studio entsperren und gibt seine PIN ein. Das letzte PDF und die Ablagehinweise stehen wieder zur Verfügung. Bei Abbruch oder Fehler die Speicherung hier wiederholen.
- Das PDF in der Dateien-App tatsächlich öffnen und den Speicherort prüfen. Die App kann nicht feststellen, ob das Dokument im Systemordner gespeichert wurde.
- Erst danach PDF ist gespeichert / Nächster Kunde bestätigen. Die Angaben werden geleert und das nächste Kundenformular wird freigegeben; der Admin ist wieder gesperrt.

Vor der tatsächlichen PDF-Ablage nicht neu laden oder schließen: PDF und Unterschrift sind nur im Arbeitsspeicher und können dadurch verloren gehen. Der finanzielle Listeneintrag ersetzt das unterschriebene PDF nicht.

Bei einem Fehler der Einnahmenspeicherung bleibt das Formular erhalten. Nicht neu laden und keine Browserdaten löschen. Der Inhaber kann den Fehler prüfen und die Bestätigung erneut versuchen. Ein schwarzer Vielen-Dank-Bildschirm allein ist noch kein Nachweis einer erfolgreichen PDF-Ablage.

# 4. Die Admin-Konsole bedienen

Admin-Konsole wählen und die Inhaber-PIN eingeben. Bei offenem Admin hat der Inhaber Zugriff auf die folgenden Reiter. Vor der Übergabe an Kunden immer Zum Formular verwenden.

| Reiter | Was dort bearbeitet oder geprüft wird |
| Übersicht | Einstieg, Status des Studio-Profils und Verknüpfungen zu den wichtigsten Bereichen. |
| Studio & Kontakt | Studio / verantwortliche Person, vollständige Anschrift, Kontakt-E-Mail, Unterschriftsort und optional der vorbelegte Artist. |
| Formular & Texte | Begrüßung, Überschrift, Formularversion, Fotoeinwilligung sowie die Erklärung bei der Unterschrift. Eine Vorschau zeigt den Entwurf. |
| Gesundheitsfragen | Vorhandene Fragen anpassen und bei tatsächlichem Bedarf eigene Fragen ergänzen. Nur für den Termin relevante Angaben erheben. |
| Einwilligungen | Erklärungen zu Aufklärung, Motiv, Nachsorge und Gesundheitsdaten bearbeiten. Eine Checkbox ersetzt kein stattgefundenes Gespräch. |
| Einnahmen | Einwilligungen nach Artist, Monat und Jahr auswerten, offene Preise ergänzen, alte Einwilligungen nachtragen sowie PDF-, CSV- und Sicherungsexporte erstellen. |
| Datenschutz | Aufbewahrungs- und Löschkriterien, Zugriff / Empfänger und vollständige Datenschutzhinweise bearbeiten. Angaben müssen dem realen Ablauf entsprechen. |
| iPad & Dateien | Offline-Verfügbarkeit und PDF-Funktion prüfen, Home-Bildschirm-Anleitung öffnen und eine Test-PDF ohne Kundendaten erzeugen. |
| Design & Sicherung | Light- oder Darkmode wählen, Studioeinstellungen als JSON oder vollständige App als HTML exportieren, Einstellungen importieren und die Standardvorlage laden. |

## Änderungen zuverlässig übernehmen

Texte und Studioangaben sind zunächst ein Entwurf. Änderungen speichern übernimmt sie ins Kundenformular und speichert sie lokal. Verwerfen verwirft nur den Entwurf. Beim Verlassen mit Änderungen fragt die App nach. Ein Einstellungsimport oder das Laden der Standardvorlage wird ebenfalls erst nach Speichern wirksam.

Einnahmeneinträge haben einen eigenen Dialog mit Eintrag speichern. Sie werden nicht über die untere Schaltfläche für Studioeinstellungen gespeichert. Bereits unterschriebene PDFs werden durch spätere Änderungen an Texten oder Preisen nicht verändert.

Die PIN schützt die Bedienoberfläche; sie ist keine Verschlüsselung der Browserdaten. Gerät und lokale Sicherungen zusätzlich mit den Möglichkeiten des Betriebssystems schützen. Es gibt keinen Online-PIN-Reset.

# 5. Einnahmen je Artist auswerten

## Welche Summe angezeigt wird

Maßgeblich ist der Gesamtpreis laut Einwilligung am Tattoo-Termin. Die Anzahlung ist nur eine zusätzliche Information und wird nicht ein zweites Mal addiert. Die Übersicht zeigt vereinbarte Umsätze, keine Zahlungseingänge, Steuerabrechnung, Kosten oder den persönlichen Gewinn eines Artists.

Beispiel: Ein Termin kostet 450 EUR, davon sind 100 EUR angezahlt. Ein zweiter Termin kostet 250 EUR. Die Summe ist 700 EUR, nicht 800 EUR. Ein dritter Termin ohne Preis erscheint als Preis offen und erhöht die Summe noch nicht. Ein ausdrücklich eingetragener Preis von 0 EUR ist dagegen ein bekannter Preis.

## Suchen, ergänzen und ausgeben

- Artist auswählen oder Alle Artists verwenden. Leere Artist-Angaben sind unter Nicht zugeordnet zu finden.
- Jahr und Monat wählen. Ganzes Jahr zeigt die Jahresliste; Alle Jahre hebt den Jahresfilter auf.
- Die Karten zeigen die Summe bekannter Gesamtpreise, die Anzahl der Einwilligungen und die Anzahl offener Preise. Tagessummen je Artist lassen sich aufklappen.
- Bei einem Eintrag Bearbeiten wählen, fehlenden Gesamtpreis ergänzen und Eintrag speichern. Die Summe wird neu berechnet. Das unterschriebene Original-PDF bleibt unverändert.
- Für ältere PDFs Einwilligung nachtragen wählen. Termin, Name und Artist übernehmen; der PDF-Dateiname kann als Referenz dienen. Fehlende Preise leer lassen und später ergänzen. Die App durchsucht keine Dateien-Ordner und liest alte PDFs nicht automatisch ein.
- Gefilterte Liste als PDF oder als CSV ausgeben. Beide Ausgaben verwenden die aktuelle Auswahl. Die PDF kann über den Dateien-Dialog gesichert, anschließend geöffnet und gedruckt werden.

Ein Eintrag wird beim Erstellen des unterschriebenen Kunden-PDFs automatisch angelegt. Wiederholtes Bestätigen erzeugt für dasselbe Formular keinen zweiten Eintrag. Entfernen löscht nur den Eintrag aus dieser lokalen Übersicht, niemals das PDF in der Dateien-App. Vor größeren Korrekturen eine JSON-Sicherung anlegen.

# 6. Lokal sichern und wiederherstellen

## Drei getrennte Sicherungen

| Datenbestand | Sicherung und Wiederherstellung |
| Unterschriebene Einwilligungen | PDF-Dateien im lokalen Studioordner. Eine zweite lokale Kopie auf einem separaten Datenträger schützt bei Geräteverlust oder Defekt. Diese PDFs werden nicht durch einen App- oder Einnahmenexport ersetzt. |
| Einnahmenliste | Im Reiter Einnahmen: Alle Einnahmen als JSON sichern. Das enthält alle Artists und Jahre, unabhängig vom aktuellen Filter. Auf dem Zielgerät unter Einnahmen die Einnahmensicherung importieren. |
| Studioeinstellungen | Unter Design & Sicherung als JSON exportieren. Auf dem Zielgerät importieren, Entwurf prüfen und Änderungen speichern. Alternativ eine konfigurierte HTML-App exportieren. Einnahmen und PIN sind darin nicht enthalten. |

## Wiederherstellung testen

- PDFs und beide JSON-Sicherungen an einem zusätzlichen lokalen Speicherort ablegen. Eine Kopie nur auf demselben iPad schützt nicht vor dessen Ausfall.
- Auf dem neuen Browser oder Gerät die App öffnen und eine neue Inhaber-PIN festlegen.
- Die Studio-JSON importieren und speichern. Danach die Einnahmen-JSON im separaten Reiter importieren.
- Anzahl der Einträge, eine bekannte Monats- oder Jahressumme sowie einige gespeicherte Original-PDFs kontrollieren. Die Einnahmenreferenz kopiert oder öffnet kein Original-PDF automatisch.

Ein wiederholter identischer Einnahmenimport erzeugt keine Duplikate. Enthält eine Sicherung einen inzwischen anders bearbeiteten Eintrag mit derselben Kennung, wird der Import als Ganzes abgelehnt. Vorhandene Daten werden nicht still überschrieben. Die App nimmt keine automatische Cloud-Sicherung vor und bestätigt nicht, dass ein heruntergeladener Export tatsächlich auf dem Datenträger liegt.

Nach jedem Arbeitstag sichern; vor Updates, Gerätewechseln oder dem Löschen von Browserdaten zusätzlich prüfen. Aufbewahrung und Löschung muss der Inhaber im Dateibestand und in der Einnahmenliste selbst umsetzen. Es gibt keinen automatischen Löschlauf für exportierte PDFs.

# 7. Hilfe und wichtige Grenzen

## Ein Problem beheben

- PDF-Speichern wurde abgebrochen: Als Inhaber den Vielen-Dank-Bildschirm entsperren und In Dateien sichern, PDF öffnen oder Download erneut verwenden. Das Formular erst nach kontrollierter Ablage für den nächsten Kunden leeren.
- Einnahmen konnten nicht gespeichert werden: Nicht neu laden. Der Inhaber prüft den lokalen Browser-Speicher und versucht die Bestätigung erneut. Die App hält das aktuelle Formular bis dahin vor. Existierende Sicherungen nicht löschen.
- PIN vergessen: Es gibt keinen Online-Reset. Vorhandene App-Daten nicht vorschnell löschen. Mit den separat abgelegten JSON-Sicherungen lässt sich die Einrichtung in einer neuen Browserumgebung mit neuer PIN wiederherstellen. Ohne Sicherung gibt es keinen vorgesehenen Wiederherstellungsweg über die Oberfläche.
- Einnahmenliste ist leer: Artist, Jahr und Monat kontrollieren. In einem anderen Browser oder über das Home-Bildschirm-Symbol kann ein anderer lokaler Datenbestand verwendet werden. Die Einnahmen-JSON separat importieren.
- App startet offline nicht: Vor dem nächsten Kundeneinsatz einmal über den eingerichteten Weblink laden, Offline bereit abwarten und im Flugmodus erneut testen. Ein belegter Offline-Cache kann durch iPadOS oder das Löschen von Browserdaten verloren gehen.
- Ein PDF mit ungewöhnlichen Schriftzeichen lässt sich nicht ausgeben: Für die Einnahmenliste CSV verwenden; die mitgelieferte PDF-Schrift unterstützt nicht alle Schriftsysteme.

## Vor dem ersten echten Kunden

- PIN selbst vergeben und den Wechsel vom Kundenformular zum gesperrten Admin testen.
- Ein Testformular unterschreiben, als PDF lokal speichern und in Dateien öffnen.
- Vielen-Dank-Sperre, PIN-Entsperrung und Freigabe eines leeren nächsten Formulars testen.
- Einen Eintrag ohne Preis erzeugen, den Preis nachtragen und die Artist-/Monatsauswertung kontrollieren.
- Studio-JSON und Einnahmen-JSON sichern und eine Wiederherstellung mit Testdaten ausprobieren.

Die rechtlichen Texte sind neutrale Entwürfe zur Prüfung, keine verbindliche anwaltliche Freigabe. Die Aufbewahrung richtet sich nach Zweck, Erforderlichkeit und einschlägigen Fristen; es wurde keine pauschale gesetzliche 30-Jahres-Pflicht behauptet. Die gezeichnete Unterschrift und Gerätezeit sind keine qualifizierte elektronische Signatur oder vertrauenswürdiger externer Zeitstempel. Der konkrete iPad-Test bleibt erforderlich.
