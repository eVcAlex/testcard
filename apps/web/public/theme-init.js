// Runs before first paint (external, so the CSP can stay script-src 'self'). Keep in step with src/theme.ts.
(function () {
  var d = document.documentElement;
  var m = window.matchMedia("(prefers-color-scheme: light)");
  var pref = "auto";
  try {
    var saved = localStorage.getItem("tc-theme");
    if (saved === "light" || saved === "dark") pref = saved;
  } catch {}
  function apply() {
    var p = d.getAttribute("data-theme-pref");
    d.setAttribute("data-theme", p === "light" || p === "dark" ? p : m.matches ? "light" : "dark");
  }
  d.setAttribute("data-theme-pref", pref);
  apply();
  if (m.addEventListener) m.addEventListener("change", apply);
})();
