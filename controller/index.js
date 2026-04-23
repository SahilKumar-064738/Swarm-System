'use strict';

const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const { v4: uuidv4 } = require('uuid');

const config    = require('../config');
const state     = require('./state');
const splitter  = require('./splitter');
const scheduler = require('./scheduler');

const app = express();
app.use(express.json());

// ─── CORS for dashboard ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Serve dashboard static files ─────────────────────────────────────────────
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

const upload = multer({ dest: 'tmp_uploads/' });

// ─── POST /register ───────────────────────────────────────────────────────────

app.post('/register', (req, res) => {
  const { agentId, host, port, maxConcurrency } = req.body;
  if (!agentId || !host || !port) {
    return res.status(400).json({ error: 'agentId, host, and port are required' });
  }
  const agent = state.registerAgent(agentId, host, port, maxConcurrency || config.MAX_CONCURRENCY);
  console.log(`[controller] Agent registered: ${agentId} @ ${host}:${port}`);
  res.json({ ok: true, agent });
});

app.get('/agents', (req, res) => res.json(state.getAllAgents()));

// ─── POST /job ────────────────────────────────────────────────────────────────

app.post('/job', upload.fields([{ name: 'script' }, { name: 'data' }]), async (req, res) => {
  const scriptFile = req.files && req.files['script'] && req.files['script'][0];
  const dataFile   = req.files && req.files['data']   && req.files['data'][0];

  if (!scriptFile || !dataFile) {
    return res.status(400).json({ error: 'Both "script" (.py) and "data" files are required' });
  }

  const jobId     = uuidv4();
  const jobDir    = path.join(config.JOBS_DIR, jobId);
  const chunksDir = path.join(jobDir, 'chunks');

  fs.mkdirSync(jobDir,    { recursive: true });
  fs.mkdirSync(chunksDir, { recursive: true });

  const scriptPath = path.join(jobDir, 'script.py');
  const dataPath   = path.join(jobDir, 'data.txt');
  fs.renameSync(scriptFile.path, scriptPath);
  fs.renameSync(dataFile.path,   dataPath);

  const job = state.createJob(jobId, scriptPath, dataPath);
  res.json({ jobId, status: job.status });

  setImmediate(async () => {
    try {
      const registeredAgents = state.getAllAgents();
      const numChunks = Math.min(
        registeredAgents.length > 0 ? registeredAgents.length : 1,
        config.MAX_CHUNKS
      );

      // --- VERBOSE: show what files were received ---
      const dataLines   = fs.readFileSync(dataPath, 'utf8').split('\n').filter(l => l.trim()).length;
      const scriptLines = fs.readFileSync(scriptPath, 'utf8').split('\n').length;
      console.log('');
      console.log('='.repeat(60));
      console.log(`  JOB RECEIVED`);
      console.log('='.repeat(60));
      console.log(`  Job ID     : ${jobId}`);
      console.log(`  Script     : ${path.basename(scriptFile.originalname || 'script.py')} (${scriptLines} lines)`);
      console.log(`  Data file  : ${path.basename(dataFile.originalname || 'data.txt')} (${dataLines} lines)`);
      console.log(`  Agents     : ${registeredAgents.map(a => a.agentId).join(', ')}`);
      console.log(`  Chunks     : ${numChunks} (one per agent)`);
      console.log('='.repeat(60));

      const chunkPaths = splitter.splitFile(dataPath, chunksDir, numChunks);

      // --- VERBOSE: show each chunk ---
      console.log('');
      console.log(`  SPLITTING  "${path.basename(dataFile.originalname || 'data.txt')}" into ${numChunks} chunks:`);
      chunkPaths.forEach((cp, i) => {
        const lines = fs.readFileSync(cp, 'utf8').split('\n').filter(l => l.trim()).length;
        console.log(`    chunk_${i}.txt  ->  ${lines} lines  ->  will run on agent-${i + 1}  [${cp}]`);
      });
      console.log('');

      chunkPaths.forEach((chunkPath, i) => {
        const task = state.createTask(jobId, i, chunkPath, scriptPath);
        job.tasks.push(task);
      });

      job.status = 'QUEUED';

      // --- VERBOSE: show execution plan ---
      console.log(`  EXECUTION PLAN:`);
      job.tasks.forEach((t, i) => {
        console.log(`    task-${i}  ->  chunk_${i}.txt  ->  python ${path.basename(scriptPath)}  ->  agent-${i + 1}`);
      });
      console.log('');

      await scheduler.scheduleJob(job);

    } catch (err) {
      job.status = 'FAILED';
      job.error  = err.message;
      console.error(`[controller] Job ${jobId} error: ${err.message}`);
    }
  });
});

// ─── GET /job/:jobId ──────────────────────────────────────────────────────────

app.get('/job/:jobId', (req, res) => {
  const job = state.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const response = {
    jobId:  job.jobId,
    status: job.status,
    tasks: job.tasks.map(t => ({
      taskId:        t.taskId,
      taskIndex:     t.taskIndex,
      status:        t.status,
      assignedAgent: t.assignedAgent,
      retries:       t.retries,
      error:         t.error,
    })),
  };

  if (job.status === 'MERGED') {
    response.result = job.mergedResult;
  }
  if (job.status === 'FAILED' || job.status === 'TIMED_OUT') {
    response.error = job.error;
  }

  res.json(response);
});

app.get('/jobs', (req, res) => {
  res.json(state.getAllJobs().map(j => ({
    jobId: j.jobId, status: j.status, tasks: j.tasks.length,
    created: j.createdAt, error: j.error,
  })));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, agents: state.getAllAgents().length, jobs: state.getAllJobs().length });
});

// ─── Activity log (ring buffer) ───────────────────────────────────────────────

const activityLog = [];
const MAX_LOG = 200;

function logActivity(msg) {
  activityLog.push({ ts: Date.now(), msg });
  if (activityLog.length > MAX_LOG) activityLog.shift();
}

// Patch scheduler to emit activity
const _origSchedule = scheduler.scheduleJob.bind(scheduler);
scheduler.scheduleJob = async function(job) {
  logActivity(`Job ${job.jobId.slice(0, 8)}… submitted — ${job.tasks.length} tasks`);
  return _origSchedule(job);
};

app.get('/activity', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  res.json(activityLog.filter(e => e.ts > since));
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

app.get('/stats', async (req, res) => {
  const allJobs   = state.getAllJobs();
  const allAgents = state.getAllAgents();

  const jobStats = {
    total:     allJobs.length,
    running:   allJobs.filter(j => j.status === 'RUNNING' || j.status === 'QUEUED').length,
    completed: allJobs.filter(j => j.status === 'MERGED').length,
    failed:    allJobs.filter(j => j.status === 'FAILED' || j.status === 'TIMED_OUT').length,
    splitting: allJobs.filter(j => j.status === 'SPLITTING').length,
  };

  const allTasks = allJobs.flatMap(j => j.tasks);
  const taskStats = {
    total:     allTasks.length,
    active:    allTasks.filter(t => t.status === 'ASSIGNED').length,
    completed: allTasks.filter(t => t.status === 'COMPLETED').length,
    failed:    allTasks.filter(t => t.status === 'FAILED').length,
    queued:    allTasks.filter(t => t.status === 'QUEUED').length,
  };

  // Fetch health for each agent in parallel
  const agentHealth = await Promise.allSettled(
    allAgents.map(async agent => {
      try {
        const r = await require('axios').get(
          `http://${agent.host}:${agent.port}/health`, { timeout: 3000 }
        );
        return { ...agent, ...r.data, online: true };
      } catch {
        return { ...agent, cpu: 0, memory: 0, activeTasks: 0, online: false };
      }
    })
  );

  res.json({
    jobs:   jobStats,
    tasks:  taskStats,
    agents: agentHealth.map(r => r.value || r.reason),
  });
});

// ─── DELETE /job/:jobId — kill/cancel a job ───────────────────────────────────

app.delete('/job/:jobId', (req, res) => {
  const job = state.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'MERGED' || job.status === 'FAILED') {
    return res.status(400).json({ error: `Job already in terminal state: ${job.status}` });
  }
  job.status = 'FAILED';
  job.error  = 'Killed by operator via dashboard';
  if (job.jobTimer) { clearTimeout(job.jobTimer); job.jobTimer = null; }
  logActivity(`Job ${job.jobId.slice(0, 8)}… killed by operator`);
  res.json({ ok: true });
});

fs.mkdirSync(config.JOBS_DIR, { recursive: true });
fs.mkdirSync('tmp_uploads',   { recursive: true });

app.listen(config.CONTROLLER_PORT, () => {
  console.log(`[controller] Listening on port ${config.CONTROLLER_PORT}`);
  console.log(`[controller] JOBS_DIR: ${path.resolve(config.JOBS_DIR)}`);
});

module.exports = app;
