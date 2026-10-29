import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as Tournament from '../tournament-engine.js';
import { refreshDouble, recomputeDoubleStats } from '../tournament-double.js';
import { createTournamentWriter } from '../tournament-persistence.js';

// Die echten bestehenden App-Fabriken werden geladen. Nur DOM und Firebase-I/O
// werden ersetzt; keine Kopie oder alternative Implementierung der Turniermodi.
function app(file) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').split('// ---------- Events ----------')[0];
  const context = {
    Tournament, refreshDouble, recomputeDoubleStats, createTournamentWriter,
    renderTournamentAdmin() {}, confirmPlan: async () => true,
    crypto, structuredClone, console, setTimeout, clearTimeout,
    db: {}, doc: () => ({}), getLogin: () => ({ benutzername: 'admin', rolle: 'admin' }),
    getDoc: async () => ({ exists: () => false }), serverTimestamp: () => 'now', runTransaction() {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }
  };
  vm.runInNewContext(`${source}\nglobalThis.api = { makeDoubleKO, makeSwiss, pairSwissRound, swissStats,
    makeGroupsKO, makeSingleElimination, continueCompletedDoubleKORounds, doubleKOResults,
    setCurrent(day) { state.current = day; } };`, context, { filename: file });
  return context.api;
}
function change(day, id, reverse = false) {
  return Tournament.planChange(day, 'Integrationsergebnis', 'admin', d => Tournament.editMatch(d, id, {
    s1: reverse ? 0 : 2, s2: reverse ? 2 : 0, legs1: reverse ? 0 : 2, legs2: reverse ? 2 : 0, status: 'completed'
  }), refreshDouble).day;
}
for (const file of ['vereinsserie.js', 'vereinsspieltag.js']) {
  test(`${file}: bestehende Gruppenfabrik unterstützt 1 bis 8 Gruppen und vollständigen Spielplan`, () => {
    const api = app(file);
    for (let n = 1; n <= 8; n++) {
      const ids = Array.from({ length: n * 3 }, (_, i) => `P${i}`);
      const day = api.makeGroupsKO(ids, { groupCount: n, groupDrawMode: 'random', qualificationRules: { gold: [1], silver: [2] } });
      assert.equal(day.groups.length, n);
      assert.ok(day.groups.every(g => g.matches.length === 3));
      assert.equal(new Set(day.groups.flatMap(g => g.players)).size, ids.length);
      assert.deepEqual(day.qualificationRules, { gold: [1], silver: [2] });
    }
  });
  test(`${file}: manuelle Gruppenzuordnung verwendet stabile IDs`, () => {
    const api = app(file), ids = ['A', 'B', 'C', 'D'];
    const day = api.makeGroupsKO(ids, { groupCount: 2, groupDrawMode: 'manual', groupAssignments: { A: 0, B: 1, C: 0, D: 1 } });
    assert.deepEqual(Array.from(day.groups[0].players), ['A', 'C']);
    assert.deepEqual(Array.from(day.groups[1].players), ['B', 'D']);
  });
  test(`${file}: Schweizer System spielt mehrere Runden ohne Regression`, () => {
    const api = app(file), ids = ['A', 'B', 'C', 'D', 'E'];
    let day = { id: 'swiss', mode: 'swiss', ...api.makeSwiss(ids, 3) };
    for (let round = 0; round < 3; round++) {
      for (const m of day.swissRoundsData.at(-1).filter(m => !m.bye)) day = change(day, m.id);
      const table = api.swissStats(day);
      assert.equal(table.length, 5);
      if (round < 2) api.pairSwissRound(day);
    }
    assert.equal(day.swissRoundsData.length, 3);
    assert.equal(Tournament.tournamentComplete(day), true);
  });
}

test('bestehender fester Doppel-K.-o.-Baum: Gewinnerbaum, Verliererbaum und Final-Reset', () => {
  const api = app('vereinsserie.js'), ids = ['A', 'B', 'C', 'D'];
  let day = { id: 'de', attendees: ids, mode: 'doubleko', ...api.makeDoubleKO(ids, 4), bracketStartedAt: 'started' };
  let count = 0;
  while (!day.de.champion && count++ < 30) {
    const open = Tournament.matchEntries(day).find(e => !Tournament.finished(e.match) && e.match.p1 && e.match.p2);
    assert.ok(open, 'Der Doppel-K.-o.-Baum muss ein spielbares nächstes Match anbieten.');
    const gf = open.match.id === day.de.grandFinal.id;
    // Grand Final verliert der WB-Sieger: zwingend ein Reset.
    const reverse = gf ? open.match.p1 === day.de.wbRounds.at(-1).matches[0].winner : false;
    day = change(day, open.match.id, reverse);
  }
  assert.ok(day.de.resetFinal?.completed); assert.ok(day.de.champion); assert.equal(count, 7);
  assert.equal(Object.values(day.de.losses).filter(n => n === 2).length, 3);
  assert.equal(Tournament.tournamentComplete(day), true);
  const reset = Tournament.clone(day.de.resetFinal), first = day.de.wbRounds[0].matches[0];
  day = change(day, first.id, first.s1 > first.s2);
  assert.ok(Tournament.matchEntries(day).some(e => e.match.conflict));
  assert.equal(day.de.resetFinal.id, reset.id); assert.equal(day.de.resetFinal.s1, reset.s1);
  assert.equal(Tournament.tournamentComplete(day), false);
});
test('Doppel-K.-o.-Korrektur des Grand Final löscht kein vorhandenes Reset-Ergebnis', () => {
  const api = app('vereinsserie.js'), ids = ['A', 'B', 'C', 'D'];
  let day = { id: 'de', attendees: ids, ...api.makeDoubleKO(ids, 4), bracketStartedAt: 'started' };
  for (let i = 0; i < 20 && !day.de.resetFinal?.completed; i++) {
    const open = Tournament.matchEntries(day).find(e => !Tournament.finished(e.match) && e.match.p1 && e.match.p2);
    day = change(day, open.match.id, open.match.id === day.de.grandFinal.id);
  }
  const reset = Tournament.clone(day.de.resetFinal);
  day = change(day, day.de.grandFinal.id, false);
  assert.equal(day.de.resetFinal.id, reset.id); assert.equal(day.de.resetFinal.completed, true);
  assert.equal(day.de.resetFinal.s1, reset.s1); assert.ok(day.de.resetFinal.conflict);
});
test('Doppel-K.-o. mit 5/12/17 Spielern: Freilose ohne erfundene Legs und vollständiger Ablauf', () => {
  const api = app('vereinsserie.js');
  for (const count of [5, 12, 17]) {
    const ids = Array.from({ length: count }, (_, i) => `P${i}`);
    let day = { id: 'de', attendees: ids, ...api.makeDoubleKO(ids), bracketStartedAt: 'started' };
    assert.ok(Tournament.matchEntries(day).filter(e => e.match.bye).every(e => e.match.legs1 + e.match.legs2 === 0));
    let guard = 0;
    while (!day.de.champion && guard++ < 80) {
      const open = Tournament.matchEntries(day).find(e => !Tournament.finished(e.match) && e.match.p1 && e.match.p2);
      assert.ok(open, `Spielbarer Doppel-K.-o.-Baum bei ${count} Teilnehmern`);
      day = change(day, open.match.id);
    }
    assert.ok(day.de.champion); Tournament.validateDay(day);
  }
});
test('historischer dynamischer Doppel-K.-o.-Modus bleibt spielbar; Korrektur markiert Folgerunden', () => {
  const api = app('vereinsspieltag.js'), ids = ['A', 'B', 'C', 'D'];
  let day = { id: 'legacy-de', attendees: ids, ...api.makeDoubleKO(ids), bracketStartedAt: 'started' };
  let guard = 0;
  while (!day.de.champion && guard++ < 30) {
    const round = day.de.rounds.at(-1);
    for (const m of round.matches.filter(m => !m.completed && m.p1 && m.p2)) day = change(day, m.id);
    api.continueCompletedDoubleKORounds(day);
  }
  assert.ok(day.de.champion); assert.ok(day.de.rounds.length > 1);
  const first = day.de.rounds[0].matches[0], later = Tournament.clone(day.de.rounds[1]);
  day = change(day, first.id, first.s1 > first.s2);
  assert.ok(day.de.rounds[1].matches.every(m => m.conflict));
  assert.equal(day.de.rounds[1].matches[0].s1, later.matches[0].s1);
});
test('Doppel-K.-o.: manueller Freilos-/Spielertausch erhält die erste Runde und aktualisiert Quellen', () => {
  const api = app('vereinsserie.js'), ids = ['A', 'B', 'C', 'D', 'E'];
  let day = { id: 'de', attendees: ids, ...api.makeDoubleKO(ids), bracketStartedAt: 'started' };
  const first = day.de.wbRounds[0].matches;
  day = Tournament.planChange(day, 'Tausch', 'admin', d => Tournament.swapSlots(d, 'doubleko', first[0].id, 'p1', first[1].id, 'p1'), refreshDouble).day;
  const players = day.de.wbRounds[0].matches.flatMap(m => [m.p1, m.p2]).filter(Boolean);
  assert.equal(players.length, 5); assert.equal(new Set(players).size, 5); Tournament.validateDay(day);
});
