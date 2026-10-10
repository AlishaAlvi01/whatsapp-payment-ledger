/**
 * WhatsApp Payment Screenshot → Airtable Ledger — Cloudflare Worker template
 *
 * An authorised person forwards a bank / wallet transfer screenshot (optionally
 * with a caption or voice note). The Worker:
 *   1. extracts amount, date, reference, sender and receiving account with a vision model
 *   2. resolves WHICH ledger it belongs to (multi-step account resolution)
 *   3. sends an interactive confirmation card
 *   4. on "Confirm", writes the entry to the right Airtable ledger table
 *
 * Key trick: the confirmation card's button IDs carry the full entry state
 * (compact + base64url). When the tap comes back we decode it directly, so
 * we never depend on a KV read that might not have propagated yet
 * (KV is eventually consistent across edge locations).
 */

import { sendText, sendButtons, sendList, markRead, downloadMedia } from "./whatsapp.js";
import { transcribe, visionJSON } from "./groq.js";
import { resolveLedger } from "./resolve.js";
import { encodeState, decodeState } from "./state.js";
import { createLedgerEntry, isDuplicate } from "./airtable.js";

const EXTRACT_PROMPT = `You read payment / bank transfer screenshots from Pakistan (bank apps, Raast, JazzCash, Easypaisa, IBFT).
Return JSON only:
{
 "amount": number (no commas, PKR),
 "date": "YYYY-MM-DD" or null,
 "reference": "transaction ID / reference" or null,
 "sender_name": string or null,
 "receiver_name": string or null,
 "receiver_account_tail": "last 4 digits of receiving account/IBAN/wallet" or null,
 "receiver_bank": string or null,
 "confidence": 0-1
}
Never guess digits you cannot read; use null.`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/webhook") {
      const ok = url.searchParams.get("hub.verify_token") === env.WA_VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("Forbidden", { status: 403 });
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.json().catch(() => null);
      ctx.waitUntil(handle(body, env).catch((e) => console.error(e)));
      return new Response("OK");
    }
    return new Response("Not found", { status: 404 });
  },
};

function ledgers(env) {
  // LEDGERS: [{ key, label, tableId, accountTails:[], bank, holderNames:[], aliases:[] }, ...]
  return JSON.parse(env.LEDGERS);
}

function isAuthorised(env, phone) {
  return env.AUTHORISED_NUMBERS.split(",").map((s) => s.trim()).includes(phone);
}

async function handle(body, env) {
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;
  const from = msg.from;

  if (!isAuthorised(env, from)) return; // silently ignore everyone else
  await markRead(env, msg.id);

  if (msg.type === "interactive") {
    const r = msg.interactive.button_reply || msg.interactive.list_reply;
    return onTap(env, from, r.id);
  }

  if (msg.type === "image") return onScreenshot(env, from, msg.image.id, msg.image.caption || "");

  if (msg.type === "audio") {
    // Voice note after a screenshot = note for the latest pending card.
    const note = await transcribe(env, await downloadMedia(env, msg.audio.id), { normaliseRomanUrdu: true });
    await sendText(env, from, `🎙️ Note: "${note}"\nSend the screenshot with this as its caption, or forward the screenshot now.`);
    return;
  }

  await sendText(env, from, "Send a payment screenshot (you can add the order number or a note as the caption).");
}

async function onScreenshot(env, from, mediaId, caption) {
  const image = await downloadMedia(env, mediaId);
  const x = await visionJSON(env, image, EXTRACT_PROMPT);

  if (!x.amount) {
    return sendText(env, from, "❌ Couldn't read an amount from that screenshot. Please send a clearer one.");
  }

  const entry = {
    a: Math.round(x.amount),                 // amount
    d: x.date || new Date().toISOString().slice(0, 10),
    r: (x.reference || "").slice(0, 40),     // reference
    s: (x.sender_name || "").slice(0, 40),   // sender
    n: caption.slice(0, 60),                 // note / order no.
    m: mediaId,                              // keep media id for the attachment
  };

  // Multi-step account resolution
  const res = resolveLedger(ledgers(env), x, caption);

  if (res.ledger) {
    entry.l = res.ledger.key;
    return sendConfirmCard(env, from, entry, res.ledger, res.method, x.confidence);
  }

  // Couldn't decide → let the user pick the ledger. State rides in each row id.
  const rows = (res.candidates.length ? res.candidates : ledgers(env)).slice(0, 10).map((l) => ({
    id: encodeState("pick", { ...entry, l: l.key }),
    title: l.label.slice(0, 24),
  }));
  return sendList(env, from,
    `💰 Rs ${entry.a.toLocaleString("en-PK")} on ${entry.d}\nWhich account received this?`,
    "Choose ledger", rows);
}

function sendConfirmCard(env, to, entry, ledger, method, confidence) {
  const body =
    `🧾 *New ledger entry*\n` +
    `Ledger: ${ledger.label}  _(matched by ${method})_\n` +
    `Amount: Rs ${entry.a.toLocaleString("en-PK")}\n` +
    `Date: ${entry.d}\n` +
    (entry.r ? `Ref: ${entry.r}\n` : "") +
    (entry.s ? `From: ${entry.s}\n` : "") +
    (entry.n ? `Note: ${entry.n}\n` : "") +
    (confidence !== undefined && confidence < 0.7 ? `\n⚠️ Low read confidence — please double-check.` : "");

  return sendButtons(env, to, body, [
    { id: encodeState("ok", entry), title: "✅ Confirm" },
    { id: encodeState("chg", entry), title: "🔁 Other ledger" },
    { id: encodeState("no", { m: entry.m }), title: "❌ Discard" },
  ]);
}

async function onTap(env, from, id) {
  const { action, data: entry } = decodeState(id);
  const all = ledgers(env);

  if (action === "no") return sendText(env, from, "Discarded. Nothing saved.");

  if (action === "chg") {
    const rows = all.filter((l) => l.key !== entry.l).slice(0, 10).map((l) => ({
      id: encodeState("pick", { ...entry, l: l.key }),
      title: l.label.slice(0, 24),
    }));
    return sendList(env, from, "Move this entry to which ledger?", "Choose ledger", rows);
  }

  const ledger = all.find((l) => l.key === entry.l);
  if (!ledger) return sendText(env, from, "That ledger no longer exists in config.");

  if (action === "pick") return sendConfirmCard(env, from, entry, ledger, "manual choice");

  if (action === "ok") {
    // Double-tap / redelivery protection
    if (await isDuplicate(env, ledger, entry)) {
      return sendText(env, from, "ℹ️ This entry is already in the ledger.");
    }
    const rec = await createLedgerEntry(env, ledger, entry);
    return sendText(env, from, `✅ Saved to *${ledger.label}* (record ${rec.id}).`);
  }
}
