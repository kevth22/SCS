Black White Eagles Turnier-Push 9.0.4

Push-Logik nach der Auslosung:
- Partien mit zugewiesenem Board: „Spiel beginnt – Board X“.
- Spielbereite Partien ohne Board: „Dein nächster Gegner steht fest“.
- Sobald eine wartende Partie später ein Board erhält, folgt zusätzlich der Board-Push.
- Freilos: Nur der echte Spieler erhält „Freilos erhalten“.
- Jedes Ereignis wird pro Turnier-ID, Match und Spieler nur einmal versendet.

Cloudflare:
Die Datei cloudflare-worker-turnier-push.js vollständig einsetzen und deployen.
Website:
Alle Dateien der ZIP bei GitHub hochladen/ersetzen.
