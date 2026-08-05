Black White Eagles Push – Version 9.0.3

Geändert:
- Jede neue Doppel-K.-o.-Auslosung erhält sofort eine neue pushTurnierId.
- Jede neue Gruppenauslosung erhält sofort eine neue pushTurnierId.
- Alte Einträge in turnierPushGesendet blockieren keine neuen Turniere mehr.
- Für ältere Turniere ohne pushTurnierId nutzt der Worker den stabilen Erstellzeitpunkt.
- turnierPushGesendet muss künftig nicht mehr manuell geleert werden.

Installation:
1. Alle Website-Dateien nach GitHub kopieren/ersetzen.
2. cloudflare-worker-turnier-push.js vollständig in Cloudflare einsetzen und deployen.
3. Ein neues Turnier auslosen.
4. Pushs testen.
