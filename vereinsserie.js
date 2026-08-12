import { db, getLogin } from './auth-utils.js';
import {
  doc, getDoc, setDoc, serverTimestamp, collection, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const REF = doc(db, 'vereinsrangliste_neu', 'haupt');
const MODES = {
  premier: 'K.-o.-System',
  swiss: 'Schweizer System',
  doubleko: 'Doppel-K.-o.',
  groupsko: 'Gruppen + K.-o.'
};
const PLAYER_ROLES = ['mitglied', 'captain', 'kassenwart', 'admin'];
const SELECTABLE_ROLES = [...PLAYER_ROLES];
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

let login = getLogin();
let currentRole = String(login?.rolle || '').toLowerCase();
let canManage = ['admin', 'captain', 'kassenwart'].includes(currentRole);
let state = { members: [], seasons: [], activeSeasonId: null, current: null };
let tournamentView = 'tree';
let treeSelectionId = 'current';
let treeReadOnly = false;

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3000);
}

function blankStats() {
  return { points: 0, days: 0, wins: 0, titles: 0, legsFor: 0, legsAgainst: 0, byMode: {}, history: [] };
}
function blankSeason(name = 'Saison 2026/27') {
  return { id: uid(), name, status: 'aktiv', createdAt: new Date().toISOString(), ranking: {}, days: [] };
}
function season() {
  return state.seasons.find(s => s.id === state.activeSeasonId) || state.seasons[0] || null;
}
function memberName(id) {
  return state.members.find(m => m.id === id)?.name || id || 'Offen';
}
function memberData(id) {
  return state.members.find(m => m.id === id) || null;
}
function memberAvatar(id, size = 'normal') {
  const member = memberData(id);
  const cls = size === 'small' ? 'player-avatar player-avatar-small' : 'player-avatar';
  if (member?.profilbild) {
    return `<img class="${cls}" src="${esc(member.profilbild)}" alt="">`;
  }
  const initials = String(member?.name || id || '?').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="${cls} player-avatar-fallback">${esc(initials || '?')}</span>`;
}
function playerIdentity(id, size = 'normal') {
  return `<span class="player-identity">${memberAvatar(id, size)}<span>${esc(memberName(id))}</span></span>`;
}
function isRankingEligible(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (!member) return true; // Historische Spieler erhalten ihre Einträge.
  if (PLAYER_ROLES.includes(member.rolle)) return true;
  const stats = season()?.ranking?.[memberId];
  return Boolean(stats?.days || stats?.points || stats?.history?.length);
}

async function refreshPermission() {
  login = getLogin();
  currentRole = String(login?.rolle || '').toLowerCase();
  if (!login?.benutzername) {
    canManage = false;
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'mitglieder', login.benutzername));
    if (snap.exists()) {
      currentRole = String(snap.data().rolle || 'gast').toLowerCase();
      canManage = ['admin', 'captain', 'kassenwart'].includes(currentRole);
    }
  } catch (error) {
    console.warn('Rolle konnte nicht aktualisiert werden:', error);
  }
}

async function save({ render = true } = {}) {
  await setDoc(REF, { ...state, updatedAt: serverTimestamp() });
  if (render) renderAll();
}

async function syncMembers(showToast = true) {
  const snapshot = await getDocs(collection(db, 'mitglieder'));
  const members = [];
  snapshot.forEach(item => {
    const data = item.data();
    const role = String(data.rolle || '').toLowerCase();
    if (data.aktiv !== false && SELECTABLE_ROLES.includes(role)) {
      members.push({
        id: item.id,
        name: data.nickname || data.spitzname || data.benutzername || item.id,
        rolle: role,
        profilbild: data.profilbild || '',
        scoliaName: data.scoliaName || '',
        geburtstag: data.geburtstag || ''
      });
    }
  });
  members.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  state.members = members;
  const currentSeason = season();
  if (currentSeason) {
    currentSeason.ranking ||= {};
    members.filter(m => PLAYER_ROLES.includes(m.rolle)).forEach(m => {
      currentSeason.ranking[m.id] ||= blankStats();
    });
  }
  await save({ render: false });
  if (showToast) toast(`${members.length} Spieler synchronisiert.`);
}

async function load() {
  await refreshPermission();
  const snap = await getDoc(REF);
  if (snap.exists()) state = { ...state, ...snap.data() };
  state.members ||= [];
  state.seasons ||= [];
  if (!state.seasons.length) {
    const first = blankSeason();
    state.seasons = [first];
    state.activeSeasonId = first.id;
  }
  if (!state.activeSeasonId || !state.seasons.some(s => s.id === state.activeSeasonId)) {
    state.activeSeasonId = state.seasons[0].id;
  }
  await syncMembers(false);
  renderAll();
}

// ---------- Format / Ergebnis ----------
function collectRoundConfig() {
  const config = {};
  document.querySelectorAll('[data-round-config]').forEach(row => {
    const key = row.dataset.roundConfig;
    config[key] = {
      format: row.querySelector('[data-format]')?.value || 'legs',
      win: Math.max(1, +(row.querySelector('[data-win]')?.value || 3)),
      legsPerSet: Math.max(1, +(row.querySelector('[data-legs-set]')?.value || 3))
    };
  });
  return config;
}
function roundConfigFor(day, roundName) {
  return day.roundConfig?.[roundName] || { format: 'legs', win: 3, legsPerSet: 3 };
}
function formatLabel(config) {
  return config.format === 'sets'
    ? `First to ${config.win} Sets · First to ${config.legsPerSet} Legs je Set`
    : `First to ${config.win} Legs`;
}
function validateScore(a, b, config) {
  // Die Gewinnlänge wird nicht vorgegeben. Aus 3:1 folgt automatisch First to 3,
  // aus 5:4 entsprechend First to 5 usw.
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a !== b && Math.max(a, b) > 0;
}
function totalLegsFromScore(a, b, config, explicitA, explicitB) {
  if (config.format === 'sets') {
    return [Math.max(0, +explicitA || 0), Math.max(0, +explicitB || 0)];
  }
  return [a, b];
}

// ---------- Basis-K.-o. (Premier League + Gruppen-KO) ----------
function powerOfTwo(n) {
  let value = 2;
  while (value < n) value *= 2;
  return value;
}
function roundNames(size) {
  const names = [];
  if (size >= 128) names.push('Runde der 128');
  if (size >= 64) names.push('Runde der 64');
  if (size >= 32) names.push('Runde der 32');
  if (size >= 16) names.push('Achtelfinale');
  if (size >= 8) names.push('Viertelfinale');
  if (size >= 4) names.push('Halbfinale');
  names.push('Finale');
  return names;
}
function shuffled(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function makeSingleElimination(ids, seededOrder = null, fixedSize = null) {
  const players = seededOrder ? [...seededOrder] : shuffled(ids);
  const requestedSize = Number(fixedSize);
  const size = [4, 8, 16, 32].includes(requestedSize) ? requestedSize : powerOfTwo(players.length);
  if (players.length > size) throw new Error(`Für das ${size}er Feld sind höchstens ${size} Teilnehmer möglich.`);
  const names = roundNames(size);
  const byeCount = size - players.length;

  // Freilose müssen echten Spielern gegenüberstehen. Die alte Logik hängte
  // alle leeren Plätze ans Ende und erzeugte dadurch leere Partien statt Freilose.
  const slots = [];
  let playerIndex = 0;

  for (let matchIndex = 0; matchIndex < size / 2; matchIndex++) {
    if (matchIndex < byeCount) {
      slots.push(players[playerIndex++] || null, null);
    } else {
      slots.push(players[playerIndex++] || null, players[playerIndex++] || null);
    }
  }

  const matches = {};
  names.forEach((round, roundIndex) => {
    const count = size / (2 ** (roundIndex + 1));
    matches[round] = Array.from({ length: count }, (_, index) => ({
      id: uid(),
      p1: roundIndex === 0 ? slots[index * 2] : null,
      p2: roundIndex === 0 ? slots[index * 2 + 1] : null,
      s1: null, s2: null, legs1: 0, legs2: 0,
      winner: null, loser: null, completed: false, bye: false
    }));
  });

  const day = { engine: 'ko', rounds: names, matches, size, byeCount };
  advanceKO(day);
  return day;
}
function advanceKO(day) {
  let changed = true;
  while (changed) {
    changed = false;

    day.rounds.forEach((round, ri) => {
      day.matches[round].forEach((match, mi) => {
        if (ri === 0 && !match.completed && Boolean(match.p1) !== Boolean(match.p2)) {
          match.winner = match.p1 || match.p2;
          match.completed = true;
          match.bye = true;
          changed = true;
        }

        if (match.completed && match.winner && ri < day.rounds.length - 1) {
          const next = day.matches[day.rounds[ri + 1]][Math.floor(mi / 2)];
          const side = mi % 2 === 0 ? 'p1' : 'p2';
          if (next[side] !== match.winner) {
            next[side] = match.winner;
            changed = true;
          }
        }
      });
    });
  }
}
function koResults(day) {
  const stats = Object.fromEntries(day.attendees.map(id => [id, { id, wins: 0, legsFor: 0, legsAgainst: 0, eliminatedRound: -1 }]));
  day.rounds.forEach((round, ri) => day.matches[round].forEach(m => {
    if (!m.completed || m.bye) return;
    stats[m.winner].wins++;
    stats[m.p1].legsFor += m.legs1 || m.s1 || 0;
    stats[m.p1].legsAgainst += m.legs2 || m.s2 || 0;
    stats[m.p2].legsFor += m.legs2 || m.s2 || 0;
    stats[m.p2].legsAgainst += m.legs1 || m.s1 || 0;
    stats[m.loser].eliminatedRound = ri;
  }));
  const final = day.matches[day.rounds.at(-1)][0];
  const winner = final.winner;
  const runnerUp = final.loser;
  const results = [];
  if (winner && stats[winner]) results.push({ ...stats[winner], place: 1 });
  if (runnerUp && stats[runnerUp]) results.push({ ...stats[runnerUp], place: 2 });

  let nextPlace = 3;
  for (let ri = day.rounds.length - 2; ri >= 0; ri--) {
    const cohort = Object.values(stats)
      .filter(row => row.id !== winner && row.id !== runnerUp && row.eliminatedRound === ri)
      .sort((a, b) => memberName(a.id).localeCompare(memberName(b.id), 'de'));
    cohort.forEach(row => results.push({ ...row, place: nextPlace }));
    nextPlace += cohort.length;
  }
  return results;
}

// ---------- Schweizer System ----------
function swissStats(day) {
  const stats = Object.fromEntries(day.attendees.map(id => [id, {
    id, mp: 0, wins: 0, legsFor: 0, legsAgainst: 0, opponents: [], byeCount: 0, buchholz: 0
  }]));
  (day.swissRoundsData || []).flat().forEach(match => {
    if (!match.completed) return;
    if (match.bye) {
      stats[match.p1].mp += 2;
      stats[match.p1].byeCount += 1;
      return;
    }
    const a = stats[match.p1], b = stats[match.p2];
    a.opponents.push(match.p2); b.opponents.push(match.p1);
    a.legsFor += match.legs1 || match.s1 || 0;
    a.legsAgainst += match.legs2 || match.s2 || 0;
    b.legsFor += match.legs2 || match.s2 || 0;
    b.legsAgainst += match.legs1 || match.s1 || 0;
    stats[match.winner].mp += 2;
    stats[match.winner].wins += 1;
  });
  Object.values(stats).forEach(row => {
    row.buchholz = row.opponents.reduce((sum, opponent) => sum + (stats[opponent]?.mp || 0), 0);
  });
  return Object.values(stats).sort((a, b) =>
    b.mp - a.mp || b.buchholz - a.buchholz ||
    (b.legsFor - b.legsAgainst) - (a.legsFor - a.legsAgainst) ||
    b.legsFor - a.legsFor || memberName(a.id).localeCompare(memberName(b.id), 'de')
  );
}
function pairSwissRound(day) {
  const standings = swissStats(day);
  const played = new Set();
  (day.swissRoundsData || []).flat().forEach(match => {
    if (match.p1 && match.p2) played.add([match.p1, match.p2].sort().join('|'));
  });

  const pool = standings.map(row => row.id);
  const matches = [];

  if (pool.length % 2 === 1) {
    // Das Freilos erhält bevorzugt der am schlechtesten platzierte Spieler,
    // der bisher noch kein Freilos hatte.
    let actualIndex = -1;
    for (let index = standings.length - 1; index >= 0; index--) {
      if (standings[index].byeCount === 0) {
        actualIndex = pool.indexOf(standings[index].id);
        break;
      }
    }
    if (actualIndex < 0) actualIndex = pool.length - 1;
    const byePlayer = pool.splice(actualIndex, 1)[0];
    matches.push({
      id: uid(), p1: byePlayer, p2: null, winner: byePlayer,
      completed: true, bye: true, s1: 1, s2: 0, legs1: 0, legs2: 0
    });
  }

  // Globale Paarungssuche statt einfacher Greedy-Logik. Dadurch werden
  // Wiederholungsgegner vermieden, solange irgendeine gültige Paarung existiert.
  function bestPairing(ids) {
    if (!ids.length) return { pairs: [], repeats: 0 };
    const p1 = ids[0];
    let best = null;

    for (let index = 1; index < ids.length; index++) {
      const p2 = ids[index];
      const key = [p1, p2].sort().join('|');
      const repeat = played.has(key) ? 1 : 0;
      const rest = ids.slice(1, index).concat(ids.slice(index + 1));
      const sub = bestPairing(rest);
      const candidate = {
        pairs: [[p1, p2], ...sub.pairs],
        repeats: repeat + sub.repeats
      };
      if (!best || candidate.repeats < best.repeats) best = candidate;
      if (best.repeats === 0) break;
    }
    return best;
  }

  const pairing = bestPairing(pool);
  (pairing?.pairs || []).forEach(([p1, p2]) => {
    matches.push({
      id: uid(), p1, p2, winner: null, loser: null,
      completed: false, bye: false, s1: null, s2: null, legs1: 0, legs2: 0
    });
  });

  day.swissRoundsData ||= [];
  day.swissRoundsData.push(matches);
}
function swissResults(day) {
  return swissStats(day).map((row, index) => ({
    id: row.id, place: index + 1, wins: row.wins,
    legsFor: row.legsFor, legsAgainst: row.legsAgainst
  }));
}

// ---------- Gruppen + K.-o. ----------
function autoGroupCount(playerCount) {
  if (playerCount <= 8) return 2;
  if (playerCount <= 12) return 3;
  return 4;
}
function seededGroupOrder(ids) {
  const rank = rankingRows('all').map(x => x.m.id);
  return [...ids].sort((a, b) => {
    const ai = rank.indexOf(a), bi = rank.indexOf(b);
    return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
  });
}
function roundRobinGroupMatches(players) {
  const ids = [...players];
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(null);

  const rounds = [];
  const rotation = [...ids];
  const roundCount = rotation.length - 1;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    const roundMatches = [];
    for (let i = 0; i < rotation.length / 2; i++) {
      const p1 = rotation[i];
      const p2 = rotation[rotation.length - 1 - i];
      if (p1 && p2) {
        roundMatches.push({
          id: uid(), p1, p2,
          s1: null, s2: null, legs1: 0, legs2: 0,
          winner: null, completed: false,
          groupRound: roundIndex + 1
        });
      }
    }

    // Innerhalb jeder Runde so sortieren, dass ein Spieler möglichst nicht direkt
    // am Ende der vorigen und am Anfang der nächsten Runde wieder auftaucht.
    if (rounds.length && roundMatches.length > 1) {
      const previous = rounds.at(-1).at(-1);
      const blocked = new Set([previous?.p1, previous?.p2].filter(Boolean));
      const safeIndex = roundMatches.findIndex(m => !blocked.has(m.p1) && !blocked.has(m.p2));
      if (safeIndex > 0) roundMatches.unshift(roundMatches.splice(safeIndex, 1)[0]);
    }

    rounds.push(roundMatches);
    // Circle-Methode: erster Platz bleibt stehen, Rest rotiert.
    rotation.splice(1, 0, rotation.pop());
  }

  return rounds.flat();
}

function setupGroups(day) {
  const count = day.groupCount === 'auto' ? autoGroupCount(day.attendees.length) : Math.max(1, +day.groupCount || 1);
  const groups = Array.from({ length: Math.min(count, day.attendees.length) }, (_, index) => ({
    id: `G${index + 1}`, name: `Gruppe ${String.fromCharCode(65 + index)}`, players: [], matches: []
  }));
  const source = day.groupDrawMode === 'manual'
    ? [...day.attendees].sort((a, b) => (day.groupAssignments?.[a] ?? 999) - (day.groupAssignments?.[b] ?? 999))
    : day.groupDrawMode === 'seeded' ? seededGroupOrder(day.attendees) : shuffled(day.attendees);

  if (day.groupDrawMode === 'manual') {
    source.forEach(id => {
      const target = Math.max(0, Math.min(groups.length - 1, +(day.groupAssignments?.[id] ?? 0)));
      groups[target].players.push(id);
    });
  } else {
    source.forEach((id, index) => {
      const cycle = Math.floor(index / groups.length);
      const position = cycle % 2 === 0 ? index % groups.length : groups.length - 1 - (index % groups.length);
      groups[position].players.push(id);
    });
  }

  groups.forEach(group => {
    group.matches = roundRobinGroupMatches(group.players);
  });
  day.groups = groups;
  day.groupPhaseDone = false;
  day.ko = null;
}
function groupTable(group) {
  const rows = Object.fromEntries(group.players.map(id => [id, { id, mp: 0, wins: 0, legsFor: 0, legsAgainst: 0 }]));
  group.matches.forEach(match => {
    if (!match.completed) return;
    rows[match.p1].legsFor += match.legs1 || match.s1 || 0;
    rows[match.p1].legsAgainst += match.legs2 || match.s2 || 0;
    rows[match.p2].legsFor += match.legs2 || match.s2 || 0;
    rows[match.p2].legsAgainst += match.legs1 || match.s1 || 0;
    rows[match.winner].mp += 2;
    rows[match.winner].wins += 1;
  });
  return Object.values(rows).sort((a, b) =>
    b.mp - a.mp || (b.legsFor - b.legsAgainst) - (a.legsFor - a.legsAgainst) ||
    b.legsFor - a.legsFor || memberName(a.id).localeCompare(memberName(b.id), 'de')
  );
}
function allGroupsDone(day) {
  return day.groups.every(group => group.matches.every(match => match.completed));
}
function buildGroupsKO(day) {
  const qualified = [];
  day.groups.forEach(group => {
    const table = groupTable(group);
    (day.qualifyPlaces || [1, 2]).forEach(place => {
      const row = table[place - 1];
      if (row) qualified.push({ id: row.id, group: group.id, place });
    });
  });
  qualified.sort((a, b) => a.place - b.place);
  // Beste Platzierungen bekommen Freilose; gleiche Gruppen werden soweit möglich getrennt.
  const ordered = [];
  const remaining = [...qualified];
  while (remaining.length) {
    const first = remaining.shift();
    ordered.push(first.id);
    const opponentIndex = remaining.findIndex(x => x.group !== first.group && x.place !== first.place);
    if (opponentIndex >= 0) ordered.push(remaining.splice(opponentIndex, 1)[0].id);
  }
  day.ko = makeSingleElimination(qualified.map(x => x.id), ordered);
  day.ko.attendees = qualified.map(x => x.id);
  day.groupPhaseDone = true;
}
function groupOnlyResults(day, startPlace = 1, excludedIds = new Set()) {
  const tables = (day.groups || []).map(group => groupTable(group));
  const maxRows = Math.max(0, ...tables.map(table => table.length));
  const results = [];
  let nextPlace = startPlace;

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
    const cohort = tables
      .map(table => table[rowIndex])
      .filter(Boolean)
      .filter(row => !excludedIds.has(row.id));
    cohort.forEach(row => results.push({ ...row, place: nextPlace }));
    nextPlace += cohort.length;
  }
  return results;
}

function groupsResults(day) {
  if (!allGroupsDone(day)) return [];
  const qualifyCount = day.qualifyPlaces?.length || 0;

  // Ohne Weiterkommer endet das Turnier direkt mit der Gruppenplatzierung.
  // Gleiche Gruppenplätze erhalten dabei dieselbe Endplatzierung.
  if (qualifyCount === 0) return groupOnlyResults(day, 1);

  if (!day.groupPhaseDone || !day.ko) return [];
  const ko = { ...day, ...day.ko, attendees: day.ko.attendees || [] };
  const koRows = koResults(ko);
  const qualified = new Set(day.ko.attendees || []);
  const groupRows = (day.groups || []).flatMap(group => groupTable(group));

  // Gruppenstatistik in die K.-o.-Teilnehmer einrechnen.
  const groupById = Object.fromEntries(groupRows.map(row => [row.id, row]));
  koRows.forEach(row => {
    const group = groupById[row.id];
    if (!group) return;
    row.wins = (row.wins || 0) + (group.wins || 0);
    row.legsFor = (row.legsFor || 0) + (group.legsFor || 0);
    row.legsAgainst = (row.legsAgainst || 0) + (group.legsAgainst || 0);
  });

  // Nicht qualifizierte Spieler werden nach ihrem Gruppenplatz eingeordnet.
  // Spieler mit gleichem Gruppenplatz teilen sich dieselbe Endplatzierung.
  const eliminated = groupOnlyResults(day, qualified.size + 1, qualified);
  return [...koRows, ...eliminated];
}


function makeSwiss(ids, totalRounds = 4) {
  const day = {
    engine: 'swiss',
    attendees: [...ids],
    totalRounds: Math.max(1, +totalRounds || 4),
    swissRoundsData: []
  };
  pairSwissRound(day);
  return day;
}

function makeGroupsKO(ids, sourceDay = {}) {
  const day = {
    engine: 'groups',
    attendees: [...ids],
    groupCount: sourceDay.groupCount || 'auto',
    groupDrawMode: sourceDay.groupDrawMode || 'manual',
    groupAssignments: { ...(sourceDay.groupAssignments || {}) },
    qualifyPlaces: Array.isArray(sourceDay.qualifyPlaces)
      ? [...sourceDay.qualifyPlaces]
      : [1, 2],
    groupFormat: sourceDay.groupFormat || { format: 'legs', win: 3, legsPerSet: 3 },
    roundConfig: sourceDay.roundConfig || {},
    groups: [],
    groupPhaseDone: false,
    ko: null
  };
  setupGroups(day);
  return day;
}

// ---------- Doppel-K.-o. ----------
// Fester Doppel-K.-o.-Baum für 4 / 8 / 16 / 32 Spieler.
// Alle Spieler starten im Gewinnerbaum. Der Verlierer jeder WB-Partie wird
// automatisch an die fest vorgesehene Stelle im Verliererbaum weitergereicht.
// Erst die zweite Niederlage bedeutet das Ausscheiden. Das Grand Final besitzt
// den klassischen Reset: Gewinnt der LB-Sieger das erste Finale, folgt ein
// Entscheidungsspiel.

function doubleRoundName(matchCount, roundIndex, totalRounds) {
  if (roundIndex === totalRounds - 1) return 'Gewinner-Finale';
  if (matchCount === 16) return 'Sechzehntelfinale';
  if (matchCount === 8) return 'Achtelfinale';
  if (matchCount === 4) return 'Viertelfinale';
  if (matchCount === 2) return 'Halbfinale';
  return `Runde ${roundIndex + 1}`;
}

function makeDEMatch(bracket, roundIndex, index, p1 = null, p2 = null, source1 = null, source2 = null) {
  return {
    id: uid(), bracket, roundIndex, index,
    p1, p2, source1, source2,
    s1: null, s2: null, legs1: 0, legs2: 0,
    winner: null, loser: null, completed: false, bye: false,
    completedAt: null
  };
}

function makeDoubleKO(ids, fixedSize = null) {
  const players = shuffled(ids);
  const requestedSize = Number(fixedSize);
  const size = [4, 8, 16, 32].includes(requestedSize) ? requestedSize : powerOfTwo(players.length);
  if (players.length > size) throw new Error(`Für das ${size}er Feld sind höchstens ${size} Teilnehmer möglich.`);

  const slots = Array(size).fill(null);
  const byeCount = size - players.length;
  const matchCount = size / 2;

  // Freilose über den gesamten Baum verteilen, statt sie oben zu bündeln.
  // Dadurch entstehen gleichmäßigere Wege durch Gewinner- und Verliererbaum.
  const byeMatches = new Set();
  if (byeCount > 0) {
    for (let b = 0; b < byeCount; b++) {
      byeMatches.add(Math.floor((b + 0.5) * matchCount / byeCount));
    }
  }

  let playerIndex = 0;
  for (let m = 0; m < matchCount; m++) {
    slots[m * 2] = players[playerIndex++] || null;
    if (!byeMatches.has(m)) slots[m * 2 + 1] = players[playerIndex++] || null;
  }

  const wbRounds = [];
  const wbRoundCount = Math.log2(size);

  // Gewinnerbaum vollständig im Voraus anlegen.
  for (let r = 0; r < wbRoundCount; r++) {
    const count = size / Math.pow(2, r + 1);
    const matches = [];
    for (let i = 0; i < count; i++) {
      if (r === 0) {
        matches.push(makeDEMatch('winners', r, i, slots[i * 2], slots[i * 2 + 1]));
      } else {
        const prev = wbRounds[r - 1].matches;
        matches.push(makeDEMatch('winners', r, i, null, null,
          { matchId: prev[i * 2].id, outcome: 'winner' },
          { matchId: prev[i * 2 + 1].id, outcome: 'winner' }
        ));
      }
    }
    wbRounds.push({
      id: uid(),
      title: doubleRoundName(count, r, wbRoundCount),
      matches
    });
  }

  // Verliererbaum: 2 * log2(size) - 2 Runden.
  const lbRounds = [];
  const wbFirst = wbRounds[0].matches;
  const firstLB = [];
  for (let i = 0; i < wbFirst.length / 2; i++) {
    firstLB.push(makeDEMatch('losers', 0, i, null, null,
      { matchId: wbFirst[i * 2].id, outcome: 'loser' },
      { matchId: wbFirst[i * 2 + 1].id, outcome: 'loser' }
    ));
  }
  lbRounds.push({ id: uid(), title: 'Verliererbaum · Runde 1', matches: firstLB });

  let previousLB = firstLB;
  for (let wbIndex = 1; wbIndex < wbRounds.length; wbIndex++) {
    const wbMatches = wbRounds[wbIndex].matches;

    // Drop-Runde: LB-Überlebende treffen auf die neuen Verlierer aus dem WB.
    const dropMatches = [];
    for (let i = 0; i < wbMatches.length; i++) {
      // Gekreuzte Einspeisung: Der WB-Verlierer trifft nicht sofort wieder auf
      // den LB-Pfad aus demselben Teilbaum. So werden frühe Rückspiele vermieden.
      const lbSourceIndex = previousLB.length > 1 ? (i ^ 1) : i;
      dropMatches.push(makeDEMatch('losers', lbRounds.length, i, null, null,
        { matchId: previousLB[lbSourceIndex].id, outcome: 'winner' },
        { matchId: wbMatches[i].id, outcome: 'loser' }
      ));
    }
    lbRounds.push({ id: uid(), title: `Verliererbaum · Runde ${lbRounds.length + 1}`, matches: dropMatches });
    previousLB = dropMatches;

    // Zwischen den WB-Drops wird der Verliererbaum jeweils halbiert. Nach dem
    // WB-Finale entfällt diese Runde; die Drop-Runde ist bereits das LB-Finale.
    if (wbIndex < wbRounds.length - 1) {
      const reduceMatches = [];
      for (let i = 0; i < previousLB.length / 2; i++) {
        reduceMatches.push(makeDEMatch('losers', lbRounds.length, i, null, null,
          { matchId: previousLB[i * 2].id, outcome: 'winner' },
          { matchId: previousLB[i * 2 + 1].id, outcome: 'winner' }
        ));
      }
      lbRounds.push({ id: uid(), title: `Verliererbaum · Runde ${lbRounds.length + 1}`, matches: reduceMatches });
      previousLB = reduceMatches;
    }
  }

  const wbFinal = wbRounds.at(-1).matches[0];
  const lbFinal = lbRounds.at(-1).matches[0];
  const grandFinal = makeDEMatch('final', 0, 0, null, null,
    { matchId: wbFinal.id, outcome: 'winner' },
    { matchId: lbFinal.id, outcome: 'winner' }
  );

  const day = {
    engine: 'doubleko',
    byeCount,
    de: {
      version: 2,
      size,
      wbRounds,
      lbRounds,
      grandFinal,
      resetFinal: null,
      champion: null,
      losses: Object.fromEntries(players.map(id => [id, 0])),
      stats: Object.fromEntries(players.map(id => [id, { id, wins: 0, legsFor: 0, legsAgainst: 0, eliminatedAt: null }]))
    }
  };

  refreshDoubleKO(day);
  return day;
}

function allDoubleKOMatches(day) {
  if (!day?.de) return [];
  const rounds = [
    ...(day.de.wbRounds || []).flatMap(r => r.matches || []),
    ...(day.de.lbRounds || []).flatMap(r => r.matches || [])
  ];
  if (day.de.grandFinal) rounds.push(day.de.grandFinal);
  if (day.de.resetFinal) rounds.push(day.de.resetFinal);
  return rounds;
}

function findDoubleKOMatch(day, id) {
  return allDoubleKOMatches(day).find(match => match.id === id) || null;
}

function doubleSourceState(day, source) {
  if (!source) return { ready: true, player: null };
  const match = findDoubleKOMatch(day, source.matchId);
  if (!match || !match.completed) return { ready: false, player: null };
  return { ready: true, player: source.outcome === 'loser' ? match.loser : match.winner };
}

function resolveDoubleKOMatch(day, match) {
  if (!match || match.completed) return false;
  const a = match.source1 ? doubleSourceState(day, match.source1) : { ready: true, player: match.p1 };
  const b = match.source2 ? doubleSourceState(day, match.source2) : { ready: true, player: match.p2 };
  let changed = false;

  if (a.ready && match.p1 !== a.player) { match.p1 = a.player; changed = true; }
  if (b.ready && match.p2 !== b.player) { match.p2 = b.player; changed = true; }

  if (a.ready && b.ready && (!match.p1 || !match.p2)) {
    match.bye = true;
    match.completed = true;
    match.winner = match.p1 || match.p2 || null;
    match.loser = null;
    match.s1 = match.p1 ? 1 : 0;
    match.s2 = match.p2 ? 1 : 0;
    match.legs1 = 0;
    match.legs2 = 0;
    match.completedAt ||= new Date().toISOString();
    changed = true;
  }
  return changed;
}

function recomputeDoubleKOStats(day) {
  const ids = day.attendees || [];
  const stats = Object.fromEntries(ids.map(id => [id, { id, wins: 0, legsFor: 0, legsAgainst: 0, eliminatedAt: null }]));
  const losses = Object.fromEntries(ids.map(id => [id, 0]));

  const realMatches = allDoubleKOMatches(day)
    .filter(m => m.completed && !m.bye && m.p1 && m.p2 && m.winner && m.loser)
    .sort((a, b) => String(a.completedAt || '').localeCompare(String(b.completedAt || '')));

  realMatches.forEach((m, index) => {
    stats[m.winner] ||= { id: m.winner, wins: 0, legsFor: 0, legsAgainst: 0, eliminatedAt: null };
    stats[m.loser] ||= { id: m.loser, wins: 0, legsFor: 0, legsAgainst: 0, eliminatedAt: null };
    losses[m.winner] ??= 0;
    losses[m.loser] ??= 0;
    stats[m.winner].wins++;
    stats[m.p1].legsFor += Number(m.legs1 || m.s1 || 0);
    stats[m.p1].legsAgainst += Number(m.legs2 || m.s2 || 0);
    stats[m.p2].legsFor += Number(m.legs2 || m.s2 || 0);
    stats[m.p2].legsAgainst += Number(m.legs1 || m.s1 || 0);
    losses[m.loser]++;
    if (losses[m.loser] >= 2) stats[m.loser].eliminatedAt = index + 1;
  });

  day.de.stats = stats;
  day.de.losses = losses;
}

function refreshDoubleKO(day) {
  if (!day?.de?.wbRounds) return false;
  let changed = false;
  let guard = 0;
  do {
    changed = false;
    allDoubleKOMatches(day).forEach(match => {
      if (resolveDoubleKOMatch(day, match)) changed = true;
    });
    guard++;
  } while (changed && guard < 100);

  recomputeDoubleKOStats(day);

  const gf = day.de.grandFinal;
  const wbChampion = day.de.wbRounds.at(-1)?.matches?.[0]?.winner || null;
  if (gf?.completed && !gf.bye) {
    if (gf.winner === wbChampion) {
      day.de.champion = gf.winner;
      day.de.resetFinal = null;
    } else {
      if (!day.de.resetFinal) {
        day.de.resetFinal = makeDEMatch('reset', 0, 0, gf.p1, gf.p2);
      }
      if (day.de.resetFinal.completed) day.de.champion = day.de.resetFinal.winner;
    }
  }
  return true;
}

// Kompatibilitätshelfer für ältere Aufrufe innerhalb der Datei.
function continueCompletedDoubleKORounds(day) { return refreshDoubleKO(day); }
function doubleKORoundDone(day) { return Boolean(day?.de?.champion); }
function applyDoubleKORound(day) { return refreshDoubleKO(day); }

function doubleKOResults(day) {
  refreshDoubleKO(day);
  const champion = day.de.champion;
  if (!champion) return [];

  const results = [];
  const stats = day.de.stats || {};
  results.push({ ...stats[champion], place: 1 });

  const decidingFinal = day.de.resetFinal?.completed ? day.de.resetFinal : day.de.grandFinal;
  const runnerUp = decidingFinal?.loser || null;
  if (runnerUp && runnerUp !== champion && stats[runnerUp]) {
    results.push({ ...stats[runnerUp], place: 2 });
  }

  let nextPlace = 3;
  const alreadyPlaced = new Set(results.map(row => row.id));
  const lbRounds = [...(day.de.lbRounds || [])].reverse();
  lbRounds.forEach(round => {
    const cohort = (round.matches || [])
      .filter(match => match.completed && !match.bye && match.loser && !alreadyPlaced.has(match.loser))
      .map(match => stats[match.loser])
      .filter(Boolean);
    if (!cohort.length) return;
    cohort.forEach(row => {
      results.push({ ...row, place: nextPlace });
      alreadyPlaced.add(row.id);
    });
    nextPlace += cohort.length;
  });

  // Fallback für Sonderfälle mit Freilosen/alten gespeicherten Bäumen.
  Object.values(stats)
    .filter(row => !alreadyPlaced.has(row.id))
    .forEach(row => {
      results.push({ ...row, place: nextPlace });
      nextPlace += 1;
    });

  return results;
}

// ---------- Punkte ----------
function placementPoints(count, place) {
  const scale = count >= 13 ? [20, 15, 11, 9, 7, 6, 5, 4, 3, 2, 1]
    : count >= 9 ? [18, 13, 9, 7, 5, 4, 3, 2, 1]
    : count >= 5 ? [15, 10, 6, 4, 2, 1]
    : [10, 6, 3, 1];
  return scale[Math.min(place - 1, scale.length - 1)] || 1;
}
function dayResults(day) {
  if (day.mode === 'swiss') return swissResults(day);
  if (day.mode === 'groupsko') return groupsResults(day);
  if (day.mode === 'doubleko') return doubleKOResults(day);
  return koResults(day);
}
async function finishDay() {
  if (!canManage) return;
  const day = state.current;
  const currentSeason = season();
  if (!day || !currentSeason) return;
  const results = dayResults(day);
  if (!results.length) return toast('Das Turnier kann noch nicht abgeschlossen werden.');

  if (day.rankingEnabled !== false) {
    results.forEach(result => {
      const points = placementPoints(day.attendees.length, result.place);
      const base = currentSeason.ranking[result.id] || blankStats();
      base.points += points; base.days++; base.wins += result.wins || 0;
      base.titles += result.place === 1 ? 1 : 0;
      base.legsFor += result.legsFor || 0; base.legsAgainst += result.legsAgainst || 0;
      base.byMode ||= {};
      const byMode = base.byMode[day.mode] || blankStats();
      byMode.points += points; byMode.days++; byMode.wins += result.wins || 0;
      byMode.titles += result.place === 1 ? 1 : 0;
      byMode.legsFor += result.legsFor || 0; byMode.legsAgainst += result.legsAgainst || 0;
      base.byMode[day.mode] = byMode;
      base.history ||= [];
      base.history.push({ dayId: day.id, date: day.date, mode: day.mode, place: result.place, points, wins: result.wins || 0, legsFor: result.legsFor || 0, legsAgainst: result.legsAgainst || 0 });
      currentSeason.ranking[result.id] = base;
      result.points = points;
    });
  } else {
    results.forEach(result => result.points = 0);
  }

  const finished = { ...day, status: 'abgeschlossen', results, finishedAt: new Date().toISOString() };
  currentSeason.days.push(finished);
  state.current = null;
  treeSelectionId = finished.id;
  await save();
  toast(day.rankingEnabled === false ? 'Turnier abgeschlossen – ohne Ranglistenwertung.' : 'Turnier abgeschlossen und Rangliste aktualisiert.');
  selectTab('turnierbaum');
}
function rollbackDay(currentSeason, day) {
  if (day.rankingEnabled === false) return;
  (day.results || []).forEach(result => {
    const base = currentSeason.ranking[result.id];
    if (!base) return;
    const points = Number(result.points || placementPoints(day.attendees.length, result.place));
    base.points = Math.max(0, base.points - points);
    base.days = Math.max(0, base.days - 1);
    base.wins = Math.max(0, base.wins - (result.wins || 0));
    base.titles = Math.max(0, base.titles - (result.place === 1 ? 1 : 0));
    base.legsFor = Math.max(0, base.legsFor - (result.legsFor || 0));
    base.legsAgainst = Math.max(0, base.legsAgainst - (result.legsAgainst || 0));
    const bm = base.byMode?.[day.mode];
    if (bm) {
      bm.points = Math.max(0, bm.points - points); bm.days = Math.max(0, bm.days - 1);
      bm.wins = Math.max(0, bm.wins - (result.wins || 0));
      bm.titles = Math.max(0, bm.titles - (result.place === 1 ? 1 : 0));
      bm.legsFor = Math.max(0, bm.legsFor - (result.legsFor || 0));
      bm.legsAgainst = Math.max(0, bm.legsAgainst - (result.legsAgainst || 0));
    }
    base.history = (base.history || []).filter(h => h.dayId !== day.id);
  });
}

// ---------- Render ----------
function statFor(currentSeason, id, mode = 'all') {
  const base = currentSeason?.ranking?.[id] || blankStats();
  return mode === 'all' ? base : { ...blankStats(), ...(base.byMode?.[mode] || {}) };
}
function rankingRows(filter = $('modeFilter')?.value || 'all') {
  const currentSeason = season();
  return state.members.filter(m => isRankingEligible(m.id)).map(m => ({ m, st: statFor(currentSeason, m.id, filter) }))
    .sort((a, b) => b.st.points - a.st.points || b.st.titles - a.st.titles ||
      (b.st.legsFor - b.st.legsAgainst) - (a.st.legsFor - a.st.legsAgainst) ||
      a.m.name.localeCompare(b.m.name, 'de'));
}
function renderPermissions() {
  document.querySelectorAll('.admin-only').forEach(el => el.hidden = !canManage);
  document.querySelectorAll('[data-requires-manage]').forEach(el => {
    el.classList.toggle('locked-tab', !canManage);
    el.setAttribute('aria-disabled', canManage ? 'false' : 'true');
    el.title = canManage ? '' : 'Nur Admin, Captain oder Kassenwart';
  });
  const hint = $('seriesPermissionHint');
  if (hint) {
    hint.hidden = canManage;
    hint.textContent = login
      ? `Aktuelle Rolle: ${currentRole || 'gast'}. Nur Admins, Captains und Kassenwarte verwalten Turniere.`
      : 'Bitte anmelden. Nur Admins, Captains und Kassenwarte verwalten Turniere.';
  }
}
function renderSeason() {
  const currentSeason = season();
  $('seasonTitle').textContent = currentSeason ? `${currentSeason.name}${currentSeason.status === 'abgeschlossen' ? ' · Abgeschlossen' : ''}` : 'Keine Saison';
  $('seasonPickerButton').textContent = `${currentSeason?.name || 'Saison auswählen'} ▾`;
  $('seasonPickerMenu').innerHTML = state.seasons.map(item => `<button type="button" data-season-id="${item.id}" class="${item.id === state.activeSeasonId ? 'active' : ''}">${esc(item.name)}</button>`).join('');
  document.querySelectorAll('[data-season-id]').forEach(button => button.onclick = () => {
    state.activeSeasonId = button.dataset.seasonId;
    closeSeasonPicker(); renderAll();
  });
}
function renderRanking() {
  const rows = rankingRows();
  $('rankingBody').innerHTML = rows.length ? rows.map((row, i) => `<tr data-player="${row.m.id}"><td><strong>${i + 1}</strong></td><td><strong class="ranking-player">${memberAvatar(row.m.id, 'small')}<span>${esc(row.m.name)}</span></strong></td><td><strong>${row.st.points || 0}</strong></td><td>${row.st.legsFor || 0}</td><td>${row.st.legsAgainst || 0}</td><td>${(row.st.legsFor || 0) - (row.st.legsAgainst || 0)}</td></tr>`).join('') : '<tr><td colspan="6">Noch keine gewerteten Turnierergebnisse vorhanden.</td></tr>';
  document.querySelectorAll('[data-player]').forEach(row => row.onclick = () => openProfile(row.dataset.player));
}
function renderCreateParticipants() {
  const box = $('createParticipantsList');
  if (!box) return;

  // Auswahl beim Wechsel von Turnierart/Gruppenanzahl beibehalten.
  const previousSelected = new Set(
    [...box.querySelectorAll('[data-create-attend]:checked')].map(input => input.dataset.createAttend)
  );
  const previousAssignments = {};
  box.querySelectorAll('[data-group-assign]').forEach(select => previousAssignments[select.dataset.groupAssign] = +select.value);

  const groupMode = document.querySelector('input[name="tournamentType"]:checked')?.value === 'groupsko';
  const groupCount = Math.max(1, +($('createGroupCount')?.value || 1));
  box.innerHTML = state.members.length ? state.members.map(member => {
    const checked = previousSelected.has(member.id);
    const previousGroup = Number.isInteger(previousAssignments[member.id]) ? previousAssignments[member.id] : 0;
    const safeGroup = Math.min(Math.max(0, previousGroup), groupCount - 1);
    return `
    <label class="attendance-row create-attendance-row">
      <span class="participant-name">${esc(member.name)} <small>(${esc(member.rolle)})</small></span>
      <span class="participant-controls">
        ${groupMode ? `<select class="participant-group-select" data-group-assign="${member.id}" ${checked ? '' : 'disabled'} aria-label="Gruppe für ${esc(member.name)}">${Array.from({length: groupCount}, (_, index) => `<option value="${index}" ${index === safeGroup ? 'selected' : ''}>Gruppe ${String.fromCharCode(65 + index)}</option>`).join('')}</select>` : ''}
        <input type="checkbox" data-create-attend="${member.id}" ${checked ? 'checked' : ''}>
      </span>
    </label>`;
  }).join('') : '<p>Keine passenden Konten gefunden.</p>';
}

function allTreeDays() {
  const completed = [...(season()?.days || [])].slice().reverse();
  return [...(state.current ? [state.current] : []), ...completed];
}

function renderTreeSelector() {
  const select = $('treeDaySelect');
  if (!select) return;
  const days = allTreeDays();
  if (!days.length) {
    select.innerHTML = '<option value="">Noch kein Turnier vorhanden</option>';
    treeSelectionId = '';
    return;
  }
  if (treeSelectionId === 'current' && !state.current) treeSelectionId = days[0].id;
  if (treeSelectionId && treeSelectionId !== 'current' && !days.some(d => d.id === treeSelectionId)) treeSelectionId = state.current ? 'current' : days[0].id;
  select.innerHTML = days.map(day => {
    const value = state.current && day.id === state.current.id ? 'current' : day.id;
    const label = `${day.date} · ${MODES[day.mode] || day.mode}${day.rankingEnabled === false ? ' · ohne Wertung' : ''}${value === 'current' ? ' · läuft' : ''}`;
    return `<option value="${value}" ${value === treeSelectionId ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function selectedTreeDay() {
  if (treeSelectionId === 'current') return state.current;
  return (season()?.days || []).find(day => day.id === treeSelectionId) || null;
}

function participantPicker(day) {
  const selected = new Set(day.attendees || []);
  return `<div class="participant-picker"><h3>Teilnehmer auswählen</h3><p>Mitglieder, Captains, Kassenwarte und Admins können für diesen Spieltag ausgewählt werden.</p><div class="attendance-list">${state.members.map(member => `<label class="attendance-row"><span>${esc(member.name)} <small>(${esc(member.rolle)})</small></span><input type="checkbox" data-attend="${member.id}" ${selected.has(member.id) ? 'checked' : ''}></label>`).join('') || '<p>Keine Konten gefunden.</p>'}</div><div class="workspace-actions"><button id="saveParticipantsBtn">Auswahl speichern</button><button id="drawDayBtn" class="primary">Auslosen und starten</button></div></div>`;
}
function renderCurrent() {
  renderTreeSelector();
  const day = selectedTreeDay();
  const actions = $('currentDayAdminActions');
  const viewTabs = $('tournamentViewTabs');

  if (actions) actions.hidden = !(canManage && day && state.current && day.id === state.current.id);
  if (viewTabs) viewTabs.hidden = !day;

  if (!day) {
    $('currentDayTitle').textContent = 'Turnierbaum';
    $('currentDayInfo').textContent = 'Noch kein Turnier vorhanden.';
    $('currentStatus').textContent = 'Bereit';
    $('dayWorkspace').innerHTML = '<div class="empty-state">Erstelle zuerst ein Vereinsturnier.</div>';
    return;
  }

  const isCurrent = Boolean(state.current && day.id === state.current.id);
  treeReadOnly = !isCurrent;
  $('currentDayTitle').textContent = `${MODES[day.mode] || 'Turnier'} · ${day.date}`;
  $('currentDayInfo').textContent = `${(day.attendees || []).length} Teilnehmer · ${day.out || ''} · ${day.rankingEnabled === false ? 'ohne Ranglistenwertung' : 'mit Ranglistenwertung'}`;
  $('currentStatus').textContent = isCurrent ? 'Läuft' : 'Abgeschlossen';
  renderTournamentTree(day);
  if (treeReadOnly) $('dayWorkspace')?.querySelectorAll('.admin-only').forEach(el => el.hidden = true);
} 

function updateTournamentViewTabs() {
  $('resultsEntryTab')?.classList.toggle('active', tournamentView === 'results');
  $('tournamentTreeTab')?.classList.toggle('active', tournamentView === 'tree');
}

function setTournamentView(view) {
  tournamentView = view === 'tree' ? 'tree' : 'results';
  updateTournamentViewTabs();
  renderCurrent();
}

function renderResultsEntry(day) {
  if (day.mode === 'swiss') renderSwissResults(day);
  else if (day.mode === 'groupsko') renderGroupsResults(day);
  else if (day.mode === 'doubleko') renderDoubleKOResults(day);
  else renderKOResults(day);
}

function renderTournamentTree(day) {
  if (day.mode === 'swiss') renderSwissTree(day);
  else if (day.mode === 'groupsko') renderGroupsTree(day);
  else if (day.mode === 'doubleko') renderDoubleKOTree(day);
  else renderKOTree(day);
}

function resultCard(match, config, prefix, saveAttribute, saveValue, label = '') {
  if (match.bye) {
    return `<article class="result-entry-card bye-card">
      <div><small>${esc(label)}</small><strong>${esc(memberName(match.p1 || match.winner))}</strong></div>
      <span>Freilos – automatisch weiter</span>
    </article>`;
  }
  if (!match.p1 || !match.p2 || match.completed) return '';
  return `<article class="result-entry-card">
    <div class="result-entry-title"><small>${esc(label)}</small><strong>${esc(memberName(match.p1))} gegen ${esc(memberName(match.p2))}</strong></div>
    ${scoreInputs(match, config, prefix)}
    <button ${saveAttribute}="${saveValue}" ${!canManage ? 'disabled' : ''}>Ergebnis speichern</button>
  </article>`;
}

function renderKOResults(day) {
  advanceKO(day);
  const cards = [];
  day.rounds.forEach(round => {
    day.matches[round].forEach((match, index) => {
      if (match.bye && match.completed) return;
      const config = roundConfigFor(day, round);
      const card = resultCard(match, config, `ko-${match.id}`, 'data-ko-save', `${round}|${index}`, round);
      if (card) cards.push(card);
    });
  });

  const final = day.matches[day.rounds.at(-1)][0];
  $('dayWorkspace').innerHTML = `
    <div class="result-entry-header"><h3>Offene Partien</h3><span>${cards.length} offen</span></div>
    <div class="result-entry-list">${cards.join('') || '<div class="empty-state">Zurzeit ist keine Partie zur Eingabe bereit.</div>'}</div>
    <div class="workspace-actions admin-only">
      <button id="finishCurrent" class="primary" ${final?.completed ? '' : 'disabled'}>Spieltag abschließen</button>
    </div>`;
  document.querySelectorAll('[data-ko-save]').forEach(button => button.onclick = () => saveKOMatch(button.dataset.koSave));
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}

function renderSwissResults(day) {
  const roundNumber = day.swissRoundsData.length;
  const matches = day.swissRoundsData.at(-1) || [];
  const config = day.swissFormat || { format: 'legs', win: day.legsToWin || 3, legsPerSet: 3 };
  const cards = matches.map((match, index) =>
    resultCard(match, config, `sw-${match.id}`, 'data-sw-save', index, `Runde ${roundNumber}`)
  ).filter(Boolean);
  const done = matches.every(match => match.completed);

  $('dayWorkspace').innerHTML = `
    <div class="result-entry-header"><h3>Schweizer Runde ${roundNumber} von ${day.totalRounds}</h3><span>${cards.length} offen</span></div>
    <div class="result-entry-list">${cards.join('') || '<div class="empty-state">Alle Ergebnisse dieser Runde sind eingetragen.</div>'}</div>
    <div class="workspace-actions admin-only">
      ${roundNumber < day.totalRounds
        ? `<button id="nextSwiss" class="primary" ${done ? '' : 'disabled'}>Nächste Runde auslosen</button>`
        : `<button id="finishCurrent" class="primary" ${done ? '' : 'disabled'}>Spieltag abschließen</button>`}
    </div>`;
  document.querySelectorAll('[data-sw-save]').forEach(button => button.onclick = () => saveSwissMatch(+button.dataset.swSave));
  if ($('nextSwiss')) $('nextSwiss').onclick = async () => { pairSwissRound(day); await save(); };
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}

function renderGroupsResults(day) {
  if (!day.groupPhaseDone) {
    const config = day.groupFormat || { format: 'legs', win: day.groupLegsToWin || 3, legsPerSet: 3 };
    const cards = [];
    day.groups.forEach((group, gi) => {
      group.matches.forEach((match, mi) => {
        const card = resultCard(match, config, `gr-${match.id}`, 'data-gr-save', `${gi}|${mi}`, group.name);
        if (card) cards.push(card);
      });
    });
    $('dayWorkspace').innerHTML = `
      <div class="result-entry-header"><h3>Gruppenphase – offene Partien</h3><span>${cards.length} offen</span></div>
      <div class="result-entry-list">${cards.join('') || '<div class="empty-state">Alle Gruppenspiele sind eingetragen.</div>'}</div>
      <div class="workspace-actions admin-only">
        <button id="startGroupsKO" class="primary" ${allGroupsDone(day) ? '' : 'disabled'}>K.-o.-Phase auslosen</button>
      </div>`;
    document.querySelectorAll('[data-gr-save]').forEach(button => button.onclick = () => saveGroupMatch(button.dataset.grSave));
    if ($('startGroupsKO')) $('startGroupsKO').onclick = async () => { buildGroupsKO(day); await save(); };
    return;
  }

  const cards = [];
  day.ko.rounds.forEach(round => {
    day.ko.matches[round].forEach((match, index) => {
      const config = roundConfigFor(day, round);
      const card = resultCard(match, config, `gko-${match.id}`, 'data-gko-save', `${round}|${index}`, round);
      if (card) cards.push(card);
    });
  });
  const final = day.ko.matches[day.ko.rounds.at(-1)][0];
  $('dayWorkspace').innerHTML = `
    <div class="result-entry-header"><h3>K.-o.-Phase – offene Partien</h3><span>${cards.length} offen</span></div>
    <div class="result-entry-list">${cards.join('') || '<div class="empty-state">Zurzeit ist keine Partie zur Eingabe bereit.</div>'}</div>
    <div class="workspace-actions admin-only">
      <button id="finishCurrent" class="primary" ${final?.completed ? '' : 'disabled'}>Spieltag abschließen</button>
    </div>`;
  document.querySelectorAll('[data-gko-save]').forEach(button => button.onclick = () => saveGroupKOMatch(button.dataset.gkoSave));
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}

function renderDoubleKOResults(day) {
  refreshDoubleKO(day);
  const open = allDoubleKOMatches(day).filter(match =>
    !match.completed && match.p1 && match.p2
  );
  if (day.de.champion) {
    $('dayWorkspace').innerHTML = `<div class="empty-state"><h2>Sieger: ${esc(memberName(day.de.champion))}</h2><p>Das Doppel-K.-o.-Turnier ist beendet.</p></div>`;
    return;
  }
  const config = doubleRoundConfig(day);
  $('dayWorkspace').innerHTML = `
    <div class="result-entry-header"><h3>Offene Doppel-K.-o.-Spiele</h3><span>${open.length} offen</span></div>
    <div class="result-entry-list">${open.map(match =>
      resultCard(match, config, `de-${match.id}`, 'data-de-save', match.id,
        match.bracket === 'winners' ? 'Gewinnerbaum' : match.bracket === 'losers' ? 'Verliererbaum' : match.bracket === 'reset' ? 'Reset-Finale' : 'Grand Final')
    ).join('') || '<div class="empty-state">Aktuell ist keine Partie bereit.</div>'}</div>`;
  document.querySelectorAll('[data-de-save]').forEach(button => button.onclick = () => saveDoubleKOMatch(button.dataset.deSave));
}

function treeMatchCard(match, options = {}) {
  const {
    editable = false,
    prefix = `tree-${match.id}`,
    saveAttr = '',
    saveValue = '',
    label = ''
  } = options;

  const p1 = match.p1 ? memberName(match.p1) : 'Offen';
  const p2 = match.p2 ? memberName(match.p2) : 'Offen';
  const winnerClass1 = match.winner === match.p1 ? 'tree-winner' : '';
  const winnerClass2 = match.winner === match.p2 ? 'tree-winner' : '';
  const ready = Boolean(match.p1 && match.p2);
  const canEditMatch = editable && canManage && !treeReadOnly && ready && !match.completed;
  const sourceStates = [match.source1, match.source2].map(source => source ? {
    source,
    match: findDoubleKOMatch(state.current || {}, source.matchId)
  } : null);
  const virtualBye1 = !match.p1 && sourceStates[0]?.source?.outcome === 'loser' && sourceStates[0]?.match?.completed && sourceStates[0]?.match?.bye;
  const virtualBye2 = !match.p2 && sourceStates[1]?.source?.outcome === 'loser' && sourceStates[1]?.match?.completed && sourceStates[1]?.match?.bye;

  const byeIdentity = () => `<span class="de-bye-player"><span class="bye-avatar" aria-hidden="true">→</span><span class="bye-label">FREILOS</span></span>`;
  const waitingIdentity = () => `<span class="de-bye-player de-waiting-row"><span class="de-waiting-dot" aria-hidden="true">·</span><span>Offen</span></span>`;

  if (match.bye) {
    const realPlayer = match.winner || match.p1 || match.p2;

    // Wenn beide Zuführungen leer sind, gibt es keine Partie.
    // Der Pfad bleibt nur als Strukturhinweis sichtbar.
    if (!realPlayer) {
      return `<article class="tree-match de-dead-path">
        ${label ? `<small>${esc(label)}</small>` : ''}
        <div class="de-dead-path-icon" aria-hidden="true">×</div>
        <strong>Pfad entfällt</strong>
        <small>Keine Partie – beide Zuführungen sind leer.</small>
      </article>`;
    }

    return `<article class="tree-match bye-card">
      ${label ? `<small>${esc(label)}</small>` : ''}
      <div class="tree-player tree-winner">${playerIdentity(realPlayer, 'small')}</div>
      <div class="tree-player de-bye-row">${byeIdentity()}</div>
      <small>Automatisch weiter</small>
    </article>`;
  }

  return `<article class="tree-match ${canEditMatch ? 'tree-match-editable' : ''}">
    ${label ? `<small>${esc(label)}</small>` : ''}
    <div class="tree-player ${winnerClass1}">
      ${match.p1 ? playerIdentity(match.p1, 'small') : (virtualBye1 ? byeIdentity() : waitingIdentity())}
      ${canEditMatch
        ? `<input id="${prefix}-s1" type="number" min="0" inputmode="numeric" value="${match.s1 ?? ''}">`
        : `<b>${match.completed ? match.s1 : ''}</b>`}
    </div>
    <div class="tree-player ${winnerClass2}">
      ${match.p2 ? playerIdentity(match.p2, 'small') : (virtualBye2 ? byeIdentity() : waitingIdentity())}
      ${canEditMatch
        ? `<input id="${prefix}-s2" type="number" min="0" inputmode="numeric" value="${match.s2 ?? ''}">`
        : `<b>${match.completed ? match.s2 : ''}</b>`}
    </div>
    ${canEditMatch ? `<button class="tree-save-button" ${saveAttr}="${saveValue}">Ergebnis speichern</button>` : ''}
    ${match.completed
      ? `<small>Ergebnis ${match.s1}:${match.s2}</small>`
      : (!ready ? '<small>Wartet auf vorherige Partie</small>' : '')}
  </article>`;
}

function renderKOTree(day) {
  advanceKO(day);
  $('dayWorkspace').innerHTML = `
    <div class="tournament-tree-scroll">
      <div class="tournament-tree">
        ${day.rounds.map(round => `
          <section class="tree-round">
            <h3>${esc(round)}</h3>
            ${day.matches[round].map((match, index) => treeMatchCard(match, {
              editable: true,
              prefix: `ko-${match.id}`,
              saveAttr: 'data-ko-save',
              saveValue: `${round}|${index}`,
              label: round
            })).join('')}
          </section>`).join('')}
      </div>
    </div>
    <div class="workspace-actions admin-only">
      <button id="finishCurrent" class="primary" ${
        day.matches[day.rounds.at(-1)][0]?.completed ? '' : 'disabled'
      }>Spieltag abschließen</button>
    </div>`;

  document.querySelectorAll('[data-ko-save]').forEach(button => {
    button.onclick = () => saveKOMatch(button.dataset.koSave);
  });
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}

function renderSwissTree(day) {
  const standings = swissStats(day);
  const currentRoundIndex = day.swissRoundsData.length - 1;

  $('dayWorkspace').innerHTML = `
    <div class="swiss-tree-layout">
      <section>
        <h3>Aktuelle Tabelle</h3>
        <div class="table-scroll">
          <table class="swiss-table">
            <thead><tr><th>#</th><th>Spieler</th><th>MP</th><th>Buchholz</th><th>Siege</th><th>Diff.</th></tr></thead>
            <tbody>${standings.map((row, i) => `
              <tr><td>${i+1}</td><td>${playerIdentity(row.id, 'small')}</td><td>${row.mp}</td>
              <td>${row.buchholz}</td><td>${row.wins}</td><td>${row.legsFor-row.legsAgainst}</td></tr>`
            ).join('')}</tbody>
          </table>
        </div>
      </section>
      <section class="swiss-round-history">
        <h3>Runden und Paarungen</h3>
        ${day.swissRoundsData.map((round, ri) => `
          <div class="swiss-tree-round">
            <h4>Runde ${ri+1}</h4>
            ${round.map((match, index) => treeMatchCard(match, {
              editable: ri === currentRoundIndex,
              prefix: `sw-${match.id}`,
              saveAttr: 'data-sw-save',
              saveValue: index,
              label: `Runde ${ri+1}`
            })).join('')}
          </div>`).join('')}
      </section>
    </div>
    <div class="workspace-actions admin-only">
      ${day.swissRoundsData.at(-1)?.every(match => match.completed)
        ? (day.swissRoundsData.length < day.totalRounds
          ? '<button id="nextSwiss" class="primary">Nächste Runde auslosen</button>'
          : '<button id="finishCurrent" class="primary">Spieltag abschließen</button>')
        : ''}
    </div>`;

  document.querySelectorAll('[data-sw-save]').forEach(button => {
    button.onclick = () => saveSwissMatch(+button.dataset.swSave);
  });
  if ($('nextSwiss')) $('nextSwiss').onclick = async () => { pairSwissRound(day); await save(); };
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}

async function updateRunningGroupQualifiers(day, value) {
  if (!canManage || treeReadOnly || day.groupPhaseDone) return;
  const maxQualify = Math.min(...(day.groups || []).map(group => group.players?.length || 0));
  const count = Math.max(0, Math.min(maxQualify, Number(value) || 0));
  day.qualifyPlaces = Array.from({ length: count }, (_, index) => index + 1);
  day.bracketSize = count > 0 ? powerOfTwo((day.groups?.length || 1) * count) : 0;
  await save();
  toast(count === 0 ? 'Keine Weiterkommer: Die Gruppenplatzierung ist das Endergebnis.' : `${count} ${count === 1 ? 'Spieler kommt' : 'Spieler kommen'} pro Gruppe weiter.`);
}

function runningGroupQualifyControl(day) {
  if (day.groupPhaseDone) return '';
  const minGroupSize = Math.min(...(day.groups || []).map(group => group.players?.length || 0));
  const current = day.qualifyPlaces?.length || 0;
  const options = Array.from({ length: minGroupSize + 1 }, (_, value) =>
    `<option value="${value}" ${value === current ? 'selected' : ''}>${value === 0 ? 'Niemand – nur Gruppenwertung' : `${value} pro Gruppe`}</option>`
  ).join('');
  return `<div class="running-group-config admin-only">
    <label><span>Weiterkommen nach der Gruppenphase</span>
      <select id="runningQualifyCount" ${!canManage || treeReadOnly ? 'disabled' : ''}>${options}</select>
    </label>
    <small>${current === 0 ? 'Das Turnier endet nach der Gruppenphase.' : 'Kann bis zum Start der K.-o.-Phase geändert werden.'}</small>
  </div>`;
}

function renderGroupsTree(day) {
  const groupHtml = `<div class="groups-grid">${day.groups.map((group, gi) => `
    <section class="group-card">
      <h3>${esc(group.name)}</h3>
      <table>
        <thead><tr><th>#</th><th>Spieler</th><th>MP</th><th>Diff.</th></tr></thead>
        <tbody>${groupTable(group).map((row,i)=>`
          <tr class="${i < (day.qualifyPlaces?.length || 0) ? 'qualified-row' : ''}"><td>${i+1}</td><td>${playerIdentity(row.id, 'small')}</td><td>${row.mp}</td>
          <td>${row.legsFor-row.legsAgainst}</td></tr>`).join('')}</tbody>
      </table>
      <div class="group-tree-matches">
        ${group.matches.map((match, mi) => treeMatchCard(match, {
          editable: !day.groupPhaseDone,
          prefix: `gr-${match.id}`,
          saveAttr: 'data-gr-save',
          saveValue: `${gi}|${mi}`,
          label: group.name
        })).join('')}
      </div>
    </section>`).join('')}</div>`;

  if (!day.groupPhaseDone || !day.ko) {
    const qualifyCount = day.qualifyPlaces?.length || 0;
    const groupsDone = allGroupsDone(day);
    $('dayWorkspace').innerHTML = `${runningGroupQualifyControl(day)}${groupHtml}
      <div class="workspace-actions admin-only">
        ${qualifyCount === 0
          ? `<button id="finishGroupsOnly" class="primary" ${groupsDone ? '' : 'disabled'}>Gruppenturnier abschließen</button>`
          : `<button id="startGroupsKO" class="primary" ${groupsDone ? '' : 'disabled'}>K.-o.-Phase auslosen</button>`}
      </div>`;
    document.querySelectorAll('[data-gr-save]').forEach(button => {
      button.onclick = () => saveGroupMatch(button.dataset.grSave);
    });
    $('runningQualifyCount')?.addEventListener('change', event => updateRunningGroupQualifiers(day, event.target.value));
    if ($('startGroupsKO')) $('startGroupsKO').onclick = async () => {
      buildGroupsKO(day);
      await save();
    };
    if ($('finishGroupsOnly')) $('finishGroupsOnly').onclick = finishDay;
    return;
  }

  $('dayWorkspace').innerHTML = `${groupHtml}
    <h2 class="ko-tree-heading">K.-o.-Baum</h2>
    <div class="tournament-tree-scroll">
      <div class="tournament-tree">
        ${day.ko.rounds.map(round => `
          <section class="tree-round">
            <h3>${esc(round)}</h3>
            ${day.ko.matches[round].map((match, index) => treeMatchCard(match, {
              editable: true,
              prefix: `gko-${match.id}`,
              saveAttr: 'data-gko-save',
              saveValue: `${round}|${index}`,
              label: round
            })).join('')}
          </section>`).join('')}
      </div>
    </div>
    <div class="workspace-actions admin-only">
      <button id="finishCurrent" class="primary" ${
        day.ko.matches[day.ko.rounds.at(-1)][0]?.completed ? '' : 'disabled'
      }>Spieltag abschließen</button>
    </div>`;

  document.querySelectorAll('[data-gko-save]').forEach(button => {
    button.onclick = () => saveGroupKOMatch(button.dataset.gkoSave);
  });
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}

function doubleTreeRound(round, bracketLabel) {
  return `<section class="tree-round de-tree-round" data-de-round="${round.matches?.[0]?.roundIndex ?? 0}">
    <h3>${esc(round.title)}</h3>
    ${(round.matches || []).map(match => treeMatchCard(match, {
      editable: true,
      prefix: `de-${match.id}`,
      saveAttr: 'data-de-save',
      saveValue: match.id,
      label: ''
    })).join('')}
  </section>`;
}

function renderDoubleKOTree(day) {
  if (!day?.de?.wbRounds) {
    $('dayWorkspace').innerHTML = '<div class="empty-state"><h2>Älterer Doppel-K.-o.-Spieltag</h2><p>Dieser Spieltag wurde mit einer älteren Baum-Version erstellt. Bitte für den neuen festen Gewinner-/Verliererbaum ein neues Turnier anlegen.</p></div>';
    return;
  }

  refreshDoubleKO(day);
  const wb = day.de.wbRounds || [];
  const lb = day.de.lbRounds || [];
  const gf = day.de.grandFinal;
  const reset = day.de.resetFinal;
  const size = day.de.size || day.bracketSize || 0;

  $('dayWorkspace').innerHTML = `
    <div class="de-bracket-shell de-size-${size}">
      <section class="double-tree-section winners-tree-section">
        <div class="double-tree-heading">
          <div><span class="de-kicker">0 Niederlagen</span><h2>Gewinnerbaum</h2></div>
          <small>Verlierer rücken automatisch in den Verliererbaum.</small>
        </div>
        <div class="tournament-tree-scroll"><div class="tournament-tree de-tree winners-tree">
          ${wb.map(round => doubleTreeRound(round, 'Gewinnerbaum')).join('')}
        </div></div>
      </section>

      <section class="double-tree-section losers-tree-section">
        <div class="double-tree-heading">
          <div><span class="de-kicker">1 Niederlage</span><h2>Verliererbaum</h2></div>
          <small>Wer hier verliert, scheidet mit der zweiten Niederlage aus.</small>
        </div>
        <div class="tournament-tree-scroll"><div class="tournament-tree de-tree losers-tree">
          ${lb.map(round => doubleTreeRound(round, 'Verliererbaum')).join('')}
        </div></div>
      </section>

      <section class="double-tree-section final-tree-section">
        <div class="double-tree-heading">
          <div><span class="de-kicker">Finale</span><h2>Grand Final</h2></div>
          <small>${reset ? 'Reset nötig: Beide Finalisten haben jetzt eine Niederlage.' : 'Gewinnt der LB-Sieger, wird automatisch ein Reset-Finale erzeugt.'}</small>
        </div>
        <div class="de-finals-grid">
          ${treeMatchCard(gf, { editable: true, prefix: `de-${gf.id}`, saveAttr: 'data-de-save', saveValue: gf.id, label: 'Grand Final' })}
          ${reset ? treeMatchCard(reset, { editable: true, prefix: `de-${reset.id}`, saveAttr: 'data-de-save', saveValue: reset.id, label: 'Reset-Finale · Entscheidung' }) : ''}
        </div>
      </section>
    </div>

    <div class="workspace-actions admin-only">
      <button id="finishCurrent" class="primary" ${day.de.champion ? '' : 'disabled'}>Turnier abschließen</button>
    </div>`;

  document.querySelectorAll('[data-de-save]').forEach(button => {
    button.onclick = () => saveDoubleKOMatch(button.dataset.deSave);
  });
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}

function scoreInputs(match, config, prefix) {
  const disabled = match.completed || !canManage;
  const setsExtra = config.format === 'sets' ? `<div class="two-cols compact"><label>Gesamtlegs ${esc(memberName(match.p1))}<input id="${prefix}-l1" type="number" min="0" value="${match.legs1 || ''}" ${disabled ? 'disabled' : ''}></label><label>Gesamtlegs ${esc(memberName(match.p2))}<input id="${prefix}-l2" type="number" min="0" value="${match.legs2 || ''}" ${disabled ? 'disabled' : ''}></label></div>` : '';
  const scoreHint = config.format === 'sets' ? `<small>${formatLabel(config)}</small>` : '<small>Ergebnis eintragen</small>';
  return `${scoreHint}<div class="match-player"><span>${esc(memberName(match.p1))}</span><input id="${prefix}-s1" type="number" min="0" value="${match.s1 ?? ''}" ${disabled ? 'disabled' : ''}></div><div class="match-player"><span>${esc(memberName(match.p2))}</span><input id="${prefix}-s2" type="number" min="0" value="${match.s2 ?? ''}" ${disabled ? 'disabled' : ''}></div>${setsExtra}`;
}
function readMatchScore(prefix, config) {
  const a = +$(`${prefix}-s1`).value, b = +$(`${prefix}-s2`).value;
  if (!validateScore(a, b, config)) return null;
  const [legs1, legs2] = totalLegsFromScore(a, b, config, $(`${prefix}-l1`)?.value, $(`${prefix}-l2`)?.value);
  if (config.format === 'sets' && legs1 + legs2 <= 0) return null;
  return { a, b, legs1, legs2 };
}
function renderKOEditor(day) {
  advanceKO(day);
  $('dayWorkspace').innerHTML = `<div class="bracket">${day.rounds.map(round => `<div class="round-column"><h3>${round}</h3>${day.matches[round].map((match, index) => {
    if (match.bye) return `<article class="match-card"><strong>${esc(memberName(match.winner))}</strong><p>Freilos – automatisch weiter</p></article>`;
    if (!match.p1 || !match.p2) return '<article class="match-card"><p>Wartet auf vorherige Partie</p></article>';
    const config = roundConfigFor(day, round), prefix = `ko-${match.id}`;
    return `<article class="match-card">${scoreInputs(match, config, prefix)}<button data-ko-save="${round}|${index}" ${match.completed || !canManage ? 'disabled' : ''}>Ergebnis speichern</button></article>`;
  }).join('')}</div>`).join('')}</div><div class="workspace-actions admin-only"><button id="finishCurrent" class="primary">Spieltag abschließen</button></div>`;
  document.querySelectorAll('[data-ko-save]').forEach(button => button.onclick = () => saveKOMatch(button.dataset.koSave));
  const final = day.matches[day.rounds.at(-1)][0];
  $('finishCurrent').disabled = !final?.completed;
  $('finishCurrent').onclick = finishDay;
}
async function saveKOMatch(key) {
  const [round, indexString] = key.split('|');
  const match = state.current.matches[round][+indexString];
  const config = roundConfigFor(state.current, round), prefix = `ko-${match.id}`;
  const score = readMatchScore(prefix, config);
  if (!score) return toast('Bitte ein gültiges eindeutiges Ergebnis eintragen.');
  Object.assign(match, { s1: score.a, s2: score.b, legs1: score.legs1, legs2: score.legs2, firstTo: Math.max(score.a, score.b), winner: score.a > score.b ? match.p1 : match.p2, loser: score.a > score.b ? match.p2 : match.p1, completed: true });
  advanceKO(state.current); await save();
}
function renderSwissEditor(day) {
  const standings = swissStats(day), round = day.swissRoundsData.length, matches = day.swissRoundsData.at(-1) || [];
  const done = matches.every(m => m.completed);
  const config = day.swissFormat || { format: 'legs', win: day.legsToWin || 3, legsPerSet: 3 };
  $('dayWorkspace').innerHTML = `<div class="table-scroll"><table class="swiss-table"><thead><tr><th>#</th><th>Spieler</th><th>MP</th><th>Buchholz</th><th>Siege</th><th>Diff.</th></tr></thead><tbody>${standings.map((row, i) => `<tr><td>${i + 1}</td><td>${playerIdentity(row.id, 'small')}</td><td>${row.mp}</td><td>${row.buchholz}</td><td>${row.wins}</td><td>${row.legsFor - row.legsAgainst}</td></tr>`).join('')}</tbody></table></div><h3>Runde ${round} von ${day.totalRounds}</h3>${matches.map((match, index) => {
    if (match.bye) return `<article class="swiss-match"><strong>${esc(memberName(match.p1))}</strong> – Freilos</article>`;
    const prefix = `sw-${match.id}`;
    return `<article class="swiss-match">${scoreInputs(match, config, prefix)}<button data-sw-save="${index}" ${match.completed || !canManage ? 'disabled' : ''}>Ergebnis speichern</button></article>`;
  }).join('')}<div class="workspace-actions admin-only">${round < day.totalRounds ? `<button id="nextSwiss" class="primary" ${done ? '' : 'disabled'}>Nächste Runde auslosen</button>` : `<button id="finishCurrent" class="primary" ${done ? '' : 'disabled'}>Spieltag abschließen</button>`}</div>`;
  document.querySelectorAll('[data-sw-save]').forEach(button => button.onclick = () => saveSwissMatch(+button.dataset.swSave));
  if ($('nextSwiss')) $('nextSwiss').onclick = async () => { pairSwissRound(day); await save(); };
  if ($('finishCurrent')) $('finishCurrent').onclick = finishDay;
}
async function saveSwissMatch(index) {
  const day = state.current, match = day.swissRoundsData.at(-1)[index];
  const config = day.swissFormat || { format: 'legs', win: day.legsToWin || 3, legsPerSet: 3 };
  const score = readMatchScore(`sw-${match.id}`, config);
  if (!score) return toast('Bitte ein gültiges Ergebnis eintragen.');
  Object.assign(match, { s1: score.a, s2: score.b, legs1: score.legs1, legs2: score.legs2, winner: score.a > score.b ? match.p1 : match.p2, loser: score.a > score.b ? match.p2 : match.p1, completed: true });
  await save();
}
function renderGroupsEditor(day) {
  if (!day.groupPhaseDone) {
    const config = day.groupFormat || { format: 'legs', win: day.groupLegsToWin || 3, legsPerSet: 3 };
    $('dayWorkspace').innerHTML = `<div class="groups-grid">${day.groups.map((group, gi) => `<section class="group-card"><h3>${group.name}</h3><table><thead><tr><th>#</th><th>Spieler</th><th>MP</th><th>Diff.</th></tr></thead><tbody>${groupTable(group).map((row, i) => `<tr><td>${i + 1}</td><td>${playerIdentity(row.id, 'small')}</td><td>${row.mp}</td><td>${row.legsFor - row.legsAgainst}</td></tr>`).join('')}</tbody></table>${group.matches.map((match, mi) => {
      const prefix = `gr-${match.id}`;
      return `<article class="swiss-match">${scoreInputs(match, config, prefix)}<button data-gr-save="${gi}|${mi}" ${match.completed || !canManage ? 'disabled' : ''}>Ergebnis speichern</button></article>`;
    }).join('')}</section>`).join('')}</div><div class="workspace-actions admin-only"><button id="startGroupsKO" class="primary" ${allGroupsDone(day) ? '' : 'disabled'}>K.-o.-Phase auslosen</button></div>`;
    document.querySelectorAll('[data-gr-save]').forEach(button => button.onclick = () => saveGroupMatch(button.dataset.grSave));
    $('startGroupsKO').onclick = async () => { buildGroupsKO(day); await save(); };
  } else {
    const koDay = { ...day, ...day.ko };
    // Render mit Originalreferenzen, damit Speichern in day.ko landet.
    advanceKO(koDay); day.ko.matches = koDay.matches;
    $('dayWorkspace').innerHTML = `<h2>K.-o.-Phase</h2><div class="bracket">${day.ko.rounds.map(round => `<div class="round-column"><h3>${round}</h3>${day.ko.matches[round].map((match, index) => {
      if (match.bye) return `<article class="match-card"><strong>${esc(memberName(match.winner))}</strong><p>Freilos – automatisch weiter</p></article>`;
      if (!match.p1 || !match.p2) return '<article class="match-card"><p>Wartet auf vorherige Partie</p></article>';
      const config = roundConfigFor(day, round), prefix = `gko-${match.id}`;
      return `<article class="match-card">${scoreInputs(match, config, prefix)}<button data-gko-save="${round}|${index}" ${match.completed || !canManage ? 'disabled' : ''}>Ergebnis speichern</button></article>`;
    }).join('')}</div>`).join('')}</div><div class="workspace-actions admin-only"><button id="finishCurrent" class="primary">Spieltag abschließen</button></div>`;
    document.querySelectorAll('[data-gko-save]').forEach(button => button.onclick = () => saveGroupKOMatch(button.dataset.gkoSave));
    $('finishCurrent').disabled = !day.ko.matches[day.ko.rounds.at(-1)][0]?.completed;
    $('finishCurrent').onclick = finishDay;
  }
}
async function saveGroupMatch(key) {
  const [gi, mi] = key.split('|').map(Number), day = state.current, match = day.groups[gi].matches[mi];
  const config = day.groupFormat || { format: 'legs', win: day.groupLegsToWin || 3, legsPerSet: 3 };
  const score = readMatchScore(`gr-${match.id}`, config);
  if (!score) return toast('Bitte ein gültiges Ergebnis eintragen.');
  Object.assign(match, { s1: score.a, s2: score.b, legs1: score.legs1, legs2: score.legs2, winner: score.a > score.b ? match.p1 : match.p2, completed: true });
  await save();
}
async function saveGroupKOMatch(key) {
  const [round, indexString] = key.split('|'), day = state.current, match = day.ko.matches[round][+indexString];
  const config = roundConfigFor(day, round), score = readMatchScore(`gko-${match.id}`, config);
  if (!score) return toast('Bitte ein gültiges Ergebnis eintragen.');
  Object.assign(match, { s1: score.a, s2: score.b, legs1: score.legs1, legs2: score.legs2, winner: score.a > score.b ? match.p1 : match.p2, loser: score.a > score.b ? match.p2 : match.p1, completed: true });
  const koDay = { ...day, ...day.ko }; advanceKO(koDay); day.ko.matches = koDay.matches;
  await save();
}
function doubleRoundConfig(day) {
  return { format: 'legs', win: 1, legsPerSet: 1 };
}

function renderDoubleKOEditor(day) {
  renderDoubleKOTree(day);
}

async function saveDoubleKOMatch(matchId) {
  const day = state.current;
  if (!day?.de?.wbRounds) return toast('Doppel-K.-o.-Baum wurde nicht gefunden.');
  refreshDoubleKO(day);
  const match = findDoubleKOMatch(day, String(matchId));
  if (!match) return toast('Doppel-K.-o.-Partie wurde nicht gefunden.');
  if (match.completed || !match.p1 || !match.p2) return toast('Diese Partie ist noch nicht spielbereit.');

  const config = doubleRoundConfig(day);
  const score = readMatchScore(`de-${match.id}`, config);
  if (!score) return toast('Bitte ein gültiges eindeutiges Ergebnis eintragen.');

  Object.assign(match, {
    s1: score.a,
    s2: score.b,
    legs1: score.a,
    legs2: score.b,
    firstTo: Math.max(score.a, score.b),
    winner: score.a > score.b ? match.p1 : match.p2,
    loser: score.a > score.b ? match.p2 : match.p1,
    completed: true,
    bye: false,
    completedAt: new Date().toISOString()
  });

  refreshDoubleKO(day);
  await save();
  if (day.de.champion) toast(`${memberName(day.de.champion)} gewinnt den Doppel-K.-o.-Spieltag.`);
  else if (day.de.resetFinal && !day.de.resetFinal.completed) toast('Grand Final ausgeglichen – Reset-Finale wurde automatisch erstellt.');
  else toast('Ergebnis gespeichert. Sieger und Verlierer wurden automatisch weitergeleitet.');
}

function renderHistory() {
  const currentSeason = season();
  const days = [...(currentSeason?.days || [])].reverse();
  $('historyList').innerHTML = days.length ? days.map(day => `<article class="history-card"><div class="history-card-head"><div><h3>${esc(day.date)}</h3><p>${MODES[day.mode]} · ${day.attendees?.length || 0} Spieler</p></div><span class="mode-badge">${MODES[day.mode]}</span></div><p class="history-podium">🥇 ${esc(memberName(day.results?.[0]?.id))} · 🥈 ${esc(memberName(day.results?.[1]?.id))}</p>${canManage ? `<button data-reopen-day="${day.id}">Ergebnisse ändern</button> <button class="danger-soft" data-delete-day="${day.id}">Löschen</button>` : ''}</article>`).join('') : '<div class="empty-state">Noch keine abgeschlossenen Spieltage.</div>';
  document.querySelectorAll('[data-reopen-day]').forEach(button => button.onclick = () => reopenDay(button.dataset.reopenDay));
  document.querySelectorAll('[data-delete-day]').forEach(button => button.onclick = () => deleteCompletedDay(button.dataset.deleteDay));
}
function renderDeleteList() {
  const box = $('deleteDaysList'); if (!box) return;
  const currentSeason = season();
  const rows = [];
  if (state.current) rows.push(`<div class="delete-day-row"><span>${esc(state.current.date)} · ${MODES[state.current.mode]}</span><button id="deleteOpenDay">Löschen</button></div>`);
  (currentSeason?.days || []).slice().reverse().forEach(day => rows.push(`<div class="delete-day-row"><span>${esc(day.date)} · ${MODES[day.mode]}</span><button data-delete-day="${day.id}">Löschen</button></div>`));
  box.innerHTML = rows.join('') || '<p>Keine Spieltage vorhanden.</p>';
  $('deleteOpenDay')?.addEventListener('click', deleteCurrentDay);
  box.querySelectorAll('[data-delete-day]').forEach(button => button.onclick = () => deleteCompletedDay(button.dataset.deleteDay));
}
function renderAdminDrawer() {
  const box = $('seriesAdminDayList'); if (!box) return;
  const days = [...(season()?.days || [])].reverse();
  let html = state.current ? `<article class="series-admin-day-card"><h3>Aktueller Spieltag</h3><p>${esc(state.current.date)} · ${MODES[state.current.mode]}</p><button data-open-current>Öffnen</button></article>` : '';
  html += days.map(day => `<article class="series-admin-day-card"><h3>${esc(day.date)}</h3><p>${MODES[day.mode]}</p><button data-reopen-day="${day.id}">Ergebnisse ändern</button></article>`).join('');
  box.innerHTML = html || '<p>Noch keine Spieltage vorhanden.</p>';
  box.querySelector('[data-open-current]')?.addEventListener('click', () => { closeDrawer(); selectTab('turnierbaum'); });
  box.querySelectorAll('[data-reopen-day]').forEach(button => button.onclick = () => reopenDay(button.dataset.reopenDay));
}
function renderAll() {
  renderPermissions(); renderSeason(); renderRanking(); renderCreateParticipants(); renderCurrent(); renderHistory(); renderDeleteList(); renderAdminDrawer(); updateModeFields();
}


// Vollständige Editor-Ansichten bleiben als interne Fallbacks erhalten.
const renderKO = renderKOEditor;
const renderSwiss = renderSwissEditor;
const renderGroups = renderGroupsEditor;
const renderDoubleKO = renderDoubleKOEditor;



// ---------- Aktionen ----------
function selectedAttendees() {
  return [...document.querySelectorAll('[data-attend]:checked')].map(input => input.dataset.attend);
}
async function saveParticipants() {
  if (!canManage || !state.current) return;
  state.current.attendees = selectedAttendees();
  await save(); toast('Teilnehmer gespeichert.');
}
async function drawAndStart() {
  if (!canManage) return toast('Nur Admins, Captains und Kassenwarte dürfen auslosen.');

  const day = state.current;
  if (!day) return toast('Kein vorbereiteter Spieltag vorhanden.');

  const selected = [...document.querySelectorAll('[data-attend]:checked')]
    .map(input => input.dataset.attend);

  if (selected.length < 2) {
    return toast('Bitte mindestens zwei Teilnehmer auswählen.');
  }

  day.attendees = selected;
  day.status = 'laeuft';
  day.startedAt = new Date().toISOString();

  try {
    if (day.mode === 'premier') {
      Object.assign(day, makeSingleElimination(selected));
      day.mode = 'premier';
      day.status = 'laeuft';
      day.attendees = selected;
    } else if (day.mode === 'swiss') {
      Object.assign(day, makeSwiss(selected, day.totalRounds || 4));
      day.mode = 'swiss';
      day.status = 'laeuft';
      day.attendees = selected;
    } else if (day.mode === 'groupsko') {
      Object.assign(day, makeGroupsKO(selected, day));
      day.mode = 'groupsko';
      day.status = 'laeuft';
      day.attendees = selected;
    } else if (day.mode === 'doubleko') {
      Object.assign(day, makeDoubleKO(selected, day.bracketSize || null));
      day.mode = 'doubleko';
      day.status = 'laeuft';
      day.attendees = selected;
    } else {
      return toast('Unbekannter Turniermodus.');
    }

    tournamentView = 'tree';
    await save();
    selectTab('turnierbaum');
    renderCurrent();
    toast('Turnier wurde ausgelost und gestartet.');
  } catch (error) {
    console.error('Auslosung fehlgeschlagen:', error);
    toast(`Auslosung fehlgeschlagen: ${error?.message || 'Unbekannter Fehler'}`);
  }
}
async function createDay() {
  if (!canManage) return toast('Nur Admins, Captains und Kassenwarte dürfen Turniere erstellen.');
  const currentSeason = season();
  if (!currentSeason) return toast('Keine Saison vorhanden.');
  if (state.current) { treeSelectionId = 'current'; selectTab('turnierbaum'); return toast('Es läuft bereits ein Turnier.'); }

  const selected = [...document.querySelectorAll('[data-create-attend]:checked')].map(input => input.dataset.createAttend);
  if (selected.length < 2) return toast('Bitte mindestens zwei Teilnehmer auswählen.');

  const tournamentType = document.querySelector('input[name="tournamentType"]:checked')?.value || 'ko';
  const bracketSize = +(document.querySelector('input[name="koSize"]:checked')?.value || 8);

  if (tournamentType !== 'groupsko') {
    if (![4, 8, 16, 32].includes(bracketSize)) return toast('Bitte ein gültiges K.-o.-Feld auswählen.');
    if (selected.length > bracketSize) return toast(`Für das ${bracketSize}er Feld kannst du höchstens ${bracketSize} Teilnehmer auswählen.`);
  }

  const day = {
    id: uid(), seasonId: currentSeason.id, status: 'laeuft',
    date: $('dayDate')?.value || new Date().toISOString().slice(0, 10),
    mode: tournamentType === 'doubleko' ? 'doubleko' : tournamentType === 'groupsko' ? 'groupsko' : 'premier',
    bracketSize,
    rankingEnabled: $('rankingEnabled')?.checked !== false,
    roundConfig: {},
    attendees: selected,
    startedAt: new Date().toISOString()
  };

  try {
    if (tournamentType === 'groupsko') {
      const groupCount = Math.max(1, +($('createGroupCount')?.value || 1));
      const qualifyCount = Math.max(0, +($('createQualifyCount')?.value ?? 2));
      if (groupCount > selected.length) return toast('Es können nicht mehr Gruppen als Teilnehmer angelegt werden.');

      const assignments = {};
      const groupSizes = Array(groupCount).fill(0);
      for (const id of selected) {
        const select = document.querySelector(`[data-group-assign="${CSS.escape(id)}"]`);
        if (!select) return toast('Bitte jedem Teilnehmer eine Gruppe zuweisen.');
        const groupIndex = +select.value;
        if (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex >= groupCount) return toast('Ungültige Gruppenzuordnung.');
        assignments[id] = groupIndex;
        groupSizes[groupIndex]++;
      }
      if (groupSizes.some(size => size < 2)) return toast('Jede Gruppe braucht mindestens zwei Teilnehmer.');
      if (qualifyCount > 0 && groupSizes.some(size => size < qualifyCount)) return toast('Es können nicht mehr Spieler weiterkommen, als in der kleinsten Gruppe vorhanden sind.');

      day.groupCount = groupCount;
      day.groupDrawMode = 'manual';
      day.groupAssignments = assignments;
      day.qualifyPlaces = Array.from({ length: qualifyCount }, (_, index) => index + 1);
      Object.assign(day, makeGroupsKO(selected, day));
      day.mode = 'groupsko';
      day.bracketSize = qualifyCount > 0 ? powerOfTwo(groupCount * qualifyCount) : 0;
    } else if (tournamentType === 'doubleko') {
      Object.assign(day, makeDoubleKO(selected, bracketSize));
      day.mode = 'doubleko';
    } else {
      Object.assign(day, makeSingleElimination(selected, null, bracketSize));
      day.mode = 'premier';
    }
    day.status = 'laeuft';
    day.attendees = selected;
    state.current = day;
    treeSelectionId = 'current';
    await save();
    selectTab('turnierbaum');
    if (tournamentType === 'groupsko') toast('Gruppenphase wurde mit deiner Gruppeneinteilung gestartet.');
    else toast(`${bracketSize}er ${tournamentType === 'doubleko' ? 'Doppel-K.-o.' : 'K.-o.'}-Feld wurde ausgelost und gestartet.`);
  } catch (error) {
    console.error(error); toast(`Turnier konnte nicht gestartet werden: ${error?.message || error}`);
  }
}

async function deleteCurrentDay() {
  if (!canManage || !state.current) return;
  if (!confirm('Aktuellen Spieltag wirklich löschen?')) return;
  state.current = null; treeSelectionId = season()?.days?.at(-1)?.id || ''; await save(); toast('Turnier gelöscht.');
}
async function deleteCompletedDay(id) {
  if (!canManage) return;
  const currentSeason = season(), index = currentSeason.days.findIndex(day => day.id === id);
  if (index < 0) return;
  if (!confirm('Abgeschlossenen Spieltag löschen und Punkte zurückrechnen?')) return;
  rollbackDay(currentSeason, currentSeason.days[index]); currentSeason.days.splice(index, 1); await save();
}
async function reopenDay(id) {
  if (!canManage) return;
  if (state.current) return toast('Bitte zuerst den offenen Spieltag beenden oder löschen.');
  const currentSeason = season(), index = currentSeason.days.findIndex(day => day.id === id);
  if (index < 0) return;
  if (!confirm('Spieltag zur Bearbeitung öffnen? Punkte werden vorübergehend zurückgenommen.')) return;
  const day = currentSeason.days[index]; rollbackDay(currentSeason, day); currentSeason.days.splice(index, 1);
  state.current = { ...day, status: 'laeuft', results: undefined, finishedAt: undefined };
  await save(); closeDrawer(); selectTab('turnierbaum');
}
async function createSeason() {
  const name = $('newSeasonName').value.trim(); if (!name) return toast('Bitte Saisonnamen eingeben.');
  const newSeason = blankSeason(name); state.members.filter(m => PLAYER_ROLES.includes(m.rolle)).forEach(m => newSeason.ranking[m.id] = blankStats());
  state.seasons.push(newSeason); state.activeSeasonId = newSeason.id; $('newSeasonName').value = ''; await save();
}
async function finishSeason() {
  const currentSeason = season(); if (!currentSeason) return;
  if (state.current) return toast('Bitte zuerst den offenen Spieltag beenden oder löschen.');
  if (!confirm(`${currentSeason.name} abschließen?`)) return;
  currentSeason.status = 'abgeschlossen'; currentSeason.closedAt = new Date().toISOString(); await save();
}
async function deleteSeason() {
  const currentSeason = season(); if (!currentSeason) return;
  if (state.current?.seasonId === currentSeason.id) return toast('Bitte zuerst den offenen Spieltag löschen.');
  if (!confirm(`${currentSeason.name} dauerhaft löschen?`)) return;
  state.seasons = state.seasons.filter(s => s.id !== currentSeason.id);
  if (!state.seasons.length) state.seasons = [blankSeason()];
  state.activeSeasonId = state.seasons[0].id; await save();
}
function openProfile(id) {
  const member = state.members.find(m => m.id === id); if (!member) return;
  const stats = season()?.ranking?.[id] || blankStats();
  $('profileContent').innerHTML = `<div class="profile-modal-head">${memberAvatar(member.id)}<div><h2>${esc(member.name)}</h2><p>${esc(member.rolle)}${member.scoliaName ? ` · Scolia: ${esc(member.scoliaName)}` : ''}</p></div></div><div class="profile-stats"><div><strong>${stats.points}</strong>Punkte</div><div><strong>${stats.days}</strong>Spieltage</div><div><strong>${stats.wins}</strong>Siege</div><div><strong>${stats.titles}</strong>Titel</div><div><strong>${stats.legsFor}:${stats.legsAgainst}</strong>Legs</div><div><strong>${stats.legsFor - stats.legsAgainst}</strong>Diff.</div></div>`;
  $('profileModal').hidden = false;
}
function selectTab(name) {
  document.querySelectorAll('.serie-tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  document.querySelectorAll('[data-nav-tab]').forEach(button => button.classList.toggle('active', button.dataset.navTab === name));
  document.querySelectorAll('.serie-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
}
function updateModeFields() { updateCreateTournamentInfo(); }
function updateCreateTournamentInfo({ rerenderParticipants = false } = {}) {
  const tournamentType = document.querySelector('input[name="tournamentType"]:checked')?.value || 'ko';
  const isGroups = tournamentType === 'groupsko';
  const size = +(document.querySelector('input[name="koSize"]:checked')?.value || 8);
  const selected = document.querySelectorAll('[data-create-attend]:checked').length;
  const free = Math.max(0, size - selected);

  const koField = document.querySelector('.ko-size-fieldset');
  if (koField) koField.hidden = isGroups;
  if ($('groupsCreateConfig')) $('groupsCreateConfig').hidden = !isGroups;

  if ($('selectedParticipantsCount')) $('selectedParticipantsCount').textContent = `${selected} ausgewählt`;
  if ($('koSizeInfo')) $('koSizeInfo').textContent = selected > size
    ? `${selected} ausgewählt · ${selected - size} zu viel für das ${size}er Feld`
    : `${selected} von ${size} Plätzen belegt · ${free} ${free === 1 ? 'Freilos' : 'Freilose'}`;

  if (isGroups) {
    const groupCount = Math.max(1, +($('createGroupCount')?.value || 1));
    const qualifyCount = Math.max(0, +($('createQualifyCount')?.value ?? 2));
    const koPlayers = groupCount * qualifyCount;
    if ($('groupsCreateInfo')) {
      if (qualifyCount === 0) {
        $('groupsCreateInfo').textContent = `${groupCount} ${groupCount === 1 ? 'Gruppe' : 'Gruppen'} · keine K.-o.-Phase · Gruppenplatzierung ist das Endergebnis`;
      } else {
        const koSize = powerOfTwo(koPlayers);
        $('groupsCreateInfo').textContent = `${groupCount} Gruppen · je ${qualifyCount} ${qualifyCount === 1 ? 'kommt' : 'kommen'} weiter · ${koPlayers} Spieler in der K.-o.-Phase${koSize > koPlayers ? ` · ${koSize - koPlayers} Freilos${koSize - koPlayers === 1 ? '' : 'e'}` : ''}`;
      }
    }
  }

  if (rerenderParticipants) renderCreateParticipants();
}

function assignParticipantToSmallestGroup(checkbox) {
  if (!checkbox?.checked) return;
  const select = document.querySelector(`[data-group-assign="${CSS.escape(checkbox.dataset.createAttend)}"]`);
  if (!select) return;
  const groupCount = Math.max(1, +($('createGroupCount')?.value || 1));
  const counts = Array(groupCount).fill(0);
  document.querySelectorAll('[data-create-attend]:checked').forEach(input => {
    if (input === checkbox) return;
    const assigned = document.querySelector(`[data-group-assign="${CSS.escape(input.dataset.createAttend)}"]`);
    if (assigned && counts[+assigned.value] !== undefined) counts[+assigned.value]++;
  });
  const min = Math.min(...counts);
  select.value = String(counts.indexOf(min));
}

function closeSeasonPicker() { $('seasonPickerMenu').hidden = true; $('seasonPickerButton').setAttribute('aria-expanded', 'false'); }
function openSeriesNav() {
  const drawer = $('seriesNavDrawer');
  const backdrop = $('seriesNavBackdrop');
  if (!drawer || !backdrop) return;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.hidden = false;
  $('seriesNavMenuBtn')?.setAttribute('aria-expanded', 'true');
}
function closeSeriesNav() {
  const drawer = $('seriesNavDrawer');
  const backdrop = $('seriesNavBackdrop');
  if (!drawer || !backdrop) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.hidden = true;
  $('seriesNavMenuBtn')?.setAttribute('aria-expanded', 'false');
}
function openDrawer() { if (!canManage) return; $('seriesAdminDrawer').classList.add('open'); $('seriesAdminDrawerBackdrop').hidden = false; renderAdminDrawer(); }
function closeDrawer() { $('seriesAdminDrawer').classList.remove('open'); $('seriesAdminDrawerBackdrop').hidden = true; }

// ---------- Events ----------
$('startDayBtn')?.addEventListener('click', createDay);
$('createSeasonBtn')?.addEventListener('click', createSeason);
$('syncMembersBtn')?.addEventListener('click', () => syncMembers(true));
$('finishSeasonBtn')?.addEventListener('click', finishSeason);
$('deleteSeasonBtn')?.addEventListener('click', deleteSeason);
$('deleteCurrentDayBtn')?.addEventListener('click', deleteCurrentDay);
$('tournamentTreeTab')?.addEventListener('click', () => setTournamentView('tree'));
$('treeDaySelect')?.addEventListener('change', event => { treeSelectionId = event.target.value; renderCurrent(); });
$('modeFilter')?.addEventListener('change', renderRanking);
$('dayMode')?.addEventListener('change', updateModeFields);
$('closeProfile')?.addEventListener('click', () => $('profileModal').hidden = true);
$('profileModal')?.addEventListener('click', e => { if (e.target === $('profileModal')) $('profileModal').hidden = true; });
$('seasonPickerButton')?.addEventListener('click', e => { e.stopPropagation(); const menu = $('seasonPickerMenu'); menu.hidden = !menu.hidden; });
document.addEventListener('click', e => { if (!e.target.closest('.season-picker')) closeSeasonPicker(); });
document.querySelectorAll('.serie-tabs button').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.requiresManage === 'true' && !canManage) {
    return toast('Turniere erstellen dürfen nur Admins, Captains und Kassenwarte.');
  }
  selectTab(button.dataset.tab);
}));
$('seriesNavMenuBtn')?.addEventListener('click', openSeriesNav);
$('closeSeriesNav')?.addEventListener('click', closeSeriesNav);
$('seriesNavBackdrop')?.addEventListener('click', closeSeriesNav);
document.querySelectorAll('[data-nav-tab]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.requiresManage === 'true' && !canManage) {
    return toast('Turniere erstellen dürfen nur Admins, Captains und Kassenwarte.');
  }
  selectTab(button.dataset.navTab);
  closeSeriesNav();
}));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSeriesNav(); });
$('seriesAdminMenuBtn')?.addEventListener('click', openDrawer);
$('closeSeriesAdminDrawer')?.addEventListener('click', closeDrawer);
$('seriesAdminDrawerBackdrop')?.addEventListener('click', closeDrawer);
document.querySelectorAll('[data-drawer-tab]').forEach(button => button.addEventListener('click', () => { closeDrawer(); selectTab(button.dataset.drawerTab); }));

if ($('dayDate')) $('dayDate').value = new Date().toISOString().slice(0, 10);
updateModeFields();
document.querySelectorAll('input[name="koSize"]').forEach(input => input.addEventListener('change', updateCreateTournamentInfo));
document.querySelectorAll('input[name="tournamentType"]').forEach(input => input.addEventListener('change', () => updateCreateTournamentInfo({ rerenderParticipants: true })));
$('createGroupCount')?.addEventListener('change', () => updateCreateTournamentInfo({ rerenderParticipants: true }));
$('createQualifyCount')?.addEventListener('change', () => updateCreateTournamentInfo());
document.addEventListener('change', event => {
  if (event.target?.matches?.('[data-create-attend]')) {
    const groupSelect = document.querySelector(`[data-group-assign="${CSS.escape(event.target.dataset.createAttend)}"]`);
    if (groupSelect) {
      groupSelect.disabled = !event.target.checked;
      if (event.target.checked) assignParticipantToSmallestGroup(event.target);
    }
    updateCreateTournamentInfo();
  }
});
updateCreateTournamentInfo();

load().catch(error => { console.error(error); toast(`Daten konnten nicht geladen werden: ${error?.message || error}`); });
