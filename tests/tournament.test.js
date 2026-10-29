import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../tournament-engine.js';
import { refreshDouble } from '../tournament-double.js';
import { canonical, createTournamentWriter } from '../tournament-persistence.js';

const match = (a, b, s1, s2) => T.blankMatch(a, b, { s1, s2, legs1: s1, legs2: s2,
  completed: true, status: 'completed', winner: s1 > s2 ? a : b, loser: s1 > s2 ? b : a });
const group = (players, matches, id = 'G1') => ({ id, name: id, players, matches });
const dayFor = groups => ({ id: 'tournament', mode: 'groupsko', engine: 'groups', attendees: groups.flatMap(g => g.players), groups,
  qualifyPlaces: [1, 2], groupFormat: { format: 'legs' }, participation: {} });
const plan = (day, mutate, action = 'Testkorrektur') => T.planChange(day, action, 'admin', mutate, refreshDouble);
function result(day, id, a = 2, b = 0) {
  return plan(day, d => T.editMatch(d, id, { status: 'completed', s1: a, s2: b, legs1: a, legs2: b })).day;
}
function directBracket(count, groups = false) {
  const seeds = Array.from({ length: count }, (_, i) => ({ id: `P${i + 1}`, group: groups ? `G${i % 4}` : null }));
  return { id: 'ko', mode: 'premier', ...T.makeBracket(seeds), bracketStartedAt: 'started' };
}
function fillBracket(day, key = 'main', reverse = false) {
  for (let pass = 0; pass < 100; pass++) {
    const bracket = key === 'main' ? day : key === 'gold' ? day.ko : day.silverKo;
    const open = T.bracketMatches(bracket).find(m => !T.finished(m) && !m.conflict && m.p1 && m.p2);
    if (!open) return day;
    day = result(day, open.id, reverse ? 0 : 2, reverse ? 2 : 0);
  }
  throw new Error('Unendlicher Turnierablauf');
}

test('01/02: ein Sieg zählt genau zwei Punkte; Punkte haben Vorrang', () => {
  const g = group(['A', 'B', 'C'], [match('A', 'B', 2, 1), match('A', 'C', 2, 1)]);
  const rows = T.standings(g).rows;
  assert.equal(rows[0].id, 'A'); assert.equal(rows[0].mp, 4);
  assert.equal(rows.reduce((n, r) => n + r.mp, 0), 4);
  assert.equal(rows.find(r => r.id === 'B').mp, 0);
});
test('03: Leg-Differenz hat Vorrang vor direktem Vergleich', () => {
  const g = group(['A', 'B', 'C'], [match('A', 'B', 2, 1), match('B', 'C', 5, 0), match('C', 'A', 2, 0)]);
  const rows = T.standings(g).rows;
  assert.deepEqual(rows.map(r => r.id), ['B', 'A', 'C']);
});
test('04: gewonnene Legs entscheiden nach gleicher Punktzahl und Differenz', () => {
  const g = group(['A', 'B', 'X', 'Y'], [match('A', 'X', 3, 0), match('A', 'Y', 2, 4), match('B', 'X', 2, 0), match('B', 'Y', 0, 1)]);
  const rows = T.standings(g).rows;
  assert.equal(rows.find(r => r.id === 'A').mp, rows.find(r => r.id === 'B').mp);
  assert.equal(T.diff(rows.find(r => r.id === 'A')), T.diff(rows.find(r => r.id === 'B')));
  assert.ok(rows.findIndex(r => r.id === 'A') < rows.findIndex(r => r.id === 'B'));
});
test('05: direkter Vergleich erst bei vollständigem primärem Gleichstand', () => {
  const g = group(['A', 'B', 'C', 'D'], [match('A', 'B', 2, 1), match('A', 'C', 0, 2), match('A', 'D', 1, 2), match('B', 'C', 2, 1), match('B', 'D', 0, 2), match('C', 'D', 2, 0)]);
  const rows = T.standings(g).rows;
  const a = rows.find(r => r.id === 'A'), b = rows.find(r => r.id === 'B');
  assert.equal(a.mp, b.mp); assert.equal(T.diff(a), T.diff(b)); assert.equal(a.legsFor, b.legsFor);
  assert.ok(rows.indexOf(a) < rows.indexOf(b));
});
test('06/07: zyklischer Dreiergleichstand bleibt ungeklärt; keine Namensentscheidung', () => {
  const g = group(['Z', 'A', 'M'], [match('Z', 'A', 2, 0), match('A', 'M', 2, 0), match('M', 'Z', 2, 0)]);
  const table = T.standings(g);
  assert.equal(table.ties.length, 1); assert.equal(table.ties[0].players.length, 3);
  assert.deepEqual(table.rows.map(r => r.place), [1, 1, 1]);
  assert.ok(table.rows.every(r => r.unresolved));
});
test('06: Zweiergleichstand kann durch eigenes Entscheidungsspiel aufgelöst werden', () => {
  const g = group(['A', 'B'], []), day = dayFor([g]);
  const original = T.standings(g, day).rows;
  T.createDecider(day, 'G1', ['A', 'B']);
  const m = g.deciderMatches[0]; Object.assign(m, match('A', 'B', 0, 2), { id: m.id });
  assert.deepEqual(T.standings(g, day).rows.map(r => r.id), ['B', 'A']);
  assert.equal(T.standings(g, day).rows[0].mp, original[0].mp);
});
test('07: auswählbare Entscheidungsliga mit Rückspielen liefert eindeutige Plätze ohne Zusatzpunkte', () => {
  const g = group(['A', 'B', 'C'], [match('A', 'B', 2, 0), match('B', 'C', 2, 0), match('C', 'A', 2, 0)]), day = dayFor([g]);
  T.createDecider(day, g.id, g.players, 'double-round-robin');
  assert.equal(g.deciderMatches.length, 6);
  for (const m of g.deciderMatches) {
    const winner = ['A', 'B', 'C'].indexOf(m.p1) < ['A', 'B', 'C'].indexOf(m.p2) ? m.p1 : m.p2;
    Object.assign(m, { ...match(m.p1, m.p2, winner === m.p1 ? 2 : 0, winner === m.p2 ? 2 : 0) }, { id: m.id, eventId: m.eventId });
  }
  const table = T.standings(g, day);
  assert.deepEqual(table.rows.map(r => r.id), ['A', 'B', 'C']);
  assert.deepEqual(table.rows.map(r => r.mp), [2, 2, 2]); assert.equal(table.ties.length, 0);
});
test('08: Korrektur berechnet sämtliche Punkte und Legs aus den Spielen neu', () => {
  const g = group(['Max', 'Tim'], [match('Max', 'Tim', 2, 1)]), original = dayFor([g]);
  const changed = result(original, g.matches[0].id, 0, 2);
  assert.deepEqual(T.standings(changed.groups[0], changed).rows.map(r => [r.id, r.mp, r.legsFor, r.legsAgainst]), [['Tim', 2, 2, 0], ['Max', 0, 0, 2]]);
  assert.equal(original.groups[0].matches[0].winner, 'Max');
  assert.equal(changed.audit[0].before.matches[0].value.winner, 'Max');
});
test('09/10/11: Gruppenplatz vor absoluten Punkten und Leg-Differenz, auch bei ungleichen Gruppen', () => {
  const a = group(['A1', 'A2', 'A3'], [match('A1', 'A2', 2, 0), match('A1', 'A3', 2, 0), match('A2', 'A3', 2, 0)], 'A');
  const b = group(['B1', 'B2'], [match('B1', 'B2', 10, 0)], 'B');
  const q = T.qualification(dayFor([a, b]));
  assert.deepEqual(q.rows.map(r => r.id), ['A1', 'B1', 'A2', 'B2']);
  assert.equal(q.rows[0].mp, 4); assert.equal(q.rows[1].mp, 2);
});
test('12: gruppenübergreifende Setzgleichstände müssen ausdrücklich geordnet werden', () => {
  const day = dayFor([group(['A', 'B'], [match('A', 'B', 2, 0)], 'A'), group(['C', 'D'], [match('C', 'D', 2, 0)], 'B')]);
  assert.equal(T.qualification(day).seedTies.length, 2);
  assert.throws(() => T.previewFinals(day), /Setzpositionen/);
  T.setManualSeeds(day, 'gold', ['C', 'A', 'D', 'B']); T.previewFinals(day);
  assert.deepEqual(day.finalPreview.gold.attendees, ['C', 'A', 'D', 'B']);
  assert.equal(day.groupPhaseDone, undefined); assert.equal(day.koStartedAt, undefined);
});
test('13: Gold und Silber haben unabhängige Qualifikanten, Überschneidungen werden verhindert', () => {
  const day = dayFor([group(['A', 'B', 'C', 'D'], [match('A', 'B', 2, 0), match('A', 'C', 2, 0), match('A', 'D', 2, 0), match('B', 'C', 2, 0), match('B', 'D', 2, 0), match('C', 'D', 2, 0)])]);
  day.qualificationRules = { gold: [1, 2], silver: [3, 4] };
  assert.deepEqual(T.qualification(day, 'gold').rows.map(r => r.id), ['A', 'B']);
  assert.deepEqual(T.qualification(day, 'silver').rows.map(r => r.id), ['C', 'D']);
  T.previewFinals(day); T.startFinals(day);
  assert.notEqual(day.ko, day.silverKo);
  const silver = T.clone(day.silverKo); T.swapSlots(day, 'gold', day.ko.matches[day.ko.rounds[0]][0].id, 'p1', day.ko.matches[day.ko.rounds[0]][0].id, 'p2');
  assert.deepEqual(day.silverKo, silver);
  day.qualificationRules.silver = [2, 3]; assert.throws(() => T.rules(day), /überschneiden/);
});
test('14/17: Best gegen Schlechtest, 1 und 2 liegen in verschiedenen Hälften', () => {
  const day = directBracket(8), first = day.matches[day.rounds[0]];
  assert.deepEqual(first.map(m => [m.p1, m.p2]), [['P1', 'P8'], ['P4', 'P5'], ['P2', 'P7'], ['P3', 'P6']]);
  const one = first.findIndex(m => m.p1 === 'P1'), two = first.findIndex(m => m.p1 === 'P2');
  assert.notEqual(Math.floor(one / 2), Math.floor(two / 2));
});
test('15: vermeidbare Gruppenduelle werden ohne doppelte Teilnehmer verhindert', () => {
  const seeds = ['A', 'B', 'A', 'B', 'B', 'A', 'B', 'A'].map((g, i) => ({ id: `P${i + 1}`, group: g }));
  assert.equal(seeds[0].group, seeds[7].group); // Strikte Setzung hätte ein Gruppenduell.
  const b = T.makeBracket(seeds), groups = Object.fromEntries(seeds.map(r => [r.id, r.group]));
  const first = b.matches[b.rounds[0]];
  assert.ok(first.every(m => groups[m.p1] !== groups[m.p2]));
  assert.equal(new Set(first.flatMap(m => [m.p1, m.p2])).size, 8);
});
test('16: mathematisch unvermeidbare Gruppenduelle werden zugelassen und angezeigt', () => {
  const b = T.makeBracket(Array.from({ length: 8 }, (_, i) => ({ id: `P${i}`, group: 'A' })));
  assert.equal(b.warnings.length, 4); assert.equal(b.matches[b.rounds[0]].length, 4);
});
test('18: 12 Spieler ergeben vier Freilose für Setzplätze 1 bis 4, ohne gespielte Legs', () => {
  const day = directBracket(12), byes = day.matches[day.rounds[0]].filter(m => m.bye);
  assert.equal(day.size, 16); assert.equal(byes.length, 4);
  assert.deepEqual(byes.map(m => m.winner).sort(), ['P1', 'P2', 'P3', 'P4']);
  assert.ok(byes.every(m => m.legs1 === 0 && m.legs2 === 0 && m.s1 === null));
  const next = day.matches[day.rounds[1]].flatMap(m => [m.p1, m.p2]).filter(Boolean);
  assert.equal(new Set(next).size, 4);
});
test('19/20: manueller Tausch von Spielern und Freilosen erhält alle Teilnehmer', () => {
  let day = directBracket(12);
  const first = day.matches[day.rounds[0]], bye = first.find(m => m.bye), regular = first.find(m => !m.bye);
  day = plan(day, d => T.swapSlots(d, 'main', bye.id, 'p1', regular.id, 'p1')).day;
  const firstAfter = day.matches[day.rounds[0]], ids = firstAfter.flatMap(m => [m.p1, m.p2]).filter(Boolean);
  assert.equal(ids.length, 12); assert.equal(new Set(ids).size, 12);
  assert.equal(firstAfter.find(m => m.id === bye.id).winner, regular.p1);
  assert.ok(!firstAfter.find(m => m.id === regular.id).bye);
  T.validateDay(day);
});
test('21/22: Sieger werden ausschließlich im festen Baum weitergeleitet', () => {
  let day = directBracket(8), first = day.matches[day.rounds[0]], next = day.matches[day.rounds[1]];
  const target = next[0].id, originalSources = T.clone(next.map(m => [m.source1, m.source2]));
  day = result(day, first[0].id, 0, 2);
  assert.equal(day.matches[day.rounds[1]].find(m => m.id === target).p1, 'P8');
  assert.deepEqual(day.matches[day.rounds[1]].map(m => [m.source1, m.source2]), originalSources);
  day = fillBracket(day); assert.ok(T.tournamentComplete(day));
  assert.equal(T.knockoutResults(day).length, 8);
});
test('23/40: Korrektur eines Siegers erhält abgeschlossene Folgeergebnisse und markiert Konflikte', () => {
  let day = fillBracket(directBracket(4)), original = T.clone(day);
  const semi = day.matches.Halbfinale[0], final = day.matches.Finale[0];
  const change = plan(day, d => T.editMatch(d, semi.id, { s1: 0, s2: 2, legs1: 0, legs2: 2, status: 'completed' }));
  day = change.day;
  assert.ok(day.matches.Finale[0].conflict); assert.equal(day.matches.Finale[0].winner, final.winner);
  assert.equal(day.matches.Finale[0].p1, final.p1); assert.equal(day.matches.Finale[0].s1, final.s1);
  assert.ok(change.effects.some(e => e.id === final.id && e.conflict));
  assert.ok(!T.tournamentComplete(day)); assert.deepEqual(original.matches.Finale[0], final);
  const expected = day.matches.Finale[0].conflict.expected;
  day = plan(day, d => T.editMatch(d, final.id, { p1: expected[0], p2: expected[1], status: 'pending' })).day;
  assert.equal(day.matches.Finale[0].conflict, undefined);
  assert.equal(day.matches.Finale[0].completed, false);
  assert.equal(day.audit.length, original.audit.length + 2);
});
test('24–28: vollständiger Rückzug annulliert alle gespielten und offenen Gruppenspiele ohne Ersatzwertung', () => {
  const g = group(['Max', 'Tim', 'Leon', 'Ben'], [match('Max', 'Tim', 2, 1), match('Tim', 'Leon', 2, 0), T.blankMatch('Tim', 'Ben'), match('Max', 'Leon', 2, 0)]);
  const original = dayFor([g]); const day = plan(original, d => T.withdrawPlayer(d, 'Tim')).day;
  assert.equal(day.groups[0].matches.filter(m => m.annulled).length, 3);
  assert.equal(day.groups[0].matches.filter(m => m.walkover).length, 0);
  const table = T.standings(day.groups[0], day);
  assert.deepEqual(table.withdrawn, ['Tim']); assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows.find(r => r.id === 'Max'), { id: 'Max', mp: 2, wins: 1, played: 1, legsFor: 2, legsAgainst: 0, place: 1, unresolved: false });
  assert.equal(table.rows.find(r => r.id === 'Leon').legsFor, 0);
  assert.equal(table.rows.find(r => r.id === 'Ben').mp, 0);
  assert.equal(day.participation.Tim.originals[g.matches[0].id].winner, 'Max');
  assert.equal(day.participation.Tim.nextMatchId, g.matches[2].id);
  assert.equal(original.groups[0].matches[0].annulled, undefined);
});
test('24: Rückzug nach genau einem Spiel streicht Punkte und Legs vollständig', () => {
  const g = group(['A', 'B', 'C'], [match('A', 'B', 2, 0), T.blankMatch('B', 'C')]);
  const day = plan(dayFor([g]), d => T.withdrawPlayer(d, 'B')).day;
  assert.ok(T.standings(day.groups[0], day).rows.every(r => r.mp === 0 && r.legsFor === 0 && r.legsAgainst === 0));
});
test('29: einzelne kampflose Niederlage ergibt 2 Punkte / 2:0, späterer Rückzug streicht sie', () => {
  const g = group(['A', 'B', 'C'], [T.blankMatch('A', 'B'), T.blankMatch('B', 'C')]);
  let day = plan(dayFor([g]), d => T.editMatch(d, g.matches[0].id, { status: 'walkover', winner: 'A' })).day;
  let a = T.standings(day.groups[0], day).rows.find(r => r.id === 'A');
  assert.equal(a.mp, 2); assert.equal(a.legsFor, 2); assert.equal(a.legsAgainst, 0);
  day = plan(day, d => T.withdrawPlayer(d, 'B')).day;
  a = T.standings(day.groups[0], day).rows.find(r => r.id === 'A');
  assert.equal(a.mp, 0); assert.equal(a.legsFor, 0);
});
test('30/38/39: K.-o.-Rückzug führt kampflos weiter, verändert keine gespielten Spiele', () => {
  let day = directBracket(4); const semi = day.matches.Halbfinale[0];
  day = result(day, semi.id); const played = T.clone(day.matches.Halbfinale[0]);
  const other = day.matches.Halbfinale[1]; day = result(day, other.id);
  day = plan(day, d => T.withdrawPlayer(d, played.winner)).day;
  assert.deepEqual(day.matches.Halbfinale[0], played);
  assert.equal(day.matches.Finale[0].walkover, true);
  assert.equal(day.matches.Finale[0].legs1 + day.matches.Finale[0].legs2, 0);
  assert.equal(T.performanceResults(day, [{ id: day.matches.Finale[0].winner }])[0].wins, 1);
  assert.equal(T.reentryAllowed(day, played.winner).allowed, false);
});
test('31/33: Wiedereinstieg vor nächster Wertung stellt die annullierten Ergebnisse wieder her', () => {
  const g = group(['A', 'B', 'C'], [match('A', 'B', 2, 1), T.blankMatch('B', 'C')]);
  let day = plan(dayFor([g]), d => T.withdrawPlayer(d, 'B')).day;
  assert.equal(T.reentryAllowed(day, 'B').allowed, true);
  day = plan(day, d => T.reactivatePlayer(d, 'B')).day;
  assert.equal(day.groups[0].matches[0].winner, 'A'); assert.equal(day.groups[0].matches[0].annulled, undefined);
  assert.equal(T.standings(day.groups[0], day).rows.find(r => r.id === 'A').mp, 2);
  assert.equal(day.participation.B.status, 'active');
});
test('32: Wiedereinstieg nach Wertung oder Phasenwechsel ist gesperrt', () => {
  const g = group(['A', 'B', 'C'], [match('A', 'B', 2, 1), T.blankMatch('B', 'C')]);
  let day = plan(dayFor([g]), d => T.withdrawPlayer(d, 'B')).day;
  day.groups[0].matches[1].completed = true; day.groups[0].matches[1].walkover = true;
  assert.equal(T.reentryAllowed(day, 'B').allowed, false); assert.throws(() => T.reactivatePlayer(day, 'B'));
  day.groups[0].matches[1].completed = false; day.groups[0].matches[1].walkover = false; day.koStartedAt = 'later';
  assert.equal(T.reentryAllowed(day, 'B').allowed, false);
});
test('34–37: nach offiziellem Start wird Statistik neu berechnet, Qualifikation und Baum bleiben eingefroren', () => {
  let day = dayFor([group(['A', 'B'], [match('A', 'B', 2, 0)], 'A'), group(['C', 'D'], [match('C', 'D', 3, 1)], 'B')]);
  for (const key of ['gold', 'silver']) {
    const q = T.qualification(day, key); if (q.seedTies.length) T.setManualSeeds(day, key, q.rows.map(r => r.id));
  }
  T.previewFinals(day); assert.equal(day.qualificationSnapshot, undefined); T.startFinals(day);
  const snapshot = T.clone(day.qualificationSnapshot), tree = T.clone(day.ko);
  const id = day.groups[0].matches[0].id; day = result(day, id, 0, 2);
  assert.equal(T.standings(day.groups[0], day).rows[0].id, 'B');
  assert.deepEqual(day.qualificationSnapshot, snapshot); assert.deepEqual(day.ko, tree);
  assert.ok(T.qualificationDrift(day).includes('gold'));
  assert.throws(() => T.previewFinals(day), /eingefroren/);
});
test('38: Rückzug nach Gruppen-K.-o.-Start erhält die Qualifikationsmomentaufnahme', () => {
  let day = dayFor([group(['A', 'B', 'C'], [match('A', 'B', 2, 0), match('A', 'C', 2, 0), match('B', 'C', 2, 0)])]);
  T.previewFinals(day); T.startFinals(day); const frozen = T.clone(day.qualificationSnapshot);
  day = plan(day, d => T.withdrawPlayer(d, 'A')).day;
  assert.deepEqual(day.qualificationSnapshot, frozen);
  assert.equal(day.ko.matches.Finale[0].walkover, true);
  assert.ok(T.qualificationDrift(day).includes('gold'));
});
test('End-to-end: zwei Gruppen, Gold/Silber, Vorschautausch, Starts, Ergebnisse und nachträgliche Korrektur', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `P${i + 1}`);
  let day = { id: 'flow', engine: 'groups', mode: 'groupsko', attendees: ids, groupCount: 2,
    groupDrawMode: 'manual', groupAssignments: Object.fromEntries(ids.map((id, i) => [id, i < 4 ? 0 : 1])),
    qualificationRules: { gold: [1, 2], silver: [3, 4] }, groupFormat: { format: 'legs' } };
  T.setupGroups(day);
  for (const g of day.groups) for (const m of g.matches) day = result(day, m.id, Number(m.p1.slice(1)) < Number(m.p2.slice(1)) ? 2 : 0, Number(m.p1.slice(1)) < Number(m.p2.slice(1)) ? 0 : 2);
  for (const key of ['gold', 'silver']) T.setManualSeeds(day, key, T.qualification(day, key).rows.map(r => r.id));
  T.previewFinals(day);
  const preview = day.finalPreview.gold, first = preview.matches[preview.rounds[0]];
  T.swapSlots(day, 'previewGold', first[0].id, 'p2', first[1].id, 'p2');
  assert.equal(day.koStartedAt, undefined); T.startFinals(day);
  day = fillBracket(day, 'gold'); const gold = T.clone(day.ko); day = fillBracket(day, 'silver', true);
  assert.deepEqual(day.ko, gold); assert.equal(T.tournamentComplete(day), true);
  const results = T.groupResults(day); assert.equal(results.length, 8); assert.equal(new Set(results.map(r => r.id)).size, 8);
  const silver = T.clone(day.silverKo), snapshot = T.clone(day.qualificationSnapshot);
  const target = day.groups[0].matches[0]; day = result(day, target.id, target.s2, target.s1);
  assert.deepEqual(day.ko, gold); assert.deepEqual(day.silverKo, silver); assert.deepEqual(day.qualificationSnapshot, snapshot);
  const firstGold = day.ko.matches[day.ko.rounds[0]][0]; day = result(day, firstGold.id, firstGold.s2, firstGold.s1);
  assert.ok(day.ko.matches.Finale[0].conflict); assert.equal(T.tournamentComplete(day), false);
});
test('Ungültige Resultate, doppelte Spieler und unbestätigte Planschritte ändern die Quelle nicht', () => {
  const day = directBracket(4), id = day.matches.Halbfinale[0].id;
  for (const [a, b] of [[1, 1], [-1, 2], [0.5, 2], [NaN, 2]]) assert.throws(() => result(day, id, a, b));
  assert.equal(day.matches.Halbfinale[0].completed, false);
  assert.throws(() => plan(day, d => T.editMatch(d, id, { p1: 'P1', p2: 'P1', status: 'pending' })));
  const prepared = plan(day, d => T.editMatch(d, id, { s1: 2, s2: 0, legs1: 2, legs2: 0, status: 'completed' }));
  assert.equal(prepared.day.matches.Halbfinale[0].completed, true); assert.equal(day.matches.Halbfinale[0].completed, false);
});
test('Entscheidung wird nach regulärer Ergebniskorrektur ungültig', () => {
  const g = group(['A', 'B', 'C'], [match('A', 'B', 2, 0), match('B', 'C', 2, 0), match('C', 'A', 2, 0)]), day = dayFor([g]);
  T.createDecider(day, g.id, g.players);
  const signature = g.deciders[0].signature;
  const changed = result(day, g.matches[0].id, 3, 0);
  assert.notEqual(T.groupSignature(changed.groups[0], changed), signature);
});
test('Alte gespeicherte Bäume werden verlustfrei eingelesen, ohne Neu-Auslosung', () => {
  const day = directBracket(4); delete day.schemaVersion; delete day.bracketStartedAt;
  for (const m of T.bracketMatches(day)) { delete m.source1; delete m.source2; }
  const old = T.clone(day.matches); T.normalizeDay(day);
  assert.equal(day.bracketStartedAt, 'legacy');
  assert.deepEqual(day.matches.Halbfinale, old.Halbfinale);
  assert.equal(day.matches.Finale[0].source1.matchId, old.Halbfinale[0].id);
});
test('Rückzüge beider Gegner und späterer Wiedereinstieg stellen nur gültige Ergebnisse her', () => {
  let day = dayFor([group(['A', 'B', 'C', 'D'], [match('A', 'B', 2, 1), T.blankMatch('A', 'C'), T.blankMatch('B', 'D')])]);
  day = plan(day, d => T.withdrawPlayer(d, 'A')).day;
  day = plan(day, d => T.withdrawPlayer(d, 'B')).day;
  day = plan(day, d => T.reactivatePlayer(d, 'A')).day;
  assert.equal(day.groups[0].matches[0].annulled, true);
  day = plan(day, d => T.reactivatePlayer(d, 'B')).day;
  assert.equal(day.groups[0].matches[0].winner, 'A'); assert.equal(day.groups[0].matches[0].annulled, undefined);
});

function storeFixture() {
  let remote = { revision: 0, current: { id: 'day' } }, member = { rolle: 'admin', aktiv: true }, writes = 0;
  let local = T.clone(remote);
  const doc = value => ({ exists: () => value !== null, data: () => T.clone(value) });
  const writer = createTournamentWriter({ db: {}, ref: 'state', getState: () => local, setState: s => { local = s; }, getActor: () => 'admin', roles: ['admin'],
    memberRef: () => 'member', runTransaction: async (_, fn) => fn({ get: async ref => doc(ref === 'state' ? remote : member),
      set: (_, value) => { remote = T.clone(value); writes++; } }), getDoc: async () => doc(remote), serverTimestamp: () => 'timestamp', render: () => {}, notify: () => {} });
  writer.loaded(remote);
  return { writer, change: f => f(local), remote: () => T.clone(remote), overwrite: value => { remote = value; }, role: value => { member = value; }, writes: () => writes };
}
test('Firestore-Transaktionsadapter: Revision wird atomar erhöht', async () => {
  const fixture = storeFixture(); fixture.change(s => { s.current.title = 'Änderung'; });
  await fixture.writer.save(); assert.equal(fixture.remote().revision, 1); assert.equal(fixture.remote().current.title, 'Änderung');
});
test('Firestore-Transaktionsadapter: paralleler Admin / Legacy-Client kann nicht überschrieben werden', async () => {
  const fixture = storeFixture(); fixture.overwrite({ revision: 0, current: { id: 'day', title: 'Anderer Admin' } });
  await assert.rejects(fixture.writer.save(), /anderer Administrator/); assert.equal(fixture.writes(), 0);
  assert.equal(fixture.remote().current.title, 'Anderer Admin');
});
test('Firestore-Transaktionsadapter: entzogene Berechtigung verhindert Schreiben', async () => {
  const fixture = storeFixture(); fixture.role({ rolle: 'gast', aktiv: true });
  await assert.rejects(fixture.writer.save(), /Verwaltungsberechtigung/); assert.equal(fixture.writes(), 0);
});
test('kanonischer Vergleich ignoriert Feldreihenfolge, erkennt tatsächliche Änderungen', () => {
  assert.equal(canonical({ b: 2, a: [1] }), canonical({ a: [1], b: 2 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});
test('Ein einzelner Qualifikant erhält einen dokumentierten Freilos-Sieg ohne Leistungsstatistik', () => {
  const day = dayFor([group(['A', 'B'], [match('A', 'B', 2, 0)])]);
  day.qualifyPlaces = [1]; T.previewFinals(day); T.startFinals(day);
  assert.equal(day.ko.matches.Finale[0].bye, true); assert.equal(day.ko.matches.Finale[0].winner, 'A');
  assert.equal(T.tournamentComplete(day), true);
  assert.equal(T.groupResults(day).find(r => r.id === 'A').wins, 1); // Nur der reguläre Gruppensieg.
});
test('Zurücksetzen einer Rückzugswertung erlaubt keinen nachträglichen automatischen Wiedereinstieg', () => {
  const original = directBracket(4), player = original.matches.Halbfinale[0].p1;
  let day = plan(original, d => T.withdrawPlayer(d, player)).day;
  const next = day.participation[player].nextMatchId;
  day = plan(day, d => T.editMatch(d, next, { status: 'pending' })).day;
  assert.equal(T.matchEntries(day).find(e => e.match.id === next).match.completed, false);
  assert.equal(T.reentryAllowed(day, player).allowed, false);
});
test('Feste Turnierbäume mit 2 bis 40 Teilnehmern: jeder Spieler genau einmal, vollständiger Abschluss', () => {
  for (let count = 2; count <= 40; count++) {
    let day = directBracket(count);
    T.validateDay(day);
    day = fillBracket(day);
    assert.equal(T.tournamentComplete(day), true, `Abschluss bei ${count} Teilnehmern`);
    assert.equal(T.knockoutResults(day).length, count);
  }
});
test('Manueller Paarungstausch nach gespieltem Finale bewahrt Originalteilnehmer und Ergebnisse als Konflikte', () => {
  const original = fillBracket(directBracket(4)), first = original.matches.Halbfinale;
  const changed = plan(original, d => T.swapSlots(d, 'main', first[0].id, 'p1', first[1].id, 'p1'));
  const semi = changed.day.matches.Halbfinale[0];
  assert.deepEqual([semi.p1, semi.p2, semi.s1, semi.s2], [first[0].p1, first[0].p2, first[0].s1, first[0].s2]);
  assert.ok(semi.conflict); assert.ok(changed.day.matches.Finale[0].conflict);
  assert.ok(changed.effects.filter(e => e.conflict).length >= 3);
});
test('Noch offene Gruppenspiele verhindern vorzeitige Entscheidungsspiele', () => {
  const g = group(['A', 'B', 'C'], T.roundRobinMatches(['A', 'B', 'C'])), day = dayFor([g]);
  assert.equal(T.groupDone(g, day), false);
  assert.equal(T.standings(g, day).ties.length, 1);
  assert.throws(() => T.createDecider(day, g.id, g.players), /erst nach Abschluss/);
  assert.equal(g.deciderMatches, undefined);
});
function orderedGroupDay() {
  const ids = ['A', 'B', 'C', 'D'];
  const g = group(ids, ids.flatMap((a, i) => ids.slice(i + 1).map(b => match(a, b, 2, 0))));
  return { ...dayFor([g]), qualificationRules: { gold: [1, 2], silver: [3, 4] } };
}
test('Gruppenplätze werden entsprechend den konfigurierten Gold-/Silberregeln markiert', () => {
  const day = orderedGroupDay(), g = day.groups[0], table = T.standings(g, day);
  assert.deepEqual(table.rows.map(r => T.groupProgression(day, g, r, table).kind), ['gold', 'gold', 'silver', 'silver']);
  assert.ok(table.rows.every(r => !T.groupProgression(day, g, r, table).provisional));
});
test('Eine einzelne K.-o.-Endrunde nutzt für alle Weiterkommer dieselbe Markierung', () => {
  const day = orderedGroupDay(); day.qualificationRules = { gold: [1, 2], silver: [] };
  const g = day.groups[0], table = T.standings(g, day);
  assert.deepEqual(table.rows.map(r => T.groupProgression(day, g, r, table)?.kind || null), ['ko', 'ko', null, null]);
});
test('Gleichstände über einer Gold-/Silbergrenze werden nicht willkürlich eingefärbt', () => {
  const day = dayFor([group(['A', 'B'], [T.blankMatch('A', 'B')])]);
  day.qualificationRules = { gold: [1], silver: [2] };
  const g = day.groups[0], table = T.standings(g, day);
  assert.ok(table.rows.every(r => T.groupProgression(day, g, r, table).kind === 'unresolved'));
  day.qualificationRules = { gold: [1, 2], silver: [] };
  assert.ok(table.rows.every(r => T.groupProgression(day, g, r, table).kind === 'ko'));
});
test('Markierungen folgen nach Endrundenstart der eingefrorenen Qualifikation und schließen Rückzüge aus', () => {
  let day = orderedGroupDay(); T.previewFinals(day); T.startFinals(day);
  const games = day.groups[0].matches.filter(m => m.p1 === 'A');
  for (const m of games) day = result(day, m.id, 0, 2);
  const g = day.groups[0], table = T.standings(g, day), a = table.rows.find(r => r.id === 'A');
  assert.equal(a.place, 4); assert.equal(T.groupProgression(day, g, a, table).kind, 'gold');
  day.participation.A = { status: 'withdrawn' };
  assert.equal(T.groupProgression(day, g, a, table), null);
});
