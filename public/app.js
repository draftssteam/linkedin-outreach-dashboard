/* ═══════════════════════════════════════════════════════════════════════
   LinkedIn Outreach Dashboard — Frontend JS
   SSE connection, Chart.js charts, live feed, table, filters, toasts
═══════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  events:       [],
  profiles:     [],
  campaigns:    [],
  stats:        null,
  timeline:     [],
  breakdown:    [],
  feedFilter:   'all',
  tableFilter:  { search: '', profile: '', event_type: '', campaign: '', date_from: '', date_to: '' },
  tableSortCol: 'received_at',
  tableSortDir: 'desc',
  tablePage:    1,
  tablePageSize: 50,
  feedItems:    [],
  lastEventTs:  null,
  charts:       {},
};

// ── SSE ────────────────────────────────────────────────────────────────────

let sseRetryTimer = null;

function connectSSE() {
  if (typeof EventSource === 'undefined') return;
  const es = new EventSource('/api/live-feed');

  es.addEventListener('connected', () => {
    setStatusPill(true);
  });

  es.addEventListener('new_event', (e) => {
    try {
      const event = JSON.parse(e.data);
      handleNewEvent(event);
    } catch (_) {}
  });

  es.onerror = () => {
    setStatusPill(false);
    es.close();
    clearTimeout(sseRetryTimer);
    sseRetryTimer = setTimeout(connectSSE, 5000);
  };
}

function setStatusPill(isLive) {
  const pill = document.getElementById('status-pill');
  if (!pill) return;
  if (isLive) {
    pill.className = 'status-pill live';
    pill.innerHTML = '<span class="status-dot"></span> LIVE';
  } else {
    pill.className = 'status-pill';
    pill.innerHTML = '<span class="status-dot"></span> OFFLINE';
  }
}

// ── Handle New SSE Event ───────────────────────────────────────────────────

function handleNewEvent(event) {
  // Add to local feed
  state.feedItems.unshift(event);
  if (state.feedItems.length > 100) state.feedItems.pop();
  renderFeed();

  // Update last seen timestamp
  state.lastEventTs = Date.now();
  updateLastUpdate();

  // Flash KPI cards and re-fetch stats
  refreshAll();
  showToast(event);
}

// ── API Helpers ────────────────────────────────────────────────────────────

async function apiFetch(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function init() {
  startClock();
  connectSSE();
  await refreshAll();
  populateFilterDropdowns();
  attachTableListeners();
  setInterval(updateLastUpdate, 15000);
}

async function refreshAll() {
  try {
    const [stats, profiles, campaigns, timelineData, breakdown, eventsData] = await Promise.all([
      apiFetch('/api/stats'),
      apiFetch('/api/profiles'),
      apiFetch('/api/campaigns'),
      apiFetch('/api/timeline?days=30'),
      apiFetch('/api/breakdown'),
      apiFetch('/api/events?limit=500'),
    ]);

    state.stats     = stats;
    state.profiles  = profiles;
    state.campaigns = campaigns;
    state.timeline  = timelineData;
    state.breakdown = breakdown;
    state.events    = eventsData.rows || [];

    // Seed feed from latest events if empty
    if (state.feedItems.length === 0) {
      state.feedItems = [...state.events].slice(0, 100);
    }

    renderKPIs(stats.overall);
    renderProfileCards(profiles);
    renderFeed();
    renderTable();
    renderCharts();
    renderCampaignTable(campaigns);
  } catch (err) {
    console.error('refreshAll error:', err);
  }
}

// ── Clock ──────────────────────────────────────────────────────────────────

function startClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' })
      + '  ' + now.toLocaleTimeString('en-GB');
  }
  tick();
  setInterval(tick, 1000);
}

function updateLastUpdate() {
  const el = document.getElementById('last-update');
  if (!el) return;
  if (!state.lastEventTs) { el.textContent = 'No events yet'; return; }
  const diff = Math.floor((Date.now() - state.lastEventTs) / 1000);
  if (diff < 60)  { el.textContent = `Last update: just now`; return; }
  if (diff < 3600){ el.textContent = `Last update: ${Math.floor(diff/60)}m ago`; return; }
  el.textContent = `Last update: ${Math.floor(diff/3600)}h ago`;
}

// ── KPI Cards ─────────────────────────────────────────────────────────────

function renderKPIs(overall) {
  if (!overall) return;
  animateCount('kpi-invites',     overall.invites_sent || 0);
  animateCount('kpi-accepted',    overall.accepted || 0);
  animateCount('kpi-replies',     overall.replied || 0);
  setKPI('kpi-accept-rate', (overall.acceptance_rate || '0.0') + '%');
  setKPI('kpi-reply-rate',  (overall.reply_rate || '0.0') + '%');
}

function setKPI(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.closest('.kpi-card')?.classList.add('flash');
  setTimeout(() => el.closest('.kpi-card')?.classList.remove('flash'), 700);
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  if (current === target) return;
  const step = Math.ceil(Math.abs(target - current) / 30);
  let val = current;
  const interval = setInterval(() => {
    val = target > val ? Math.min(val + step, target) : Math.max(val - step, target);
    el.textContent = val.toLocaleString();
    if (val === target) clearInterval(interval);
  }, 18);
  el.closest('.kpi-card')?.classList.add('flash');
  setTimeout(() => el.closest('.kpi-card')?.classList.remove('flash'), 700);
}

// ── Profile Cards ─────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '??';
  return name.split(/[\s—–-]+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function renderProfileCards(profiles) {
  const grid = document.getElementById('profile-grid');
  if (!grid) return;

  if (!profiles.length) {
    grid.innerHTML = `<div class="empty-profiles">🔗 No LinkedIn profiles yet — waiting for first webhook...</div>`;
    return;
  }

  grid.innerHTML = profiles.map(p => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const isActive = p.last_active > sevenDaysAgo;
    const acceptPct = parseFloat(p.acceptance_rate) || 0;
    const campaigns = (p.campaigns || []).map(c =>
      `<span class="campaign-tag">${escHtml(c || 'Unknown')}</span>`
    ).join('');

    return `
      <div class="profile-card">
        <div class="profile-header">
          <div class="profile-avatar">${getInitials(p.linkedin_profile_name)}</div>
          <div class="profile-info">
            <h3>${escHtml(p.linkedin_profile_name || p.linkedin_profile_id || 'Unknown')}</h3>
            <span class="profile-status ${isActive ? 'active' : 'inactive'}">${isActive ? '● Active' : '○ No recent activity'}</span>
          </div>
        </div>
        <div class="profile-stats">
          <div><div class="p-stat-label">Invites</div><div class="p-stat-value blue">${(p.invites_sent||0).toLocaleString()}</div></div>
          <div><div class="p-stat-label">Accepted</div><div class="p-stat-value green">${(p.accepted||0).toLocaleString()}</div></div>
          <div><div class="p-stat-label">Replied</div><div class="p-stat-value">${(p.replied||0).toLocaleString()}</div></div>
          <div><div class="p-stat-label">Accept%</div><div class="p-stat-value orange">${p.acceptance_rate}%</div></div>
          <div><div class="p-stat-label">Reply%</div><div class="p-stat-value">${p.reply_rate}%</div></div>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${Math.min(acceptPct,100)}%"></div></div>
          <span class="progress-label">${acceptPct}% accepted</span>
        </div>
        ${campaigns ? `<div class="profile-campaigns">${campaigns}</div>` : ''}
        <button class="btn-view-activity" onclick="filterFeedByProfile('${escAttr(p.linkedin_profile_id)}')">View Activity →</button>
      </div>`;
  }).join('');
}

window.filterFeedByProfile = function(profileId) {
  document.getElementById('feed-section')?.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('tbl-profile-filter').value = profileId;
  state.tableFilter.profile = profileId;
  state.tablePage = 1;
  renderTable();
};

// ── Live Feed ─────────────────────────────────────────────────────────────

const EVENT_META = {
  connection_accepted: { badge: 'ACCEPTED',    cls: 'badge-accepted',   icon: '🤝' },
  reply_received:      { badge: 'REPLIED',     cls: 'badge-replied',    icon: '💬' },
  tag_added:           { badge: 'TAG ADDED',   cls: 'badge-tag-added',  icon: '🏷️' },
  tag_removed:         { badge: 'TAG REMOVED', cls: 'badge-tag-removed',icon: '🏷️' },
  note_added:          { badge: 'NOTE ADDED',  cls: 'badge-note',       icon: '🗒️' },
};

function getEventMeta(type) {
  return EVENT_META[type] || { badge: (type||'EVENT').toUpperCase(), cls: 'badge-unknown', icon: '⚡' };
}

function renderFeed() {
  const list = document.getElementById('feed-list');
  if (!list) return;

  let items = state.feedItems;
  if (state.feedFilter !== 'all') {
    items = items.filter(e => {
      if (state.feedFilter === 'accepted') return e.event_type === 'connection_accepted';
      if (state.feedFilter === 'replied')  return e.event_type === 'reply_received';
      if (state.feedFilter === 'tags')     return e.event_type === 'tag_added' || e.event_type === 'tag_removed';
      if (state.feedFilter === 'notes')    return e.event_type === 'note_added';
      return true;
    });
  }

  if (!items.length) {
    list.innerHTML = `<div class="feed-empty"><div class="feed-empty-icon">📭</div>No events yet. Waiting for webhooks...</div>`;
    return;
  }

  list.innerHTML = items.map((e, i) => {
    const meta = getEventMeta(e.event_type);
    const ts = e.event_timestamp ? new Date(e.event_timestamp) : new Date(e.received_at);
    const dateStr = ts.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const timeStr = ts.toLocaleTimeString('en-GB');
    const dayStr  = e.day_of_week || '';
    const glow = i === 0 ? ' new-glow' : '';

    return `
      <div class="feed-item${glow}" data-type="${escAttr(e.event_type)}">
        <div class="feed-item-top">
          <span class="event-badge ${meta.cls}">${meta.icon} ${meta.badge}</span>
          <span class="feed-contact-name">${escHtml(e.contact_name || 'Unknown Contact')}</span>
          <span class="feed-profile-name">${escHtml(e.linkedin_profile_name || '')}</span>
        </div>
        <div class="feed-meta">📅 ${dateStr} &nbsp;⏰ ${timeStr}&nbsp; (${dayStr})${e.contact_linkedin_url ? ` &nbsp;<a href="${escAttr(e.contact_linkedin_url)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ''}</div>
        ${e.campaign_name ? `<div class="feed-campaign">📣 ${escHtml(e.campaign_name)}</div>` : ''}
        ${e.message_content ? `<div class="feed-message">💬 ${escHtml(e.message_content)}</div>` : ''}
        ${e.tag_name ? `<div class="feed-tag">🏷️ Tag: <strong>${escHtml(e.tag_name)}</strong></div>` : ''}
        ${e.note_content ? `<div class="feed-message">🗒️ ${escHtml(e.note_content)}</div>` : ''}
      </div>`;
  }).join('');
}

// Feed filter buttons
window.setFeedFilter = function(filter, btn) {
  state.feedFilter = filter;
  document.querySelectorAll('.feed-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFeed();
};

// ── Data Table ────────────────────────────────────────────────────────────

function getFilteredTableData() {
  let rows = [...state.events];
  const f = state.tableFilter;

  if (f.search) {
    const q = f.search.toLowerCase();
    rows = rows.filter(r =>
      (r.contact_name  || '').toLowerCase().includes(q) ||
      (r.campaign_name || '').toLowerCase().includes(q) ||
      (r.message_content || '').toLowerCase().includes(q) ||
      (r.tag_name || '').toLowerCase().includes(q)
    );
  }
  if (f.profile)    rows = rows.filter(r => r.linkedin_profile_id === f.profile);
  if (f.event_type) rows = rows.filter(r => r.event_type          === f.event_type);
  if (f.campaign)   rows = rows.filter(r => r.campaign_name       === f.campaign);
  if (f.date_from)  rows = rows.filter(r => (r.event_timestamp||'') >= f.date_from);
  if (f.date_to)    rows = rows.filter(r => (r.event_timestamp||'') <= f.date_to + 'T23:59:59');

  // Sort
  rows.sort((a, b) => {
    const va = a[state.tableSortCol] ?? '';
    const vb = b[state.tableSortCol] ?? '';
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return state.tableSortDir === 'asc' ? cmp : -cmp;
  });

  return rows;
}

function renderTable() {
  const filtered = getFilteredTableData();
  const total    = filtered.length;
  const ps       = state.tablePageSize;
  const page     = state.tablePage;
  const start    = (page - 1) * ps;
  const pageRows = filtered.slice(start, start + ps);

  const countEl = document.getElementById('table-row-count');
  if (countEl) countEl.textContent = `Showing ${Math.min(start+1,total)}–${Math.min(start+ps,total)} of ${total} events`;

  const tbody = document.querySelector('#events-table tbody');
  if (!tbody) return;

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No events match your filters.</td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map(r => {
      const meta = getEventMeta(r.event_type);
      const ts = r.event_timestamp ? new Date(r.event_timestamp) : new Date(r.received_at);
      const dateStr = ts.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) + ' ' + ts.toLocaleTimeString('en-GB');
      const msgContent = r.message_content || r.note_content || r.tag_name || '—';
      return `
        <tr>
          <td>${dateStr}</td>
          <td>${escHtml(r.linkedin_profile_name || r.linkedin_profile_id || '—')}</td>
          <td>${escHtml(r.campaign_name || '—')}</td>
          <td><span class="contact-name">${escHtml(r.contact_name || '—')}</span>${r.contact_linkedin_url ? `<br><a href="${escAttr(r.contact_linkedin_url)}" target="_blank" rel="noopener" style="font-size:11px">↗ LinkedIn</a>` : ''}</td>
          <td><span class="event-badge ${meta.cls}">${meta.icon} ${meta.badge}</span></td>
          <td>${escHtml(r.contact_email || '—')}</td>
          <td>${escHtml(r.contact_phone || '—')}</td>
          <td><span class="msg-cell">${escHtml(msgContent)}</span></td>
        </tr>`;
    }).join('');
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const prevBtn = document.getElementById('page-prev');
  const nextBtn = document.getElementById('page-next');
  const pageInfo = document.getElementById('page-info');
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
  if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
}

function attachTableListeners() {
  // Search
  document.getElementById('tbl-search')?.addEventListener('input', e => {
    state.tableFilter.search = e.target.value;
    state.tablePage = 1;
    renderTable();
  });
  // Profile filter
  document.getElementById('tbl-profile-filter')?.addEventListener('change', e => {
    state.tableFilter.profile = e.target.value;
    state.tablePage = 1;
    renderTable();
  });
  // Event type filter
  document.getElementById('tbl-type-filter')?.addEventListener('change', e => {
    state.tableFilter.event_type = e.target.value;
    state.tablePage = 1;
    renderTable();
  });
  // Campaign filter
  document.getElementById('tbl-campaign-filter')?.addEventListener('change', e => {
    state.tableFilter.campaign = e.target.value;
    state.tablePage = 1;
    renderTable();
  });
  // Date from
  document.getElementById('tbl-date-from')?.addEventListener('change', e => {
    state.tableFilter.date_from = e.target.value;
    state.tablePage = 1;
    renderTable();
  });
  // Date to
  document.getElementById('tbl-date-to')?.addEventListener('change', e => {
    state.tableFilter.date_to = e.target.value;
    state.tablePage = 1;
    renderTable();
  });
  // Sort headers
  document.querySelectorAll('#events-table thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.tableSortCol === col) {
        state.tableSortDir = state.tableSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.tableSortCol = col;
        state.tableSortDir = 'desc';
      }
      document.querySelectorAll('#events-table thead th').forEach(t => {
        t.classList.remove('sorted-asc', 'sorted-desc');
      });
      th.classList.add(state.tableSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      renderTable();
    });
  });
  // Pagination
  document.getElementById('page-prev')?.addEventListener('click', () => {
    if (state.tablePage > 1) { state.tablePage--; renderTable(); }
  });
  document.getElementById('page-next')?.addEventListener('click', () => {
    const total = getFilteredTableData().length;
    const max   = Math.ceil(total / state.tablePageSize);
    if (state.tablePage < max) { state.tablePage++; renderTable(); }
  });
  // Export CSV
  document.getElementById('btn-export')?.addEventListener('click', exportCSV);
}

function populateFilterDropdowns() {
  populateSelect('tbl-profile-filter', state.profiles.map(p => ({
    value: p.linkedin_profile_id,
    label: p.linkedin_profile_name || p.linkedin_profile_id,
  })), 'All Profiles');

  populateSelect('tbl-campaign-filter', state.campaigns.map(c => ({
    value: c.campaign_name,
    label: c.campaign_name,
  })), 'All Campaigns');
}

function populateSelect(id, opts, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    opts.map(o => `<option value="${escAttr(o.value)}">${escHtml(o.label)}</option>`).join('');
  sel.value = current;
}

// ── CSV Export ────────────────────────────────────────────────────────────

function exportCSV() {
  const rows = getFilteredTableData();
  const headers = ['Date & Time','Profile','Campaign','Contact','LinkedIn URL','Event Type','Email','Phone','Message/Note/Tag'];
  const lines = [headers.join(',')];
  rows.forEach(r => {
    const ts = r.event_timestamp ? new Date(r.event_timestamp) : new Date(r.received_at);
    const content = r.message_content || r.note_content || r.tag_name || '';
    lines.push([
      ts.toISOString(),
      r.linkedin_profile_name || r.linkedin_profile_id || '',
      r.campaign_name || '',
      r.contact_name  || '',
      r.contact_linkedin_url || '',
      r.event_type,
      r.contact_email || '',
      r.contact_phone || '',
      content,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `outreach-events-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Charts ────────────────────────────────────────────────────────────────

const CHART_COLORS = {
  connection_accepted: '#3fb950',
  reply_received:      '#388bfd',
  tag_added:           '#e3b341',
  tag_removed:         '#6e7681',
  note_added:          '#8957e5',
};

function renderCharts() {
  renderProfileChart();
  renderTimelineChart();
  renderBreakdownChart();
}

function renderProfileChart() {
  const ctx = document.getElementById('chart-profiles')?.getContext('2d');
  if (!ctx) return;

  const profiles = state.profiles;
  const labels   = profiles.map(p => (p.linkedin_profile_name || p.linkedin_profile_id || 'Unknown').split(' — ')[0]);

  if (state.charts.profileChart) state.charts.profileChart.destroy();
  state.charts.profileChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Accepted', data: profiles.map(p => p.accepted  || 0), backgroundColor: '#3fb950', borderRadius: 4 },
        { label: 'Replied',  data: profiles.map(p => p.replied   || 0), backgroundColor: '#388bfd', borderRadius: 4 },
      ],
    },
    options: chartDefaults({ title: '' }),
  });
}

function renderTimelineChart() {
  const ctx = document.getElementById('chart-timeline')?.getContext('2d');
  if (!ctx) return;

  // Build date list (last 30 days)
  const days   = 30;
  const dates  = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Group timeline data by date+type
  const byKey = {};
  state.timeline.forEach(row => { byKey[`${row.date}__${row.event_type}`] = row.count; });

  const types = ['connection_accepted', 'reply_received', 'tag_added'];
  const datasets = types.map(type => ({
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    data: dates.map(d => byKey[`${d}__${type}`] || 0),
    borderColor: CHART_COLORS[type] || '#888',
    backgroundColor: (CHART_COLORS[type] || '#888') + '22',
    tension: 0.4, fill: true, pointRadius: 3,
  }));

  if (state.charts.timelineChart) state.charts.timelineChart.destroy();
  state.charts.timelineChart = new Chart(ctx, {
    type: 'line',
    data: { labels: dates.map(d => d.slice(5)), datasets },
    options: chartDefaults({ title: '' }),
  });
}

function renderBreakdownChart() {
  const ctx = document.getElementById('chart-breakdown')?.getContext('2d');
  if (!ctx) return;

  const labels = state.breakdown.map(b => b.event_type.replace(/_/g, ' '));
  const data   = state.breakdown.map(b => b.count);
  const colors = state.breakdown.map(b => CHART_COLORS[b.event_type] || '#6e7681');

  if (state.charts.breakdownChart) state.charts.breakdownChart.destroy();
  state.charts.breakdownChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#161b22', borderWidth: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8b949e', boxWidth: 12, padding: 16, font: { size: 11 } } },
        tooltip: { callbacks: {
          label: (ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
            return ` ${ctx.raw} (${pct}%)`;
          },
        }},
      },
    },
  });
}

function chartDefaults({ title }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#8b949e', boxWidth: 12, font: { size: 11 } } },
      title: title ? { display: true, text: title, color: '#8b949e' } : { display: false },
    },
    scales: {
      x: { ticks: { color: '#6e7681', font: { size: 11 } }, grid: { color: '#21262d' } },
      y: { ticks: { color: '#6e7681', font: { size: 11 } }, grid: { color: '#21262d' }, beginAtZero: true },
    },
  };
}

// ── Campaign Table ────────────────────────────────────────────────────────

function renderCampaignTable(campaigns) {
  const tbody = document.querySelector('#campaign-table tbody');
  if (!tbody) return;

  if (!campaigns.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)">No campaign data yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = [...campaigns]
    .sort((a, b) => parseFloat(b.acceptance_rate) - parseFloat(a.acceptance_rate))
    .map(c => `
      <tr>
        <td style="font-weight:600;color:var(--text-primary)">${escHtml(c.campaign_name || '—')}</td>
        <td>${escHtml((c.profiles||[]).join(', ') || '—')}</td>
        <td>${c.start_date ? new Date(c.start_date).toLocaleDateString('en-GB') : '—'}</td>
        <td style="color:var(--green-bright);font-weight:700">${(c.accepted||0).toLocaleString()}</td>
        <td style="color:var(--blue-bright);font-weight:700">${(c.replied||0).toLocaleString()}</td>
        <td>${c.acceptance_rate}%</td>
        <td>${c.reply_rate}%</td>
        <td><span class="status-badge ${c.status === 'Active' ? 'status-active' : 'status-completed'}">${c.status}</span></td>
      </tr>`)
    .join('');
}

// ── Toast Notifications ───────────────────────────────────────────────────

function showToast(event) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Max 3 toasts
  while (container.children.length >= 3) {
    container.firstElementChild?.remove();
  }

  let colorClass, icon, title, msg;
  const name    = event.contact_name || 'Someone';
  const profile = event.linkedin_profile_name || 'your profile';

  switch (event.event_type) {
    case 'connection_accepted':
      colorClass = 'toast-green';  icon = '🤝';
      title = 'New Connection!';
      msg   = `${name} accepted ${profile}'s connection request`;
      break;
    case 'reply_received':
      colorClass = 'toast-blue'; icon = '💬';
      title = 'New Reply!';
      msg   = `${name} replied to ${profile}'s message`;
      break;
    case 'tag_added':
      colorClass = 'toast-orange'; icon = '🏷️';
      title = 'Tag Added';
      msg   = `${name} tagged as "${event.tag_name || 'tag'}"`;
      break;
    case 'tag_removed':
      colorClass = 'toast-grey'; icon = '🏷️';
      title = 'Tag Removed';
      msg   = `Tag removed from ${name}`;
      break;
    case 'note_added':
      colorClass = 'toast-purple'; icon = '🗒️';
      title = 'Note Added';
      msg   = `Note added for ${name}`;
      break;
    default:
      colorClass = 'toast-grey'; icon = '⚡';
      title = event.event_type || 'New Event';
      msg   = `${name} — ${profile}`;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${colorClass}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      <div class="toast-msg">${escHtml(msg)}</div>
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 310);
  }, 5000);
}

// ── Utils ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  if (str == null) return '';
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
