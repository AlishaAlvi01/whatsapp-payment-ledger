/**
 * Encode/decode entry state inside WhatsApp interactive reply IDs.
 *
 * WhatsApp echoes back the button/list-row `id` you set (max 256 chars).
 * Putting the whole pending entry in there means the confirm tap is
 * self-contained: no KV read, no race with eventual consistency, and it
 * still works if the user taps hours later.
 *
 * Format: "<action>:<base64url(JSON)>"
 */

const MAX_ID = 256;

export function encodeState(action, data) {
  let payload = b64url(JSON.stringify(data));
  let id = `${action}:${payload}`;
  if (id.length > MAX_ID) {
    // Trim the least important fields until it fits.
    const slim = { ...data };
    for (const k of ["n", "s", "r"]) {
      if (id.length <= MAX_ID) break;
      delete slim[k];
      payload = b64url(JSON.stringify(slim));
      id = `${action}:${payload}`;
    }
  }
  return id;
}

export function decodeState(id) {
  const i = id.indexOf(":");
  const action = id.slice(0, i);
  const data = JSON.parse(fromB64url(id.slice(i + 1)));
  return { action, data };
}

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
