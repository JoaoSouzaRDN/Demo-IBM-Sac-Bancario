const test = require("node:test");
const assert = require("node:assert/strict");
const { lookupRecords } = require("./records");
const query = (params) => lookupRecords(new URLSearchParams(params));
test("Pix search needs only amount and date and does not disclose status before confirmation", () => {
  const result = query({ category: "pix", amount: "850", date: "2026-09-08" });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, "pix-20260908-8841");
  assert.equal(result.records[0].status, undefined);
  assert.equal(result.requiresConfirmation, true);
});
test("confirmed record provides actual status and missing records are not invented", () => {
  const result = query({ category: "pix", id: "pix-20260908-8841" });
  assert.equal(result.records[0].status, "pending");
  assert.ok(result.records[0].reason);
  assert.equal(
    query({ category: "pix", amount: "1", date: "2026-09-08" }).found,
    false,
  );
  assert.equal(
    query({ category: "pix", id: "another-customers-pix" }).found,
    false,
  );
  assert.equal(query({ category: "pix" }).records.length, 0);
});
