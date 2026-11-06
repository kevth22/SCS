import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const escapeSource = source('kalender.js').split('\n')[0];
function calendar() {
  const fields = Object.fromEntries(Object.entries({spieltagLiga:'Liga A',spieltagDatum:'2026-12-01',spieltagTreffen:'18:00',spieltagAnwurf:'19:00',spieltagGegner:'  Gegner & Freunde  ',spieltagOrt:'  Halle, Hauptstraße 2, Essen  ',spieltagTyp:'auswaerts'}).map(([key,value])=>[key,{value}]));
  const writes=[], alerts=[];
  const context={window:{},document:{getElementById:id=>fields[id]},addDoc:async(ref,data)=>{writes.push(data);return {id:'new'};},spieltageRef:{},serverTimestamp:()=> 'timestamp',alert:m=>alerts.push(m),console};
  const script=source('kalender.js').split('window.spieltagSpeichern =')[1].split('/* =========================')[0];
  vm.runInNewContext('window.spieltagSpeichern ='+script,context);
  return {fields,writes,alerts,save:context.window.spieltagSpeichern};
}
test('Kalender speichert Gegner und Maps-Adresse getrennt und leert beide Felder',async()=>{
  const c=calendar();await c.save();assert.equal(c.writes.length,1);assert.equal(c.writes[0].gegner,'Gegner & Freunde');assert.equal(c.writes[0].ort,'Halle, Hauptstraße 2, Essen');assert.equal(c.fields.spieltagGegner.value,'');assert.equal(c.fields.spieltagOrt.value,'');
});
for(const field of ['spieltagGegner','spieltagOrt']) test(`Kalender verlangt ${field} vor Datenbankeintrag`,async()=>{const c=calendar();c.fields[field].value=' ';await c.save();assert.equal(c.writes.length,0);assert.equal(c.alerts.length,1);});
function center(day) {
  const elements={spieltagAnzeige:{innerHTML:''},spieltagCounter:{textContent:''}};
  const context={document:{getElementById:id=>elements[id]},spieltage:[day],aktuellerIndex:0,zusagen:[],aktuellerUser:{benutzername:'admin'},rueckmeldungenAnzeigenCenter(){},updateCountdown(){}};
  const script=source('spieltag-center.js').split('function spieltagAnzeigen()')[1].split('window.naechsterSpieltag')[0];
  vm.runInNewContext(escapeSource+'\nfunction spieltagAnzeigen()'+script+'\nspieltagAnzeigen();',context);
  return elements.spieltagAnzeige.innerHTML;
}
for(const typ of ['heim','auswaerts']) test(`Spieltag-Center ${typ}: Gegner separat, Maps verwendet ausschließlich Adresse`,()=>{
  const day={id:'a',liga:'Liga',datum:'2026-12-01',anwurf:'19:00',typ,gegner:'Gegner <A> & B',ort:'Halle & Bistro, Straße 2, Essen'};
  const html=center(day);assert.ok(html.includes(typ==='heim'?'Black White Eagles : Gegner &lt;A&gt; &amp; B':'Gegner &lt;A&gt; &amp; B : Black White Eagles'));assert.ok(html.includes('Spielort: Halle &amp; Bistro'));const href=html.match(/href="([^"]+)"/)[1];assert.equal(new URL(href).searchParams.get('query'),day.ort);assert.ok(html.includes('event.stopPropagation()'));
});
test('Alte Spieltage ohne Gegnerfeld bleiben lesbar; Maps-Ziel unverändert',()=>{const day={id:'old',typ:'auswaerts',ort:'Alter kombinierter Eintrag'};const html=center(day);assert.ok(html.includes('Alter kombinierter Eintrag : Black White Eagles'));assert.equal(new URL(html.match(/href="([^"]+)"/)[1]).searchParams.get('query'),day.ort);});
test('Kalenderdetails zeigen Gegner und Ort mit sicherer Textdarstellung',()=>{
 const day={id:'a',gegner:'Team <A>',ort:'Straße & Halle'};const details={style:{},innerHTML:''};const context={window:{},spieltage:[day],aktuellerUser:null,document:{getElementById:()=>details}};const script=source('kalender.js').split('window.zeigeSpieltag =')[1].split('/* =========================')[0];vm.runInNewContext(escapeSource+'\nwindow.zeigeSpieltag ='+script+'\nwindow.zeigeSpieltag("a");',context);assert.ok(details.innerHTML.includes('Gegner: Team &lt;A&gt;'));assert.ok(details.innerHTML.includes('Ort: Straße &amp; Halle'));
});

function birthdaySubscription() {
  let success, failure;
  const context={mitgliederRef:{},geburtstage:[],geburtstageLadefehler:false,redraws:0,kalenderZeichnen(){context.redraws++;},console:{error(){}},onSnapshot(ref,ok,error){success=ok;failure=error;}};
  const script='onSnapshot(mitgliederRef'+source('kalender.js').split('onSnapshot(mitgliederRef')[1].split('onSnapshot(urlaubeRef')[0];
  vm.runInNewContext(script,context);
  return {context,load:members=>success({forEach:fn=>members.forEach((data,i)=>fn({id:`P${i}`,data:()=>data}))}),fail:()=>failure(new Error('offline'))};
}
test('Geburtstage werden aus echten Mitglieder-Snapshotdaten geladen und nach Rollen gefiltert',()=>{
 const s=birthdaySubscription();s.load([{rolle:' Mitglied ',nickname:'Max',geburtstag:'1980-11-13'},{rolle:'captain',benutzername:'Tim',geburtstag:'1990-12-01'},{rolle:'gast',geburtstag:'1990-11-01'},{rolle:'admin',geburtstag:''}]);assert.equal(s.context.geburtstage.length,2);assert.equal(s.context.geburtstage[0].name,'Max');assert.equal(s.context.redraws,1);
});
test('Geburtstags-Ladefehler bleibt sichtbar und löscht bereits geladene Einträge nicht',()=>{
 const s=birthdaySubscription();s.load([{rolle:'mitglied',nickname:'Max',geburtstag:'1980-11-13'}]);s.fail();assert.equal(s.context.geburtstageLadefehler,true);assert.equal(s.context.geburtstage.length,1);s.load([]);assert.equal(s.context.geburtstageLadefehler,false);
});
function birthdayCalendar(month=10,error=false) {
 const node=()=>({innerHTML:'',textContent:'',children:[],classList:{add(){}},appendChild(child){this.children.push(child);}});
 const elements={kalenderGrid:node(),monatTitel:node(),geburtstagListe:node()};
 const context={document:{getElementById:id=>elements[id],createElement:()=>node()},aktuellesDatum:new Date(2026,month,1),spieltage:[],geburtstage:[{name:'Max <A>',geburtstag:'1980-11-13'},{name:'Tim',geburtstag:'1990-12-01'},{name:'Ben',geburtstag:'2000-11-02'}],geburtstageLadefehler:error,spieltagListeAnzeigen(){}};
 const script='function kalenderZeichnen()'+source('kalender.js').split('function kalenderZeichnen()')[1].split('/* =========================')[0];
 vm.runInNewContext(escapeSource+'\n'+script+'\nkalenderZeichnen();',context);
 return elements;
}
test('Geburtstage erscheinen am richtigen Tag unabhängig vom Geburtsjahr und zusätzlich in Monatsliste',()=>{
 const e=birthdayCalendar();const day=e.kalenderGrid.children.find(n=>n.innerHTML==='<strong>13</strong>');assert.ok(day.children[0].innerHTML.includes('Max &lt;A&gt;'));assert.ok(e.geburtstagListe.innerHTML.includes('13.11.'));assert.ok(e.geburtstagListe.innerHTML.indexOf('Ben')<e.geburtstagListe.innerHTML.indexOf('Max'));assert.ok(!e.geburtstagListe.innerHTML.includes('Tim'));
});
test('Monatswechsel und Ladefehler werden in der Geburtstagsübersicht abgebildet',()=>{const e=birthdayCalendar(11,true);assert.ok(e.geburtstagListe.innerHTML.includes('Tim'));assert.ok(!e.geburtstagListe.innerHTML.includes('Max'));assert.ok(e.geburtstagListe.innerHTML.includes('role="alert"'));});
