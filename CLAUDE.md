# Schichtübergabe Feinzug 2 – Projektregeln

## Fachlicher Kontext
- Maschinen: Z49, Z67, Z68, Z78, Z82, Z83
- Ampel-Status: grün=Produktion, gelb=Umbau, rot=Drahtriss,
  blau=Reparatur, violett=Abrüsten
- Diese Statuswerte sind fix – nicht umbenennen oder Farben ändern
  ohne Rücksprache

## Auth & Rechte
- Login: Name + Passwort
- Mitarbeiter-Konten werden NUR vom Admin (mir) angelegt –
  keine Selbstregistrierung einbauen

## Design
- Farbschema: Blau/Grau, industriell (angelehnt an Drahtwerk Waidhaus)
- Dashboard: farbige klickbare Kacheln pro Maschine ("Köpfe") mit
  Ampel-Status
- Zusätzlich: allgemeine Aufgabenliste/Notizen, unabhängig von Maschinen

## Format
- Datum/Uhrzeit immer im deutschen Format (TT.MM.JJJJ, 24h)

## Workflow
1. Änderungen umsetzen
2. [Test-/Build-Befehle hier eintragen, sobald Stack final ist]
3. Vor jedem größeren Schritt: kurz Plan zeigen (Plan Mode)

## Nicht tun
- Keine Standard-Statuswerte hinzufügen/entfernen ohne Rücksprache
- Keine offene Registrierung – Konten bleiben admin-verwaltet

## Skills, Agenten & Plugins – Recherche vor Installation
Bevor mit der Umsetzung begonnen wird bzw. bei neuen Projektabschnitten:

1. Erst im Internet recherchieren, welche Skills, Subagenten und Plugins
   zum Projekt passen (Tech-Stack, Art der App, typische Anforderungen
   für so ein Projekt).
2. Danach eine LISTE schreiben mit:
   - Name des Skills/Agenten/Plugins
   - Kurz wofür er gut ist
   - Warum er für dieses Projekt passt
3. Diese Liste mir zuerst zeigen und auf Freigabe warten.
4. ERST NACH meiner Bestätigung installieren/einrichten.

Reihenfolge ist immer: Recherche → Liste zeigen → Freigabe abwarten →
Installation. Kein Punkt wird übersprungen, auch nicht bei "offensichtlich
sinnvollen" Skills.

## Fehler-Protokoll (Update-Regel)
Wenn Claude einen Fehler macht oder etwas korrigiert werden muss, wird das
hier festgehalten, bevor weitergearbeitet wird. Format für jeden Eintrag:

```
### [Datum]
- Was ist passiert: [kurze Beschreibung des Fehlers/Verhaltens]
- Warum falsch: [z. B. falsche Annahme, falscher Wert, gegen Vorgabe verstoßen]
- Regel für die Zukunft: [was Claude stattdessen tun soll]
```

Beispiel:
```
### 22.07.2026
- Was ist passiert: Claude hat einen siebten Status "orange" hinzugefügt
- Warum falsch: Die 5 Ampel-Status sind fix und dürfen nicht erweitert
  werden ohne Rücksprache
- Regel für die Zukunft: Vor dem Hinzufügen neuer Status-Werte immer
  nachfragen
```

<!-- Neue Fehler-Einträge immer unten anhängen -->
