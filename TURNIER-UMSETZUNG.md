# SC Schaffrath – Turnierüberarbeitung

## Bereitstellungsstatus

Die Änderungen sind auf dem Arbeitsbranch `codex/tournament-overhaul` vorbereitet.
Die zuvor fehlende GitHub-App-Installation für `kevth22` ist inzwischen freigegeben.
Die Übernahme wird als separater Pull Request zur Prüfung bereitgestellt; der
Hauptzweig und die produktiven Firestore-Daten werden dadurch nicht verändert.
Die 15 geänderten Dateien liegen zusätzlich als Update-ZIP und Git-Patch vor.

## Architektur und tatsächlicher Umfang

Die bestehende App ist eine statische JavaScript-PWA. Es gibt zwei getrennte
Bestandsansichten und Datenbestände:

| Ansicht | Bestehendes Firestore-Dokument |
| --- | --- |
| `vereinsserie.html` / `vereinsserie.js` | `vereinsrangliste_neu/haupt` |
| `vereinsspieltag.html` / `vereinsspieltag.js` | `vereinsspielserie/hauptserie` |

Beide verwenden jetzt dieselbe Turnierlogik, Admin-Komponente und denselben
Firestore-Transaktionsadapter. Die beiden vorhandenen Bestände werden nicht
zusammengelegt. Andere App-Bereiche und die bestehende Saison-Punktevergabe
bleiben erhalten. Es gibt keine zweite Datenbank und keine Demo-Daten in der App.

## Behobene Fehler und implementierte Funktionen

- Gruppentabellen werden aus offiziellen Spielen berechnet: 2 Punkte pro Sieg,
  danach Leg-Differenz, gewonnene Legs und erst dann direkter Vergleich.
  Widersprüchliche Sieger ergeben keine doppelten Siege. Ausdrücklich gespeicherte
  null Legs bleiben null; sie werden nicht durch Set-Ergebnisse überschrieben.
- Vollständige Gleichstände erhalten gemeinsame vorläufige Plätze. Namen und
  IDs lösen sie nicht auf. Entscheidungsspiele zählen nur zur Platzauflösung.
  Für mehrere Spieler sind eine Entscheidungsliga oder eine Liga mit Rückspielen
  auswählbar. Nach Änderung der regulären Quellergebnisse werden alte
  Entscheidungswertungen nicht ungeprüft wiederverwendet.
- 1 bis 8 Gruppen, automatische oder manuelle Gruppenzuordnung und gemeinsamer
  Rundenturnier-Spielplan. Bestehende Spiel-IDs und Ergebnisse bleiben erhalten.
- Gruppenübergreifende Setzung nach Gruppenplatz, absoluten Punkten und
  Leg-Differenz. Setzgleichstände werden angezeigt und verlangen eine ausdrücklich
  gespeicherte Admin-Reihenfolge. Keine Punkte-pro-Spiel-Normalisierung.
- Gold-/Silberplätze werden bei der Erstellung konfiguriert. Sie sind vor dem
  Endrundenstart außerdem korrigierbar. Überschneidungen sind unzulässig.
  Beide Endrunden besitzen eigene Teilnehmer, Paarungen, Ergebnisse und Sieger.
- Feste K.-o.-Bäume: stärkster gegen schwächsten gesetzten Teilnehmer; 1 und 2
  liegen in verschiedenen Hälften. Ein Zuordnungsalgorithmus minimiert zunächst
  Gruppenwiederholungen, dann Abweichungen von der Setzung. Unvermeidbare
  Gruppenduelle werden angezeigt. Es gibt keine Neusortierung zwischen Runden.
- Freilose gehen zunächst an die besten Setzplätze. Sie erzeugen keine gespielten
  Legs. Spieler und Freilose können durch einen Tausch geändert werden, ohne
  Teilnehmer zu verlieren oder zu verdoppeln.
- Generierte Gruppenturnier-Endrunden sind zunächst Vorschauen. Erst die Aktion
  „K.-o.-Phase offiziell starten“ speichert die unveränderliche ursprüngliche
  Qualifikation und Baumstruktur. Neue reine K.-o.-/Doppel-K.-o.-Bäume besitzen
  ebenfalls eine ausdrückliche Startaktion. Bestehende Bäume gelten als gestartet.
- Alle Spiele einschließlich abgeschlossener Spiele sind über die Admin-Liste
  bearbeitbar: Teilnehmer, Ergebnis, Legs, Gewinner, Status, Notiz; Zurücksetzen,
  Wiederöffnen, Annullieren und einzelne kampflose Wertung. Für historische
  abgeschlossene Turniere zuerst die vorhandene Aktion zum Wiederöffnen verwenden;
  dabei werden Saisonpunkte zurückgerechnet und nach Abschluss neu gebucht.
- Änderungen werden vollständig auf einer Kopie vorbereitet. Abhängige Partien
  und Konflikte erscheinen vor der Bestätigung. Bereits gespielte oder laufende
  Folgepartien behalten ihre ursprünglichen Teilnehmer und Ergebnisse, bis der
  Administrator den Konflikt ausdrücklich auflöst. Ungeklärte Konflikte verhindern
  den Turnierabschluss. Änderungen und alte Ergebnisstände werden protokolliert.
- Vollständiger Rückzug annulliert alle Gruppenspiele einschließlich bereits
  gespielter Partien, ohne kampflose 2:0-Ersatzwertung. Originalwertungen werden
  für einen möglichen Wiedereinstieg gesichert. Eine einzelne kampflose
  Gruppenniederlage zählt dagegen als 2 Punkte und 2:0 Legs.
- In Endrunden werden offene Begegnungen eines zurückgezogenen Spielers als
  kampflos entschieden. Abgeschlossene Partien und der feste Baum bleiben erhalten.
  Kampflose Endrundensiege erhöhen keine gespielten Legs oder Leistungssiege.
- Rückzugsübersicht mit Zeitpunkt, Gruppe, annullierten Spielen, Weiterleitungen,
  maßgeblicher nächster Spiel-ID und Spielposition sowie Wiedereinstiegsprüfung.
  Eine Wertung dieser nächsten Partie oder ein Phasenwechsel sperrt den automatischen
  Wiedereinstieg. Das spätere Zurücksetzen einer kampflosen Wertung hebt diese
  Sperre nicht auf. Zulässiger Wiedereinstieg stellt alte Gruppenergebnisse nach
  Bestätigung wieder her; weitere zurückgezogene Gegner bleiben ausgeschlossen.
- Nach Endrundenstart berechnen Gruppenkorrekturen weiterhin die Tabelle.
  Eingefrorene Qualifikanten und Paarungen bleiben bestehen; Abweichungen werden
  angezeigt. Ein Rückzug erhält die Momentaufnahme ebenfalls.
- Bestehender fester Doppel-K.-o.-Baum mit Gewinner-/Verliererquellen und Final-Reset
  bleibt erhalten. Reset-Ergebnisse werden nach Korrekturen nicht gelöscht.
  Auch der ältere dynamische Doppel-K.-o.-Modus bleibt lesbar und spielbar.
  Da dessen alte Runden keine Quellen besitzen, werden bei Korrekturen konservativ
  alle späteren Runden zur ausdrücklichen Prüfung markiert.

## Datenhaltung und Migration

Es wurden keine produktiven Datenbankänderungen ausgeführt und keine Ergebnisse
gelöscht. Die vorhandenen Dokumente werden additiv erweitert:

- Dokument: `revision`, weiterhin `updatedAt`.
- Turnier: `schemaVersion`, `participation`, `qualificationRules`, `manualSeeds`,
  `finalPreview`, `qualificationSnapshot`, `koStartedAt`, `silverKo`,
  `bracketStartedAt`, `bracketSnapshot`, `audit`, `lastAdminChange`.
- Spiele: Status-, Annullierungs-, Kampflose-, Konflikt- und Quelleninformationen;
  bestehende Spieler-, Ergebnis-, Leg- und Siegerfelder bleiben maßgeblich.
- Teilnahme: Rückzugszeitpunkt, nächste Spielposition, gesicherte Originalspiele,
  kampflose Weiterleitungen, Reaktivierungszeitpunkt.

Die Normalisierung ergänzt fehlende Felder und Quellen bestehender einfacher
K.-o.-Bäume. Bestehende gestartete Gruppen-Endrunden erhalten eine als `legacy`
gekennzeichnete Momentaufnahme des vorhandenen Baumes; eine historische ursprüngliche
Setzliste, die nie gespeichert wurde, kann nicht nachträglich rekonstruiert werden.

Die Speicherung erfolgt durch die echte Firebase-Firestore-SDK-Transaktion. Diese
liest Dokument und Mitgliedsrolle, prüft den kompletten zuvor gelesenen Quellstand
einschließlich Änderungen alter Clients und erhöht die Revision atomar. Bei einem
Konflikt wird neu geladen, statt einen anderen Adminstand zu überschreiben.
Bei Speicherfehlern werden unbestätigte lokale Ergebnisse zurückgenommen.

## Sicherheitsgrenze und verbleibende Einschränkungen

**Das bestehende Kontosystem verwendet keine Firebase Authentication.** Der Login
und die Rolle stammen aus Browser-Speicher und der Sammlung `mitglieder`; die
mitgelieferten bisherigen Firestore-Regelbeispiele erlauben weitreichende Zugriffe.
Die neue Transaktionsprüfung der Rolle schützt den regulären App-Ablauf, ist aber
kein serverseitiger Identitätsbeweis. Eine manipulationssichere Administratorprüfung
und unveränderliche Audit-Protokolle gegen direkte Datenbankzugriffe sind damit
weiterhin nicht gewährleistet. Dafür ist eine abgestimmte Umstellung auf verifizierte
Firebase-Identitäten oder ein authentifiziertes Backend mit restriktiven Regeln nötig.
Diese Umstellung und eine Veröffentlichung neuer Datenbankregeln wurden nicht
vorgenommen, um bestehende Konten und andere App-Funktionen nicht zu beschädigen.

Das bestehende Ein-Dokument-Modell von Firestore bleibt bestehen. Vor 900 kB
JSON-Nutzdaten wird ein neuer Schreibvorgang abgewiesen; die Historie wird nicht
automatisch gelöscht. Bei großen Saisonbeständen ist eine gesonderte kontrollierte
Archivierung / Dokumentaufteilung erforderlich. Alte bereits offene App-Versionen
können weiterhin nach ihren alten Regeln schreiben; deshalb müssen vor dem Einsatz
alle Verwaltungsgeräte auf die neue Version aktualisiert werden. Der neue Client
erkennt veraltete Quellstände, kann alte Clients aber ohne serverseitige Regeländerung
nicht selbst am Schreiben hindern.

Bei einem erneuten Gleichstand in einer Entscheidungsliga kann der Admin eine
weitere Entscheidungsserie anlegen. Ein frei konfigurierbarer K.-o.-Baum mit
sämtlichen Platzierungsspielen als Entscheidungsformat wurde nicht ergänzt.

## Automatisierte Prüfungen

Ausgeführt mit Node 24 und Chromium:

- `npm test`: 50 bestandene Tests, keine fehlgeschlagenen Tests. Die 40 geforderten
  Situationen sind in den Testnamen nummeriert beziehungsweise zusammengefasst.
  Zusätzlich: vollständige Zwei-Gruppen-Gold-/Silberabläufe, nachträgliche
  Gruppenkorrekturen und Endrundenkonflikte, 2 bis 40 Teilnehmer im festen Baum,
  1 bis 8 Gruppen in beiden echten App-Fabriken, beide Doppel-K.-o.-Implementierungen,
  Final-Reset, Freilose bei 5/12/17 Teilnehmern und Schweizer Runden.
- `npm run check`: Syntaxprüfung aller geänderten JavaScript-Einstiegspunkte und
  gemeinsamen Module bestanden.
- `npm run test:browser`: Chromium-Prüfung der echten Admin-Komponente bei
  1440×1000 und 390×844. Ergebniskorrektur, Änderungsvorschau, Abbruch ohne Mutation,
  Rückzug, Wiedereinstieg und horizontale Layoutgrenzen bestanden.
- `git diff --check`: bestanden.

Die Transaktions-Konkurrenztests ersetzen Firebase-I/O durch einen kontrollierten
Testadapter. Die Browserprüfung verwendet ausschließlich Testdaten und die echte
Admin-Komponente. **Nicht durchgeführt:** Firestore-Emulator-/Regeltests,
Produktionsdatenbanktests und ein vollständiger Login-zu-Firestore-Browsertest.
Die produktiven Zugriffsdaten wurden nicht verändert oder für Tests verwendet.
Das Repository hat keinen vorhandenen Build-Schritt; deshalb gibt es keinen
ausgeführten Produktions-Build. Die App bleibt direkt ausgeliefertes HTML/JavaScript.

## Geänderte Dateien

| Datei | Änderung |
| --- | --- |
| `tournament-engine.js` | Gemeinsame Tabellen-, Qualifikations-, Baum-, Korrektur-, Rückzugs- und Auditlogik |
| `tournament-double.js` | Sichere Doppel-K.-o.-Auflösung und Statistikneuberechnung |
| `tournament-persistence.js` | Firestore-Transaktionsadapter mit Quellstand-/Versionsprüfung |
| `tournament-admin.js`, `tournament-admin.css` | Gemeinsame responsive Admin-Oberfläche und Bestätigungsdialoge |
| `vereinsserie.js`, `vereinsspieltag.js` | Integration in beide bestehenden Ansichten und echte Speicherung |
| `vereinsserie.html`, `vereinsspieltag.html` | Qualifikations-/Gruppenkonfiguration, CSS und Versionsparameter |
| `sw.js` | Neuer PWA-Cache-Namespace für aktualisierte Dateien |
| `package.json` | Wiederholbare Test- und Syntaxprüfbefehle |
| `tests/tournament.test.js` | Turnierregeln und vollständige Abläufe |
| `tests/app-integration.test.js` | Bestehende App-Fabriken, Doppel-K.-o.-/Schweizer-Regressionen |
| `tests/browser-smoke.py` | Chromium-Interaktionen auf Desktop und Smartphone |
| `TURNIER-UMSETZUNG.md` | Dieser Bericht und Einrichtungshinweise |

## Vor produktivem Einsatz

1. Bestehende Firestore-Dokumente sichern. Neue Dateien zusammen mit den beiden
   aktualisierten HTML-/JS-Einstiegspunkten und `sw.js` ausliefern.
2. Alle Verwaltungsgeräte neu laden beziehungsweise die PWA aktualisieren. Während
   der Umstellung keine alten und neuen Admin-Clients gleichzeitig verwenden.
3. Ein separates Testturnier im tatsächlichen Firebase-Projekt durchspielen und
   Transaktionszugriff sowie die tatsächlich veröffentlichten Firestore-Regeln prüfen.
4. Die oben beschriebene Authentifizierungs-/Regellücke vor einer Einstufung als
   manipulationssichere Administration gesondert schließen.

Die Änderungen sind Code und überprüfte lokale Abläufe. Eine produktive
Veröffentlichung oder eine vollständige Sicherheitsfreigabe wird damit nicht behauptet.

## Nachbesserung der mobilen Gruppenansicht

Nach dem ersten produktiven Screenshot wurden die Gruppenüberschriften mit
ausdrücklich schwarzer Schrift auf weißem Hintergrund versehen. Karten und
Grid-Spalten können jetzt innerhalb der verfügbaren Breite schrumpfen; breite
Tabellen scrollen innerhalb ihrer Karte, Texte und Aktionsschaltflächen umbrechen.
Die Browserprüfung verwendet nun die tatsächlichen App-Container, zwei Gruppen
und lange Spielernamen und prüft zusätzlich die sichtbaren Grenzen der Karten,
Schaltflächen und Zusammenfassungen sowie die Überschriftenfarbe.

Solange reguläre Spiele einer Gruppe offen sind, ist deren Tabelle als vorläufig
gekennzeichnet. Entscheidungsspiele werden erst nach Abschluss der jeweiligen
Gruppe angeboten; die gemeinsame Turnierlogik verhindert auch direkte vorzeitige
Aufrufe. Die abschließende Setzlistenprüfung wartet auf das Ende der Gruppenphase.

Validierung dieser Nachbesserung: `npm test` mit 51 bestandenen Tests,
`npm run check`, `git diff --check` und Chromium-Prüfungen bei 1440×1000 sowie
390×844 bestanden. Keine Datenmigration und keine Änderung produktiver Ergebnisse.
