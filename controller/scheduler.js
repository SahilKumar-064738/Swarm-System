'use strict';

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');

const config  = require('../config');
const state   = require('./state');
const merger  = require('./merger');

// --- Agent health / scoring ---------------------------------------------------

async function fetchHealth(agent) {
  const url = `http://${agent.host}:${agent.port}/health`;
  try {
    const res = await axios.get(url, { timeout: 5000 });
    state.markAgentReachable(agent.agentId);
    return { agent, health: res.data, reachable: true };
  } catch (err) {
    console.warn(`[scheduler] Agent ${agent.agentId} unreachable: ${err.message}`);
    state.markAgentUnreachable(agent.agentId);
    return { agent, health: null, reachable: false };
  }
}

/**
 * Score formula (lower is better):
 *   0.5 * cpu + 0.3 * memory + 0.2 * (activeTasks / maxConcurrency)
 */
function scoreAgent(health) {
  const cpu  = health.cpu    || 0;
  const mem  = health.memory || 0;
  const load = health.activeTasks / Math.max(health.maxConcurrency, 1);
  return 0.5 * cpu + 0.3 * mem + 0.2 * load;
}

/**
 * Pick the least-loaded agent that:
 *   (a) is reachable
 *   (b) has activeTasks < maxConcurrency
 *   (c) is not in the task's excludedAgents list
 */
function pickAgent(healthResults, excludedAgents) {
  const candidates = healthResults
    .filter(h => h.reachable && h.health)
    .filter(h => h.health.activeTasks < h.health.maxConcurrency)
    .filter(h => !excludedAgents.includes(h.agent.agentId));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => scoreAgent(a.health) - scoreAgent(b.health));
  return candidates[0].agent;
}

// --- Task assignment ----------------------------------------------------------

async function assignTaskToAgent(task, agent) {
  const url = `http://${agent.host}:${agent.port}/task`;
  const payload = {
    taskId:     task.taskId,
    chunkPath:  path.resolve(task.chunkPath),
    scriptPath: path.resolve(task.scriptPath),
  };

  try {
    const res = await axios.post(url, payload, {
      timeout: config.TASK_TIMEOUT_MS + 10000,
    });

    if (res.status === 200 && res.data && !res.data.error) {
      return { success: true, result: res.data.result };
    }
    return { success: false, error: res.data.error || 'Unknown error', agentId: agent.agentId };
  } catch (err) {
    return { success: false, error: err.message, agentId: agent.agentId };
  }
}

// --- Finalisation -------------------------------------------------------------

function finaliseJob(job) {
  const sortedTasks = job.tasks.slice().sort((a, b) => a.taskIndex - b.taskIndex);
  const rawResults  = sortedTasks.map(t => t.result);

  try {
    const { type, value } = merger.mergeResults(rawResults);

    const output = { jobId: job.jobId, type, result: value };
    const outputPath = path.join(path.dirname(job.scriptPath), '..', 'output.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

    job.mergedResult = output;
    job.status = 'MERGED';
    job.outputPath = outputPath;

    if (job.jobTimer) {
      clearTimeout(job.jobTimer);
      job.jobTimer = null;
    }

    // --- VERBOSE: merged result summary ---
    console.log('');
    console.log('='.repeat(60));
    console.log('  JOB COMPLETE');
    console.log('='.repeat(60));
    console.log('  Job ID      : ' + job.jobId);
    console.log('  Merge type  : ' + type);
    if (type === 'number') {
      console.log('  Result      : ' + value);
    } else if (type === 'array') {
      console.log('  Result      : array with ' + value.length + ' items');
      console.log('  Preview     : ' + JSON.stringify(value.slice(0, 5)) + (value.length > 5 ? '...' : ''));
    } else if (type === 'object') {
      const keys = Object.keys(value);
      const top5 = keys.sort((a,b) => (value[b]||0)-(value[a]||0)).slice(0,5);
      console.log('  Result      : object with ' + keys.length + ' unique keys (words)');
      console.log('  Top words   : ' + top5.map(k => k+'='+value[k]).join(', '));
    } else {
      const lines = String(value).split('\n').length;
      console.log('  Result      : ' + lines + ' lines of text');
    }
    console.log('  Output file : ' + outputPath);
    console.log('='.repeat(60));
    console.log('');

    setTimeout(() => cleanupChunks(job), config.CHUNK_TTL_MS);
  } catch (err) {
    failJob(job, `Merge error: ${err.message}`);
  }
}

function failJob(job, reason) {
  job.status = 'FAILED';
  job.error  = reason;
  if (job.jobTimer) {
    clearTimeout(job.jobTimer);
    job.jobTimer = null;
  }
  console.error(`[scheduler] Job ${job.jobId} FAILED: ${reason}`);
}

function cleanupChunks(job) {
  try {
    const chunksDir = path.join(path.dirname(job.scriptPath), '..', 'chunks');
    if (fs.existsSync(chunksDir)) {
      fs.rmSync(chunksDir, { recursive: true, force: true });
      console.log(`[scheduler] Cleaned up chunks for job ${job.jobId}`);
    }
  } catch (err) {
    console.warn(`[scheduler] Chunk cleanup failed for ${job.jobId}: ${err.message}`);
  }
}

// --- Round-robin pre-assignment ----------------------------------------------

/**
 * Before launching tasks in parallel, pre-assign each task to an agent
 * using round-robin so work is spread evenly. This avoids the race where
 * all tasks query health simultaneously, see activeTasks=0 everywhere,
 * and all pick the same (lowest-scored) agent.
 */
async function preAssignRoundRobin(tasks) {
  const allAgents     = state.getAllAgents();
  const healthResults = await Promise.all(allAgents.map(fetchHealth));
  const available     = healthResults
    .filter(h => h.reachable && h.health)
    .sort((a, b) => scoreAgent(a.health) - scoreAgent(b.health));

  const assignments = new Map();
  if (available.length === 0) return assignments;

  tasks.forEach((task, i) => {
    const chosen = available[i % available.length].agent;
    assignments.set(task.taskId, chosen);
  });

  return assignments;
}

// --- Main scheduling loop ----------------------------------------------------

/**
 * Process a single task.
 * First attempt uses the pre-assigned agent (round-robin).
 * Retries use health-based selection.
 */
async function processTask(task, job, preAssignedAgent) {
  let firstAttempt = true;

  while (true) {
    if (job.status === 'FAILED' || job.status === 'TIMED_OUT') {
      return;
    }

    let chosenAgent = null;

    if (firstAttempt && preAssignedAgent && !task.excludedAgents.includes(preAssignedAgent.agentId)) {
      chosenAgent  = preAssignedAgent;
      firstAttempt = false;
    } else {
      firstAttempt = false;
      const allAgents     = state.getAllAgents();
      const healthResults = await Promise.all(allAgents.map(fetchHealth));
      chosenAgent         = pickAgent(healthResults, task.excludedAgents);
    }

    if (!chosenAgent) {
      console.log(`[scheduler] No available agent for task ${task.taskId}. Retrying in ${config.SCHEDULER_POLL_MS}ms`);
      await sleep(config.SCHEDULER_POLL_MS);
      continue;
    }

    task.status        = 'ASSIGNED';
    task.assignedAgent = chosenAgent.agentId;
    task.assignedAt    = Date.now();

    console.log(`[scheduler] Assigning task ${task.taskId} -> agent ${chosenAgent.agentId}`);

    const outcome = await assignTaskToAgent(task, chosenAgent);

    if (outcome.success) {
      task.status = 'COMPLETED';
      task.result = outcome.result;
      console.log(`[scheduler] Task ${task.taskId} COMPLETED`);
      return;
    }

    console.warn(`[scheduler] Task ${task.taskId} failed on agent ${outcome.agentId}: ${outcome.error}`);
    task.retries += 1;
    task.excludedAgents.push(outcome.agentId);

    const isConnectionErr = outcome.error && (
      outcome.error.includes('ECONNREFUSED') ||
      outcome.error.includes('ECONNRESET') ||
      outcome.error.includes('timeout') ||
      outcome.error.includes('ETIMEDOUT')
    );
    if (isConnectionErr) {
      state.markAgentUnreachable(outcome.agentId);
    }

    if (task.retries >= config.MAX_RETRIES) {
      task.status = 'FAILED';
      task.error  = outcome.error;
      failJob(job, `Task ${task.taskId} exceeded MAX_RETRIES (${config.MAX_RETRIES}). Last error: ${outcome.error}`);
      return;
    }

    task.status = 'QUEUED';
    console.log(`[scheduler] Re-queuing task ${task.taskId} (retry ${task.retries}/${config.MAX_RETRIES})`);
    await sleep(config.RETRY_DELAY_MS);
  }
}

/**
 * Main entry point. Pre-assigns tasks round-robin then launches all in parallel.
 */
async function scheduleJob(job) {
  job.status = 'RUNNING';

  job.jobTimer = setTimeout(() => {
    if (job.status !== 'MERGED' && job.status !== 'FAILED') {
      failJob(job, 'Job exceeded wall-clock timeout');
      job.status = 'TIMED_OUT';
    }
  }, config.JOB_TIMEOUT_MS);

  // Pre-assign tasks across agents in round-robin BEFORE launching in parallel.
  // This ensures task-0 -> agent-1, task-1 -> agent-2, task-2 -> agent-1, etc.
  // Without this, all tasks see activeTasks=0 on all agents and pile onto agent-1.
  const preAssignments = await preAssignRoundRobin(job.tasks);

  // Launch all tasks concurrently
  const taskPromises = job.tasks.map(task => {
    const preAssigned = preAssignments.get(task.taskId) || null;
    return processTask(task, job, preAssigned);
  });

  try {
    await Promise.all(taskPromises);
  } catch (err) {
    failJob(job, `Unexpected scheduler error: ${err.message}`);
    return;
  }

  if (job.status === 'FAILED' || job.status === 'TIMED_OUT') {
    return;
  }

  const allDone = job.tasks.every(t => t.status === 'COMPLETED');
  if (allDone) {
    finaliseJob(job);
  } else {
    failJob(job, 'Not all tasks completed successfully');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { scheduleJob };
