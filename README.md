# WhatsApp Payment Ledger

Forward a bank or wallet transfer screenshot on WhatsApp → the bot reads it, works out which account received it, asks you to confirm with one tap, and logs it to the right Airtable ledger.

Built for businesses that get paid by bank transfer, Raast, JazzCash or Easypaisa and currently copy screenshots into a spreadsheet by hand.

> Template repo. Generic, rebuilt reference implementation of a system I designed and run in production. No client code, data, or IDs are included.

## Flow

```
Screenshot (+ optional caption: order no., "#wallet")
   │
   ▼
Vision model ──► { amount, date, reference, sender, receiver tail, bank, confidence }
   │
   ▼
Account resolution:  caption alias → account digits → bank + holder name → holder name → ask
   │
   ▼
Confirmation card   [✅ Confirm]  [🔁 Other ledger]  [❌ Discard]
   │   (entry state is encoded inside the button IDs)
   ▼
Duplicate check (reference + amount) ──► Airtable ledger table
```

## Why state lives in the button IDs

The obvious design stores the pending entry in KV and reads it back when the user taps Confirm. Cloudflare KV is eventually consistent, so a fast tap can hit an edge that hasn't seen the write yet — the entry "disappears". Here the confirm button's `id` carries the compact entry itself (`ok:<base64url JSON>`, ≤256 chars), so the tap is self-contained and works even hours later. See `src/state.js`.

## Features

- Any number of ledgers (business accounts, wallets, personal) configured in one JSON var
- Multi-step account resolution with a pick-list fallback
- Low-confidence reads flagged on the card
- Authorised numbers only — everyone else is ignored
- Duplicate protection on double taps / webhook redelivery
- Voice-note notes with Whisper (Roman Urdu friendly)
- Field names are config, so it fits any Airtable layout

## Setup

```bash
npm install
npx wrangler secret put WA_TOKEN
npx wrangler secret put WA_PHONE_NUMBER_ID
npx wrangler secret put WA_VERIFY_TOKEN
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put AIRTABLE_TOKEN      # PAT with data.records:read/write on the base
npx wrangler secret put AIRTABLE_BASE_ID
# edit LEDGERS, LEDGER_FIELDS and AUTHORISED_NUMBERS in wrangler.jsonc
npm test
npm run deploy
```

Point the Meta webhook at `https://<worker>.workers.dev/webhook`.

## Author

Built by **Alisha Alvi** — automation & AI systems engineer.
[LinkedIn](https://linkedin.com/in/alisha-alvie) · [GitHub](https://github.com/AlishaAlvi01) · alishaalvi745@gmail.com
