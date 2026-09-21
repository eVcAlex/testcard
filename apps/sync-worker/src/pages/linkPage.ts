/**
 * The page a viewer opens on a phone or computer to sign in a TV. One self-contained document: inline CSS and JS,
 * WebCrypto only, no third-party requests. The steps in `<script>` mirror packages/core/src/sync/linkCrypto.ts;
 * the constants below must stay identical to it (a test holds them together).
 */
export const LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_LOOKUP_SALT = "testcard-link-lookup-v1";
export const LINK_ITERATIONS = 210_000;

const CSS = `
:root { --bg:#0a0d11; --raised:#12161b; --card:#171c22; --active:#232a32; --line:#252c34; --fg:#f2eee7; --muted:#a4a9af; --faint:#737a82; --accent:#e7d2ad; --ink:#1d160a; --fault:#f0745c; --ok:#9bd6a8; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { color-scheme: dark; overflow-x: clip; }
body { min-height: 100vh; min-height: 100dvh; overflow-x: clip; background: radial-gradient(70% 45% at 50% 0%, #e7d2ad14, transparent 70%), var(--bg); color: var(--fg); font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; display: flex; flex-direction: column; align-items: center; padding: 32px 20px 40px; }
.brand { width: 100%; max-width: 440px; font-size: 28px; font-weight: 600; letter-spacing: -0.6px; margin-bottom: 36px; } .brand b { color: var(--accent); font-weight: 600; }
main { width: 100%; max-width: 440px; }
.tv { display: block; width: 84px; height: 64px; margin-bottom: 22px; }
h1 { font-size: 34px; line-height: 1.1; font-weight: 600; letter-spacing: -0.9px; overflow-wrap: anywhere; }
.lead { color: var(--muted); font-size: 17px; margin-top: 12px; }
form { margin-top: 30px; display: grid; gap: 18px; }
label { display: grid; gap: 8px; font-size: 14px; font-weight: 500; color: var(--muted); }
input { width: 100%; height: 56px; padding: 0 18px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--card); color: var(--fg); font: inherit; font-size: 17px; outline: none; }
input::placeholder { color: var(--faint); }
input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 4px #e7d2ad26; }
input[aria-invalid="true"] { border-color: var(--fault); }
#code { height: 68px; text-align: center; font-size: 30px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; font-variant-numeric: tabular-nums; padding-left: 0.22em; }
button { height: 58px; border: 0; border-radius: 999px; background: var(--accent); color: var(--ink); font: inherit; font-size: 18px; font-weight: 600; cursor: pointer; margin-top: 6px; }
button:hover { filter: brightness(1.06); }
button:active { transform: translateY(1px); }
button:focus-visible { outline: 3px solid var(--fg); outline-offset: 3px; }
button[disabled] { opacity: .55; cursor: default; filter: none; transform: none; }
.error { min-height: 22px; color: var(--fault); font-size: 15px; }
.note { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--faint); font-size: 14px; }
.done { text-align: left; }
.done .tick { width: 64px; height: 64px; border-radius: 50%; background: #9bd6a81f; display: flex; align-items: center; justify-content: center; margin-bottom: 22px; }
[hidden] { display: none !important; }
@media (min-width: 640px) { body { padding-top: 72px; } h1 { font-size: 40px; } }
@media (prefers-reduced-motion: no-preference) { button { transition: filter .15s, transform .1s; } input { transition: border-color .15s, box-shadow .15s; } }
`;

const SCRIPT = `
(function () {
  var ALPHABET = ${JSON.stringify(LINK_ALPHABET)};
  var LOOKUP_SALT = ${JSON.stringify(LINK_LOOKUP_SALT)};
  var ITERATIONS = ${LINK_ITERATIONS};
  var enc = new TextEncoder();
  var $ = function (id) { return document.getElementById(id); };
  function b64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(text) { var s = atob(text), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function clean(text) { return text.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function valid(code) { if (code.length !== 8) return false; for (var i = 0; i < code.length; i++) if (ALPHABET.indexOf(code[i]) < 0) return false; return true; }
  function pretty(code) { return code.length > 4 ? code.slice(0, 4) + "-" + code.slice(4) : code; }
  function base(code) { return crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveBits", "deriveKey"]); }
  function lookupFor(code) {
    return base(code).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(LOOKUP_SALT), iterations: ITERATIONS, hash: "SHA-256" }, k, 256);
    }).then(function (bits) { return b64(new Uint8Array(bits)); });
  }
  function keyFor(code, salt) {
    return base(code).then(function (k) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(salt), iterations: ITERATIONS, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    });
  }
  function post(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  function busy(on) { $("go").disabled = on; $("go").textContent = on ? "Linking..." : "Link this TV"; }
  function fail(msg, field) {
    $("error").textContent = msg;
    ["code", "email", "password"].forEach(function (id) { $(id).removeAttribute("aria-invalid"); });
    if (field) { $(field).setAttribute("aria-invalid", "true"); $(field).focus(); }
    busy(false);
  }

  var fromHash = clean(location.hash.slice(1));
  if (fromHash) { $("code").value = pretty(fromHash.slice(0, 8)); history.replaceState(null, "", location.pathname); }
  $("code").addEventListener("input", function () { var c = clean($("code").value).slice(0, 8); $("code").value = pretty(c); });

  $("form").addEventListener("submit", function (event) {
    event.preventDefault();
    var code = clean($("code").value), email = $("email").value.trim(), password = $("password").value;
    $("error").textContent = "";
    if (!valid(code)) return fail("That code is not 8 letters and numbers. Check your TV and try again.", "code");
    if (!email) return fail("Enter the email you use for Testcard.", "email");
    if (!password) return fail("Enter your password.", "password");
    busy(true);
    var lookup, salt;
    lookupFor(code).then(function (l) {
      lookup = l;
      return fetch("/link/session?lookup=" + encodeURIComponent(lookup));
    }).then(function (r) {
      if (!r.ok) throw { field: "code", message: "That code was not found, or it has expired. Ask your TV for a new one." };
      return r.json();
    }).then(function (s) {
      salt = s.salt;
      return post("/auth/sign-in/email", { email: email, password: password });
    }).then(function (r) {
      if (!r.ok) throw { field: "password", message: "That email and password do not match a Testcard account." };
      return keyFor(code, salt);
    }).then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(JSON.stringify({ email: email, password: password }))).then(function (blob) {
        return post("/link/approve", { lookup: lookup, blob: b64(new Uint8Array(blob)), iv: b64(iv) });
      });
    }).then(function (r) {
      if (!r.ok) throw { field: "code", message: "That code was not found, or it has expired. Ask your TV for a new one." };
      $("form-view").hidden = true;
      $("done-view").hidden = false;
    }).catch(function (e) {
      if (e && e.message) fail(e.message, e.field);
      else fail("Could not reach Testcard. Check your connection and try again.");
    });
  });
})();
`;

const TV = `<svg class="tv" viewBox="0 0 84 64" fill="none" aria-hidden="true"><rect x="2" y="2" width="80" height="50" rx="9" stroke="#e7d2ad" stroke-width="3"/><path d="M28 62h28" stroke="#e7d2ad" stroke-width="3" stroke-linecap="round"/><path d="M42 52v10" stroke="#e7d2ad" stroke-width="3"/><g fill="#e7d2ad"><rect x="14" y="14" width="9" height="26" rx="2" opacity=".95"/><rect x="26" y="14" width="9" height="26" rx="2" opacity=".75"/><rect x="38" y="14" width="9" height="26" rx="2" opacity=".55"/><rect x="50" y="14" width="9" height="26" rx="2" opacity=".4"/><rect x="62" y="14" width="9" height="26" rx="2" opacity=".28"/></g></svg>`;

const TICK = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9bd6a8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

export const linkPageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Link your TV | Testcard</title>
<style>${CSS}</style>
</head>
<body>
<div class="brand">test<b>card</b></div>
<main>
  <section id="form-view">
    ${TV}
    <h1>Link your TV</h1>
    <p class="lead">Enter the code on your TV, then sign in with your Testcard account. Your TV will sign in on its own.</p>
    <form id="form" novalidate autocomplete="on">
      <label>Code on your TV<input id="code" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX" maxlength="9"></label>
      <label>Email<input id="email" type="email" autocomplete="username" inputmode="email" placeholder="you@example.com"></label>
      <label>Password<input id="password" type="password" autocomplete="current-password" placeholder="Your Testcard password"></label>
      <div class="error" id="error" role="alert" aria-live="polite"></div>
      <button id="go" type="submit">Link this TV</button>
    </form>
    <p class="note">Your password is scrambled in this page before it is sent, so the Testcard server never sees it. Only your TV can unscramble it, and only for the next 10 minutes.</p>
  </section>
  <section id="done-view" class="done" hidden>
    <div class="tick">${TICK}</div>
    <h1>You're signed in on your TV</h1>
    <p class="lead">Your TV is loading your sources now. You can close this page.</p>
  </section>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
