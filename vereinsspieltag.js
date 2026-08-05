import { db, getLogin } from './auth-utils.js';
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const REF=doc(db,'vereinsspielserie','hauptserie');
const MODES={premier:'Premier League',swiss:'Schweizer System',doubleko:'Doppel-K.-o.',groupsko:'Gruppen + K.-o.'};
const allowedRoles=['mitglied','captain','kassenwart','admin'];
const login=getLogin();
let currentRole=String(login?.rolle||'').toLowerCase();
let canManage=['admin','captain'].includes(currentRole);

async function refreshSeriesPermission(){
  if(!login?.benutzername) {
    currentRole='';
    canManage=false;
    return;
  }

  try {
    const accountSnap=await getDoc(doc(db,'mitglieder',login.benutzername));
    if(accountSnap.exists()){
      currentRole=String(accountSnap.data().rolle||'gast').trim().toLowerCase();
      canManage=['admin','captain'].includes(currentRole);

      // Den gespeicherten Login aktualisieren, damit die neue Rolle auch
      // auf anderen Seiten sofort gilt.
      const updatedLogin={...login,rolle:currentRole};
      const serialized=JSON.stringify(updatedLogin);
      sessionStorage.setItem('bweLogin',serialized);
      sessionStorage.setItem('user',serialized);
      sessionStorage.setItem('rolle',currentRole);
      if(localStorage.getItem('bweLogin')){
        localStorage.setItem('bweLogin',serialized);
      }
    } else {
      canManage=false;
    }
  } catch(error){
    console.error('Rolle konnte nicht neu geladen werden:',error);
    // Bei einem kurzfristigen Lesefehler bleibt die Rolle aus dem Login aktiv.
    canManage=['admin','captain'].includes(currentRole);
  }
}
const $=id=>document.getElementById(id);

function updateModeFields(){
  const mode=$('dayMode')?.value||'premier';
  const swissWrap=$('swissRoundsWrap');
  const groupWrap=$('groupsSettingsWrap');
  const koWrap=$('koSettingsWrap');

  if(swissWrap) swissWrap.hidden = mode !== 'swiss';
  if(groupWrap) groupWrap.hidden = mode !== 'groupsko';

  // K.-o.-Rundeneinstellungen gelten für Premier League, Doppel-K.-o.
  // und Gruppen + K.-o., aber nicht für das reine Schweizer System.
  if(koWrap) koWrap.hidden = mode === 'swiss';
}
let state={members:[],seasons:[],activeSeasonId:null,current:null};

const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function season(){return state.seasons.find(s=>s.id===state.activeSeasonId)||state.seasons[0]||null}
function blankSeason(name='Saison 2026/27'){return{id:uid(),name,status:'aktiv',createdAt:new Date().toISOString(),ranking:{},days:[]}}
async function save(){await setDoc(REF,{...state,updatedAt:serverTimestamp()});renderAll()}
async function load(){await refreshSeriesPermission();const snap=await getDoc(REF);if(snap.exists())state={...state,...snap.data()};if(!state.seasons?.length){const s=blankSeason();state.seasons=[s];state.activeSeasonId=s.id;await save()}await syncMembers(false);renderAll()}

async function syncMembers(show=true){
  const qs=await getDocs(collection(db,'mitglieder'));
  const next=[];
  qs.forEach(d=>{const x=d.data();const role=String(x.rolle||'').toLowerCase();if(x.aktiv!==false&&allowedRoles.includes(role)){next.push({id:d.id,name:x.nickname||x.spitzname||x.benutzername||d.id,rolle:role})}});
  next.sort((a,b)=>a.name.localeCompare(b.name,'de'));
  state.members=next;
  const s=season();if(s){s.ranking??={};next.forEach(m=>s.ranking[m.id]??=emptyStats())}
  await setDoc(REF,{...state,updatedAt:serverTimestamp()});
  if(show)toast(`${next.length} Spieler synchronisiert.`)
}


function currentSeasonDayCount(){
  const s=season();
  const completed=Array.isArray(s?.days)?s.days.length:0;
  const open=(state.current && state.current.seasonId===s?.id && state.current.status!=='abgeschlossen')?1:0;
  return completed+open;
}

function currentDayBelongsToSeason(){
  const s=season();
  return !!(state.current && s && (!state.current.seasonId || state.current.seasonId===s.id));
}

function updateSeasonSummaryFromSingleSource(){
  const s=season();
  if($('summaryDays')) $('summaryDays').textContent=currentSeasonDayCount();

  if($('summaryMode')){
    if(currentDayBelongsToSeason() && state.current?.mode){
      $('summaryMode').textContent=MODES[state.current.mode]||state.current.mode;
    }else if(s?.days?.length){
      const last=s.days[s.days.length-1];
      $('summaryMode').textContent=MODES[last.mode]||last.mode||'–';
    }else{
      $('summaryMode').textContent='–';
    }
  }
}

async function deleteCurrentDay(){
  if(!canManage) return toast('Nur Admins und Captains dürfen Spieltage löschen.');
  const c=state.current;
  if(!c) return toast('Kein aktueller Spieltag vorhanden.');
  const label=`${c.date||''} · ${MODES[c.mode]||c.mode||'Spieltag'}`;
  if(!confirm(`Spieltag ${label} wirklich löschen?\n\nAlle Paarungen und noch nicht gewerteten Ergebnisse dieses Spieltags werden entfernt.`)) return;

  state.current=null;
  await save();
  toast('Spieltag gelöscht.');
}

async function deleteCompletedDay(dayId){
  if(!canManage) return toast('Nur Admins und Captains dürfen Spieltage löschen.');
  const s=season();
  if(!s?.days?.length) return toast('Kein abgeschlossener Spieltag vorhanden.');
  const day=s.days.find(x=>x.id===dayId);
  if(!day) return toast('Spieltag wurde nicht gefunden.');

  const label=`${day.date||''} · ${MODES[day.mode]||day.mode||'Spieltag'}`;
  if(!confirm(`Abgeschlossenen Spieltag ${label} wirklich löschen?\n\nDie dafür vergebenen Ranglistenpunkte werden ebenfalls zurückgerechnet.`)) return;

  rollbackDayFromRanking(s,day);
  s.days=s.days.filter(x=>x.id!==dayId);
  await save();
  toast('Abgeschlossener Spieltag gelöscht und Rangliste neu berechnet.');
}

function rollbackDayFromRanking(s,day){
  if(!s?.ranking || !day) return;

  // Preferred source: saved per-player result rows.
  const results=Array.isArray(day.results)?day.results:[];
  if(results.length){
    results.forEach(r=>{
      const st=s.ranking[r.id];
      if(!st) return;
      const pts=Number(r.points||0);
      const wins=Number(r.wins||0);
      const lf=Number(r.legsFor||0);
      const la=Number(r.legsAgainst||0);
      const title=Number(r.place)===1?1:0;

      st.points=Math.max(0,Number(st.points||0)-pts);
      st.days=Math.max(0,Number(st.days||0)-1);
      st.wins=Math.max(0,Number(st.wins||0)-wins);
      st.titles=Math.max(0,Number(st.titles||0)-title);
      st.legsFor=Math.max(0,Number(st.legsFor||0)-lf);
      st.legsAgainst=Math.max(0,Number(st.legsAgainst||0)-la);

      if(st.byMode?.[day.mode]){
        const bm=st.byMode[day.mode];
        bm.points=Math.max(0,Number(bm.points||0)-pts);
        bm.days=Math.max(0,Number(bm.days||0)-1);
        bm.wins=Math.max(0,Number(bm.wins||0)-wins);
        bm.titles=Math.max(0,Number(bm.titles||0)-title);
        bm.legsFor=Math.max(0,Number(bm.legsFor||0)-lf);
        bm.legsAgainst=Math.max(0,Number(bm.legsAgainst||0)-la);
      }

      st.history=(st.history||[]).filter(h=>h.dayId!==day.id);
    });
    return;
  }

  // Fallback for older stored days: remove matching history rows and rebuild totals.
  Object.values(s.ranking).forEach(st=>{
    if(!st) return;
    st.history=(st.history||[]).filter(h=>h.dayId!==day.id);
    const all=st.history||[];
    st.points=all.reduce((n,h)=>n+Number(h.points||0),0);
    st.days=all.length;
    st.wins=all.reduce((n,h)=>n+Number(h.wins||0),0);
    st.titles=all.reduce((n,h)=>n+(Number(h.place)===1?1:0),0);
    st.legsFor=all.reduce((n,h)=>n+Number(h.legsFor||0),0);
    st.legsAgainst=all.reduce((n,h)=>n+Number(h.legsAgainst||0),0);

    Object.keys(st.byMode||{}).forEach(mode=>{
      const rows=all.filter(h=>h.mode===mode);
      st.byMode[mode]={
        ...emptyStats(),
        points:rows.reduce((n,h)=>n+Number(h.points||0),0),
        days:rows.length,
        wins:rows.reduce((n,h)=>n+Number(h.wins||0),0),
        titles:rows.reduce((n,h)=>n+(Number(h.place)===1?1:0),0),
        legsFor:rows.reduce((n,h)=>n+Number(h.legsFor||0),0),
        legsAgainst:rows.reduce((n,h)=>n+Number(h.legsAgainst||0),0),
        history:rows
      };
    });
  });
}

function activePreparedDay(){
  return state.current && state.current.status === 'vorbereitung' ? state.current : null;
}

function collectRoundSettings(){
  const result={};
  document.querySelectorAll('[data-round-setting]').forEach(row=>{
    const key=row.dataset.roundSetting;
    result[key]={
      system: row.querySelector('[data-field="system"]')?.value || 'legs',
      win: +(row.querySelector('[data-field="win"]')?.value || 3),
      legsPerSet: +(row.querySelector('[data-field="legsPerSet"]')?.value || 3)
    };
  });
  return result;
}

function selectedAttendees(){
  return [...document.querySelectorAll('[data-attend]:checked')].map(x=>x.dataset.attend);
}

function readPreparationSettings(){
  const mode=$('dayMode')?.value || state.current?.mode || 'premier';
  return {
    date:$('dayDate')?.value || state.current?.date || new Date().toISOString().slice(0,10),
    mode,
    out:$('gameOut')?.value || 'Double Out',
    swissRounds:+($('swissRounds')?.value || 4),
    legsToWin:+($('legsToWin')?.value || 3),
    groupCount:$('groupCount')?.value || 'auto',
    groupQualifiers:[...document.querySelectorAll('[data-group-qualifier]:checked')].map(x=>+x.value),
    groupDraw:$('groupDraw')?.value || 'random',
    groupSystem:$('groupSystem')?.value || 'legs',
    groupWin:+($('groupWin')?.value || 3),
    groupLegsPerSet:+($('groupLegsPerSet')?.value || 3),
    roundSettings:collectRoundSettings(),
    targetSize:+($('daySize')?.value || 0)
  };
}

function renderPreparedDayEditor(){
  const box=$('preparedDayEditor');
  if(!box) return;
  const c=activePreparedDay();
  if(!c){
    box.hidden=true;
    box.innerHTML='';
    return;
  }

  const attendees=c.attendees || [];
  box.hidden=false;
  box.innerHTML=`
    <div class="prepared-head">
      <div>
        <span class="eyebrow">Vorbereitung</span>
        <h3>${esc(MODES[c.mode]||c.mode)} · ${esc(c.date)}</h3>
        <p>Modus steht fest. Größe, Teilnehmer und Einstellungen dürfen bis zur Auslosung geändert werden.</p>
      </div>
      <span class="pill">Noch nicht ausgelost</span>
    </div>

    <label>Geplante Turniergröße
      <input id="preparedSize" type="number" min="2" max="128" value="${c.targetSize || attendees.length || ''}" placeholder="z. B. 16">
    </label>

    <div class="prepared-actions">
      <button id="savePreparationBtn">Einstellungen speichern</button>
      <button id="drawPreparedDayBtn" class="primary">Auslosen und starten</button>
      <button id="cancelPreparedDayBtn" class="danger-soft">Spieltag löschen</button>
    </div>
    <p class="hint">${attendees.length} Spieler ausgewählt. Die Größe ist nur eine Planung; ausgelost werden die tatsächlich ausgewählten Spieler.</p>
  `;

  $('savePreparationBtn').onclick=savePreparation;
  $('drawPreparedDayBtn').onclick=drawPreparedDay;
  $('cancelPreparedDayBtn').onclick=cancelPreparedDay;
}

async function savePreparation(){
  if(!canManage) return toast('Nur Admins und Captains dürfen Spieltage bearbeiten.');
  const c=activePreparedDay();
  if(!c) return toast('Kein vorbereiteter Spieltag vorhanden.');

  const settings=readPreparationSettings();
  settings.targetSize=+($('preparedSize')?.value || settings.targetSize || 0);
  const attendees=selectedAttendees();

  Object.assign(c,settings,{
    attendees,
    status:'vorbereitung',
    updatedAt:new Date().toISOString()
  });

  await save();
  toast('Vorbereitung gespeichert.');
}

async function drawPreparedDay(){
  if(!canManage) return toast('Nur Admins und Captains dürfen auslosen.');
  const c=activePreparedDay();
  if(!c) return toast('Kein vorbereiteter Spieltag vorhanden.');

  const attendees=selectedAttendees();
  if(attendees.length < 2) return toast('Bitte mindestens zwei Spieler auswählen.');

  const settings=readPreparationSettings();
  settings.targetSize=+($('preparedSize')?.value || settings.targetSize || attendees.length);
  Object.assign(c,settings,{attendees,status:'laeuft',startedAt:new Date().toISOString()});

  if(c.mode==='swiss'){
    c.engine='swiss';
    c.totalRounds=Math.max(1,c.swissRounds||4);
    c.swissMatches=[];
    pairSwiss(c);
  } else if(c.mode==='groupsko'){
    c.engine='groups';
    setupGroupsDay(c);
  } else if(c.mode==='doubleko'){
    // Existing version uses manual placement for Doppel-K.-o.
    // Keep that engine, but only create it now after explicit drawing.
    c.engine='manual';
    c.manualType='doubleko';
  } else {
    Object.assign(c,makeKO(attendees,c.mode));
    c.status='laeuft';
    c.date=settings.date;
    c.out=settings.out;
    c.legsToWin=settings.legsToWin;
    c.roundSettings=settings.roundSettings;
    c.targetSize=settings.targetSize;
  }

  await save();
  toast('Turnier wurde ausgelost und gestartet.');
}

async function cancelPreparedDay(){
  await deleteCurrentDay();
}

function emptyStats(){return{points:0,days:0,wins:0,titles:0,legsFor:0,legsAgainst:0,byMode:{},history:[]}}
function statFor(s,id,mode='all'){const base=s.ranking?.[id]||emptyStats();return mode==='all'?base:{...emptyStats(),...(base.byMode?.[mode]||{}),history:(base.history||[]).filter(h=>h.mode===mode)}}
function rankingRows(){const s=season(),filter=$('modeFilter')?.value||'all';return state.members.map(m=>({m,st:statFor(s,m.id,filter)})).sort((a,b)=>b.st.points-a.st.points||b.st.titles-a.st.titles||(b.st.legsFor-b.st.legsAgainst)-(a.st.legsFor-a.st.legsAgainst)||a.m.name.localeCompare(b.m.name,'de'))}


function renderDeleteDaysList(){
  const box=$('deleteDaysList');
  if(!box) return;
  if(!canManage){
    box.innerHTML='';
    return;
  }
  const s=season();
  const rows=[];
  if(state.current){
    rows.push(`<div class="delete-day-row"><div><strong>Aktueller Spieltag</strong><br><small>${esc(state.current.date||'')} · ${esc(MODES[state.current.mode]||state.current.mode||'')}</small></div><button id="deleteOpenDayFromList" class="danger-button">Löschen</button></div>`);
  }
  (s?.days||[]).slice().reverse().forEach(d=>{
    rows.push(`<div class="delete-day-row"><div><strong>Abgeschlossen</strong><br><small>${esc(d.date||'')} · ${esc(MODES[d.mode]||d.mode||'')}</small></div><button class="danger-soft" data-delete-day="${d.id}">Löschen</button></div>`);
  });
  box.innerHTML=rows.length?rows.join(''):'<p class="hint">Keine Spieltage vorhanden.</p>';
  if($('deleteOpenDayFromList')) $('deleteOpenDayFromList').onclick=deleteCurrentDay;
}

function renderAll(){updateModeFields();
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!canManage);
  const permissionHint=document.getElementById('seriesPermissionHint');
  if(permissionHint){
    permissionHint.hidden=canManage;
    permissionHint.textContent=login
      ? `Deine aktuell geladene Rolle ist „${currentRole||'gast'}“. Nur Admins und Captains können Spieltage anlegen und Ergebnisse bearbeiten.`
      : 'Bitte anmelden. Nur Admins und Captains können Spieltage anlegen und Ergebnisse bearbeiten.';
  }renderSeason();updateSeasonSummaryFromSingleSource();renderRanking();renderCurrent();renderHistory();renderPreparedDayEditor();renderDeleteDaysList();renderSeriesAdminDrawerList()}
function renderSeason(){const s=season();$('seasonTitle').textContent=s?`${s.name}${s.status==='abgeschlossen'?' · Abgeschlossen':''}`:'Keine Saison';$('seasonPickerButton').textContent=`${s?.name||'Saison auswählen'} ▾`;$('seasonPickerMenu').innerHTML=state.seasons.map(x=>`<button type="button" role="option" data-season-id="${x.id}" class="${x.id===state.activeSeasonId?'active':''}">${esc(x.name)}</button>`).join('');document.querySelectorAll('[data-season-id]').forEach(b=>b.onclick=()=>{state.activeSeasonId=b.dataset.seasonId;closeSeasonPicker();renderAll()});const rows=rankingRows();$('summaryPlayers').textContent=state.members.length;$('summaryDays').textContent=currentSeasonDayCount();$('summaryLeader').textContent=rows[0]?.st.points>0?rows[0].m.name:'–';$('summaryMode').textContent=s?.days?.length?MODES[s.days[s.days.length-1].mode]:'–'}
function renderRanking(){const rows=rankingRows();$('rankingBody').innerHTML=rows.length?rows.map((x,i)=>`<tr data-player="${x.m.id}"><td>${i+1}</td><td><strong>${esc(x.m.name)}</strong><br><small>${esc(x.m.rolle)}</small></td><td>${x.st.days||0}</td><td>${x.st.wins||0}</td><td>${x.st.titles||0}</td><td>${x.st.legsFor||0}:${x.st.legsAgainst||0}</td><td>${(x.st.legsFor||0)-(x.st.legsAgainst||0)}</td><td><strong>${x.st.points||0}</strong></td></tr>`).join(''):'<tr><td colspan="8">Noch keine spielberechtigten Mitglieder vorhanden.</td></tr>';document.querySelectorAll('[data-player]').forEach(r=>r.onclick=()=>openProfile(r.dataset.player))}
function renderAttendance(){
  const list=$('attendanceList');
  if(!list) return;
  const selected=new Set(state.current?.attendees||[]);
  list.innerHTML=state.members.length
    ? state.members.map(m=>`<label class="attendance-row"><span>${esc(m.name)} <small>(${esc(m.rolle)})</small></span><input type="checkbox" data-attend="${m.id}" ${selected.size?(selected.has(m.id)?'checked':''):'checked'}></label>`).join('')
    : '<p class="hint">Noch keine aktiven Mitglieder, Captains, Kassenwarte oder Admins gefunden.</p>';
}
function renderCurrent(){
  const c=state.current;
  const currentActions=$('currentDayAdminActions');
  if(currentActions) currentActions.hidden=!(canManage&&c);

  if(!c){
    $('currentDayTitle').textContent='Aktueller Spieltag';
    $('currentDayInfo').textContent='Kein Spieltag eingerichtet.';
    $('currentStatus').textContent='Bereit';
    $('dayWorkspace').innerHTML='<div class="empty-state">Richte zuerst im Bereich Verwaltung einen Spieltag ein. Danach wählst du hier die anwesenden Spieler aus.</div>';
    return;
  }

  if(c.engine==='draft' || c.status==='vorbereitung'){
    renderDraftParticipants(c);
    return;
  }

  $('currentDayTitle').textContent=MODES[c.mode]||c.mode;
  $('currentDayInfo').textContent=`${c.date} · ${(c.attendees||[]).length} Teilnehmer · ${c.out||''}`;
  $('currentStatus').textContent=c.paused?'Pausiert':'Läuft';

  if(c.engine==='ko') renderKO(c);
  else if(c.engine==='swiss') renderSwiss(c);
  else if(c.engine==='groups') renderGroups(c);
  else renderManual(c);
}
function renderDraftParticipants(c){
  const selected=new Set(c.attendees||[]);
  $('currentDayTitle').textContent=`${MODES[c.mode]} einrichten`;
  $('currentDayInfo').textContent=`${c.date} · ${c.out} · Spieler für diesen Spieltag auswählen`;
  $('currentStatus').textContent='Teilnehmer wählen';
  $('dayWorkspace').innerHTML=`<div class="config-card"><h3>Anwesende Spieler</h3><p class="hint">Wähle jetzt die Spieler aus, die an diesem Tag wirklich dabei sind. Auch ein Admin kann optional mitspielen.</p><div class="attendance-list">${state.members.map(m=>`<label class="attendance-row"><span>${esc(m.name)} <small>(${esc(m.rolle)})</small></span><input type="checkbox" data-draft-attend="${m.id}" ${selected.has(m.id)?'checked':''}></label>`).join('')||'<p class="hint">Keine auswählbaren Konten vorhanden.</p>'}</div><div class="workspace-actions"><button id="launchDraftDay" class="primary">Spieler übernehmen und Turnier starten</button><button id="cancelDraftDay">Spieltag verwerfen</button></div></div>`;
  $('launchDraftDay').onclick=launchDraftDay;
  $('cancelDraftDay').onclick=async()=>{if(confirm('Eingerichteten Spieltag wirklich verwerfen?')){state.current=null;await save()}};
}
async function launchDraftDay(){const c=state.current,ids=[...document.querySelectorAll('[data-draft-attend]:checked')].map(x=>x.dataset.draftAttend);if(ids.length<2)return toast('Mindestens 2 Spieler auswählen.');if(ids.length>16)return toast('Maximal 16 Spieler möglich.');const base={...c,status:'laeuft',attendees:ids,startedAt:new Date().toISOString()};delete base.engine;if(c.mode==='premier')state.current={...base,...makeKO(ids,c.mode)};else if(c.mode==='swiss'){state.current={...base,engine:'swiss',swissMatches:[]};pairSwiss(state.current)}else if(c.mode==='groupsko'){const count=c.groupCount==='auto'?autoGroupCount(ids.length):+c.groupCount;if(count<2||count>ids.length)return toast('Die Gruppenanzahl passt nicht zur Teilnehmerzahl.');const groups=makeGroups(ids,count,c.groupDrawMode);const minSize=Math.min(...groups.map(g=>g.players.length));if(c.qualifyPlaces.some(x=>x>minSize))return toast(`Die kleinste Gruppe hat nur ${minSize} Spieler.`);state.current={...base,engine:'groups',groups}}else state.current={...base,engine:'manual'};await save();toast('Turnier gestartet.')}
function renderKO(c){autoAdvance(c);$('dayWorkspace').innerHTML=`<div class="bracket">${c.rounds.map(r=>`<div class="round-column"><h3>${r}</h3>${c.matches[r].map((m,i)=>koMatch(r,m,i)).join('')}</div>`).join('')}</div><div class="workspace-actions admin-only"><button id="finishCurrent" class="primary">Spieltag abschließen</button></div>`;document.querySelectorAll('[data-ko-save]').forEach(b=>b.onclick=()=>saveKOMatch(b.dataset.round,+b.dataset.index));const final=c.matches[c.rounds.at(-1)][0];$('finishCurrent').disabled=!final?.completed;$('finishCurrent').onclick=finishCurrent}
function koMatch(r,m,i){const ready=m.p1&&m.p2&&!m.completed,rule=roundRule(state.current,r),setMode=rule.format==='sets';return`<div class="match-card"><small>${r} ${i+1}</small><span class="match-rule">${ruleText(rule)}</span><div class="match-player ${m.winner===m.p1?'winner':''}"><span>${m.p1?esc(memberName(m.p1)):'—'}</span><input id="a-${m.id}" type="number" min="0" value="${m.s1??''}" ${!ready||!canManage?'disabled':''}></div><div class="match-player ${m.winner===m.p2?'winner':''}"><span>${m.p2?esc(memberName(m.p2)):'—'}</span><input id="b-${m.id}" type="number" min="0" value="${m.s2??''}" ${!ready||!canManage?'disabled':''}></div>${setMode&&ready?`<div class="set-leg-inputs"><label>Legs ${esc(memberName(m.p1))}<input id="la-${m.id}" type="number" min="0" value="${m.legs1??''}"></label><label>Legs ${esc(memberName(m.p2))}<input id="lb-${m.id}" type="number" min="0" value="${m.legs2??''}"></label></div>`:''}${m.bye?'<div class="bye">Freilos</div>':`<button data-ko-save="1" data-round="${r}" data-index="${i}" ${!ready||!canManage?'disabled':''}>Ergebnis speichern</button>`}</div>`}
async function saveKOMatch(r,i){const m=state.current.matches[r][i],rule=roundRule(state.current,r),a=+$(`a-${m.id}`).value,b=+$(`b-${m.id}`).value;if(a===b||a<0||b<0)return toast('Bitte ein eindeutiges Ergebnis eintragen.');if(Math.max(a,b)!==rule.toWin||Math.min(a,b)>=rule.toWin)return toast(`Der Sieger muss genau ${rule.toWin} ${rule.format==='sets'?'Sets':'Legs'} erreichen.`);m.s1=a;m.s2=b;m.legs1=rule.format==='sets'?+( $(`la-${m.id}`)?.value||0):a;m.legs2=rule.format==='sets'?+( $(`lb-${m.id}`)?.value||0):b;m.winner=a>b?m.p1:m.p2;m.completed=true;autoAdvance(state.current);await save();toast('Ergebnis gespeichert.')}

function renderSwiss(c){const standings=swissStandings(c),round=c.swissMatches.length,current=c.swissMatches.at(-1)||[];const roundDone=current.length&&current.every(m=>m.completed);$('dayWorkspace').innerHTML=`<div class="swiss-header"><h3>Runde ${round} von ${c.totalRounds}</h3><span class="pill">Schweizer System</span></div><div class="table-scroll"><table class="swiss-table"><thead><tr><th>#</th><th>Spieler</th><th>MP</th><th>Buchholz</th><th>Siege</th><th>Leg-Diff.</th></tr></thead><tbody>${standings.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(memberName(x.id))}</td><td>${x.mp}</td><td>${x.buchholz}</td><td>${x.wins}</td><td>${x.legsFor-x.legsAgainst}</td></tr>`).join('')}</tbody></table></div><h3>Paarungen Runde ${round}</h3>${current.map((m,i)=>swissMatch(m,i)).join('')}<div class="workspace-actions admin-only">${round<c.totalRounds?`<button id="nextSwiss" class="primary" ${!roundDone?'disabled':''}>Nächste Runde auslosen</button>`:`<button id="finishCurrent" class="primary" ${!roundDone?'disabled':''}>Spieltag abschließen</button>`}</div>`;document.querySelectorAll('[data-swiss-save]').forEach(b=>b.onclick=()=>saveSwissMatch(+b.dataset.index));if($('nextSwiss'))$('nextSwiss').onclick=async()=>{pairSwiss(c);await save()};if($('finishCurrent'))$('finishCurrent').onclick=finishCurrent}
function swissMatch(m,i){if(m.bye)return`<div class="swiss-match"><strong>${esc(memberName(m.p1))}</strong> – Freilos</div>`;return`<div class="swiss-match"><div class="match-player"><span>${esc(memberName(m.p1))}</span><input id="sa-${m.id}" type="number" min="0" value="${m.s1??''}" ${m.completed||!canManage?'disabled':''}></div><div class="match-player"><span>${esc(memberName(m.p2))}</span><input id="sb-${m.id}" type="number" min="0" value="${m.s2??''}" ${m.completed||!canManage?'disabled':''}></div><button data-swiss-save="1" data-index="${i}" ${m.completed||!canManage?'disabled':''}>Ergebnis speichern</button></div>`}
async function saveSwissMatch(i){const m=state.current.swissMatches.at(-1)[i],a=+$(`sa-${m.id}`).value,b=+$(`sb-${m.id}`).value;if(a===b||a<0||b<0)return toast('Bitte ein eindeutiges Ergebnis eintragen.');const target=state.current.legsToWin||3;if(Math.max(a,b)!==target||Math.min(a,b)>=target)return toast(`Der Sieger muss genau ${target} Legs erreichen.`);m.s1=a;m.s2=b;m.winner=a>b?m.p1:m.p2;m.completed=true;await save()}


function autoGroupCount(n){return n<=8?2:n<=12?3:4}
function rankingPoints(id){return season()?.ranking?.[id]?.points||0}
function makeGroups(ids,count,drawMode){
  let ordered=drawMode==='seeded'?[...ids].sort((a,b)=>rankingPoints(b)-rankingPoints(a)||memberName(a).localeCompare(memberName(b),'de')):shuffle(ids);
  const groups=Array.from({length:count},(_,i)=>({id:String.fromCharCode(65+i),players:[],matches:[]}));
  if(drawMode==='seeded'){
    let index=0,dir=1;
    ordered.forEach(id=>{groups[index].players.push(id);if(dir===1&&index===groups.length-1)dir=-1;else if(dir===-1&&index===0)dir=1;else index+=dir});
  }else ordered.forEach((id,i)=>groups[i%count].players.push(id));
  groups.forEach(g=>{for(let i=0;i<g.players.length;i++)for(let j=i+1;j<g.players.length;j++)g.matches.push({id:uid(),p1:g.players[i],p2:g.players[j],s1:null,s2:null,winner:null,completed:false})});
  return groups;
}
function groupStandings(g){
  const map={};g.players.forEach(id=>map[id]={id,mp:0,wins:0,legsFor:0,legsAgainst:0});
  g.matches.forEach(m=>{if(!m.completed)return;map[m.p1].legsFor+=m.s1;map[m.p1].legsAgainst+=m.s2;map[m.p2].legsFor+=m.s2;map[m.p2].legsAgainst+=m.s1;map[m.winner].mp+=2;map[m.winner].wins++});
  return Object.values(map).sort((a,b)=>b.mp-a.mp||(b.legsFor-b.legsAgainst)-(a.legsFor-a.legsAgainst)||b.legsFor-a.legsFor||memberName(a.id).localeCompare(memberName(b.id),'de'));
}
function allGroupMatchesDone(c){return c.groups.every(g=>g.matches.every(m=>m.completed))}
function renderGroups(c){
  const done=allGroupMatchesDone(c);
  $('dayWorkspace').innerHTML=`<div class="group-phase-head"><div><h3>Gruppenphase</h3><p>${c.groups.length} Gruppen · Weiter: ${c.qualifyPlaces.map(x=>'Platz '+x).join(', ')}</p></div><span class="pill">${done?'Bereit für K.-o.':'Läuft'}</span></div><div class="group-grid">${c.groups.map(g=>groupCard(c,g)).join('')}</div><div class="workspace-actions admin-only"><button id="createGroupKO" class="primary" ${!done?'disabled':''}>K.-o.-Phase erstellen</button></div>`;
  document.querySelectorAll('[data-group-save]').forEach(b=>b.onclick=()=>saveGroupMatch(b.dataset.group,+b.dataset.index));
  $('createGroupKO').onclick=createGroupKO;
}
function groupCard(c,g){const standings=groupStandings(g);return`<article class="group-card"><h3>Gruppe ${g.id}</h3><table class="group-table"><thead><tr><th>#</th><th>Spieler</th><th>SP</th><th>S</th><th>Diff.</th></tr></thead><tbody>${standings.map((x,i)=>`<tr class="${c.qualifyPlaces.includes(i+1)?'qualified-row':''}"><td>${i+1}</td><td>${esc(memberName(x.id))}</td><td>${x.mp}</td><td>${x.wins}</td><td>${x.legsFor-x.legsAgainst}</td></tr>`).join('')}</tbody></table>${g.matches.map((m,i)=>groupMatch(c,g,m,i)).join('')}</article>`}
function groupMatch(c,g,m,i){return`<div class="group-match"><div class="match-player ${m.winner===m.p1?'winner':''}"><span>${esc(memberName(m.p1))}</span><input id="ga-${m.id}" type="number" min="0" value="${m.s1??''}" ${m.completed||!canManage?'disabled':''}></div><div class="match-player ${m.winner===m.p2?'winner':''}"><span>${esc(memberName(m.p2))}</span><input id="gb-${m.id}" type="number" min="0" value="${m.s2??''}" ${m.completed||!canManage?'disabled':''}></div><button data-group-save="1" data-group="${g.id}" data-index="${i}" ${m.completed||!canManage?'disabled':''}>Ergebnis speichern</button></div>`}
async function saveGroupMatch(groupId,i){const g=state.current.groups.find(x=>x.id===groupId),m=g.matches[i],a=+$(`ga-${m.id}`).value,b=+$(`gb-${m.id}`).value,target=state.current.groupLegsToWin||3;if(a===b||a<0||b<0)return toast('Bitte ein eindeutiges Ergebnis eintragen.');if(Math.max(a,b)!==target||Math.min(a,b)>=target)return toast(`Der Sieger muss genau ${target} Legs erreichen.`);m.s1=a;m.s2=b;m.winner=a>b?m.p1:m.p2;m.completed=true;await save();toast('Gruppenergebnis gespeichert.')}
function createGroupKO(){
  const c=state.current,qualified=[];
  c.groups.forEach(g=>{const table=groupStandings(g);c.qualifyPlaces.forEach(place=>{const x=table[place-1];if(x)qualified.push({...x,group:g.id,groupPlace:place})})});
  if(qualified.length<2)return toast('Es kommen zu wenige Spieler weiter.');
  if(qualified.length>16)return toast('Maximal 16 Spieler können in die K.-o.-Phase einziehen.');
  qualified.sort((a,b)=>a.groupPlace-b.groupPlace||b.mp-a.mp||(b.legsFor-b.legsAgainst)-(a.legsFor-a.legsAgainst));
  const size=bracketSize(qualified.length),slots=Array(size).fill(null),pool=[...qualified];
  for(let i=0;i<Math.ceil(size/2);i++){const a=pool.shift();if(!a)break;slots[i*2]=a.id;let idx=pool.length-1;while(idx>0&&pool[idx].group===a.group)idx--;const b=pool.splice(Math.max(0,idx),1)[0];if(b)slots[i*2+1]=b.id}
  const names=size===16?['Achtelfinale','Viertelfinale','Halbfinale','Finale']:size===8?['Viertelfinale','Halbfinale','Finale']:['Halbfinale','Finale'],matches={};
  names.forEach((r,ri)=>matches[r]=Array(size/2**(ri+1)).fill(0).map((_,i)=>({id:uid(),p1:ri?null:slots[i*2],p2:ri?null:slots[i*2+1],s1:null,s2:null,winner:null,completed:false,bye:false})));
  c.groupData={groups:c.groups,qualifyPlaces:c.qualifyPlaces,groupLegsToWin:c.groupLegsToWin,qualifiedIds:qualified.map(x=>x.id)};c.engine='ko';c.rounds=names;c.matches=matches;c.size=size;autoAdvance(c);save();toast('K.-o.-Phase erstellt.');
}

function renderManual(c){$('dayWorkspace').innerHTML=`<div class="empty-state"><h3>${MODES[c.mode]}</h3><p>${c.mode==='doubleko'?'Die Partien werden im Doppel-K.-o. gespielt. Nach dem letzten Spiel trägst du hier die endgültigen Platzierungen ein.':'Nach Gruppenphase und K.-o.-Runde trägst du hier die endgültigen Platzierungen ein.'}</p></div><div class="manual-grid">${c.attendees.map(id=>`<div class="manual-row"><strong>#</strong><span>${esc(memberName(id))}</span><select data-place="${id}">${c.attendees.map((_,i)=>`<option value="${i+1}">${i+1}. Platz</option>`).join('')}</select></div>`).join('')}</div><div class="workspace-actions admin-only"><button id="finishCurrent" class="primary">Platzierungen prüfen und Spieltag abschließen</button></div>`;$('finishCurrent').onclick=finishCurrent}

function placementPoints(n,place){const group=n>=13?[20,15,11,11,7,7,7,7,3]:n>=9?[18,13,9,9,5,5,5,5,3]:n>=5?[15,10,6,6,2]:[10,6,2];return group[Math.min(place-1,group.length-1)]||group.at(-1)}
function resultsFor(c){if(c.engine==='swiss')return swissStandings(c).map((x,i)=>({id:x.id,place:i+1,wins:x.wins,legsFor:x.legsFor,legsAgainst:x.legsAgainst}));if(c.engine==='manual'){const vals=[...document.querySelectorAll('[data-place]')].map(x=>({id:x.dataset.place,place:+x.value}));if(new Set(vals.map(x=>x.place)).size!==vals.length)throw new Error('Jede Platzierung darf nur einmal vergeben werden.');return vals.sort((a,b)=>a.place-b.place).map(x=>({...x,wins:0,legsFor:0,legsAgainst:0}))}const losses={},stats={};c.attendees.forEach(id=>stats[id]={wins:0,legsFor:0,legsAgainst:0});if(c.groupData?.groups)c.groupData.groups.forEach(g=>g.matches.forEach(m=>{if(!m.completed)return;stats[m.winner].wins++;stats[m.p1].legsFor+=m.s1;stats[m.p1].legsAgainst+=m.s2;stats[m.p2].legsFor+=m.s2;stats[m.p2].legsAgainst+=m.s1}));c.rounds.forEach(r=>c.matches[r].forEach(m=>{if(!m.completed)return;const loser=m.winner===m.p1?m.p2:m.p1;if(loser)losses[loser]=r;if(!m.bye&&m.p1&&m.p2){stats[m.winner].wins++;const l1=m.legs1??m.s1,l2=m.legs2??m.s2;stats[m.p1].legsFor+=l1;stats[m.p1].legsAgainst+=l2;stats[m.p2].legsFor+=l2;stats[m.p2].legsAgainst+=l1}}));const final=c.matches[c.rounds.at(-1)][0],winner=final.winner;return c.attendees.map(id=>{let place=id===winner?1:losses[id]==='Finale'?2:losses[id]==='Halbfinale'?3:losses[id]==='Viertelfinale'?5:9;return{id,place,...stats[id]}}).sort((a,b)=>a.place-b.place)}
async function finishCurrent(){try{const c=state.current,s=season(),results=resultsFor(c);results.forEach(r=>{const base=s.ranking[r.id]||emptyStats(),pts=placementPoints(c.attendees.length,r.place)+(r.wins||0);base.points+=pts;base.days++;base.wins+=r.wins||0;base.titles+=r.place===1?1:0;base.legsFor+=r.legsFor||0;base.legsAgainst+=r.legsAgainst||0;base.byMode??={};const bm=base.byMode[c.mode]||emptyStats();bm.points+=pts;bm.days++;bm.wins+=r.wins||0;bm.titles+=r.place===1?1:0;bm.legsFor+=r.legsFor||0;bm.legsAgainst+=r.legsAgainst||0;base.byMode[c.mode]=bm;base.history??=[];base.history.push({dayId:c.id,date:c.date,mode:c.mode,place:r.place,points:pts});s.ranking[r.id]=base});const day={...c,results,finishedAt:new Date().toISOString()};day.results=results.map(r=>({...r,points:placementPoints(c.attendees.length,r.place)}));
day.results.forEach(r=>{
  const st=s.ranking?.[r.id];
  if(st?.history?.length){
    const last=[...st.history].reverse().find(h=>!h.dayId && h.date===c.date && h.mode===c.mode);
    if(last) last.dayId=day.id;
  }
});
s.days.push(day);state.current=null;await save();toast('Spieltag abgeschlossen und Punkte gebucht.')}catch(e){toast(e.message||'Spieltagsabschluss nicht möglich.')}}

function renderHistory(){const s=season(),days=[...(s?.days||[])].reverse();$('historyList').innerHTML=days.length?days.map(d=>{const top=[...(d.results||[])].sort((a,b)=>a.place-b.place).slice(0,3);return`<article class="history-card"><div class="history-card-head"><div><h3>${esc(d.date)}</h3><p>${d.attendees.length} Teilnehmer · ${esc(d.out||'')}</p></div><span class="mode-badge">${MODES[d.mode]}</span></div><div class="history-podium">${top.map(x=>`${x.place}. ${esc(memberName(x.id))}`).join(' · ')}</div>${canManage?`<div class="history-card-actions"><button data-edit-day="${d.id}">Ergebnisse ändern</button></div>`:''}</article>`}).join(''):'<div class="empty-state">Noch keine abgeschlossenen Spieltage.</div>';document.querySelectorAll('[data-edit-day]').forEach(b=>b.onclick=()=>reopenFinishedDay(b.dataset.editDay))}
function openProfile(id){const m=state.members.find(x=>x.id===id),st=statFor(season(),id,$('modeFilter').value);$('profileContent').innerHTML=`<h2>${esc(m.name)}</h2><p>${esc(m.rolle)}</p><div class="profile-stats"><div><strong>${st.points||0}</strong>Punkte</div><div><strong>${st.days||0}</strong>Spieltage</div><div><strong>${st.wins||0}</strong>Siege</div><div><strong>${st.titles||0}</strong>Titel</div><div><strong>${st.legsFor||0}:${st.legsAgainst||0}</strong>Legs</div><div><strong>${(st.legsFor||0)-(st.legsAgainst||0)}</strong>Leg-Diff.</div></div><div class="profile-history"><h3>Letzte Spieltage</h3>${(st.history||[]).slice(-8).reverse().map(h=>`<div class="profile-history-row"><span>${esc(h.date)}</span><span>${MODES[h.mode]}</span><strong>+${h.points}</strong></div>`).join('')||'<p>Keine Ergebnisse.</p>'}</div>`;$('profileModal').hidden=false}

function closeSeasonPicker(){$('seasonPickerMenu').hidden=true;$('seasonPickerButton').setAttribute('aria-expanded','false')}
$('seasonPickerButton').onclick=e=>{e.stopPropagation();const menu=$('seasonPickerMenu');menu.hidden=!menu.hidden;$('seasonPickerButton').setAttribute('aria-expanded',String(!menu.hidden))};document.addEventListener('click',e=>{if(!e.target.closest('.season-picker'))closeSeasonPicker()});$('modeFilter').onchange=renderRanking;$('closeProfile').onclick=()=>$('profileModal').hidden=true;$('profileModal').onclick=e=>{if(e.target===$('profileModal'))$('profileModal').hidden=true};
$('createSeasonBtn').onclick=async()=>{const name=$('newSeasonName').value.trim();if(!name)return toast('Bitte einen Saisonnamen eingeben.');const s=blankSeason(name);state.members.forEach(m=>s.ranking[m.id]=emptyStats());state.seasons.push(s);state.activeSeasonId=s.id;$('newSeasonName').value='';await save();toast('Neue Saison angelegt.')};$('syncMembersBtn').onclick=()=>syncMembers(true);
$('finishSeasonBtn').onclick=async()=>{const s=season();if(!s)return;if(state.current)return toast('Bitte zuerst den aktuellen Spieltag beenden oder verwerfen.');if(s.status==='abgeschlossen')return toast('Die Saison ist bereits abgeschlossen.');if(!confirm(`${s.name} wirklich abschließen? Danach können keine neuen Spieltage mehr hinzugefügt werden.`))return;s.status='abgeschlossen';s.closedAt=new Date().toISOString();await save();toast('Saison abgeschlossen.')};
$('deleteSeasonBtn').onclick=async()=>{const s=season();if(!s)return;if(state.current)return toast('Bitte zuerst den aktuellen Spieltag beenden oder verwerfen.');if(!confirm(`${s.name} dauerhaft löschen? Alle Spieltage, Ergebnisse und Punkte dieser Saison gehen verloren.`))return;state.seasons=state.seasons.filter(x=>x.id!==s.id);if(!state.seasons.length){const n=blankSeason();state.seasons=[n]}state.activeSeasonId=state.seasons[0].id;await save();toast('Saison gelöscht.')};
$('dayMode').onchange=()=>{const mode=$('dayMode').value,swiss=mode==='swiss',groups=mode==='groupsko';$('swissRoundsWrap').hidden = $('dayMode').value !== 'swiss';$('swissFormatWrap').hidden=!swiss;$('groupsConfigWrap').hidden=!groups;$('koRoundSettings').hidden=swiss};
async function startDay(){
  if(!canManage){
    return toast('Nur Admins und Captains dürfen Spieltage einrichten.');
  }

  const s=season();
  if(!s){
    return toast('Bitte zuerst eine Saison erstellen.');
  }
  if(s.status==='abgeschlossen'){
    return toast('Diese Saison ist abgeschlossen.');
  }
  if(state.current){
    return toast('Es gibt bereits einen offenen Spieltag. Öffne oder lösche ihn zuerst.');
  }

  const mode=$('dayMode').value;
  const selected=[...document.querySelectorAll('[data-qualify-place]:checked')]
    .map(x=>+x.value)
    .sort((a,b)=>a-b);

  if(mode==='groupsko' && !selected.length){
    return toast('Mindestens eine Gruppenplatzierung auswählen.');
  }

  state.current={
    id:uid(),
    seasonId:s.id,
    status:'vorbereitung',
    engine:'draft',
    date:$('dayDate').value || new Date().toISOString().slice(0,10),
    mode,
    out:$('gameOut').value,
    targetSize:+($('daySize')?.value || 0),
    legsToWin:+$('swissLegsToWin').value || 3,
    totalRounds:+$('swissRounds').value || 4,
    roundConfig:collectRoundConfig(),
    groupCount:$('groupCount').value,
    groupDrawMode:$('groupDrawMode').value,
    qualifyPlaces:selected,
    groupLegsToWin:+$('groupLegsToWin').value || 3,
    attendees:[],
    configuredAt:new Date().toISOString()
  };

  await save();
  document.querySelector('[data-tab="spieltag"]')?.click();
  toast('Spieltag eingerichtet. Jetzt Spieler auswählen.');
}

$('startDayBtn').onclick=startDay;

document.querySelectorAll('.serie-tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.serie-tabs button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.serie-panel').forEach(x=>x.classList.toggle('active',x.id===`tab-${b.dataset.tab}`))});
$('dayDate').value=new Date().toISOString().slice(0,10);
load().catch(e=>{console.error(e);toast(`Daten konnten nicht geladen werden: ${e?.message||'Unbekannter Fehler'}`)});

$('dayMode').onchange();

function openSeriesAdminDrawer(){if(!canManage)return;const drawer=$('seriesAdminDrawer'),backdrop=$('seriesAdminDrawerBackdrop');drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');backdrop.hidden=false;renderSeriesAdminDrawerList()}
function closeSeriesAdminDrawer(){const drawer=$('seriesAdminDrawer'),backdrop=$('seriesAdminDrawerBackdrop');drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');backdrop.hidden=true}
function renderSeriesAdminDrawerList(){const box=$('seriesAdminDayList');if(!box)return;const s=season(),days=[...(s?.days||[])].reverse();let html='';if(state.current){html+=`<article class="series-admin-day-card"><h3>Aktueller Spieltag</h3><p>${esc(state.current.date)} · ${MODES[state.current.mode]}</p><button data-open-current>Öffnen und bearbeiten</button></article>`}html+=days.map(d=>`<article class="series-admin-day-card"><h3>${esc(d.date)}</h3><p>${MODES[d.mode]} · ${d.attendees?.length||0} Spieler</p><button data-reopen-day="${d.id}">Ergebnisse ändern</button>${canManage?`<button class="history-delete danger-soft" data-delete-day="${d.id}">Spieltag löschen</button>`:''}</article>`).join('');box.innerHTML=html||'<p>Noch keine Spieltage vorhanden.</p>';box.querySelector('[data-open-current]')?.addEventListener('click',()=>{closeSeriesAdminDrawer();document.querySelector('[data-tab="spieltag"]')?.click()});box.querySelectorAll('[data-reopen-day]').forEach(b=>b.onclick=()=>reopenFinishedDay(b.dataset.reopenDay))}
function rollbackFinishedDay(day){const s=season();for(const r of day.results||[]){const base=s.ranking?.[r.id];if(!base)continue;const pts=placementPoints(day.attendees.length,r.place)+(r.wins||0);base.points=Math.max(0,(base.points||0)-pts);base.days=Math.max(0,(base.days||0)-1);base.wins=Math.max(0,(base.wins||0)-(r.wins||0));base.titles=Math.max(0,(base.titles||0)-(r.place===1?1:0));base.legsFor=Math.max(0,(base.legsFor||0)-(r.legsFor||0));base.legsAgainst=Math.max(0,(base.legsAgainst||0)-(r.legsAgainst||0));if(base.byMode?.[day.mode]){const bm=base.byMode[day.mode];bm.points=Math.max(0,(bm.points||0)-pts);bm.days=Math.max(0,(bm.days||0)-1);bm.wins=Math.max(0,(bm.wins||0)-(r.wins||0));bm.titles=Math.max(0,(bm.titles||0)-(r.place===1?1:0));bm.legsFor=Math.max(0,(bm.legsFor||0)-(r.legsFor||0));bm.legsAgainst=Math.max(0,(bm.legsAgainst||0)-(r.legsAgainst||0))}base.history=(base.history||[]).filter(h=>h.dayId!==day.id)}}
async function reopenFinishedDay(dayId){if(!canManage)return;if(state.current)return toast('Bitte zuerst den aktuell laufenden Spieltag abschließen.');const s=season(),idx=(s?.days||[]).findIndex(d=>d.id===dayId);if(idx<0)return toast('Spieltag nicht gefunden.');const day=s.days[idx];if(!confirm(`Spieltag vom ${day.date} zur Bearbeitung öffnen? Die bisherigen Punkte werden vorübergehend zurückgenommen und nach dem erneuten Abschluss neu gebucht.`))return;rollbackFinishedDay(day);s.days.splice(idx,1);state.current={...day,results:undefined,finishedAt:undefined,reopenedAt:new Date().toISOString()};await save();closeSeriesAdminDrawer();document.querySelector('[data-tab="spieltag"]')?.click();toast('Spieltag zur Bearbeitung geöffnet.')}
$('seriesAdminMenuBtn')?.addEventListener('click',openSeriesAdminDrawer);$('closeSeriesAdminDrawer')?.addEventListener('click',closeSeriesAdminDrawer);$('seriesAdminDrawerBackdrop')?.addEventListener('click',closeSeriesAdminDrawer);document.querySelectorAll('[data-drawer-tab]').forEach(b=>b.addEventListener('click',()=>{closeSeriesAdminDrawer();document.querySelector(`[data-tab="${b.dataset.drawerTab}"]`)?.click()}));

document.addEventListener('DOMContentLoaded',()=>{
  const modeSelect=$('dayMode');
  if(modeSelect){
    modeSelect.addEventListener('change',updateModeFields);
    updateModeFields();
  }
});

async function createPreparedDay(){
  if(!canManage) return toast('Nur Admins und Captains dürfen Spieltage anlegen.');
  const s=season();
  if(!s) return toast('Bitte zuerst eine Saison anlegen.');
  if(state.current && state.current.status!=='abgeschlossen') return toast('Es gibt bereits einen offenen Spieltag.');
  state.current={
    id:uid(),seasonId:s.id,
    date:$('dayDate')?.value||new Date().toISOString().slice(0,10),
    mode:$('dayMode')?.value||'premier',
    status:'vorbereitung',attendees:[],targetSize:0,
    createdAt:new Date().toISOString(),
    createdBy:login?.benutzername||''
  };
  await save();
}

document.addEventListener('DOMContentLoaded',()=>{
  const del=$('deleteCurrentDayBtn');
  if(del) del.onclick=deleteCurrentDay;
});

document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-delete-day]');
  if(button) deleteCompletedDay(button.dataset.deleteDay);
});
