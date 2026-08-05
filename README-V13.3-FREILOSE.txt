Black White Eagles V13.3

Konkreter Doppel-K.-o.-Fehler behoben:

- Die internen Felder 'played', 'stats' und 'phase' werden wieder korrekt angelegt.
- Nach Abschluss der ersten Runde bricht die automatische Weiterleitung nicht mehr ab.
- Spieler mit Freilos bleiben mit 0 Niederlagen aktiv.
- Spieler mit Freilos werden zusammen mit den Gewinnern der echten Partien
  in der nächsten Gewinnerbaum-Runde berücksichtigt.
- Freilose zählen nicht als Matchsieg und verändern keine Legstatistik.
- Bereits gespeicherte Doppel-K.-o.-Spieltage mit unvollständiger Struktur
  werden beim nächsten Weitersetzen automatisch repariert.
- Test mit 6 Spielern erfolgreich:
  2 Freilose + 2 echte Partien -> 4 Spieler im nächsten Gewinnerbaum.
- JavaScript-Syntaxprüfung erfolgreich.
