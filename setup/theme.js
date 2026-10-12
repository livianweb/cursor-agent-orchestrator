(function () {
  "use strict";

  var THEME_COOKIE_NAME = "orchestrator-theme";
  var THEME_STORAGE_KEY = "orchestrator-theme";
  var COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;
  var DEFAULT_THEME = "dark";

  function getThemeCookie() {
    var parts = document.cookie.split(";");
    for (var i = 0; i < parts.length; i++) {
      var trimmed = parts[i].trim();
      if (!trimmed.startsWith(THEME_COOKIE_NAME + "=")) continue;
      var value = decodeURIComponent(trimmed.slice(THEME_COOKIE_NAME.length + 1));
      if (value === "light" || value === "dark") return value;
      return null;
    }
    return null;
  }

  function getResolvedTheme() {
    var fromCookie = getThemeCookie();
    if (fromCookie) return fromCookie;
    return DEFAULT_THEME;
  }

  function applyResolvedTheme(resolved) {
    document.documentElement.setAttribute("data-theme", resolved);
  }

  function setThemeCookie(theme) {
    var secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      THEME_COOKIE_NAME +
      "=" +
      encodeURIComponent(theme) +
      "; path=/; max-age=" +
      COOKIE_MAX_AGE_SEC +
      "; SameSite=Lax" +
      secure;
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch (_e) {
      /* ignore */
    }
    applyResolvedTheme(theme);
  }

  function migrateLegacyThemeStorage() {
    if (getThemeCookie()) {
      try {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } catch (_e) {
        /* ignore */
      }
      return;
    }
    try {
      var raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === "light" || raw === "dark") {
        setThemeCookie(raw);
      } else if (raw === "system") {
        localStorage.removeItem(THEME_STORAGE_KEY);
      }
    } catch (_e) {
      /* ignore */
    }
  }

  var moonSvg =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var sunSvg =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.75"/>' +
    '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';

  function syncToggleButton(btn) {
    if (!btn) return;
    var resolved = getResolvedTheme();
    var isLight = resolved === "light";
    var label = isLight ? "Activar tema oscuro" : "Activar tema claro";
    btn.innerHTML = isLight ? moonSvg : sunSvg;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function initThemeToggle() {
    migrateLegacyThemeStorage();
    applyResolvedTheme(getResolvedTheme());
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    syncToggleButton(btn);
    btn.addEventListener("click", function () {
      var resolved = getResolvedTheme();
      var next = resolved === "light" ? "dark" : "light";
      setThemeCookie(next);
      syncToggleButton(btn);
    });
  }

  window.OrchestratorTheme = {
    COOKIE_NAME: THEME_COOKIE_NAME,
    DEFAULT_THEME: DEFAULT_THEME,
    getResolvedTheme: getResolvedTheme,
    setThemeCookie: setThemeCookie,
    initThemeToggle: initThemeToggle,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemeToggle);
  } else {
    initThemeToggle();
  }
})();
