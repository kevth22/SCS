import { blankMatch, finished, scored } from './tournament-engine.js';

export function doubleMatches(day) {
  const de = day.de;
  return de?.wbRounds ? [...de.wbRounds, ...de.lbRounds].flatMap(r => r.matches).concat([de.grandFinal, de.resetFinal].filter(Boolean)) : (de?.rounds || []).flatMap(r => r.matches);
}
export function refreshDouble(day) {
  if (!day.de) return;
  const de = day.de;
  if (de.wbRounds) {
    const all = doubleMatches(day), byId = Object.fromEntries(all.map(m => [m.id, m]));
    for (const m of all) {
      const source = (s, p) => s ? { ready: finished(byId[s.matchId] || {}) && !byId[s.matchId]?.conflict,
        player: scored(byId[s.matchId] || {}) ? byId[s.matchId][s.outcome || 'winner'] || null : null } : { ready: true, player: p };
      const a = source(m.source1, m.p1), b = source(m.source2, m.p2);
      if (m.conflict) {
        if (a.ready && b.ready && (m.source1 || m.source2)) m.conflict.expected = [a.player, b.player];
        continue;
      }
      if (m.p1 !== a.player || m.p2 !== b.player) {
        if (m.completed && !m.bye || m.status === 'live' || m.annulled) {
          m.conflict = { reason: 'Gewinner-/Verliererquelle wurde korrigiert.', expected: [a.player, b.player] };
          continue;
        }
        Object.assign(m, { p1: a.player, p2: b.player, completed: false, bye: false, winner: null, loser: null, s1: null, s2: null, legs1: 0, legs2: 0, status: 'pending' });
      }
      if (a.ready && b.ready && !m.completed && !m.annulled && (!m.p1 || !m.p2)) {
        Object.assign(m, { bye: true, completed: true, winner: m.p1 || m.p2 || null, loser: null,
          s1: null, s2: null, legs1: 0, legs2: 0, status: 'bye' });
      }
    }
    const gf = de.grandFinal, wbWinner = de.wbRounds.at(-1).matches[0].winner;
    de.champion = null;
    const resetNeeded = scored(gf) && !gf.bye && gf.winner !== wbWinner;
    if (resetNeeded) {
      if (!de.resetFinal) de.resetFinal = blankMatch(gf.p1, gf.p2, { bracket: 'reset', roundIndex: 0, index: 0,
        source1: { matchId: gf.id, outcome: 'loser' }, source2: { matchId: gf.id, outcome: 'winner' } });
      // Teilnehmerreihenfolge des ursprünglichen Reset-Finales bleibt erhalten.
      if (!de.resetFinal.source1) {
        if (![gf.p1, gf.p2].includes(de.resetFinal.p1) || ![gf.p1, gf.p2].includes(de.resetFinal.p2)) de.resetFinal.conflict = { reason: 'Finalteilnehmer haben sich geändert.', expected: [gf.p1, gf.p2] };
      }
      if (scored(de.resetFinal)) de.champion = de.resetFinal.winner;
    } else if (de.resetFinal) {
      // Ein vorhandenes Reset-Ergebnis niemals löschen.
      de.resetFinal.conflict = { reason: 'Nach Korrektur ist dieses Reset-Finale nicht mehr vorgesehen. Administrativ annullieren.' };
      if (de.resetFinal.annulled) { delete de.resetFinal.conflict; if (scored(gf)) de.champion = gf.winner; }
    } else if (scored(gf)) de.champion = gf.winner;
  }
  recomputeDoubleStats(day);
  if (doubleMatches(day).some(m => m.conflict)) de.champion = null;
}
export function recomputeDoubleStats(day) {
  const de = day.de, ids = day.attendees || Object.keys(de.losses || {});
  const stats = Object.fromEntries(ids.map(id => [id, { id, wins: 0, legsFor: 0, legsAgainst: 0, eliminatedAt: null }]));
  const losses = Object.fromEntries(ids.map(id => [id, 0]));
  const matches = doubleMatches(day).filter(m => scored(m) && !m.bye && m.winner && m.loser && m.p1 && m.p2);
  for (const [i, m] of matches.entries()) {
    if (!stats[m.winner] || !stats[m.loser]) continue;
    losses[m.loser]++;
    if (!m.walkover) {
      stats[m.winner].wins++;
      stats[m.p1].legsFor += m.legs1 ?? m.s1 ?? 0; stats[m.p1].legsAgainst += m.legs2 ?? m.s2 ?? 0;
      stats[m.p2].legsFor += m.legs2 ?? m.s2 ?? 0; stats[m.p2].legsAgainst += m.legs1 ?? m.s1 ?? 0;
    }
    if (losses[m.loser] >= 2) stats[m.loser].eliminatedAt = i + 1;
  }
  de.losses = losses; de.stats = stats;
  if (!de.wbRounds) {
    de.played = matches.map(m => [m.p1, m.p2]);
    const alive = ids.filter(id => losses[id] < 2);
    de.champion = alive.length === 1 ? alive[0] : null;
    de.phase = matches.some(m => m.grandFinal) && alive.length === 2 ? 'reset' : 'normal';
  }
}
