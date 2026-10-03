/**
 * OptiSched - DAA Hackathon Interactive Frontend
 * Multi-Machine Computational Task Scheduler based on Priority, Burst Time & Deadlines
 * Author: DAA Hackathon Team
 */

// Application State
const state = {
  presets: {},
  activePresetKey: 'cloud_cluster',
  tasks: [],
  machines: [],
  currentSchedule: [],
  currentMetrics: null,
  currentTrace: [],
  activeAlgorithm: 'dynamic_greedy',
  
  // Visualizer step player state
  stepIndex: 0,
  isPlaying: false,
  playTimer: null,
  
  // Dynamic greedy weights
  weightPri: 3.0,
  weightDead: 2.5,
  weightExec: 1.0
};

// Priority styling definitions
const PRIORITY_COLORS = {
  5: { bg: '#ef4444', border: '#b91c1c', text: '#ffffff', label: 'P5 Critical' },
  4: { bg: '#f97316', border: '#c2410c', text: '#ffffff', label: 'P4 High' },
  3: { bg: '#f59e0b', border: '#b45309', text: '#000000', label: 'P3 Medium' },
  2: { bg: '#10b981', border: '#047857', text: '#ffffff', label: 'P2 Low' },
  1: { bg: '#06b6d4', border: '#0e7490', text: '#ffffff', label: 'P1 Bulk' }
};

// ==============================================================================
// INITIALIZATION
// ==============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupModals();
  setupEventListeners();
  await loadPresets();
});

// Tab Switching
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');

      if (tab.dataset.tab === 'tab-arena' && !document.getElementById('arenaTableBody').children.length) {
        runBenchmarkArena();
      }
    });
  });
}

// Load Presets from REST API
async function loadPresets() {
  try {
    const res = await fetch('/api/presets');
    const data = await res.json();
    if (data.status === 'success') {
      state.presets = data.presets;
      applyPreset('cloud_cluster');
    }
  } catch (err) {
    showToast('Failed to load presets: ' + err.message, 'error');
  }
}

// Apply Selected Preset
function applyPreset(presetKey) {
  const p = state.presets[presetKey];
  if (!p) return;

  state.activePresetKey = presetKey;
  state.tasks = JSON.parse(JSON.stringify(p.tasks));
  state.machines = JSON.parse(JSON.stringify(p.machines));

  // Update preset chip button states
  document.querySelectorAll('.preset-buttons .btn-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === presetKey);
  });

  renderTasksTable();
  renderMachinesTable();
  runSchedule();
}

// ==============================================================================
// RUN SCHEDULER (API CALL & RENDER)
// ==============================================================================
async function runSchedule() {
  if (!state.tasks.length || !state.machines.length) {
    showToast('Add at least one task and one machine.', 'warning');
    return;
  }

  const algoSelect = document.getElementById('algorithmSelect');
  state.activeAlgorithm = algoSelect.value;

  try {
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        algorithm: state.activeAlgorithm,
        tasks: state.tasks,
        machines: state.machines,
        w_priority: state.weightPri,
        w_deadline: state.weightDead,
        w_exec: state.weightExec
      })
    });

    const data = await res.json();
    if (data.status === 'success') {
      state.currentSchedule = data.schedule;
      state.currentMetrics = data.metrics;
      state.currentTrace = data.trace;

      renderKPIs(data.metrics);
      renderGanttChart(data.schedule, state.machines);
      renderMachineLoadBars(data.metrics.machine_utilization);
      renderTraceTable(data.trace);
      initStepPlayer();
      showToast(`Scheduled with ${data.algorithm.acronym} in ${data.metrics.elapsed_ms}ms`, 'success');
    } else {
      showToast('Error: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Scheduling failed: ' + err.message, 'error');
  }
}

// ==============================================================================
// RENDER KPI STATS
// ==============================================================================
function renderKPIs(m) {
  document.getElementById('kpiMakespan').textContent = `${m.makespan} s`;
  document.getElementById('kpiElapsed').textContent = `Compute: ${m.elapsed_ms} ms`;

  document.getElementById('kpiOnTime').textContent = `${m.on_time_percentage}%`;
  document.getElementById('kpiMetRatio').textContent = `${m.met_deadline_count}/${m.scheduled_tasks} Tasks Met`;

  document.getElementById('kpiCritical').textContent = m.critical_tasks_on_time;
  document.getElementById('kpiMissed').textContent = `Missed: ${m.missed_deadline_count}`;

  document.getElementById('kpiPenalty').textContent = m.weighted_penalty;
  document.getElementById('kpiLoadStd').textContent = `Load StdDev: ±${m.load_balance_std_dev}`;

  document.getElementById('kpiTurnaround').textContent = `${m.avg_turnaround_time} s`;
  document.getElementById('kpiWait').textContent = `Avg Wait: ${m.avg_waiting_time} s`;
}

// ==============================================================================
// RENDER INTERACTIVE SVG GANTT CHART
// ==============================================================================
function renderGanttChart(schedule, machines) {
  const container = document.getElementById('ganttChart');
  container.innerHTML = '';

  if (!schedule.length || !machines.length) {
    container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No schedule data to display.</div>';
    return;
  }

  // Calculate timeline scale
  const maxTime = Math.max(...schedule.map(s => Math.max(s.end_time, s.deadline)), 10);
  const timeCeil = Math.ceil(maxTime / 5) * 5 + 5;

  const rowHeight = 65;
  const headerHeight = 40;
  const footerHeight = 35;
  const leftLabelWidth = 180;
  const totalChartHeight = headerHeight + (machines.length * rowHeight) + footerHeight;
  const chartWidth = Math.max(container.clientWidth - 40, 850);
  const timelineWidth = chartWidth - leftLabelWidth - 40;

  function timeToX(t) {
    return leftLabelWidth + (t / timeCeil) * timelineWidth;
  }

  // Build SVG XML string
  let svg = `<svg class="gantt-svg" width="${chartWidth}" height="${totalChartHeight}" viewBox="0 0 ${chartWidth} ${totalChartHeight}" xmlns="http://www.w3.org/2000/svg">`;

  // Background defs for stripes & shadows
  svg += `
    <defs>
      <pattern id="lateStripe" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="8" stroke="#ef4444" stroke-width="3" />
        <line x1="0" y1="0" x2="0" y2="8" stroke="#991b1b" stroke-width="8" opacity="0.3" />
      </pattern>
      <filter id="taskShadow" x="-5%" y="-10%" width="110%" height="130%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
      </filter>
    </defs>
  `;

  // Time grid vertical lines & timestamps
  const timeStep = timeCeil <= 30 ? 5 : timeCeil <= 60 ? 10 : 20;
  for (let t = 0; t <= timeCeil; t += timeStep) {
    const x = timeToX(t);
    svg += `
      <line x1="${x}" y1="${headerHeight}" x2="${x}" y2="${totalChartHeight - footerHeight}" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${x}" y="${headerHeight - 12}" fill="var(--text-secondary)" font-size="11" font-weight="600" text-anchor="middle">${t}s</text>
      <text x="${x}" y="${totalChartHeight - 12}" fill="var(--text-secondary)" font-size="11" font-weight="600" text-anchor="middle">${t}s</text>
    `;
  }

  // Draw Machine Rows & Labels
  machines.forEach((m, idx) => {
    const y = headerHeight + (idx * rowHeight);

    // Row alternating background
    svg += `
      <rect x="0" y="${y}" width="${chartWidth}" height="${rowHeight}" fill="${idx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'}" stroke="var(--border-color)" stroke-width="0.5"/>
    `;

    // Machine title label
    svg += `
      <g transform="translate(15, ${y + 25})">
        <text fill="var(--text-primary)" font-size="13" font-weight="700">${m.name}</text>
        <text y="18" fill="var(--accent-primary)" font-size="11" font-weight="600">Speed: ${m.speed_multiplier}x  |  [${m.capabilities.join(', ')}]</text>
      </g>
    `;
  });

  // Draw Scheduled Tasks
  schedule.forEach(item => {
    const mIdx = machines.findIndex(m => m.machine_id === item.machine_id);
    if (mIdx === -1) return;

    const rowY = headerHeight + (mIdx * rowHeight);
    const startX = timeToX(item.start_time);
    const endX = timeToX(item.end_time);
    const taskWidth = Math.max(endX - startX, 24);
    const barHeight = 36;
    const barY = rowY + 14;

    const priStyle = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS[3];
    const isLate = !item.met_deadline;

    // Task Rectangle
    svg += `
      <g class="gantt-task-group" data-task-id="${item.task_id}" id="gantt-node-${item.task_id}">
        <rect class="gantt-task-rect"
              x="${startX}" y="${barY}" width="${taskWidth}" height="${barHeight}" rx="6"
              fill="${priStyle.bg}"
              stroke="${isLate ? '#ef4444' : priStyle.border}"
              stroke-width="${isLate ? '2.5' : '1.5'}"
              filter="url(#taskShadow)"
              title="${item.task_name} | Start: ${item.start_time}s, End: ${item.end_time}s, Deadline: ${item.deadline}s"
        />
    `;

    // If late, add diagonal warning stripe overlay
    if (isLate) {
      svg += `
        <rect x="${startX}" y="${barY}" width="${taskWidth}" height="${barHeight}" rx="6" fill="url(#lateStripe)" opacity="0.35" pointer-events="none" />
      `;
    }

    // Task Label inside the rectangle
    if (taskWidth >= 40) {
      svg += `
        <text x="${startX + 8}" y="${barY + 22}" fill="${priStyle.text}" font-size="11" font-weight="700" pointer-events="none">
          ${item.task_name.length > 18 ? item.task_name.slice(0, 16) + '...' : item.task_name}
        </text>
      `;
    }

    // Deadline Marker (Inverted red triangle)
    const deadX = timeToX(item.deadline);
    svg += `
      <!-- Deadline Marker for ${item.task_name} -->
      <line x1="${deadX}" y1="${rowY + 4}" x2="${deadX}" y2="${rowY + rowHeight - 6}" stroke="${isLate ? '#ef4444' : '#10b981'}" stroke-width="2" stroke-dasharray="2,2"/>
      <polygon points="${deadX - 5},${rowY + 4} ${deadX + 5},${rowY + 4} ${deadX},${rowY + 12}" fill="${isLate ? '#ef4444' : '#10b981'}"/>
    `;

    svg += `</g>`;
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}

// ==============================================================================
// MACHINE LOAD DISTRIBUTION BARS
// ==============================================================================
function renderMachineLoadBars(utilization) {
  const container = document.getElementById('machineLoadBars');
  container.innerHTML = '';

  state.machines.forEach(m => {
    const pct = utilization[m.machine_id] || 0.0;
    const div = document.createElement('div');
    div.className = 'machine-load-item';
    div.innerHTML = `
      <div class="machine-load-header">
        <span><strong>${m.name}</strong> (${m.speed_multiplier}x speed)</span>
        <span><strong>${pct}%</strong> Utilization</span>
      </div>
      <div class="machine-progress-track">
        <div class="machine-progress-fill" style="width: ${Math.min(pct, 100)}%;"></div>
      </div>
    `;
    container.appendChild(div);
  });
}

// ==============================================================================
// TASK & MACHINE TABLES
// ==============================================================================
function renderTasksTable() {
  const tbody = document.getElementById('tasksTableBody');
  tbody.innerHTML = '';
  document.getElementById('taskCountLabel').textContent = state.tasks.length;

  state.tasks.forEach((t, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${t.task_id}</strong></td>
      <td>${t.name}</td>
      <td><span class="badge pri-${t.priority}">P${t.priority}</span></td>
      <td>${t.execution_time} s</td>
      <td><strong>${t.deadline} s</strong></td>
      <td>${t.arrival_time} s</td>
      <td><span style="font-size:0.75rem;opacity:0.8;">${t.required_capability || 'general'}</span></td>
      <td>
        <button class="btn btn-sm btn-ghost" onclick="deleteTask(${idx})">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function deleteTask(idx) {
  state.tasks.splice(idx, 1);
  renderTasksTable();
  runSchedule();
}

function renderMachinesTable() {
  const tbody = document.getElementById('machinesTableBody');
  tbody.innerHTML = '';
  document.getElementById('machineCountLabel').textContent = state.machines.length;

  state.machines.forEach((m, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${m.machine_id}</strong></td>
      <td>${m.name}</td>
      <td><span class="badge" style="background:rgba(59,130,246,0.2);color:#60a5fa;">${m.speed_multiplier}x</span></td>
      <td>${m.capabilities.join(', ')}</td>
      <td>
        ${state.machines.length > 1 ? `<button class="btn btn-sm btn-ghost" onclick="deleteMachine(${idx})">🗑️</button>` : '<span style="color:var(--text-muted);font-size:0.75rem;">Default</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function deleteMachine(idx) {
  if (state.machines.length <= 1) return;
  state.machines.splice(idx, 1);
  renderMachinesTable();
  runSchedule();
}

// ==============================================================================
// TAB 2: ALGORITHM ARENA & BENCHMARK
// ==============================================================================
async function runBenchmarkArena() {
  if (!state.tasks.length || !state.machines.length) return;

  const btn = document.getElementById('btnRunBenchmark');
  btn.disabled = true;
  btn.textContent = '⏳ Benchmarking...';

  try {
    const res = await fetch('/api/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: state.tasks,
        machines: state.machines
      })
    });

    const data = await res.json();
    if (data.status === 'success') {
      renderBenchmarkResults(data.data);
      showToast('All 6 algorithms benchmarked successfully!', 'success');
    }
  } catch (err) {
    showToast('Benchmark failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Run Full Arena Benchmark';
  }
}

function renderBenchmarkResults(data) {
  const tbody = document.getElementById('arenaTableBody');
  tbody.innerHTML = '';

  const results = Object.entries(data.benchmark).map(([key, val]) => ({
    key,
    ...val
  }));

  // Sort by composite score ascending (best first)
  results.sort((a, b) => (a.composite_score || 9999) - (b.composite_score || 9999));

  // Winner card display
  const winner = results[0];
  const winnerBanner = document.getElementById('winnerBanner');
  winnerBanner.style.display = 'flex';
  document.getElementById('winnerTitle').textContent = `🏆 Recommended Champion: ${winner.name} (${winner.acronym})`;
  document.getElementById('winnerReason').textContent = 
    `Ranked #1 with optimal weighted penalty (${winner.metrics.weighted_penalty}), makespan (${winner.metrics.makespan}s), and runtime (${winner.metrics.elapsed_ms}ms) under ${winner.paradigm}.`;

  results.forEach((r, idx) => {
    const m = r.metrics;
    const isWinner = idx === 0;
    const tr = document.createElement('tr');
    if (isWinner) tr.className = 'winner-row';

    tr.innerHTML = `
      <td><span class="rank-badge ${idx < 3 ? 'rank-' + (idx + 1) : ''}">${idx + 1}</span></td>
      <td><strong>${r.name}</strong> (${r.acronym})</td>
      <td><span style="font-size:0.75rem;opacity:0.85;">${r.paradigm}</span></td>
      <td><code>${r.time_complexity}</code></td>
      <td><strong>${m.makespan} s</strong></td>
      <td><span class="badge ${m.on_time_percentage === 100 ? 'status-on-time' : 'status-missed'}">${m.on_time_percentage}%</span></td>
      <td><strong style="color:${m.missed_deadline_count > 0 ? '#ef4444' : '#10b981'};">${m.missed_deadline_count}</strong></td>
      <td>${m.weighted_penalty}</td>
      <td>±${m.load_balance_std_dev}</td>
      <td><code>${m.elapsed_ms} ms</code></td>
    `;
    tbody.appendChild(tr);
  });

  renderComparisonCharts(results);
}

function renderComparisonCharts(results) {
  // 1. Makespan Chart
  const maxMakespan = Math.max(...results.map(r => r.metrics.makespan), 1);
  const chartMakespan = document.getElementById('barChartMakespan');
  chartMakespan.innerHTML = '';

  results.forEach((r, idx) => {
    const pct = (r.metrics.makespan / maxMakespan) * 100;
    const row = document.createElement('div');
    row.className = 'chart-bar-row';
    row.innerHTML = `
      <span>${r.acronym}</span>
      <div class="bar-track">
        <div class="bar-fill ${idx === 0 ? 'bar-winner' : ''}" style="width: ${pct}%;"></div>
      </div>
      <strong>${r.metrics.makespan}s</strong>
    `;
    chartMakespan.appendChild(row);
  });

  // 2. Penalty Chart
  const maxPenalty = Math.max(...results.map(r => r.metrics.weighted_penalty), 1);
  const chartPenalty = document.getElementById('barChartPenalty');
  chartPenalty.innerHTML = '';

  results.forEach((r, idx) => {
    const pct = maxPenalty === 0 ? 0 : (r.metrics.weighted_penalty / maxPenalty) * 100;
    const row = document.createElement('div');
    row.className = 'chart-bar-row';
    row.innerHTML = `
      <span>${r.acronym}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${pct}%; background-color: ${r.metrics.weighted_penalty === 0 ? '#10b981' : '#ef4444'};"></div>
      </div>
      <strong>${r.metrics.weighted_penalty}</strong>
    `;
    chartPenalty.appendChild(row);
  });

  // 3. Runtime Chart
  const maxRuntime = Math.max(...results.map(r => r.metrics.elapsed_ms), 0.1);
  const chartRuntime = document.getElementById('barChartRuntime');
  chartRuntime.innerHTML = '';

  results.forEach((r) => {
    const pct = Math.max((r.metrics.elapsed_ms / maxRuntime) * 100, 2);
    const row = document.createElement('div');
    row.className = 'chart-bar-row';
    row.innerHTML = `
      <span>${r.acronym}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${pct}%; background-color: #8b5cf6;"></div>
      </div>
      <code>${r.metrics.elapsed_ms}ms</code>
    `;
    chartRuntime.appendChild(row);
  });
}

// ==============================================================================
// TAB 3: LIVE STEP-BY-STEP VISUALIZER
// ==============================================================================
function renderTraceTable(trace) {
  const tbody = document.getElementById('traceTableBody');
  tbody.innerHTML = '';

  trace.forEach((step, idx) => {
    const tr = document.createElement('tr');
    tr.id = `trace-row-${idx}`;
    tr.innerHTML = `
      <td><strong>#${step.step}</strong></td>
      <td>t=${step.time !== undefined ? step.time + 's' : '-'}</td>
      <td><strong>${step.task_name || '-'}</strong></td>
      <td>${step.task_id ? `<span class="badge pri-3">Task</span>` : '-'}</td>
      <td>${step.machine_name || '-'}</td>
      <td>${step.start_time !== undefined ? `[${step.start_time}s → ${step.end_time}s]` : '-'}</td>
      <td>${step.deadline !== undefined ? `${step.deadline}s` : '-'}</td>
      <td>
        ${step.status ? `<span class="badge ${step.status.includes('ON TIME') ? 'status-on-time' : 'status-missed'}">${step.status}</span>` : '-'}
      </td>
      <td style="font-size:0.78rem;">${step.explanation}</td>
    `;
    tbody.appendChild(tr);
  });
}

function initStepPlayer() {
  state.stepIndex = 0;
  clearInterval(state.playTimer);
  state.isPlaying = false;
  document.getElementById('btnStepPlay').textContent = '▶ Auto Play';
  updateStepView();
}

function updateStepView() {
  const total = state.currentTrace.length;
  document.getElementById('stepCounterLabel').textContent = `Step ${total === 0 ? 0 : state.stepIndex + 1} / ${total}`;

  if (total === 0) return;

  const step = state.currentTrace[state.stepIndex];
  document.getElementById('stepNumberBadge').textContent = `Step #${step.step}`;
  document.getElementById('stepActionTitle').textContent = step.task_name ? `Assigned '${step.task_name}' → ${step.machine_name}` : 'Algorithmic Exploration';
  document.getElementById('stepActionExplanation').textContent = step.explanation;

  const tags = document.getElementById('stepTags');
  tags.innerHTML = '';
  if (step.start_time !== undefined) {
    tags.innerHTML = `
      <span class="badge" style="background:rgba(59,130,246,0.2);color:#93c5fd;">Start: ${step.start_time}s</span>
      <span class="badge" style="background:rgba(16,185,129,0.2);color:#6ee7b7;">End: ${step.end_time}s</span>
      <span class="badge" style="background:rgba(239,68,68,0.2);color:#fca5a5;">Deadline: ${step.deadline}s</span>
      <span class="badge ${step.status && step.status.includes('ON TIME') ? 'status-on-time' : 'status-missed'}">${step.status}</span>
    `;
  }

  // Highlight table row
  document.querySelectorAll('#traceTableBody tr').forEach(r => r.classList.remove('active-trace-row'));
  const row = document.getElementById(`trace-row-${state.stepIndex}`);
  if (row) {
    row.classList.add('active-trace-row');
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ==============================================================================
// EVENT LISTENERS & MODALS
// ==============================================================================
function setupEventListeners() {
  // Preset buttons
  document.querySelectorAll('.preset-buttons .btn-chip[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  // Random workload generator button
  document.getElementById('btnRandomGen').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/random?tasks=14&machines=3');
      const data = await res.json();
      if (data.status === 'success') {
        state.tasks = data.workload.tasks;
        state.machines = data.workload.machines;
        document.querySelectorAll('.preset-buttons .btn-chip').forEach(b => b.classList.remove('active'));
        renderTasksTable();
        renderMachinesTable();
        runSchedule();
        showToast('Generated 14 random stress-test tasks.', 'success');
      }
    } catch (err) {
      showToast('Random generator error: ' + err.message, 'error');
    }
  });

  // Run Schedule button
  document.getElementById('btnRunSchedule').addEventListener('click', runSchedule);
  document.getElementById('algorithmSelect').addEventListener('change', runSchedule);

  // Dynamic weights sliders
  const sPri = document.getElementById('sliderWeightPri');
  const sDead = document.getElementById('sliderWeightDead');
  const sExec = document.getElementById('sliderWeightExec');

  sPri.addEventListener('input', (e) => {
    state.weightPri = parseFloat(e.target.value);
    document.getElementById('lblWeightPri').textContent = state.weightPri.toFixed(1);
    if (state.activeAlgorithm === 'dynamic_greedy') runSchedule();
  });
  sDead.addEventListener('input', (e) => {
    state.weightDead = parseFloat(e.target.value);
    document.getElementById('lblWeightDead').textContent = state.weightDead.toFixed(1);
    if (state.activeAlgorithm === 'dynamic_greedy') runSchedule();
  });
  sExec.addEventListener('input', (e) => {
    state.weightExec = parseFloat(e.target.value);
    document.getElementById('lblWeightExec').textContent = state.weightExec.toFixed(1);
    if (state.activeAlgorithm === 'dynamic_greedy') runSchedule();
  });

  // Clear tasks
  document.getElementById('btnClearTasks').addEventListener('click', () => {
    if (confirm('Clear all tasks?')) {
      state.tasks = [];
      renderTasksTable();
      runSchedule();
    }
  });

  // Benchmark arena button
  document.getElementById('btnRunBenchmark').addEventListener('click', runBenchmarkArena);

  // Step visualizer player controls
  document.getElementById('btnStepFirst').addEventListener('click', () => {
    state.stepIndex = 0;
    updateStepView();
  });
  document.getElementById('btnStepPrev').addEventListener('click', () => {
    if (state.stepIndex > 0) {
      state.stepIndex--;
      updateStepView();
    }
  });
  document.getElementById('btnStepNext').addEventListener('click', () => {
    if (state.stepIndex < state.currentTrace.length - 1) {
      state.stepIndex++;
      updateStepView();
    }
  });
  document.getElementById('btnStepLast').addEventListener('click', () => {
    state.stepIndex = Math.max(0, state.currentTrace.length - 1);
    updateStepView();
  });

  const playBtn = document.getElementById('btnStepPlay');
  playBtn.addEventListener('click', () => {
    if (state.isPlaying) {
      clearInterval(state.playTimer);
      state.isPlaying = false;
      playBtn.textContent = '▶ Auto Play';
    } else {
      if (state.stepIndex >= state.currentTrace.length - 1) state.stepIndex = 0;
      state.isPlaying = true;
      playBtn.textContent = '⏸ Pause';
      state.playTimer = setInterval(() => {
        if (state.stepIndex < state.currentTrace.length - 1) {
          state.stepIndex++;
          updateStepView();
        } else {
          clearInterval(state.playTimer);
          state.isPlaying = false;
          playBtn.textContent = '▶ Auto Play';
        }
      }, 1000);
    }
  });

  // Theme toggle
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
  });

  // Export report
  document.getElementById('exportReportBtn').addEventListener('click', exportScheduleReport);
}

// Setup Modals
function setupModals() {
  const modalTask = document.getElementById('modalAddTask');
  const modalMach = document.getElementById('modalAddMachine');

  document.getElementById('btnAddTaskModal').addEventListener('click', () => modalTask.classList.add('open'));
  document.getElementById('btnAddMachineModal').addEventListener('click', () => modalMach.classList.add('open'));

  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      modalTask.classList.remove('open');
      modalMach.classList.remove('open');
    });
  });

  // Form: Add Task
  document.getElementById('formAddTask').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('inputTaskName').value.trim();
    const priority = parseInt(document.getElementById('inputTaskPriority').value);
    const exec = parseFloat(document.getElementById('inputTaskExec').value);
    const deadline = parseFloat(document.getElementById('inputTaskDeadline').value);
    const arrival = parseFloat(document.getElementById('inputTaskArrival').value);
    const cap = document.getElementById('inputTaskCapability').value;

    const newId = `T${state.tasks.length + 1}`;
    state.tasks.push({
      task_id: newId,
      name: name || `Task #${state.tasks.length + 1}`,
      priority,
      execution_time: exec,
      deadline,
      arrival_time: arrival,
      required_capability: cap
    });

    modalTask.classList.remove('open');
    document.getElementById('formAddTask').reset();
    renderTasksTable();
    runSchedule();
    showToast(`Added task ${newId}`, 'success');
  });

  // Form: Add Machine
  document.getElementById('formAddMachine').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('inputMachineName').value.trim();
    const speed = parseFloat(document.getElementById('inputMachineSpeed').value);
    const cap = document.getElementById('inputMachineCapability').value;

    const newId = `M${state.machines.length + 1}`;
    state.machines.push({
      machine_id: newId,
      name: name || `Machine #${state.machines.length + 1}`,
      speed_multiplier: speed,
      capabilities: [cap]
    });

    modalMach.classList.remove('open');
    document.getElementById('formAddMachine').reset();
    renderMachinesTable();
    runSchedule();
    showToast(`Added machine ${newId}`, 'success');
  });
}

// ==============================================================================
// EXPORT COMPREHENSIVE DAA REPORT
// ==============================================================================
function exportScheduleReport() {
  if (!state.currentMetrics) {
    showToast('No active schedule data to export.', 'warning');
    return;
  }

  const report = {
    project: "OptiSched - DAA Hackathon Multi-Machine Task Scheduler",
    timestamp: new Date().toISOString(),
    algorithm: state.activeAlgorithm,
    metrics: state.currentMetrics,
    tasks_count: state.tasks.length,
    machines_count: state.machines.length,
    schedule: state.currentSchedule,
    trace: state.currentTrace
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DAA_Schedule_Report_${state.activeAlgorithm}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Report downloaded successfully!', 'success');
}

// Toast helper
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
