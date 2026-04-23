# DistCtrl Dashboard

Real-time distributed task execution monitor for the Node.js parallel system.

## Quick Start

### 1. Start the controller
```bash
cd distributed-parallel-system
npm install
node controller/index.js
```

### 2. Start one or more agents (separate terminals)
```bash
AGENT_PORT=4001 AGENT_ID=agent-1 node agent/index.js
AGENT_PORT=4002 AGENT_ID=agent-2 node agent/index.js
AGENT_PORT=4003 AGENT_ID=agent-3 node agent/index.js
```

### 3. Open the dashboard
Visit: **http://localhost:3000/dashboard**

Or open `dashboard/index.html` directly in your browser (the API calls
point to `http://localhost:3000` by default).

## Features

| Panel | Description |
|---|---|
| System Overview | Live job/task counts — agents, running, completed, failed |
| Agents | Per-agent CPU%, Memory%, active tasks, online/offline status |
| Jobs Table | All jobs with status chips; click a row or "Detail" to inspect |
| Job Detail | Full task breakdown — assigned agent, status, retries, errors |
| Live Activity | Scrolling event feed (polls `/activity` every 2 s) |
| Submit Job | FAB (+) button → upload Python script + data file |
| Kill Job | "Kill" button cancels any in-progress job |

## API Endpoints Used

| Method | Path | Purpose |
|---|---|---|
| GET | `/stats` | Aggregated stats + agent health |
| GET | `/jobs` | All jobs list |
| GET | `/job/:id` | Job + task details |
| GET | `/activity?since=<ts>` | Recent activity log |
| POST | `/job` | Submit a new job |
| DELETE | `/job/:id` | Kill a job |

## Customising

- `API_BASE` in `script.js` — change if your controller runs on a different host/port
- `POLL_MS` — polling interval (default 2000 ms)

## No Extra Dependencies

The dashboard is pure HTML + CSS + Vanilla JS. No build step needed.
