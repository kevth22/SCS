BLACK WHITE EAGLES KASSE 1.0

Zugriff:
- Ansehen: admin, captain, kassenwart
- Ändern: admin, kassenwart
- Kein Zugriff: mitglied, gast

Beitragspflicht:
- Alle aktiven Konten mit Rolle admin, captain, kassenwart oder mitglied
- Gäste werden nicht in der Beitragstabelle angezeigt
- Standardbeitrag: 20,00 EUR pro Monat
- Fälligkeit: jeweils am 1. des Monats; ein nicht bezahlter Beitrag erscheint als offen
- Individueller Beitrag, Befreiung und Notizen sind je Person einstellbar
- Befreiung ist nur über „Mitglied bearbeiten“ möglich, nicht durch Status-Tippen

Neue Firestore-Sammlungen:
- kassenProfile
- kassenBeitraege
- kassenBuchungen

WICHTIG ZUR SICHERHEIT:
Das aktuelle Kontosystem verwendet keine Firebase Authentication. Die Rollenprüfung in der App schützt die Oberfläche, kann aber allein keine manipulationssicheren Firestore-Rechte garantieren. Für eine echte Vereinskasse sollte später ein serverseitig geprüftes Login/Firebase Authentication ergänzt werden.
