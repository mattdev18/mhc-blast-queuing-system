# ❄️ May Harvest Corporation - Product Queuing & Blast Freezing Management System

Cloud-ready, real-time Product Queuing & Blast Freezing Management System built for **May Harvest Corporation**. Powered by **Node.js/Express**, **Turso (LibSQL Edge SQLite)**, and deployed on **Render** with instant multi-device synchronization across plant terminals and Live TV displays.

---

## 🌟 Key Features

1. **📋 Blast Product Log & FIFO Inventory Management**:
   - Register incoming products, volumes, and Production Dates.
   - Categorized by product groups (*Marinated, Timplados, Branded, Deboned, Whole Chicken, Giblets*).
   - Real-time stock deductions with an audit movement trail.

2. **📦 Product Queuing for Blast**:
   - Supports multi-product entries under a single queue ticket (*Q001, Q002, etc.*).
   - Strict FIFO inventory validation: prevents queuing products without available stock on the selected Production Date.
   - Printable 80mm thermal receipt queue tickets.

3. **❄️ Blast Freezing Operations Dashboard**:
   - Live KPI cards: *Waiting, In Blast Queue, Loading/Freezing, Completed/Harvested, Total Today*.
   - Multi-freezer management (*Blast 1, Blast 2, Blast 3, Blast 4*).
   - Batch volume splitting: split registered lots across different freezers seamlessly.
   - In-blast product temperature monitoring with decision flags (*For Extend* / *For Harvest*).

4. **📺 Live TV Queue Board (Plant Monitor Display)**:
   - High-contrast, dark-mode real-time board for wall displays.
   - Live ticking timers showing exact duration inside each freezer.
   - Layering queue and harvest staging area cards.

5. **⏱️ 6-Stage Activity Log & Compliance**:
   - Automated & manual stamping for *Barcode Scanning, Layering, Transfer, Blast Freezing, Harvesting, and Output Weighing*.
   - Locked timestamps, duration calculation, manning, recorder, and supervisor tracking.

6. **☁️ Turso Cloud Storage & 1-Month Backups**:
   - Persistent cloud storage powered by Turso LibSQL (Edge SQLite).
   - **Point-In-Time Recovery (PITR) up to 30 days (1 month backup history)**.
   - One-click full system JSON and CSV reports download.

---

## 🔒 Security & Environment Architecture

To protect your API tokens and cloud database credentials:
- All sensitive credentials (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) are stored in `.env`.
- `.env` is registered in `.gitignore` and **will never be committed to GitHub**.
- The frontend client **never** talks to Turso directly; all calls go through backend REST endpoints (`/api/queues`, `/api/inventory`). Visitors inspecting your website or network tabs **cannot** see your Turso credentials.

---

## 🚀 Setup & Deployment Guide

### STEP 1: Create Your Free Turso Database (Cloud Storage & 1-Month Backup)

1. Go to [https://turso.tech](https://turso.tech) and sign up for a free account.
2. In the Turso Web Console or CLI, create a database:
   ```bash
   turso db create mhc-blast-db --location sin
   ```
   *(Selecting `sin` for Singapore gives ultra-low latency to the Philippines!)*
3. Get your **Database URL**:
   ```bash
   turso db show mhc-blast-db --url
   # Output: libsql://mhc-blast-db-[username].turso.io
   ```
4. Generate your **Auth Token**:
   ```bash
   turso db tokens create mhc-blast-db
   # Output: eyJhbGciOi... (long secure token)
   ```
5. Note: Turso automatically provides point-in-time recovery and snapshot history for up to **30 days** on their free tier.

---

### STEP 2: Configure Local `.env`

In your project root, open `.env` and paste your credentials:

```env
PORT=3000
TURSO_DATABASE_URL=libsql://mhc-blast-db-[username].turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token_here
NODE_ENV=production
```

*(Note: If you leave `TURSO_DATABASE_URL` blank, the app will automatically run using local SQLite `file:mhc_blast_local.db` for offline testing!)*

---

### STEP 3: Push to GitHub

1. Initialize and commit your project:
   ```bash
   git add .
   git commit -m "feat: May Harvest Corporation Blast Queuing System v2.0"
   ```
2. Create a new repository on your GitHub account (e.g. `mhc-blast-queuing-system`).
3. Connect your local repository and push:
   ```bash
   git branch -M main
   git remote add origin https://github.com/[YOUR-USERNAME]/mhc-blast-queuing-system.git
   git push -u origin main
   ```
*(Check your GitHub repository page: `.env` will **not** be uploaded, while `.env.example` serves as documentation.)*

---

### STEP 4: Deploy Online to Render

1. Go to [https://render.com](https://render.com) and sign in.
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository: `mhc-blast-queuing-system`.
4. Configure the service:
   - **Name**: `mhc-blast-queuing`
   - **Region**: `Singapore` (Fastest for the Philippines)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
5. Click **Environment Variables** and add:
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `TURSO_DATABASE_URL` | `libsql://mhc-blast-db-[username].turso.io` |
   | `TURSO_AUTH_TOKEN` | `[Your Turso Auth Token]` |
6. Click **Deploy Web Service**!
   Render will build the app and give you a free HTTPS URL:
   `https://mhc-blast-queuing.onrender.com`

---

## 💻 Running Locally (Offline / Development)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
   Or double-click `start-server.bat` on Windows.
3. Open your browser at:
   `http://localhost:3000`

---

## 📂 Project Structure

```
mhc-blast-queuing-system/
├── .env.example              # Template environment variables (safe for git)
├── .env                      # Real secrets (Ignored by git)
├── .gitignore                # Protects .env, node_modules, and db files
├── package.json              # Dependencies and scripts
├── render.yaml               # Render Blueprint configuration
├── server.js                 # Express server & secure Turso REST APIs
├── database.js               # LibSQL client with automatic table migrations
├── public/                   # Client frontend (Static SPA)
│   ├── index.html            # Modern UI interface
│   ├── css/
│   │   └── style.css         # Responsive styling & branding
│   └── js/
│       └── app.js            # Real-time state, polling & printing logic
├── start-server.bat          # 1-click Windows runner
└── README.md                 # Full documentation
```

---

## 🏢 May Harvest Corporation
*Bulacan, Philippines*  
*Product Queuing & Blast Freezing Operations*
