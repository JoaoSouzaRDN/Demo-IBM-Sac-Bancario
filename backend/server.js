const http = require("http"),
  fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const root = path.join(__dirname, "..", "frontend");
const { createProgress } = require("./progress");
const { lookupRecords } = require("./records");
const mockDb = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "mock-db", "data.json"), "utf8"),
);
let iamToken = null;
let iamTokenExpiresAt = 0;
async function getAuthToken() {
  if (process.env.WO_BEARER_TOKEN) return process.env.WO_BEARER_TOKEN;
  if (iamToken && Date.now() < iamTokenExpiresAt) return iamToken;
  const response = await fetch("https://iam.cloud.ibm.com/identity/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "urn:ibm:params:oauth:grant-type:apikey",
      apikey: process.env.WO_API_KEY,
    }),
  });
  if (!response.ok) throw new Error(`IAM token HTTP ${response.status}`);
  const data = await response.json();
  iamToken = data.access_token;
  iamTokenExpiresAt =
    Date.now() +
    Math.max(60, data.expiration - Math.floor(Date.now() / 1000) - 60) * 1000;
  return iamToken;
}
function lookupMock(message = "") {
  const text = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (text.includes("cart")) return { type: "Cartao", record: mockDb.cards[0] };
  if (
    text.includes("pix") ||
    text.includes("não chegou") ||
    text.includes("nao chegou")
  )
    return { type: "Pix não recebido", record: mockDb.pix[0] };
  if (text.includes("cartão") || text.includes("cartao"))
    return { type: "Cartão", record: mockDb.cards[0] };
  if (text.includes("compra"))
    return { type: "Compra contestada", record: mockDb.purchases[0] };
  if (text.includes("parcela"))
    return { type: "Parcelas", record: mockDb.loans[0] };
  if (
    text.includes("cadastro") ||
    text.includes("dados") ||
    text.includes("email") ||
    text.includes("telefone")
  )
    return { type: "Atualização cadastral", record: mockDb.profiles[0] };
  return { type: "Atendimento geral", record: null };
}
async function chat(body) {
  const context = lookupMock(body.message);
  const url = agentChatUrl();
  if (!url || process.env.WO_USE_CHAT_COMPLETIONS !== "true") {
    return {
      reply: `Consultei os dados de ${context.type}. Status encontrado: ${context.record?.status || "preciso de mais detalhes para localizar seu atendimento"}.`,
      context,
    };
  }
  const r = await fetch(url, {
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
  if (Array.isArray(value))
    return value.map(extractRunText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (typeof value.reply === "string") return value.reply;
    if (typeof value.output === "string") return value.output;
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    for (const key of [
      "content",
      "messages",
      "message",
      "response",
      "result",
      "data",
      "output",
    ]) {
      const text = extractRunText(value[key]);
      if (text) return text;
    }
  }
  return "";
}
function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
const fraudRecommendationText = {
  aprovar_automatico:
    "A contestação foi registrada e segue para a análise normal do banco.",
  revisao_manual:
    "A contestação foi registrada, mas precisa passar por uma análise adicional antes da confirmação do reembolso.",
  negar_recomendado:
    "A contestação foi registrada, mas vai precisar de uma análise mais detalhada antes de qualquer confirmação de reembolso.",
};
// Safety net: sac_resposta is instructed to translate the fraud-analysis
// collaborator's JSON into a natural sentence, but an LLM occasionally
// echoes that raw JSON as its own reply instead. Detect that specific
// shape (riskLevel/recommendation) and rewrite it in plain Portuguese
// before it ever reaches the customer, regardless of which code path
// produced it.
function sanitizeReply(text) {
  if (typeof text !== "string") return text;
  let candidate = text.trim();
  try {
    const parsed = JSON.parse(candidate.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (parsed && typeof parsed === "object" && "riskLevel" in parsed) {
      return (
        fraudRecommendationText[parsed.recommendation] ||
        "A contestação foi registrada e segue para análise."
      );
    }
  } catch {}
  return text;
}
// Safety net: the "ver minhas parcelas" flow is purely informational and
// is instructed to always send cases: [], but the LLM has been seen
// disobeying that and turning each listed installment into a case (which
// makes a "salvar consulta" button show up per parcela). Category
// "parcela" never represents a real request/confirmation in this demo, so
// it's dropped here regardless of what the model sent.
function sanitizeCases(cases) {
  if (!Array.isArray(cases)) return [];
  return cases.filter((item) => item?.category !== "parcela");
}
// Safety net: the compra-contestada flow is instructed to always send the
// purchase as a case in the same reply that registers the contestation,
// regardless of the fraud-analysis outcome - but the LLM has repeatedly
// been seen leaving cases empty on exactly that reply (it only reappears
// if the customer asks something else afterwards). Detect that specific
// reply ("contestação ... registrada/registrei") and, if cases came back
// empty, fill in the purchase record ourselves so the save button always
// shows up when the contestation is actually registered.
function withRegisteredPurchaseFallback(reply, cases) {
  if (cases.length > 0 || typeof reply !== "string") return cases;
  const text = reply
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const registered =
    text.includes("contestacao") &&
    (text.includes("registrada") || text.includes("registrei"));
  const purchase = mockDb.purchases[0];
  if (!registered || !purchase) return cases;
  return [
    {
      id: purchase.id,
      category: "compra",
      title: `Compra contestada em ${purchase.merchant}`,
      status: purchase.status,
    },
  ];
}
async function finalRunMessage(url, headers, threadId, runId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(
      `${url.replace(/\/runs$/, "")}/threads/${encodeURIComponent(threadId)}/messages`,
      { headers },
    );
    if (!response.ok) throw new Error(`Messages HTTP ${response.status}`);
    const result = await response.json();
    const messages = Array.isArray(result) ? result : result.data || [];
    const message = messages.find(
      (item) => item.role === "assistant" && item.context?.wxo_run_id === runId,
    );
    const text = extractRunText(message?.content);
    if (text) {
      try {
        const structured = JSON.parse(
          text.replace(/^```(?:json)?\s*|\s*```$/g, ""),
        );
        if (typeof structured.reply === "string" && structured.reply.trim())
          return {
            reply: sanitizeReply(structured.reply),
            execution: structured.execution,
            cases: withRegisteredPurchaseFallback(
              structured.reply,
              sanitizeCases(structured.cases),
            ),
          };
      } catch {}
      const cleanReply = sanitizeReply(text);
      return {
        reply: cleanReply,
        cases: withRegisteredPurchaseFallback(cleanReply, []),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("A execução terminou sem uma mensagem disponível.");
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
    sendEvent(res, {
      error: `Não foi possível iniciar o agente (HTTP ${created.status}).`,
    });
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
  const progress = createProgress((event) => sendEvent(res, event));
  progress.consume({ id: "initial", event: "run.started" });
  let eventsAvailable = true;
  const pollIntervalMs = 400;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (res.destroyed) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    if (eventsAvailable) {
      try {
        const eventsResponse = await fetch(
          `${url}/${encodeURIComponent(runId)}/events?stream_timeout=1`,
          { headers, signal: AbortSignal.timeout(10000) },
        );
        if (eventsResponse.ok) {
          const events = await eventsResponse.json();
          if (Array.isArray(events)) events.forEach(progress.consume);
        } else {
          eventsAvailable = false;
        }
      } catch {
        eventsAvailable = false;
      }
    }
    const statusResponse = await fetch(`${url}/${encodeURIComponent(runId)}`, {
      headers,
    });
    if (!statusResponse.ok) {
      console.error("Orchestrate run status failed", statusResponse.status);
      sendEvent(res, {
        error: `Não foi possível acompanhar o agente (HTTP ${statusResponse.status}).`,
      });
      return;
    }
    const status = await statusResponse.json();
    const state = String(status.status || status.state || "").toLowerCase();
    if (
      [
        "completed",
        "complete",
        "failed",
        "cancelled",
        "canceled",
        "error",
      ].includes(state)
    ) {
      if (state === "completed" || state === "complete") {
        const answer = await finalRunMessage(
          url,
          headers,
          run.thread_id || body.threadId,
          runId,
        );
        progress.finish();
        sendEvent(res, { event: "run.completed", ...answer });
      } else {
        sendEvent(res, {
          error: status.error || "O atendimento não foi concluído.",
        });
      }
      return;
    }
    sendEvent(res, {
      event: "run.step.intermediate",
      status: state || "em andamento",
    });
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
    try {
      await streamRun(body, res);
    } catch (e) {
      console.error("Orchestrate run error", e.message);
      sendEvent(res, { error: "Não foi possível conectar ao agente." });
    }
    sendEvent(res, "[DONE]");
    return res.end();
  }
  if (process.env.WO_USE_CHAT_COMPLETIONS !== "true") {
    sendEvent(res, {
      error: "A integração do agente não está configurada no servidor.",
    });
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
    res.write(
      `data: ${JSON.stringify({ error: `Agent HTTP ${upstream.status}` })}\n\n`,
    );
    return res.end();
  }
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}
// --- Azure AI Foundry A2A adapter -----------------------------------------
// watsonx Orchestrate's hosted A2A client builds message parts with the
// older `type` discriminator (pre A2A-0.3). Azure AI Foundry's agent
// endpoint strictly requires the newer `kind` discriminator and rejects
// anything else. This adapter sits between the two: it normalizes the
// outgoing JSON-RPC payload, forwards it to Foundry with the account key
// (kept server-side, never exposed to Orchestrate), and — since Foundry
// answers `message/send` asynchronously ("submitted" then "working" then
// "completed") while Orchestrate's client does not poll — polls
// `tasks/get` on Foundry's behalf so the call still looks synchronous to
// Orchestrate. The reasoning itself always runs in Foundry; this only
// fixes the wire format.
const FOUNDRY_FRAUDE_A2A_URL =
  "https://labs-rdn-resource.services.ai.azure.com/api/projects/labs-rdn/agents/RDN-Bank-analise-fraude-reembolso/endpoint/protocols/a2a";

function normalizeA2AMessage(body) {
  if (body?.method !== "message/send" && body?.method !== "message/stream")
    return body;
  const message = body.params?.message;
  if (!message || typeof message !== "object") return body;
  if (!message.kind) message.kind = "message";
  if (!message.messageId) message.messageId = crypto.randomUUID();
  if (Array.isArray(message.parts)) {
    message.parts = message.parts.map((part) => {
      if (part && !part.kind && part.type) {
        const { type, ...rest } = part;
        return { kind: type, ...rest };
      }
      return part;
    });
  }
  return body;
}

async function foundryA2ACall(body, headers) {
  const response = await fetch(FOUNDRY_FRAUDE_A2A_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`Foundry A2A HTTP ${response.status}`);
  return response.json();
}

async function handleFoundryFraudeA2A(body, res) {
  if (!process.env.FOUNDRY_FRAUDE_API_KEY) {
    res.writeHead(502, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: { code: -32000, message: "FOUNDRY_FRAUDE_API_KEY not configured" },
      }),
    );
  }
  const headers = {
    "Content-Type": "application/json",
    "api-key": process.env.FOUNDRY_FRAUDE_API_KEY,
  };
  const normalized = normalizeA2AMessage(body);
  let result = await foundryA2ACall(normalized, headers);
  const requestId = body?.id ?? null;
  const task = result?.result;
  if (task?.kind === "task" && task.id) {
    // Poll on the caller's behalf until the task settles, so a single
    // JSON-RPC round trip is enough for Orchestrate.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const state = result?.result?.status?.state;
      if (state === "completed" || state === "failed" || state === "canceled")
        break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await foundryA2ACall(
        {
          jsonrpc: "2.0",
          id: requestId,
          method: "tasks/get",
          params: { id: task.id },
        },
        headers,
      );
    }
  }
  if (result && typeof result === "object") result.id = requestId;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}
// ---------------------------------------------------------------------------
http
  .createServer((req, res) => {
    if (req.url === "/api/foundry-fraude/a2a" && req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", async () => {
        try {
          await handleFoundryFraudeA2A(JSON.parse(b), res);
        } catch (e) {
          console.error("Foundry A2A proxy error", e.message);
          if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32000, message: e.message },
            }),
          );
        }
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/api/demo/records?")) {
      const result = lookupRecords(
        new URL(req.url, "http://localhost").searchParams,
      );
      res.writeHead(result.error ? 400 : 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify(result));
    }
    if (req.url === "/api/chat/stream" && req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", async () => {
        try {
          await streamChat(JSON.parse(b), res);
        } catch (e) {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        }
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
    const pathname = new URL(req.url, "http://localhost").pathname;
    const f = pathname === "/" ? "index.html" : pathname.slice(1),
      p = path.resolve(root, f);
    if (
      !p.startsWith(root + path.sep) ||
      !fs.existsSync(p) ||
      !fs.statSync(p).isFile()
    )
      return res.writeHead(404).end();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
    };
    res.setHeader(
      "Content-Type",
      types[path.extname(p)] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    res.end(fs.readFileSync(p));
  })
  .listen(process.env.PORT || 3000, () =>
    console.log("Demo em http://localhost:" + (process.env.PORT || 3000)),
  );
