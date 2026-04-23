# Distributed Parallel Execution System

A Node.js distributed system that accepts a Python script + data file, splits the data into chunks, distributes execution across multiple agents in parallel, and merges the results.

---

## Folder Structure

```
distributed-parallel-system/
├── config.js                  # All tunable parameters (ports, timeouts, retries)
├── package.json
│
├── controller/
│   ├── index.js               # HTTP server — job submission & status API
│   ├── splitter.js            # Line-safe data file splitting
│   ├── scheduler.js           # Task queue, agent selection, parallel assignment
│   ├── merger.js              # Result aggregation (number/array/object/text)
│   └── state.js               # In-memory job and agent state
│
├── agent/
│   ├── index.js               # HTTP server — /task and /health endpoints
│   └── executor.js            # child_process.spawn wrapper with timeout
│
├── sample/
│   ├── word_count.py          # Demo script — word frequency (JSON object output)
│   ├── sum_numbers.py         # Demo script — sum lines   (numeric output)
│   ├── large.txt              # 10,000-line English text input
│   └── numbers.txt            # 5,000-line integer input
│
└── jobs/                      # Created at runtime — one folder per job
    └── <jobId>/
        ├── script.py
        ├── data.txt
        ├── chunks/
        │   ├── chunk_0.txt
        │   └── chunk_N.txt
        └── output.json
```

---

## Requirements

| Tool    | Version                   |
| ------- | ------------------------- |
| Node.js | ≥ 18                      |
| npm     | ≥ 9                       |
| Python  | ≥ 3.8 (`python3` on PATH) |

---

## Setup

```bash
git clone <repo-url>
cd distributed-parallel-system
npm install
```

---

## How to Run

### 1. Start the Controller

```bash
node controller/index.js
```

Default port: **3000**. Override with env var:

```bash
CONTROLLER_PORT=3000 node controller/index.js
```

You should see:

```
[controller] Listening on port 3000
[controller] JOBS_DIR: /path/to/jobs
```

---

### 2. Start Multiple Agents

Open **separate terminals** for each agent.

**Agent 1:**

```bash
AGENT_PORT=4001 AGENT_ID=agent-1 node agent/index.js
```

**Agent 2:**

```bash
AGENT_PORT=4002 AGENT_ID=agent-2 node agent/index.js
```

**Agent 3 (optional):**

```bash
AGENT_PORT=4003 AGENT_ID=agent-3 node agent/index.js
```

Each agent will:

1. Start its HTTP server on the given port
2. Register itself with the controller at `localhost:3000`

You should see in the agent terminal:

```
[agent:agent-1] Listening on port 4001
[agent:agent-1] Registered with controller at http://localhost:3000/register
```

And in the controller terminal:

```
[controller] Agent registered: agent-1 @ localhost:4001
```

---

### 3. Submit a Job

Use `curl` to submit a Python script and a data file as a multipart POST:

```bash
curl -s -X POST http://localhost:3000/job \
  -F "script=@sample/word_count.py;type=text/x-python" \
  -F "data=@sample/large.txt;type=text/plain"
```

Response:

```json
{ "jobId": "abc123-...", "status": "SPLITTING" }
```

---

### 4. Poll for Results

```bash
curl -s http://localhost:3000/job/<jobId> | python3 -m json.tool
```

Poll until `status` is `MERGED`:

```json
{
  "jobId": "abc123-...",
  "status": "MERGED",
  "tasks": [
    {
      "taskId": "...-task-0",
      "status": "COMPLETED",
      "assignedAgent": "agent-1"
    },
    {
      "taskId": "...-task-1",
      "status": "COMPLETED",
      "assignedAgent": "agent-2"
    }
  ],
  "result": {
    "type": "object",
    "result": { "the": 9455, "a": 6157, "of": 6088, "...": "..." }
  }
}
```

---

## npm Scripts (Convenience)

```bash
npm run controller    # Start controller on port 3000
npm run agent1        # Start agent-1 on port 4001
npm run agent2        # Start agent-2 on port 4002
npm run agent3        # Start agent-3 on port 4003
```

---

## Test the System

### Test 1 — Word Count (JSON object merge)

```bash
# Terminal 1
node controller/index.js

# Terminal 2
AGENT_PORT=4001 AGENT_ID=agent-1 node agent/index.js

# Terminal 3
AGENT_PORT=4002 AGENT_ID=agent-2 node agent/index.js

# Terminal 4 — submit job and poll
JOB=$(curl -s -X POST http://localhost:3000/job \
  -F "script=@sample/word_count.py" \
  -F "data=@sample/large.txt" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")

echo "Job ID: $JOB"

# Poll every 2 seconds
watch -n 2 "curl -s http://localhost:3000/job/$JOB | python3 -m json.tool"
```

**Expected:** `status: MERGED`, result is a JSON object with word → total count. Two tasks completed by two agents in parallel.

---

### Test 2 — Numeric Sum merge

```bash
JOB=$(curl -s -X POST http://localhost:3000/job \
  -F "script=@sample/sum_numbers.py" \
  -F "data=@sample/numbers.txt" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")

curl -s http://localhost:3000/job/$JOB | python3 -m json.tool
```

**Expected:** `type: number`, `result: 2483755` (sum of all 5000 numbers in numbers.txt).

---

### Test 3 — List registered agents

```bash
curl -s http://localhost:3000/agents | python3 -m json.tool
```

---

### Test 4 — List all jobs

```bash
curl -s http://localhost:3000/jobs | python3 -m json.tool
```

---

### Test 5 — Controller health check

```bash
curl -s http://localhost:3000/health
```

---

### Test 6 — Agent health

```bash
curl -s http://localhost:4001/health
```

Response includes real CPU load, memory usage, activeTasks, maxConcurrency.

---

## Configuration Reference

All settings are in `config.js`. Override with environment variables:

| Env Var           | Default       | Description                              |
| ----------------- | ------------- | ---------------------------------------- |
| `CONTROLLER_PORT` | `3000`        | Controller HTTP port                     |
| `CONTROLLER_HOST` | `localhost`   | Controller hostname (used by agents)     |
| `AGENT_PORT`      | `4000`        | Agent HTTP port                          |
| `AGENT_ID`        | `agent-<pid>` | Unique agent identifier                  |
| `MAX_CONCURRENCY` | `4`           | Max parallel Python tasks per agent      |
| `TASK_TIMEOUT_MS` | `30000`       | Per-task Python execution timeout (ms)   |
| `MAX_RETRIES`     | `3`           | Max task retry attempts before job fails |
| `JOB_TIMEOUT_MS`  | `300000`      | Wall-clock timeout per job (ms)          |
| `MAX_CHUNKS`      | `8`           | Maximum chunk count cap                  |
| `PYTHON_BIN`      | `python3`     | Python interpreter binary                |
| `CHUNK_TTL_MS`    | `3600000`     | Chunk files cleaned up after this TTL    |

---

## Writing Your Own Python Script

The script **must**:

1. Accept a file path as `sys.argv[1]`
2. Open and process that file
3. Print the result to **stdout only** (stderr is for logging)
4. Exit with code `0` on success

```python
import sys, json

with open(sys.argv[1]) as f:
    data = f.read()

# ... process data ...
result = {"key": "value"}

print(json.dumps(result))   # JSON object → merged with deepMerge
# print(42)                 # number      → merged by summing
# print(json.dumps([1,2]))  # JSON array  → merged by concatenation
# print("plain text")       # text        → merged by newline concatenation
```

---

## Architecture

```
Client
  │
  │  POST /job  (multipart: script.py + data.txt)
  ▼
Controller (port 3000)
  │── Splits data.txt ──► chunk_0.txt, chunk_1.txt, ...
  │── Creates subtasks in memory
  │
  │── GET /health ──► Agent 1    (load check)
  │── GET /health ──► Agent 2    (load check)
  │
  │── POST /task ──► Agent 1  { chunkPath, scriptPath, taskId }
  │── POST /task ──► Agent 2  { chunkPath, scriptPath, taskId }
  │
  │   [Agents execute Python in parallel via child_process.spawn]
  │
  │◄── { taskId, result }  from Agent 1
  │◄── { taskId, result }  from Agent 2
  │
  │── Merge results (sum / concat / deepMerge / text)
  │── Write jobs/<jobId>/output.json
  │
  ▼
GET /job/:jobId ──► Client  { status: "MERGED", result: {...} }
```

---

## Merge Strategies

| Output type | Detection                         | Merge                                         |
| ----------- | --------------------------------- | --------------------------------------------- |
| **number**  | All results parse as JSON numbers | Sum all values                                |
| **array**   | All results parse as JSON arrays  | Concatenate in chunk order                    |
| **object**  | All results parse as JSON objects | Deep merge, numeric leaf values summed        |
| **text**    | Does not parse as JSON            | Concatenate in chunk order, newline-separated |

---

## Failure Handling

- **Agent unreachable** → task re-queued, agent marked unreachable until next health check succeeds
- **Python non-zero exit** → task retried up to `MAX_RETRIES` on a different agent
- **Task timeout** → SIGTERM → SIGKILL → reported as error → retry
- **Max retries exceeded** → entire job fails (`status: FAILED`)
- **Job wall-clock timeout** → job marked `TIMED_OUT`
- **All-or-nothing** → partial results are never returned
