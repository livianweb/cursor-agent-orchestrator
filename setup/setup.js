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

    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers,
        body: JSON.stringify({ path, flags }),
      });
      const data = await res.json().catch(() => ({}));
      const log = data.log || data.error || res.statusText || "";

      if (data.ok) {
        setInstallUi("ok", "Listo");
        showLog(log, false);
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

const autoUpdateSchedule = document.getElementById("auto-update-schedule");
const autoUpdateStatus = document.getElementById("auto-update-status");
const autoUpdateMeta = document.getElementById("auto-update-meta");
const autoUpdateLog = document.getElementById("auto-update-log");
const autoUpdateEnableBtn = document.getElementById("auto-update-enable-btn");
const autoUpdateDisableBtn = document.getElementById("auto-update-disable-btn");
const autoUpdateRunBtn = document.getElementById("auto-update-run-btn");

function setAutoUpdateStatus(text, kind) {
  if (!autoUpdateStatus) return;
  autoUpdateStatus.textContent = text;
  autoUpdateStatus.dataset.kind = kind || "";
}

function autoUpdateHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = window.__CONFIGURE_TOKEN__;
  if (token) headers["X-Configure-Token"] = token;
  return headers;
}

function renderAutoUpdateMeta(data) {
  if (!autoUpdateMeta || !data) return;
  const parts = [];
  parts.push(data.cron_installed ? "Cron activo." : "Cron inactivo.");
  if (Array.isArray(data.targets) && data.targets.length) {
    parts.push(`${data.targets.length} proyecto(s) registrados.`);
  }
  autoUpdateMeta.textContent = parts.join(" ");
  if (autoUpdateSchedule && data.schedule) {
    autoUpdateSchedule.value = data.schedule;
  }
}

async function fetchAutoUpdateStatus() {
  try {
    const res = await fetch("/api/auto-update");
    const data = await res.json().catch(() => ({}));
    renderAutoUpdateMeta(data);
    return data;
  } catch {
    if (autoUpdateMeta) autoUpdateMeta.textContent = "";
    return null;
  }
}

async function postAutoUpdate(action) {
  const schedule = (autoUpdateSchedule?.value || "0 6 * * *").trim();
  setAutoUpdateStatus("…", "busy");
  if (autoUpdateLog) {
    autoUpdateLog.classList.add("hidden");
    autoUpdateLog.textContent = "";
  }
  try {
    const res = await fetch("/api/auto-update", {
      method: "POST",
      headers: autoUpdateHeaders(),
      body: JSON.stringify({ action, schedule }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.log && autoUpdateLog) {
      autoUpdateLog.textContent = data.log;
      autoUpdateLog.classList.remove("hidden");
    }
    if (data.status) renderAutoUpdateMeta(data.status);
    setAutoUpdateStatus(data.ok ? "Hecho." : data.error || "Error.", data.ok ? "ok" : "error");
  } catch {
    setAutoUpdateStatus("Sin conexión.", "error");
  }
}

if (autoUpdateEnableBtn) {
  autoUpdateEnableBtn.addEventListener("click", () => postAutoUpdate("install_cron"));
}
if (autoUpdateDisableBtn) {
  autoUpdateDisableBtn.addEventListener("click", () => postAutoUpdate("remove_cron"));
}
if (autoUpdateRunBtn) {
  autoUpdateRunBtn.addEventListener("click", () => postAutoUpdate("run_now"));
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
