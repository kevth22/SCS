Black White Eagles V11.2

Behoben:
- Rolle wird auf der Vereinsranglisten-Seite frisch aus Firestore geladen.
- Admin und Captain können Spieltage einrichten, Teilnehmer auswählen,
  Turniere starten, Ergebnisse eintragen und korrigieren.
- Alte im Browser gespeicherte Gast-/Mitgliedsrolle wird aktualisiert.
- Klare Hinweismeldung, falls die aktuelle Rolle keine Verwaltung erlaubt.

Wichtig:
Das Konto muss in Firestore im Dokument unter 'mitglieder' das Feld
rolle = 'admin' oder rolle = 'captain' und aktiv = true besitzen.
