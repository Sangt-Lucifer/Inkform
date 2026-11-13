# 1. Start und erste Einrichtung

INKFORM – neutrale Vorlage. Anleitung für die Studioverwaltung. Stand: 13. November 2026.

Mit Inkform füllt der Kunde seine Tattoo-Einwilligung aus und unterschreibt auf dem Gerät. Das PDF entsteht lokal. Eine separate Einnahmenliste enthält nur Name, Termin, Artist und Preise. Gesundheitsangaben und Unterschriften landen nicht in dieser Liste.

## Jetzt auf dem Mac testen

- Im Ordner Inkform nach npm run build die Datei build/beispiel/index.html per Doppelklick im Browser öffnen. Alle Bibliotheken und das Logo sind enthalten; Internet ist nicht erforderlich.
- Beim ersten Start als Inhaber eine eigene PIN mit 6 bis 12 Ziffern (nur Zahlen 0–9) eingeben und wiederholen. Andere Zeichen nimmt das Feld nicht an; eine zu kurze oder zu lange PIN meldet die App. Die PIN sicher verwahren und nicht an Kunden weitergeben.
- Es öffnet sich die Admin-Konsole. Zuerst Studio & Kontakt und Datenschutz prüfen. Eigene Änderungen mit Änderungen speichern übernehmen.
- Über Zum Formular den Kundenmodus öffnen. Dadurch wird der gesamte Admin-Bereich wieder gesperrt. Zum erneuten Öffnen der Admin-Konsole ist die PIN nötig.

## Für den täglichen Einsatz vorbereiten

- Einen lokalen Ordner INKFORM / Einwilligungen anlegen und unter iPad & Dateien eine Test-PDF speichern. Die tatsächlich gespeicherte Datei anschließend öffnen.
- Alle Erklärungen, Pflegehinweise und tatsächlichen Studioabläufe vor dem Kundeneinsatz abstimmen. Ein Formular ersetzt kein persönliches Aufklärungsgespräch.
- Bei einer bereits früher verwendeten Version zuerst eine Gesamtsicherung erstellen (Übersicht). Alte gespeicherte Texte werden nicht automatisch überschrieben; unter Design & Sicherung die aktuelle Standardvorlage vergleichen und bei Bedarf übernehmen.

Wichtig: Die unterschriebene Einwilligung ist das PDF in der Dateien-App. Zusätzlich behält die App eine Kopie jedes bestätigten PDFs für den ZIP-Export, bis diese Kopie gelöscht wird. Einnahmenliste und Studioeinstellungen liegen ebenfalls nur in der App; gesichert wird alles zusammen mit der Gesamtsicherung.

# 2. Auf dem iPad einrichten und offline verwenden

## Vom Weblink zum Home-Bildschirm

Für den gewünschten Start über ein Symbol muss die vorbereitete Ausgabe dist/ zunächst über eine HTTPS-Adresse bereitgestellt werden. Der Mac kann sie im eigenen WLAN über HTTPS ausliefern (siehe README des Kerns). Die Adresse danach nicht mehr ändern: Das iPad speichert die App-Daten getrennt nach Adresse. Ein Mac-Link mit 127.0.0.1 ist auf dem iPad nicht derselbe Rechner.

- Den eingerichteten HTTPS-Link auf dem iPad in Safari öffnen.
- Beim ersten Start die Inhaber-PIN festlegen und die Studioangaben prüfen.
- Im Admin den Button Zum Home-Bildschirm wählen. Er zeigt die Anleitung; iPadOS verlangt die Bestätigung selbst.
- In Safari Teilen, gegebenenfalls Mehr, dann Zum Home-Bildschirm wählen. Als Web-App öffnen aktiviert lassen, falls die Auswahl erscheint, und Hinzufügen bestätigen.
- Inkform über das INKFORM-Symbol starten. Falls dieser Start eine getrennte Browserablage verwendet, PIN und Einstellungen auch dort einrichten. Vorhandene Daten lassen sich mit der Gesamtsicherung übernehmen.
- Unter iPad & Dateien auf Offline bereit warten. Danach Flugmodus einschalten, App neu starten und ein vollständiges Testformular einschließlich Unterschrift und PDF prüfen.

## Was lokal bleibt

Formularverarbeitung, Unterschrift, PDF und Einnahmenliste bleiben auf dem Gerät. Jedes bestätigte PDF liegt zusätzlich als Kopie im Speicher der App, unverschlüsselt im Browser-Speicher, bis diese Kopie gelöscht wird (Abschnitt 6). Beim ersten Abruf über den Weblink erhält der Hostinganbieter übliche Verbindungsdaten. Es gibt keine Kundendaten-Uploads durch die App. Die lokale Mac-Datei benötigt auch beim ersten Start keinen Webzugriff.

PDFs nur unter Auf meinem iPad sichern, nicht in iCloud Drive: Sonst liegen Gesundheitsangaben in der Apple-Cloud. Die Dateien-Vorschau allein ist kein verlässlicher Browser für diese App.

Safari kann Offline-Daten entfernen. Deshalb vor jedem Arbeitstag den Offline-Start prüfen. Die echte iPad-Installation, Apple-Pencil-Eingabe und Dateien-Ablage müssen auf dem vorgesehenen Gerät getestet werden.

## Das iPad absichern

Die App schützt ihren Admin-Bereich mit der PIN. Die unterschriebenen PDFs in der Dateien-App schützt nur das iPad selbst. Diese Punkte kann die App nicht prüfen; die Admin-Übersicht zeigt sie als Checkliste.

- Gerätecode mit mindestens 6 Ziffern einrichten und die automatische Sperre kurz halten. Erst mit Gerätecode verschlüsselt das iPad seine Daten; unter Einstellungen, Face ID & Code steht dann Datenschutz ist aktiviert.
- Geführter Zugriff für die Übergabe an Kunden: Einstellungen, Bedienungshilfen, Geführter Zugriff einschalten und einen eigenen Code festlegen, nicht die App-PIN. In der App dreimal die Seiten- oder Home-Taste drücken und starten. Der Kunde kann die App dann nicht verlassen.
- iCloud-Backup für dieses iPad ausschalten. Stattdessen regelmäßig ein verschlüsseltes Backup über den Mac erstellen: iPad per Kabel verbinden, im Finder Lokales Backup verschlüsseln wählen. Time Machine sichert es mit. Welche App-Daten ein iCloud-Backup genau enthält, wurde nicht geprüft.
- Safari-Verlauf und Websitedaten löschen oder das Home-Bildschirm-Symbol entfernen löscht Einnahmenliste, PIN, die PDF-Kopien in der App und eine offene Einwilligung. Vorher eine Gesamtsicherung erstellen.

Apple-Anleitung: [Website auf dem iPad in eine App verwandeln](https://support.apple.com/de-de/guide/ipad/ipad8f1f7a29/ipados).

# 3. Der Ablauf mit dem Kunden

## Ausfüllen und unterschreiben

- Der Inhaber gibt über Zum Formular einen leeren Kundenbogen frei. Die Admin-Konsole ist dann gesperrt.
- Der Kunde ergänzt seine Angaben, Tattoo-Termin, Artist, Körperstelle und Motiv. Die Gesundheitsfragen werden im persönlichen Gespräch geklärt.
- Gesamtkosten und Bereits angezahlt sind optional. Eingetragen wird der besprochene Gesamtpreis, keine unverbindliche Schätzung. Für keine Anzahlung ausdrücklich 0 eintragen; ohne Preisvereinbarung beide Felder leer lassen.
- Alle Pflicht-Erklärungen lesen und bestätigen. Die Fotoverwendung ist freiwillig: Ein Nein hat keine Nachteile für die Tätowierung.
- Erst nach der endgültigen Prüfung unterschreiben. Jede spätere Änderung an Formularangaben entfernt die Unterschrift und verlangt eine neue.

## PDF speichern und Gerät zurückgeben

- PDF erstellen wählen. Das Dokument wird auf diesem Gerät erzeugt. Namen mit Sonderzeichen wie Ş, Ł oder ı erscheinen korrekt. Zeichen, die die PDF-Schrift nicht darstellen kann (zum Beispiel ✓, Emojis oder arabische Schrift), meldet die App vorher.
- Die App zeigt jetzt den schwarzen Bildschirm Vielen Dank. Der Kunde sieht kein Speicherfenster und kann das Formular oder den Admin-Bereich nicht weiter über die Oberfläche bedienen.
- Der Inhaber wählt Studio entsperren und gibt seine PIN ein. Das PDF und die Ablagehinweise erscheinen.
- In Dateien sichern wählen, im Systemdialog Auf meinem iPad, den Studioordner und Sichern. Ohne Systemdialog wird der PDF-Download verwendet. Bei Abbruch oder Fehler die Speicherung hier wiederholen.
- Das PDF in der Dateien-App tatsächlich öffnen und den Speicherort prüfen. Die App kann nicht feststellen, ob das Dokument im Systemordner gespeichert wurde.
- Erst danach PDF ist gespeichert / Nächster Kunde bestätigen. Erst jetzt werden Name, Tattoo-Termin, Artist und Preise in die Einnahmenliste gebucht, genau einmal. Die Angaben werden geleert, das nächste Kundenformular wird freigegeben und der Admin ist wieder gesperrt.

Bis zur Bestätigung bleibt die unterschriebene Einwilligung auf diesem iPad zwischengespeichert, auch wenn die App neu geladen oder geschlossen wird. Danach wird diese Zwischenkopie gelöscht; das PDF bleibt aber für den ZIP-Export (Admin → Export) als Kopie auf dem iPad, unverschlüsselt im Browser-Speicher, bis es in der Löschliste als gelöscht markiert, als PDF fehlt gebucht, aus der Einnahmenliste entfernt, anonymisiert oder als PDF-Kopie aus der App gelöscht wird (Abschnitt 6). Die PIN schützt nur die Admin-Oberfläche, nicht die gespeicherten Daten. Kann das PDF nach einem Neuladen nicht wiederhergestellt werden, zeigt die App PDF nicht mehr verfügbar; die Einnahme lässt sich dann mit dem Vermerk PDF fehlt buchen. Meldet der Vielen-Dank-Bildschirm, dass nicht zwischengespeichert werden konnte, nicht neu laden, sondern sofort entsperren und ablegen. Eine offene Einwilligung zeigt die Admin-Übersicht nach 7 Tagen als Erinnerung an. Der finanzielle Listeneintrag ersetzt das unterschriebene PDF nicht.

Bei einem Fehler der Einnahmenspeicherung bleibt das Formular erhalten. Nicht neu laden und keine Browserdaten löschen. Der Inhaber kann den Fehler prüfen und die Bestätigung erneut versuchen. Ein schwarzer Vielen-Dank-Bildschirm allein ist noch kein Nachweis einer erfolgreichen PDF-Ablage.

# 4. Die Admin-Konsole bedienen

Admin-Konsole wählen und die Inhaber-PIN eingeben. Bei offenem Admin hat der Inhaber Zugriff auf die folgenden Reiter. Vor der Übergabe an Kunden immer Zum Formular verwenden.

| Reiter | Was dort bearbeitet oder geprüft wird |
| Übersicht | Einstieg, Erinnerungen, Gesamtsicherung und Wiederherstellen, Status des Studio-Profils und Verknüpfungen zu den wichtigsten Bereichen. |
| Studio & Kontakt | Studio / verantwortliche Person, vollständige Anschrift, Kontakt-E-Mail, Unterschriftsort und optional der vorbelegte Artist. |
| Formular & Texte | Begrüßung, Überschrift, Formularversion, Fotoeinwilligung sowie die Erklärung bei der Unterschrift. Eine Vorschau zeigt den Entwurf. |
| Gesundheitsfragen | Vorhandene Fragen anpassen und bei tatsächlichem Bedarf eigene Fragen ergänzen. Nur für den Termin relevante Angaben erheben. |
| Einwilligungen | Erklärungen zu Aufklärung, Motiv, Nachsorge und Gesundheitsdaten bearbeiten. Eine Checkbox ersetzt kein stattgefundenes Gespräch. |
| Einnahmen | Einwilligungen nach Artist, Monat und Jahr auswerten, offene Preise ergänzen, alte Einwilligungen nachtragen, PDF- und CSV-Listen ausgeben und einzelne PDF-Kopien aus der App löschen. |
| Export | ZIP-Datei mit Einwilligungs-PDFs und Einnahmenübersicht für einen Monat, ein Jahr oder einen freien Zeitraum. Speicheranzeige der PDF-Kopien in der App und Löschen dieser Kopien mit Prüfschritt. |
| Aufbewahrung | Fristen festlegen, Löschliste für fällige PDFs und Anonymisieren alter Namen in der Einnahmenliste. |
| Datenschutz | Aufbewahrungs- und Löschkriterien, Zugriff / Empfänger und vollständige Datenschutzhinweise bearbeiten. Angaben müssen dem realen Ablauf entsprechen. |
| iPad & Dateien | Offline-Verfügbarkeit und PDF-Funktion prüfen, Home-Bildschirm-Anleitung öffnen und eine Test-PDF ohne Kundendaten erzeugen. |
| Design & Sicherung | Light- oder Darkmode wählen, Studioeinstellungen als JSON oder vollständige App als HTML exportieren, Einstellungen importieren und die Standardvorlage laden. |

## Änderungen zuverlässig übernehmen

Texte und Studioangaben sind zunächst ein Entwurf. Änderungen speichern übernimmt sie ins Kundenformular und speichert sie lokal. Verwerfen verwirft nur den Entwurf. Beim Verlassen mit Änderungen fragt die App nach. Ein Einstellungsimport oder das Laden der Standardvorlage wird ebenfalls erst nach Speichern wirksam.

Einnahmeneinträge haben einen eigenen Dialog mit Eintrag speichern. Sie werden nicht über die untere Schaltfläche für Studioeinstellungen gespeichert. Bereits unterschriebene PDFs werden durch spätere Änderungen an Texten oder Preisen nicht verändert.

Die PIN schützt die Bedienoberfläche; sie ist keine Verschlüsselung der Browserdaten. Gerät und lokale Sicherungen zusätzlich mit den Möglichkeiten des Betriebssystems schützen. Es gibt keinen Online-PIN-Reset.

## Sprachen

- Die Verwaltung erscheint in der Sprache dieses Geräts (Design & Sicherung → Sprache dieses Geräts). Die Einstellung gilt nur für dieses Gerät und ist nicht in der Gesamtsicherung.
- Das Kundenformular startet immer in der Studiosprache. Weitere Sprachen für Kunden unter Studio & Kontakt → Sprachen und Währung ankreuzen; ab zwei Sprachen erscheint auf dem Formular eine Sprachauswahl. Ankreuzen lässt sich eine Sprache erst, wenn alle Formulartexte in ihr vorliegen.
- Wechselt der Kunde die Sprache, bleiben Angaben und Gesundheitsantworten erhalten; Erklärungen, Foto-Auswahl und Unterschrift beginnen neu. Das PDF entsteht in der Sprache des Kunden und vermerkt sie mit dem optionalen Hinweis, z. B. „Maßgeblich ist die deutsche Fassung“.
- Übersetzungen bearbeiten: auf Formular & Texte, Gesundheitsfragen, Einwilligungen und Datenschutz oben die Sprache umschalten. Unter jedem Feld steht der deutsche Text als Vorlage.
- Englisch ist als Entwurf enthalten, nicht juristisch geprüft, und wird Kunden erst nach dem Ankreuzen angeboten. Nach der Prüfung neben der Sprache „Juristisch geprüft“ ankreuzen.
- Wird ein deutscher Text geändert, bleibt die Übersetzung stehen, wird aber markiert, und die Sprache wird Kunden nicht angeboten. Der Hinweis „… Texte prüfen“ führt zu den Feldern und zeigt den alten und den neuen deutschen Text. Übersetzung anpassen oder „Übersetzung passt“ tippen, dann speichern.
- Die Währung steht ebenfalls unter Sprachen und Währung. Bereits erfasste Einnahmen behalten ihre Währung; Beträge werden nie umgerechnet.

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

Ein Eintrag wird beim Erstellen des unterschriebenen Kunden-PDFs automatisch angelegt. Wiederholtes Bestätigen erzeugt für dasselbe Formular keinen zweiten Eintrag. Entfernen löscht den Eintrag aus dieser lokalen Übersicht und die PDF-Kopie in der App, niemals das PDF in der Dateien-App. Vor größeren Korrekturen eine Gesamtsicherung erstellen.

# 6. Sichern, exportieren und Speicher freigeben

## Gesamtsicherung

In der Übersicht erstellt Gesamtsicherung erstellen eine Datei mit allem, was zum Wiederherstellen nötig ist: Studioeinstellungen, Farbschema, Einnahmenliste, Fristen, Export-Protokoll, Erinnerungsabstand und die PDF-Kopien in der App. Nicht enthalten sind die PIN und eine noch offene Einwilligung. Danach In Dateien sichern wählen und die Datei Auf meinem iPad sowie zusätzlich auf dem Mac in einem verschlüsselten Ordner ablegen. Die Datei enthält Gesundheitsangaben und Unterschriften; nicht in iCloud Drive ablegen.

Die Übersicht erinnert, wenn die letzte Gesamtsicherung älter als der eingestellte Abstand ist (1, 3, 7, 14 oder 30 Tage, Standard 7). Mindestens wöchentlich sichern, besser nach jedem Arbeitstag, zusätzlich vor Updates, Gerätewechseln oder dem Löschen von Browserdaten.

## Wiederherstellen

- Auf dem neuen Gerät oder in der neuen Browserumgebung die App öffnen und eine Inhaber-PIN festlegen.
- In der Übersicht Aus Sicherung wiederherstellen wählen und die Sicherungsdatei auswählen.
- Die App prüft zuerst die ganze Datei und fragt dann mit Datum und Inhalt nach. Bestätigen ersetzt alle Daten dieser App außer der PIN; das lässt sich nicht rückgängig machen. Danach lädt die App neu.
- Anzahl der Einträge, eine bekannte Monats- oder Jahressumme und einige Original-PDFs kontrollieren.

PDF-Kopien, die auf diesem Gerät bereits aus der App gelöscht wurden, holt eine Wiederherstellung nicht zurück, auch nicht aus einer älteren Sicherung. Solange eine Einwilligung offen ist oder Änderungen ungespeichert sind, ist das Wiederherstellen gesperrt. Die getrennten JSON-Sicherungen für Einnahmen und Studioeinstellungen gibt es weiterhin; sie enthalten keine PDFs.

## ZIP-Export nach Zeitraum

Im Reiter Export einen Monat, ein Jahr oder einen freien Zeitraum wählen, maßgeblich ist das Termindatum, und bei Bedarf nur Einwilligungen oder nur Einnahmen. Die Vorschau nennt Anzahl und Größe der Dateien; für einen leeren Zeitraum entsteht keine ZIP-Datei. ZIP erstellen und sichern öffnet das Teilen-Menü; dort In Dateien sichern wählen.

Die ZIP-Datei enthält den Ordner Einwilligungen mit Dateien nach dem Muster JJJJ-MM-TT_Nachname_Vorname.pdf und den Ordner Einnahmen mit der Übersicht als PDF und CSV. Einwilligungen, die als gelöscht markiert, als PDF fehlt gebucht, anonymisiert oder aus der App gelöscht sind, sind nicht enthalten. Die Übersicht erinnert an abgeschlossene Monate, die noch nicht als ZIP gesichert wurden.

## Speicher und PDF-Kopien in der App

Der Reiter Export zeigt, wie viele PDF-Kopien in der App liegen und wie viel Speicher sie belegen; ab 200 MB erscheint ein Hinweis. Gelöscht werden immer nur die Kopien in der App, nie Dateien in der Dateien-App, auf dem Mac oder auf USB-Sticks. Die Einträge in der Einnahmenliste bleiben vollständig und bekommen den Vermerk PDF nicht mehr in der App; in späteren ZIP-Exporten fehlen diese PDFs. Gelöscht wird nur auf eigenen Auftrag.

- Nach einem ZIP-Export bietet die App an, die PDFs dieses Zeitraums aus der App zu löschen. Später löschen ist jederzeit möglich, ohne dass etwas verloren geht.
- Nach Zeitraum: Im Reiter Export den Zeitraum wählen und PDF-Kopien dieses Zeitraums aus der App löschen. Wurde der Zeitraum noch nie als ZIP gesichert, warnt die App deutlich.
- Einzeln: In der Einnahmenliste beim Eintrag PDF-Kopie aus der App löschen, mit kurzer Warnung und Rückfrage. Auch PDF fehlt bei einem Eintrag mit Kopie löscht diese erst nach Rückfrage.

Vor dem Löschen nach Zeitraum steht ein Prüfschritt: die ZIP-Datei in der Dateien-App öffnen (ein Tippen entpackt sie), im Ordner Einwilligungen die PDFs zählen und mit der angezeigten Zahl vergleichen, ein oder zwei PDFs öffnen. Erst nach dem Haken bei Ich habe die ZIP-Datei geöffnet und geprüft wird der Lösch-Knopf aktiv; danach folgt eine letzte Rückfrage mit Anzahl und Zeitraum. Gelöschte Kopien sind aus der App endgültig weg.

## Aufbewahrung und Löschung

Im Admin-Bereich Aufbewahrung legt das Studio zwei Fristen in Jahren fest, gezählt ab dem Tattoo-Termin. Die App gibt keine Fristen vor; ohne Frist wird nichts angezeigt. Welche Fristen gelten, klärt das Studio im Zweifel mit Datenschutz- oder Steuerberatung.

- Löschliste: Zeigt die Einwilligungs-PDFs, deren Frist abgelaufen ist, mit Dateinamen. Die App kann Dateien in der Dateien-App weder sehen noch löschen. Das PDF dort und in allen Sicherungen löschen und erst dann in der App als gelöscht markieren; dabei löscht die App auch ihre eigene Kopie.
- Anonymisieren: Entfernt nach Ablauf der zweiten Frist Name und PDF-Dateiname aus der Einnahmenliste. Datum, Artist und Beträge bleiben für die Summen erhalten. Vorher eine Sicherung erstellen; das Anonymisieren lässt sich nicht rückgängig machen. Ältere JSON-Sicherungen enthalten die Namen weiterhin und müssen separat gelöscht werden.

Es gibt keinen automatischen Löschlauf, auch nicht für die PDF-Kopien in der App.

# 7. Hilfe und wichtige Grenzen

## Ein Problem beheben

- PDF-Speichern wurde abgebrochen: Als Inhaber den Vielen-Dank-Bildschirm entsperren und In Dateien sichern, PDF öffnen oder Download erneut verwenden. Das Formular erst nach kontrollierter Ablage für den nächsten Kunden leeren.
- Einnahmen konnten nicht gespeichert werden: Nicht neu laden. Der Inhaber prüft den lokalen Browser-Speicher und versucht die Bestätigung erneut. Die App hält das aktuelle Formular bis dahin vor. Existierende Sicherungen nicht löschen.
- PIN vergessen: Es gibt keinen Online-Reset. Vorhandene App-Daten nicht vorschnell löschen. Mit einer Gesamtsicherung lässt sich alles außer der PIN in einer neuen Browserumgebung mit neuer PIN wiederherstellen. Ohne Sicherung gibt es keinen vorgesehenen Wiederherstellungsweg über die Oberfläche.
- Einnahmenliste ist leer: Artist, Jahr und Monat kontrollieren. In einem anderen Browser oder über das Home-Bildschirm-Symbol kann ein anderer lokaler Datenbestand verwendet werden. Dort die Gesamtsicherung wiederherstellen.
- Nach einem App-Update: Vorher eine Gesamtsicherung erstellen. Die neue Version übernimmt, sobald kein Formular in Arbeit und keine Einwilligung offen ist. Danach die App einmal ganz schließen und neu öffnen. Alle Geräte mit derselben App gemeinsam aktualisieren: Eine ältere Version kann neuere Sicherungen nicht lesen und lehnt sie ab, ohne etwas zu überschreiben.
- App startet offline nicht: Vor dem nächsten Kundeneinsatz einmal über den eingerichteten Weblink laden, Offline bereit abwarten und im Flugmodus erneut testen. Ein belegter Offline-Cache kann durch iPadOS oder das Löschen von Browserdaten verloren gehen.
- Die App meldet nicht darstellbare Zeichen: Die mitgelieferte PDF-Schrift deckt lateinische, griechische und kyrillische Schrift ab, aber zum Beispiel keine Emojis, Symbole wie ✓ und keine arabische Schrift. Die gemeldeten Zeichen ersetzen oder weglassen; für die Einnahmenliste notfalls CSV verwenden.
- Speicher wird knapp: Im Reiter Export die Speicheranzeige prüfen und Zeiträume, die als ZIP gesichert und geprüft sind, aus der App löschen.
- PDF nicht mehr verfügbar nach einem Neuladen: Die Einwilligung erneut ausfüllen lassen, falls sie gebraucht wird, und die vorbereitete Einnahme mit dem Vermerk PDF fehlt buchen. Den Vermerk in der Einnahmenliste entfernen, sobald das PDF doch vorliegt.

## Vor dem ersten echten Kunden

- PIN selbst vergeben und den Wechsel vom Kundenformular zum gesperrten Admin testen.
- Ein Testformular unterschreiben, als PDF lokal speichern und in Dateien öffnen.
- Vielen-Dank-Sperre, PIN-Entsperrung und Freigabe eines leeren nächsten Formulars testen.
- Einen Eintrag ohne Preis erzeugen, den Preis nachtragen und die Artist-/Monatsauswertung kontrollieren.
- Eine Gesamtsicherung erstellen und die Wiederherstellung mit Testdaten ausprobieren.
- Einen ZIP-Export erstellen, in der Dateien-App öffnen und prüfen; das Löschen der PDF-Kopien mit Testdaten ausprobieren.
- Gerätecode, Geführten Zugriff und das verschlüsselte Mac-Backup einrichten; iCloud-Backup ausschalten.
- Unter Aufbewahrung die Fristen des Studios eintragen oder bewusst leer lassen.

Die rechtlichen Texte sind neutrale Entwürfe zur Prüfung, keine verbindliche anwaltliche Freigabe. Die Aufbewahrung richtet sich nach Zweck, Erforderlichkeit und einschlägigen Fristen; es wurde keine pauschale gesetzliche 30-Jahres-Pflicht behauptet. Die gezeichnete Unterschrift und Gerätezeit sind keine qualifizierte elektronische Signatur oder vertrauenswürdiger externer Zeitstempel. Der konkrete iPad-Test bleibt erforderlich.
