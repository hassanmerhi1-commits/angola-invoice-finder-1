# NEXOR ERP - Backend Server

This is the backend server for NEXOR ERP. Run this on your **main server PC** (the "heart" of your system).

## Requirements

- Node.js 18+ 
- PostgreSQL 15+

## Installation

```bash
cd backend
npm install
```

## Environment Setup

Copy `backend/.env.example` to `backend/.env` and edit.

**SQLite (default)** — leave `DATABASE_URL` unset; optional `SQLITE_PATH` for the `.db` file.

**PostgreSQL** — set:

```env
DATABASE_URL=postgres://postgres:yel3an7azi@127.0.0.1:5432/kwanza_erp
DB_ENGINE=postgres
PORT=3000
```

Use the same password as `docker-compose.yml` (`POSTGRES_PASSWORD`, default `yel3an7azi`) or your own Postgres instance.

## Database Setup

### PostgreSQL with Docker (from **repository root**)

```bash
docker compose up -d postgres
cd backend && npm run migrate
```

Or from root: `npm run postgres:up` then `npm run postgres:migrate`.

### Manual PostgreSQL

Create database `kwanza_erp`, then `cd backend && npm run migrate`.

## Start Server

```bash
npm start
```

Your server will run at `http://192.168.x.x:3000` (your local IP)

## All other computers

On other PCs, open a browser and go to:
```
http://[SERVER_IP]:5173
```

Replace `[SERVER_IP]` with your server's local IP address (e.g., 192.168.1.50)
