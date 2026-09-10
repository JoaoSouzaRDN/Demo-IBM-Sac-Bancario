"""Exercise the browser against a local backend connected to Orchestrate."""
import os
import subprocess
from pathlib import Path

from dotenv import dotenv_values
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
env = dict(os.environ)
env.update({k: v for k, v in dotenv_values(root / '.env').items() if v})
env['WO_API_URL'] = 'https://api.us-south.watson-orchestrate.cloud.ibm.com/instances/5216190f-5681-4e1a-9311-b5abdb2f92bc'
env['PORT'] = '3217'
with (root / 'chat-validation.log').open('w', encoding='utf-8') as log:
    server = subprocess.Popen(['node', 'backend/server.js'], cwd=root, env=env, stdout=log, stderr=log)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(os.environ.get('TEST_CHAT_URL', 'http://localhost:3217'))
            page.screenshot(path=str(root / 'chat-initial.png'))
            page.locator('#suggestions button').first.click()
            page.locator('.mini-light.active').first.wait_for()
            assert page.locator('.msg.agent').count() == 1
            page.screenshot(path=str(root / 'chat-processing.png'))
            page.wait_for_function("document.querySelectorAll('.msg.agent').length === 2 && !document.querySelectorAll('.msg.agent')[1].textContent.includes('Consultando os sistemas')", timeout=160000)
            reply = page.locator('.msg.agent').last.inner_text()
            print('REPLY:', reply)
            assert len(reply) > 10 and 'Não foi possível' not in reply
            assert not errors, errors
            assert page.locator('.mini-light.active').count() == 0
            assert page.locator('.processing').count() >= 1
            assert page.locator('#suggestions').is_hidden()
            page.screenshot(path=str(root / 'chat-validation.png'))
            page.locator('#reset').click()
            assert page.locator('.msg.agent').count() == 1
            assert page.locator('#suggestions button').count() == 5
            assert page.locator('#suggestions').is_visible()
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(root / 'chat-mobile.png'))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('#input').is_visible()
            print('PASS: agent reply visible, no browser errors, reset restores greeting and suggestions')
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
