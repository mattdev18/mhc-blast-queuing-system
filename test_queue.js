import { db, initDatabase } from "./database.js";

async function test() {
  await initDatabase();
  const products = [{ product: 'HJAC', volume: '5000', productTemperature: '3.8', productionDate: '2026-11-01' }];
  const queueDate = '2026-11-02';
  const queueShift = 'Night Shift';
  const recorderChecker = 'Ronalyn Luza';
  const priority = 'FSI';
  const isForLayer = true;
  const now = new Date();
  const recordId = 'QREC_' + Date.now();
  const defaultActivities = [];
  
  try {
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
        'Q001',
        '2026-11-02',
        queueDate,
        queueShift,
        '2026-11-02 / Night Shift',
        'HJAC',
        '5000',
        '3.8',
        '2026-11-01',
        recorderChecker || '',
        priority || 'FSI',
        isForLayer ? 1 : 0,
        now.toLocaleTimeString(),
        now.toISOString(),
        now.toISOString(),
        now.toISOString(),
        JSON.stringify(products),
        JSON.stringify(defaultActivities),
        now.toISOString(),
      ],
    });
    console.log('Insert blast_queues ok!');
  } catch(e) {
    console.error('Error caught in execute:', e);
  }
}

test();
