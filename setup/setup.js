function apiHeaders(json = true) {
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  const token = window.__CONFIGURE_TOKEN__;
  if (token) headers["X-Configure-Token"] = token;
  return headers;
}

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

const installList = document.getElementById("install-list");
const installEmpty = document.getElementById("install-empty");
const kitMeta = document.getElementById("kit-meta");
const installPanel = document.getElementById("install-panel");
const btnNewInstall = document.getElementById("btn-new-install");
const btnCancelInstall = document.getElementById("btn-cancel-install");

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

const askboxUrlInput = document.getElementById("askbox-api-url");
const askboxTokenInput = document.getElementById("askbox-access-token");

const browseModal = document.getElementById("browse-modal");
const browseList = document.getElementById("browse-list");
const browseCurrentPath = document.getElementById("browse-current-path");
const browseUp = document.getElementById("browse-up");
const browseUse = document.getElementById("browse-use");
const browseError = document.getElementById("browse-error");
const btnBrowse = document.getElementById("btn-browse");

let browsePath = null;

function showInstallPanel(show) {
  if (!installPanel) return;
  installPanel.classList.toggle("hidden", !show);
  if (show) {
    installPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    pathInput?.focus();
  }
}

btnNewInstall?.addEventListener("click", () => showInstallPanel(true));
btnCancelInstall?.addEventListener("click", () => showInstallPanel(false));

function setInstallFormLocked(locked) {
  if (!installForm) return;
  installForm.querySelectorAll("input, button").forEach((el) => {
    if (el.id === "install-btn" || el.type === "submit") return;
    if (locked) el.setAttribute("data-was-disabled", el.disabled ? "1" : "0");
    if (locked) el.disabled = true;
    else if (el.getAttribute("data-was-disabled") === "0") el.disabled = false;
  });
  if (btnBrowse) {
    if (locked) btnBrowse.setAttribute("data-was-disabled", btnBrowse.disabled ? "1" : "0");
    if (locked) btnBrowse.disabled = true;
    else if (btnBrowse.getAttribute("data-was-disabled") === "0") btnBrowse.disabled = false;
  }
}

function setInstallUi(state, message) {
  if (!installProgress || !installStatus) return;
  installProgress.classList.remove("hidden", "is-done", "is-error");
  installStatus.dataset.kind = "";
  if (state === "busy") {
    installStatus.textContent = message || "Instalando…";
    installStatus.dataset.kind = "busy";
    setInstallFormLocked(true);
  } else if (state === "ok") {
    installProgress.classList.add("is-done");
    installStatus.textContent = message || "Listo";
    installStatus.dataset.kind = "ok";
  } else if (state === "error") {
    installProgress.classList.add("is-error");
    installStatus.textContent = message || "Error";
    installStatus.dataset.kind = "error";
    setInstallFormLocked(false);
  }
  if (state === "ok") setInstallFormLocked(false);
}

function showLog(text, openDetails) {
  if (!installLog || !installLogDetails) return;
  installLog.textContent = text || "";
  installLogDetails.classList.toggle("hidden", !text);
  if (openDetails && text) installLogDetails.open = true;
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

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

async function loadInstallations() {
  try {
    const res = await fetch("/api/installations");
    const data = await res.json().catch(() => ({}));
    const items = data.installations || [];
    if (kitMeta && data.kit_fingerprint) {
      kitMeta.textContent = `Versión del kit en este clone: ${data.kit_fingerprint}`;
      kitMeta.classList.remove("hidden");
    }
    if (!installList) return;
    installList.innerHTML = "";
    installEmpty?.classList.toggle("hidden", items.length > 0);
    for (const row of items) {
      const li = document.createElement("li");
      li.className = "install-row";
      const status = row.status === "missing" ? "Ruta no encontrada" : "OK";
      const statusClass = row.status === "missing" ? "badge--warn" : "badge--ok";
      li.innerHTML = `
        <div class="install-row-main">
          <code class="install-path">${escapeHtml(row.path)}</code>
          <span class="badge ${statusClass}">${status}</span>
        </div>
        <div class="install-row-meta">${formatDate(row.installed_at)}</div>
        <button type="button" class="btn-ghost btn-uninstall" data-path="${escapeAttr(row.path)}">Desinstalar</button>
      `;
      installList.appendChild(li);
    }
    installList.querySelectorAll(".btn-uninstall").forEach((btn) => {
      btn.addEventListener("click", () => uninstallOne(btn.getAttribute("data-path")));
    });
  } catch {
    installEmpty?.classList.remove("hidden");
    if (installEmpty) installEmpty.textContent = "No se pudo cargar el registro.";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

async function uninstallOne(path) {
  if (!path) return;
  if (!window.confirm(`¿Quitar las piezas del orquestador en\n${path}\n(sin borrar tus *-conventions.mdc)?`)) return;

  const row = [...(installList?.querySelectorAll(".install-row") || [])].find((el) =>
    el.querySelector(".install-path")?.textContent.includes(path)
  );
  const btn = row?.querySelector(".btn-uninstall");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Quitando…";
  }

  try {
    const res = await fetch("/api/uninstall", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ path }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      window.alert(data.error || "No se pudo desinstalar.");
    }
  } catch {
    window.alert("Sin conexión con el servidor.");
  } finally {
    await loadInstallations();
  }
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

    const askboxUrl = (askboxUrlInput?.value || "").trim();
    const askboxToken = (askboxTokenInput?.value || "").trim();
    const payload = { path, flags, auto_update: autoUpdateEnabled?.checked ?? true };
    if (askboxUrl) payload.askbox_api_url = askboxUrl;
    if (askboxToken) payload.askbox_access_token = askboxToken;

    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      const log = data.log || data.error || res.statusText || "";

      if (data.ok) {
        setInstallUi("ok", "Listo");
        showLog(log, false);
        await saveAutoUpdatePreference(autoUpdateEnabled?.checked ?? true, { silent: true });
        await loadInstallations();
        showInstallPanel(false);
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
    if (data.askbox_token_configured && askboxTokenInput) {
      askboxTokenInput.setAttribute("data-server-token", "1");
      if (!askboxTokenInput.value.trim()) {
        askboxTokenInput.placeholder = "Configurado en el servidor (opcional)";
      }
    }
    syncDefaultMergeApply();
  } catch {
    syncDefaultMergeApply();
  }
}

if (askboxUrlInput) askboxUrlInput.addEventListener("input", syncDefaultMergeApply);
if (askboxTokenInput) {
  askboxTokenInput.addEventListener("input", () => {
    if (askboxTokenInput.value.trim()) askboxTokenInput.removeAttribute("data-server-token");
    syncDefaultMergeApply();
  });
}

const autoUpdateEnabled = document.getElementById("auto-update-enabled");
const autoUpdateState = document.getElementById("auto-update-state");
let autoUpdateSaving = false;

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
    if (typeof data.enabled === "boolean") renderAutoUpdateSwitch(data.enabled);
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
      headers: apiHeaders(),
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

function openBrowseModal() {
  browseModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
  loadBrowse("");
}

function closeBrowseModal() {
  browseModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function loadBrowse(path) {
  if (browseError) {
    browseError.classList.add("hidden");
    browseError.textContent = "";
  }
  if (browseList) browseList.innerHTML = '<li class="browse-loading">Cargando…</li>';
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  try {
    const res = await fetch(`/api/browse${q}`, { headers: apiHeaders(false) });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      if (browseError) {
        browseError.textContent = data.error || "No se pudo listar.";
        browseError.classList.remove("hidden");
      }
      if (browseList) browseList.innerHTML = "";
      return;
    }
    browsePath = data.path;
    if (browseCurrentPath) browseCurrentPath.textContent = data.path;
    if (browseUp) {
      browseUp.disabled = !data.parent;
      browseUp.dataset.parent = data.parent || "";
    }
    if (browseUse) browseUse.disabled = !data.selectable;
    if (!browseList) return;
    browseList.innerHTML = "";
    if (!data.entries?.length) {
      const li = document.createElement("li");
      li.className = "browse-empty";
      li.textContent = "Sin subcarpetas visibles.";
      browseList.appendChild(li);
      return;
    }
    for (const entry of data.entries) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "browse-dir";
      btn.textContent = entry.name;
      btn.addEventListener("click", () => loadBrowse(entry.path));
      li.appendChild(btn);
      browseList.appendChild(li);
    }
  } catch {
    if (browseError) {
      browseError.textContent = "Sin conexión con el servidor.";
      browseError.classList.remove("hidden");
    }
    if (browseList) browseList.innerHTML = "";
  }
}

btnBrowse?.addEventListener("click", openBrowseModal);
document.getElementById("browse-close")?.addEventListener("click", closeBrowseModal);
document.getElementById("browse-cancel")?.addEventListener("click", closeBrowseModal);
document.getElementById("browse-backdrop")?.addEventListener("click", closeBrowseModal);
browseUp?.addEventListener("click", () => {
  const parent = browseUp.dataset.parent;
  if (parent) loadBrowse(parent);
});
browseUse?.addEventListener("click", () => {
  if (browsePath && pathInput) {
    pathInput.value = browsePath;
    closeBrowseModal();
    pathInput.focus();
  }
});

loadSetupConfig();
fetchAutoUpdateStatus();
loadInstallations();
