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
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", pref === "light" ? "#f7f8f9" : "#14171a");
  }
  function apply() {
    var p = d.getAttribute("data-theme-pref");
    d.setAttribute("data-theme", p === "light" || p === "dark" ? p : m.matches ? "light" : "dark");
  }
  // Styles that only make sense with script (the demo collapsing its rows) key off this, so no-JS visitors get everything.
  d.classList.add("js");
  d.setAttribute("data-theme-pref", pref);
  apply();
  if (m.addEventListener) m.addEventListener("change", apply);
})();
