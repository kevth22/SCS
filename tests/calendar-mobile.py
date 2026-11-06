"""Original-Kalenderformular mit echten Styles; keine Firebase-/Produktionszugriffe."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import functools
import re

ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/__calendar':
            html = (ROOT / 'kalender.html').read_text()
            html = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', html)
            html = html.replace('</body>', '''<script>
                document.getElementById('adminSpieltagBox').style.display='block';
                document.getElementById('urlaubContent').style.display='block';
            </script></body>''')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(html.encode())
        else:
            super().do_GET()
    def log_message(self, *args): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for width, height in [(320,740),(360,800),(375,812),(390,844),(412,915),(430,932),(844,390),(1440,1000)]:
            page=browser.new_page(viewport={'width':width,'height':height},is_mobile=width<900,has_touch=width<900,locale='de-DE')
            page.goto(f'http://127.0.0.1:{server.server_port}/__calendar')
            expect(page.locator('#adminSpieltagBox')).to_be_visible()
            for filled in [False,True]:
                if filled:
                    page.get_by_label('Datum', exact=True).fill('2026-11-13')
                    page.get_by_label('Treffen', exact=False).fill('18:00')
                    page.get_by_label('Anwurf', exact=True).fill('19:00')
                    page.get_by_label('Gegner', exact=True).fill('Langer Mannschaftsname mit Zusatz')
                    page.get_by_label('Spielort / Adresse für Maps',exact=True).fill('Spielstätte, Musterstraße 123, 12345 Musterstadt')
                assert page.locator('#adminSpieltagBox input, #adminSpieltagBox select, .urlaub-box input').evaluate_all('els=>els.every(el=>{const r=el.getBoundingClientRect(),card=el.closest(".info-card").getBoundingClientRect(); return r.width>90 && r.left>=card.left && r.right<=card.right && r.right<=innerWidth && r.height>=48 && r.height<=56 && parseFloat(getComputedStyle(el).fontSize)>=16;})'), 'Formularfeld läuft über oder ist zu hoch'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Seite läuft horizontal über'
                assert page.locator('#adminSpieltagBox').evaluate('el=>el.getBoundingClientRect().width>Math.min(innerWidth*.7,500)'), 'Formular ist zu schmal'
            if width>350:
                assert page.evaluate('Math.abs(document.getElementById("spieltagTreffen").getBoundingClientRect().top-document.getElementById("spieltagAnwurf").getBoundingClientRect().top)<1'), 'Zeitfelder sind nicht ausgerichtet'
            button=page.get_by_role('button',name='Spieltag speichern',exact=True)
            button.evaluate('el=>el.scrollIntoView({block:"center"})')
            assert button.evaluate('el=>el.getBoundingClientRect().bottom<=document.querySelector(".bottom-nav").getBoundingClientRect().top'), 'Navigation verdeckt Speichern'
            assert page.evaluate('visualViewport.scale===1')
            if width==390:
                page.locator('#adminSpieltagBox').screenshot(path='/tmp/scs-kalender-mobile.png')
            print(f'PASS Kalender {width}x{height}: leere/gefüllte native Felder, Beschriftungen, Breiten, Speichern erreichbar')
            page.close()
        browser.close()
finally:
    server.shutdown()
