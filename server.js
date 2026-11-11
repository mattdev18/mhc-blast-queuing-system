import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { db, dbMode, initDatabase } from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Polyfill BigInt serialization for JSON responses (prevents "Do not know how to serialize a BigInt" error)
BigInt.prototype.toJSON = function () {
  return Number(this);
};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

// =============================================================================
// HELPER FUNCTIONS (TIMEZONE ACCURATE TO ASIA/MANILA UTC+8)
// =============================================================================

function todayString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const p = {};
  parts.forEach((x) => (p[x.type] = x.value));
  return `${p.year}-${p.month}-${p.day}`;
}

function manilaTimeString(d = new Date()) {
  return d.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour12: true });
}

function manilaIsoString(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const p = {};
  parts.forEach((x) => (p[x.type] = x.value));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

function normDate(v) {
  const t = String(v || "").trim();
  if (!t) return "";
  let m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return t;
}

function normProductName(v) {
  return String(v || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function getNextQueueNumber(targetDate) {
  const dateKey = `queue_seq_${targetDate}`;
  const res = await db.execute({
    sql: "SELECT value FROM system_meta WHERE key = ?",
    args: [dateKey],
  });

  let seq = 1;
  if (res.rows.length > 0) {
    seq = parseInt(res.rows[0].value, 10) + 1;
    await db.execute({
      sql: "UPDATE system_meta SET value = ?, updated_at = ? WHERE key = ?",
      args: [String(seq), new Date().toISOString(), dateKey],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO system_meta (key, value, updated_at) VALUES (?, ?, ?)",
      args: [dateKey, "1", new Date().toISOString()],
    });
  }

  return "Q" + String(seq).padStart(3, "0");
}

// =============================================================================
// API ROUTES
// =============================================================================

// 1. Health / Connection Status
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    system: "May Harvest Corporation - Blast Freezing Queuing System",
    database: dbMode,
    isCloud: dbMode.includes("Turso"),
    time: new Date().toISOString(),
  });
});

// 2. Inventory - Get All (FIFO Order)
app.get("/api/inventory", async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT * FROM blast_inventory 
      ORDER BY 
        CASE WHEN production_date IS NULL OR production_date = '' THEN '9999-99-99' ELSE production_date END ASC,
        created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/inventory error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Debounce maps to prevent accidental double-click / rapid duplicate requests
const recentInvSubmissions = new Map();
const recentQueueSubmissions = new Map();

// 3. Inventory - Add Stock
app.post("/api/inventory", async (req, res) => {
  try {
    const { date, productionDate, product, volume, unit, category, notes } = req.body;
    if (!product || !volume || !productionDate) {
      return res.status(400).json({ error: "Product, volume, and production date are required." });
    }

    const pName = product.trim().toUpperCase();
    const pDate = normDate(productionDate);
    const pUnit = (unit || "kg").trim().toLowerCase() === "cases" ? "crates" : (unit || "kg").trim();
    const numVolume = parseFloat(volume);
    const createdAt = new Date().toISOString();
    const nowMs = Date.now();

    // 1. Debounce rapid identical submissions (within 4 seconds) to prevent double submit
    const debounceKey = `${normProductName(pName)}_${pDate}_${numVolume}_${pUnit.toLowerCase()}`;
    if (recentInvSubmissions.has(debounceKey) && nowMs - recentInvSubmissions.get(debounceKey) < 4000) {
      return res.json({ success: true, debounced: true, message: "Duplicate submission ignored." });
    }
    recentInvSubmissions.set(debounceKey, nowMs);
    // Cleanup old debounce keys
    for (const [k, t] of recentInvSubmissions.entries()) {
      if (nowMs - t > 10000) recentInvSubmissions.delete(k);
    }

    // 2. Check if this product, production date, and unit already has an existing inventory lot
    const allInv = await db.execute("SELECT * FROM blast_inventory");
    const existingMatch = allInv.rows.find(
      (r) =>
        normProductName(r.product) === normProductName(pName) &&
        normDate(r.production_date) === pDate &&
        (r.unit || "kg").toLowerCase() === pUnit.toLowerCase()
    );

    let targetId;
    if (existingMatch) {
      // Merge into existing lot: add to available volume so rows/kilos do not duplicate
      const newLotVol = Math.round((parseFloat(existingMatch.volume) + numVolume + Number.EPSILON) * 100) / 100;
      await db.execute({
        sql: "UPDATE blast_inventory SET volume = ?, date = ?, category = COALESCE(?, category), notes = COALESCE(?, notes) WHERE id = ?",
        args: [newLotVol, date || todayString(), category || null, notes || null, existingMatch.id],
      });
      targetId = existingMatch.id;
    } else {
      // Insert new inventory lot
      const insertResult = await db.execute({
        sql: `INSERT INTO blast_inventory (date, production_date, product, volume, unit, category, notes, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          date || todayString(),
          pDate,
          pName,
          numVolume,
          pUnit,
          category || "Uncategorized",
          notes || "",
          createdAt,
        ],
      });
      targetId = Number(insertResult.lastInsertRowid);
    }

    // Calculate total stock remaining for this product & unit
    const sumResult = await db.execute({
      sql: "SELECT SUM(volume) as total FROM blast_inventory WHERE LOWER(product) = LOWER(?) AND unit = ?",
      args: [pName, pUnit],
    });
    const totalRemaining = sumResult.rows[0]?.total || numVolume;

    // Log history
    await db.execute({
      sql: `INSERT INTO blast_inventory_history (timestamp, type, product, production_date, volume, unit, remaining, shift, queue, details)
            VALUES (?, 'REGISTER', ?, ?, ?, ?, ?, '', '', ?)`,
      args: [
        createdAt,
        pName,
        pDate,
        numVolume,
        pUnit,
        totalRemaining,
        `Category: ${category || "Uncategorized"}`,
      ],
    });

    res.json({ success: true, id: targetId });
  } catch (err) {
    console.error("POST /api/inventory error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Inventory - Delete Stock Entry
app.delete("/api/inventory/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const findResult = await db.execute({
      sql: "SELECT * FROM blast_inventory WHERE id = ?",
      args: [id],
    });

    if (findResult.rows.length === 0) {
      return res.status(404).json({ error: "Inventory item not found." });
    }

    const item = findResult.rows[0];
    await db.execute({
      sql: "DELETE FROM blast_inventory WHERE id = ?",
      args: [id],
    });

    // History movement log
    const sumResult = await db.execute({
      sql: "SELECT SUM(volume) as total FROM blast_inventory WHERE LOWER(product) = LOWER(?) AND unit = ?",
      args: [item.product, item.unit],
    });
    const remaining = sumResult.rows[0]?.total || 0;

    await db.execute({
      sql: `INSERT INTO blast_inventory_history (timestamp, type, product, production_date, volume, unit, remaining, shift, queue, details)
            VALUES (?, 'DEDUCTION', ?, ?, ?, ?, ?, '', '', 'Inventory record deleted manually')`,
      args: [new Date().toISOString(), item.product, item.production_date, item.volume, item.unit, remaining],
    });

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/inventory/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Inventory - Reset All Inventory
app.post("/api/inventory/reset", async (req, res) => {
  try {
    await db.execute("DELETE FROM blast_inventory");
    await db.execute("DELETE FROM blast_inventory_history");
    res.json({ success: true, message: "Inventory and movement history cleared." });
  } catch (err) {
    console.error("POST /api/inventory/reset error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Inventory History - Get All
app.get("/api/inventory/history", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM blast_inventory_history ORDER BY id DESC LIMIT 200");
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/inventory/history error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Queues - Get Today's Queues (or filter by date)
app.get("/api/queues", async (req, res) => {
  try {
    const targetDate = req.query.date || todayString();
    const result = await db.execute({
      sql: "SELECT * FROM blast_queues WHERE date = ? AND status != 'Allocated' ORDER BY created_at ASC",
      args: [targetDate],
    });

    const parsedRows = result.rows.map((row) => ({
      ...row,
      isForLayer: Boolean(row.is_for_layer),
      products: row.products_json ? JSON.parse(row.products_json) : [],
      blastActivities: row.blast_activities_json ? JSON.parse(row.blast_activities_json) : [],
      tempReadings: row.temp_readings_json ? JSON.parse(row.temp_readings_json) : [],
    }));

    res.json(parsedRows);
  } catch (err) {
    console.error("GET /api/queues error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Queues - Add New Product Queue (With FIFO inventory deductions)
app.post("/api/queues", async (req, res) => {
  try {
    const { queueDate, queueShift, recorderChecker, priority, isForLayer, products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "At least one product is required." });
    }

    const today = todayString();
    const targetDate = queueDate || today;
    const dateShift = `${targetDate} / ${queueShift || "Day Shift"}`;
    const now = new Date();
    const nowMs = Date.now();

    // 1. Debounce rapid duplicate queue submissions (within 4 seconds) to prevent double queuing
    const qDebounceKey = `${targetDate}_${queueShift}_${(recorderChecker || "").trim().toUpperCase()}_${JSON.stringify(products)}`;
    if (recentQueueSubmissions.has(qDebounceKey) && nowMs - recentQueueSubmissions.get(qDebounceKey) < 4000) {
      const cached = recentQueueSubmissions.get(qDebounceKey + "_record");
      if (cached) return res.json(cached);
    }
    recentQueueSubmissions.set(qDebounceKey, nowMs);
    for (const [k, t] of recentQueueSubmissions.entries()) {
      if (nowMs - t > 10000) recentQueueSubmissions.delete(k);
    }

    const newQueueNum = await getNextQueueNumber(today);
    const recordId = "QREC_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

    // Default 6 activity steps
    const defaultActivities = [
      "Barcode Scanning (Fresh Input)",
      "Layering",
      "Transfer to Blast Freezing Room",
      "Blast Freezing",
      "Harvesting",
      "Barcoding Weighing (Frozen Output)",
    ].map((name) => ({
      name,
      start: "",
      end: "",
      remarks: "",
      manning: "",
      recorder: "",
      blastSupervisor: "",
    }));

    // Process & deduct from blast_inventory for each product
    for (const item of products) {
      item.product = (item.product || "").trim().toUpperCase();
      const parsedAmount = parseFloat(String(item.volume || "0").replace(/[^0-9.]/g, "")) || 0;
      let parsedUnit = (String(item.volume || "").match(/[a-zA-Z]+/g) || ["kg"])[0];
      if (parsedUnit.toLowerCase() === "cases") parsedUnit = "crates";

      item.amount = parsedAmount;
      item.unit = parsedUnit;
      item.allocated = 0;

      // Find stock matching product and production_date
      const matchingInventory = await db.execute({
        sql: `SELECT * FROM blast_inventory 
              WHERE volume > 0 
              ORDER BY 
                CASE WHEN production_date IS NULL OR production_date = '' THEN '9999-99-99' ELSE production_date END ASC,
                created_at ASC`,
      });

      let remainingToDeduct = parsedAmount;
      for (const invRow of matchingInventory.rows) {
        if (remainingToDeduct <= 0) break;
        if (
          normProductName(invRow.product) === normProductName(item.product) &&
          normDate(invRow.production_date) === normDate(item.productionDate)
        ) {
          const avail = parseFloat(invRow.volume);
          const take = Math.min(avail, remainingToDeduct);
          const newVol = Math.round((avail - take + Number.EPSILON) * 100) / 100;
          remainingToDeduct = Math.round((remainingToDeduct - take + Number.EPSILON) * 100) / 100;

          await db.execute({
            sql: "UPDATE blast_inventory SET volume = ? WHERE id = ?",
            args: [newVol, invRow.id],
          });
        }
      }

      // Remaining stock after deduction
      const afterSum = await db.execute({
        sql: "SELECT SUM(volume) as total FROM blast_inventory WHERE LOWER(product) = LOWER(?)",
        args: [item.product.trim()],
      });
      const remainingTotal = afterSum.rows[0]?.total || 0;

      // Log movement history
      await db.execute({
        sql: `INSERT INTO blast_inventory_history (timestamp, type, product, production_date, volume, unit, remaining, shift, queue, details)
              VALUES (?, 'DEDUCTION', ?, ?, ?, ?, ?, ?, ?, 'Deducted when added to Product Queuing for Blast')`,
        args: [
          now.toISOString(),
          item.product,
          item.productionDate,
          parsedAmount,
          parsedUnit,
          remainingTotal,
          queueShift || "",
          newQueueNum,
        ],
      });
    }

    const isSingleProd = products.length === 1;
    const prodNames = products.map((p) => p.product).join(", ");
    const prodVols = isSingleProd
      ? products[0].volume
      : products.map((p) => `${p.product}: ${p.volume}`).join("; ");
    const prodTemps = isSingleProd
      ? `${products[0].productTemperature || "0"}°C`
      : products.map((p) => `${p.product}: ${p.productTemperature || "0"}°C`).join("; ");
    const prodDates = isSingleProd
      ? products[0].productionDate
      : products.map((p) => `${p.product}: ${p.productionDate}`).join("; ");

    await db.execute({
      sql: `INSERT INTO blast_queues (
        id, queue, parent_queue, parent_id, date, queue_date, queue_shift, date_shift,
        product, volume, product_temperature, production_date, recorder_checker,
        priority, is_for_layer, arrival, arrival_timestamp, status, assigned_blast,
        queue_started, queue_started_at, split_count, products_json, blast_activities_json,
        temp_readings_json, created_at
      ) VALUES (
        ?, ?, '', '', ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 'Waiting', '',
        1, ?, 0, ?, ?,
        '[]', ?
      )`,
      args: [
        recordId,
        newQueueNum,
        today,
        targetDate,
        queueShift,
        dateShift,
        prodNames,
        prodVols,
        prodTemps,
        prodDates,
        recorderChecker || "",
        priority || "FSI",
        isForLayer ? 1 : 0,
        req.body.arrivalTime || manilaTimeString(now),
        req.body.arrivalTimestamp || now.toISOString(),
        req.body.arrivalTimestamp || now.toISOString(),
        JSON.stringify(products),
        JSON.stringify(defaultActivities),
        now.toISOString(),
      ],
    });

    const responseData = {
      success: true,
      queue: newQueueNum,
      id: recordId,
      record: {
        id: recordId,
        queue: newQueueNum,
        products,
        recorderChecker,
        priority,
        queueDate: targetDate,
        queueShift,
      },
    };
    recentQueueSubmissions.set(qDebounceKey + "_record", responseData);

    res.json(responseData);
  } catch (err) {
    console.error("POST /api/queues error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 9. Queues - Update Queue Status & Timestamps
app.patch("/api/queues/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      assignedBlast,
      blastQueueTime,
      loadingTime,
      blastStartTimestamp,
      completedTime,
      blastEndTimestamp,
      departedTime,
      harvestStartTimestamp,
      harvestEndTime,
      harvestEndTimestamp,
      cancelledTime,
    } = req.body;

    const findRes = await db.execute({
      sql: "SELECT * FROM blast_queues WHERE id = ?",
      args: [id],
    });

    if (findRes.rows.length === 0) {
      return res.status(404).json({ error: "Queue not found." });
    }

    const current = findRes.rows[0];
    let activities = current.blast_activities_json ? JSON.parse(current.blast_activities_json) : [];

    // Auto-fill activities when stage changes using Manila local time
    const now = new Date();
    const localNow = manilaIsoString(now);

    if (status === "Loading") {
      const act = activities.find((a) => a.name === "Blast Freezing") || activities[3];
      if (act && !act.start) act.start = req.body.blastStartTimestamp ? manilaIsoString(new Date(req.body.blastStartTimestamp)) : localNow;
    }

    if (status === "Completed") {
      const act = activities.find((a) => a.name === "Blast Freezing") || activities[3];
      if (act) act.end = req.body.blastEndTimestamp ? manilaIsoString(new Date(req.body.blastEndTimestamp)) : localNow;
    }

    if (status === "Harvested") {
      const act = activities.find((a) => a.name === "Harvesting") || activities[4];
      if (act && !act.start) act.start = req.body.harvestStartTimestamp ? manilaIsoString(new Date(req.body.harvestStartTimestamp)) : localNow;
    }

    // When a queue is cancelled, return any unallocated product volume back to blast_inventory
    if (status === "Cancelled" && current.status !== "Cancelled") {
      try {
        const products = current.products_json ? JSON.parse(current.products_json) : [];
        for (const p of products) {
          const totalAmount = parseFloat(p.amount) || parseFloat(String(p.volume || "").replace(/[^0-9.]/g, "")) || 0;
          const allocatedAmount = parseFloat(p.allocated) || 0;
          const returnVol = current.parent_id
            ? totalAmount
            : Math.round((Math.max(0, totalAmount - allocatedAmount) + Number.EPSILON) * 100) / 100;

          if (returnVol > 0) {
            const pName = (p.product || "").trim();
            const pDate = p.productionDate || current.production_date || "";

            const allInv = await db.execute({
              sql: "SELECT * FROM blast_inventory ORDER BY id DESC",
            });

            const matchingRow = allInv.rows.find(
              (r) =>
                normProductName(r.product) === normProductName(pName) &&
                normDate(r.production_date) === normDate(pDate)
            );

            if (matchingRow) {
              const updatedVol = Math.round((parseFloat(matchingRow.volume) + returnVol + Number.EPSILON) * 100) / 100;
              await db.execute({
                sql: "UPDATE blast_inventory SET volume = ? WHERE id = ?",
                args: [updatedVol, matchingRow.id],
              });
            } else {
              const anyMatch = allInv.rows.find(
                (r) => normProductName(r.product) === normProductName(pName)
              );
              const unit = p.unit || anyMatch?.unit || "kg";
              const category = anyMatch?.category || "Returned Stock";

              await db.execute({
                sql: `INSERT INTO blast_inventory (date, production_date, product, volume, unit, category, notes, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                  todayString(),
                  normDate(pDate) || todayString(),
                  pName,
                  returnVol,
                  unit,
                  category,
                  `Restored from cancelled queue ${current.queue}`,
                  now.toISOString(),
                ],
              });
            }

            const afterSum = await db.execute({
              sql: "SELECT SUM(volume) as total FROM blast_inventory WHERE LOWER(TRIM(product)) = LOWER(TRIM(?))",
              args: [pName],
            });
            const remainingTotal = Math.round(((afterSum.rows[0]?.total || returnVol) + Number.EPSILON) * 100) / 100;
            const unit = p.unit || "kg";

            await db.execute({
              sql: `INSERT INTO blast_inventory_history (
                date_time, activity, product, volume_change, remaining_stock, shift_queue, details, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                manilaIsoString(now),
                "RETURN",
                pName,
                `+${returnVol} ${unit}`,
                `${remainingTotal} ${unit}`,
                `${current.queue} (Cancelled)`,
                `Returned unallocated volume from cancelled queue ${current.queue}`,
                now.toISOString(),
              ],
            });
          }
        }
      } catch (invErr) {
        console.error("Failed to restore inventory on cancel:", invErr);
      }
    }

    await db.execute({
      sql: `UPDATE blast_queues SET
        status = COALESCE(?, status),
        assigned_blast = COALESCE(?, assigned_blast),
        blast_queue_time = COALESCE(?, blast_queue_time),
        loading_time = COALESCE(?, loading_time),
        blast_start_timestamp = COALESCE(?, blast_start_timestamp),
        completed_time = COALESCE(?, completed_time),
        blast_end_timestamp = COALESCE(?, blast_end_timestamp),
        departed_time = COALESCE(?, departed_time),
        harvest_start_timestamp = COALESCE(?, harvest_start_timestamp),
        harvest_end_time = COALESCE(?, harvest_end_time),
        harvest_end_timestamp = COALESCE(?, harvest_end_timestamp),
        cancelled_time = COALESCE(?, cancelled_time),
        blast_activities_json = ?
      WHERE id = ?`,
      args: [
        status ?? null,
        assignedBlast ?? null,
        blastQueueTime ?? null,
        loadingTime ?? null,
        blastStartTimestamp ?? null,
        completedTime ?? null,
        blastEndTimestamp ?? null,
        departedTime ?? null,
        harvestStartTimestamp ?? null,
        harvestEndTime ?? null,
        harvestEndTimestamp ?? null,
        cancelledTime ?? (status === "Cancelled" ? manilaTimeString(now) : null),
        JSON.stringify(activities),
        id,
      ],
    });

    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/queues/:id/status error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 10. Queues - Allocate / Split to Freezer (Blast 1, 2, 3, 4)
app.post("/api/queues/:id/allocate", async (req, res) => {
  try {
    const { id } = req.params;
    const { blast, picks } = req.body; // picks: array of { index, volume }

    const parentRes = await db.execute({
      sql: "SELECT * FROM blast_queues WHERE id = ?",
      args: [id],
    });

    if (parentRes.rows.length === 0) {
      return res.status(404).json({ error: "Parent queue record not found." });
    }

    const parent = parentRes.rows[0];
    const parentProducts = parent.products_json ? JSON.parse(parent.products_json) : [];
    const now = new Date();
    const splitCount = (parent.split_count || 0) + 1;

    // Check if allocating all remaining
    let allPicksCovered = true;
    for (let i = 0; i < parentProducts.length; i++) {
      const p = parentProducts[i];
      const pick = picks.find((pk) => pk.index === i);
      const toAlloc = pick ? parseFloat(pick.volume) : 0;
      p.allocated = (parseFloat(p.allocated) || 0) + toAlloc;
      if (p.allocated < p.amount - 0.01) {
        allPicksCovered = false;
      }
    }

    const isFullLot = splitCount === 1 && allPicksCovered;
    const childQueueLabel = isFullLot ? parent.queue : `${parent.queue}-${splitCount}`;
    const childId = `QREC_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const childProducts = picks.map(({ index, volume }) => {
      const src = parentProducts[index];
      return {
        product: src.product,
        volume: `${volume} ${src.unit || "kg"}`,
        productTemperature: src.productTemperature,
        productionDate: src.productionDate,
        amount: parseFloat(volume),
        unit: src.unit || "kg",
        allocated: parseFloat(volume),
      };
    });

    const isSingleChild = childProducts.length === 1;
    const prodNames = childProducts.map((p) => p.product).join(", ");
    const prodVols = isSingleChild
      ? childProducts[0].volume
      : childProducts.map((p) => `${p.product}: ${p.volume}`).join("; ");
    const prodTemps = isSingleChild
      ? `${childProducts[0].productTemperature || "0"}°C`
      : childProducts.map((p) => `${p.product}: ${p.productTemperature || "0"}°C`).join("; ");
    const prodDates = isSingleChild
      ? childProducts[0].productionDate
      : childProducts.map((p) => `${p.product}: ${p.productionDate}`).join("; ");

    // Create child record
    await db.execute({
      sql: `INSERT INTO blast_queues (
        id, queue, parent_queue, parent_id, date, queue_date, queue_shift, date_shift,
        product, volume, product_temperature, production_date, recorder_checker,
        priority, is_for_layer, arrival, arrival_timestamp, status, assigned_blast,
        blast_queue_time, queue_started, queue_started_at, split_count, products_json,
        blast_activities_json, temp_readings_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 'Called', ?,
        ?, 1, ?, 0, ?,
        ?, '[]', ?
      )`,
      args: [
        childId,
        childQueueLabel,
        parent.queue,
        parent.id,
        parent.date,
        parent.queue_date,
        parent.queue_shift,
        parent.date_shift,
        prodNames,
        prodVols,
        prodTemps,
        prodDates,
        parent.recorder_checker,
        parent.priority,
        parent.is_for_layer,
        parent.arrival,
        parent.arrival_timestamp,
        blast,
        now.toISOString(),
        now.toISOString(),
        JSON.stringify(childProducts),
        parent.blast_activities_json || "[]",
        now.toISOString(),
      ],
    });

    // Update parent
    const parentNewStatus = allPicksCovered ? "Allocated" : "Waiting";
    await db.execute({
      sql: `UPDATE blast_queues SET
        split_count = ?,
        products_json = ?,
        status = ?
      WHERE id = ?`,
      args: [splitCount, JSON.stringify(parentProducts), parentNewStatus, parent.id],
    });

    res.json({
      success: true,
      childQueue: childQueueLabel,
      childId,
      allAllocated: allPicksCovered,
    });
  } catch (err) {
    console.error("POST /api/queues/:id/allocate error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 11. Queues - Save Freezing Temperature Reading
app.post("/api/queues/:id/temperature", async (req, res) => {
  try {
    const { id } = req.params;
    const { temp, by, decision } = req.body;

    const findRes = await db.execute({
      sql: "SELECT temp_readings_json FROM blast_queues WHERE id = ?",
      args: [id],
    });

    if (findRes.rows.length === 0) {
      return res.status(404).json({ error: "Queue not found." });
    }

    const readings = findRes.rows[0].temp_readings_json
      ? JSON.parse(findRes.rows[0].temp_readings_json)
      : [];

    readings.push({
      time: new Date().toISOString(),
      temp: parseFloat(temp),
      by: by || "Operator",
      decision: decision || "For Extend",
    });

    await db.execute({
      sql: "UPDATE blast_queues SET temp_readings_json = ? WHERE id = ?",
      args: [JSON.stringify(readings), id],
    });

    res.json({ success: true, readings });
  } catch (err) {
    console.error("POST /api/queues/:id/temperature error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 12. Queues - Delete Freezing Temperature Reading
app.delete("/api/queues/:id/temperature/:index", async (req, res) => {
  try {
    const { id, index } = req.params;
    const idx = parseInt(index, 10);

    const findRes = await db.execute({
      sql: "SELECT temp_readings_json FROM blast_queues WHERE id = ?",
      args: [id],
    });

    if (findRes.rows.length === 0) {
      return res.status(404).json({ error: "Queue not found." });
    }

    const readings = findRes.rows[0].temp_readings_json
      ? JSON.parse(findRes.rows[0].temp_readings_json)
      : [];

    if (idx >= 0 && idx < readings.length) {
      readings.splice(idx, 1);
      await db.execute({
        sql: "UPDATE blast_queues SET temp_readings_json = ? WHERE id = ?",
        args: [JSON.stringify(readings), id],
      });
    }

    res.json({ success: true, readings });
  } catch (err) {
    console.error("DELETE /api/queues/:id/temperature/:index error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 13. Queues - Stamp Activity (Start or End for 6 stages)
app.post("/api/queues/:id/stamp-activity", async (req, res) => {
  try {
    const { id } = req.params;
    const { activityIndex, side } = req.body; // side: 'start' | 'end'

    const findRes = await db.execute({
      sql: "SELECT blast_activities_json FROM blast_queues WHERE id = ?",
      args: [id],
    });

    if (findRes.rows.length === 0) {
      return res.status(404).json({ error: "Queue not found." });
    }

    const activities = findRes.rows[0].blast_activities_json
      ? JSON.parse(findRes.rows[0].blast_activities_json)
      : [];

    const a = activities[activityIndex];
    if (!a) {
      return res.status(400).json({ error: "Activity index out of bounds." });
    }

    const now = new Date();
    const localNow = req.body.timestamp || manilaIsoString(now);

    if (side === "start") {
      if (a.start) return res.status(400).json({ error: "Activity has already started." });
      a.start = localNow;
      // Layering Start (index 1) also stamps Barcode Scanning (index 0) if not started yet
      if (activityIndex === 1 && activities[0] && !activities[0].start) {
        activities[0].start = localNow;
      }
    } else {
      if (!a.start) return res.status(400).json({ error: "Start activity first." });
      if (a.end) return res.status(400).json({ error: "Activity has already ended." });
      a.end = localNow;
    }

    let extraSql = "";
    const extraArgs = [];
    if (activityIndex === 4 && side === "end") {
      extraSql = ", harvest_end_timestamp = ?, harvest_end_time = ?";
      extraArgs.push(now.toISOString(), req.body.harvestEndTime || manilaTimeString(now));
    }

    await db.execute({
      sql: `UPDATE blast_queues SET blast_activities_json = ? ${extraSql} WHERE id = ?`,
      args: [JSON.stringify(activities), ...extraArgs, id],
    });

    res.json({ success: true, activities });
  } catch (err) {
    console.error("POST /api/queues/:id/stamp-activity error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 14. Queues - Update Activity Log (Manning, Remarks, Recorder, Supervisor)
app.put("/api/queues/:id/activities", async (req, res) => {
  try {
    const { id } = req.params;
    const { activities } = req.body;

    await db.execute({
      sql: "UPDATE blast_queues SET blast_activities_json = ? WHERE id = ?",
      args: [JSON.stringify(activities), id],
    });

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/queues/:id/activities error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 15. System - Daily Reset
app.post("/api/queues/reset-day", async (req, res) => {
  try {
    const today = todayString();
    await db.execute({
      sql: "DELETE FROM blast_queues WHERE date = ?",
      args: [today],
    });
    await db.execute({
      sql: "DELETE FROM system_meta WHERE key = ?",
      args: [`queue_seq_${today}`],
    });
    res.json({ success: true, message: "Today's queue reset successfully." });
  } catch (err) {
    console.error("POST /api/queues/reset-day error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 16. Backup - Full System JSON Export (Up to 1 Month+)
app.get("/api/backup", async (req, res) => {
  try {
    const inv = await db.execute("SELECT * FROM blast_inventory");
    const hist = await db.execute("SELECT * FROM blast_inventory_history ORDER BY id DESC");
    const queues = await db.execute("SELECT * FROM blast_queues ORDER BY date DESC, created_at DESC");
    const meta = await db.execute("SELECT * FROM system_meta");

    const backupData = {
      company: "MAY HARVEST CORPORATION",
      system: "Product Queuing & Blast Freezing Management System",
      exportTimestamp: new Date().toISOString(),
      databaseMode: dbMode,
      blastInventory: inv.rows,
      inventoryHistory: hist.rows,
      queues: queues.rows.map((q) => ({
        ...q,
        products: q.products_json ? JSON.parse(q.products_json) : [],
        blastActivities: q.blast_activities_json ? JSON.parse(q.blast_activities_json) : [],
        tempReadings: q.temp_readings_json ? JSON.parse(q.temp_readings_json) : [],
      })),
      systemMeta: meta.rows,
    };

    res.setHeader("Content-Disposition", `attachment; filename=MHC_Cloud_Backup_${todayString()}.json`);
    res.setHeader("Content-Type", "application/json");
    res.json(backupData);
  } catch (err) {
    console.error("GET /api/backup error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Fallback route for Single Page Application
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start Server
initDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`=======================================================`);
      console.log(`MAY HARVEST CORPORATION - PRODUCT QUEUING SYSTEM`);
      console.log(`Server running at: http://localhost:${PORT}`);
      console.log(`Database Mode:     ${dbMode}`);
      console.log(`=======================================================`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server due to database error:", err);
    process.exit(1);
  });
