function apiHeaders(json = true) {
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  const token = window.__CONFIGURE_TOKEN__;
  if (token) headers["X-Configure-Token"] = token;
  return headers;
}

/** Errores API legibles (nunca volcar stderr crudo de git en alert). */
/** Misma regla que scripts/askbox_url.py: host sin path → /api; no duplicar …/api/api. */
function normalizeAskboxApiUrl(raw) {
  const text = (raw || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  try {
    const u = new URL(text);
    if (!u.protocol || !u.hostname) return text;
    const path = u.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return `${u.origin}/api`;
    if (path.endsWith("/api")) return text;
    return `${text}/api`;
  } catch {
    return text;
  }
}

function applyAskboxUrlNormalization(input) {
  if (!input) return "";
  const normalized = normalizeAskboxApiUrl(input.value);
  if (normalized && normalized !== input.value.trim()) {
    input.value = normalized;
  }
  return normalized || (input.value || "").trim();
}

function formatServerError(data, fallback) {
  const msg = (data?.user_error || data?.error || "").trim();
  if (!msg) return fallback || "Operación fallida.";
  const lower = msg.toLowerCase();
  if (lower.includes("would be overwritten by merge") || lower.includes("please commit your changes")) {
    return (
      "No se pudo actualizar el kit: el clone del orquestador tiene cambios locales sin commitear. " +
      "Alinea el directorio en el servidor (commit, stash o reset) y usa «Actualizar kit» en el banner."
    );
  }
  return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
}

function formatInstallSyncError(data) {
  const msg = formatServerError(data, "No se pudo sincronizar la instalación.");
  const lower = msg.toLowerCase();
  if (lower.includes("orchestrator-auto-update") || lower.includes("git pull")) {
    return (
      "Ese error corresponde a la actualización del kit (git), no a la sincronización del proyecto. " +
      "Usa «Actualizar kit» en el banner superior o alinea el clone en el servidor."
    );
  }
  if (msg.length > 280) {
    return "La sincronización no terminó bien. Revisa los logs del panel (install.sh en el servidor).";
  }
  return msg;
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
const mergeFlags = installForm?.querySelectorAll('input[value="--merge-apply"]');

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
  if (flags.includes("--force") && flags.includes("--merge-apply")) {
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

function formatAskboxRow(row) {
  const url = (row.askbox_api_url || "").trim();
  const last4 = row.askbox_token_last4;
  if (!url && !last4) return "Askbox: sin askbox";
  let text = url ? `Askbox: ${url}` : "Askbox: (sin URL)";
  if (last4) text += ` · ••••${last4}`;
  else if (url) text += " · sin token registrado";
  return text;
}

const kitUpdateBanner = document.getElementById("kit-update-banner");
const kitUpdateDetail = document.getElementById("kit-update-detail");
const kitUptodate = document.getElementById("kit-uptodate");
const btnKitUpdate = document.getElementById("btn-kit-update");

const editModal = document.getElementById("edit-modal");
const editPathEl = document.getElementById("edit-path");
const editForm = document.getElementById("edit-form");
const editAskboxUrl = document.getElementById("edit-askbox-url");
const editAskboxToken = document.getElementById("edit-askbox-token");
const editReapply = document.getElementById("edit-reapply");
const editError = document.getElementById("edit-error");
let editTargetPath = null;
let installationItems = [];
let serverAskboxTokenConfigured = false;

const syncModal = document.getElementById("sync-modal");
const syncPathEl = document.getElementById("sync-path");
const syncTokenField = document.getElementById("sync-token-field");
const syncAskboxToken = document.getElementById("sync-askbox-token");
const syncError = document.getElementById("sync-error");
const btnSyncAll = document.getElementById("btn-sync-all");
let syncTargetPath = null;
let syncTargetRow = null;

function syncNeedsToken(row) {
  const url = (row?.askbox_api_url || "").trim();
  const last4 = row?.askbox_token_last4;
  return Boolean(url && last4 && !serverAskboxTokenConfigured);
}

async function postInstallationSync(path, token) {
  const payload = { path };
  if (token) payload.askbox_access_token = token;
  const res = await fetch("/api/installations/sync", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function runInstallationSync(path, token, uiBtn) {
  if (uiBtn) {
    uiBtn.disabled = true;
    const prev = uiBtn.textContent;
    uiBtn.textContent = "Actualizando…";
    try {
      const { res, data } = await postInstallationSync(path, token);
      if (res.status === 428 || data.needs_token) {
        const row = installationItems.find((r) => r.path === path);
        if (row) openSyncModal(row, { forceToken: true });
        else window.alert(data.error || "Se necesita el token askbox.");
        return false;
      }
      if (!data.ok) {
        window.alert(formatInstallSyncError(data));
        return false;
      }
      await loadInstallations();
      return true;
    } catch {
      window.alert("Sin conexión con el servidor.");
      return false;
    } finally {
      uiBtn.disabled = false;
      uiBtn.textContent = prev;
    }
  }
  return false;
}

function openSyncModal(row, opts = {}) {
  const { forceToken = false } = opts;
  syncTargetPath = row.path;
  syncTargetRow = row;
  if (syncPathEl) syncPathEl.textContent = row.path;
  if (syncAskboxToken) {
    syncAskboxToken.value = "";
    syncAskboxToken.placeholder = row.askbox_token_last4
      ? `Token (••••${row.askbox_token_last4})`
      : "Token askbox";
  }
  const showToken = forceToken || syncNeedsToken(row);
  syncTokenField?.classList.toggle("hidden", !showToken);
  if (syncError) {
    syncError.classList.add("hidden");
    syncError.textContent = "";
  }
  syncModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
  (showToken ? syncAskboxToken : document.getElementById("sync-run"))?.focus();
}

function closeSyncModal() {
  syncModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  syncTargetPath = null;
  syncTargetRow = null;
}

document.getElementById("sync-close")?.addEventListener("click", closeSyncModal);
document.getElementById("sync-cancel")?.addEventListener("click", closeSyncModal);
document.getElementById("sync-backdrop")?.addEventListener("click", closeSyncModal);

document.getElementById("sync-run")?.addEventListener("click", async () => {
  if (!syncTargetPath) return;
  const token = (syncAskboxToken?.value || "").trim();
  if (syncNeedsToken(syncTargetRow) && !token) {
    if (syncError) {
      syncError.textContent = "Introduce el token askbox para fusionar con askbox.";
      syncError.classList.remove("hidden");
    }
    return;
  }
  const btn = document.getElementById("sync-run");
  if (btn) btn.disabled = true;
  try {
    const { res, data } = await postInstallationSync(syncTargetPath, token || undefined);
    if (res.status === 428 || data.needs_token) {
      syncTokenField?.classList.remove("hidden");
      if (syncError) {
        syncError.textContent = data.error || "Se necesita el token askbox.";
        syncError.classList.remove("hidden");
      }
      return;
    }
    if (!data.ok) {
      if (syncError) {
        syncError.textContent = data.error || "Error al actualizar.";
        syncError.classList.remove("hidden");
      }
      return;
    }
    closeSyncModal();
    await loadInstallations();
  } catch {
    if (syncError) {
      syncError.textContent = "Sin conexión con el servidor.";
      syncError.classList.remove("hidden");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
});

async function syncOneRow(row, btn) {
  if (row.status === "missing") {
    window.alert("La ruta del proyecto no existe en el disco.");
    return;
  }
  if (syncNeedsToken(row)) {
    openSyncModal(row);
    return;
  }
  if (!window.confirm(`¿Sincronizar el orquestador en\n${row.path}?\n(solo install.sh en ese proyecto, no actualiza el kit)`)) return;
  await runInstallationSync(row.path, undefined, btn);
}

btnSyncAll?.addEventListener("click", async () => {
  const okRows = installationItems.filter((r) => r.status === "ok");
  if (!okRows.length) {
    window.alert("No hay instalaciones válidas para actualizar.");
    return;
  }
  const needsAnyToken = okRows.some((r) => syncNeedsToken(r));
  if (needsAnyToken) {
    window.alert(
      "Algunas instalaciones necesitan token askbox en el servidor (ASKBOX_ACCESS_TOKEN) o actualízalas una a una."
    );
    return;
  }
  if (!window.confirm(`¿Actualizar ${okRows.length} instalación(es)?`)) return;
  btnSyncAll.disabled = true;
  const prev = btnSyncAll.textContent;
  btnSyncAll.textContent = "Actualizando…";
  try {
    const res = await fetch("/api/installations/sync", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ all: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok && !data.results?.length) {
      window.alert(formatInstallSyncError(data));
      return;
    }
    const failed = (data.results || []).filter((r) => !r.ok && !r.skipped);
    if (failed.length) {
      window.alert(`${failed.length} instalación(es) fallaron. Revisa los logs del servidor.`);
    }
    await loadInstallations();
  } catch {
    window.alert("Sin conexión con el servidor.");
  } finally {
    btnSyncAll.disabled = false;
    btnSyncAll.textContent = prev;
  }
});

function renderKitStatus(data) {
  if (!data?.ok) {
    kitUpdateBanner?.classList.add("hidden");
    kitUptodate?.classList.add("hidden");
    return;
  }
  if (data.updates_available) {
    kitUpdateBanner?.classList.remove("hidden");
    kitUptodate?.classList.add("hidden");
    if (kitUpdateDetail) {
      const local = data.local_sha || "—";
      const remote = data.remote_sha || "—";
      kitUpdateDetail.textContent = `${data.branch || "rama"}: local ${local} → remoto ${remote} (${data.behind || 0} commit(s) pendiente(s))`;
    }
    if (btnKitUpdate) btnKitUpdate.disabled = false;
  } else {
    kitUpdateBanner?.classList.add("hidden");
    if (kitUptodate && data.local_sha) {
      kitUptodate.textContent = `Kit al día · ${data.local_sha}`;
      kitUptodate.classList.remove("hidden");
    } else {
      kitUptodate?.classList.add("hidden");
    }
  }
  if (kitMeta && data.kit_fingerprint) {
    kitMeta.textContent = `Versión del kit en este clone: ${data.kit_fingerprint} (${data.local_sha || "?"})`;
    kitMeta.classList.remove("hidden");
  }
}

async function loadKitStatus() {
  try {
    const res = await fetch("/api/kit-update?fetch=1");
    const data = await res.json().catch(() => ({}));
    renderKitStatus(data);
    return data;
  } catch {
    kitUpdateBanner?.classList.add("hidden");
    return null;
  }
}

async function runKitUpdate() {
  if (!btnKitUpdate) return;
  btnKitUpdate.disabled = true;
  const prev = btnKitUpdate.textContent;
  btnKitUpdate.textContent = "Actualizando…";
  try {
    const res = await fetch("/api/kit-update", { method: "POST", headers: apiHeaders() });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      renderKitStatus({ ...data, ok: true, updates_available: data.updates_available });
      await loadInstallations();
      if (data.panel_restart_recommended) {
        window.alert(
          "Kit actualizado. Reinicia el contenedor del panel para cargar el código nuevo:\n" +
            "docker compose restart orchestrator-panel"
        );
      }
    } else {
      window.alert(formatServerError(data, "No se pudo actualizar el kit."));
      await loadKitStatus();
    }
  } catch {
    window.alert("Sin conexión con el servidor.");
  } finally {
    btnKitUpdate.textContent = prev;
    btnKitUpdate.disabled = false;
  }
}

btnKitUpdate?.addEventListener("click", runKitUpdate);

function openEditModal(row) {
  editTargetPath = row.path;
  if (editPathEl) editPathEl.textContent = row.path;
  if (editAskboxUrl) {
    editAskboxUrl.value = normalizeAskboxApiUrl(row.askbox_api_url || "");
  }
  if (editAskboxToken) {
    editAskboxToken.value = "";
    editAskboxToken.placeholder = row.askbox_token_last4
      ? `••••${row.askbox_token_last4} (deja vacío para mantener)`
      : "Nuevo token (opcional)";
  }
  if (editReapply) editReapply.checked = false;
  if (editError) {
    editError.classList.add("hidden");
    editError.textContent = "";
  }
  editModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
  editAskboxUrl?.focus();
}

function closeEditModal() {
  editModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  editTargetPath = null;
}

document.getElementById("edit-close")?.addEventListener("click", closeEditModal);
document.getElementById("edit-cancel")?.addEventListener("click", closeEditModal);
document.getElementById("edit-backdrop")?.addEventListener("click", closeEditModal);

editForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!editTargetPath) return;
  const askboxUrl = applyAskboxUrlNormalization(editAskboxUrl);
  const payload = {
    path: editTargetPath,
    askbox_api_url: askboxUrl,
  };
  const token = (editAskboxToken?.value || "").trim();
  if (token) payload.askbox_access_token = token;
  if (editReapply?.checked) payload.reapply = true;

  if (editError) {
    editError.classList.add("hidden");
    editError.textContent = "";
  }
  const saveBtn = document.getElementById("edit-save");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";
  }
  try {
    const res = await fetch("/api/installations", {
      method: "PATCH",
      headers: apiHeaders(),
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      if (editError) {
        const hint =
          res.status === 501
            ? "El panel no admite PATCH (reinicia el contenedor orchestrator-panel)."
            : `HTTP ${res.status}`;
        editError.textContent = hint;
        editError.classList.remove("hidden");
      }
      return;
    }
    if (!data.ok) {
      if (editError) {
        const msg = data.error || (res.status >= 400 ? `HTTP ${res.status}` : "No se pudo guardar.");
        editError.textContent = msg;
        editError.classList.remove("hidden");
      }
      return;
    }
    if (data.reapply_error) {
      closeEditModal();
      await loadInstallations();
      if (kitUptodate) {
        kitUptodate.textContent = `Metadatos guardados. Re-aplicación: ${data.reapply_error}`;
        kitUptodate.classList.remove("hidden");
      }
      return;
    }
    closeEditModal();
    await loadInstallations();
  } catch {
    if (editError) {
      editError.textContent = "Sin conexión con el servidor.";
      editError.classList.remove("hidden");
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar";
    }
  }
});

async function loadInstallations() {
  try {
    const res = await fetch("/api/installations");
    const data = await res.json().catch(() => ({}));
    const items = data.installations || [];
    installationItems = items;
    btnSyncAll?.classList.toggle("hidden", items.filter((r) => r.status === "ok").length < 2);
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
        <div class="install-row-askbox">${escapeHtml(formatAskboxRow(row))}</div>
        <div class="install-row-meta">${formatDate(row.installed_at)}</div>
        <div class="install-row-actions">
          <button type="button" class="btn-ghost btn-sync" data-action="installation-sync" title="Re-ejecutar install.sh solo en este proyecto" data-path="${escapeAttr(row.path)}"${row.status === "missing" ? " disabled" : ""}>Sincronizar</button>
          <button type="button" class="btn-ghost btn-edit" data-path="${escapeAttr(row.path)}">Editar</button>
          <button type="button" class="btn-ghost btn-uninstall" data-path="${escapeAttr(row.path)}">Desinstalar</button>
        </div>
      `;
      installList.appendChild(li);
    }
    installList.querySelectorAll(".btn-uninstall").forEach((btn) => {
      btn.addEventListener("click", () => uninstallOne(btn.getAttribute("data-path")));
    });
    installList.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const path = btn.getAttribute("data-path");
        const row = items.find((r) => r.path === path);
        if (row) openEditModal(row);
      });
    });
    installList.querySelectorAll(".btn-sync[data-action='installation-sync']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const path = btn.getAttribute("data-path");
        const row = items.find((r) => r.path === path);
        if (row) syncOneRow(row, btn);
      });
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

    const askboxUrl = applyAskboxUrlNormalization(askboxUrlInput);
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
  mergeApplyFlag.checked = isAskboxComplete();
}

async function loadSetupConfig() {
  try {
    const res = await fetch("/api/setup-config");
    const data = await res.json().catch(() => ({}));
    serverAskboxTokenConfigured = Boolean(data.askbox_token_configured);
    if (data.askbox_api_url && askboxUrlInput && !askboxUrlInput.value.trim()) {
      askboxUrlInput.value = normalizeAskboxApiUrl(data.askbox_api_url);
    }
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

if (askboxUrlInput) {
  askboxUrlInput.addEventListener("blur", () => applyAskboxUrlNormalization(askboxUrlInput));
  askboxUrlInput.addEventListener("input", syncDefaultMergeApply);
}
if (editAskboxUrl) {
  editAskboxUrl.addEventListener("blur", () => applyAskboxUrlNormalization(editAskboxUrl));
}
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
    if (typeof data.enabled === "boolean") {
      renderAutoUpdateSwitch(data.enabled);
    } else {
      renderAutoUpdateSwitch(true);
    }
    return data;
  } catch {
    renderAutoUpdateSwitch(true);
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
loadKitStatus();
loadInstallations();
