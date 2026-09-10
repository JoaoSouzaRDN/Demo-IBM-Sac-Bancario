const data = require("../mock-db/data.json");

// Fixed fictional customer scope: never select an account from request parameters.
function lookupRecords(params) {
  const category = params.get("category");
  const collections = {
    pix: "pix",
    cartao: "cards",
    compra: "purchases",
    parcela: "loans",
    perfil: "profiles",
    cliente: "customers",
  };
  const collection = collections[category];
  if (!collection) return { error: "Categoria inválida." };
  let records = data[collection].filter(
    (item) => (item.customerId || item.id) === "cli-001",
  );
  const id = params.get("id");
  if (id)
    records = records.filter(
      (item) => item.id === id || (category === "perfil" && id === "cli-001"),
    );
  if (category === "pix" && !id) {
    const date = params.get("date");
    const amount = Number(params.get("amount"));
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !params.get("amount") ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return { found: false, required: ["amount", "date"], records: [] };
    }
    records = records.filter(
      (item) =>
        item.date.slice(0, 10) === date &&
        Math.round(item.amount * 100) === Math.round(amount * 100),
    );
    records = records.map(({ id, amount, date, recipient }) => ({
      id,
      amount,
      date,
      recipient,
    }));
  }
  return {
    found: records.length > 0,
    category,
    records,
    checkedAt: new Date().toISOString(),
    requiresConfirmation: category === "pix" && !id,
  };
}
module.exports = { lookupRecords };
