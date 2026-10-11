document.querySelectorAll(".cmd").forEach((block) => {
  const btn = block.querySelector(".copy");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const text = block.getAttribute("data-copy") || block.querySelector("code")?.innerText || "";
    try {
      await navigator.clipboard.writeText(text.replace(/&#10;/g, "\n"));
      const prev = btn.textContent;
      btn.textContent = "Copiado";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1600);
    } catch {
      btn.textContent = "Selecciona y copia";
    }
  });
});

const installForm = document.getElementById("install-form");
const installBtn = document.getElementById("install-btn");
const installStatus = document.getElementById("install-status");
const installProgress = document.getElementById("install-progress");
const installLogDetails = document.getElementById("install-log-details");
const installLog = document.getElementById("install-log");
const pathInput = document.getElementById("project-path");
const forceFlag = document.getElementById("flag-force");
const mergeApplyFlag = document.getElementById("flag-merge-apply");
const mergeFlags = installForm?.querySelectorAll('input[value="--merge"], input[value="--merge-apply"]');

function setInstallUi(state, message) {
  if (!installProgress || !installStatus) return;
  installProgress.classList.remove("hidden", "is-done", "is-error");
  installStatus.dataset.kind = "";
  if (state === "busy") {
    installStatus.textContent = message || "Instalando…";
    installStatus.dataset.kind = "busy";
  } else if (state === "ok") {
    installProgress.classList.add("is-done");
    installStatus.textContent = message || "Listo";
    installStatus.dataset.kind = "ok";
  } else if (state === "error") {
    installProgress.classList.add("is-error");
    installStatus.textContent = message || "Error";
    installStatus.dataset.kind = "error";
  }
}

function showLog(text, openDetails) {
  if (!installLog || !installLogDetails) return;
  installLog.textContent = text || "";
  installLogDetails.classList.toggle("hidden", !text);
  if (openDetails && text) {
    installLogDetails.open = true;
  }
}

function collectFlags() {
  if (!installForm) return [];
  const flags = [];
  installForm.querySelectorAll('input[name="flag"]:checked').forEach((el) => {
    flags.push(el.value);
  });
  if (flags.includes("--force") && (flags.includes("--merge") || flags.includes("--merge-apply"))) {
    throw new Error("Forzar no se puede combinar con fusión askbox.");
  }
  return flags;
}

if (forceFlag && mergeFlags) {
  const syncExclusive = () => {
    if (forceFlag.checked) {
      mergeFlags.forEach((el) => {
        el.checked = false;
        el.disabled = true;
      });
    } else {
      mergeFlags.forEach((el) => {
        el.disabled = false;
      });
    }
  };
  forceFlag.addEventListener("change", syncExclusive);
  mergeFlags.forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) forceFlag.checked = false;
      syncExclusive();
    });
  });
  syncExclusive();
}

if (installForm) {
  installForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const path = (pathInput?.value || "").trim();
    if (!path) {
      setInstallUi("error", "Indica la ruta del proyecto.");
      installProgress?.classList.remove("hidden");
      pathInput?.focus();
      return;
    }
    if (!path.startsWith("/")) {
      setInstallUi("error", "La ruta debe empezar por /.");
      installProgress?.classList.remove("hidden");
      pathInput?.focus();
      return;
    }

    let flags;
    try {
      flags = collectFlags();
    } catch (err) {
      setInstallUi("error", err.message || "Opciones inválidas.");
      installProgress?.classList.remove("hidden");
      return;
    }

    installBtn.disabled = true;
    installProgress?.classList.remove("hidden", "is-done", "is-error");
    setInstallUi("busy", "Instalando…");
    showLog("", false);
    if (installLogDetails) installLogDetails.open = false;

    const headers = { "Content-Type": "application/json" };
    const token = window.__CONFIGURE_TOKEN__;
    if (token) {
      headers["X-Configure-Token"] = token;
    }

    const askboxUrl = (askboxUrlInput?.value || "").trim();
    const askboxToken = (askboxTokenInput?.value || "").trim();
    const payload = { path, flags, auto_update: autoUpdateEnabled?.checked ?? true };
    if (askboxUrl) payload.askbox_api_url = askboxUrl;
    if (askboxToken) payload.askbox_access_token = askboxToken;

    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      const log = data.log || data.error || res.statusText || "";

      if (data.ok) {
        setInstallUi("ok", "Listo");
        showLog(log, false);
        await saveAutoUpdatePreference(autoUpdateEnabled?.checked ?? true, { silent: true });
      } else {
        const msg = data.error || `Error (código ${data.exit_code ?? res.status})`;
        setInstallUi("error", msg);
        showLog(log, true);
      }
    } catch {
      setInstallUi("error", "Sin conexión con el servidor.");
      showLog("¿Está ./install.sh en marcha en este equipo?", true);
    } finally {
      installBtn.disabled = false;
    }
  });
}

const askboxUrlInput = document.getElementById("askbox-api-url");
const askboxTokenInput = document.getElementById("askbox-access-token");
const askboxCopyBtn = document.getElementById("askbox-copy-env");
const askboxEnvStatus = document.getElementById("askbox-env-status");

function isAskboxComplete() {
  const url = (askboxUrlInput?.value || "").trim();
  const token = (askboxTokenInput?.value || "").trim();
  const serverToken = askboxTokenInput?.getAttribute("data-server-token") === "1";
  return Boolean(url && (token || serverToken));
}

function syncDefaultMergeApply() {
  if (!mergeApplyFlag || forceFlag?.checked) return;
  const mergeOnly = installForm?.querySelector('input[value="--merge"]');
  if (isAskboxComplete()) {
    mergeApplyFlag.checked = true;
    if (mergeOnly) mergeOnly.checked = false;
  } else {
    mergeApplyFlag.checked = false;
    if (mergeOnly) mergeOnly.checked = false;
  }
}

async function loadSetupConfig() {
  try {
    const res = await fetch("/api/setup-config");
    const data = await res.json().catch(() => ({}));
    if (data.askbox_api_url && askboxUrlInput && !askboxUrlInput.value.trim()) {
      askboxUrlInput.value = data.askbox_api_url;
    }
    if (data.askbox_token_configured && askboxTokenInput) {
      askboxTokenInput.setAttribute("data-server-token", "1");
    }
    syncDefaultMergeApply();
  } catch {
    syncDefaultMergeApply();
  }
}

if (askboxUrlInput) {
  askboxUrlInput.addEventListener("input", syncDefaultMergeApply);
}
if (askboxTokenInput) {
  askboxTokenInput.addEventListener("input", () => {
    if (askboxTokenInput.value.trim()) {
      askboxTokenInput.removeAttribute("data-server-token");
    }
    syncDefaultMergeApply();
  });
}

loadSetupConfig();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildAskboxEnvExport() {
  const url = (askboxUrlInput?.value || "").trim();
  const token = (askboxTokenInput?.value || "").trim();
  return [
    `export ASKBOX_API_URL=${url ? shellQuote(url) : '""'}`,
    `export ASKBOX_ACCESS_TOKEN=${token ? shellQuote(token) : '""'}`,
  ].join("\n");
}

function setAskboxEnvStatus(text, kind) {
  if (!askboxEnvStatus) return;
  askboxEnvStatus.textContent = text;
  askboxEnvStatus.dataset.kind = kind || "";
}

const autoUpdateEnabled = document.getElementById("auto-update-enabled");
const autoUpdateState = document.getElementById("auto-update-state");
let autoUpdateSaving = false;

function autoUpdateHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = window.__CONFIGURE_TOKEN__;
  if (token) headers["X-Configure-Token"] = token;
  return headers;
}

function renderAutoUpdateSwitch(enabled) {
  if (autoUpdateEnabled) autoUpdateEnabled.checked = Boolean(enabled);
  if (autoUpdateState) {
    autoUpdateState.textContent = enabled ? "Activo" : "Inactivo";
    autoUpdateState.dataset.kind = enabled ? "ok" : "";
  }
}

async function fetchAutoUpdateStatus() {
  try {
    const res = await fetch("/api/auto-update");
    const data = await res.json().catch(() => ({}));
    if (typeof data.enabled === "boolean") {
      renderAutoUpdateSwitch(data.enabled);
    }
    return data;
  } catch {
    return null;
  }
}

async function saveAutoUpdatePreference(enabled, opts = {}) {
  const { silent = false } = opts;
  if (autoUpdateSaving) return;
  autoUpdateSaving = true;
  renderAutoUpdateSwitch(enabled);
  if (!silent && autoUpdateState) {
    autoUpdateState.textContent = "Guardando…";
    autoUpdateState.dataset.kind = "busy";
  }
  try {
    const res = await fetch("/api/auto-update", {
      method: "POST",
      headers: autoUpdateHeaders(),
      body: JSON.stringify({ enabled: Boolean(enabled) }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && typeof data.enabled === "boolean") {
      renderAutoUpdateSwitch(data.enabled);
    } else if (!silent && autoUpdateState) {
      autoUpdateState.textContent = data.error || "No se pudo guardar";
      autoUpdateState.dataset.kind = "error";
    }
  } catch {
    if (!silent && autoUpdateState) {
      autoUpdateState.textContent = "Sin conexión";
      autoUpdateState.dataset.kind = "error";
    }
  } finally {
    autoUpdateSaving = false;
  }
}

if (autoUpdateEnabled) {
  autoUpdateEnabled.addEventListener("change", () => {
    saveAutoUpdatePreference(autoUpdateEnabled.checked);
  });
}

fetchAutoUpdateStatus();

if (askboxCopyBtn) {
  askboxCopyBtn.addEventListener("click", async () => {
    const text = buildAskboxEnvExport();
    try {
      await navigator.clipboard.writeText(text);
      setAskboxEnvStatus("Copiado.", "ok");
      setTimeout(() => setAskboxEnvStatus(""), 2000);
    } catch {
      setAskboxEnvStatus("No se pudo copiar.", "error");
    }
  });
}
