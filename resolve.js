/**
 * Multi-step account resolution: decide which ledger a payment belongs to.
 *
 * Steps, strongest signal first. The first step that yields exactly one
 * ledger wins; if a step yields several, we narrow with the next step.
 *   1. Caption override   — caption names a ledger alias ("#shop", "personal")
 *   2. Account tail       — last 4 digits of receiving account/IBAN/wallet
 *   3. Bank + holder name — receiving bank and account-holder name
 *   4. Holder name only   — fuzzy name match
 * Nothing conclusive → return candidates for the user to pick from.
 */

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function nameMatches(holderNames, name) {
  const n = norm(name);
  if (!n) return false;
  return holderNames.some((h) => {
    const hn = norm(h);
    // all tokens of the shorter name appear in the longer one
    const [a, b] = hn.length < n.length ? [hn, n] : [n, hn];
    return a.split(" ").every((tok) => b.includes(tok));
  });
}

export function resolveLedger(ledgers, extracted, caption = "") {
  let pool = ledgers;

  // 1. Caption override
  const cap = norm(caption);
  const byAlias = pool.filter((l) => (l.aliases || []).some((a) => cap.includes(norm(a))));
  if (byAlias.length === 1) return { ledger: byAlias[0], method: "caption" };

  // 2. Account tail
  const tail = (extracted.receiver_account_tail || "").replace(/\D/g, "").slice(-4);
  if (tail.length === 4) {
    const byTail = pool.filter((l) => (l.accountTails || []).includes(tail));
    if (byTail.length === 1) return { ledger: byTail[0], method: "account digits" };
    if (byTail.length > 1) pool = byTail;
  }

  // 3. Bank + holder name
  const bank = norm(extracted.receiver_bank);
  const byBankName = pool.filter(
    (l) => bank && norm(l.bank) && bank.includes(norm(l.bank)) && nameMatches(l.holderNames || [], extracted.receiver_name)
  );
  if (byBankName.length === 1) return { ledger: byBankName[0], method: "bank + name" };
  if (byBankName.length > 1) pool = byBankName;

  // 4. Holder name only
  const byName = pool.filter((l) => nameMatches(l.holderNames || [], extracted.receiver_name));
  if (byName.length === 1) return { ledger: byName[0], method: "account holder name" };

  return { ledger: null, candidates: byName.length ? byName : pool === ledgers ? [] : pool };
}
