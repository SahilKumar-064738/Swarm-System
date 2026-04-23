'use strict';

/**
 * state.js — in-memory store for jobs and registered agents.
 *
 * Jobs map:   jobs[jobId]  = { jobId, status, scriptPath, dataPath, tasks[], createdAt, jobTimer }
 * Agents map: agents[agentId] = { agentId, host, port, maxConcurrency, reachable, registeredAt }
 */

const jobs = new Map();
const agents = new Map();

// ─── Job helpers ─────────────────────────────────────────────────────────────

function createJob(jobId, scriptPath, dataPath) {
  const job = {
    jobId,
    status: 'SPLITTING',
    scriptPath,
    dataPath,
    tasks: [],           // array of subtask objects (ordered by chunk index)
    mergedResult: null,
    error: null,
    createdAt: Date.now(),
    jobTimer: null,      // reference to job-level timeout handle
  };
  jobs.set(jobId, job);
  return job;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function getAllJobs() {
  return Array.from(jobs.values());
}

// ─── Subtask helpers ──────────────────────────────────────────────────────────

function createTask(jobId, taskIndex, chunkPath, scriptPath) {
  return {
    taskId: `${jobId}-task-${taskIndex}`,
    jobId,
    taskIndex,
    chunkPath,
    scriptPath,
    status: 'QUEUED',
    assignedAgent: null,
    assignedAt: null,
    result: null,          // raw stdout string
    retries: 0,
    error: null,
    excludedAgents: [],    // agents that already failed this task
  };
}

// ─── Agent helpers ────────────────────────────────────────────────────────────

function registerAgent(agentId, host, port, maxConcurrency) {
  const agent = {
    agentId,
    host,
    port,
    maxConcurrency,
    reachable: true,
    registeredAt: Date.now(),
  };
  agents.set(agentId, agent);
  return agent;
}

function getAgent(agentId) {
  return agents.get(agentId) || null;
}

function getAllAgents() {
  return Array.from(agents.values());
}

function markAgentUnreachable(agentId) {
  const agent = agents.get(agentId);
  if (agent) {
    agent.reachable = false;
  }
}

function markAgentReachable(agentId) {
  const agent = agents.get(agentId);
  if (agent) {
    agent.reachable = true;
  }
}

module.exports = {
  jobs,
  agents,
  createJob,
  getJob,
  getAllJobs,
  createTask,
  registerAgent,
  getAgent,
  getAllAgents,
  markAgentUnreachable,
  markAgentReachable,
};
