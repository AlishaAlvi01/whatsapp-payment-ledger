import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLedger } from "../src/resolve.js";
import { encodeState, decodeState } from "../src/state.js";

const LEDGERS = [
  { key: "biz", label: "Business", accountTails: ["1234"], bank: "Meezan", holderNames: ["Example Traders"], aliases: ["shop"] },
  { key: "wallet", label: "Wallet", accountTails: ["5678"], bank: "JazzCash", holderNames: ["Ali Raza"], aliases: ["jazz"] },
  { key: "personal", label: "Personal", accountTails: ["1234"], bank: "HBL", holderNames: ["Ali Raza"], aliases: [] },
];

test("caption alias wins", () => {
  const r = resolveLedger(LEDGERS, { receiver_account_tail: "1234" }, "order 552 #jazz");
  assert.equal(r.ledger.key, "wallet");
  assert.equal(r.method, "caption");
});

test("unique account tail", () => {
  const r = resolveLedger(LEDGERS, { receiver_account_tail: "PK00 ... 5678" });
  assert.equal(r.ledger.key, "wallet");
});

test("shared tail narrowed by bank + name", () => {
  const r = resolveLedger(LEDGERS, { receiver_account_tail: "1234", receiver_bank: "HBL Mobile", receiver_name: "ALI RAZA" });
  assert.equal(r.ledger.key, "personal");
});

test("ambiguous returns candidates", () => {
  const r = resolveLedger(LEDGERS, { receiver_account_tail: "1234" });
  assert.equal(r.ledger, null);
  assert.equal(r.candidates.length, 2);
});

test("state round-trips through a button id and stays under 256 chars", () => {
  const entry = { a: 125000, d: "2026-10-10", r: "TXN98765432101", s: "Customer Name", n: "Order 1042 advance", m: "1234567890123456", l: "biz" };
  const id = encodeState("ok", entry);
  assert.ok(id.length <= 256);
  assert.deepEqual(decodeState(id), { action: "ok", data: entry });
});
