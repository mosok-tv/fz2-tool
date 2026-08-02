# Tests

    npm install     # einmalig
    npm test        # alle Prüfungen

- `app.test.js` – Kernfunktionen: Anmeldung, Maschinen, Aufgaben, Spulen-Berechnung
  (inkl. Beispiel aus dem Schulungsblatt), Rüsten, Fehlerbericht
- `sicherheit.test.js` – Verschlüsselung, Sperrbildschirm, Benutzeranmeldung
- `stil.test.js` – Stylesheet-Fallen, die jsdom nicht sehen kann
  (doppelte Klassennamen, Klassen ohne Regel)

**Grenze:** jsdom rechnet kein Layout. Optische Fehler (Überlappungen, Umbrüche)
findet nur ein echter Browser. Zum Nachsehen eine HTML-Datei mit `style.css`
bauen und mit `qlmanage -t -s 900 -o /tmp datei.html` rendern.
