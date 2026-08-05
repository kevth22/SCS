KASSE STATUS-FIX

- Beitragsstatus wird jetzt fest über die Firestore-Dokument-ID des Mitglieds zugeordnet.
- Alte Einträge über den Benutzernamen bleiben kompatibel.
- Während eines Speichervorgangs wird der angeklickte Status gesperrt.
- Nach dem Speichern werden nur die relevanten Kassendaten neu geladen.
- Dadurch kann ein bezahlter/offener Status nicht mehr durch Sortierung oder parallele Klicks auf eine andere Person springen.
