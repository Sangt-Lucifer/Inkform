# Sprachpakete

Sprachen, die nicht fest in die App eingebaut sind. Jede Datei `<code>.js` hat dasselbe Format und dieselben Regeln wie die Dateien in `src/sprachen/` (siehe [NEUE-SPRACHE.md](../NEUE-SPRACHE.md)); ein Code, der in `src/sprachen/` steht, darf hier nicht noch einmal vorkommen.

Der Build prüft die Pakete wie die eingebauten Sprachen und legt sie neben die App: `sprachen/index.json` (Liste) und `sprachen/<code>.json`. Die App lädt ein Paket nur, wenn es gebraucht wird – bei „Automatisch“ mit einer Gerätesprache, die nicht eingebaut ist –, prüft es, speichert es auf dem Gerät (offline nutzbar) und nimmt es in Gesamtsicherung und Studio-Einstellungen mit. Angefragt wird nur die eigene Adresse der App.

Ein neues Paket braucht kein App-Update: Datei hier ablegen, prüfen (`npm run build`, `npm test`), committen, `npm run pages`, pushen.
