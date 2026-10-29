"""Browserprüfung der echten gemeinsamen Admin-Komponente, ohne Produktionsdaten.
Benötigt Python playwright und Chromium. Kein Firebase-/Produktionszugriff.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import functools

ROOT = Path(__file__).resolve().parents[1]
HARNESS = '''<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/vereinsserie.css"><link rel="stylesheet" href="/tournament-admin.css"></head><body><main class="app-container serie-wrap"><section id="tab-turnierbaum" class="serie-panel active"><div id="host"></div></section></main><script type="module">
import * as T from '/tournament-engine.js';
import { renderTournamentAdmin, confirmPlan } from '/tournament-admin.js';
const players = ['Max', 'Tim', 'Leon', 'Ben'];
const others = ['Dart General', 'Hawkeye', 'Mr.1', 'Prinzessin'];
let day = { id:'browser-test', attendees:[...players,...others], engine:'groups', mode:'groupsko', groupFormat:{format:'legs'}, qualifyPlaces:[1,2], groups:[{id:'G1',name:'Gruppe A',players,matches:T.roundRobinMatches(players)}, {id:'G2',name:'Gruppe B',players:others,matches:T.roundRobinMatches(others)}] };
const first = day.groups[0].matches.find(m => m.p1 === 'Max');
T.editMatch(day, first.id, {status:'completed',s1:2,s2:1,legs1:2,legs2:1});
function render() { T.normalizeDay(day); renderTournamentAdmin({day,host:document.getElementById('host'),name:id=>id === 'Tim' ? 'Hackenschorschie mit langem Spielernamen' : id||'Offen',editable:true,finish:()=>{},run: async (action,mutate) => { const p=T.planChange(day,action,'admin',mutate); if(await confirmPlan(p,id=>id||'Offen',action)) { day=p.day; window.day=day; render(); } } }); }
window.day=day; render(); window.ready=true;
</script></body></html>'''

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/__test':
            data = HARNESS.encode()
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
        for width, height in [(1440, 1000), (390, 844)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/__test')
            page.wait_for_function('window.ready === true')
            expect(page.get_by_role('heading', name='Gruppe A', exact=True)).to_be_visible()
            expect(page.locator('[data-decider]')).to_have_count(0)
            assert page.locator('.group-card > h3').first.evaluate("el => getComputedStyle(el).color") == 'rgb(0, 0, 0)'
            assert page.locator('.tournament-admin .group-card, .tournament-admin button, .tournament-admin summary').evaluate_all('els => els.every(el => { const r=el.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; })'), 'Admin-Inhalt wird am Bildschirmrand abgeschnitten'
            page.locator('.group-card details > summary').first.click()
            target = page.locator('.group-card .tournament-match').filter(has_text='Max – Ben')
            target.get_by_role('button', name='Spiel bearbeiten').click()
            form = page.locator('dialog form')
            form.locator('[name=s1]').fill('0'); form.locator('[name=s2]').fill('2')
            form.locator('[name=legs1]').fill('0'); form.locator('[name=legs2]').fill('2')
            form.locator('[name=status]').select_option('completed')
            form.get_by_role('button', name='Speichern', exact=True).click()
            expect(page.get_by_role('heading', name='Änderung prüfen und bestätigen')).to_be_visible()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.groups[0].matches.find(m => m.p1==='Max').winner === 'Ben'")
            page.locator('.tournament-withdrawals > summary').click()
            page.locator('[data-withdraw="Max"]').click()
            expect(page.get_by_role('heading', name='Änderung prüfen und bestätigen')).to_be_visible()
            expect(page.locator('dialog li')).to_have_count(3)
            page.get_by_role('button', name='Abbrechen', exact=True).click()
            assert page.evaluate("window.day.participation.Max?.status") is None
            page.locator('[data-withdraw="Max"]').click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.participation.Max?.status === 'withdrawn'")
            page.locator('.tournament-withdrawals > summary').click()
            page.locator('[data-reactivate="Max"]').click()
            page.get_by_role('button', name='Änderung bestätigen', exact=True).click()
            page.wait_for_function("window.day.participation.Max?.status === 'active'")
            assert page.evaluate("window.day.groups[0].matches.find(m => m.p1==='Max').winner") == 'Ben'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Seite läuft horizontal über'
            assert not errors, errors
            print(f'PASS Browser {width}x{height}: Korrektur, Vorschau, Abbruch, Rückzug, Wiedereinstieg, echte App-Container, lange Namen, sichtbare Überschriften, keine vorzeitigen Entscheidungsspiele')
            page.close()
        browser.close()
finally:
    server.shutdown()
