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
