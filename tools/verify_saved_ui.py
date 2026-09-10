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
        assert page.locator('.compact-steps').count() == 0
        page.locator('.processing-toggle').click()
        assert page.locator('.compact-steps').is_visible()
        page.locator('.save-case').click()
        assert page.locator('.saved-card').count() == 1
        record['status'] = 'completed'
        page.locator('.saved-open').click()
        page.wait_for_function("document.querySelector('.status-badge').textContent === 'Concluído'")
        assert 'pix-20260908-8841' in requests[-1]['message']
        assert requests[-1]['threadId'] == 'test-thread'
        page.reload()
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
