# Black White Eagles – automatische Spieltag-Pushs

Dateien in das Hauptverzeichnis des GitHub-Repositories hochladen.

Zeitplan:
- täglich um 09:00 Uhr in Europe/Berlin
- zusätzlich manuell über GitHub → Actions
- 7 und 3 Tage vorher: nur ohne Rückmeldung
- 2 Tage vorher: allgemeine Erinnerung
- 1 Tag vorher: nur bei Dabei, Fahrer oder Komme direkt
- Gastkonten ausgeschlossen
- doppelte Pushs werden in `pushVersand` verhindert

Benötigtes GitHub-Secret:
`FIREBASE_SERVICE_ACCOUNT`

Dort den vollständigen Inhalt der Firebase-Dienstkonto-JSON-Datei einfügen.
Die JSON-Datei niemals direkt ins Repository hochladen.
