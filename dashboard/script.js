'use strict';

// ──────────────────────────────────────────────
//  CONFIG
// ──────────────────────────────────────────────

const API_BASE    = 'http://localhost:3000';
const POLL_MS     = 2000;
const MAX_ACTIVITY = 100;

// ──────────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────────

let state = {
  stats:        null,
  jobs:         [],
  selectedJobId: null,
  activityTs:   0,
  activityItems: [],
  connected:    false,
};

// ──────────────────────────────────────────────
//  DOM REFS
// ──────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  connectionDot:   $('connectionDot'),
  connectionLabel: $('connectionLabel'),
  lastUpdate:      $('lastUpdate'),
  refreshBtn:      $('refreshBtn'),

  totalAgents:     $('totalAgents'),
  totalJobs:       $('totalJobs'),
  runningJobs:     $('runningJobs'),
  completedJobs:   $('completedJobs'),
  failedJobs:      $('failedJobs'),
  activeTasks:     $('activeTasks'),

  agentCount:      $('agentCount'),
  agentsList:      $('agentsList'),

  activityFeed:    $('activityFeed'),
  clearActivityBtn:$('clearActivityBtn'),

  jobCount:        $('jobCount'),
  jobsTableBody:   $('jobsTableBody'),

  jobDetailPanel:  $('jobDetailPanel'),
  jobDetailContent:$('jobDetailContent'),
  closeDetailBtn:  $('closeDetailBtn'),

  submitModal:     $('submitModal'),
  openModalBtn:    $('openModalBtn'),
  closeModalBtn:   $('closeModalBtn'),
  scriptFile:      $('scriptFile'),
  dataFile:        $('dataFile'),
  submitJobBtn:    $('submitJobBtn'),
  submitStatus:    $('submitStatus'),
};

// ──────────────────────────────────────────────
//  API HELPERS
// ──────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, { ...opts, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchStats() {
  return apiFetch('/stats');
}

async function fetchJobs() {
  return apiFetch('/jobs');
}

async function fetchJobDetail(jobId) {
  return apiFetch(`/job/${jobId}`);
}

async function fetchActivity(since) {
  return apiFetch(`/activity?since=${since}`);
}

async function killJob(jobId) {
  return apiFetch(`/job/${jobId}`, { method: 'DELETE' });
}

// ──────────────────────────────────────────────
//  CONNECTION STATUS
// ──────────────────────────────────────────────

function setConnected(ok) {
  state.connected = ok;
  dom.connectionDot.className   = 'status-dot ' + (ok ? 'online' : 'offline');
  dom.connectionLabel.textContent = ok ? 'Connected' : 'Disconnected';
}

function updateTimestamp() {
  const now = new Date();
  dom.lastUpdate.textContent = now.toLocaleTimeString();
}

// ──────────────────────────────────────────────
//  STATUS CHIP
// ──────────────────────────────────────────────

function statusChip(status) {
  const s = (status || 'unknown').toLowerCase();
  return `<span class="chip chip-${s}">${status}</span>`;
}

// ──────────────────────────────────────────────
//  RENDER: OVERVIEW
// ──────────────────────────────────────────────

function renderOverview(stats) {
  if (!stats) return;
  animateValue(dom.totalAgents,   stats.agents ? stats.agents.length : 0);
  animateValue(dom.totalJobs,     stats.jobs.total);
  animateValue(dom.runningJobs,   stats.jobs.running);
  animateValue(dom.completedJobs, stats.jobs.completed);
  animateValue(dom.failedJobs,    stats.jobs.failed);
  animateValue(dom.activeTasks,   stats.tasks.active);
}

function animateValue(el, newVal) {
  const old = el.textContent;
  if (String(old) !== String(newVal)) {
    el.textContent = newVal;
    el.style.transform = 'scale(1.15)';
    el.style.transition = 'transform 0.2s';
    setTimeout(() => { el.style.transform = ''; }, 200);
  }
}

// ──────────────────────────────────────────────
//  RENDER: AGENTS
// ──────────────────────────────────────────────

function renderAgents(agents) {
  if (!agents || agents.length === 0) {
    dom.agentsList.innerHTML = '<div class="empty-state">No agents registered</div>';
    dom.agentCount.textContent = '0';
    return;
  }

  dom.agentCount.textContent = agents.length;
  dom.agentsList.innerHTML = agents.map(a => agentCardHTML(a)).join('');
}

function agentCardHTML(a) {
  const cpu    = Math.round((a.cpu    || 0) * 100);
  const mem    = Math.round((a.memory || 0) * 100);
  const tasks  = a.activeTasks    || 0;
  const maxC   = a.maxConcurrency || 1;
  const taskPct = Math.round((tasks / maxC) * 100);
  const online = a.online !== false && a.reachable !== false;

  const cpuColor  = cpu  > 80 ? 'var(--red)'    : cpu  > 50 ? 'var(--yellow)' : 'var(--accent)';
  const memColor  = mem  > 80 ? 'var(--red)'    : mem  > 50 ? 'var(--yellow)' : 'var(--purple)';

  return `
    <div class="agent-card ${online ? 'online' : 'offline'}">
      <div>
        <div class="agent-id">${escHtml(a.agentId)}</div>
        <div class="agent-host">${escHtml(a.host)}:${a.port}</div>
      </div>
      <div>
        <span class="agent-status-badge ${online ? 'badge-online' : 'badge-offline'}">
          ${online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div class="agent-metrics">
        <div class="agent-metric">
          <div class="metric-bar-wrap">
            <div class="metric-bar bar-cpu" style="width:${cpu}%; background:${cpuColor};"></div>
          </div>
          <div class="metric-val" style="color:${cpuColor}">${cpu}%</div>
          <div class="metric-lbl">CPU</div>
        </div>
        <div class="agent-metric">
          <div class="metric-bar-wrap">
            <div class="metric-bar bar-mem" style="width:${mem}%; background:${memColor};"></div>
          </div>
          <div class="metric-val" style="color:${memColor}">${mem}%</div>
          <div class="metric-lbl">Memory</div>
        </div>
        <div class="agent-metric">
          <div class="metric-bar-wrap">
            <div class="metric-bar bar-tasks" style="width:${taskPct}%;"></div>
          </div>
          <div class="metric-val">${tasks}/${maxC}</div>
          <div class="metric-lbl">Tasks</div>
        </div>
        <div class="agent-metric">
          <div class="metric-bar-wrap" style="background:transparent;"></div>
          <div class="metric-val" style="color:var(--text2)">${maxC}</div>
          <div class="metric-lbl">MaxConc</div>
        </div>
      </div>
    </div>`;
}

// ──────────────────────────────────────────────
//  RENDER: JOBS TABLE
// ──────────────────────────────────────────────

function renderJobs(jobs) {
  dom.jobCount.textContent = jobs.length;

  if (jobs.length === 0) {
    dom.jobsTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No jobs yet — submit one!</td></tr>';
    return;
  }

  const sorted = [...jobs].sort((a, b) => (b.created || 0) - (a.created || 0));

  dom.jobsTableBody.innerHTML = sorted.map(j => {
    const selected = j.jobId === state.selectedJobId ? 'selected' : '';
    const canKill  = !['MERGED','FAILED','TIMED_OUT'].includes(j.status);
    const time     = j.created ? new Date(j.created).toLocaleTimeString() : '—';

    return `
      <tr class="${selected}" data-job="${escHtml(j.jobId)}">
        <td><span class="job-id" title="${escHtml(j.jobId)}">${j.jobId.slice(0,8)}…</span></td>
        <td>${statusChip(j.status)}</td>
        <td>${j.tasks}</td>
        <td>${time}</td>
        <td style="white-space:nowrap;display:flex;gap:5px;align-items:center;">
          <button class="btn btn-view" onclick="viewJob('${escHtml(j.jobId)}');event.stopPropagation()">Detail</button>
          ${canKill ? `<button class="btn btn-danger" onclick="handleKillJob('${escHtml(j.jobId)}');event.stopPropagation()">Kill</button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

// ──────────────────────────────────────────────
//  RENDER: JOB DETAIL
// ──────────────────────────────────────────────

async function viewJob(jobId) {
  state.selectedJobId = jobId;
  // Re-highlight row
  document.querySelectorAll('#jobsTableBody tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.job === jobId);
  });

  dom.jobDetailPanel.classList.remove('hidden');

  try {
    const detail = await fetchJobDetail(jobId);
    renderJobDetail(detail);
  } catch (err) {
    dom.jobDetailContent.innerHTML = `<div class="empty-state" style="color:var(--red)">Failed to load job: ${err.message}</div>`;
  }
}

function renderJobDetail(detail) {
  const time = detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '—';
  const completed  = (detail.tasks || []).filter(t => t.status === 'COMPLETED').length;
  const failed     = (detail.tasks || []).filter(t => t.status === 'FAILED').length;

  let resultHTML = '';
  if (detail.result) {
    const preview = typeof detail.result === 'object'
      ? JSON.stringify(detail.result, null, 2).slice(0, 600)
      : String(detail.result).slice(0, 600);
    resultHTML = `
      <div class="result-preview">
        <div class="result-title">Merged Result</div>
        <div class="result-body">${escHtml(preview)}</div>
      </div>`;
  }

  if (detail.error) {
    resultHTML = `
      <div class="result-preview" style="border-color:var(--red)">
        <div class="result-title" style="color:var(--red)">Error</div>
        <div class="result-body" style="color:var(--red)">${escHtml(detail.error)}</div>
      </div>`;
  }

  const tasksHTML = (detail.tasks || []).length === 0
    ? '<div class="empty-state">No tasks yet</div>'
    : `
      <table class="tasks-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Task ID</th>
            <th>Status</th>
            <th>Agent</th>
            <th>Retries</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${detail.tasks.map(t => `
            <tr>
              <td>${t.taskIndex}</td>
              <td style="font-size:10px;color:var(--text3)">${t.taskId.split('-task-')[1] ?? t.taskId.slice(-8)}</td>
              <td>${statusChip(t.status)}</td>
              <td>${t.assignedAgent ? `<span style="color:var(--accent)">${escHtml(t.assignedAgent)}</span>` : '—'}</td>
              <td>${t.retries || 0}</td>
              <td>${t.error ? `<span class="error-text" title="${escHtml(t.error)}">${escHtml(t.error)}</span>` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

  dom.jobDetailContent.innerHTML = `
    <div class="detail-meta">
      <div class="detail-meta-item">
        <div class="detail-meta-label">Job ID</div>
        <div class="detail-meta-value" style="font-size:10px;color:var(--accent)">${escHtml(detail.jobId)}</div>
      </div>
      <div class="detail-meta-item">
        <div class="detail-meta-label">Status</div>
        <div class="detail-meta-value">${statusChip(detail.status)}</div>
      </div>
      <div class="detail-meta-item">
        <div class="detail-meta-label">Tasks</div>
        <div class="detail-meta-value">
          <span style="color:var(--green)">${completed} done</span> /
          <span style="color:var(--red)">${failed} failed</span> /
          ${(detail.tasks || []).length} total
        </div>
      </div>
    </div>
    <div class="tasks-section-title">Task Breakdown</div>
    ${tasksHTML}
    ${resultHTML}`;
}

// ──────────────────────────────────────────────
//  RENDER: ACTIVITY FEED
// ──────────────────────────────────────────────

function appendActivity(entries) {
  if (!entries || entries.length === 0) return;

  // Dedupe
  const existing = new Set(state.activityItems.map(e => e.ts + e.msg));
  const fresh = entries.filter(e => !existing.has(e.ts + e.msg));
  if (fresh.length === 0) return;

  state.activityItems.push(...fresh);
  if (state.activityItems.length > MAX_ACTIVITY) {
    state.activityItems = state.activityItems.slice(-MAX_ACTIVITY);
  }

  // Clear empty state if present
  if (dom.activityFeed.querySelector('.empty-state')) {
    dom.activityFeed.innerHTML = '';
  }

  fresh.forEach(e => {
    const el = document.createElement('div');
    el.className = 'activity-entry';
    el.innerHTML = `
      <span class="activity-ts">${new Date(e.ts).toLocaleTimeString()}</span>
      <span class="activity-msg">${escHtml(e.msg)}</span>`;
    dom.activityFeed.appendChild(el);
  });

  // Auto-scroll
  dom.activityFeed.scrollTop = dom.activityFeed.scrollHeight;

  // Update max ts
  state.activityTs = Math.max(state.activityTs, ...fresh.map(e => e.ts));
}

// ──────────────────────────────────────────────
//  POLLING
// ──────────────────────────────────────────────

async function poll() {
  try {
    const [stats, jobs, activity] = await Promise.all([
      fetchStats(),
      fetchJobs(),
      fetchActivity(state.activityTs),
    ]);

    setConnected(true);
    state.stats = stats;
    state.jobs  = jobs;

    renderOverview(stats);
    renderAgents(stats.agents || []);
    renderJobs(jobs);
    appendActivity(activity);

    // Refresh selected job detail silently
    if (state.selectedJobId && !dom.jobDetailPanel.classList.contains('hidden')) {
      fetchJobDetail(state.selectedJobId)
        .then(renderJobDetail)
        .catch(() => {});
    }

    updateTimestamp();
  } catch (err) {
    setConnected(false);
  }
}

// ──────────────────────────────────────────────
//  JOB SUBMISSION
// ──────────────────────────────────────────────

async function submitJob() {
  const scriptFile = dom.scriptFile.files[0];
  const dataFile   = dom.dataFile.files[0];

  if (!scriptFile || !dataFile) {
    showSubmitStatus('Please select both files.', 'error');
    return;
  }

  const fd = new FormData();
  fd.append('script', scriptFile);
  fd.append('data', dataFile);

  dom.submitJobBtn.disabled = true;
  dom.submitJobBtn.textContent = 'Submitting…';
  hideSubmitStatus();

  try {
    const res = await fetch(`${API_BASE}/job`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showSubmitStatus(`Job submitted! ID: ${data.jobId.slice(0, 8)}…`, 'success');
    dom.scriptFile.value = '';
    dom.dataFile.value   = '';
    setTimeout(() => closeModal(), 1800);
    // Trigger immediate poll
    poll();
  } catch (err) {
    showSubmitStatus(`Failed: ${err.message}`, 'error');
  } finally {
    dom.submitJobBtn.disabled = false;
    dom.submitJobBtn.textContent = 'Submit Job';
  }
}

function showSubmitStatus(msg, type) {
  dom.submitStatus.textContent = msg;
  dom.submitStatus.className   = `submit-status ${type}`;
  dom.submitStatus.classList.remove('hidden');
}

function hideSubmitStatus() {
  dom.submitStatus.classList.add('hidden');
}

// ──────────────────────────────────────────────
//  KILL JOB
// ──────────────────────────────────────────────

async function handleKillJob(jobId) {
  if (!confirm(`Kill job ${jobId.slice(0, 8)}…?`)) return;
  try {
    await killJob(jobId);
    poll();
  } catch (err) {
    alert('Kill failed: ' + err.message);
  }
}

// ──────────────────────────────────────────────
//  MODAL
// ──────────────────────────────────────────────

function openModal() {
  dom.submitModal.classList.remove('hidden');
  hideSubmitStatus();
}

function closeModal() {
  dom.submitModal.classList.add('hidden');
}

// ──────────────────────────────────────────────
//  UTILITIES
// ──────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────
//  EVENTS
// ──────────────────────────────────────────────

dom.refreshBtn.addEventListener('click', poll);

dom.closeDetailBtn.addEventListener('click', () => {
  dom.jobDetailPanel.classList.add('hidden');
  state.selectedJobId = null;
  document.querySelectorAll('#jobsTableBody tr').forEach(tr => tr.classList.remove('selected'));
});

dom.clearActivityBtn.addEventListener('click', () => {
  state.activityItems = [];
  state.activityTs    = Date.now();
  dom.activityFeed.innerHTML = '<div class="empty-state">Cleared — waiting for events…</div>';
});

dom.openModalBtn.addEventListener('click', openModal);
dom.closeModalBtn.addEventListener('click', closeModal);
dom.submitJobBtn.addEventListener('click', submitJob);

dom.submitModal.addEventListener('click', e => {
  if (e.target === dom.submitModal) closeModal();
});

// Row click -> detail
dom.jobsTableBody.addEventListener('click', e => {
  const tr = e.target.closest('tr[data-job]');
  if (tr) viewJob(tr.dataset.job);
});

// Expose to inline onclick
window.viewJob         = viewJob;
window.handleKillJob   = handleKillJob;

// ──────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────

(function init() {
  poll();
  setInterval(poll, POLL_MS);
})();
