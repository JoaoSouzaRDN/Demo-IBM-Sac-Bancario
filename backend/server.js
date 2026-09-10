const http = require("http"),
  fs = require("fs"),
  path = require("path");
const root = path.join(__dirname, "..", "frontend");
const mockDb = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mock-db", "data.json"), "utf8"));
let iamToken = null;
let iamTokenExpiresAt = 0;
async function getAuthToken() {
  if (process.env.WO_BEARER_TOKEN) return process.env.WO_BEARER_TOKEN;
  if (iamToken && Date.now() < iamTokenExpiresAt) return iamToken;
  const response = await fetch("https://iam.cloud.ibm.com/identity/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "urn:ibm:params:oauth:grant-type:apikey", apikey: process.env.WO_API_KEY }),
  });
  if (!response.ok) throw new Error(`IAM token HTTP ${response.status}`);
  const data = await response.json();
  iamToken = data.access_token;
  iamTokenExpiresAt = Date.now() + Math.max(60, (data.expiration - Math.floor(Date.now() / 1000) - 60)) * 1000;
  return iamToken;
}
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
  if (!process.env.WO_CHAT_URL || process.env.WO_USE_CHAT_COMPLETIONS !== "true") {
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
      Authorization: `Bearer ${await getAuthToken()}`,
    },
    body: JSON.stringify(body),
  });
  return await r.json();
}
function agentChatUrl() {
  if (process.env.WO_CHAT_URL) return process.env.WO_CHAT_URL;
  if (process.env.WO_API_URL && process.env.WO_AGENT_ID)
    return `${process.env.WO_API_URL.replace(/\/$/, "")}/v1/orchestrate/${process.env.WO_AGENT_ID}/chat/completions`;
  return null;
}
function agentRunsUrl() {
  if (!process.env.WO_API_URL || !process.env.WO_AGENT_ID) return null;
  return `${process.env.WO_API_URL.replace(/\/$/, "")}/v1/orchestrate/runs`;
}
function extractRunText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractRunText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (typeof value.reply === "string") return value.reply;
    if (typeof value.output === "string") return value.output;
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    for (const key of ["messages", "message", "response", "result", "data", "output"]) {
      const text = extractRunText(value[key]);
      if (text) return text;
    }
  }
  return "";
}
function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
async function streamRun(body, res) {
  const url = agentRunsUrl();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await getAuthToken()}`,
  };
  const created = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      agent_id: process.env.WO_AGENT_ID,
      thread_id: body.threadId || undefined,
      message: { role: "user", content: body.message },
      capture_logs: true,
    }),
  });
  if (!created.ok) {
    console.error("Orchestrate run create failed", created.status);
    const fallback = await chat({ message: body.message });
    sendEvent(res, { event: "run.completed", execution: [{ label: "Consulta local de contingência", status: "done" }], reply: fallback.reply });
    return;
  }
  const run = await created.json();
  const runId = run.run_id || run.id;
  if (run.thread_id) sendEvent(res, { thread_id: run.thread_id });
  if (!runId) {
    sendEvent(res, { error: "Agent não retornou run_id" });
    return;
  }
  sendEvent(res, { event: "run.started", run_id: runId });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusResponse = await fetch(`${url}/${encodeURIComponent(runId)}`, { headers });
    if (!statusResponse.ok) {
      console.error("Orchestrate run status failed", statusResponse.status);
      const fallback = await chat({ message: body.message });
      sendEvent(res, { event: "run.completed", execution: [{ label: "Consulta local de contingência", status: "done" }], reply: fallback.reply });
      return;
    }
    const status = await statusResponse.json();
    const state = String(status.status || status.state || "").toLowerCase();
    if (["completed", "complete", "failed", "cancelled", "canceled", "error"].includes(state)) {
      if (state === "completed" || state === "complete") {
        sendEvent(res, { event: "run.completed", execution: status.execution, reply: extractRunText(status) });
      } else {
        sendEvent(res, { error: status.error || "O atendimento não foi concluído." });
      }
      return;
    }
    sendEvent(res, { event: "run.step.intermediate", status: state || "em andamento" });
  }
  sendEvent(res, { error: "Tempo limite ao aguardar o agente." });
}
async function streamChat(body, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  if (agentRunsUrl() && process.env.WO_USE_CHAT_COMPLETIONS !== "true") {
    try { await streamRun(body, res); } catch (e) { console.error("Orchestrate run error", e.message); sendEvent(res, { error: "Não foi possível conectar ao agente." }); }
    sendEvent(res, "[DONE]");
    return res.end();
  }
  if (process.env.WO_USE_CHAT_COMPLETIONS !== "true") {
    const fallback = await chat({ message: body.message });
    sendEvent(res, { event: "run.completed", execution: [{ label: "Consulta de dados", status: "done" }], reply: fallback.reply });
    sendEvent(res, "[DONE]");
    return res.end();
  }
  const url = agentChatUrl();
  if (!url) {
    res.write(`data: ${JSON.stringify(await chat(body))}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getAuthToken()}`,
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
