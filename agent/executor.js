'use strict';

const { spawn } = require('child_process');
const path      = require('path');
const config    = require('../config');

function executePythonTask(scriptPath, chunkPath, taskId) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let   timedOut     = false;
    let   settled      = false;

    // --- VERBOSE: show exactly what is being executed ---
    console.log('');
    console.log(`  [EXECUTE] Task: ${taskId}`);
    console.log(`            Script : ${scriptPath}`);
    console.log(`            Chunk  : ${chunkPath}`);
    console.log(`            Command: ${config.PYTHON_BIN} "${path.basename(scriptPath)}" "${path.basename(chunkPath)}"`);
    const startTime = Date.now();

    const proc = spawn(config.PYTHON_BIN, [scriptPath, chunkPath], {
      cwd: process.cwd(),
      env: process.env,
    });

    const timeoutHandle = setTimeout(async () => {
      timedOut = true;
      console.warn(`[executor] Task ${taskId} timed out after ${config.TASK_TIMEOUT_MS}ms - sending SIGTERM`);
      proc.kill('SIGTERM');
      await sleep(config.SIGKILL_WAIT_MS);
      if (!settled) {
        try { proc.kill('SIGKILL'); } catch (_) {}
      }
    }, config.TASK_TIMEOUT_MS);

    proc.stdout.on('data', chunk => stdoutChunks.push(chunk));
    proc.stderr.on('data', chunk => stderrChunks.push(chunk));

    proc.on('error', err => {
      settled = true;
      clearTimeout(timeoutHandle);
      reject(new Error(`Spawn error for task ${taskId}: ${err.message}`));
    });

    proc.on('close', (code) => {
      settled = true;
      clearTimeout(timeoutHandle);

      const elapsed = Date.now() - startTime;
      const stderr  = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (stderr) {
        console.error(`[executor] Task ${taskId} stderr:\n${stderr}`);
      }

      if (timedOut) {
        return reject(new Error(`TIMEOUT: task ${taskId} exceeded ${config.TASK_TIMEOUT_MS}ms`));
      }

      if (code !== 0) {
        const snippet = stderr.length > 300 ? stderr.slice(0, 300) + '...' : stderr;
        return reject(new Error(`Python exited with code ${code} for task ${taskId}. stderr: ${snippet}`));
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');

      // --- VERBOSE: show result ---
      const preview = stdout.trim().slice(0, 120);
      console.log(`  [DONE]    Task: ${taskId}  (${elapsed}ms)`);
      console.log(`            Result preview: ${preview}${stdout.trim().length > 120 ? '...' : ''}`);
      console.log('');

      resolve(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { executePythonTask };
