Black White Eagles – Turnier-Push Phase 1

Enthalten:
- Doppel-K.-o. und Gruppenphase melden jede gespeicherte Turnieränderung an den Cloudflare Worker.
- Zuordnung: Turniername -> nickname in pushAbos; bei neuen Konten entspricht nickname dem Benutzernamen.
- Gegner-Push mit Runde, bei Gruppen zusätzlich Gruppe und Spielnummer.
- Spielstart-Push: "Spiel beginnt – Board X".
- Doppelte Pushs werden über turnierPushGesendet verhindert.
- Push öffnet die Live-Turnierseite mit Match-ID in der URL.

Cloudflare:
Den Inhalt von cloudflare-worker-turnier-push.js vollständig im Worker einsetzen und deployen.
Benötigte Secrets: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
