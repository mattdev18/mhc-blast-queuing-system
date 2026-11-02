import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if Turso cloud credentials are provided; otherwise fall back to local SQLite file
const tursoUrl = process.env.TURSO_DATABASE_URL ? process.env.TURSO_DATABASE_URL.trim() : "";
const tursoToken = process.env.TURSO_AUTH_TOKEN ? process.env.TURSO_AUTH_TOKEN.trim() : "";

const isTursoCloud = Boolean(tursoUrl && tursoUrl.startsWith("libsql://"));

const dbConfig = isTursoCloud
  ? { url: tursoUrl, authToken: tursoToken }
  : { url: `file:${path.join(__dirname, "mhc_blast_local.db")}` };

export const db = createClient(dbConfig);

export const dbMode = isTursoCloud ? "Turso Cloud (LibSQL Edge)" : "Local SQLite (Offline File)";

/**
 * Initialize all database tables and indexes automatically.
 */
export async function initDatabase() {
  try {
    // 1. Inventory Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS blast_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        production_date TEXT NOT NULL,
        product TEXT NOT NULL,
        volume REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'kg',
        category TEXT NOT NULL DEFAULT 'Uncategorized',
        notes TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // 2. Inventory Movement History
    await db.execute(`
      CREATE TABLE IF NOT EXISTS blast_inventory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        product TEXT NOT NULL,
        production_date TEXT,
        volume REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'kg',
        remaining REAL NOT NULL DEFAULT 0,
        shift TEXT,
        queue TEXT,
        details TEXT
      );
    `);

    // 3. Queue Records (Batches, Queuing, Blasts, and Activities)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS blast_queues (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL,
        parent_queue TEXT,
        parent_id TEXT,
        date TEXT NOT NULL,
        queue_date TEXT NOT NULL,
        queue_shift TEXT NOT NULL,
        date_shift TEXT,
        product TEXT NOT NULL,
        volume TEXT,
        product_temperature TEXT,
        production_date TEXT,
        recorder_checker TEXT,
        priority TEXT DEFAULT 'FSI',
        is_for_layer INTEGER DEFAULT 0,
        arrival TEXT,
        arrival_timestamp TEXT,
        status TEXT NOT NULL DEFAULT 'Waiting',
        assigned_blast TEXT,
        blast_queue_time TEXT,
        loading_time TEXT,
        blast_start_timestamp TEXT,
        completed_time TEXT,
        blast_end_timestamp TEXT,
        departed_time TEXT,
        harvest_start_timestamp TEXT,
        harvest_end_time TEXT,
        harvest_end_timestamp TEXT,
        cancelled_time TEXT,
        queue_started INTEGER DEFAULT 1,
        queue_started_at TEXT,
        split_count INTEGER DEFAULT 0,
        products_json TEXT,
        blast_activities_json TEXT,
        temp_readings_json TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // 4. System Settings & Daily Sequence
    await db.execute(`
      CREATE TABLE IF NOT EXISTS system_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    console.log(`[Database] Initialized successfully. Connected to: ${dbMode}`);
  } catch (error) {
    console.error("[Database] Initialization Error:", error);
    throw error;
  }
}
