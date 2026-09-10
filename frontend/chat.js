const options = [
  "Fiz um Pix e o dinheiro não chegou",
  "Perdi meu cartão",
  "Quero contestar uma compra",
  "Minha parcela está atrasada",
  "Quero atualizar meus dados",
];
const $ = (s) => document.querySelector(s);
const flowLabels = ["Cliente identificado", "Solicitação entendida", "Consultando dados", "Aplicando regras", "Resposta preparada"];
function renderChecklist(active = 0, done = -1) {
  const panel = document.querySelector(".checklist");
  if (!panel) return;
  panel.innerHTML = `<b>Histórico do atendimento</b><div id="checklistSteps">${flowLabels.map((label, i) => `<div class="check ${i <= done ? "done" : i === active ? "active" : ""}"><i></i><span>${label}</span>${i === active ? "<small>em andamento</small>" : ""}</div>`).join("")}</div>`;
}
function renderAgentExecution(execution) {
  const steps = Array.isArray(execution) ? execution : execution?.steps;
  if (!Array.isArray(steps) || !steps.length) return false;
  const panel = document.querySelector(".checklist");
  panel.innerHTML = `<b>Histórico do atendimento</b><div id="checklistSteps">${steps.map((step, i) => {
    const item = typeof step === "string" ? { label: step, status: "done" } : step;
    const status = item.status || (item.completed ? "done" : "pending");
    return `<div class="check ${status}"><i></i><span>${item.label || item.name || "Etapa do atendimento"}</span>${item.time || item.detail ? `<small>${item.time || item.detail}</small>` : ""}</div>`;
  }).join("")}</div>`;
  return true;
}
function add(t, w = "agent") {
  const message = document.createElement("div");
  message.className = `msg ${w}`;
  message.textContent = t;
  $("#messages").appendChild(message);
  return message;
}
let activeRequest = null;
function start() {
  activeRequest?.abort();
  activeRequest = null;
  window.__wxoThreadId = undefined;
  const messages = $("#messages");
  const suggestions = $("#suggestions");
  messages.innerHTML = "";
  renderChecklist(0, -1);
  suggestions.style.display = "flex";
  suggestions.innerHTML = options
    .map((x) => `<button type="button">${x}</button>`)
    .join("");
  add(
    "Olá! Sou o assistente do RDN Bank. Vou consultar os dados e orientar você com segurança. Como posso ajudar?",
  );
  messages.appendChild(suggestions);
  document.querySelectorAll(".suggestions button").forEach(
    (b, i) =>
      (b.onclick = () => {
        $("#suggestions").style.display = "none";
        send(options[i]);
      }),
  );
}
async function send(t) {
  if (!t || activeRequest) return;
  const controller = new AbortController();
  activeRequest = controller;
  $("#suggestions").style.display = "none";
  renderChecklist(1, 0);
  add(t, "user");
  $("#input").value = "";
  const placeholder = add("Consultando os sistemas do banco…");
  try {
    renderChecklist(2, 1);
    const stream = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: t, threadId: window.__wxoThreadId }),
      signal: controller.signal,
    });
    if (!stream.ok) throw new Error(`Falha de conexão (HTTP ${stream.status}).`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", reply = "", hasExecution = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();
      for (const event of events) {
        const line = event.split("\n").find((x) => x.startsWith("data: "));
        if (!line) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        let data;
        try { data = JSON.parse(raw); } catch { continue; }
        if (data.error) throw new Error(data.error);
        if (data.thread_id) window.__wxoThreadId = data.thread_id;
        const payload = data.data && typeof data.data === "object" ? { ...data, ...data.data } : data;
        hasExecution = renderAgentExecution(payload.execution || payload.steps) || hasExecution;
        const eventName = payload.event || payload.type;
        if (eventName?.includes("step") && !hasExecution) renderChecklist(2, 1);
        const delta = payload.choices?.[0]?.delta?.content || payload.delta?.text || payload.content || payload.reply || "";
        if (typeof delta === "string") reply += delta;
      }
    }
    if (!reply.trim()) throw new Error("O agente não retornou uma resposta. Tente novamente.");
    placeholder?.remove();
    add(reply);
    if (!hasExecution) renderChecklist(-1, 4);
  } catch (e) {
    if (controller.signal.aborted) return;
    renderChecklist(-1, -1);
    placeholder.remove();
    add(e.message || "Não foi possível conectar ao agente.");
  } finally {
    if (activeRequest === controller) activeRequest = null;
  }
}
$("#form").onsubmit = (e) => {
  e.preventDefault();
  send($("#input").value.trim());
};
$("#reset").onclick = start;
start();
