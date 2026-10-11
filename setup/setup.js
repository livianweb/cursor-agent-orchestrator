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
const installLogWrap = document.getElementById("install-log-wrap");
const installLog = document.getElementById("install-log");
const pathInput = document.getElementById("project-path");
const forceFlag = document.getElementById("flag-force");
const mergeFlags = installForm?.querySelectorAll('input[value="--merge"], input[value="--merge-apply"]');

function setStatus(text, kind) {
  if (!installStatus) return;
  installStatus.textContent = text;
  installStatus.dataset.kind = kind || "";
}

function collectFlags() {
  if (!installForm) return [];
  const flags = [];
  installForm.querySelectorAll('input[name="flag"]:checked').forEach((el) => {
    flags.push(el.value);
  });
  if (flags.includes("--force") && (flags.includes("--merge") || flags.includes("--merge-apply"))) {
    throw new Error("--force no se puede combinar con fusión askbox.");
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
      setStatus("Indica una ruta absoluta.", "error");
      pathInput?.focus();
      return;
    }
    if (!path.startsWith("/")) {
      setStatus("La ruta debe ser absoluta (empezar por /).", "error");
      pathInput?.focus();
      return;
    }

    let flags;
    try {
      flags = collectFlags();
    } catch (err) {
      setStatus(err.message || "Opciones inválidas.", "error");
      return;
    }

    installBtn.disabled = true;
    setStatus("Instalando…", "busy");
    if (installLogWrap) installLogWrap.classList.add("hidden");
    if (installLog) installLog.textContent = "";

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
      const log = data.log || "";
      if (installLog) installLog.textContent = log || data.error || res.statusText;
      if (installLogWrap) installLogWrap.classList.remove("hidden");

      if (data.ok) {
        setStatus("Instalación completada.", "ok");
      } else {
        const msg = data.error || `Error (código ${data.exit_code ?? res.status})`;
        setStatus(msg, "error");
      }
    } catch {
      setStatus(
        "No se pudo contactar con el servidor. ¿Está ./install.sh en marcha en este host?",
        "error"
      );
    } finally {
      installBtn.disabled = false;
    }
  });
}

const askboxUrlInput = document.getElementById("askbox-api-url");
const askboxTokenInput = document.getElementById("askbox-access-token");
const askboxEnvPreview = document.getElementById("askbox-env-preview");
const askboxCopyBtn = document.getElementById("askbox-copy-env");
const askboxEnvStatus = document.getElementById("askbox-env-status");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildAskboxEnvExport() {
  const url = (askboxUrlInput?.value || "").trim();
  const token = (askboxTokenInput?.value || "").trim();
  const lines = [
    "# En ~/.bashrc, profile de Cursor, o env del agente:",
    `export ASKBOX_API_URL=${url ? shellQuote(url) : '""'}`,
    `export ASKBOX_ACCESS_TOKEN=${token ? shellQuote(token) : '""'}`,
  ];
  return lines.join("\n");
}

function refreshAskboxEnvPreview() {
  if (askboxEnvPreview) {
    askboxEnvPreview.textContent = buildAskboxEnvExport();
  }
}

function setAskboxEnvStatus(text, kind) {
  if (!askboxEnvStatus) return;
  askboxEnvStatus.textContent = text;
  askboxEnvStatus.dataset.kind = kind || "";
}

if (askboxUrlInput || askboxTokenInput) {
  ["input", "change"].forEach((ev) => {
    askboxUrlInput?.addEventListener(ev, refreshAskboxEnvPreview);
    askboxTokenInput?.addEventListener(ev, refreshAskboxEnvPreview);
  });
  refreshAskboxEnvPreview();
}

const autoUpdateSchedule = document.getElementById("auto-update-schedule");
const autoUpdateStatus = document.getElementById("auto-update-status");
const autoUpdateMeta = document.getElementById("auto-update-meta");
const autoUpdateLog = document.getElementById("auto-update-log");
const autoUpdateEnableBtn = document.getElementById("auto-update-enable-btn");
const autoUpdateDisableBtn = document.getElementById("auto-update-disable-btn");
const autoUpdateRunBtn = document.getElementById("auto-update-run-btn");
const autoUpdateCopyCronBtn = document.getElementById("auto-update-copy-cron-btn");

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
  if (data.cron_installed) {
    parts.push(`Cron activo (${data.schedule || "0 6 * * *"}).`);
  } else {
    parts.push("Cron no instalado en este usuario.");
  }
  if (Array.isArray(data.targets) && data.targets.length) {
    parts.push(`${data.targets.length} proyecto(s) en orchestrator-targets.`);
  } else {
    parts.push("Sin targets: solo se actualizará el clone del kit.");
  }
  if (!data.crontab_available) {
    parts.push("crontab no disponible — usa «Copiar línea cron».");
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
    if (autoUpdateMeta) {
      autoUpdateMeta.textContent = "No se pudo leer el estado (¿servidor del wizard en marcha?).";
    }
    return null;
  }
}

async function postAutoUpdate(action) {
  const schedule = (autoUpdateSchedule?.value || "0 6 * * *").trim();
  setAutoUpdateStatus("Ejecutando…", "busy");
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
    if (data.ok) {
      setAutoUpdateStatus(action === "run_now" ? "Actualización completada." : "Hecho.", "ok");
    } else {
      setAutoUpdateStatus(data.error || "Error en la operación.", "error");
    }
  } catch {
    setAutoUpdateStatus("Sin conexión con el wizard.", "error");
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
if (autoUpdateCopyCronBtn) {
  autoUpdateCopyCronBtn.addEventListener("click", async () => {
    const data = await fetchAutoUpdateStatus();
    const line = data?.cron_line || `${(autoUpdateSchedule?.value || "0 6 * * *").trim()} ORCHESTRATOR_AUTO_UPDATE=1 …/scripts/auto-update-kit.sh`;
    try {
      await navigator.clipboard.writeText(line);
      setAutoUpdateStatus("Línea cron copiada.", "ok");
    } catch {
      setAutoUpdateStatus("Copia manualmente desde docs/auto-update.md", "error");
    }
  });
}

fetchAutoUpdateStatus();

if (askboxCopyBtn) {
  askboxCopyBtn.addEventListener("click", async () => {
    const text = buildAskboxEnvExport();
    try {
      await navigator.clipboard.writeText(text);
      setAskboxEnvStatus("Copiado al portapapeles.", "ok");
      setTimeout(() => setAskboxEnvStatus(""), 2000);
    } catch {
      setAskboxEnvStatus("Selecciona el bloque y copia manualmente.", "error");
    }
  });
}
