'use strict';

const express  = require('express');
const axios    = require('axios');
const os       = require('os');

const config   = require('../config');
const executor = require('./executor');

const app = express();
app.use(express.json());

// ─── Active task counter ──────────────────────────────────────────────────────

let activeTasks = 0;

// ─── GET /health ──────────────────────────────────────────────────────────────
//
// Returns CPU, memory, activeTasks, and maxConcurrency.
// cpu  = os.loadavg()[0] / os.cpus().length  (1-minute load average per core)
// mem  = (total - free) / total

app.get('/health', (req, res) => {
  const cpuLoad = os.loadavg()[0] / Math.max(os.cpus().length, 1);
  const memUsed = (os.totalmem() - os.freemem()) / os.totalmem();

  res.json({
    agentId:        config.AGENT_ID,
    cpu:            parseFloat(Math.min(cpuLoad, 1).toFixed(4)),
    memory:         parseFloat(memUsed.toFixed(4)),
    activeTasks,
    maxConcurrency: config.MAX_CONCURRENCY,
  });
});

// ─── POST /task ───────────────────────────────────────────────────────────────
//
// Payload: { taskId, chunkPath, scriptPath }
// Spawns python3 <scriptPath> <chunkPath>, captures stdout.
// Responds: { taskId, result } on success  or  { taskId, error } on failure.

app.post('/task', async (req, res) => {
  const { taskId, chunkPath, scriptPath } = req.body;

  if (!taskId || !chunkPath || !scriptPath) {
    return res.status(400).json({ error: 'taskId, chunkPath, and scriptPath are required' });
  }

  if (activeTasks >= config.MAX_CONCURRENCY) {
    return res.status(503).json({ error: 'Agent at max concurrency', activeTasks, maxConcurrency: config.MAX_CONCURRENCY });
  }

  activeTasks += 1;
  console.log(`[agent:${config.AGENT_ID}] Starting task ${taskId} (active: ${activeTasks})`);

  try {
    const result = await executor.executePythonTask(scriptPath, chunkPath, taskId);
    activeTasks -= 1;
    console.log(`[agent:${config.AGENT_ID}] Task ${taskId} completed (active: ${activeTasks})`);
    res.json({ taskId, result });
  } catch (err) {
    activeTasks -= 1;
    console.error(`[agent:${config.AGENT_ID}] Task ${taskId} failed: ${err.message} (active: ${activeTasks})`);
    res.status(500).json({ taskId, error: err.message });
  }
});

// ─── GET /ping — liveness ────────────────────────────────────────────────────

app.get('/ping', (req, res) => res.json({ ok: true, agentId: config.AGENT_ID }));

// ─── Start server and register with controller ────────────────────────────────

const port    = config.AGENT_PORT;
const agentId = config.AGENT_ID;

app.listen(port, async () => {
  console.log(`[agent:${agentId}] Listening on port ${port}`);

  // Register with controller (retry a few times in case controller isn't up yet)
  const controllerUrl = `http://${config.CONTROLLER_HOST}:${config.CONTROLLER_PORT}/register`;
  const payload = {
    agentId,
    host:           process.env.AGENT_HOST || 'localhost',
    port,
    maxConcurrency: config.MAX_CONCURRENCY,
  };

  let registered = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await axios.post(controllerUrl, payload, { timeout: 5000 });
      console.log(`[agent:${agentId}] Registered with controller at ${controllerUrl}`);
      registered = true;
      break;
    } catch (err) {
      console.warn(`[agent:${agentId}] Registration attempt ${attempt}/10 failed: ${err.message}. Retrying in 2s…`);
      await sleep(2000);
    }
  }

  if (!registered) {
    console.error(`[agent:${agentId}] Could not register with controller after 10 attempts. Exiting.`);
    process.exit(1);
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = app;
