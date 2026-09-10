"""Browser regression: saved consultations merged into the initial suggestion
row (priority, overflow behind a "ver mais" bubble) and cumulative progress
history across multiple turns of the same attendance."""
import asyncio
import json
import os
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright

root = Path(__file__).resolve().parents[1]


async def main():
    server = subprocess.Popen(
        ["node", "backend/server.js"],
        cwd=root,
        env={**os.environ, "PORT": "3229"},
        stdout=subprocess.DEVNULL,
    )
    await asyncio.sleep(1)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(viewport={"width": 1440, "height": 900})
            await page.goto("http://localhost:3229")

            saved_seed = [
                {
                    "id": f"pix-{i}",
                    "category": "pix",
                    "title": f"Consulta salva {i}",
                    "status": "pending",
                    "protocol": "",
                    "checkedAt": "2026-09-10T10:00:00.000Z",
                }
                for i in range(5)
            ]
            await page.evaluate(
                "(data) => localStorage.setItem('rdn-consultations-v1', JSON.stringify(data))",
                saved_seed,
            )
            await page.reload()
            await page.wait_for_selector("#suggestions")
            assert await page.locator("#suggestions button").count() == 6
            first_class = await page.eval_on_selector(
                "#suggestions button:first-child", "el => el.className"
            )
            assert "priority" in first_class
            await page.locator(".more-suggestions").click()
            assert await page.locator("#suggestions button").count() == 10

            record = {
                "id": "pix-1",
                "category": "pix",
                "title": "Pix teste",
                "status": "pending",
            }

            async def reply(route):
                events = [
                    {"thread_id": "t1"},
                    {
                        "event": "progress",
                        "steps": [
                            {
                                "id": "understand",
                                "label": "Entendendo sua solicitação",
                                "status": "done",
                            },
                            {
                                "id": "tool",
                                "label": "Verificando a transação Pix",
                                "status": "done",
                            },
                        ],
                    },
                    {"reply": "Pix pendente.", "cases": [record]},
                ]
                body = "".join(f"data: {json.dumps(e)}\n\n" for e in events)
                await route.fulfill(content_type="text/event-stream", body=body)

            await page.route("**/api/chat/stream", reply)
            await page.locator("#reset").click()
            await page.wait_for_selector("#suggestions")
            await page.fill("#input", "Fiz um Pix e o dinheiro não chegou")
            await page.locator("#form button[type=submit]").click()
            await page.wait_for_function(
                "document.querySelector('.live-panel')?.textContent.includes('conclu')"
            )
            assert await page.locator(".turn-group").count() == 0
            await page.fill("#input", "E agora, qual o status?")
            await page.locator("#form button[type=submit]").click()
            await page.wait_for_selector(".turn-group")
            assert await page.locator(".turn-group").count() == 1
            title = await page.eval_on_selector(
                ".turn-group .step-label", "el => el.textContent"
            )
            assert title == "Consulta Pix enviada"
            await browser.close()
            print(
                "PASS: saved consultations prioritized in suggestions with overflow, "
                "and progress history accumulates across turns"
            )
    finally:
        server.terminate()
        server.wait(timeout=10)


asyncio.run(main())
