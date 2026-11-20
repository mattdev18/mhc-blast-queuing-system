-- Initial Schema Migration for MHC Blast Queuing System (Supabase PostgreSQL)

-- 1. BLAST INVENTORY
CREATE TABLE IF NOT EXISTS public.blast_inventory (
    id BIGSERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    production_date TEXT NOT NULL,
    product TEXT NOT NULL,
    volume DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'kg',
    category TEXT NOT NULL DEFAULT 'Uncategorized',
    notes TEXT,
    created_at TEXT NOT NULL,
    equivalent_kilos DOUBLE PRECISION DEFAULT 0
);

-- 2. BLAST INVENTORY HISTORY
CREATE TABLE IF NOT EXISTS public.blast_inventory_history (
    id BIGSERIAL PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    product TEXT NOT NULL,
    production_date TEXT,
    volume DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'kg',
    remaining DOUBLE PRECISION NOT NULL DEFAULT 0,
    shift TEXT,
    queue TEXT,
    details TEXT,
    equivalent_kilos DOUBLE PRECISION DEFAULT 0
);

-- 3. BLAST QUEUES
CREATE TABLE IF NOT EXISTS public.blast_queues (
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
    reference_number TEXT,
    products_json TEXT,
    blast_activities_json TEXT,
    temp_readings_json TEXT,
    created_at TEXT NOT NULL
);

-- 4. SYSTEM META
CREATE TABLE IF NOT EXISTS public.system_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Enable RLS and add public access policies
ALTER TABLE public.blast_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blast_inventory_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blast_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read blast_inventory" ON public.blast_inventory FOR SELECT USING (true);
CREATE POLICY "Allow anon insert blast_inventory" ON public.blast_inventory FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update blast_inventory" ON public.blast_inventory FOR UPDATE USING (true);

CREATE POLICY "Allow anon read blast_queues" ON public.blast_queues FOR SELECT USING (true);
CREATE POLICY "Allow anon insert blast_queues" ON public.blast_queues FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update blast_queues" ON public.blast_queues FOR UPDATE USING (true);

CREATE POLICY "Allow anon read system_meta" ON public.system_meta FOR SELECT USING (true);
