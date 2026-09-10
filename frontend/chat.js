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
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: t }),
    });
    const d = await r.json();
    renderChecklist(4, 3);
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
