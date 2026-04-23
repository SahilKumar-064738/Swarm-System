'use strict';

module.exports = {
  // Controller settings
  CONTROLLER_PORT: parseInt(process.env.CONTROLLER_PORT || '3000', 10),
  CONTROLLER_HOST: process.env.CONTROLLER_HOST || 'localhost',

  // Agent settings
  AGENT_PORT: parseInt(process.env.AGENT_PORT || '4000', 10),
  AGENT_ID: process.env.AGENT_ID || `agent-${process.pid}`,
  MAX_CONCURRENCY: parseInt(process.env.MAX_CONCURRENCY || '4', 10),

  // Task execution settings
  TASK_TIMEOUT_MS: parseInt(process.env.TASK_TIMEOUT_MS || '30000', 10),    // 30 seconds
  SIGKILL_WAIT_MS: parseInt(process.env.SIGKILL_WAIT_MS || '2000', 10),     // 2 seconds after SIGTERM

  // Retry / failure settings
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
  RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS || '500', 10),        // re-queue delay

  // Job-level wall-clock timeout
  JOB_TIMEOUT_MS: parseInt(process.env.JOB_TIMEOUT_MS || '300000', 10),    // 5 minutes

  // Chunk settings
  MAX_CHUNKS: parseInt(process.env.MAX_CHUNKS || '8', 10),

  // Python interpreter — Windows often uses 'python', Linux/Mac use 'python3'
  PYTHON_BIN: process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),

  // Temp file cleanup TTL (ms)
  CHUNK_TTL_MS: parseInt(process.env.CHUNK_TTL_MS || '3600000', 10),        // 1 hour

  // Scheduler poll interval when all agents saturated
  SCHEDULER_POLL_MS: parseInt(process.env.SCHEDULER_POLL_MS || '500', 10),

  // Jobs directory
  JOBS_DIR: process.env.JOBS_DIR || 'jobs',
};
