"""End-to-end live Pix flow on the deployed site (no mocked network responses)."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(os.environ.get('TEST_CHAT_URL', 'https://demo-ibm-sac-bancario.onrender.com'))

    def send(text):
        count = page.locator('.msg.agent').count()
        page.locator('#input').fill(text)
        page.locator('.send').click()
        page.wait_for_function('(count) => document.querySelectorAll(".msg.agent").length > count || document.querySelector(".error")', arg=count, timeout=180000)
        assert page.locator('.error').count() == 0, page.locator('.error').all_inner_texts()
        reply = page.locator('.msg.agent').last.inner_text()
        print('REPLY:', reply, flush=True)
        return reply

    first = send('Fiz um Pix e o dinheiro não chegou')
    assert 'valor' in first.lower() and 'data' in first.lower()
    assert not any(term in first.lower() for term in ['cpf', 'comprovante', 'e2e', 'banco de destino'])
    candidate = send('Foi de R$ 850 em 08/09/2026')
    assert '850' in candidate and 'Rafael' in candidate
    assert '?' in candidate
    assert page.locator('.save-case').count() == 0
    status = send('Sim, é esse Pix. Qual o status e por que não chegou?')
    # The reply must be in Portuguese, even though the tool returns the
    # status in English internally.
    assert any(term in status.lower() for term in ['pendente', 'aguardando'])
    assert 'pending' not in status.lower()
    assert 'spi' in status.lower() or 'liquidação' in status.lower()
    page.locator('.save-case').last.click()
    # The saved-consultations sidebar is overlaid by the live progress panel
    # for the rest of the session; "Novo atendimento" brings it back without
    # losing what was saved (it's persisted to localStorage separately).
    page.locator('#reset').click()
    assert page.locator('.saved-card').count() == 1
    page.screenshot(path=str(root / 'chat-pix-confirmed.png'))
    count = page.locator('.msg.agent').count()
    page.locator('.saved-open').click()
    page.wait_for_function('(count) => document.querySelectorAll(".msg.agent").length > count', arg=count, timeout=180000)
    print('REFRESH:', page.locator('.msg.agent').last.inner_text(), flush=True)
    page.locator('#reset').click()
    assert page.locator('.saved-card').count() == 1
    page.locator('.delete-saved').click()
    page.screenshot(path=str(root / 'chat-delete-confirmation.png'))
    page.get_by_role('button', name='Cancelar', exact=True).click()
    assert page.locator('.saved-card').count() == 1
    page.screenshot(path=str(root / 'chat-pix-refreshed.png'))
    assert not errors, errors
    print('PASS: amount/date, candidate confirmation, bank status, save and live refresh', flush=True)
    browser.close()
