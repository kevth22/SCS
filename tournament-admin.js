import {
  standings, groupDone, allGroupsDone, qualification, qualificationDrift, rules, diff, matchEntries,
  divisions, editMatch, swapSlots, setManualSeeds, previewFinals, startFinals,
  createDecider, withdrawPlayer, reactivatePlayer, reentryAllowed, withdrawn, tournamentComplete,
  clone, swappableBracket, groupProgression, swapGroupPlayers
} from './tournament-engine.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const score = m => m.annulled ? 'Annulliert' : m.bye ? 'Freilos' : m.completed ? `${m.s1}:${m.s2}${m.walkover ? ' · kampflos' : ''}` : m.status === 'live' ? 'Läuft' : m.withdrawalHold ? 'Erneut geöffnet · Rückzugswertung manuell prüfen' : 'Offen';
const label = key => ['silver', 'previewSilver'].includes(key) ? 'Silber' : ['gold', 'previewGold'].includes(key) ? 'Gold / K.-o.' : 'K.-o.';

// Auch ältere, im PWA-Cache gespeicherte HTML-Seiten können bereits das neue
// JavaScript laden. Die Komponente stellt deshalb ihren eigenen CSS-Bezug sicher.
function ensureTournamentStyles() {
  const href = new URL('./tournament-admin.css?v=6', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === href)) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
  document.head.append(link);
}
if (typeof document !== 'undefined') ensureTournamentStyles();

export function renderPlayerAvatar(member, name) {
  if (member?.profilbild) return `<img class="player-avatar player-avatar-small" src="${esc(member.profilbild)}" alt="">`;
  const initials = String(name || '?').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="player-avatar player-avatar-small player-avatar-fallback" aria-hidden="true">${esc(initials || '?')}</span>`;
}

// Native dialog: Tastaturbedienung, Fokusbindung und mobile Darstellung.
function dialog(title, body, accept = 'Speichern') {
  return new Promise(resolve => {
    const el = document.createElement('dialog'); el.className = 'tournament-dialog';
    el.innerHTML = `<form><h2>${esc(title)}</h2>${body}<p class="tournament-error" role="alert"></p><div class="workspace-actions"><button type="button" data-cancel>Abbrechen</button><button type="submit" class="primary">${esc(accept)}</button></div></form>`;
    document.body.append(el);
    const finish = value => { el.close(); el.remove(); resolve(value); };
    el.querySelector('[data-cancel]').onclick = () => finish(null);
    el.oncancel = e => { e.preventDefault(); finish(null); };
    el.querySelector('form').onsubmit = e => { e.preventDefault(); finish(new FormData(e.target)); };
    el.showModal();
  });
}
export async function confirmPlan(plan, name, action) {
  const effects = plan.effects;
  const result = await dialog('Änderung prüfen und bestätigen', `<p>${esc(action)}</p>
    <p>Die folgenden Spiele werden aktualisiert. Bereits gespielte abhängige Partien behalten ihr Ergebnis und werden als Konflikt markiert. Ein Konflikt muss vor dem Abschluss aufgelöst werden.</p>
    <ul>${effects.map(e => `<li>${esc(e.label)} · ${e.players.map(id => esc(id ? name(id) : 'Offen / Freilos')).join(' – ')} · ${esc(e.status || 'Offen')}${e.conflict ? ' · ⚠ Korrektur erforderlich' : ''}<small>Spiel ${esc(e.id)}</small></li>`).join('') || '<li>Qualifikationsregeln, Setzliste oder Turnierstatus werden geändert.</li>'}</ul>
    ${plan.drift.length ? '<p role="alert">Die aktuelle Gruppentabelle weicht von der eingefrorenen Qualifikation ab. Der gestartete Turnierbaum bleibt bestehen.</p>' : ''}`, 'Änderung bestätigen');
  return Boolean(result);
}
function playerName(id, name, editable) {
  return editable && id ? `<button type="button" class="tournament-player-name group-name-button" data-swap-player="${esc(id)}" aria-label="Spieler tauschen: ${esc(name(id))}">${esc(name(id))}</button>` : `<span class="tournament-player-name">${esc(name(id))}</span>`;
}
function matchList(entries, name, editable, day = {}) {
  return `<div class="tournament-match-list">${entries.map(e => `<article class="tournament-match ${e.match.conflict ? 'has-conflict' : ''}">
    <div><small>${esc(e.label)}</small><strong class="group-match-names">${playerName(e.match.p1, name, editable && e.phase === 'group')}<span> – </span>${playerName(e.match.p2, name, editable && e.phase === 'group')}</strong><span>${esc(score(e.match))}${e.match.conflict ? ' · ⚠ Korrektur erforderlich' : ''}</span>${e.match.archivedOriginal ? `<small>Ursprüngliches Ergebnis: ${esc(score(e.match.archivedOriginal))}. Es bleibt diesen ursprünglichen Spielern zugeordnet.</small>` : ''}</div>
    ${editable && ['group', 'decider'].includes(e.phase) && day.groupFormat?.format !== 'sets' && e.match.p1 && e.match.p2 && !e.match.annulled && !e.match.conflict ? `<form class="group-inline-score" data-inline-score="${esc(e.match.id)}"><label>${esc(name(e.match.p1))}<input name="s1" aria-label="Legs ${esc(name(e.match.p1))}" type="number" inputmode="numeric" min="0" step="1" required value="${e.match.s1 ?? ''}"></label><label>${esc(name(e.match.p2))}<input name="s2" aria-label="Legs ${esc(name(e.match.p2))}" type="number" inputmode="numeric" min="0" step="1" required value="${e.match.s2 ?? ''}"></label><button type="submit">${e.match.completed ? 'Ergebnis korrigieren' : 'Ergebnis speichern'}</button></form>` : ''}
    ${editable ? `<button type="button" class="match-details-button" data-admin-match="${esc(e.match.id)}">${e.match.conflict ? 'Konflikt lösen' : 'Details / Spiel bearbeiten'}</button>` : ''}</article>`).join('')}</div>`;
}
function progressionLegend(day) {
  const config = rules(day), split = config.gold.length && config.silver.length;
  return `<div class="group-progression-legend" aria-label="Markierung der Qualifikationsplätze">${['gold', 'silver'].filter(key => config[key].length).map(key => `<span class="group-qual-badge group-qual-${split ? key : 'ko'}">Platz ${config[key].join(', ')} → ${split ? key === 'gold' ? 'Gold' : 'Silber' : 'K.-o.'}</span>`).join('')}<small>Während der Gruppenphase gelten die Markierungen vorläufig. Ungeklärte Plätze werden nicht willkürlich einer Endrunde zugeordnet.</small></div>`;
}
function groupPlayerCell(id, name, avatar, action, editable = false, compactAction = '') {
  return `<span class="tournament-player-identity">${avatar(id)}${playerName(id, name, editable)}${compactAction}</span>${action ? `<div class="group-player-controls">${action}</div>` : ''}`;
}
function standingRow(day, group, row, table, done, name, avatar, editable) {
  const next = groupProgression(day, group, row, table);
  const badge = next ? `<span class="group-qual-badge group-qual-${next.kind}">${esc(next.label)}${next.provisional && next.kind !== 'unresolved' ? ' · vorläufig' : ''}</span>` : '';
  const action = editable ? `<button type="button" class="group-withdraw-button" data-withdraw="${esc(row.id)}" title="Spieler rausnehmen" aria-label="Spieler rausnehmen: ${esc(name(row.id))}">×</button>` : '';
  return `<tr data-group-player="${esc(row.id)}" class="${next ? `group-qual-${next.kind}` : ''}"><td>${!done && row.unresolved ? '–' : `${row.place}${row.unresolved ? ' ?' : ''}`}</td><td>${groupPlayerCell(row.id, name, avatar, badge, editable, action)}</td><td>${row.mp}</td><td>${row.legsFor}</td><td>${row.legsAgainst}</td><td>${diff(row)}</td></tr>`;
}
function withdrawnRow(day, id, name, avatar, editable) {
  const check = reentryAllowed(day, id);
  const action = editable ? `<button type="button" data-reactivate="${esc(id)}" ${check.allowed ? '' : 'disabled'} aria-label="Spieler wieder aktivieren: ${esc(name(id))}">Wieder aktivieren</button>` : '';
  return `<tr class="group-withdrawn-row" data-group-player="${esc(id)}"><td>–</td><td>${groupPlayerCell(id, name, avatar, '<span>Zurückgezogen</span>' + action)}</td><td colspan="4">Nicht in der Wertung</td></tr>`;
}
function bracketHtml(bracket, key, name, editable) {
  if (!bracket) return '';
  return `<section class="tournament-final"><h3>${esc(label(key))}${key.startsWith('preview') ? ' · Vorschau' : ''}</h3>
    ${(bracket.warnings || []).map(w => `<p role="status">${esc(w)}</p>`).join('')}
    <div class="tournament-tree-scroll"><div class="tournament-tree">${bracket.rounds.map(r => `<section class="tree-round"><h4>${esc(r)}</h4>${bracket.matches[r].map(m => `<article class="tournament-match ${m.conflict ? 'has-conflict' : ''}"><div><strong>${esc(name(m.p1))}</strong><strong>${esc(name(m.p2))}</strong><span>${esc(score(m))}${m.conflict ? ' · ⚠ Konflikt' : ''}</span>${editable && !key.startsWith('preview') ? `<button type="button" data-admin-match="${esc(m.id)}">Bearbeiten</button>` : ''}</div></article>`).join('')}</section>`).join('')}</div></div>
    ${editable ? `<button type="button" data-swap="${esc(key)}">Spieler / Freilose tauschen</button>` : ''}
    ${bracket.matches[bracket.rounds.at(-1)][0]?.winner && !bracket.matches[bracket.rounds.at(-1)][0]?.conflict ? `<p>Sieger: <strong>${esc(name(bracket.matches[bracket.rounds.at(-1)][0].winner))}</strong></p>` : ''}</section>`;
}
function qualificationHtml(day, name, editable) {
  const frozen = Boolean(day.koStartedAt || day.groupPhaseDone);
  const done = allGroupsDone(day);
  const drift = qualificationDrift(day);
  return `<section class="tournament-qualification"><h3>Qualifikation und Setzlisten ${frozen ? '· eingefroren' : ''}</h3>
    <p>Qualifikationsplätze: ${['gold', 'silver'].map(k => `${label(k)}: ${rules(day)[k].join(', ') || 'keine'}`).join(' · ')}</p>
    ${!done ? '<p>Die Gruppenphase läuft. Setzlisten und Gleichstände werden nach Abschluss der Gruppenspiele geprüft.</p>' : ''}
    ${drift.length ? '<p class="has-conflict" role="alert">Gruppenwertung und eingefrorene Qualifikation weichen ab. Gespeicherte Teilnehmer und Paarungen bleiben unverändert.</p>' : ''}
    ${(done || frozen ? ['gold', 'silver'] : []).filter(k => rules(day)[k].length).map(key => {
      const q = qualification(day, key);
      if (!frozen && q.unresolved.length) return `<h4>${esc(label(key))}</h4><p role="alert">Qualifikationsrelevante Gruppenplätze sind noch ungeklärt. Zuerst die Entscheidungsspiele abschließen; danach werden Qualifikanten und Setzliste angezeigt.</p>`;
      const saved = day.qualificationSnapshot?.[key];
      const rows = frozen ? saved?.seeds || (saved?.players || []).map((id, index) => ({ id, seed: index + 1 })) : q.rows;
      return `<h4>${esc(label(key))}</h4><div class="table-scroll"><table><thead><tr><th>Setzplatz</th><th>Spieler</th><th>Gruppe</th><th>Gruppenplatz</th><th>Punkte</th><th>Leg-Diff.</th></tr></thead><tbody>${rows.map(r => `<tr><td>${!frozen && q.seedTies.some(ids => ids.includes(r.id)) ? 'offen' : r.seed}</td><td>${esc(name(r.id))}</td><td>${esc(r.group || '–')}</td><td>${r.place ?? '–'}</td><td>${r.mp ?? '–'}</td><td>${r.legsFor === undefined ? '–' : diff(r)}</td></tr>`).join('')}</tbody></table></div>
        ${done && !frozen && q.seedTies.length ? `<p role="alert">Gleiche Setzkriterien: ${q.seedTies.map(ids => ids.map(name).map(esc).join(' / ')).join('; ')}. Reihenfolge ausdrücklich speichern.</p>` : ''}
        ${done && editable && !frozen ? `<button type="button" data-seeds="${key}">Setzliste prüfen / manuell korrigieren</button>` : ''}
        ${frozen ? `<p>Eingefrorene Teilnehmer: ${(day.qualificationSnapshot?.[key]?.players || []).map(name).map(esc).join(', ')}</p>` : ''}`;
    }).join('')}
    ${editable && !frozen ? `<div class="workspace-actions"><button type="button" data-rules>Qualifikationsplätze ändern</button><button type="button" data-preview ${allGroupsDone(day) ? '' : 'disabled'}>Setzlisten prüfen und Paarungsvorschau erzeugen</button>${day.finalPreview ? '<button type="button" data-start-finals class="primary">K.-o.-Phase offiziell starten</button>' : ''}</div>` : ''}
  </section>`;
}
function withdrawalHtml(day, name, editable) {
  return `<details class="tournament-withdrawals"><summary>Teilnahme und Rückzüge</summary>
    ${day.attendees.map(id => {
      const p = day.participation?.[id], group = day.groups?.find(g => g.players.includes(id));
      const check = reentryAllowed(day, id);
      return `<article class="tournament-match"><div><strong>${esc(name(id))}</strong><span>${esc(group?.name || 'K.-o.')} · ${withdrawn(day, id) ? 'Zurückgezogen' : 'Aktiv'}</span>
        ${p?.withdrawnAt ? `<small>Rückzug: ${esc(p.withdrawnAt)} · Annullierte Spiele: ${Object.keys(p.originals || {}).map(esc).join(', ') || 'keine'} · kampflose Weiterleitungen: ${(p.walkovers || []).map(esc).join(', ') || 'keine'}<br>Maßgebliche nächste Partie: ${esc(p.nextMatchId || 'keine')} · Position: ${esc(p.nextPosition || 'keine')}<br>${esc(check.reason)}</small>` : ''}</div>
        ${editable ? withdrawn(day, id) ? `<button type="button" data-reactivate="${esc(id)}" ${check.allowed ? '' : 'disabled'}>Wieder aktivieren</button>` : `<button type="button" data-withdraw="${esc(id)}">Spieler zurückziehen</button>` : ''}</article>`;
    }).join('')}</details>`;
}
export function renderTournamentAdmin({ day, host, name, editable, run, finish, avatar = id => renderPlayerAvatar(null, name(id)) }) {
  if (!day || day.engine === 'draft') return;
  ensureTournamentStyles();
  const section = document.createElement('section'); section.className = 'tournament-admin';
  let html = '';
  if (day.groups) {
    host.replaceChildren();
    html += progressionLegend(day);
    html += `<div class="groups-grid">${day.groups.map(g => {
      const table = standings(g, day), done = groupDone(g, day);
      return `<section class="group-card"><h3>${esc(g.name)}</h3>${!done ? '<p class="group-progress">Vorläufige Tabelle · Gruppenspiele noch offen</p>' : ''}<div class="table-scroll"><table><thead><tr><th>Platz</th><th>Spieler</th><th>Punkte</th><th>Legs +</th><th>Legs −</th><th>Diff.</th></tr></thead><tbody>${table.rows.map(r => standingRow(day, g, r, table, done, name, avatar, editable)).join('')}${table.withdrawn.map(id => withdrawnRow(day, id, name, avatar, editable)).join('')}</tbody></table></div>
        ${done ? table.ties.map((t, i) => `<p role="status">Platz ${t.place}–${t.endPlace} ungeklärt: ${t.players.map(name).map(esc).join(', ')} ${editable ? `<button type="button" data-decider="${esc(g.id)}|${i}">Entscheidungsspiel anlegen</button>` : ''}</p>`).join('') : ''}
        <section class="group-matches"><h4>Begegnungen · Legs direkt eintragen</h4>${matchList(matchEntries(day).filter(e => e.group === g.id && e.phase === 'group'), name, editable, day)}</section>
        ${(g.deciderMatches || []).length ? `<details><summary>Entscheidungsspiele</summary>${matchList(matchEntries(day).filter(e => e.group === g.id && e.phase === 'decider'), name, editable, day)}</details>` : ''}
        ${(g.archivedMatches || []).length ? `<details><summary>Ursprüngliche Begegnungen nach Spielertausch</summary>${matchList(matchEntries(day).filter(e => e.group === g.id && e.phase === 'archived-group'), name, editable, day)}</details>` : ''}</section>`;
    }).join('')}</div>`;
    html += qualificationHtml(day, name, editable);
    if (day.finalPreview) for (const k of ['gold', 'silver']) html += bracketHtml(day.finalPreview[k], k === 'gold' ? 'previewGold' : 'previewSilver', name, editable);
    for (const { key, bracket } of divisions(day)) html += bracketHtml(bracket, key, name, editable);
    if (editable) html += `<button type="button" data-finish class="primary" ${tournamentComplete(day) ? '' : 'disabled'}>Turnier abschließen</button>`;
  } else {
    html += `<h3>Administrative Spielbearbeitung</h3><details><summary>Alle Spiele, Ergebnisse und Konflikte</summary>${matchList(matchEntries(day), name, editable)}</details>`;
    if (editable && (day.engine === 'ko' || day.de)) html += `<button type="button" data-swap="${day.de ? 'doubleko' : 'main'}">Spieler / Freilose tauschen</button>`;
    if (editable && (day.engine === 'ko' || day.de) && !day.bracketStartedAt) html += '<p>Turnierbaum als Vorschau: Paarungen prüfen und vor Beginn offiziell starten.</p><button type="button" data-start-direct class="primary">Turnierbaum offiziell starten</button>';
  }
  html += withdrawalHtml(day, name, editable);
  const conflicts = matchEntries(day).filter(e => e.match.conflict);
  if (conflicts.length) html += `<div role="alert" class="has-conflict"><h3>Offene Konflikte (${conflicts.length})</h3>${matchList(conflicts, name, editable)}</div>`;
  if (day.audit?.length) html += `<details><summary>Änderungshistorie (${day.audit.length})</summary>${day.audit.slice().reverse().map(a => `<details><summary>${esc(a.at)} · ${esc(a.actor)} · ${esc(a.action)}</summary><pre>${esc(JSON.stringify(a.before, null, 2))}</pre></details>`).join('')}</details>`;
  section.innerHTML = html; host.append(section);
  if (!editable) return;
  // Jeder Handler verwendet denselben Plan-/Bestätigungs-/Speicherpfad.
  const wire = (selector, fn) => section.querySelectorAll(selector).forEach(button => button.onclick = async () => {
    try { await fn(button); } catch (error) { await dialog('Änderung nicht möglich', `<p>${esc(error.message)}</p>`, 'Schließen'); }
  });
  section.querySelectorAll('[data-inline-score]').forEach(form => form.onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(form), a = Number(data.get('s1')), b = Number(data.get('s2'));
    await run('Leg-Ergebnis speichern / korrigieren', draft => editMatch(draft, form.dataset.inlineScore, { status: 'completed', s1: a, s2: b, legs1: a, legs2: b }));
  });
  wire('[data-swap-player]', async button => {
    const id = button.dataset.swapPlayer;
    const candidates = day.groups.flatMap(g => g.players.filter(other => other !== id && !withdrawn(day, other)).map(other => ({ id: other, group: g.name })));
    const data = await dialog('Spielerplätze tauschen', `<p>${esc(name(id))} mit einem vorhandenen Teilnehmer tauschen.</p><p>Ergebnisse bleiben bei den tatsächlichen Spielern. Bei denselben Gegnern werden die Ergebnisfelder passend gedreht. Neue Gegner erhalten keine fremden Ergebnisse. Nicht mehr passende gespielte Gruppenspiele bleiben historisch erhalten und müssen als Konflikt geprüft werden. Tabellenplätze werden weiterhin aus den Ergebnissen berechnet.</p><label>Tauschpartner<select name="other">${candidates.map(r => `<option value="${esc(r.id)}">${esc(name(r.id))} · ${esc(r.group)}</option>`).join('')}</select></label>`, 'Tausch prüfen');
    if (data) await run(`Spielerplätze tauschen: ${name(id)} ↔ ${name(data.get('other'))}`, draft => swapGroupPlayers(draft, id, data.get('other')), true);
  });
  wire('[data-admin-match]', async button => {
    const entry = matchEntries(day).find(e => e.match.id === button.dataset.adminMatch), m = entry.match;
    const archived = entry.phase === 'archived-group';
    const eligible = archived ? [m.p1, m.p2] : entry.group ? day.groups.find(g => g.id === entry.group).players : day.attendees;
    const config = entry.group ? day.groupFormat : entry.phase === 'swiss' ? day.swissFormat : day.roundConfig?.[entry.round];
    const isSets = config?.format === 'sets';
    const expected = m.conflict?.expected;
    const options = selected => `<option value="">Offen / Freilos</option>${eligible.map(id => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(name(id))}${withdrawn(day, id) ? ' (zurückgezogen)' : ''}</option>`).join('')}`;
    const data = await dialog('Spiel bearbeiten / Ergebnis korrigieren', `<p>${esc(entry.label)} · ${esc(m.id)}</p>
      ${m.conflict ? `<p role="alert">${esc(m.conflict.reason)} ${expected ? `Vorgesehene Teilnehmer: ${expected.map(name).map(esc).join(' – ')}. Das alte Ergebnis bleibt in der Historie.` : 'Vorgängerkonflikte zuerst prüfen. Danach die korrekte Paarung und Wertung ausdrücklich speichern.'}</p>` : ''}
      <div class="two-cols"><label>Spieler 1<select name="p1">${options(expected ? expected[0] : m.p1)}</select></label><label>Spieler 2<select name="p2">${options(expected ? expected[1] : m.p2)}</select></label></div>
      <label>Aktion / Status<select name="status">${(archived ? [['void', 'Nach Prüfung aus Gruppenwertung nehmen; ursprüngliches Ergebnis bleibt in der Historie']] : [['completed', 'Ergebnis speichern / korrigieren'], ['pending', 'Zurücksetzen / erneut öffnen'], ['live', 'Läuft'], ['void', 'Administrativ annullieren'], ['walkover', 'Kampflos werten']]).map(([v, text]) => `<option value="${v}" ${v === (['pending', 'live'].includes(m.status) ? 'completed' : m.status) ? 'selected' : ''}>${text}</option>`).join('')}</select></label>
      <div class="two-cols"><label>Ergebnis Spieler 1<input name="s1" type="number" min="0" step="1" value="${m.s1 ?? ''}"></label><label>Ergebnis Spieler 2<input name="s2" type="number" min="0" step="1" value="${m.s2 ?? ''}"></label>${isSets ? `<label>Gewonnene Legs Spieler 1<input name="legs1" type="number" min="0" step="1" value="${m.legs1 ?? m.s1 ?? 0}"></label><label>Gewonnene Legs Spieler 2<input name="legs2" type="number" min="0" step="1" value="${m.legs2 ?? m.s2 ?? 0}"></label>` : ''}</div>
      <p>${isSets ? 'Bei Set-Spielen die Gesamtlegs zusätzlich eintragen.' : 'Die gewonnenen Legs werden direkt aus dem Ergebnis übernommen.'}</p>
      <label>Gewinner (bei kampfloser Wertung erforderlich)<select name="winner"><option value="">Aus Ergebnis bestimmen</option>${eligible.map(id => `<option value="${esc(id)}">${esc(name(id))}</option>`).join('')}</select></label>
      <label>Administrative Notiz<textarea name="note">${esc(m.note || '')}</textarea></label>`);
    if (!data) return;
    const change = Object.fromEntries(data); change.p1 ||= null; change.p2 ||= null;
    if (change.status === 'completed' && (!data.get('s1') || !data.get('s2'))) throw new Error('Beide Ergebnisse sind erforderlich.');
    for (const k of ['s1', 's2']) change[k] = Number(change[k]);
    change.legs1 = isSets ? Number(data.get('legs1')) : change.s1;
    change.legs2 = isSets ? Number(data.get('legs2')) : change.s2;
    if (!change.winner) delete change.winner;
    await run('Spiel bearbeiten / korrigieren', draft => editMatch(draft, m.id, change));
  });
  wire('[data-withdraw]', b => run(`Spieler zurückziehen: ${name(b.dataset.withdraw)}. Sämtliche Gruppenspiele werden annulliert; offene Endrundenspiele können kampflos gewertet werden.`, d => withdrawPlayer(d, b.dataset.withdraw), true));
  wire('[data-reactivate]', b => run(`Spieler wieder aktivieren: ${name(b.dataset.reactivate)}. Ursprüngliche Gruppenwertungen wiederherstellen.`, d => reactivatePlayer(d, b.dataset.reactivate), true));
  wire('[data-decider]', async b => {
    const [groupId, i] = b.dataset.decider.split('|'), g = day.groups.find(g => g.id === groupId), tie = standings(g, day).ties[+i];
    const data = await dialog('Entscheidungsspiele', `<p>${tie.players.map(name).map(esc).join(', ')} · Ergebnisse zählen ausschließlich zur Auflösung dieses Gleichstands.</p><label>Format<select name="format"><option value="round-robin">${tie.players.length === 2 ? 'Ein Entscheidungsspiel' : 'Jeder gegen jeden'}</option>${tie.players.length > 2 ? '<option value="double-round-robin">Jeder gegen jeden mit Rückspielen</option>' : ''}</select></label>`);
    if (data) await run('Entscheidungsspiele anlegen', d => createDecider(d, groupId, tie.players, data.get('format')), true);
  });
  wire('[data-rules]', async () => {
    const data = await dialog('Qualifikationsplätze', `<p>Plätze als Liste eingeben, zum Beispiel Gold: 1,2 und Silber: 3,4. Überschneidungen sind unzulässig.</p><label>Gold / K.-o.<input name="gold" value="${esc(rules(day).gold.join(','))}"></label><label>Silber<input name="silver" value="${esc(rules(day).silver.join(','))}"></label>`);
    if (!data) return;
    const parse = key => String(data.get(key)).trim() ? String(data.get(key)).split(',').map(s => Number(s.trim())) : [];
    await run('Qualifikationsregeln ändern', d => {
      if (d.koStartedAt) throw new Error('Qualifikation ist eingefroren.');
      d.qualificationRules = { gold: parse('gold'), silver: parse('silver') }; rules(d);
      d.qualifyPlaces = d.qualificationRules.gold; d.finalPreview = null;
    }, true);
  });
  wire('[data-seeds]', async b => {
    const key = b.dataset.seeds, q = qualification(day, key);
    const data = await dialog('Setzliste ausdrücklich festlegen', `<p>Jede Position muss genau einmal vergeben sein. Absolute Punkte und Leg-Differenz werden angezeigt; gleiche Kriterien benötigen deine Entscheidung.</p>${q.rows.map(r => `<label>${esc(name(r.id))} · ${esc(r.group)} / Platz ${r.place} · ${r.mp} Punkte / ${diff(r)}<input type="number" min="1" max="${q.rows.length}" step="1" name="${esc(r.id)}" value="${r.seed}" required></label>`).join('')}`);
    if (!data) return;
    const ordered = q.rows.map(r => ({ id: r.id, position: Number(data.get(r.id)) }));
    if (new Set(ordered.map(r => r.position)).size !== ordered.length) throw new Error('Jeden Setzplatz genau einmal vergeben.');
    ordered.sort((a, b) => a.position - b.position);
    await run('Manuelle Setzliste speichern', d => setManualSeeds(d, key, ordered.map(r => r.id)), true);
  });
  wire('[data-preview]', () => run('Paarungen als Vorschau erzeugen', previewFinals, true));
  wire('[data-start-finals]', () => run('K.-o.-Phase offiziell starten und Qualifikation / Paarungen einfrieren', startFinals, true));
  wire('[data-start-direct]', () => run('Turnierbaum offiziell starten', d => {
    if (d.bracketStartedAt) throw new Error('Turnierbaum wurde bereits gestartet.');
    d.bracketStartedAt = new Date().toISOString();
    d.bracketSnapshot = clone(d.de || { attendees: d.attendees, rounds: d.rounds, matches: d.matches });
  }, true));
  wire('[data-swap]', async b => {
    const key = b.dataset.swap, bracket = swappableBracket(day, key);
    const slots = bracket.matches[bracket.rounds[0]].flatMap((m, i) => ['p1', 'p2'].map(side => ({ value: `${m.id}|${side}`, text: `Spiel ${i + 1} · ${side === 'p1' ? 'oben' : 'unten'}: ${m[side] ? name(m[side]) : 'Freilos'}` })));
    const options = slots.map(s => `<option value="${esc(s.value)}">${esc(s.text)}</option>`).join('');
    const data = await dialog('Spieler oder Freilose tauschen', `<p>Es werden zwei Positionen derselben ersten Runde getauscht. Alle Teilnehmer bleiben erhalten. Nach Beginn werden betroffene Ergebnisse als Konflikt markiert.</p><label>Position A<select name="a">${options}</select></label><label>Position B<select name="b">${options}</select></label>`);
    if (data) {
      const [a, sa] = data.get('a').split('|'), [c, sc] = data.get('b').split('|');
      await run('Paarungen / Freilose tauschen', d => swapSlots(d, key, a, sa, c, sc), true);
    }
  });
  wire('[data-finish]', () => finish());
}
