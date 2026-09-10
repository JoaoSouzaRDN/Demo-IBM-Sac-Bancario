const http = require("http"),
  fs = require("fs"),
  path = require("path");
const root = path.join(__dirname, "..", "frontend");
const mockDb = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mock-db", "data.json"), "utf8"));
function lookupMock(message = "") {
  const text = message.toLowerCase();
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
  body.context = context;
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
http
  .createServer((req, res) => {
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
