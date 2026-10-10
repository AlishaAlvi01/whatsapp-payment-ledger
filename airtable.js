// Airtable writes for ledger entries.
// Field names come from LEDGER_FIELDS so the same code works for any base layout.

const API = "https://api.airtable.com/v0";

function fields(env) {
  // e.g. {"amount":"Amount","date":"Date","reference":"Reference","sender":"Received From","note":"Note","source":"Source"}
  return JSON.parse(env.LEDGER_FIELDS);
}

export async function isDuplicate(env, ledger, entry) {
  const f = fields(env);
  if (!entry.r) return false; // no reference → can't dedupe reliably
  const formula = `AND({${f.reference}}='${entry.r.replace(/'/g, "\\'")}', {${f.amount}}=${entry.a})`;
  const url = new URL(`${API}/${env.AIRTABLE_BASE_ID}/${ledger.tableId}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("maxRecords", "1");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
  const data = await res.json();
  return (data.records || []).length > 0;
}

export async function createLedgerEntry(env, ledger, entry) {
  const f = fields(env);
  const record = {
    [f.amount]: entry.a,
    [f.date]: entry.d,
    [f.reference]: entry.r || "",
    [f.sender]: entry.s || "",
    [f.note]: entry.n || "",
    [f.source]: "WhatsApp bot",
  };
  const res = await fetch(`${API}/${env.AIRTABLE_BASE_ID}/${ledger.tableId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: record }], typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return (await res.json()).records[0];
}
