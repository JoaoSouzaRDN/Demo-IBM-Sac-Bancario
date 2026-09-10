const toolLabels = {
  consultar_cliente: "Consultando dados do cliente",
  consultar_pix: "Verificando a transação Pix",
  consultar_cartao: "Consultando o cartão",
  consultar_compra: "Verificando a compra",
  consultar_parcela: "Consultando a parcela",
  consultar_perfil: "Consultando dados cadastrais",
};

// Only lifecycle and tool metadata are exposed. Tool arguments and thinking stay private.
function createProgress(emit) {
  const steps = [];
  const seen = new Set();
  let consulting = false;
  const publish = () =>
    emit({ event: "progress", steps: steps.map((step) => ({ ...step })) });
  function set(id, label, status) {
    let step = steps.find((item) => item.id === id);
    if (!step) {
      step = { id, label, status };
      steps.push(step);
    } else {
      if (step.status === status) return;
      step.status = status;
    }
    publish();
  }
  function complete(id) {
    const step = steps.find((item) => item.id === id);
    if (step) set(id, step.label, "done");
  }
  function consume(event) {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    const data = event.data || {};
    if (event.event === "run.started")
      set("understand", "Entendendo sua solicitação", "active");
    if (data.current_agent === "sac_consulta") {
      consulting = true;
      complete("understand");
      set("consult", "Analisando com o agente de consulta", "active");
    } else if (consulting && data.current_agent === "sac_resposta") {
      complete("consult");
      for (const step of steps) {
        if (step.status === "active" && step.id !== "answer") complete(step.id);
      }
      set("answer", "Formulando resposta", "active");
    }
    for (const detail of data.delta?.step_details || []) {
      const calls =
        detail.tool_calls || (detail.type === "tool_call" ? [detail] : []);
      for (const call of calls) {
        const label = toolLabels[call.name];
        if (label) {
          complete("understand");
          set(call.id || call.tool_call_id || call.name, label, "active");
        }
      }
      if (detail.type === "tool_response" && toolLabels[detail.name]) {
        set(
          detail.tool_call_id || detail.name,
          toolLabels[detail.name],
          "done",
        );
      }
    }
    if (event.event === "message.delta" && data.delta?.content) {
      complete("understand");
      set("answer", "Formulando resposta", "active");
    }
  }
  function finish() {
    // A completed run has no executing calls left; do not leave a spinner behind.
    for (const step of steps) {
      if (step.status === "active") complete(step.id);
    }
    complete("understand");
    complete("consult");
    set("answer", "Formulando resposta", "done");
    set("delivered", "Resposta enviada", "done");
  }
  return { consume, finish };
}

module.exports = { createProgress };
