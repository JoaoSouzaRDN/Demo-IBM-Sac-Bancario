const test = require("node:test");
const assert = require("node:assert/strict");
const { createProgress } = require("./progress");

test("observed tools become tasks, replays are ignored, completion stops all activity", () => {
  const updates = [];
  const progress = createProgress((event) => updates.push(event));
  progress.consume({ id: "1", event: "run.started" });
  const consultation = {
    id: "2",
    event: "run.step.intermediate",
    data: { current_agent: "sac_consulta" },
  };
  progress.consume(consultation);
  const count = updates.length;
  progress.consume(consultation);
  assert.equal(updates.length, count);
  progress.consume({
    id: "3",
    event: "run.step.delta",
    data: {
      delta: {
        step_details: [
          {
            type: "tool_calls",
            tool_calls: [
              {
                name: "consultar_pix",
                id: "pix1",
                args: { secret: "never publish" },
              },
            ],
          },
        ],
      },
    },
  });
  assert.equal(
    updates.at(-1).steps.at(-1).label,
    "Verificando a transação Pix",
  );
  assert.ok(!JSON.stringify(updates).includes("never publish"));
  progress.consume({
    id: "4",
    event: "run.step.intermediate",
    data: { current_agent: "sac_resposta" },
  });
  assert.equal(
    updates.at(-1).steps.find((step) => step.id === "pix1").status,
    "done",
  );
  progress.finish();
  assert.ok(updates.at(-1).steps.every((step) => step.status === "done"));
});

test("an unrecognized current_agent (e.g. the external collaborator's own name) is ignored, not a second step source", () => {
  // Regression: an earlier version also treated
  // current_agent === "analise_fraude_reembolso" as its own step source,
  // *in addition to* the tool_call path below — since neither dedup'd
  // against the other, the two together produced a visible duplicate row
  // in production. Only the tool_call path should ever create a step now.
  const updates = [];
  const progress = createProgress((event) => updates.push(event));
  progress.consume({ id: "1", event: "run.started" });
  progress.consume({
    id: "2",
    event: "run.step.intermediate",
    data: { current_agent: "sac_consulta" },
  });
  progress.consume({
    id: "3",
    event: "run.step.intermediate",
    data: { current_agent: "analise_fraude_reembolso" },
  });
  assert.equal(updates.at(-1).steps.find((step) => step.id === "fraud"), undefined);
  progress.consume({
    id: "4",
    event: "run.step.delta",
    data: {
      delta: {
        step_details: [
          {
            type: "tool_calls",
            tool_calls: [
              { name: "chat_with_collaborator_analise_fraude_reembolso", id: "fraud1" },
            ],
          },
        ],
      },
    },
  });
  const fraudSteps = updates
    .at(-1)
    .steps.filter((step) => step.label === "Analisando risco da contestação");
  assert.equal(fraudSteps.length, 1);
});

test("external fraud-analysis collaborator is labeled as a tool call, not a current_agent hop", () => {
  // Unlike native collaborators (sac_consulta), the external A2A agent is
  // invoked as a plain tool call in the real event stream — this is the
  // shape actually observed in production traces.
  const updates = [];
  const progress = createProgress((event) => updates.push(event));
  progress.consume({ id: "1", event: "run.started" });
  progress.consume({
    id: "2",
    event: "run.step.delta",
    data: {
      delta: {
        step_details: [
          {
            type: "tool_calls",
            tool_calls: [
              {
                name: "chat_with_collaborator_analise_fraude_reembolso",
                id: "fraud1",
              },
            ],
          },
        ],
      },
    },
  });
  assert.equal(
    updates.at(-1).steps.at(-1).label,
    "Analisando risco da contestação",
  );
  assert.equal(updates.at(-1).steps.at(-1).status, "active");
  progress.consume({
    id: "3",
    event: "run.step.delta",
    data: {
      delta: {
        step_details: [
          {
            type: "tool_response",
            tool_call_id: "fraud1",
            name: "chat_with_collaborator_analise_fraude_reembolso",
          },
        ],
      },
    },
  });
  assert.equal(updates.at(-1).steps.find((s) => s.id === "fraud1").status, "done");
  progress.finish();
  assert.ok(updates.at(-1).steps.every((step) => step.status === "done"));
});

test("a retried collaborator call reuses the same step instead of duplicating it", () => {
  // Observed in production: Orchestrate's own reflection/retry loop can
  // call the same collaborator twice with two different tool_call ids in
  // one turn, which previously showed up as two separate rows for the
  // same label in the progress panel.
  const updates = [];
  const progress = createProgress((event) => updates.push(event));
  progress.consume({ id: "1", event: "run.started" });
  const call = (id) => ({
    id: String(id),
    event: "run.step.delta",
    data: {
      delta: {
        step_details: [
          {
            type: "tool_calls",
            tool_calls: [
              { name: "chat_with_collaborator_analise_fraude_reembolso", id: `fraud${id}` },
            ],
          },
        ],
      },
    },
  });
  const response = (id) => ({
    id: `r${id}`,
    event: "run.step.delta",
    data: {
      delta: {
        step_details: [
          {
            type: "tool_response",
            tool_call_id: `fraud${id}`,
            name: "chat_with_collaborator_analise_fraude_reembolso",
          },
        ],
      },
    },
  });
  progress.consume(call(1));
  progress.consume(response(1));
  progress.consume(call(2));
  progress.consume(response(2));
  const fraudSteps = updates
    .at(-1)
    .steps.filter((step) => step.label === "Analisando risco da contestação");
  assert.equal(fraudSteps.length, 1);
  assert.equal(fraudSteps[0].status, "done");
});

test("a greeting does not invent a client or Pix query", () => {
  const updates = [];
  const progress = createProgress((event) => updates.push(event));
  progress.consume({ id: "1", event: "run.started" });
  progress.finish();
  assert.deepEqual(
    updates.at(-1).steps.map((step) => step.id),
    ["understand", "answer", "delivered"],
  );
});
