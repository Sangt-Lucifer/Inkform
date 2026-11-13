# Neues Studio anlegen

Ein Studio entsteht in der Werkstatt. Der Kern bleibt dabei unverändert; alle Studiodaten liegen nur im Studio-Ordner.

## 1. Anlegen

```sh
npm run werkstatt        # http://127.0.0.1:8090
```

Knopf „Neues Studio“, dann Kennung und Name eingeben. Die Kennung hat 3 bis 40 Zeichen aus `a–z`, `0–9` und `-`, zum Beispiel `atelier-nord`. Die Werkstatt:

- kopiert das Beispiel (`profiles/beispiel`) nach `../Inkform-Studios/<kennung>/`, ohne dessen README und Prüfbericht;
- legt eine `.gitignore` an, die Builds, Testausgaben, Zertifikate und Kundendaten ausschließt;
- richtet ein Git-Repo ohne Remote ein, noch ohne Commit;
- trägt das Studio in die Freigaben ein.

## 2. Profil bearbeiten

„Profil bearbeiten“ auf der Karte des Studios:

- **Kennzeichen:** alles, woran man das Studio erkennt, also Name in allen Schreibweisen, Inhaber, Adresse, E-Mail, Website und Social-Media-Namen. Die Probe zeigt, wo ein Kennzeichen im Build steht. Zu allgemeine Wörter, die auch im Beispiel oder einem anderen Studio vorkommen, werden abgelehnt.
- **Texte:** Alle Texte ersetzen; keiner darf noch auf das Musterstudio verweisen. Aufbewahrung, Zugriff und Aufsichtsbehörde müssen dem echten Ablauf entsprechen und rechtlich geprüft sein.
- **Anleitung, Logo, Manifest:** Das Logo ist ein quadratisches PNG; die Icons entstehen daraus. Es ist das eingebaute Logo. In der App kann der Inhaber unter „Studio & Kontakt“ ein eigenes hochladen, das in der Gesamtsicherung mitreist; Home-Bildschirm-Symbol und Manifest bleiben die des Profils.

Gespeichert wird erst, wenn die Prüfung keinen Fehler mehr meldet. Das Anleitungs-PDF erzeugt der Editor nicht. Bis es neu erzeugt ist (siehe README, „Anleitung als PDF“), bleibt der Leak-Test für das Studio rot.

## 3. Committen

„Änderungen committen …“ zeigt die geänderten Dateien und committet genau diese, lokal als Sven. Kundendaten, Exporte, Builds und Schlüssel lehnt die Werkstatt ab.

## 4. Bauen und prüfen

„Bauen & alles prüfen“ führt Build, alle Tests über Kreuz und die Browser-Prüfungen aus. Alles muss grün sein. Besonders wichtig sind die Leak-Tests: Der Build darf nichts aus anderen Studios oder dem Musterstudio enthalten, und der Kern nichts aus dem neuen Studio.

## 5. Exportieren und ausliefern

„Exportieren …“ ist erst möglich, wenn Kern und Studio committet sind und die Prüfungen für genau diesen Stand grün sind. Das Paket landet in `../Inkform-Exporte/<kennung>/`.

Aufs iPad kommt es mit „Vor Ort …“ im Studio-WLAN. Für Studios ist der Vor-Ort-Modus erst möglich, nachdem `inkform-app.local` einmal mit dem Beispiel an einem Test-iPad geprüft und freigegeben wurde.

Nie weitergeben: andere Studio-Ordner, `test-results/`, Sicherungen oder Zertifikatsschlüssel. Soll ein Studio den Quelltext bekommen, dann nur den Kern und seinen eigenen Studio-Ordner, ohne `build/` und `test-results/`.
