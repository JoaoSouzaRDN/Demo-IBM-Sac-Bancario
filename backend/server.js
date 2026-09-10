const http = require("http"),
  fs = require("fs"),
  path = require("path");
const root = path.join(__dirname, "..", "frontend");
const mockDb = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mock-db", "data.json"), "utf8"));
function lookupMock(message = "") {
  const text = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.includes("cart")) return { type: "Cartao", record: mockDb.cards[0] };
  if (text.includes("pix") || text.includes("não chegou") || text.includes("nao chegou")) return { type: "Pix não recebido", record: mockDb.pix[0] };
  if (text.includes("cartão") || text.includes("cartao")) return { type: "Cartão", record: mockDb.cards[0] };
  if (text.includes("compra")) return { type: "Compra contestada", record: mockDb.purchases[0] };
  if (text.includes("parcela") || text.includes("atras")) return { type: "Parcela em atraso", record: mockDb.loans[0] };
  if (text.includes("cadastro") || text.includes("dados") || text.includes("email") || text.includes("telefone")) return { type: "Atualização cadastral", record: mockDb.profiles[0] };
  return { type: "Atendimento geral", record: null };
}
async function chat(body) {
  const context = lookupMock(body.message);
  if (!process.env.WO_CHAT_URL) {
    return {
      reply: `Consultei os dados de ${context.type}. Status encontrado: ${context.record?.status || "preciso de mais detalhes para localizar seu atendimento"}.`,
      context,
    };
  }
  // Com o agente configurado, ele próprio chama as tools e devolve o contexto.
  if (!process.env.WO_CHAT_URL)
    return {
      reply:
        "Modo demonstração ativo. Configure WO_CHAT_URL no servidor para usar o GPT-5.4.",
    };
  const r = await fetch(process.env.WO_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WO_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return await r.json();
}
function agentChatUrl() {
  if (process.env.WO_CHAT_URL) return process.env.WO_CHAT_URL;
  if (process.env.WO_API_URL && process.env.WO_AGENT_ID)
    return `${process.env.WO_API_URL.replace(/\/$/, "")}/api/v1/orchestrate/${process.env.WO_AGENT_ID}/chat/completions`;
  return null;
}
async function streamChat(body, res) {
  const url = agentChatUrl();
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  if (!url) {
    res.write(`data: ${JSON.stringify(await chat(body))}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WO_API_KEY}`,
      ...(body.threadId ? { "X-IBM-THREAD-ID": body.threadId } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: body.message }],
      additional_parameters: {},
      context: {},
      stream: true,
    }),
  });
  if (!upstream.ok) {
    res.write(`data: ${JSON.stringify({ error: `Agent HTTP ${upstream.status}` })}\n\n`);
    return res.end();
  }
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}
http
  .createServer((req, res) => {
    if (req.url === "/api/chat/stream" && req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", async () => {
        try { await streamChat(JSON.parse(b), res); }
        catch (e) { if (!res.headersSent) res.writeHead(502); res.end(); }
      });
      return;
    }
    if (req.url === "/api/chat" && req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", async () => {
        try {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await chat(JSON.parse(b))));
        } catch (e) {
          res.writeHead(502);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    const f = req.url === "/" ? "index.html" : req.url.slice(1),
      p = path.join(root, f);
    if (!p.startsWith(root) || !fs.existsSync(p))
      return res.writeHead(404).end();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json",
    };
    res.setHeader(
      "Content-Type",
      types[path.extname(p)] || "application/octet-stream",
    );
    res.end(fs.readFileSync(p));
  })
  .listen(process.env.PORT || 3000, () =>
    console.log("Demo em http://localhost:" + (process.env.PORT || 3000)),
  );
