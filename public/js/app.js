/**
 * MAY HARVEST CORPORATION - PRODUCT QUEUING & BLAST FREEZING MANAGEMENT SYSTEM
 * Production Frontend Application (Connects to Turso Edge Cloud / Backend API)
 */

// =============================================================================
// STATE & CONFIGURATION
// =============================================================================
let currentScreen = "blastInventory";
let inventoryList = [];
let queueList = [];
let historyList = [];
let systemStatus = { database: "Connecting...", isCloud: false };
let activeModalQueueId = null;
let pollTimer = null;

// =============================================================================
// UTILITY HELPERS
// =============================================================================
function escapeHTML(v) {
  if (v === undefined || v === null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatUnit(u) {
  if (!u) return "";
  const s = String(u).trim();
  return s.toLowerCase() === "cases" ? "crates" : s;
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "toast-error" : type === "warning" ? "toast-warning" : ""}`;
  toast.innerHTML = `<span>${escapeHTML(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function todayDateStr() {
  const now = new Date();
  return (
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
}

function normDateStr(v) {
  const t = String(v || "").trim();
  if (!t) return "";
  let m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return t;
}

function normProd(v) {
  return String(v || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatDurationMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

function calcTvDuration(startIso) {
  if (!startIso) return "";
  const ms = Date.now() - new Date(startIso).getTime();
  return Number.isFinite(ms) && ms >= 0 ? formatDurationMs(ms) : "";
}

function calcTotalBlastDuration(truck) {
  let start = truck.blast_start_timestamp ? new Date(truck.blast_start_timestamp) : null;
  let end = truck.blast_end_timestamp ? new Date(truck.blast_end_timestamp) : null;
  if (!start || !end || isNaN(start) || isNaN(end)) {
    const acts = truck.blastActivities || [];
    const bAct = acts.find((a) => a.name === "Blast Freezing") || acts[3];
    if (bAct && bAct.start && bAct.end) {
      start = new Date(bAct.start);
      end = new Date(bAct.end);
    }
  }
  if (!start || !end || isNaN(start) || isNaN(end) || end < start) return "";
  return formatDurationMs(end - start);
}

function formatDateTimeLocal(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}`;
}

function formatDownloadDateTime(dateVal) {
  if (!dateVal) return "—";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) {
    return String(dateVal);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const mins = String(d.getMinutes()).padStart(2, "0");
  const secs = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${String(hours).padStart(2, "0")}:${mins}:${secs} ${ampm}`;
}

function calcFreezingDuration(startTs, endTs, status) {
  if (!startTs) return "—";
  const start = new Date(startTs);
  if (isNaN(start.getTime())) return "—";

  const end = endTs ? new Date(endTs) : new Date();
  if (isNaN(end.getTime())) return "—";

  const diffMs = end - start;
  if (diffMs < 0) return "0m";

  const totalMins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const durStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

  if (endTs || status === "Completed" || status === "Harvested") {
    return durStr;
  }
  return `${durStr} (Freezing in Progress)`;
}

function parseActivityDuration(start, end) {
  if (!start) return "—";
  const startDate = new Date(start);
  if (isNaN(startDate.getTime())) return "—";

  const endDate = end ? new Date(end) : new Date();
  if (isNaN(endDate.getTime())) return "—";

  const ms = endDate - startDate;
  if (!Number.isFinite(ms) || ms < 0) return "0m";
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  const timeStr = hrs > 0 ? `${hrs}h ${m}m` : `${m}m`;
  return end ? timeStr : `${timeStr} (Ongoing)`;
}

// =============================================================================
// API DATA SYNC
// =============================================================================
async function syncSystemStatus() {
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      systemStatus = await res.json();
      const pill = document.getElementById("cloudStatusPill");
      if (pill) {
        pill.innerHTML = `<span class="cloud-dot"></span> ${escapeHTML(systemStatus.database)}`;
      }
    }
  } catch (e) {
    const pill = document.getElementById("cloudStatusPill");
    if (pill) {
      pill.innerHTML = `<span class="cloud-dot" style="background:#f59e0b;box-shadow:none;"></span> Offline Sync Mode`;
    }
  }
}

async function fetchInventory() {
  try {
    const res = await fetch("/api/inventory");
    if (res.ok) {
      inventoryList = await res.json();
      renderBlastInventory();
    }
  } catch (err) {
    console.error("fetchInventory error:", err);
  }
}

async function fetchHistory() {
  try {
    const res = await fetch("/api/inventory/history");
    if (res.ok) {
      historyList = await res.json();
      renderBlastHistory();
    }
  } catch (err) {
    console.error("fetchHistory error:", err);
  }
}

let lastQueueJson = "";

async function fetchQueues() {
  try {
    const res = await fetch("/api/queues");
    if (res.ok) {
      const newData = await res.json();
      const newJson = JSON.stringify(newData);
      const isDataChanged = newJson !== lastQueueJson;
      queueList = newData;
      lastQueueJson = newJson;

      const activeEl = document.activeElement;
      const isUserEditingAlloc =
        activeEl &&
        (activeEl.id?.startsWith("alloc_") ||
          activeEl.id?.startsWith("blastSel_") ||
          activeEl.id === "searchInput");

      // Don't reconstruct the table DOM if data hasn't changed and user is typing or picking in alloc inputs
      if (isDataChanged || !isUserEditingAlloc) {
        renderQueue();
      }

      updateStats();
      renderTempPanel();
      if (currentScreen === "liveBoard") {
        renderLiveBlastBoard();
      }
    }
  } catch (err) {
    console.error("fetchQueues error:", err);
  }
}

async function refreshAllData() {
  await Promise.all([syncSystemStatus(), fetchInventory(), fetchHistory(), fetchQueues()]);
}

// =============================================================================
// NAVIGATION & SCREEN SWITCHING
// =============================================================================
function showScreen(screenId, btn) {
  currentScreen = screenId;
  document.querySelectorAll(".screen").forEach((sc) => sc.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");

  if (screenId === "dashboard") {
    renderQueue();
    updateStats();
    renderTempPanel();
  } else if (screenId === "liveBoard") {
    renderLiveBlastBoard();
  } else if (screenId === "reports") {
    updateReportSummary();
  }
}

// =============================================================================
// BLAST INVENTORY & LOG
// =============================================================================
function renderBlastInventory() {
  const tbody = document.getElementById("blastInventoryRows");
  const empty = document.getElementById("blastInventoryEmpty");
  const sumBox = document.getElementById("blastInventorySummary");
  if (!tbody) return;

  if (inventoryList.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (sumBox) sumBox.innerHTML = "";
    return;
  }

  if (empty) empty.style.display = "none";
  tbody.innerHTML = inventoryList
    .map(
      (r) => `
    <tr>
      <td style="font-weight:700;">${escapeHTML(r.production_date || r.date || "—")}</td>
      <td style="white-space:nowrap;color:#64748b;">${escapeHTML(new Date(r.created_at).toLocaleString())}</td>
      <td style="font-weight:800;color:#0f172a;">${escapeHTML(r.product)}</td>
      <td style="font-weight:800;color:#15803d;">${Number(r.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHTML(formatUnit(r.unit))}</td>
      <td><span class="badge" style="background:#f1f5f9;color:#334155;">${escapeHTML(r.category || "Uncategorized")}</span></td>
      <td>
        <button type="button" class="btn-outline" style="color:#dc2626;padding:5px 10px;" onclick="deleteInventoryItem(${r.id})">
          Delete
        </button>
      </td>
    </tr>
  `
    )
    .join("");

  // Summary Totals by unit
  const totals = {};
  inventoryList.forEach((r) => {
    const u = formatUnit(r.unit || "kg");
    totals[u] = (totals[u] || 0) + parseFloat(r.volume || 0);
  });

  if (sumBox) {
    sumBox.innerHTML =
      `<div style="background:#eff6ff;padding:12px 18px;border-radius:10px;border:1px solid #bfdbfe;">
        <strong style="font-size:18px;color:#1e40af;">${inventoryList.length}</strong><br>
        <span style="font-size:12px;color:#3b82f6;font-weight:700;">Inventory Lots</span>
      </div>` +
      Object.entries(totals)
        .map(
          ([unit, total]) => `
        <div style="background:#f0fdf4;padding:12px 18px;border-radius:10px;border:1px solid #bbf7d0;">
          <strong style="font-size:18px;color:#15803d;">${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHTML(formatUnit(unit))}</strong><br>
          <span style="font-size:12px;color:#16a34a;font-weight:700;">Total Available</span>
        </div>
      `
        )
        .join("");
  }

  renderCategoryInventoryBoard();
}

function renderCategoryInventoryBoard() {
  const board = document.getElementById("blastCategoryInventoryBoard");
  const empty = document.getElementById("blastCategoryInventoryEmpty");
  if (!board) return;

  const categoryGroups = {};
  inventoryList.forEach((r) => {
    const cat = r.category || "Uncategorized";
    const prod = r.product.trim();
    const unit = formatUnit(r.unit || "kg");
    const pDate = r.production_date || "—";
    const key = `${prod.toLowerCase()}||${unit.toLowerCase()}||${pDate}`;

    if (!categoryGroups[cat]) categoryGroups[cat] = {};
    if (!categoryGroups[cat][key]) {
      categoryGroups[cat][key] = { product: prod, unit, volume: 0, productionDate: pDate };
    }
    categoryGroups[cat][key].volume += parseFloat(r.volume || 0);
  });

  const catNames = Object.keys(categoryGroups);
  if (catNames.length === 0) {
    board.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";
  board.innerHTML = catNames
    .map((cat) => {
      const items = Object.values(categoryGroups[cat]).sort((a, b) =>
        a.productionDate.localeCompare(b.productionDate)
      );
      const catTotal = items.reduce((acc, it) => acc + it.volume, 0);
      const unit = formatUnit(items[0]?.unit || "kg");

      return `
      <div style="background:#fff;border:1px solid #fed7aa;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:14px;font-weight:900;color:#c2410c;letter-spacing:0.5px;">${escapeHTML(cat).toUpperCase()}</div>
          <span style="font-size:12px;font-weight:800;color:#9a3412;">${catTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHTML(unit)}</span>
        </div>
        <div style="font-size:12px;border-top:1px dashed #fed7aa;padding-top:8px;">
          ${items
            .map(
              (it) => `
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #fff7ed;">
              <span style="font-weight:700;">${escapeHTML(it.product)} <small style="color:#64748b;">(${escapeHTML(it.productionDate)})</small></span>
              <span style="font-weight:800;color:#15803d;">${it.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHTML(formatUnit(it.unit))}</span>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;
    })
    .join("");
}

function renderBlastHistory() {
  const tbody = document.getElementById("blastInventoryHistoryRows");
  const empty = document.getElementById("blastInventoryHistoryEmpty");
  if (!tbody) return;

  if (historyList.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";
  tbody.innerHTML = historyList
    .map(
      (h) => `
    <tr>
      <td style="white-space:nowrap;color:#64748b;">${escapeHTML(new Date(h.timestamp).toLocaleString())}</td>
      <td style="font-weight:800;color:${h.type === "DEDUCTION" ? "#d97706" : "#15803d"};">
        ${h.type === "DEDUCTION" ? "📉 Deducted" : "📦 Registered"}
      </td>
      <td style="font-weight:700;">${escapeHTML(h.product)}</td>
      <td style="font-weight:800;">
        ${h.type === "DEDUCTION" ? "−" : "+"}${Number(h.volume || 0).toLocaleString()} ${escapeHTML(h.unit)}
      </td>
      <td style="font-weight:800;color:#0f172a;">${Number(h.remaining || 0).toLocaleString()} ${escapeHTML(h.unit)}</td>
      <td>${escapeHTML(h.queue || h.shift || "—")}</td>
      <td style="color:#64748b;font-size:12px;">${escapeHTML(h.details || "—")}</td>
    </tr>
  `
    )
    .join("");
}

async function deleteInventoryItem(id) {
  if (!confirm("Are you sure you want to delete this inventory record?")) return;
  try {
    const res = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    if (res.ok) {
      showToast("Inventory record deleted.");
      await fetchInventory();
      await fetchHistory();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to delete item", "error");
    }
  } catch (err) {
    showToast("Server communication error", "error");
  }
}

async function resetBlastInventory() {
  if (!confirm("WARNING: This will clear ALL Blast Inventory and Movement History. Continue?")) return;
  try {
    const res = await fetch("/api/inventory/reset", { method: "POST" });
    if (res.ok) {
      showToast("Inventory cleared successfully.");
      await fetchInventory();
      await fetchHistory();
    }
  } catch (e) {
    showToast("Error resetting inventory", "error");
  }
}

// =============================================================================
// PRODUCT QUEUING REGISTRATION
// =============================================================================
function addProductEntryRow() {
  const container = document.getElementById("productEntries");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "product-entry";
  div.innerHTML = `
    <div class="form-group">
      <label>Product *</label>
      <input class="product-name" type="text" placeholder="e.g. HJAC, CCM, MDS" required autocomplete="off">
    </div>
    <div class="form-group">
      <label>Volume *</label>
      <input class="product-volume" type="text" placeholder="e.g. 5,000 kg" required autocomplete="off">
    </div>
    <div class="form-group">
      <label>Product Temp (°C) *</label>
      <input class="product-temperature" type="number" step="0.1" placeholder="4.0" required>
    </div>
    <div class="form-group">
      <label>Production Date *</label>
      <input class="product-production-date" type="date" required>
    </div>
    <button class="btn-outline remove-product-btn" type="button" onclick="this.closest('.product-entry').remove(); updateProductRemoveButtons();" style="height:42px;color:#dc2626;">
      Remove
    </button>
  `;
  container.appendChild(div);
  updateProductRemoveButtons();
}

function updateProductRemoveButtons() {
  const rows = document.querySelectorAll("#productEntries .product-entry");
  rows.forEach((r) => {
    const btn = r.querySelector(".remove-product-btn");
    if (btn) btn.style.display = rows.length > 1 ? "inline-flex" : "none";
  });
}

function checkProductProductionDate(row) {
  if (!row) return false;
  const prodInput = row.querySelector(".product-name");
  const dateInput = row.querySelector(".product-production-date");
  if (!prodInput || !dateInput) return false;

  const pName = prodInput.value.trim();
  const pDate = dateInput.value;
  let msg = row.querySelector(".production-date-message");
  if (!msg) {
    msg = document.createElement("small");
    msg.className = "production-date-message";
    msg.style.cssText = "display:block;margin-top:4px;font-weight:700;";
    dateInput.insertAdjacentElement("afterend", msg);
  }

  if (!pName || !pDate) {
    msg.textContent = "";
    return false;
  }

  const matching = inventoryList.filter(
    (st) =>
      normProd(st.product) === normProd(pName) &&
      normDateStr(st.production_date) === normDateStr(pDate) &&
      parseFloat(st.volume) > 0
  );
  const available = matching.reduce((sum, st) => sum + parseFloat(st.volume || 0), 0);

  if (matching.length === 0 || available <= 0) {
    const otherDates = [
      ...new Set(
        inventoryList
          .filter((st) => normProd(st.product) === normProd(pName) && parseFloat(st.volume) > 0)
          .map((st) => st.production_date)
      ),
    ];
    msg.textContent = `⚠ No stock for this date. Available dates for ${pName}: ${otherDates.join(", ") || "None"}`;
    msg.style.color = "#dc2626";
    dateInput.setCustomValidity("No available product for this Production Date.");
    return false;
  }

  msg.textContent = `✓ Available in Blast Inventory: ${available.toLocaleString()} ${matching[0].unit || "kg"}`;
  msg.style.color = "#15803d";
  dateInput.setCustomValidity("");
  return true;
}

// =============================================================================
// QUEUE DASHBOARD & ACTIONS
// =============================================================================
// State persistence for Blast assignment dropdowns & volume inputs to prevent background polling reset
const allocDraftState = {}; // { [truckId]: { blast: string, volumes: { [origIdx]: number|string } } }

function updateAllocBlast(truckId, value) {
  if (!allocDraftState[truckId]) allocDraftState[truckId] = {};
  allocDraftState[truckId].blast = value;
}

function updateAllocVol(truckId, origIdx, value) {
  if (!allocDraftState[truckId]) allocDraftState[truckId] = {};
  if (!allocDraftState[truckId].volumes) allocDraftState[truckId].volumes = {};
  allocDraftState[truckId].volumes[origIdx] = value;
}

function saveAllActiveAllocInputs() {
  document.querySelectorAll("[id^='blastSel_']").forEach((sel) => {
    const truckId = sel.id.replace("blastSel_", "");
    if (!allocDraftState[truckId]) allocDraftState[truckId] = {};
    allocDraftState[truckId].blast = sel.value;
  });
  document.querySelectorAll("[id^='alloc_']").forEach((inp) => {
    const lastUnderscore = inp.id.lastIndexOf("_");
    if (lastUnderscore !== -1) {
      const origIdx = parseInt(inp.id.substring(lastUnderscore + 1), 10);
      const truckId = inp.id.substring("alloc_".length, lastUnderscore);
      if (!allocDraftState[truckId]) allocDraftState[truckId] = {};
      if (!allocDraftState[truckId].volumes) allocDraftState[truckId].volumes = {};
      allocDraftState[truckId].volumes[origIdx] = inp.value;
    }
  });
}

function renderQueue() {
  saveAllActiveAllocInputs();

  const table = document.getElementById("queueTable");
  const searchInput = document.getElementById("searchInput");
  const search = searchInput ? searchInput.value.toLowerCase().trim() : "";
  if (!table) return;

  let list = [...queueList];
  if (search) {
    list = list.filter(
      (t) =>
        (t.assigned_blast || "").toLowerCase().includes(search) ||
        (t.product || "").toLowerCase().includes(search) ||
        (t.queue || "").toLowerCase().includes(search)
    );
  }

  renderForBlastInventory();

  if (list.length === 0) {
    table.innerHTML = `
      <tr>
        <td colspan="15" style="text-align:center;padding:36px;color:#64748b;font-weight:600;">
          No products currently queued today. Register product above to start queuing.
        </td>
      </tr>
    `;
    return;
  }

  table.innerHTML = list
    .map((truck) => {
      let actions = "";
      if (truck.status !== "Cancelled") {
        actions += renderBlastActivityControls(truck);
      }

      if (truck.status === "Waiting") {
        actions += renderAllocPanel(truck);
        actions += `<button class="btn-danger" onclick="cancelTruck('${truck.id}', '${truck.queue}')">Cancel</button>`;
      } else if (truck.status === "Called") {
        actions += `<button class="btn-warning" onclick="startBlastFreezing('${truck.id}')">Start Blast Freezing</button>`;
      } else if (truck.status === "Loading") {
        actions += `<button class="btn-success" onclick="completeBlastFreezing('${truck.id}')">Complete</button>`;
      } else if (truck.status === "Completed") {
        actions += `<button class="btn-secondary" onclick="startHarvest('${truck.id}')">Harvest Start</button>`;
      }

      if (truck.status !== "Cancelled") {
        actions += `<button class="btn-outline" onclick="openBlastActivityModal('${truck.id}')">Activity Log</button>`;
      }

      actions += `<button class="btn-dark" onclick="printQueueTicket('${truck.id}')">Print</button>`;

      return `
      <tr>
        <td><strong style="font-size:14px;color:#0f172a;">${escapeHTML(truck.queue)}</strong></td>
        <td><strong>${escapeHTML(truck.queue_date || truck.date)}</strong></td>
        <td><strong>${escapeHTML(truck.queue_shift || "—")}</strong></td>
        <td>${escapeHTML(truck.product || "—")}</td>
        <td>${volumeCellHTML(truck)}</td>
        <td>${escapeHTML(truck.product_temperature || "—")}</td>
        <td>${escapeHTML(truck.production_date || "—")}</td>
        <td>${escapeHTML(truck.recorder_checker || "—")}</td>
        <td>${truck.isForLayer ? '<span class="badge" style="background:#ede9fe;color:#6d28d9;">YES</span>' : "—"}</td>
        <td><strong style="color:#0284c7;">${escapeHTML(truck.assigned_blast || "—")}</strong></td>
        <td style="color:#15803d;font-weight:700;">${escapeHTML(truck.loading_time || "—")}</td>
        <td style="color:#047857;font-weight:700;">${escapeHTML(truck.completed_time || "—")}</td>
        <td>${priorityBadge(truck.priority)}</td>
        <td>${statusBadge(truck.status)}</td>
        <td><div class="actions">${actions}</div></td>
      </tr>
    `;
    })
    .join("");
}

function statusBadge(status) {
  const map = {
    Waiting: "badge-waiting",
    Called: "badge-called",
    Loading: "badge-loading",
    Completed: "badge-completed",
    Harvested: "badge-departed",
  };
  const cls = map[status] || "badge-waiting";
  const label = status === "Called" ? "In Blast Queue" : status;
  return `<span class="badge ${cls}">${escapeHTML(label)}</span>`;
}

function priorityBadge(priority) {
  if (priority === "Priority" || priority === "FSI") {
    return `<span class="badge badge-priority">${escapeHTML(priority)}</span>`;
  }
  return `<span class="badge" style="background:#f1f5f9;color:#475569;">${escapeHTML(priority || "Standard")}</span>`;
}

function volumeCellHTML(truck) {
  let base = escapeHTML(truck.volume || "—");
  const prods = truck.products || [];
  // If base starts with "PRODUCT: ", strip product name for single product to prevent duplication
  if (prods.length === 1 && truck.product && base.toUpperCase().startsWith(truck.product.toUpperCase() + ":")) {
    base = base.substring(truck.product.length + 1).trim();
  }

  if (truck.status === "Waiting" && prods.some((p) => (p.allocated || 0) > 0)) {
    const isSingle = prods.length === 1;
    const remaining = prods
      .map((p) => {
        const left = (p.amount || 0) - (p.allocated || 0);
        const u = formatUnit(p.unit || "kg");
        return isSingle ? `${left} ${u}` : `${p.product}: ${left} ${u}`;
      })
      .join("; ");
    return `${base}<br><small style="color:#b45309;font-weight:800;">Remaining: ${escapeHTML(remaining)}</small>`;
  }
  return base;
}

function renderAllocPanel(truck) {
  const prods = truck.products || [];
  const openWithIndices = prods
    .map((p, origIdx) => ({ p, origIdx }))
    .filter(({ p }) => Math.round(((p.amount || 0) - (p.allocated || 0)) * 100) / 100 > 0.001);

  if (openWithIndices.length === 0) return "";

  const draft = allocDraftState[truck.id] || {};
  const currentBlast = draft.blast || "Blast 1";

  return `
    <div style="padding:8px 10px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;margin:4px 0;width:100%;min-width:260px;">
      <div style="font-size:11px;font-weight:800;color:#334155;margin-bottom:6px;">SPLIT / PUT IN BLAST</div>
      ${openWithIndices
        .map(({ p, origIdx }) => {
          const remaining = Math.max(0, Math.round(((p.amount || 0) - (p.allocated || 0)) * 100) / 100);
          const hasDraftVal = draft.volumes && draft.volumes[origIdx] !== undefined && draft.volumes[origIdx] !== "";
          const displayVal = hasDraftVal ? Math.min(remaining, parseFloat(draft.volumes[origIdx]) || 0) : remaining;
          const u = formatUnit(p.unit || "kg");
          return `
            <div style="margin-bottom:6px;">
              <div style="font-size:11px;font-weight:700;">${escapeHTML(p.product)} <small style="color:#64748b;">(Left: ${remaining} ${escapeHTML(u)})</small></div>
              <div style="display:flex;gap:4px;align-items:center;">
                <input type="number" id="alloc_${truck.id}_${origIdx}" min="0.01" max="${remaining}" step="any"
                  value="${displayVal}"
                  oninput="if(parseFloat(this.value) > ${remaining}) { this.value = ${remaining}; showToast('Hindi maaaring lumagpas sa natitirang ${remaining} ${u}.', 'warning'); } updateAllocVol('${truck.id}', ${origIdx}, this.value);"
                  style="width:110px;padding:4px 8px;font-size:12px;">
                <span style="font-size:11px;font-weight:700;">${escapeHTML(u)}</span>
              </div>
            </div>
          `;
        })
        .join("")}
      <div style="display:flex;gap:6px;align-items:center;margin-top:6px;">
        <select id="blastSel_${truck.id}" onchange="updateAllocBlast('${truck.id}', this.value)" style="padding:4px 8px;font-size:12px;max-width:110px;">
          ${["Blast 1", "Blast 2", "Blast 3", "Blast 4"]
            .map((b) => `<option value="${b}" ${b === currentBlast ? "selected" : ""}>${b}</option>`)
            .join("")}
        </select>
        <button type="button" id="assignBtn_${truck.id}" class="btn-primary" style="padding:5px 10px;font-size:11px;" onclick="allocateQueueBatch('${truck.id}')">
          Assign
        </button>
      </div>
    </div>
  `;
}

const allocatingQueueIds = new Set();

async function allocateQueueBatch(id) {
  if (allocatingQueueIds.has(id)) return;
  const truck = queueList.find((t) => t.id === id);
  if (!truck) return;

  const assignBtn = document.getElementById(`assignBtn_${id}`) || document.querySelector(`button[onclick*="allocateQueueBatch('${id}')"]`);
  if (assignBtn) {
    assignBtn.disabled = true;
    assignBtn.textContent = "Assigning...";
  }
  allocatingQueueIds.add(id);

  try {
    saveAllActiveAllocInputs();

    const draft = allocDraftState[id] || {};
    const sel = document.getElementById(`blastSel_${id}`);
    const blast = (sel ? sel.value : draft.blast) || "Blast 1";
    const prods = truck.products || [];

    const picks = [];
    for (let i = 0; i < prods.length; i++) {
      const input = document.getElementById(`alloc_${id}_${i}`);
      const remaining = Math.max(0, Math.round(((prods[i].amount || 0) - (prods[i].allocated || 0)) * 100) / 100);
      let vol = 0;
      if (input && input.value !== "") {
        vol = parseFloat(input.value) || 0;
      } else if (draft.volumes && draft.volumes[i] !== undefined && draft.volumes[i] !== "") {
        vol = parseFloat(draft.volumes[i]) || 0;
      }

      if (vol > 0) {
        // STRICT CHECK: Kapag lumagpas ang kilos sa natitira sa inventory, hindi na ito magtutuloy
        if (vol > remaining + 0.001) {
          showToast(`Hindi magtutuloy ang pag-assign: Lumagpas ang kilos para sa ${prods[i].product}. Hinihingi: ${vol} ${formatUnit(prods[i].unit)}, pero ${remaining} ${formatUnit(prods[i].unit)} na lang ang natitira sa inventory.`, "error");
          return;
        }
        picks.push({ index: i, volume: vol });
      }
    }

    if (picks.length === 0) {
      showToast("Mangyaring maglagay ng kilos para sa kahit isang produkto.", "warning");
      return;
    }

    const res = await fetch(`/api/queues/${id}/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blast, picks }),
    });

    if (res.ok) {
      const data = await res.json();
      delete allocDraftState[id]; // Clear draft state on success
      showToast(`Batch assigned to ${blast}: ${data.childQueue}`);
      await fetchQueues();
    } else {
      const err = await res.json();
      showToast(err.error || "Hindi nagtuloy ang pag-assign", "error");
    }
  } catch (e) {
    showToast("Network error sa pag-assign ng queue", "error");
  } finally {
    allocatingQueueIds.delete(id);
    if (assignBtn) {
      assignBtn.disabled = false;
      assignBtn.textContent = "Assign";
    }
  }
}

function renderForBlastInventory() {
  const tbody = document.getElementById("forBlastInventoryRows");
  const sumBox = document.getElementById("forBlastSummary");
  if (!tbody) return;

  const parents = queueList.filter((t) => !t.parent_id && t.status !== "Cancelled" && t.products?.length > 0);
  const rows = [];
  const totals = {};

  parents.forEach((t) => {
    (t.products || []).forEach((p) => {
      const allocated = parseFloat(p.allocated) || 0;
      const amount = parseFloat(p.amount) || 0;
      const left = Math.max(0, Math.round((amount - allocated + Number.EPSILON) * 100) / 100);
      const state = left <= 0 ? "All in Blast" : allocated > 0 ? "Partly in Blast" : "Waiting for Blast";
      const color = left <= 0 ? "#15803d" : allocated > 0 ? "#b45309" : "#2563eb";

      if (left > 0) {
        totals[p.unit] = (totals[p.unit] || 0) + left;
      }

      rows.push(`
        <tr>
          <td><strong style="color:#0f172a;">${escapeHTML(t.queue)}</strong></td>
          <td style="font-weight:700;">${escapeHTML(p.product)}</td>
          <td>${escapeHTML(p.productionDate || "—")}</td>
          <td>${amount.toLocaleString()} ${escapeHTML(p.unit)}</td>
          <td>${allocated.toLocaleString()} ${escapeHTML(p.unit)}</td>
          <td><strong style="color:#15803d;">${left.toLocaleString()} ${escapeHTML(p.unit)}</strong></td>
          <td style="font-weight:800;color:${color};">${state}</td>
        </tr>
      `);
    });
  });

  tbody.innerHTML =
    rows.length > 0
      ? rows.join("")
      : `<tr><td colspan="7" style="text-align:center;padding:24px;color:#64748b;">No products registered for blast today.</td></tr>`;

  if (sumBox) {
    const entries = Object.entries(totals);
    sumBox.innerHTML =
      entries.length > 0
        ? entries
            .map(
              ([unit, total]) => `
          <div style="background:#eff6ff;padding:10px 16px;border-radius:10px;border:1px solid #bfdbfe;">
            <strong style="font-size:16px;color:#1e40af;">${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${escapeHTML(unit)}</strong><br>
            <span style="font-size:11px;color:#3b82f6;font-weight:700;">Remaining For Blast</span>
          </div>
        `
            )
            .join("")
        : `<div style="background:#f0fdf4;padding:8px 14px;border-radius:8px;color:#15803d;font-weight:700;font-size:12px;">All registered volumes are inside blast freezers.</div>`;
  }
}

// Stage triggers
async function startBlastFreezing(id) {
  const now = new Date();
  try {
    const res = await fetch(`/api/queues/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Loading",
        loadingTime: now.toLocaleTimeString(),
        blastStartTimestamp: now.toISOString(),
      }),
    });
    if (res.ok) {
      showToast("Blast Freezing started.");
      await fetchQueues();
    }
  } catch (e) {
    showToast("Error updating status", "error");
  }
}

async function completeBlastFreezing(id) {
  const now = new Date();
  try {
    const res = await fetch(`/api/queues/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Completed",
        completedTime: now.toLocaleTimeString(),
        blastEndTimestamp: now.toISOString(),
      }),
    });
    if (res.ok) {
      showToast("Blast Freezing completed. Product ready for harvest.");
      await fetchQueues();
    }
  } catch (e) {
    showToast("Error updating status", "error");
  }
}

async function startHarvest(id) {
  const now = new Date();
  try {
    const res = await fetch(`/api/queues/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Harvested",
        departedTime: now.toLocaleTimeString(),
        harvestStartTimestamp: now.toISOString(),
      }),
    });
    if (res.ok) {
      showToast("Harvesting started.");
      await fetchQueues();
    }
  } catch (e) {
    showToast("Error updating status", "error");
  }
}

async function cancelTruck(id, queueNum) {
  if (!confirm(`Cancel queue ${queueNum}?`)) return;
  try {
    const res = await fetch(`/api/queues/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Cancelled",
        cancelledTime: new Date().toLocaleTimeString(),
      }),
    });
    if (res.ok) {
      delete allocDraftState[id];
      showToast(`Queue ${queueNum} cancelled. Stock returned to inventory.`);
      await fetchQueues();
      await fetchInventory();
      await fetchHistory();
    }
  } catch (e) {
    showToast("Error cancelling queue", "error");
  }
}

// =============================================================================
// TEMPERATURE MONITORING WHILE FREEZING
// =============================================================================
function freezingProducts() {
  return queueList.filter(
    (t) =>
      t.assigned_blast &&
      !["Completed", "Harvested", "Cancelled"].includes(t.status) &&
      (t.status === "Loading" || Boolean(t.blast_start_timestamp))
  );
}

function renderTempPanel() {
  const sel = document.getElementById("tempTruckSelect");
  if (!sel) return;
  const list = freezingProducts();
  const keep = sel.value;

  sel.innerHTML =
    list.length > 0
      ? list
          .map(
            (t) => `
        <option value="${t.id}">${escapeHTML(t.assigned_blast)} · ${escapeHTML(t.queue)} · ${escapeHTML(t.product)}</option>
      `
          )
          .join("")
      : `<option value="">No product currently in blast freezing</option>`;

  if (list.some((t) => String(t.id) === String(keep))) {
    sel.value = keep;
  }

  const active = list.find((t) => String(t.id) === String(sel.value)) || list[0];
  const box = document.getElementById("tempHistory");
  if (!box) return;

  if (!active) {
    box.innerHTML = `<div class="temp-empty">No products currently freezing. Click Start Blast Freezing to log temperatures.</div>`;
    return;
  }

  const readings = active.tempReadings || [];
  box.innerHTML =
    readings.length > 0
      ? readings
          .slice(-6)
          .reverse()
          .map(
            (r, i) => `
        <div class="temp-reading ${r.decision === "For Harvest" ? "harvest" : ""}">
          <div>
            <strong style="font-size:15px;">${r.temp}°C</strong> · 
            <span style="font-weight:800;color:${r.decision === "For Harvest" ? "#15803d" : "#b45309"}">${escapeHTML(r.decision)}</span>
          </div>
          <small>${new Date(r.time).toLocaleTimeString()} · by ${escapeHTML(r.by)}</small>
          <button type="button" class="btn-outline" style="color:#dc2626;" onclick="deleteFreezingTemp('${active.id}', ${readings.length - 1 - i})">
            ✕
          </button>
        </div>
      `
          )
          .join("")
      : `<div class="temp-empty">No temperature reading recorded yet for this batch.</div>`;
}

async function saveFreezingTemperature() {
  const sel = document.getElementById("tempTruckSelect");
  if (!sel || !sel.value) {
    showToast("Select product in blast freezing first.", "warning");
    return;
  }
  const tempVal = document.getElementById("tempValue").value.trim();
  const tempBy = document.getElementById("tempBy").value.trim();
  const decision = document.getElementById("tempDecision").value;

  if (tempVal === "" || isNaN(parseFloat(tempVal))) {
    showToast("Enter valid product temperature in °C.", "warning");
    return;
  }
  if (!tempBy) {
    showToast("Enter name of person who took temperature.", "warning");
    return;
  }
  if (!decision) {
    showToast("Select decision: For Extend or For Harvest.", "warning");
    return;
  }

  try {
    const res = await fetch(`/api/queues/${sel.value}/temperature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp: tempVal, by: tempBy, decision }),
    });
    if (res.ok) {
      showToast("Temperature saved.");
      document.getElementById("tempValue").value = "";
      document.getElementById("tempDecision").value = "";
      await fetchQueues();
    }
  } catch (e) {
    showToast("Error saving temperature", "error");
  }
}

async function deleteFreezingTemp(id, index) {
  if (!confirm("Delete this temperature reading?")) return;
  try {
    const res = await fetch(`/api/queues/${id}/temperature/${index}`, { method: "DELETE" });
    if (res.ok) {
      showToast("Reading deleted.");
      await fetchQueues();
    }
  } catch (e) {
    showToast("Error deleting reading", "error");
  }
}

// =============================================================================
// STATS CARDS UPDATE
// =============================================================================
function updateStats() {
  const waiting = queueList.filter((t) => t.status === "Waiting").length;
  const called = queueList.filter((t) => t.status === "Called").length;
  const loading = queueList.filter((t) => t.status === "Loading").length;
  const completed = queueList.filter((t) => ["Completed", "Harvested"].includes(t.status)).length;
  const total = queueList.length;

  document.getElementById("waitingCount").textContent = waiting;
  document.getElementById("calledCount").textContent = called;
  document.getElementById("loadingCount").textContent = loading;
  document.getElementById("completedCount").textContent = completed;
  document.getElementById("totalCount").textContent = total;
}

// =============================================================================
// LIVE TV QUEUE BOARD
// =============================================================================
function renderLiveBlastBoard() {
  const cards = document.getElementById("tvBlastCards");
  if (!cards) return;

  const blasts = ["Blast 1", "Blast 2", "Blast 3", "Blast 4"];
  cards.innerHTML = blasts
    .map((blast) => {
      const items = queueList.filter(
        (t) => t.assigned_blast === blast && !["Completed", "Harvested"].includes(t.status)
      );
      const isStarted = items.some((t) => t.status === "Loading" || Boolean(t.blast_start_timestamp));

      return `
      <div class="tv-blast">
        <h3>
          <span>❄️ ${blast.toUpperCase()}</span>
          <span class="tv-count" style="background:${isStarted ? "#14532d" : "#1e293b"};color:${isStarted ? "#bbf7d0" : "#cbd5e1"};">
            ${isStarted ? "FREEZING ONGOING" : "WAITING / QUEUED"}
          </span>
        </h3>
        ${
          items.length > 0
            ? items
                .map((t) => {
                  const started = t.status === "Loading" || Boolean(t.blast_start_timestamp);
                  const dur = started ? calcTvDuration(t.blast_start_timestamp) : "";
                  const latestTemp = (t.tempReadings || []).slice(-1)[0];

                  return `
            <div class="tv-item">
              <strong>${escapeHTML(t.queue)}</strong>
              <div>
                <div style="font-size:16px;font-weight:900;color:#f8fafc;">${escapeHTML(t.product)}</div>
                <small>${escapeHTML(t.volume || "—")} · Initial: ${escapeHTML(t.product_temperature || "—")} · ${escapeHTML(t.priority || "FSI")}</small>
                <span class="tv-status ${started ? "started" : "waiting"}">${started ? "BLAST FREEZING STARTED" : "WAITING IN QUEUE"}</span>
                ${
                  started && dur
                    ? `<small class="tv-duration" data-start="${escapeHTML(t.blast_start_timestamp)}" style="color:#fde047;font-weight:800;">⏱ Time inside Blast: ${dur}</small>`
                    : ""
                }
                ${
                  latestTemp
                    ? `<div class="tv-temp">
                        🌡️ Current: ${latestTemp.temp}°C 
                        <span class="tv-dec ${latestTemp.decision === "For Harvest" ? "harvest" : "extend"}">${escapeHTML(latestTemp.decision.toUpperCase())}</span>
                      </div>
                      <small>By ${escapeHTML(latestTemp.by)} · ${new Date(latestTemp.time).toLocaleTimeString()}</small>`
                    : `<small>🌡️ Freezing temperature: not yet recorded</small>`
                }
              </div>
            </div>
          `;
                })
                .join("")
            : `<div class="tv-empty">Freezer Available / Empty</div>`
        }
      </div>
    `;
    })
    .join("");

  // Layering Area Box
  const layerBox = document.getElementById("tvLayerItems");
  if (layerBox) {
    const layerItems = queueList.filter(
      (t) => t.isForLayer && !["Loading", "Completed", "Harvested", "Cancelled"].includes(t.status)
    );
    layerBox.innerHTML =
      layerItems.length > 0
        ? layerItems
            .map(
              (t) => `
        <div class="tv-layer-item">
          <strong>${escapeHTML(t.queue)} · ${escapeHTML(t.product)}</strong>
          <small>Volume: ${escapeHTML(t.volume || "—")}</small>
          <small>Shift: ${escapeHTML(t.queue_shift || "—")} · Status: ${escapeHTML(t.status)}</small>
        </div>
      `
            )
            .join("")
        : `<div class="tv-empty" style="grid-column:1/-1;">No products currently in layering area</div>`;
  }

  // Harvest Area Box
  const harvestBox = document.getElementById("tvHarvestItems");
  if (harvestBox) {
    const harvestItems = queueList.filter(
      (t) => t.status === "Completed" || (t.status === "Harvested" && !t.harvest_end_timestamp)
    );
    harvestBox.innerHTML =
      harvestItems.length > 0
        ? harvestItems
            .map((t) => {
              const harvesting = t.status === "Harvested";
              const dur = calcTotalBlastDuration(t);
              return `
          <div class="tv-layer-item">
            <strong>${escapeHTML(t.queue)} · ${escapeHTML(t.product)}</strong>
            <small>Volume: ${escapeHTML(t.volume || "—")} · ${escapeHTML(t.assigned_blast || "—")}</small>
            <span class="tv-status ${harvesting ? "harvesting" : "waiting"}">${harvesting ? "HARVESTING" : "FOR HARVEST"}</span>
            ${dur ? `<small style="color:#fde047;font-weight:800;">⏱ Total Blast Freezing Time: ${dur}</small>` : ""}
          </div>
        `;
            })
            .join("")
        : `<div class="tv-empty" style="grid-column:1/-1;">No products waiting for harvest</div>`;
  }
}

// =============================================================================
// ACTIVITY MONITORING CONTROLS & MODAL
// =============================================================================
function renderBlastActivityControls(truck) {
  const acts = truck.blastActivities || [];
  const specs = [
    { i: 0, label: "Barcode Scanning End", endOnly: true },
    { i: 1, label: "Layering" },
    { i: 2, label: "Transfer to Blast" },
    { i: 4, label: "Harvesting" },
    { i: 5, label: "Barcode Weighing" },
  ];

  let html = '<div style="display:flex;flex-wrap:wrap;gap:4px;min-width:230px;margin:4px 0;">';
  for (const s of specs) {
    const a = acts[s.i] || { start: "", end: "" };
    if (s.i === 1) {
      if (!a.start) {
        html += `<button type="button" class="btn-outline" style="padding:4px 8px;font-size:11px;" onclick="stampActivity('${truck.id}', 1, 'start')">Layering Start</button>`;
      } else if (!a.end) {
        html += `<button type="button" class="btn-success" style="padding:4px 8px;font-size:11px;" onclick="stampActivity('${truck.id}', 1, 'end')">Layering End</button>`;
      }
    } else if (s.i === 4) {
      if (a.start && !a.end) {
        html += `<button type="button" class="btn-warning" style="padding:4px 8px;font-size:11px;" onclick="stampActivity('${truck.id}', 4, 'end')">⏹ Harvest End</button>`;
      }
    } else if (s.endOnly) {
      if (a.start && !a.end) {
        html += `<button type="button" class="btn-outline" style="padding:4px 8px;font-size:11px;" onclick="stampActivity('${truck.id}', ${s.i}, 'end')">${s.label}</button>`;
      }
    } else if (!a.start) {
      html += `<button type="button" class="btn-outline" style="padding:4px 8px;font-size:11px;" onclick="stampActivity('${truck.id}', ${s.i}, 'start')">${s.label} Start</button>`;
    } else if (!a.end) {
      html += `<button type="button" class="btn-success" style="padding:4px 8px;font-size:11px;" onclick="stampActivity('${truck.id}', ${s.i}, 'end')">${s.label} End</button>`;
    }
  }
  html += "</div>";
  return html;
}

async function stampActivity(truckId, activityIndex, side) {
  const now = new Date();
  const timestamp = formatDateTimeLocal(now);
  try {
    const res = await fetch(`/api/queues/${truckId}/stamp-activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityIndex, side, timestamp }),
    });
    if (res.ok) {
      showToast(`Activity ${side} timestamp recorded at ${now.toLocaleTimeString()}.`);
      await fetchQueues();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to stamp activity", "warning");
    }
  } catch (e) {
    showToast("Error stamping activity", "error");
  }
}

function openBlastActivityModal(id) {
  activeModalQueueId = id;
  const truck = queueList.find((t) => t.id === id);
  if (!truck) return;

  document.getElementById("modalQueueHeader").textContent = `Queue ${truck.queue} · ${truck.product} · ${truck.assigned_blast || "Not assigned"}`;
  const acts = truck.blastActivities || [];

  const tbody = document.getElementById("blastActivityRows");
  tbody.innerHTML = acts
    .map(
      (a, i) => `
    <tr>
      <td style="font-weight:700;">${escapeHTML(a.name)}</td>
      <td><input type="datetime-local" id="actStart_${i}" value="${escapeHTML(a.start || "")}" disabled style="font-size:12px;"></td>
      <td><input type="datetime-local" id="actEnd_${i}" value="${escapeHTML(a.end || "")}" disabled style="font-size:12px;"></td>
      <td style="font-weight:800;color:#15803d;">${parseActivityDuration(a.start, a.end)}</td>
      <td><input id="actRemarks_${i}" value="${escapeHTML(a.remarks || "")}" placeholder="Remarks" style="font-size:12px;"></td>
      <td><input id="actManning_${i}" value="${escapeHTML(a.manning || "")}" placeholder="Manning" style="font-size:12px;width:80px;"></td>
      <td><input id="actRecorder_${i}" value="${escapeHTML(a.recorder || "")}" placeholder="Recorder" style="font-size:12px;"></td>
      <td><input id="actSupervisor_${i}" value="${escapeHTML(a.blastSupervisor || "")}" placeholder="Supervisor" style="font-size:12px;"></td>
    </tr>
  `
    )
    .join("");

  document.getElementById("blastActivityModal").classList.add("show");
}

function closeBlastActivityModal() {
  document.getElementById("blastActivityModal").classList.remove("show");
  activeModalQueueId = null;
}

async function saveBlastActivityLog() {
  if (!activeModalQueueId) return;
  const truck = queueList.find((t) => t.id === activeModalQueueId);
  if (!truck) return;

  const acts = (truck.blastActivities || []).map((a, i) => ({
    name: a.name,
    start: a.start || "",
    end: a.end || "",
    remarks: document.getElementById(`actRemarks_${i}`).value.trim(),
    manning: document.getElementById(`actManning_${i}`).value.trim(),
    recorder: document.getElementById(`actRecorder_${i}`).value.trim(),
    blastSupervisor: document.getElementById(`actSupervisor_${i}`).value.trim(),
  }));

  try {
    const res = await fetch(`/api/queues/${activeModalQueueId}/activities`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activities: acts }),
    });

    if (res.ok) {
      showToast("Activity log saved.");
      closeBlastActivityModal();
      await fetchQueues();
    }
  } catch (e) {
    showToast("Error saving activities", "error");
  }
}

// =============================================================================
// PRINTING QUEUE TICKET
// =============================================================================
function printQueueTicket(id) {
  const truck = queueList.find((t) => t.id === id);
  if (!truck) return;

  document.getElementById("printQueue").textContent = truck.queue;
  document.getElementById("printDetails").innerHTML = `
    <strong>Date:</strong> ${escapeHTML(truck.queue_date || truck.date)}<br>
    <strong>Shift:</strong> ${escapeHTML(truck.queue_shift || "—")}<br>
    <strong>Product:</strong> ${escapeHTML(truck.product)}<br>
    <strong>Volume:</strong> ${escapeHTML(truck.volume)}<br>
    <strong>Initial Temp:</strong> ${escapeHTML(truck.product_temperature || "—")}<br>
    <strong>Production Date:</strong> ${escapeHTML(truck.production_date || "—")}<br>
    <strong>Blast Receiver/Recorder:</strong> ${escapeHTML(truck.recorder_checker || "—")}<br>
    <strong>Prioritization:</strong> ${escapeHTML(truck.priority || "FSI")}<br>
    <strong>Blast Freezer:</strong> ${escapeHTML(truck.assigned_blast || "Not assigned")}<br>
    <strong>Registered At:</strong> ${escapeHTML(truck.arrival || "—")}
  `;

  document.getElementById("printTicket").style.display = "block";
  window.print();
  setTimeout(() => {
    document.getElementById("printTicket").style.display = "none";
  }, 1000);
}

// =============================================================================
// REPORTS & CSV EXPORTS (REAL-TIME ACCURATE & TABLET COMPATIBLE)
// =============================================================================
function exportQueueCSV() {
  if (queueList.length === 0) {
    showToast("No queue data to export today.", "warning");
    return;
  }
  const now = new Date();
  const exportTimestampStr = formatDownloadDateTime(now);
  const headers = [
    "Queue Number",
    "Registration Date",
    "Queue Date",
    "Shift",
    "Product",
    "Volume",
    "Product Temp (°C)",
    "Production Date",
    "Receiver / Recorder",
    "For Layer",
    "Blast Freezer Assigned",
    "Priority",
    "Current Status",
    "Arrival Time",
    "Blast Freezing Start",
    "Blast Freezing End",
    "Real-Time Freezing Duration",
    "Harvest Time",
    "Export Timestamp",
  ];

  const rows = queueList.map((t) => [
    t.queue,
    t.date,
    t.queue_date,
    t.queue_shift,
    t.product,
    t.volume,
    t.product_temperature,
    t.production_date,
    t.recorder_checker,
    t.isForLayer ? "Yes" : "No",
    t.assigned_blast || "Not Assigned",
    t.priority,
    t.status,
    formatDownloadDateTime(t.arrival_timestamp || t.arrival),
    formatDownloadDateTime(t.blast_start_timestamp || t.loading_time),
    formatDownloadDateTime(t.blast_end_timestamp || t.completed_time),
    calcFreezingDuration(t.blast_start_timestamp, t.blast_end_timestamp, t.status),
    formatDownloadDateTime(t.harvest_start_timestamp || t.departed_time),
    exportTimestampStr,
  ]);

  const csvContent =
    "\ufeff" +
    [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

  downloadBlob(
    csvContent,
    `MHC_Product_Queue_${todayDateStr()}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.csv`,
    "text/csv;charset=utf-8;"
  );
}

function exportActivityDurationReport() {
  if (queueList.length === 0) {
    showToast("No records to export.", "warning");
    return;
  }
  const now = new Date();
  const exportTimestampStr = formatDownloadDateTime(now);
  const headers = [
    "Queue Number",
    "Product",
    "Volume",
    "Blast Freezer",
    "Date",
    "Shift",
    "Activity Stage",
    "Start Date & Time",
    "End Date & Time",
    "Real-Time Duration",
    "Activity Status",
    "Manning",
    "Recorder",
    "Supervisor",
    "Remarks",
    "Export Timestamp",
  ];

  const rows = [];
  queueList.forEach((truck) => {
    (truck.blastActivities || []).forEach((a) => {
      rows.push([
        truck.queue,
        truck.product,
        truck.volume,
        truck.assigned_blast || "Not Assigned",
        truck.queue_date || truck.date,
        truck.queue_shift,
        a.name,
        formatDownloadDateTime(a.start),
        formatDownloadDateTime(a.end),
        parseActivityDuration(a.start, a.end),
        a.end ? "Completed" : a.start ? "In Progress" : "Not Started",
        a.manning || "",
        a.recorder || "",
        a.blastSupervisor || "",
        a.remarks || "",
        exportTimestampStr,
      ]);
    });
  });

  const csvContent =
    "\ufeff" +
    [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

  downloadBlob(
    csvContent,
    `MHC_Activity_Duration_Report_${todayDateStr()}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.csv`,
    "text/csv;charset=utf-8;"
  );
}

function exportBlastInventoryCSV() {
  if (inventoryList.length === 0) {
    showToast("No inventory records to export.", "warning");
    return;
  }
  const now = new Date();
  const exportTimestampStr = formatDownloadDateTime(now);
  const headers = [
    "Production Date",
    "Registered Date & Time",
    "Product Name",
    "Available Volume",
    "Unit",
    "Category",
    "Notes",
    "Export Timestamp",
  ];
  const rows = inventoryList.map((r) => [
    r.production_date || r.date || "",
    formatDownloadDateTime(r.created_at),
    r.product,
    r.volume,
    r.unit,
    r.category || "",
    r.notes || "",
    exportTimestampStr,
  ]);
  const csvContent =
    "\ufeff" +
    [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
  downloadBlob(
    csvContent,
    `MHC_Blast_Inventory_${todayDateStr()}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.csv`,
    "text/csv;charset=utf-8;"
  );
}

function exportBlastHistoryCSV() {
  if (historyList.length === 0) {
    showToast("No history movement to export.", "warning");
    return;
  }
  const now = new Date();
  const exportTimestampStr = formatDownloadDateTime(now);
  const headers = [
    "Movement Date & Time",
    "Activity Type",
    "Product Name",
    "Volume Change",
    "Unit",
    "Remaining Stock",
    "Shift",
    "Queue Number",
    "Details",
    "Export Timestamp",
  ];
  const rows = historyList.map((h) => [
    formatDownloadDateTime(h.timestamp),
    h.type,
    h.product,
    (h.type === "DEDUCTION" ? "-" : "+") + Number(h.volume || 0),
    h.unit,
    h.remaining,
    h.shift || "",
    h.queue || "",
    h.details || "",
    exportTimestampStr,
  ]);
  const csvContent =
    "\ufeff" +
    [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
  downloadBlob(
    csvContent,
    `MHC_Inventory_History_${todayDateStr()}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.csv`,
    "text/csv;charset=utf-8;"
  );
}

function updateReportSummary() {
  const sumEl = document.getElementById("reportSummary");
  if (!sumEl) return;
  const waiting = queueList.filter((t) => t.status === "Waiting").length;
  const processing = queueList.filter((t) => ["Called", "Loading"].includes(t.status)).length;
  const completed = queueList.filter((t) => ["Completed", "Harvested"].includes(t.status)).length;
  const cancelled = queueList.filter((t) => t.status === "Cancelled").length;

  sumEl.innerHTML = `
    <strong>Company:</strong> May Harvest Corporation<br>
    <strong>System:</strong> Product Queuing & Blast Freezing Management System<br>
    <strong>Database Storage:</strong> ${escapeHTML(systemStatus.database)}<br>
    <strong>Today's Date:</strong> ${todayDateStr()}<br>
    <strong>Total Batches:</strong> ${queueList.length}<br>
    <strong>Waiting:</strong> ${waiting} · <strong>Processing:</strong> ${processing} · <strong>Completed:</strong> ${completed} · <strong>Cancelled:</strong> ${cancelled}
  `;
}

async function resetDayQueue() {
  if (!confirm("WARNING: This will reset today's product queue and sequence counter. Continue?")) return;
  try {
    const res = await fetch("/api/queues/reset-day", { method: "POST" });
    if (res.ok) {
      showToast("Today's queue reset successfully.");
      await fetchQueues();
    }
  } catch (e) {
    showToast("Error resetting today's queue", "error");
  }
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
  }, 400);
}

// =============================================================================
// INITIALIZATION & EVENT LISTENERS
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Real-time Clock synchronized in real time
  function updateLiveClock() {
    const clockEl = document.getElementById("clock");
    if (!clockEl) return;
    const now = new Date();
    const opts = {
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    };
    clockEl.textContent = `🕒 ${now.toLocaleString("en-US", opts)}`;
  }
  updateLiveClock();

  setInterval(() => {
    updateLiveClock();

    // Ticking durations in live TV board
    if (currentScreen === "liveBoard") {
      document.querySelectorAll("#tvBlastCards .tv-duration").forEach((el) => {
        const d = calcTvDuration(el.dataset.start);
        if (d) el.textContent = `⏱ Time inside Blast: ${d}`;
      });
    }
  }, 1000);

  // Set default form dates
  const logDateInput = document.getElementById("blastLogDate");
  if (logDateInput) logDateInput.value = todayDateStr();

  const queueDateInput = document.getElementById("queueDate");
  if (queueDateInput) queueDateInput.value = todayDateStr();

  // Global Auto-Uppercase for all text and search inputs & textareas
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t) return;
    if (
      (t.tagName === "INPUT" && (t.type === "text" || t.type === "search" || !t.type)) ||
      t.tagName === "TEXTAREA"
    ) {
      const start = t.selectionStart;
      const end = t.selectionEnd;
      const val = t.value;
      const upper = val.toUpperCase();
      if (val !== upper) {
        t.value = upper;
        if (start !== null && end !== null) {
          t.setSelectionRange(start, end);
        }
      }
    }
  });

  // Inventory Form submit
  const invForm = document.getElementById("blastInventoryForm");
  let isSubmittingInv = false;
  if (invForm) {
    invForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isSubmittingInv) return;
      isSubmittingInv = true;

      const submitBtn = invForm.querySelector('button[type="submit"]');
      const origBtnText = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = "⏳ SAVING TO CLOUD...";
      }

      const payload = {
        date: document.getElementById("blastLogDate").value,
        productionDate: document.getElementById("blastLogProductionDate").value.trim(),
        product: document.getElementById("blastLogProduct").value.trim().toUpperCase(),
        volume: document.getElementById("blastLogVolume").value,
        unit: formatUnit(document.getElementById("blastLogUnit").value),
        category: document.getElementById("blastLogCategory").value,
      };

      try {
        const res = await fetch("/api/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          showToast(`Added ${payload.volume} ${payload.unit} of ${payload.product} to inventory.`);
          invForm.reset();
          document.getElementById("blastLogDate").value = todayDateStr();
          await fetchInventory();
          await fetchHistory();
        } else {
          const err = await res.json();
          showToast(err.error || "Failed to add inventory", "error");
        }
      } catch (err) {
        showToast("Network error submitting inventory", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origBtnText;
        }
        isSubmittingInv = false;
      }
    });
  }

  // Registration Form submit
  const regForm = document.getElementById("registrationForm");
  let isSubmittingReg = false;
  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isSubmittingReg) return;
      isSubmittingReg = true;

      const submitBtn = regForm.querySelector('button[type="submit"]');
      const origBtnText = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = "⏳ GENERATING QUEUE NUMBER...";
      }

      const queueDate = document.getElementById("queueDate").value;
      const queueShift = document.getElementById("queueShift").value;
      const recorderChecker = document.getElementById("recorderChecker").value.trim().toUpperCase();
      const priority = document.getElementById("priority").value;
      const isForLayer = document.getElementById("forLayer").value === "Yes";

      const rows = Array.from(document.querySelectorAll("#productEntries .product-entry"));
      const products = rows.map((r) => {
        let vol = r.querySelector(".product-volume").value.trim().toUpperCase();
        if (vol.toLowerCase().includes("cases")) {
          vol = vol.replace(/cases/gi, "crates");
        }
        return {
          product: r.querySelector(".product-name").value.trim().toUpperCase(),
          volume: vol,
          productTemperature: r.querySelector(".product-temperature").value,
          productionDate: r.querySelector(".product-production-date").value,
        };
      });

      // Validate stock availability
      for (const p of products) {
        const matching = inventoryList.filter(
          (st) =>
            normProd(st.product) === normProd(p.product) &&
            normDateStr(st.production_date) === normDateStr(p.productionDate) &&
            parseFloat(st.volume) > 0
        );
        const avail = matching.reduce((sum, st) => sum + parseFloat(st.volume || 0), 0);
        const reqAmount = parseFloat(p.volume.replace(/[^0-9.]/g, "")) || 0;

        if (matching.length === 0 || avail < reqAmount) {
          showToast(
            `Insufficient inventory for ${p.product} (Production Date: ${p.productionDate}). Available: ${avail}, Requested: ${reqAmount}`,
            "error"
          );
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origBtnText;
          }
          isSubmittingReg = false;
          return;
        }
      }

      try {
        const now = new Date();
        const res = await fetch("/api/queues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queueDate,
            queueShift,
            recorderChecker,
            priority,
            isForLayer,
            products,
            arrivalTime: now.toLocaleTimeString("en-US", { hour12: true }),
            arrivalTimestamp: now.toISOString(),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          showToast(`Product added to queue successfully: ${data.queue}`);

          // Show Success Card
          const successCard = document.getElementById("registrationSuccess");
          if (successCard) {
            document.getElementById("newQueueNumber").textContent = data.queue;
            document.getElementById("newTicketInfo").innerHTML = `
              <strong>Queue:</strong> ${data.queue}<br>
              <strong>Shift:</strong> ${escapeHTML(queueShift)} (${escapeHTML(queueDate)})<br>
              <strong>Products:</strong><br>
              ${products.map((p) => `• ${escapeHTML(p.product)}: ${escapeHTML(p.volume)} (${p.productTemperature}°C)`).join("<br>")}<br>
              <strong>Receiver/Recorder:</strong> ${escapeHTML(recorderChecker)}<br>
              <strong>Prioritization:</strong> ${escapeHTML(priority)}
            `;
            successCard.classList.add("show");
            window.lastRegisteredQueueId = data.id;
          }

          regForm.reset();
          document.getElementById("queueDate").value = todayDateStr();
          document.getElementById("productEntries").innerHTML = `
            <div class="product-entry">
              <div class="form-group"><label>Product *</label><input class="product-name" type="text" placeholder="e.g. HJAC, CCM, MDS" required autocomplete="off"></div>
              <div class="form-group"><label>Volume *</label><input class="product-volume" type="text" placeholder="e.g. 5,000 kg" required autocomplete="off"></div>
              <div class="form-group"><label>Product Temp (°C) *</label><input class="product-temperature" type="number" step="0.1" placeholder="4.0" required></div>
              <div class="form-group"><label>Production Date *</label><input class="product-production-date" type="date" required></div>
              <button class="btn-outline remove-product-btn" type="button" onclick="this.closest('.product-entry').remove(); updateProductRemoveButtons();" style="height:42px;display:none;color:#dc2626;">Remove</button>
            </div>
          `;

          await fetchInventory();
          await fetchHistory();
          await fetchQueues();
        } else {
          const err = await res.json();
          showToast(err.error || "Failed to create queue", "error");
        }
      } catch (err) {
        showToast("Network error submitting queue", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origBtnText;
        }
        isSubmittingReg = false;
      }
    });
  }

  // Live stock verification listeners
  const productEntriesEl = document.getElementById("productEntries");
  if (productEntriesEl) {
    productEntriesEl.addEventListener("input", (e) => {
      if (e.target.matches(".product-name, .product-production-date")) {
        checkProductProductionDate(e.target.closest(".product-entry"));
      }
    });
    productEntriesEl.addEventListener("change", (e) => {
      if (e.target.matches(".product-name, .product-production-date")) {
        checkProductProductionDate(e.target.closest(".product-entry"));
      }
    });
  }

  // Load initial data
  refreshAllData();

  // Background Live Sync Poller (Every 3 seconds)
  pollTimer = setInterval(async () => {
    await fetchQueues();
  }, 3000);
});
