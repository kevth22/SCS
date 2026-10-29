"""Browserprüfung der echten gemeinsamen Admin-Komponente, ohne Produktionsdaten.
Benötigt Python playwright und Chromium. Kein Firebase-/Produktionszugriff.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import functools
import re

ROOT = Path(__file__).resolve().parents[1]
HARNESS = '''<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/vereinsserie.css"><link rel="stylesheet" href="/tournament-admin.css"></head><body><main class="app-container serie-wrap"><section id="tab-turnierbaum" class="serie-panel active"><div id="host"></div></section></main><script type="module">
import * as T from '/tournament-engine.js';
import { renderTournamentAdmin, confirmPlan, renderPlayerAvatar } from '/tournament-admin.js';
const players = ['Max', 'Tim', 'Leon', 'Ben'];
const others = ['Dart General', 'Hawkeye', 'Mr.1', 'Prinzessin'];
let day = { id:'browser-test', attendees:[...players,...others], engine:'groups', mode:'groupsko', groupFormat:{format:'legs'}, qualifyPlaces:[1,2], qualificationRules:{gold:[1,2],silver:[3,4]}, groups:[{id:'G1',name:'Gruppe A',players,matches:T.roundRobinMatches(players)}, {id:'G2',name:'Gruppe B',players:others,matches:T.roundRobinMatches(others)}] };
const first = day.groups[0].matches.find(m => m.p1 === 'Max');
T.editMatch(day, first.id, {status:'completed',s1:2,s2:1,legs1:2,legs2:1});
const displayName = id => id === 'Tim' ? 'Hackenschorschie mit langem Spielernamen' : id||'Offen';
const member = {profilbild: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>')};
function render() { T.normalizeDay(day); renderTournamentAdmin({day,host:document.getElementById('host'),name:displayName,avatar:id=>renderPlayerAvatar(id === 'Max' ? member : null,displayName(id)),editable:true,finish:()=>{},run: async (action,mutate) => { const p=T.planChange(day,action,'admin',mutate); if(await confirmPlan(p,id=>id||'Offen',action)) { day=p.day; window.day=day; render(); } } }); }
window.day=day; render(); window.ready=true;
window.completeGroups = () => { for (const g of day.groups) for (const m of g.matches) { const a=day.attendees.indexOf(m.p1)<day.attendees.indexOf(m.p2); T.editMatch(day,m.id,{status:'completed',s1:a?2:0,s2:a?0:2,legs1:a?2:0,legs2:a?0:2}); } day.qualificationRules={gold:[1,2],silver:[3,4]}; render(); };
window.singleFinals = () => { day.qualificationRules={gold:[1,2],silver:[]}; render(); };
window.freezeFinals = () => { day.qualificationRules={gold:[1,2],silver:[3,4]}; for (const key of ['gold','silver']) T.setManualSeeds(day,key,T.qualification(day,key).rows.map(r=>r.id)); T.previewFinals(day); T.startFinals(day); render(); };
window.correctGroup = () => { const m=day.groups[0].matches[0], a=m.s2, b=m.s1; T.editMatch(day,m.id,{status:'completed',s1:a,s2:b,legs1:a,legs2:b}); render(); };
</script></body></html>'''

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/__create':
            html = (ROOT / 'vereinsserie.html').read_text()
            html = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', html)
            html = html.replace('</body>', '''<script type="module">
import '/tournament-admin.js';
document.querySelectorAll('.serie-panel').forEach(el => el.classList.remove('active'));
document.querySelectorAll('.admin-only').forEach(el => el.hidden=false);
document.getElementById('tab-erstellen').classList.add('active');
document.getElementById('dayDate').value='2026-10-29';
document.getElementById('createParticipantsList').innerHTML='<label class="attendance-row create-attendance-row"><span class="participant-name">Hackenschorschie mit langem Spielernamen <small>(mitglied)</small></span><span class="participant-controls"><select class="participant-group-select"><option>Gruppe A</option></select><input type="checkbox" checked></span></label>';
window.ready=true;
</script></body>''')
            data = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif self.path.split('?')[0] == '/__test':
            html = HARNESS
            if 'legacy=1' in self.path:
                html = html.replace('<link rel="stylesheet" href="/tournament-admin.css">', '')
            data = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()
    def log_message(self, *_):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for width, height, legacy in [(1440, 1000, False), (390, 844, False), (390, 844, True)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/__test' + ('?legacy=1' if legacy else ''))
            page.wait_for_function('window.ready === true')
            expect(page.get_by_role('heading', name='Gruppe A', exact=True)).to_be_visible()
            expect(page.locator('.group-card > h3').first).to_have_css('color', 'rgb(0, 0, 0)')
            expect(page.locator('link[href$="tournament-admin.css?v=6"]')).to_have_count(1)
            expect(page.locator('.tournament-qualification table')).to_have_count(0)
            max_row = page.locator('.group-card tbody tr').filter(has=page.locator('.tournament-player-name', has_text='Max'))
            expect(max_row.locator('td').nth(1).locator('img.player-avatar')).to_have_count(1)
            page.wait_for_function("[...document.querySelectorAll('.group-card img')].every(img => img.complete && img.naturalWidth > 0)")
            assert max_row.evaluate("row => { const rank=row.cells[0].getBoundingClientRect(); const img=row.querySelector('img').getBoundingClientRect(); const name=row.querySelector('.tournament-player-name').getBoundingClientRect(); return rank.right <= img.left && img.right <= name.left; }")
            fallback_row = page.locator('.group-card tbody tr').filter(has=page.locator('.tournament-player-name', has_text='Hackenschorschie'))
            expect(fallback_row.locator('.player-avatar-fallback')).to_have_text('HM')
            assert max_row.locator('[data-withdraw=Max]').evaluate('el => { const r=el.getBoundingClientRect(); return r.width<=32 && r.height<=32; }')
            expect(page.locator('[data-decider]')).to_have_count(0)
            assert page.locator('.group-card > h3').first.evaluate("el => getComputedStyle(el).color") == 'rgb(0, 0, 0)'
            assert page.locator('.tournament-admin .group-card, .tournament-admin button, .tournament-admin summary').evaluate_all('els => els.every(el => { const r=el.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; })'), 'Admin-Inhalt wird am Bildschirmrand abgeschnitten'
            pending = page.locator('.group-card .tournament-match').filter(has_text='Max – Leon')
            form = pending.locator('form[data-inline-score]')
            form.locator('[name=s1]').fill('2'); form.locator('[name=s2]').fill('0')
            expect(form.locator('[name=legs1]')).to_have_count(0)
            form.get_by_role('button', name='Ergebnis speichern', exact=True).click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.groups[0].matches.find(m => m.p1==='Max' && m.p2==='Leon').legs1 === 2")
            target = page.locator('.group-card .tournament-match').filter(has_text='Max – Ben')
            form = target.locator('form[data-inline-score]')
            form.locator('[name=s1]').fill('0'); form.locator('[name=s2]').fill('2')
            form.get_by_role('button', name='Ergebnis korrigieren', exact=True).click()
            expect(page.get_by_role('heading', name='Änderung prüfen und bestätigen')).to_be_visible()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.groups[0].matches.find(m => m.p1==='Max').winner === 'Ben'")
            max_row.get_by_role('button', name='Spieler tauschen: Max', exact=True).click()
            page.locator('dialog [name=other]').select_option('Ben')
            page.get_by_role('button', name='Tausch prüfen', exact=True).click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.groups[0].players[0] === 'Ben'")
            assert page.evaluate("window.day.groups[0].matches.find(m => m.p1==='Ben' && m.p2==='Max').s1 === 2 && window.day.groups[0].matches.find(m => m.p1==='Ben' && m.p2==='Max').s2 === 0")
            swapped_card = page.locator('.group-card .tournament-match').filter(has_text='Ben – Max')
            expect(swapped_card.locator('[name=s1]')).to_have_value('2')
            expect(swapped_card.locator('[name=s2]')).to_have_value('0')
            max_row.locator('[data-withdraw="Max"]').click()
            expect(page.get_by_role('heading', name='Änderung prüfen und bestätigen')).to_be_visible()
            expect(page.locator('dialog li')).to_have_count(3)
            page.get_by_role('button', name='Abbrechen', exact=True).click()
            assert page.evaluate("window.day.participation.Max?.status") is None
            max_row.locator('[data-withdraw="Max"]').click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.participation.Max?.status === 'withdrawn'")
            expect(max_row).to_contain_text('Zurückgezogen')
            max_row.locator('[data-reactivate="Max"]').click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.participation.Max?.status === 'active'")
            assert page.evaluate("window.day.groups[0].matches.find(m => [m.p1,m.p2].includes('Max') && [m.p1,m.p2].includes('Ben')).winner") == 'Ben'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Seite läuft horizontal über'
            assert not errors, errors
            page.evaluate('window.completeGroups()')
            expect(page.locator('.tournament-qualification table')).to_have_count(2)
            expect(page.locator('.tournament-qualification tbody tr')).to_have_count(8)
            expect(page.locator('.tournament-qualification tbody tr').first.locator('td').first).to_have_text('offen')
            expect(page.locator('.group-card tbody tr.group-qual-gold')).to_have_count(4)
            expect(page.locator('.group-card tbody tr.group-qual-silver')).to_have_count(4)
            gold_color = page.locator('.group-qual-badge.group-qual-gold').first.evaluate('el => getComputedStyle(el).backgroundColor')
            silver_color = page.locator('.group-qual-badge.group-qual-silver').first.evaluate('el => getComputedStyle(el).backgroundColor')
            assert gold_color != silver_color
            page.evaluate('window.singleFinals()')
            expect(page.locator('.group-card tbody tr.group-qual-ko')).to_have_count(4)
            expect(page.locator('.group-qual-gold, .group-qual-silver')).to_have_count(0)
            page.evaluate('window.freezeFinals()')
            max_qualified = page.locator('.tournament-qualification tbody tr').filter(has_text='Max')
            expect(max_qualified.locator('td').nth(4)).to_have_text('6')
            finals = page.locator('.tournament-final')
            gold = finals.first
            silver = finals.nth(1)
            silver_before = silver.inner_text()
            form = gold.locator('[data-inline-score]').first
            game_id = form.get_attribute('data-inline-score')
            form.locator('[name=s1]').fill('2')
            form.locator('[name=s2]').fill('1')
            form.get_by_role('button', name='Ergebnis speichern', exact=True).click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            expect(gold.locator(f'[data-inline-score="{game_id}"] button')).to_have_text('Ergebnis korrigieren')
            assert silver.inner_text() == silver_before, 'Gold-Ergebnis verändert Silber'
            assert page.evaluate("() => { const b=window.day.ko,m=b.matches[b.rounds[0]][0]; return m.winner===m.p1 && b.matches[b.rounds[1]][0].p1===m.winner; }")
            form = gold.locator(f'[data-inline-score="{game_id}"]')
            form.locator('[name=s1]').fill('0')
            form.locator('[name=s2]').fill('2')
            form.get_by_role('button', name='Ergebnis korrigieren', exact=True).click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            expect(gold.locator(f'[data-inline-score="{game_id}"] [name=s2]')).to_have_value('2')
            assert page.evaluate("() => { const b=window.day.ko,m=b.matches[b.rounds[0]][0]; return m.winner===m.p2 && b.matches[b.rounds[1]][0].p1===m.winner; }")
            page.evaluate('window.correctGroup()')
            expect(max_qualified.locator('td').nth(4)).to_have_text('6')
            expect(page.locator('.tournament-qualification [role=alert]')).to_contain_text('weichen ab')
            assert not errors, errors
            print(f'PASS Browser {width}x{height}, altes HTML ohne CSS-Link={legacy}: Inline-Legs, kompakter Rückzug, Namenstausch mit korrekter Ergebnisorientierung, Wiedereinstieg, Farben, Layout, eingefrorene Qualifikation')
            page.close()
        for width in [375, 390, 430, 1440]:
            page = browser.new_page(viewport={'width': width, 'height': 900})
            page.goto(f'http://127.0.0.1:{server.server_port}/__create')
            page.wait_for_function('window.ready === true')
            for groups in [False, True]:
                page.locator('#groupsCreateConfig').evaluate('(el, show) => el.hidden=!show', groups)
                page.locator('input[name=tournamentType][value="groupsko"],input[name=tournamentType][value="ko"]').evaluate_all('(els, show) => els.forEach(el => el.checked=el.value===(show?"groupsko":"ko"))', groups)
                assert page.locator('#tab-erstellen .tournament-create-card').evaluate('el => { const r=el.getBoundingClientRect(); return r.width>innerWidth*.65 && r.left>=0 && r.right<=innerWidth+1; }') if width<720 else True
                assert page.locator('#tab-erstellen fieldset, #tab-erstellen input, #tab-erstellen select').evaluate_all('els => els.filter(el=>el.getClientRects().length && getComputedStyle(el).position!=="absolute").every(el=> { const r=el.getBoundingClientRect(); return r.right<=innerWidth+1 && r.left>=0; })'), 'Erstellungsformular verbreitert den Viewport'
            assert page.evaluate('window.visualViewport.scale === 1')
            print(f'PASS Erstellungsseite {width}px: Original-HTML, K.-o.- und Gruppenkonfiguration ohne Überbreite oder Verkleinerung')
            page.close()
        browser.close()
finally:
    server.shutdown()
