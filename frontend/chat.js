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
  panel.innerHTML = `<b>HistÃ³rico do atendimento</b><div id="checklistSteps">${steps.map((step, i) => {
    const item = typeof step === "string" ? { label: step, status: "done" } : step;
    const status = item.status || (item.completed ? "done" : "pending");
    return `<div class="check ${status}"><i></i><span>${item.label || item.name || "Etapa do atendimento"}</span>${item.time || item.detail ? `<small>${item.time || item.detail}</small>` : ""}</div>`;
  }).join("")}</div>`;
  return true;
}
function add(t, w = "agent") {
  $("#messages").insertAdjacentHTML(
    "beforeend",
    `<div class="msg ${w}">${t}</div>`,
  );
}
function start() {
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
  if (!t) return;
  renderChecklist(1, 0);
  add(t, "user");
  $("#input").value = "";
  add("Consultando os sistemas do banco…");
  try {
    renderChecklist(2, 1);
    const stream = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: t, threadId: window.__wxoThreadId }),
    });
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", reply = "";
    const placeholder = document.querySelectorAll(".agent").at(-1);
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
        if (data.thread_id) window.__wxoThreadId = data.thread_id;
        if (renderAgentExecution(data.execution || data.steps)) continue;
        const eventName = data.event || data.type;
        if (eventName?.includes("step")) renderChecklist(eventName.includes("completed") ? 3 : 2, eventName.includes("completed") ? 2 : 1);
        const delta = data.choices?.[0]?.delta?.content || data.delta?.text || data.content || data.reply || "";
        if (typeof delta === "string") reply += delta;
      }
    }
    placeholder?.remove();
    add(reply || "Atendimento concluÃ­do.");
    renderChecklist(4, 3);
    return;
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: t }),
    });
    const d = await r.json();
    renderAgentExecution(d.execution || d.steps) || renderChecklist(4, 3);
    document.querySelectorAll(".agent").at(-1).remove();
    add(d.reply || d.output || "Atendimento concluído.");
  } catch (e) {
    renderChecklist(4, 1);
    document.querySelectorAll(".agent").at(-1).remove();
    add("Não foi possível conectar ao agente.");
  }
}
$("#form").onsubmit = (e) => {
  e.preventDefault();
  send($("#input").value.trim());
};
$("#reset").onclick = start;
start();
