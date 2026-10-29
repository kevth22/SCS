// Gemeinsame Turnierlogik für beide bestehenden Firestore-Turnieransichten.
// Keine gespeicherten Tabellen: ausschließlich die Begegnungen werden gewertet.
export const clone = value => structuredClone(value);
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const fail = message => { throw new Error(message); };
const unique = ids => new Set(ids).size === ids.length;
const integer = n => Number.isSafeInteger(n) && n >= 0;
export const diff = row => row.legsFor - row.legsAgainst;
export const withdrawn = (day, id) => day.participation?.[id]?.status === 'withdrawn';
export const scored = m => Boolean(m.completed && !m.annulled && !m.conflict && m.status !== 'void');
export const finished = m => Boolean(m.annulled || m.status === 'void' || scored(m));
const competitive = m => scored(m) && !m.bye && m.p1 && m.p2 && m.p1 !== m.p2;
export function legs(m) {
  // Nullish fallback: ausdrücklich gespeicherte 0 Legs sind keine fehlenden Daten.
  return [m.legs1 ?? m.s1 ?? 0, m.legs2 ?? m.s2 ?? 0];
}
function row(id) { return { id, mp: 0, wins: 0, played: 0, legsFor: 0, legsAgainst: 0 }; }
function tally(ids, matches) {
  const rows = Object.fromEntries(ids.map(id => [id, row(id)]));
  for (const m of matches) {
    if (!competitive(m) || !rows[m.p1] || !rows[m.p2]) continue;
    // Historisch widersprüchliche Sieger werden nicht als zwei Siege gewertet.
    const winner = m.s1 > m.s2 ? m.p1 : m.s2 > m.s1 ? m.p2 : null;
    if (!winner || (m.winner && winner !== m.winner)) continue;
    const [a, b] = legs(m);
    if (!integer(a) || !integer(b)) continue;
    rows[m.p1].legsFor += a; rows[m.p1].legsAgainst += b; rows[m.p1].played++;
    rows[m.p2].legsFor += b; rows[m.p2].legsAgainst += a; rows[m.p2].played++;
    rows[winner].mp += 2; rows[winner].wins++;
  }
  return Object.values(rows);
}
const compareStats = (a, b) => b.mp - a.mp || diff(b) - diff(a) || b.legsFor - a.legsFor;
function buckets(rows, compare) {
  const sorted = [...rows].sort(compare), result = [];
  for (const r of sorted) {
    const last = result.at(-1);
    if (last && compare(last[0], r) === 0) last.push(r); else result.push([r]);
  }
  return result;
}
function completeRobin(ids, matches) {
  return ids.every((a, i) => ids.slice(i + 1).every(b => matches.some(m => competitive(m) &&
    ((m.p1 === a && m.p2 === b) || (m.p1 === b && m.p2 === a)))));
}
export function standings(group, day = {}) {
  const ids = group.players.filter(id => !withdrawn(day, id));
  const regular = (group.matches || []).filter(m => !m.tieBreak);
  const primary = buckets(tally(ids, regular), compareStats);
  const ordered = [], ties = [];
  for (const cohort of primary) {
    let parts = [cohort];
    if (cohort.length > 1) {
      const set = new Set(cohort.map(r => r.id));
      const direct = regular.filter(m => set.has(m.p1) && set.has(m.p2));
      if (completeRobin([...set], direct)) {
        const mini = Object.fromEntries(tally([...set], direct).map(r => [r.id, r]));
        parts = buckets(cohort, (a, b) => compareStats(mini[a.id], mini[b.id]));
      }
    }
    for (const part of parts) {
      let resolved = [part];
      if (part.length > 1) {
        const participantIds = part.map(r => r.id);
        // Entscheidungen gelten nur für genau diesen Gleichstand und Quellstand.
        const event = (group.deciders || []).find(e =>
          e.signature === groupSignature(group, day) && e.players.length === part.length &&
          e.players.every(id => participantIds.includes(id)));
        if (event) {
          const matches = (group.deciderMatches || []).filter(m => m.eventId === event.id);
          if (matches.every(finished) && completeRobin(participantIds, matches)) {
            const mini = Object.fromEntries(tally(participantIds, matches).map(r => [r.id, r]));
            resolved = buckets(part, (a, b) => compareStats(mini[a.id], mini[b.id]));
          }
        }
      }
      for (const pending of resolved) {
        const place = ordered.length + 1;
        if (pending.length > 1) ties.push({ players: pending.map(r => r.id), place, endPlace: place + pending.length - 1 });
        ordered.push(...pending.map(r => ({ ...r, place, unresolved: pending.length > 1 })));
      }
    }
  }
  return { rows: ordered, ties, withdrawn: group.players.filter(id => withdrawn(day, id)) };
}
export function groupSignature(group, day) {
  return JSON.stringify({ players: group.players.filter(id => !withdrawn(day, id)),
    matches: (group.matches || []).map(m => [m.id, m.p1, m.p2, m.s1, m.s2, m.legs1, m.legs2, m.completed, !!m.annulled, m.status, m.winner, !!m.conflict]) });
}
export function groupDone(group, day = {}) {
  return (group.matches || []).every(m => finished(m) || withdrawn(day, m.p1) || withdrawn(day, m.p2));
}
export function allGroupsDone(day) {
  return (day.groups || []).every(g => groupDone(g, day));
}
export function rules(day) {
  const result = day.qualificationRules || { gold: day.qualifyPlaces ?? [1, 2], silver: [] };
  const all = [...result.gold, ...result.silver];
  if (!unique(all) || all.some(p => !Number.isInteger(p) || p < 1)) fail('Qualifikationsplätze müssen eindeutig und positiv sein. Gold und Silber dürfen sich nicht überschneiden.');
  return result;
}
const seedCompare = (a, b) => a.place - b.place || b.mp - a.mp || diff(b) - diff(a);
export function qualification(day, division = 'gold') {
  const places = rules(day)[division] || [];
  const rows = [], unresolved = [];
  for (const group of day.groups || []) {
    const table = standings(group, day);
    for (const tie of table.ties) {
      if (places.some(p => p >= tie.place && p <= tie.endPlace)) unresolved.push({ ...tie, group: group.id });
    }
    rows.push(...table.rows.filter(r => places.includes(r.place)).map(r => ({ ...r, group: group.id, division })));
  }
  const sorted = [...rows].sort(seedCompare);
  const seedTies = buckets(sorted, seedCompare).filter(b => b.length > 1).map(b => b.map(r => r.id));
  const signature = JSON.stringify(sorted.map(r => [r.id, r.group, r.place, r.mp, diff(r)]));
  const manual = day.manualSeeds?.[division];
  const validManual = manual?.signature === signature && manual.ids.length === sorted.length &&
    unique(manual.ids) && manual.ids.every(id => sorted.some(r => r.id === id));
  const ordered = validManual ? manual.ids.map(id => sorted.find(r => r.id === id)) : sorted;
  return { rows: ordered.map((r, i) => ({ ...r, seed: i + 1 })), unresolved, seedTies: validManual ? [] : seedTies, signature };
}
export function setManualSeeds(day, division, ids) {
  const q = qualification(day, division);
  if (!unique(ids) || ids.length !== q.rows.length || ids.some(id => !q.rows.some(r => r.id === id))) fail('Die Setzliste muss jeden Qualifikanten genau einmal enthalten.');
  day.manualSeeds ||= {};
  day.manualSeeds[division] = { ids: [...ids], signature: q.signature };
  day.finalPreview = null;
}
export function roundNames(size) {
  const names = [];
  for (let n = size; n >= 2; n /= 2) names.push(n === 2 ? 'Finale' : n === 4 ? 'Halbfinale' : n === 8 ? 'Viertelfinale' : n === 16 ? 'Achtelfinale' : `Runde der ${n}`);
  return names;
}
export function seedPositions(size) {
  let order = [1, 2];
  for (let n = 4; n <= size; n *= 2) order = order.flatMap(i => [i, n + 1 - i]);
  return order;
}
// Minimale Kosten für die Zuordnung der unteren Hälfte. Gruppenwiederholungen
// sind teurer als die Summe aller möglichen Setzabweichungen (Hungarian algorithm).
function assignment(cost) {
  const n = cost.length, u = Array(n + 1).fill(0), v = [...u], p = [...u], way = [...u];
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const min = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < min[j]) { min[j] = cur; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta;
      j0 = j1;
    } while (p[j0]);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = Array(n); for (let j = 1; j <= n; j++) result[p[j] - 1] = j - 1;
  return result;
}
export function blankMatch(p1 = null, p2 = null, extra = {}) {
  return { id: uuid(), p1, p2, s1: null, s2: null, legs1: 0, legs2: 0, winner: null,
    loser: null, completed: false, bye: false, status: 'pending', ...extra };
}
export function roundRobinMatches(players) {
  const rotation = [...players];
  if (rotation.length % 2) rotation.push(null);
  const matches = [];
  for (let round = 1; round < rotation.length; round++) {
    for (let i = 0; i < rotation.length / 2; i++) {
      const a = rotation[i], b = rotation[rotation.length - 1 - i];
      if (a && b) matches.push(blankMatch(a, b, { groupRound: round }));
    }
    rotation.splice(1, 0, rotation.pop());
  }
  return matches;
}
export function setupGroups(day, orderedPlayers = day.attendees) {
  const count = day.groupCount === 'auto' ? Math.min(8, Math.max(1, Math.ceil(day.attendees.length / 5))) : Number(day.groupCount);
  if (!Number.isInteger(count) || count < 1 || count > 8 || count > day.attendees.length) fail('Bitte 1 bis 8 Gruppen auswählen.');
  if (!unique(day.attendees)) fail('Doppelte Turnierteilnehmer.');
  const groups = Array.from({ length: count }, (_, i) => ({ id: `G${i + 1}`, name: `Gruppe ${String.fromCharCode(65 + i)}`, players: [], matches: [] }));
  orderedPlayers.forEach((id, i) => {
    const target = day.groupDrawMode === 'manual' ? Number(day.groupAssignments?.[id]) :
      Math.floor(i / count) % 2 ? count - 1 - i % count : i % count;
    if (!Number.isInteger(target) || target < 0 || target >= count) fail('Jedem Spieler eine gültige Gruppe zuweisen.');
    groups[target].players.push(id);
  });
  if (groups.some(g => !g.players.length)) fail('Leere Gruppen sind nicht zulässig.');
  groups.forEach(g => { g.matches = roundRobinMatches(g.players); });
  day.groups = groups; day.groupPhaseDone = false; day.ko = null; day.silverKo = null;
  return groups;
}
export function makeBracket(seeds, fixedSize = null) {
  if (!unique(seeds.map(r => r.id))) fail('Doppelte Teilnehmer im Turnierbaum.');
  let size = 2; while (size < seeds.length) size *= 2;
  if (fixedSize) {
    if (!Number.isInteger(fixedSize) || fixedSize < size || Math.log2(fixedSize) % 1) fail('Ungültige Turnierbaumgröße.');
    size = fixedSize;
  }
  const rounds = roundNames(size), matches = {}, positions = seedPositions(size);
  const byRank = Object.fromEntries(seeds.map((r, i) => [i + 1, r]));
  const half = size / 2, byeCount = size - seeds.length;
  const top = Array.from({ length: half }, (_, i) => i + 1).filter(i => i > byeCount && byRank[i]);
  const low = seeds.slice(half).map((_, i) => half + i + 1).reverse();
  const penalty = size ** 3 + 1;
  const assign = assignment(top.map(rank => low.map(opponent =>
    (byRank[rank].group && byRank[rank].group === byRank[opponent].group ? penalty : 0) + Math.abs(size + 1 - rank - opponent))));
  const opponentFor = Object.fromEntries(top.map((rank, i) => [rank, low[assign[i]]]));
  const warnings = [];
  matches[rounds[0]] = Array.from({ length: half }, (_, i) => {
    const pair = positions.slice(2 * i, 2 * i + 2);
    const high = Math.min(...pair), opponent = opponentFor[high] || size + 1 - high;
    const a = byRank[high], b = byRank[opponent];
    if (a && b && a.group && a.group === b.group) warnings.push(`Gruppeninterne Paarung unvermeidbar: ${a.id} – ${b.id}`);
    return blankMatch(a?.id || null, b?.id || null);
  });
  for (let ri = 1; ri < rounds.length; ri++) {
    const previous = matches[rounds[ri - 1]];
    matches[rounds[ri]] = Array.from({ length: previous.length / 2 }, (_, i) => blankMatch(null, null, {
      source1: { matchId: previous[2 * i].id, outcome: 'winner' },
      source2: { matchId: previous[2 * i + 1].id, outcome: 'winner' }
    }));
  }
  const bracket = { engine: 'ko', rounds, matches, attendees: seeds.map(r => r.id), size, byeCount, warnings, bracketStartedAt: null };
  advanceBracket(bracket);
  return bracket;
}
export function bracketMatches(bracket) { return (bracket?.rounds || []).flatMap(r => bracket.matches?.[r] || []); }
export function divisions(day) {
  if (day.engine === 'ko' || (day.matches && day.rounds && !day.groups)) return [{ key: 'main', bracket: day }];
  return [{ key: 'gold', bracket: day.ko }, { key: 'silver', bracket: day.silverKo }].filter(x => x.bracket);
}
export function matchEntries(day) {
  const result = [];
  for (const g of day.groups || []) {
    result.push(...(g.matches || []).map(match => ({ match, phase: 'group', group: g.id, label: g.name })));
    result.push(...(g.deciderMatches || []).map(match => ({ match, phase: 'decider', group: g.id, label: `${g.name} · Entscheidungsspiel` })));
  }
  for (const { key, bracket } of divisions(day)) {
    for (const r of bracket.rounds) result.push(...bracket.matches[r].map(match => ({ match, phase: key, round: r, label: `${key === 'silver' ? 'Silber' : key === 'gold' ? 'Gold / K.-o.' : 'K.-o.'} · ${r}` })));
  }
  const de = day.de;
  if (de?.wbRounds) {
    for (const r of [...de.wbRounds, ...de.lbRounds]) result.push(...r.matches.map(match => ({ match, phase: 'doubleko', label: r.title })));
    if (de.grandFinal) result.push({ match: de.grandFinal, phase: 'doubleko', label: 'Grand Final' });
    if (de.resetFinal) result.push({ match: de.resetFinal, phase: 'doubleko', label: 'Final-Reset' });
  } else if (de?.rounds) {
    de.rounds.forEach((r, index) => result.push(...r.matches.map(match => ({ match, phase: 'legacy-doubleko', index, label: r.title }))));
  }
  day.swissRoundsData?.forEach((r, index) => result.push(...r.map(match => ({ match, phase: 'swiss', index, label: `Schweizer Runde ${index + 1}` }))));
  return result;
}
export function normalizeDay(day) {
  day.schemaVersion = 2;
  day.participation ||= {};
  if ((day.engine === 'ko' || day.de) && !Object.hasOwn(day, 'bracketStartedAt')) day.bracketStartedAt = day.startedAt || 'legacy';
  // Bestehende K.-o.-Phasen gelten als gestartet. Niemals neu auslosen.
  if (day.groupPhaseDone && day.ko && !day.qualificationSnapshot) {
    day.koStartedAt ||= day.ko.startedAt || day.startedAt || 'legacy';
    day.qualificationSnapshot = { legacy: true, startedAt: day.koStartedAt,
      gold: { players: [...(day.ko.attendees || [])], bracket: clone(day.ko) }, silver: null };
  }
  for (const { bracket } of divisions(day)) {
    bracket.rounds.forEach((r, ri) => bracket.matches[r].forEach((m, mi) => {
      m.id ||= uuid();
      if (ri && !m.source1 && !m.source2) {
        const previous = bracket.matches[bracket.rounds[ri - 1]];
        m.source1 = { matchId: previous[mi * 2].id, outcome: 'winner' };
        m.source2 = { matchId: previous[mi * 2 + 1].id, outcome: 'winner' };
      }
    }));
  }
  for (const { match: m } of matchEntries(day)) {
    m.id ||= uuid();
    m.status ||= m.annulled ? 'void' : m.bye ? 'bye' : m.completed ? 'completed' : 'pending';
  }
  return day;
}
function resetResult(m) {
  Object.assign(m, { s1: null, s2: null, legs1: 0, legs2: 0, winner: null, loser: null,
    completed: false, bye: false, walkover: false, annulled: false, status: 'pending', completedAt: null, withdrawalHold: false });
}
function protectOrUpdate(m, a, b) {
  if (m.p1 === a && m.p2 === b) return false;
  if (m.completed && !m.bye || m.status === 'live' || m.annulled) {
    m.conflict = { reason: 'Die Teilnehmer aus den vorherigen Spielen haben sich geändert.', expected: [a, b] };
    return false;
  }
  resetResult(m); m.p1 = a; m.p2 = b;
  return true;
}
export function advanceBracket(bracket) {
  const matches = bracketMatches(bracket), byId = Object.fromEntries(matches.map(m => [m.id, m]));
  for (const r of bracket.rounds || []) for (const m of bracket.matches[r]) {
    const state = (source, player) => {
      if (!source) return { ready: true, player };
      const parent = byId[source.matchId];
      return { ready: parent ? finished(parent) && !parent.conflict : false,
        player: parent && scored(parent) ? parent[source.outcome || 'winner'] || null : null };
    };
    const a = state(m.source1, m.p1), b = state(m.source2, m.p2);
    if (m.conflict) {
      if (a.ready && b.ready && (m.source1 || m.source2)) m.conflict.expected = [a.player, b.player];
      continue;
    }
    protectOrUpdate(m, a.player, b.player);
    if (!m.conflict && a.ready && b.ready && !m.completed && !m.annulled && (!m.p1 || !m.p2)) {
      resetResult(m); m.bye = true; m.completed = true; m.status = 'bye';
      m.winner = m.p1 || m.p2 || null;
    }
  }
}
export function descendants(day, id) {
  const entries = matchEntries(day), ids = new Set([id]), output = [];
  let changed;
  do {
    changed = false;
    for (const e of entries) if (!ids.has(e.match.id) && [e.match.source1, e.match.source2].some(s => s && ids.has(s.matchId))) {
      ids.add(e.match.id); output.push(e); changed = true;
    }
  } while (changed);
  const current = entries.find(e => e.match.id === id);
  // Historische dynamische Bäume haben keine Quellen: konservativ alle Folgerunden.
  if (['legacy-doubleko', 'swiss'].includes(current?.phase)) {
    for (const e of entries) if (e.phase === current.phase && e.index > current.index && !ids.has(e.match.id)) output.push(e);
  }
  return output;
}
function record(day, action, before, actor) {
  day.audit ||= [];
  day.audit.push({ id: uuid(), at: now(), actor, action, before });
}
export function editMatch(day, id, change) {
  const entry = matchEntries(day).find(e => e.match.id === id);
  if (!entry) fail('Spiel wurde nicht gefunden.');
  const m = entry.match, old = clone(m);
  if (old.annulled && old.withdrawalVoids?.some(player => withdrawn(day, player)) && change.status !== 'void') fail('Dieses Gruppenspiel bleibt wegen des vollständigen Rückzugs annulliert. Zuerst einen zulässigen Wiedereinstieg buchen.');
  const allowed = ['p1', 'p2', 's1', 's2', 'legs1', 'legs2', 'status', 'winner', 'note'];
  for (const key of Object.keys(change)) if (!allowed.includes(key)) fail(`Nicht bearbeitbares Feld: ${key}`);
  const status = change.status || 'completed';
  if ((day.engine === 'ko' || day.de) && day.bracketStartedAt === null && ['completed', 'walkover', 'live'].includes(status)) fail('Den Turnierbaum zuerst offiziell starten.');
  if (!['pending', 'live', 'completed', 'walkover', 'void'].includes(status)) fail('Ungültiger Spielstatus.');
  Object.assign(m, change);
  if (m.conflict?.source && !m.conflict.expected && (m.source1 || m.source2)) {
    const upstream = matchEntries(day).find(e => e.match.id === m.conflict.source)?.match;
    if (upstream?.conflict) fail('Zuerst den Konflikt im Vorgängerspiel auflösen.');
  }
  if (m.p1 && m.p1 === m.p2) fail('Ein Spieler darf nicht gegen sich selbst spielen.');
  const eligible = entry.group ? day.groups.find(g => g.id === entry.group).players : day.attendees;
  for (const player of [m.p1, m.p2].filter(Boolean)) {
    if (!eligible?.includes(player)) fail('Spieler gehört nicht zu dieser Phase / Gruppe.');
    if (withdrawn(day, player) && ['completed', 'live'].includes(status)) fail('Zurückgezogene Spieler dürfen nicht spielen.');
  }
  if (status === 'completed' || status === 'walkover') {
    if (!m.p1 || !m.p2) fail('Für eine Wertung müssen beide Spieler feststehen. Freilose über die Paarungen bearbeiten.');
    if (status === 'walkover') {
      if (![m.p1, m.p2].includes(change.winner)) fail('Gewinner der kampflosen Wertung auswählen.');
      m.s1 = change.winner === m.p1 ? 2 : 0; m.s2 = change.winner === m.p2 ? 2 : 0;
      m.legs1 = entry.phase === 'group' ? m.s1 : 0; m.legs2 = entry.phase === 'group' ? m.s2 : 0;
    }
    if (!integer(m.s1) || !integer(m.s2) || m.s1 === m.s2 || !integer(m.legs1) || !integer(m.legs2)) fail('Ergebnis und Legs müssen nichtnegative ganze Zahlen mit eindeutigem Sieger sein.');
    const config = entry.group ? day.groupFormat : day.roundConfig?.[entry.round];
    if (status === 'completed' && config?.format !== 'sets' && (m.legs1 !== m.s1 || m.legs2 !== m.s2)) fail('Bei Leg-Spielen müssen Ergebnis und gewonnene Legs übereinstimmen.');
    m.winner = m.s1 > m.s2 ? m.p1 : m.p2; m.loser = m.s1 > m.s2 ? m.p2 : m.p1;
    if (change.winner && change.winner !== m.winner) fail('Gewinner und Ergebnis widersprechen sich.');
    m.completed = true; m.completedAt = now();
  } else {
    resetResult(m); m.status = status; m.annulled = status === 'void';
  }
  m.status = status; m.walkover = status === 'walkover'; m.bye = false; m.annulled = status === 'void';
  m.withdrawalHold = status === 'pending' && Boolean(old.walkover) && (withdrawn(day, m.p1) || withdrawn(day, m.p2));
  // Quellenänderungen an nachgelagerten Paarungen nur über die Konfliktauflösung.
  if ((m.source1 || m.source2) && (old.p1 !== m.p1 || old.p2 !== m.p2)) {
    const expected = m.conflict?.expected;
    if (!expected || expected[0] !== m.p1 || expected[1] !== m.p2) fail('Diese Position wird aus Vorgängerspielen befüllt. Vorgänger korrigieren oder den angezeigten Konflikt auflösen.');
  }
  if (m.conflict) {
    const expected = m.conflict.expected;
    if (expected && (m.p1 !== expected[0] || m.p2 !== expected[1])) fail('Zuerst die Teilnehmer laut Konfliktübersicht zuordnen.');
    delete m.conflict;
  }
  const affects = old.winner !== m.winner || old.loser !== m.loser || old.p1 !== m.p1 || old.p2 !== m.p2 || !!old.completed !== !!m.completed || !!old.annulled !== !!m.annulled;
  if (affects) for (const e of descendants(day, id)) {
    if (e.match.completed && !e.match.bye || e.match.status === 'live' || ['legacy-doubleko', 'swiss'].includes(entry.phase)) {
      e.match.conflict = { reason: `Vorgängerspiel ${id} wurde korrigiert. Teilnehmer und Ergebnis prüfen.`, source: id };
    } else resetResult(e.match);
  }
  if (entry.phase === 'group') day.finalPreview = null;
  return old;
}
export function swapSlots(day, division, matchA, sideA, matchB, sideB) {
  if (!['p1', 'p2'].includes(sideA) || !['p1', 'p2'].includes(sideB)) fail('Ungültige Spielposition.');
  const bracket = swappableBracket(day, division);
  if (!bracket) fail('Turnierbaum nicht gefunden.');
  const first = bracket.matches[bracket.rounds[0]], a = first.find(m => m.id === matchA), b = first.find(m => m.id === matchB);
  if (!a || !b) fail('Nur Positionen derselben ersten Runde können getauscht werden.');
  const originals = new Map([a, b].map(m => [m.id, clone(m)]));
  [a[sideA], b[sideB]] = [b[sideB], a[sideA]];
  const ids = first.flatMap(m => [m.p1, m.p2]).filter(Boolean);
  if (!unique(ids) || ids.length !== bracket.attendees.length || ids.some(id => !bracket.attendees.includes(id))) fail('Teilnehmer müssen genau einmal erhalten bleiben.');
  for (const m of new Set([a, b])) {
    if (m.completed && !m.bye || m.status === 'live') {
      // Ergebnis bleibt mit Originalteilnehmern erhalten, bis der Admin es auflöst.
      const expected = [m.p1, m.p2];
      Object.assign(m, originals.get(m.id));
      m.conflict = { reason: 'Paarung administrativ geändert. Ergebnis ausdrücklich neu prüfen.', expected };
    } else resetResult(m);
    for (const e of descendants(day, m.id)) {
      if (e.match.completed && !e.match.bye || e.match.status === 'live') e.match.conflict = { reason: 'Eine vorherige Paarung wurde geändert.', source: m.id };
      else resetResult(e.match);
    }
  }
  advanceBracket(bracket);
}
export function swappableBracket(day, key) {
  if (key === 'previewGold') return day.finalPreview?.gold;
  if (key === 'previewSilver') return day.finalPreview?.silver;
  if (key === 'doubleko') {
    const first = day.de?.wbRounds?.[0] || day.de?.rounds?.[0];
    return first ? { rounds: ['first'], matches: { first: first.matches }, attendees: day.attendees } : null;
  }
  return divisions(day).find(d => d.key === key)?.bracket;
}
export function previewFinals(day) {
  if (day.koStartedAt || day.groupPhaseDone) fail('Die K.-o.-Phase ist eingefroren. Bestehende Paarungen gezielt bearbeiten.');
  if (!allGroupsDone(day)) fail('Zuerst alle regulären Gruppenspiele abschließen oder annullieren.');
  const result = { signatures: {} };
  for (const division of ['gold', 'silver']) {
    const q = qualification(day, division);
    if (q.unresolved.length) fail('Qualifikationsrelevante Gruppenplätze müssen durch Entscheidungsspiele geklärt werden.');
    if (q.seedTies.length) fail('Gleiche Setzpositionen müssen vom Administrator ausdrücklich geordnet und gespeichert werden.');
    result[division] = q.rows.length ? makeBracket(q.rows) : null;
    result.signatures[division] = q.signature;
  }
  if (!result.gold && !result.silver) fail('Keine Qualifikationsplätze festgelegt.');
  day.finalPreview = result;
}
export function startFinals(day) {
  if (day.koStartedAt || day.groupPhaseDone) fail('Die K.-o.-Phase wurde bereits gestartet.');
  if (!day.finalPreview) fail('Zuerst einen Turnierbaum als Vorschau erstellen.');
  if (!allGroupsDone(day)) fail('Gruppenphase ist noch offen.');
  const snapshot = { startedAt: now() };
  for (const key of ['gold', 'silver']) {
    const q = qualification(day, key);
    if (q.unresolved.length || q.seedTies.length || day.finalPreview.signatures[key] !== q.signature) fail('Qualifikation hat sich geändert. Vorschau erneut prüfen.');
    const bracket = day.finalPreview[key];
    snapshot[key] = bracket ? { players: bracket.attendees.slice(), seeds: clone(q.rows), bracket: clone(bracket) } : null;
  }
  day.ko = day.finalPreview.gold; day.silverKo = day.finalPreview.silver;
  day.qualificationSnapshot = snapshot; day.koStartedAt = snapshot.startedAt;
  day.groupPhaseDone = true; day.finalPreview = null;
}
export function qualificationDrift(day) {
  if (!day.qualificationSnapshot) return [];
  return ['gold', 'silver'].filter(key => {
    const saved = day.qualificationSnapshot[key], q = qualification(day, key);
    return JSON.stringify(saved?.seeds?.map(r => [r.id, r.place, r.mp, diff(r)]) || saved?.players || []) !==
      JSON.stringify(saved?.seeds ? q.rows.map(r => [r.id, r.place, r.mp, diff(r)]) : q.rows.map(r => r.id)) || q.unresolved.length;
  });
}
export function createDecider(day, groupId, players, format = 'round-robin') {
  const group = day.groups.find(g => g.id === groupId);
  if (!group || !groupDone(group, day)) fail('Entscheidungsspiele sind erst nach Abschluss aller regulären Spiele dieser Gruppe möglich.');
  const tie = standings(group, day).ties.find(t => t.players.length === players.length && t.players.every(id => players.includes(id)));
  if (!tie) fail('Diese Spieler bilden aktuell keinen vollständigen Gleichstand.');
  const signature = groupSignature(group, day);
  if (!['round-robin', 'double-round-robin'].includes(format)) fail('Ungültiges Entscheidungsformat.');
  const event = { id: uuid(), players: [...players], format: players.length === 2 ? 'duel' : format, signature };
  group.deciders ||= []; group.deciderMatches ||= []; group.deciders.unshift(event);
  players.forEach((a, i) => players.slice(i + 1).forEach(b => group.deciderMatches.push(blankMatch(a, b, { tieBreak: true, eventId: event.id }))));
  if (format === 'double-round-robin' && players.length > 2) players.forEach((a, i) => players.slice(i + 1).forEach(b => group.deciderMatches.push(blankMatch(b, a, { tieBreak: true, eventId: event.id }))));
  return event;
}
export function withdrawPlayer(day, id) {
  if (!day.attendees.includes(id) || withdrawn(day, id)) fail('Spieler ist nicht aktiv.');
  const entries = matchEntries(day).filter(e => [e.match.p1, e.match.p2].includes(id));
  const next = entries.find(e => !finished(e.match) && e.phase !== 'decider');
  const participation = { status: 'withdrawn', withdrawnAt: now(), phaseAtWithdrawal: day.koStartedAt || null,
    nextMatchId: next?.match.id || null, nextPosition: next ? (next.match.p1 === id ? 'p1' : 'p2') : null,
    originals: {}, walkovers: [] };
  for (const e of entries) {
    const m = e.match;
    if (['group', 'decider'].includes(e.phase)) {
      const previousWithdrawal = (m.withdrawalVoids || []).map(player => day.participation?.[player]?.originals?.[m.id]).find(Boolean);
      participation.originals[m.id] = clone(previousWithdrawal || m);
      m.annulled = true; m.status = 'void'; m.withdrawalVoids ||= []; m.withdrawalVoids.push(id);
    } else if (!finished(m) && m.p1 && m.p2) {
      // Rückzugsstatus erst nach der kampflosen Buchung setzen.
      editMatch(day, m.id, { status: 'walkover', winner: m.p1 === id ? m.p2 : m.p1 });
      participation.walkovers.push(m.id);
    }
  }
  day.participation ||= {}; day.participation[id] = participation;
  day.finalPreview = null;
}
export function reentryAllowed(day, id) {
  const p = day.participation?.[id];
  if (p?.status !== 'withdrawn') return { allowed: false, reason: 'Spieler ist nicht zurückgezogen.' };
  if ((day.koStartedAt || null) !== p.phaseAtWithdrawal) return { allowed: false, reason: 'Die Turnierphase hat seit dem Rückzug gewechselt.' };
  if (!p.nextMatchId) return { allowed: false, reason: 'Beim Rückzug war keine nächste Spielposition mehr offen.' };
  if (p.walkovers?.includes(p.nextMatchId) || p.nextValuedAt) return { allowed: false, reason: 'Die maßgebliche nächste Partie wurde bereits gewertet. Ein späteres Zurücksetzen erlaubt keinen automatischen Wiedereinstieg.' };
  const entry = matchEntries(day).find(e => e.match.id === p.nextMatchId), m = entry?.match;
  if (!m || m.conflict || m.walkover || m.bye || m.completed && !p.originals[m.id]?.completed) return { allowed: false, reason: 'Die maßgebliche nächste Partie wurde bereits gewertet oder ist korrekturbedürftig.' };
  if (matchEntries(day).some(e => e.match.conflict)) return { allowed: false, reason: 'Zuerst die offenen Turnierkonflikte auflösen.' };
  for (const [matchId, original] of Object.entries(p.originals)) {
    const current = matchEntries(day).find(e => e.match.id === matchId)?.match;
    if (!current || current.p1 !== original.p1 || current.p2 !== original.p2) return { allowed: false, reason: 'Ursprüngliche Spielzuordnungen wurden verändert.' };
  }
  return { allowed: true, reason: 'Annullierte Gruppenergebnisse können nach Bestätigung wiederhergestellt werden.' };
}
export function reactivatePlayer(day, id) {
  const check = reentryAllowed(day, id); if (!check.allowed) fail(check.reason);
  const p = day.participation[id];
  for (const [matchId, original] of Object.entries(p.originals)) {
    const m = matchEntries(day).find(e => e.match.id === matchId).match;
    // Zweiter zurückgezogener Gegner bleibt aus der Wertung.
    if ([original.p1, original.p2].some(player => player !== id && withdrawn(day, player))) {
      m.withdrawalVoids = (m.withdrawalVoids || []).filter(player => player !== id);
    } else {
      for (const key of Object.keys(m)) delete m[key];
      Object.assign(m, clone(original), { withdrawalVoids: [] });
    }
  }
  p.status = 'active'; p.reactivatedAt = now(); day.finalPreview = null;
}
export function validateDay(day) {
  const entries = matchEntries(day), ids = entries.map(e => e.match.id);
  if (!unique(ids)) fail('Doppelte Spiel-ID.');
  for (const e of entries) {
    const m = e.match;
    if (m.conflict) continue; // Ein expliziter Konflikt bewahrt das bisherige Ergebnis.
    if (m.p1 && m.p1 === m.p2) fail('Doppelter Spieler in einer Begegnung.');
    if (competitive(m) && (![m.p1, m.p2].includes(m.winner) || m.s1 === m.s2 || (m.s1 > m.s2 ? m.p1 : m.p2) !== m.winner)) fail('Ungültiger Sieger oder Ergebnis.');
  }
  for (const { bracket } of divisions(day)) for (const r of bracket.rounds) {
    const players = bracket.matches[r].filter(m => !m.conflict).flatMap(m => [m.p1, m.p2]).filter(Boolean);
    if (!unique(players)) fail('Ein Spieler ist in derselben K.-o.-Runde mehrfach eingesetzt.');
    if (r === bracket.rounds[0] && !bracket.matches[r].some(m => m.conflict) && bracket.attendees &&
        (players.length !== bracket.attendees.length || players.some(id => !bracket.attendees.includes(id)))) fail('Die erste K.-o.-Runde muss alle gesetzten Teilnehmer genau einmal erhalten. Bitte die Tauschfunktion verwenden.');
  }
  if (day.de) for (const r of [...(day.de.wbRounds || []), ...(day.de.lbRounds || []), ...(day.de.rounds || [])]) {
    const players = r.matches.filter(m => !m.conflict).flatMap(m => [m.p1, m.p2]).filter(Boolean);
    if (!unique(players)) fail('Ein Spieler ist in derselben Doppel-K.-o.-Runde mehrfach eingesetzt.');
    if ((r === day.de.wbRounds?.[0] || r === day.de.rounds?.[0]) && !r.matches.some(m => m.conflict) && day.attendees &&
        (players.length !== day.attendees.length || players.some(id => !day.attendees.includes(id)))) fail('Alle Teilnehmer der ersten Doppel-K.-o.-Runde müssen erhalten bleiben. Bitte tauschen statt entfernen.');
  }
  if (day.ko && day.silverKo && day.ko.attendees.some(id => day.silverKo.attendees.includes(id))) fail('Ein Spieler darf nicht gleichzeitig in Gold und Silber stehen.');
  if (day.groups?.length > 8) fail('Höchstens acht Gruppen sind zulässig.');
}
export function tournamentComplete(day) {
  if (matchEntries(day).some(e => e.match.conflict)) return false;
  if (day.de) return Boolean(day.de.champion);
  const brackets = divisions(day);
  if (brackets.length) return brackets.every(({ bracket }) => scored(bracket.matches[bracket.rounds.at(-1)][0]));
  if (day.groups) return allGroupsDone(day) && Object.values(rules(day)).every(p => !p.length) && day.groups.every(g => !standings(g, day).ties.length);
  if (day.swissRoundsData) return day.swissRoundsData.length >= day.totalRounds && day.swissRoundsData.every(r => r.every(finished));
  return false;
}
export function knockoutResults(bracket) {
  const final = bracket.matches[bracket.rounds.at(-1)][0];
  if (!scored(final)) return [];
  const result = [];
  if (final.winner) result.push({ id: final.winner, place: 1 });
  if (final.loser) result.push({ id: final.loser, place: 2 });
  let place = result.length + 1;
  for (let ri = bracket.rounds.length - 2; ri >= 0; ri--) {
    const losers = bracket.matches[bracket.rounds[ri]].filter(scored).map(m => m.loser).filter(Boolean);
    result.push(...losers.map(id => ({ id, place })));
    place += losers.length;
  }
  return result;
}
export function groupResults(day) {
  if (!tournamentComplete(day)) return [];
  const result = [], seen = new Set();
  for (const { bracket } of divisions(day)) {
    const offset = result.length;
    for (const r of knockoutResults(bracket)) { result.push({ ...r, place: r.place + offset }); seen.add(r.id); }
  }
  const others = day.groups.flatMap(g => standings(g, day).rows).filter(r => !seen.has(r.id));
  let place = result.length + 1;
  for (const cohort of buckets(others, (a, b) => a.place - b.place)) {
    result.push(...cohort.map(r => ({ id: r.id, place }))); place += cohort.length;
  }
  return performanceResults(day, result);
}
export function performanceResults(day, placements) {
  const stats = Object.fromEntries((day.attendees || []).map(id => [id, row(id)]));
  for (const { match: m, phase } of matchEntries(day)) {
    if (!competitive(m) || m.walkover || phase === 'decider') continue;
    if (!stats[m.p1] || !stats[m.p2] || !stats[m.winner]) continue;
    const [a, b] = legs(m);
    stats[m.p1].legsFor += a; stats[m.p1].legsAgainst += b;
    stats[m.p2].legsFor += b; stats[m.p2].legsAgainst += a; stats[m.winner].wins++;
  }
  return placements.map(p => ({ ...stats[p.id], ...p }));
}
// Jede Mutation wird zuerst vollständig auf einer Kopie ausgeführt und geprüft.
// Die UI zeigt die Konsequenzen an, bevor genau diese Kopie gespeichert wird.
export function planChange(original, action, actor, mutate, reconcile = () => {}) {
  if (!actor) fail('Administrator erforderlich.');
  const day = normalizeDay(clone(original));
  const beforeEntries = matchEntries(day).map(e => ({ ...e, match: clone(e.match) }));
  mutate(day);
  for (const { bracket } of divisions(day)) advanceBracket(bracket);
  reconcile(day);
  // Auch später bereit werdende Begegnungen eines zurückgezogenen Spielers
  // werden im selben überprüfbaren Änderungsvorschlag behandelt.
  for (let pass = 0; pass < 128; pass++) {
    const open = matchEntries(day).find(e => !['group', 'decider'].includes(e.phase) &&
      !finished(e.match) && !e.match.conflict && !e.match.withdrawalHold && e.match.p1 && e.match.p2 &&
      (withdrawn(day, e.match.p1) || withdrawn(day, e.match.p2)));
    if (!open) break;
    const m = open.match;
    if (withdrawn(day, m.p1) && withdrawn(day, m.p2)) {
      m.conflict = { reason: 'Beide Spieler sind zurückgezogen. Administrativ annullieren.' };
    } else {
      editMatch(day, m.id, { status: 'walkover', winner: withdrawn(day, m.p1) ? m.p2 : m.p1 });
      const player = withdrawn(day, m.p1) ? m.p1 : m.p2;
      day.participation[player].walkovers.push(m.id);
    }
    for (const { bracket } of divisions(day)) advanceBracket(bracket);
    reconcile(day);
  }
  validateDay(day);
  const after = matchEntries(day);
  const effects = after.filter(e => {
    const old = beforeEntries.find(b => b.match.id === e.match.id);
    return !old || JSON.stringify(old.match) !== JSON.stringify(e.match);
  }).map(e => ({ id: e.match.id, label: e.label, players: [e.match.p1, e.match.p2],
    conflict: Boolean(e.match.conflict), completed: e.match.completed, status: e.match.status }));
  const changed = beforeEntries.filter(e => effects.some(x => x.id === e.match.id)).map(e => ({ id: e.match.id, value: e.match }));
  // Paarungen, Ergebnisse und Regeln vorher/nachher bleiben nachvollziehbar.
  record(day, action, { matches: changed, qualificationRules: original.qualificationRules || null,
    qualifyPlaces: original.qualifyPlaces || null, manualSeeds: original.manualSeeds || null,
    participation: original.participation || null }, actor);
  day.lastAdminChange = { at: now(), actor, action };
  return { day, effects, drift: qualificationDrift(day) };
}
