"""Browser regression: inline steps, saving, refresh, persistence and delete confirmation."""
import json
import subprocess
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = subprocess.Popen(['node', 'backend/server.js'], cwd=root, env={**os.environ, 'PORT': '3218'}, stdout=subprocess.DEVNULL)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors, requests = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        record = {'id': 'pix-20260908-8841', 'category': 'pix', 'title': 'Pix de R$ 850 em 08/09', 'status': 'pending'}
        def reply(route):
            requests.append(route.request.post_data_json)
            events = [{'thread_id': 'test-thread'}, {'event': 'progress', 'steps': [{'id': 'pix', 'label': 'Verificando Pix', 'status': 'done'}]}, {'reply': 'Pix pendente, aguardando confirmação do SPI.', 'cases': [record]}]
            route.fulfill(content_type='text/event-stream', body=''.join('data: '+json.dumps(e)+'\n\n' for e in events))
        page.route('**/api/chat/stream', reply)
        page.goto('http://localhost:3218')
        page.locator('#suggestions button').first.click()
        page.locator('.save-case').wait_for()
        assert page.locator('.processing').count() == 1
        # Finished steps stay expanded by default; the chevron toggle
        # only collapses/expands them.
        def collapse_open():
            return 'open' in page.eval_on_selector('.step-collapse', 'el => el.className')

        def toggle_steps():
            # The toggle rides on the top-most step row while expanded, and
            # becomes its own summary row once collapsed; only one of the
            # two exists as an actionable toggle at a time.
            selector = '.processing-toggle-inline' if collapse_open() else '.processing-toggle'
            page.locator(selector).click()

        assert collapse_open()
        toggle_steps()
        # The list stays in the DOM and animates its wrapper to zero height
        # rather than unmounting, so check the open/closed class, not
        # .step-flow's own (clipped-away) bounding box.
        assert not collapse_open()
        toggle_steps()
        assert collapse_open()
        page.locator('.save-case').click()
        # Saved sidebar is overlaid by the live progress panel until a new
        # attendance starts — "Novo atendimento" brings it back.
        assert page.locator('.saved-card').count() == 0
        assert page.locator('.live-panel').count() == 1
        record['status'] = 'completed'
        page.reload()
        assert page.locator('.saved-card').count() == 1
        page.locator('.saved-open').click()
        page.wait_for_function("document.querySelector('.live-panel')?.textContent.includes('concluída')")
        assert 'pix-20260908-8841' in requests[-1]['message']
        assert requests[-1]['threadId'] is None
        page.locator('#reset').click()
        assert page.locator('.status-badge').text_content() == 'Concluído'
        assert page.locator('.saved-card').count() == 1
        page.locator('.delete-saved').click()
        assert page.locator('dialog').is_visible()
        page.get_by_role('button', name='Cancelar', exact=True).click()
        assert page.locator('.saved-card').count() == 1
        page.locator('.delete-saved').click()
        page.get_by_role('button', name='Excluir consulta', exact=True).click()
        assert page.locator('.saved-card').count() == 0
        page.screenshot(path=str(root / 'chat-saved-ui.png'))
        assert not errors, errors
        browser.close()
        print('PASS: inline steps, save, refresh, persistence, cancel and confirm deletion')
finally:
    server.terminate()
    server.wait(timeout=10)
