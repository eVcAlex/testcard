// Runs before first paint (external, so the CSP can stay script-src 'self'). Keep in step with src/theme.ts.
(function () {
  var d = document.documentElement;
  var m = window.matchMedia("(prefers-color-scheme: light)");
  var pref = "auto";
  try {
    var saved = localStorage.getItem("tc-theme");
    if (saved === "light" || saved === "dark") pref = saved;
  } catch {}
  // The browser UI colour follows an explicit choice (the media-query metas only know the system setting). Keep in step with paintThemeColour.
  if (pref !== "auto") {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", pref === "light" ? "#efe8d6" : "#11100d");
  }
  function apply() {
    var p = d.getAttribute("data-theme-pref");
    d.setAttribute("data-theme", p === "light" || p === "dark" ? p : m.matches ? "light" : "dark");
  }
  // Styles that only make sense with script key off this, so no-JS visitors get everything.
  d.classList.add("js");
  // Motion is an enhancement: with reduced motion the site keeps its calm layout (see styles.css, .anim).
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) d.classList.add("anim");
  // The opening animation plays once per tab. sessionStorage may be blocked; then it simply plays on every load.
  try {
    if (sessionStorage.getItem("tc-intro")) d.classList.add("no-intro");
    else sessionStorage.setItem("tc-intro", "1");
  } catch {}
  d.setAttribute("data-theme-pref", pref);
  apply();
  if (m.addEventListener) m.addEventListener("change", apply);
})();
