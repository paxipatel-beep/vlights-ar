/* ============================================================
   VLIGHTS AR DASHBOARD — API-Connected Application Logic
   Fetches all data from backend API (Node.js + SQLite)
   Auto-syncs every 30s for multi-user collaboration
   ============================================================ */

// ── STATE ──
const STATE = {
  accounts:        [],
  currentView:     'dashboard',
  allPage:         1,
  allPerPage:      50,
  allFilters:      { search: '', aging: '', status: '', sort: 'balance_desc' },
  todayFilters:    { search: '', status: '' },
  panel:           { accountId: null },
  authorName:      '',
  userRole:        'member',
  syncTimer:       null,
  syncing:         false,
  reminders:       [],
  reminderFilter:  'all',
  aiSuggestCache:  {},   // keyed by account id
};

// ── MOBILE SIDEBAR ──
function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar)  sidebar.classList.add('mobile-open');
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar)  sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  setDate();
  setSyncStatus('syncing');

  try {
    const me = await apiFetch('/api/me');
    STATE.authorName = me.author || 'Team';
    STATE.userRole   = me.role   || 'member';
    const el = document.getElementById('currentUser');
    if (el) el.textContent = STATE.authorName;
    // Show Settings link for admins
    if (me.role === 'admin') {
      const settingsLink = document.getElementById('settingsSidebarItem');
      if (settingsLink) settingsLink.style.display = '';
    }
  } catch (e) {
    console.warn('Could not fetch /api/me:', e);
  }

  await loadAllData();
  setupEventListeners();

  // Load reminder badge in background
  loadRemindersBadgeOnly();
  // Load Zoho badge in background
  loadZohoBadgeOnly();
  // Load broken promises badge
  loadPromisesBadgeOnly();

  // Auto-refresh every 30 seconds
  STATE.syncTimer = setInterval(syncData, 30000);
});

// ── API HELPERS ──
async function apiFetch(url, options = {}) {
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  const res = await fetch(url, {
    ...defaults,
    ...options,
    headers: { ...defaults.headers, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthenticated');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ── SYNC STATUS DOT ──
function setSyncStatus(state) {
  const dot = document.getElementById('syncDot');
  if (!dot) return;
  dot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
  dot.title = state === 'ok' ? 'Connected — live data' : state === 'syncing' ? 'Syncing…' : 'Sync error';
}

// ── LOAD ALL DATA ──
async function loadAllData() {
  setSyncStatus('syncing');
  try {
    const accounts = await apiFetch('/api/accounts');
    STATE.accounts = accounts.map(normalizeAccount);
    setSyncStatus('ok');
    refreshAllViews();
  } catch (e) {
    setSyncStatus('error');
    console.error('Failed to load accounts:', e);
  }
}

function normalizeAccount(a) {
  return {
    ...a,
    agingFlag:     a.aging_flag,
    oldestDays:    a.oldest_days,
    invCount:      a.inv_count,
    oldestDueDate: a.oldest_due,
    commentCount:  a.comment_count || 0,
    comments:      a._comments || [],
  };
}

// ── BACKGROUND SYNC (30s) ──
async function syncData() {
  if (STATE.syncing) return;
  STATE.syncing = true;
  setSyncStatus('syncing');
  try {
    const accounts = await apiFetch('/api/accounts');
    const panelId  = STATE.panel.accountId;
    STATE.accounts = accounts.map(a => {
      const existing = STATE.accounts.find(e => e.id === a.id);
      const norm = normalizeAccount(a);
      if (existing) {
        norm.comments = (existing.id === panelId) ? existing.comments : existing.comments;
      }
      return norm;
    });
    setSyncStatus('ok');
    refreshAllViews();
    // Refresh reminders badge silently
    loadRemindersBadgeOnly();
  } catch (e) {
    setSyncStatus('error');
    console.error('Sync failed:', e);
  } finally {
    STATE.syncing = false;
  }
}

function refreshAllViews() {
  renderDashboard();
  renderTopDebtors();
  renderAgingSummary();
  updateProgressStats();
  if (STATE.currentView === 'followup')  renderTodayList();
  else if (STATE.currentView === 'all') renderAllList();
  updateSidebarCounts();
}

// ── DATE ──
function setDate() {
  const el = document.getElementById('currentDate');
  if (el) el.textContent = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── NAVIGATION ──
function switchView(view) {
  STATE.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-item[data-view]').forEach(i => i.classList.remove('active'));

  const viewEl = document.getElementById('view-' + view);
  if (viewEl) viewEl.classList.add('active');

  const sidebarItem = document.querySelector(`.sidebar-item[data-view="${view}"]`);
  if (sidebarItem) sidebarItem.classList.add('active');

  const titles = {
    dashboard: 'Dashboard Overview',
    followup:  "Today's Priority Followup",
    all:       'All Accounts',
    activity:  'Activity Log',
    reminders: 'Reminders',
    zoho:      'Zoho Books Sync',
    promises:  'Payment Promises',
    settings:  'Team Settings',
  };
  const titleEl = document.getElementById('viewTitle');
  if (titleEl) titleEl.textContent = titles[view] || view;

  if (view === 'activity')  loadActivity();
  if (view === 'reminders') loadReminders();
  if (view === 'zoho')      loadZohoStatus();
  if (view === 'promises')  loadPromises();
  if (view === 'settings')  loadUsersView();

  // Close mobile sidebar on nav
  closeMobileSidebar();
}

// ── HELPERS ──
function formatINR(n) {
  if (!n) return '0';
  return new Intl.NumberFormat('en-IN').format(Math.round(n));
}

function agingLabel(flag) {
  const map = {
    very_old: '🔴 VERY OLD',
    old:      '🟠 OLD',
    aging:    '🟡 AGING',
    recent:   '🟤 RECENT',
    new:      '⚪ NEW',
  };
  return map[flag] || flag;
}

function statusLabel(s) {
  const map = {
    pending:  '⏳ Pending',
    called:   '📞 Called',
    promise:  '🤝 Promise',
    partial:  '💰 Partial',
    paid:     '✅ Paid',
    disputed: '⚠️ Disputed',
  };
  return map[s] || s;
}

function statusClass(s) { return 'status-' + (s || 'pending'); }

function agingShort(flag) {
  const map = {
    very_old: '720d+', old: '360–719d', aging: '180–359d', recent: '90–179d', new: '<90d',
  };
  return map[flag] || '';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── SIDEBAR COUNTS ──
function updateSidebarCounts() {
  ['very_old','old','aging','recent','new'].forEach(f => {
    const el = document.getElementById('sb-' + f);
    if (el) el.textContent = STATE.accounts.filter(a => a.agingFlag === f).length;
  });
  const todayEl = document.getElementById('todayCount');
  if (todayEl) todayEl.textContent = STATE.accounts.filter(a => a.agingFlag === 'very_old' || a.agingFlag === 'old').length;
  const totalEl = document.getElementById('totalCount');
  if (totalEl) totalEl.textContent = STATE.accounts.length;
}

// ── DASHBOARD KPI CARDS ──
function renderDashboard() {
  const total = STATE.accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const byFlag = { very_old:{cnt:0,bal:0}, old:{cnt:0,bal:0}, aging:{cnt:0,bal:0}, recent:{cnt:0,bal:0}, new:{cnt:0,bal:0} };
  STATE.accounts.forEach(a => {
    const f = a.agingFlag || 'new';
    if (byFlag[f]) { byFlag[f].cnt++; byFlag[f].bal += (a.balance||0); }
  });

  function set(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }

  set('kpi-total',    `₹${formatINR(total)}`);
  set('kpi-total-sub', `${STATE.accounts.length} accounts`);
  set('kpi-vo',    `₹${formatINR(byFlag.very_old.bal)}`);
  set('kpi-vo-sub', `${byFlag.very_old.cnt} accounts · ${total ? (byFlag.very_old.bal/total*100).toFixed(1) : 0}%`);
  set('kpi-old',   `₹${formatINR(byFlag.old.bal)}`);
  set('kpi-old-sub', `${byFlag.old.cnt} accounts · ${total ? (byFlag.old.bal/total*100).toFixed(1) : 0}%`);
  set('kpi-ag',    `₹${formatINR(byFlag.aging.bal)}`);
  set('kpi-ag-sub', `${byFlag.aging.cnt} accounts · ${total ? (byFlag.aging.bal/total*100).toFixed(1) : 0}%`);
  set('kpi-re',    `₹${formatINR(byFlag.recent.bal)}`);
  set('kpi-re-sub', `${byFlag.recent.cnt} accounts · ${total ? (byFlag.recent.bal/total*100).toFixed(1) : 0}%`);
  set('kpi-nw',    `₹${formatINR(byFlag.new.bal)}`);
  set('kpi-nw-sub', `${byFlag.new.cnt} accounts · ${total ? (byFlag.new.bal/total*100).toFixed(1) : 0}%`);

  updateSidebarCounts();
}

// ── COLLECTION RATE ──
function updateCollectionRate() {
  const total   = STATE.accounts.length;
  const resolved = STATE.accounts.filter(a => a.status === 'paid' || a.status === 'partial').length;
  const pct = total ? Math.round(resolved / total * 100) : 0;
  const el  = document.getElementById('collectionRate');
  if (el) {
    el.textContent = pct + '%';
    el.style.color = pct >= 50 ? 'var(--color-success)' : pct >= 25 ? 'var(--color-warning)' : 'var(--color-error)';
  }
}

// ── PROGRESS STATS ──
function updateProgressStats() {
  const counts = { paid:0, partial:0, promise:0, disputed:0, called:0, pending:0 };
  STATE.accounts.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

  const paid = counts.paid + counts.partial;
  const pct  = STATE.accounts.length ? Math.round((paid / STATE.accounts.length) * 100) : 0;

  function set(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }
  const bar = document.getElementById('progressBar');
  if (bar) bar.style.width = pct + '%';
  set('progressStats',  `${paid} / ${STATE.accounts.length} resolved`);
  set('paidCount',      `${counts.paid} Paid`);
  set('partialCount',   `${counts.partial} Partial`);
  set('promiseCount',   `${counts.promise} Promise`);
  set('disputedCount',  `${counts.disputed} Disputed`);
  set('pendingCount',   `${counts.pending} Pending`);
  updateCollectionRate();
}

// ── AGING SUMMARY TABLE ──
function renderAgingSummary() {
  const total = STATE.accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const groups = [
    { flag: 'very_old', label: '🔴 Very Old 720d+',  action: 'Legal notice / escalate immediately' },
    { flag: 'old',      label: '🟠 Old 360–719d',    action: 'Demand letter + senior management call' },
    { flag: 'aging',    label: '🟡 Aging 180–359d',  action: 'Formal reminder + call' },
    { flag: 'recent',   label: '🟤 Recent 90–179d',  action: 'Follow-up call + WhatsApp' },
    { flag: 'new',      label: '⚪ New <90d',        action: 'Courtesy reminder' },
  ];
  const tbody = document.getElementById('agingSummaryBody');
  if (!tbody) return;
  tbody.innerHTML = groups.map(g => {
    const accs = STATE.accounts.filter(a => a.agingFlag === g.flag);
    const bal  = accs.reduce((s, a) => s + (a.balance || 0), 0);
    const pct  = total ? (bal / total * 100).toFixed(1) : '0.0';
    return `<tr>
      <td>${g.label}</td>
      <td class="text-right mono">${accs.length}</td>
      <td class="text-right mono">₹${formatINR(bal)}</td>
      <td class="text-right mono">${pct}%</td>
      <td style="font-size:var(--text-xs);color:var(--color-text-muted)">${g.action}</td>
    </tr>`;
  }).join('');
  const agingMeta = document.getElementById('agingMeta');
  if (agingMeta) agingMeta.textContent = `As of ${new Date().toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}`;
}

// ── TOP DEBTORS ──
function renderTopDebtors() {
  const top10 = [...STATE.accounts].sort((a, b) => b.balance - a.balance).slice(0, 10);
  const tbody = document.getElementById('topDebtorsList');
  if (!tbody) return;
  tbody.innerHTML = top10.map((a, i) => `
    <tr>
      <td class="mono">${i + 1}</td>
      <td class="name-cell">
        <span class="name-text name-truncate" onclick="openPanel(${a.id})" title="${escHtml(a.name)}">${escHtml(a.name)}</span>
      </td>
      <td class="text-right mono">₹${formatINR(a.balance)}</td>
      <td><span class="aging-badge aging-${a.agingFlag}">${agingLabel(a.agingFlag)}</span></td>
      <td class="text-right mono">${a.oldestDays}d</td>
      <td>
        <span class="status-badge ${statusClass(a.status)}" onclick="openPanel(${a.id})">${statusLabel(a.status)}</span>
      </td>
      <td>
        <button class="comment-count ${a.commentCount === 0 ? 'empty' : ''}" onclick="openPanel(${a.id})">
          💬 ${a.commentCount}
        </button>
      </td>
    </tr>
  `).join('');
}

// ── AI SMART SUGGESTION (client-side fast path + server deep analysis) ──

// Fast local suggestion (used for table rendering — no API call needed)
function smartSuggestion(a) {
  const days    = a.oldestDays || 0;
  const status  = a.status || 'pending';
  const balance = a.balance || 0;
  const hasComments = a.commentCount > 0;

  if (status === 'paid')     return { icon: '✅', label: 'Settled',        cls: 'sug-paid',     note: 'Payment confirmed. Ready to close.' };
  if (status === 'partial')  return { icon: '💰', label: 'Follow balance',  cls: 'sug-partial',  note: 'Partial received — follow up for remaining balance.' };
  if (status === 'disputed') return { icon: '⚠️', label: 'Escalate',       cls: 'sug-escalate', note: 'Disputed — loop in management and send formal notice.' };
  if (status === 'promise')  return { icon: '🤝', label: 'Verify promise',  cls: 'sug-promise',  note: 'Promise given — confirm if payment was made.' };

  if (days >= 720) {
    return balance >= 100000
      ? { icon: '🚨', label: 'Legal notice',     cls: 'sug-legal',    note: 'High value + 720d+ — issue legal notice immediately.' }
      : { icon: '🚨', label: 'Final warning',    cls: 'sug-legal',    note: 'Last call before legal action — mention consequences.' };
  }
  if (days >= 360) {
    if (hasComments && balance >= 50000)
      return { icon: '📈', label: 'Escalate',       cls: 'sug-escalate', note: 'Old account with history — escalate to management.' };
    return balance >= 100000
      ? { icon: '📞', label: 'Director call',    cls: 'sug-urgent',   note: 'High value — call decision maker directly.' }
      : { icon: '📋', label: 'Demand letter',    cls: 'sug-escalate', note: 'Send formal written demand with deadline.' };
  }
  if (days >= 180) return { icon: '📞', label: 'Formal reminder',  cls: 'sug-call',     note: '180+ days — formal call + email reminder.' };
  if (days >= 90) {
    return !hasComments
      ? { icon: '📞', label: 'First call',       cls: 'sug-call',     note: 'No contact yet — initiate first follow-up call.' }
      : { icon: '💬', label: 'WhatsApp',         cls: 'sug-whatsapp', note: 'Send WhatsApp reminder with invoice details.' };
  }
  return { icon: '📩', label: 'Courtesy reminder', cls: 'sug-call',   note: 'New outstanding — send friendly payment reminder.' };
}

// Deep AI suggestion — fetches from server (uses comment history + reminder context)
async function fetchAiSuggestion(accountId) {
  if (STATE.aiSuggestCache[accountId]) return STATE.aiSuggestCache[accountId];
  try {
    const result = await apiFetch(`/api/accounts/${accountId}/suggest`);
    STATE.aiSuggestCache[accountId] = result;
    return result;
  } catch (e) {
    return null;
  }
}

// Render the AI suggestion pill in the panel
function renderPanelAiSuggestion(data) {
  const container = document.getElementById('panelAiSuggest');
  if (!container) return;

  if (!data || !data.suggestion) {
    container.innerHTML = '<div class="ai-suggest-loading">Could not load suggestion.</div>';
    return;
  }

  const sug = data.suggestion;
  const ctx = data.context || {};

  // Context chips
  const chips = [];
  if (ctx.due_reminders > 0)    chips.push(`<span class="ctx-chip ctx-overdue">🔔 ${ctx.due_reminders} overdue reminder${ctx.due_reminders > 1 ? 's' : ''}</span>`);
  if (ctx.has_promise)          chips.push('<span class="ctx-chip ctx-info">🤝 Promise recorded</span>');
  if (ctx.has_whatsapp)         chips.push('<span class="ctx-chip ctx-info">💬 WA contacted</span>');
  if (ctx.has_voicemail)        chips.push('<span class="ctx-chip ctx-info">📞 Voicemail left</span>');
  if (ctx.has_legal)            chips.push('<span class="ctx-chip ctx-warn">⚖️ Legal mentioned</span>');
  if (ctx.days_since_contact < 999 && ctx.days_since_contact > 0) {
    chips.push(`<span class="ctx-chip ctx-info">Last contact: ${ctx.days_since_contact}d ago</span>`);
  }

  container.innerHTML = `
    <div class="ai-suggest-card ${sug.cls}">
      <div class="ai-suggest-header">
        <span class="ai-suggest-icon">${sug.icon}</span>
        <div class="ai-suggest-main">
          <div class="ai-suggest-action">${escHtml(sug.action)}</div>
          <div class="ai-suggest-urgency urgency-${(sug.urgency||'').toLowerCase().replace(/\s+/g,'-')}">${escHtml(sug.urgency || '')}</div>
        </div>
      </div>
      <div class="ai-suggest-detail">${escHtml(sug.detail)}</div>
      ${chips.length ? `<div class="ai-suggest-chips">${chips.join('')}</div>` : ''}
    </div>
  `;
}

// ── TODAY'S FOLLOWUP ──
function getTodayAccounts() {
  const f = STATE.todayFilters;
  let list = STATE.accounts.filter(a => a.agingFlag === 'very_old' || a.agingFlag === 'old');
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(a => a.name.toLowerCase().includes(q));
  }
  if (f.status) list = list.filter(a => a.status === f.status);
  return list.sort((a, b) => b.balance - a.balance);
}

function renderTodayList() {
  const list  = getTodayAccounts();
  const tbody = document.getElementById('todayList');
  if (!tbody) return;
  tbody.innerHTML = list.map((a, i) => {
    const sug = smartSuggestion(a);
    return `
    <tr>
      <td class="mono">${i + 1}</td>
      <td class="name-cell">
        <span class="name-text name-truncate" onclick="openPanel(${a.id})" title="${escHtml(a.name)}">${escHtml(a.name)}</span>
      </td>
      <td class="text-right mono">₹${formatINR(a.balance)}</td>
      <td><span class="aging-badge aging-${a.agingFlag}">${agingLabel(a.agingFlag)}</span></td>
      <td class="text-right mono">${a.oldestDays}d</td>
      <td class="text-right mono">${a.invCount}</td>
      <td>
        <select class="status-select-inline" data-id="${a.id}" onchange="updateStatusApi(${a.id}, this.value)">
          ${statusOptions(a.status)}
        </select>
      </td>
      <td>
        <button class="comment-count ${a.commentCount === 0 ? 'empty' : ''}" onclick="openPanel(${a.id})">
          💬 ${a.commentCount}
        </button>
      </td>
      <td>
        <div class="sug-badge ${sug.cls}" title="${escHtml(sug.note)}">
          <span class="sug-icon">${sug.icon}</span>
          <span class="sug-label">${sug.label}</span>
        </div>
      </td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openPanel(${a.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Note
        </button>
      </td>
    </tr>`;
  }).join('');

  const footer = document.getElementById('todayFooter');
  if (footer) footer.textContent = `${list.length} accounts · ₹${formatINR(list.reduce((s, a) => s + a.balance, 0))} total`;
}

// ── ALL ACCOUNTS LIST ──
function getAllFiltered() {
  const f = STATE.allFilters;
  let list = [...STATE.accounts];
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(a => a.name.toLowerCase().includes(q));
  }
  if (f.aging)  list = list.filter(a => a.agingFlag === f.aging);
  if (f.status) list = list.filter(a => a.status === f.status);
  switch (f.sort) {
    case 'balance_asc': list.sort((a, b) => a.balance - b.balance); break;
    case 'days_desc':   list.sort((a, b) => b.oldestDays - a.oldestDays); break;
    case 'days_asc':    list.sort((a, b) => a.oldestDays - b.oldestDays); break;
    default:            list.sort((a, b) => b.balance - a.balance); break;
  }
  return list;
}

function renderAllList() {
  const list    = getAllFiltered();
  const total   = list.length;
  const perPage = STATE.allPerPage;
  const pages   = Math.ceil(total / perPage);
  if (STATE.allPage > pages) STATE.allPage = Math.max(1, pages);
  const start = (STATE.allPage - 1) * perPage;
  const slice = list.slice(start, start + perPage);

  const tbody = document.getElementById('allList');
  if (!tbody) return;
  tbody.innerHTML = slice.map((a, i) => `
    <tr>
      <td class="mono">${start + i + 1}</td>
      <td class="name-cell">
        <span class="name-text name-truncate" onclick="openPanel(${a.id})" title="${escHtml(a.name)}">${escHtml(a.name)}</span>
      </td>
      <td class="text-right mono">₹${formatINR(a.balance)}</td>
      <td><span class="aging-badge aging-${a.agingFlag}">${agingLabel(a.agingFlag)}</span></td>
      <td class="text-right mono">${a.oldestDays}d</td>
      <td class="text-right mono">${a.invCount}</td>
      <td class="mono">${a.oldestDueDate || '—'}</td>
      <td>
        <select class="status-select-inline" data-id="${a.id}" onchange="updateStatusApi(${a.id}, this.value)">
          ${statusOptions(a.status)}
        </select>
      </td>
      <td>
        <button class="comment-count ${a.commentCount === 0 ? 'empty' : ''}" onclick="openPanel(${a.id})">
          💬 ${a.commentCount}
        </button>
      </td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openPanel(${a.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Note
        </button>
      </td>
    </tr>
  `).join('');

  const allMeta = document.getElementById('allMeta');
  if (allMeta) allMeta.textContent = `${total} accounts`;

  const allFooter = document.getElementById('allFooter');
  if (allFooter) allFooter.innerHTML = `
    <span>Showing ${start+1}–${Math.min(start+perPage, total)} of ${total} accounts · ₹${formatINR(list.reduce((s, a) => s + a.balance, 0))} total</span>
    <span>${pages} pages</span>
  `;

  renderPagination(pages);
}

function renderPagination(pages) {
  const pg = STATE.allPage;
  const container = document.getElementById('allPagination');
  if (!container) return;
  if (pages <= 1) { container.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goPage(${pg - 1})" ${pg === 1 ? 'disabled' : ''}>← Prev</button>`;

  const windowSize = 5;
  let start = Math.max(1, pg - Math.floor(windowSize / 2));
  let end   = Math.min(pages, start + windowSize - 1);
  if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);

  if (start > 1) html += `<button class="page-btn" onclick="goPage(1)">1</button>${start > 2 ? '<span style="padding:0 4px;color:var(--color-text-faint)">…</span>' : ''}`;
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === pg ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (end < pages) html += `${end < pages - 1 ? '<span style="padding:0 4px;color:var(--color-text-faint)">…</span>' : ''}<button class="page-btn" onclick="goPage(${pages})">${pages}</button>`;
  html += `<button class="page-btn" onclick="goPage(${pg + 1})" ${pg === pages ? 'disabled' : ''}>Next →</button>`;
  container.innerHTML = html;
}

function goPage(p) {
  STATE.allPage = p;
  renderAllList();
  const card = document.querySelector('#view-all .section-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── STATUS OPTIONS ──
function statusOptions(current) {
  const opts = [
    ['pending',  '⏳ Pending'],
    ['called',   '📞 Called'],
    ['promise',  '🤝 Promise Received'],
    ['partial',  '💰 Partial Payment'],
    ['paid',     '✅ Paid'],
    ['disputed', '⚠️ Disputed'],
  ];
  return opts.map(([v, l]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${l}</option>`).join('');
}

// ── STATUS UPDATE (API) ──
async function updateStatusApi(id, status) {
  const acc = STATE.accounts.find(a => a.id === id);
  if (!acc) return;
  const oldStatus = acc.status;
  acc.status = status;
  updateProgressStats();
  renderTopDebtors();

  if (STATE.panel.accountId === id) {
    const sel = document.getElementById('panelStatusSelect');
    if (sel) sel.value = status;
  }

  try {
    await apiFetch(`/api/accounts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    // Invalidate AI suggest cache for this account
    delete STATE.aiSuggestCache[id];
    // If panel is open, refresh AI suggestion
    if (STATE.panel.accountId === id) {
      const aiDiv = document.getElementById('panelAiSuggest');
      if (aiDiv) {
        aiDiv.innerHTML = '<div class="ai-suggest-loading">Refreshing suggestion…</div>';
        fetchAiSuggestion(id).then(data => renderPanelAiSuggestion(data));
      }
    }
  } catch (e) {
    acc.status = oldStatus;
    updateProgressStats();
    renderTopDebtors();
    showToast('Failed to update status. Please try again.', 'error');
  }
}

// ── COMMENT PANEL ──
async function openPanel(id) {
  const acc = STATE.accounts.find(a => a.id === id);
  if (!acc) return;
  STATE.panel.accountId = id;

  document.getElementById('panelTitle').textContent    = acc.name;
  document.getElementById('panelSubtitle').textContent = `#${acc.id} · ${agingLabel(acc.agingFlag)} · ${acc.oldestDays} days · ${acc.invCount} inv`;

  document.getElementById('panelInfo').innerHTML = `
    <div class="info-item"><span class="info-label">Balance</span><span class="info-value">₹${formatINR(acc.balance)}</span></div>
    <div class="info-item"><span class="info-label">Oldest Due</span><span class="info-value">${acc.oldestDueDate || '—'}</span></div>
    <div class="info-item"><span class="info-label">Invoices</span><span class="info-value">${acc.invCount}</span></div>
    <div class="info-item"><span class="info-label">Days Overdue</span><span class="info-value">${acc.oldestDays}d</span></div>
  `;

  document.getElementById('panelStatusSelect').value = acc.status;
  document.getElementById('chatMessages').innerHTML = '<div class="chat-empty">Loading…</div>';

  // Reset reminder inputs
  const rdInput = document.getElementById('reminderDate');
  if (rdInput) { rdInput.min = new Date().toISOString().slice(0,10); rdInput.value = ''; }
  const rnInput = document.getElementById('reminderNote');
  if (rnInput) rnInput.value = '';

  // Show AI suggestion placeholder
  const aiDiv = document.getElementById('panelAiSuggest');
  if (aiDiv) aiDiv.innerHTML = '<div class="ai-suggest-loading"><span class="ai-loading-dot"></span> Analysing account…</div>';

  document.getElementById('commentPanel').classList.add('open');
  document.getElementById('panelBackdrop').classList.add('active');
  document.body.style.overflow = 'hidden';

  // Parallel loads
  const [comments] = await Promise.allSettled([
    apiFetch(`/api/accounts/${id}/comments`),
  ]);

  if (comments.status === 'fulfilled') {
    acc.comments = comments.value;
    acc.commentCount = comments.value.length;
    renderChatMessages(acc);
  } else {
    document.getElementById('chatMessages').innerHTML = '<div class="chat-empty">Could not load comments.</div>';
  }

  // Load reminders in panel
  loadPanelReminders(id);

  // Load promises in panel
  loadPanelPromises(id);

  // Load AI suggestion (async, updates when ready)
  fetchAiSuggestion(id).then(data => renderPanelAiSuggestion(data));
}

function closePanel() {
  document.getElementById('commentPanel').classList.remove('open');
  document.getElementById('panelBackdrop').classList.remove('active');
  document.body.style.overflow = '';
  STATE.panel.accountId = null;
}

function renderChatMessages(acc) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  if (!acc.comments || acc.comments.length === 0) {
    container.innerHTML = '<div class="chat-empty">No notes yet. Add the first followup note below.</div>';
    return;
  }
  container.innerHTML = acc.comments.map(c => `
    <div class="chat-message">
      <div class="msg-header">
        <span class="msg-author">${escHtml(c.author || 'Team')}</span>
        <span style="display:flex;gap:8px;align-items:center;">
          <span class="msg-time">${formatCommentTime(c.created_at)}</span>
          <button class="msg-delete" onclick="deleteCommentApi(${acc.id}, ${c.id})" title="Delete">✕</button>
        </span>
      </div>
      <div class="msg-body">${escHtml(c.text)}</div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

function formatCommentTime(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return isoStr; }
}

async function sendComment() {
  const id = STATE.panel.accountId;
  if (!id) return;
  const acc = STATE.accounts.find(a => a.id === id);
  if (!acc) return;

  const inputEl = document.getElementById('chatInput');
  const text = inputEl.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById('chatSend');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const comment = await apiFetch(`/api/accounts/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    acc.comments = acc.comments || [];
    acc.comments.push(comment);
    acc.commentCount = (acc.commentCount || 0) + 1;
    inputEl.value = '';
    renderChatMessages(acc);
    renderTopDebtors();
    // Invalidate AI cache — comment context changed
    delete STATE.aiSuggestCache[id];
    if (STATE.currentView === 'followup') renderTodayList();
    else if (STATE.currentView === 'all') renderAllList();
    // Refresh AI suggestion
    const aiDiv = document.getElementById('panelAiSuggest');
    if (aiDiv) {
      aiDiv.innerHTML = '<div class="ai-suggest-loading"><span class="ai-loading-dot"></span> Updating suggestion…</div>';
      fetchAiSuggestion(id).then(data => renderPanelAiSuggestion(data));
    }
  } catch (e) {
    showToast('Failed to send note. Please try again.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function deleteCommentApi(accId, commentId) {
  const acc = STATE.accounts.find(a => a.id === accId);
  if (!acc) return;
  try {
    await apiFetch(`/api/accounts/${accId}/comments/${commentId}`, { method: 'DELETE' });
    acc.comments = acc.comments.filter(c => c.id !== commentId);
    acc.commentCount = acc.comments.length;
    renderChatMessages(acc);
    renderTopDebtors();
    delete STATE.aiSuggestCache[accId];
    if (STATE.currentView === 'followup') renderTodayList();
    else if (STATE.currentView === 'all') renderAllList();
    fetchAiSuggestion(accId).then(data => renderPanelAiSuggestion(data));
  } catch (e) {
    showToast('Failed to delete note.', 'error');
  }
}

// ── ACTIVITY LOG ──
async function loadActivity() {
  const container = document.getElementById('activityList');
  if (!container) return;
  container.innerHTML = '<div class="activity-empty">Loading…</div>';
  try {
    const items = await apiFetch('/api/activity');
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="activity-empty">No activity yet.</div>';
      return;
    }
    container.innerHTML = items.map(item => `
      <div class="activity-item">
        <span class="activity-actor">${escHtml(item.actor || 'System')}</span>
        <span class="activity-desc">${formatActivityDesc(item)}</span>
        <span class="activity-time">${formatCommentTime(item.created_at)}</span>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div class="activity-empty">Could not load activity log.</div>';
  }
}

function formatActivityDesc(item) {
  const name = escHtml(item.account_name || '');
  switch (item.action) {
    case 'status_change':
      return `${name}: status changed from <em>${item.old_value}</em> → <strong>${item.new_value}</strong>`;
    case 'comment':
      return `${name}: added note — "${escHtml((item.new_value || '').slice(0, 80))}${(item.new_value||'').length > 80 ? '…' : ''}"`;
    case 'bulk_upload':
      return `New data uploaded — ${item.new_value}`;
    case 'reminder_set':
      return `${name}: reminder set for ${item.new_value}`;
    default:
      return `${name}: ${item.action}`;
  }
}

// ── WHATSAPP QUICK MESSAGE ──
function openWhatsApp() {
  const id  = STATE.panel.accountId;
  if (!id) return;
  const acc = STATE.accounts.find(a => a.id === id);
  if (!acc) return;
  const msg = encodeURIComponent(
    `Dear ${acc.name},\n\nThis is a reminder regarding your outstanding balance of ₹${formatINR(acc.balance)} (${acc.oldestDays} days overdue).\n\nKindly arrange payment at the earliest.\n\nThank you,\nvlights Team`
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
}

// ── COPY ACCOUNT INFO ──
function copyPanelInfo() {
  const id  = STATE.panel.accountId;
  if (!id) return;
  const acc = STATE.accounts.find(a => a.id === id);
  if (!acc) return;
  const text = [
    `Customer: ${acc.name}`,
    `Balance: ₹${formatINR(acc.balance)}`,
    `Aging: ${agingLabel(acc.agingFlag)}`,
    `Days Overdue: ${acc.oldestDays}d`,
    `Invoices: ${acc.invCount}`,
    `Status: ${acc.status}`,
  ].join('\n');
  navigator.clipboard.writeText(text)
    .then(() => showToast('Account info copied!', 'success'))
    .catch(() => showToast('Could not copy — try manually.', 'error'));
}

// ── PRINT / PDF AGING REPORT ──
function printAgingReport() {
  const total = STATE.accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const date  = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const top20 = [...STATE.accounts].sort((a, b) => b.balance - a.balance).slice(0, 20);

  const aging = [
    { flag:'very_old', label:'Very Old (720d+)' },
    { flag:'old',      label:'Old (360–719d)' },
    { flag:'aging',    label:'Aging (180–359d)' },
    { flag:'recent',   label:'Recent (90–179d)' },
    { flag:'new',      label:'New (<90d)' },
  ].map(g => {
    const accs = STATE.accounts.filter(a => a.agingFlag === g.flag);
    const bal  = accs.reduce((s, a) => s + (a.balance || 0), 0);
    return { ...g, cnt: accs.length, bal, pct: total ? (bal/total*100).toFixed(1) : '0.0' };
  });

  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><title>AR Aging Report — ${date}</title><style>
    body{font-family:Arial,sans-serif;color:#0f172a;margin:0;padding:24px;font-size:13px}
    h1{font-size:20px;margin:0 0 4px;color:#1e40af} h2{font-size:14px;margin:16px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}
    .meta{font-size:11px;color:#64748b;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
    th{background:#f1f4f8;text-align:left;padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;border-bottom:2px solid #e2e8f0}
    td{padding:6px 10px;border-bottom:1px solid #f1f5f9}
    tr:hover td{background:#fafafa}
    .tr{text-align:right} .bold{font-weight:700}
    .total-row td{font-weight:700;background:#f8fafc;border-top:2px solid #e2e8f0}
    @media print{body{padding:0}@page{margin:15mm}}
  </style></head><body>
    <h1>vlights AR Aging Report</h1>
    <div class="meta">Generated: ${date} &nbsp;·&nbsp; Total Outstanding: ₹${formatINR(total)} &nbsp;·&nbsp; ${STATE.accounts.length} accounts</div>
    <h2>Aging Summary</h2>
    <table><thead><tr><th>Aging Group</th><th class="tr">Accounts</th><th class="tr">Balance (₹)</th><th class="tr">% of Total</th></tr></thead>
    <tbody>
      ${aging.map(g => `<tr><td>${g.label}</td><td class="tr">${g.cnt}</td><td class="tr">${formatINR(g.bal)}</td><td class="tr">${g.pct}%</td></tr>`).join('')}
      <tr class="total-row"><td>Total</td><td class="tr">${STATE.accounts.length}</td><td class="tr">${formatINR(total)}</td><td class="tr">100%</td></tr>
    </tbody></table>
    <h2>Top 20 Outstanding Accounts</h2>
    <table><thead><tr><th>#</th><th>Customer</th><th class="tr">Balance (₹)</th><th>Aging</th><th class="tr">Days</th><th>Status</th></tr></thead>
    <tbody>
      ${top20.map((a,i) => `<tr><td>${i+1}</td><td>${a.name}</td><td class="tr">${formatINR(a.balance)}</td><td>${agingLabel(a.agingFlag)}</td><td class="tr">${a.oldestDays}</td><td>${a.status}</td></tr>`).join('')}
    </tbody></table>
    <div style="margin-top:24px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px">
      Confidential — Generated by vlights AR Dashboard · <a href="https://www.perplexity.ai/computer">Perplexity Computer</a>
    </div>
    <script>window.onload=function(){window.print()}<\/script>
  </body></html>`);
  w.document.close();
}

// ── EXPORT CSV ──
function exportCSV() {
  const headers = ['#','Customer Name','Balance (Rs)','Oldest Days','Invoices','Aging','Due Date','Status','Comments'];
  const rows = STATE.accounts.map(a => [
    a.id,
    `"${(a.name||'').replace(/"/g, '""')}"`,
    a.balance,
    a.oldestDays,
    a.invCount,
    agingLabel(a.agingFlag),
    a.oldestDueDate || '',
    a.status,
    a.commentCount,
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `vlights_AR_export_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── TOAST ──
function showToast(msg, type = 'info') {
  let el = document.getElementById('toastMsg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toastMsg';
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.15);transition:opacity .3s';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1e40af';
  el.style.color = '#fff';
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

// ── EVENT LISTENERS ──
function setupEventListeners() {
  // Sidebar navigation
  document.querySelectorAll('.sidebar-item[data-view]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); });
  });

  // Sidebar aging filter shortcuts
  document.querySelectorAll('.sidebar-item[data-filter]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      STATE.allFilters.aging = el.dataset.filter;
      STATE.allPage = 1;
      const sel = document.getElementById('allAgingFilter');
      if (sel) sel.value = el.dataset.filter;
      switchView('all');
      renderAllList();
    });
  });

  // Sidebar collapse
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) sidebarToggle.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('mainWrap').classList.toggle('sidebar-collapsed');
  });

  // Mobile menu
  const mobileBtn = document.getElementById('mobileMenuBtn');
  if (mobileBtn) mobileBtn.addEventListener('click', () => openMobileSidebar());

  // Mobile sidebar backdrop
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  // Panel close
  document.getElementById('panelClose').addEventListener('click', closePanel);
  document.getElementById('panelBackdrop').addEventListener('click', closePanel);

  // Panel status change
  document.getElementById('panelStatusSelect').addEventListener('change', async e => {
    const id = STATE.panel.accountId;
    if (id) {
      await updateStatusApi(id, e.target.value);
      if (STATE.currentView === 'followup') renderTodayList();
      else if (STATE.currentView === 'all') renderAllList();
    }
  });

  // Chat send
  document.getElementById('chatSend').addEventListener('click', sendComment);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment();
  });

  // Quick notes
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById('chatInput');
      inp.value = btn.dataset.note;
      inp.focus();
    });
  });

  // Reminder set button in panel
  const reminderSetBtn = document.getElementById('reminderSetBtn');
  if (reminderSetBtn) reminderSetBtn.addEventListener('click', setReminder);

  const promiseSetBtn = document.getElementById('promiseSetBtn');
  if (promiseSetBtn) promiseSetBtn.addEventListener('click', () => {
    if (STATE.panel.accountId) setPromise(STATE.panel.accountId);
  });

  // Reminder filter in reminders view
  const reminderFilter = document.getElementById('reminderFilter');
  if (reminderFilter) reminderFilter.addEventListener('change', () => {
    STATE.reminderFilter = reminderFilter.value;
    renderRemindersList();
  });

  // Today's followup filters
  const todaySearch = document.getElementById('todaySearch');
  if (todaySearch) todaySearch.addEventListener('input', e => {
    STATE.todayFilters.search = e.target.value;
    renderTodayList();
  });
  const todayStatusFilter = document.getElementById('todayStatusFilter');
  if (todayStatusFilter) todayStatusFilter.addEventListener('change', e => {
    STATE.todayFilters.status = e.target.value;
    renderTodayList();
  });

  // All accounts filters
  const allSearch = document.getElementById('allSearch');
  if (allSearch) allSearch.addEventListener('input', e => {
    STATE.allFilters.search = e.target.value;
    STATE.allPage = 1;
    renderAllList();
  });
  const allAging = document.getElementById('allAgingFilter');
  if (allAging) allAging.addEventListener('change', e => {
    STATE.allFilters.aging = e.target.value;
    STATE.allPage = 1;
    renderAllList();
  });
  const allStatus = document.getElementById('allStatusFilter');
  if (allStatus) allStatus.addEventListener('change', e => {
    STATE.allFilters.status = e.target.value;
    STATE.allPage = 1;
    renderAllList();
  });
  const allSort = document.getElementById('allSortFilter');
  if (allSort) allSort.addEventListener('change', e => {
    STATE.allFilters.sort = e.target.value;
    STATE.allPage = 1;
    renderAllList();
  });

  // Export
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);


  // Dark mode
  (function() {
    const t = document.getElementById('themeToggle');
    if (!t) return;
    const r = document.documentElement;
    let d = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    r.setAttribute('data-theme', d);
    updateThemeIcon(t, d);
    t.addEventListener('click', () => {
      d = d === 'dark' ? 'light' : 'dark';
      r.setAttribute('data-theme', d);
      updateThemeIcon(t, d);
    });
  })();

  // Escape closes panel
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
}

function updateThemeIcon(btn, theme) {
  if (theme === 'dark') {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    btn.setAttribute('aria-label', 'Switch to light mode');
  } else {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.setAttribute('aria-label', 'Switch to dark mode');
  }
}

/* ============================================================
   REMINDERS MODULE — Fully integrated
   ============================================================ */

async function loadRemindersBadgeOnly() {
  try {
    STATE.reminders = await apiFetch('/api/reminders');
    updateReminderBadge();
  } catch (e) {}
}

async function loadReminders() {
  const container = document.getElementById('reminderList');
  if (!container) return;
  container.innerHTML = '<div class="reminder-empty">Loading…</div>';
  try {
    STATE.reminders = await apiFetch('/api/reminders');
    updateReminderBadge();
    renderRemindersList();
  } catch (e) {
    container.innerHTML = '<div class="reminder-empty">Could not load reminders.</div>';
  }
}

function renderRemindersList() {
  const container = document.getElementById('reminderList');
  if (!container) return;

  const filter  = document.getElementById('reminderFilter');
  const mode    = filter ? filter.value : 'all';
  const today   = new Date().toISOString().slice(0, 10);
  let list      = [...STATE.reminders];

  if (mode === 'due')     list = list.filter(r => r.remind_date <= today);
  if (mode === 'overdue') list = list.filter(r => r.remind_date < today);
  if (mode === 'today')   list = list.filter(r => r.remind_date === today);
  if (mode === 'future')  list = list.filter(r => r.remind_date > today);

  if (list.length === 0) {
    const msgs = {
      all:     'No upcoming reminders. Open any account chat to set one.',
      due:     'No overdue or due-today reminders. All clear!',
      overdue: 'No overdue reminders.',
      today:   'No reminders set for today.',
      future:  'No future reminders scheduled.',
    };
    container.innerHTML = `<div class="reminder-empty">${msgs[mode] || 'No reminders.'}</div>`;
    return;
  }

  // Group by date
  const grouped = {};
  list.forEach(r => {
    const key = r.remind_date;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  const sortedDates = Object.keys(grouped).sort();
  let html = '';
  sortedDates.forEach(date => {
    const isOverdue  = date < today;
    const isDueToday = date === today;
    const dateLabel  = isOverdue
      ? `<span style="color:#dc2626">OVERDUE — ${formatReminderDate(date)}</span>`
      : isDueToday
        ? '<span style="color:#d97706">TODAY</span>'
        : formatReminderDate(date);

    html += `<div class="reminder-group-header">${dateLabel}</div>`;
    grouped[date].forEach(r => {
      const cardCls  = isOverdue ? 'overdue' : isDueToday ? 'due-today' : '';
      const badgeCls = isOverdue ? 'overdue' : isDueToday ? 'due-today' : 'upcoming';
      const badgeTxt = isOverdue ? 'OVERDUE' : isDueToday ? 'TODAY' : formatReminderDate(r.remind_date);
      html += `
        <div class="reminder-card ${cardCls}" id="rc-${r.id}">
          <div class="reminder-date-badge ${badgeCls}">${badgeTxt}</div>
          <div class="reminder-body">
            <div class="reminder-acc" onclick="openPanel(${r.account_id})" style="cursor:pointer;text-decoration:underline dotted">${escHtml(r.account_name)}</div>
            ${r.note ? `<div class="reminder-note">${escHtml(r.note)}</div>` : ''}
            <div class="reminder-meta">
              Set by ${escHtml(r.created_by)}
              ${r.balance ? ` · ₹${formatINR(r.balance)}` : ''}
              ${r.aging_flag ? ` · ${agingLabel(r.aging_flag)}` : ''}
            </div>
          </div>
          <div class="reminder-actions">
            <button class="reminder-done-btn" onclick="markReminderDone(${r.id}, this)">✓ Done</button>
            <button class="reminder-del-btn"  onclick="removeReminder(${r.id}, this)">✕</button>
          </div>
        </div>`;
    });
  });

  container.innerHTML = html;
}

function formatReminderDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function updateReminderBadge() {
  const today = new Date().toISOString().slice(0, 10);
  const due   = STATE.reminders.filter(r => r.remind_date <= today).length;
  const badge = document.getElementById('reminderDueCount');
  if (!badge) return;
  if (due > 0) { badge.textContent = due; badge.style.display = ''; }
  else          { badge.style.display = 'none'; }
}

async function markReminderDone(id, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
  try {
    await apiFetch('/api/reminders/' + id + '/done', { method: 'PATCH' });
    STATE.reminders = STATE.reminders.filter(r => r.id !== id);
    updateReminderBadge();
    // Animate out
    const card = document.getElementById('rc-' + id);
    if (card) {
      card.style.opacity = '0';
      card.style.transition = 'opacity .3s';
      setTimeout(() => { renderRemindersList(); }, 350);
    } else {
      renderRemindersList();
    }
    // Refresh panel if open
    if (STATE.panel.accountId) loadPanelReminders(STATE.panel.accountId);
    showToast('Reminder marked done.', 'success');
  } catch (e) {
    showToast('Failed to mark done.', 'error');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✓ Done'; }
  }
}

async function removeReminder(id, btnEl) {
  if (btnEl) { btnEl.disabled = true; }
  try {
    await apiFetch('/api/reminders/' + id, { method: 'DELETE' });
    STATE.reminders = STATE.reminders.filter(r => r.id !== id);
    updateReminderBadge();
    const card = document.getElementById('rc-' + id);
    if (card) {
      card.style.opacity = '0';
      card.style.transition = 'opacity .3s';
      setTimeout(() => { renderRemindersList(); }, 350);
    } else {
      renderRemindersList();
    }
    if (STATE.panel.accountId) loadPanelReminders(STATE.panel.accountId);
    showToast('Reminder deleted.');
  } catch (e) {
    showToast('Failed to delete reminder.', 'error');
    if (btnEl) btnEl.disabled = false;
  }
}

async function loadPanelReminders(accountId) {
  const container = document.getElementById('panelRemindersList');
  if (!container) return;
  try {
    const reminders = await apiFetch('/api/accounts/' + accountId + '/reminders');
    if (!reminders || reminders.length === 0) {
      container.innerHTML = '';
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    container.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' +
      reminders.map(r => {
        const isOver = r.remind_date < today;
        const isTod  = r.remind_date === today;
        const bg  = isOver ? '#fee2e2' : isTod ? '#fef3c7' : '#dbeafe';
        const col = isOver ? '#991b1b' : isTod ? '#92400e' : '#1e40af';
        const label = isOver ? '⚠️ OVERDUE · ' + formatReminderDate(r.remind_date)
                    : isTod  ? '🔔 TODAY'
                    : '🗓 ' + formatReminderDate(r.remind_date);
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:' + bg + ';color:' + col + ';border:1px solid ' + (isOver ? '#fca5a5' : isTod ? '#fbbf24' : '#93c5fd') + '">' +
          escHtml(label) +
          (r.note ? ' — ' + escHtml(r.note.slice(0, 25)) + (r.note.length > 25 ? '…' : '') : '') +
          '<span onclick="removeReminder(' + r.id + ')" style="cursor:pointer;opacity:.5;font-size:12px;margin-left:6px;font-weight:700" title="Delete">✕</span>' +
          '</span>';
      }).join('') + '</div>';
  } catch (e) {
    container.innerHTML = '';
  }
}

async function setReminder() {
  const id = STATE.panel.accountId;
  if (!id) return;

  const dateInput = document.getElementById('reminderDate');
  const noteInput = document.getElementById('reminderNote');
  const date = dateInput ? dateInput.value.trim() : '';
  const note = noteInput ? noteInput.value.trim() : '';

  if (!date) { showToast('Please pick a date first.', 'error'); return; }

  const btn = document.getElementById('reminderSetBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Setting…'; }

  try {
    const r = await apiFetch('/api/accounts/' + id + '/reminders', {
      method: 'POST',
      body: JSON.stringify({ remind_date: date, note: note }),
    });

    // Clear inputs
    if (dateInput) dateInput.value = '';
    if (noteInput) noteInput.value = '';

    // Update local state
    const enriched = Object.assign({}, r, { balance: 0, aging_flag: 'new' });
    STATE.reminders.push(enriched);
    updateReminderBadge();
    loadPanelReminders(id);

    // Invalidate AI cache
    delete STATE.aiSuggestCache[id];
    // Refresh AI suggestion
    const aiDiv = document.getElementById('panelAiSuggest');
    if (aiDiv) {
      fetchAiSuggestion(id).then(data => renderPanelAiSuggestion(data));
    }

    showToast(`Reminder set for ${formatReminderDate(date)}`, 'success');
  } catch (e) {
    showToast('Failed to set reminder: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Set Reminder'; }
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  ZOHO BOOKS SYNC MODULE
// ═══════════════════════════════════════════════════════════════════════════

// ── Load Zoho status from server ─────────────────────────────────────────
async function loadZohoStatus() {
  const statusBody  = document.getElementById('zohoStatusBody');
  const setupCard   = document.getElementById('zohoSetupCard');
  const statsCard   = document.getElementById('zohoStatsCard');
  const historyCard = document.getElementById('zohoHistoryCard');
  const orgCard     = document.getElementById('zohoOrgCard');
  const syncBtn     = document.getElementById('zohoSyncNowBtn');
  const badge       = document.getElementById('zohoCfgBadge');
  const sidebarBadge = document.getElementById('zohoStatusBadge');

  if (statusBody) statusBody.innerHTML = '<div class="zoho-loading">Loading Zoho status…</div>';

  try {
    const data = await apiFetch('/api/zoho/status');

    // Update sidebar badge
    if (sidebarBadge) {
      sidebarBadge.style.display = 'inline-flex';
      sidebarBadge.textContent   = data.configured ? '✓' : '!';
      sidebarBadge.className     = 'badge ' + (data.configured ? 'badge-success' : 'badge-warning');
    }

    if (data.configured) {
      // Show configured state
      if (badge)     { badge.textContent = '✓ Connected'; badge.className = 'badge badge-success'; }
      if (syncBtn)   syncBtn.style.display = 'inline-flex';
      if (setupCard) setupCard.style.display  = 'none';
      if (orgCard)   orgCard.style.display    = 'none';

      // Status body — last sync info
      const log = data || {};
      const lastSync = log.last_sync
        ? new Date(log.last_sync).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })
        : 'Never';
      const statusColor = log.last_status === 'ok' ? 'var(--color-success)' : (log.last_status === 'error' ? 'var(--color-error)' : 'var(--color-text-faint)');

      if (statusBody) statusBody.innerHTML = `
        <div class="zoho-status-grid">
          <div class="zoho-stat-card">
            <div class="zoho-stat-label">Organisation</div>
            <div class="zoho-stat-value" style="font-size:var(--text-base)">${escHtml(data.org_name || data.org_id || '—')}</div>
            <div class="zoho-stat-sub">ID: ${escHtml(data.org_id || '—')}</div>
          </div>
          <div class="zoho-stat-card">
            <div class="zoho-stat-label">Last Sync</div>
            <div class="zoho-stat-value" style="font-size:var(--text-sm);font-weight:600;color:${statusColor}">${lastSync}</div>
            <div class="zoho-stat-sub">${log.last_count ? log.last_count + ' accounts' : ''}</div>
          </div>
          <div class="zoho-stat-card">
            <div class="zoho-stat-label">Sync Status</div>
            <div class="zoho-stat-value" style="font-size:var(--text-sm)">
              ${log.last_status === 'ok'    ? '<span class="zoho-ok">✓ Success</span>' :
                log.last_status === 'error' ? '<span class="zoho-err">✗ Error</span>'  : '—'}
            </div>
            <div class="zoho-stat-sub">${log.last_error ? escHtml(log.last_error.slice(0,80)) : 'Auto-syncs every hour'}</div>
          </div>
          <div class="zoho-stat-card">
            <div class="zoho-stat-label">Next Auto-Sync</div>
            <div class="zoho-stat-value" style="font-size:var(--text-sm)">Every 60 min</div>
            <div class="zoho-stat-sub">Background, automatic</div>
          </div>
        </div>
      `;

      // Stats card
      if (statsCard) {
        statsCard.style.display = 'block';
        const sb = document.getElementById('zohoStatsBody');
        if (sb) sb.innerHTML = `
          <div style="font-size:var(--text-sm);color:var(--color-text-muted)">
            Zoho Books is connected and syncing automatically every hour.
            The dashboard data is pulled directly from your Zoho Books outstanding list —
            no CSV upload needed.
          </div>
          <div style="margin-top:var(--space-3);display:flex;gap:var(--space-2);flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="disconnectZoho()" style="color:var(--color-error)">
              Disconnect Zoho
            </button>
          </div>
        `;
      }

      // History card
      if (historyCard) {
        historyCard.style.display = 'block';
        renderZohoHistory(log.history || []);
      }

    } else {
      // Not configured — show setup form
      if (badge)     { badge.textContent = '⚠ Not connected'; badge.className = 'badge badge-warning'; }
      if (syncBtn)   syncBtn.style.display  = 'none';
      if (statsCard) statsCard.style.display = 'none';
      if (historyCard) historyCard.style.display = 'none';

      // Check if credentials set but no org_id
      if (!data.org_id) {
        if (setupCard) setupCard.style.display = 'none';
        if (orgCard)   orgCard.style.display   = 'block';
        loadZohoOrgs();
        if (statusBody) statusBody.innerHTML = `
          <div class="zoho-sync-progress">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Credentials saved — please select your Zoho organisation below to complete setup.
          </div>
        `;
      } else {
        if (setupCard) setupCard.style.display = 'block';
        if (orgCard)   orgCard.style.display   = 'none';
        if (statusBody) statusBody.innerHTML = `
          <div style="font-size:var(--text-sm);color:var(--color-text-muted)">
            Connect your Zoho Books account to pull outstanding data automatically — no more CSV uploads needed.
          </div>
        `;
      }
    }

  } catch (e) {
    if (statusBody) statusBody.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm)">Error loading Zoho status: ${escHtml(e.message)}</div>`;
  }
}

// ── Render sync history table ─────────────────────────────────────────────
function renderZohoHistory(history) {
  const body = document.getElementById('zohoHistoryBody');
  if (!body) return;

  if (!history || history.length === 0) {
    body.innerHTML = '<div style="padding:var(--space-4) var(--space-5);font-size:var(--text-sm);color:var(--color-text-faint)">No sync history yet.</div>';
    return;
  }

  const rows = history.map(h => {
    const ts  = h.timestamp ? new Date(h.timestamp).toLocaleString('en-IN', { dateStyle:'short', timeStyle:'short' }) : '—';
    const st  = h.status === 'ok'    ? '<span class="zoho-ok">✓ ok</span>'   :
                h.status === 'error' ? '<span class="zoho-err">✗ error</span>' : h.status || '—';
    const cnt = h.count != null ? h.count : '—';
    const err = h.error ? `<span title="${escHtml(h.error)}" style="color:var(--color-error)">${escHtml(h.error.slice(0,60))}…</span>` : '';
    return `<tr><td>${ts}</td><td>${st}</td><td>${cnt}</td><td>${err}</td></tr>`;
  }).join('');

  body.innerHTML = `
    <table class="zoho-history-table">
      <thead><tr><th>Time</th><th>Status</th><th>Records</th><th>Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Save credentials using Grant Code flow ────────────────────────────────
async function saveZohoCredentials() {
  const clientId     = (document.getElementById('zClientId')     || {}).value?.trim();
  const clientSecret = (document.getElementById('zClientSecret') || {}).value?.trim();
  const grantCode    = (document.getElementById('zGrantCode')    || {}).value?.trim();
  const statusEl     = document.getElementById('zohoSetupStatus');
  const btn          = document.getElementById('zohoSetupBtn');

  if (!clientId || !clientSecret || !grantCode) {
    if (statusEl) { statusEl.textContent = 'Please fill in all fields.'; statusEl.style.color = 'var(--color-error)'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  if (statusEl) { statusEl.textContent = 'Exchanging grant code…'; statusEl.style.color = 'var(--color-text-muted)'; }

  try {
    const result = await apiFetch('/api/zoho/setup', {
      method: 'POST',
      body:   JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_code: grantCode }),
    });

    if (statusEl) { statusEl.textContent = '✓ ' + (result.message || 'Credentials saved!'); statusEl.style.color = 'var(--color-success)'; }

    // Reload status — will now ask to pick org
    setTimeout(() => loadZohoStatus(), 800);

  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.style.color = 'var(--color-error)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save & Connect'; }
  }
}

// ── Save credentials using Refresh Token directly ─────────────────────────
async function saveZohoRefreshToken() {
  const clientId     = (document.getElementById('zRtClientId')     || {}).value?.trim();
  const clientSecret = (document.getElementById('zRtClientSecret') || {}).value?.trim();
  const refreshToken = (document.getElementById('zRefreshToken')   || {}).value?.trim();
  const orgId        = (document.getElementById('zOrgId')          || {}).value?.trim();
  const statusEl     = document.getElementById('zohoRtStatus');

  if (!clientId || !clientSecret || !refreshToken || !orgId) {
    if (statusEl) { statusEl.textContent = 'Please fill in all 4 fields.'; statusEl.style.color = 'var(--color-error)'; }
    return;
  }

  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--color-text-muted)'; }

  try {
    const result = await apiFetch('/api/zoho/setup/refresh-token', {
      method: 'POST',
      body:   JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, org_id: orgId }),
    });
    if (statusEl) { statusEl.textContent = '✓ ' + (result.message || 'Saved!'); statusEl.style.color = 'var(--color-success)'; }
    setTimeout(() => loadZohoStatus(), 800);
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.style.color = 'var(--color-error)'; }
  }
}

// ── Load Zoho organisations list ──────────────────────────────────────────
async function loadZohoOrgs() {
  const list = document.getElementById('zohoOrgList');
  if (!list) return;

  list.innerHTML = '<div class="zoho-loading">Loading organisations from Zoho…</div>';

  try {
    const orgs = await apiFetch('/api/zoho/organizations');

    if (!orgs || orgs.length === 0) {
      list.innerHTML = '<div style="font-size:var(--text-sm);color:var(--color-text-faint)">No organisations found. Check your credentials.</div>';
      return;
    }

    list.innerHTML = orgs.map(o => `
      <div class="zoho-org-item">
        <div>
          <div class="zoho-org-name">${escHtml(o.name || o.organization_name || '—')}</div>
          <div class="zoho-org-id">ID: ${escHtml(String(o.organization_id || o.id || ''))}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="selectZohoOrg('${escHtml(String(o.organization_id || o.id || ''))}', '${escHtml(o.name || o.organization_name || '')}')">
          Use this org
        </button>
      </div>
    `).join('');

  } catch (e) {
    list.innerHTML = `<div style="color:var(--color-error);font-size:var(--text-sm)">Failed to load organisations: ${escHtml(e.message)}</div>`;
  }
}

// ── Select a Zoho organisation ────────────────────────────────────────────
async function selectZohoOrg(orgId, orgName) {
  try {
    await apiFetch('/api/zoho/setup/refresh-token', {
      method: 'POST',
      body:   JSON.stringify({ org_id: orgId, org_name: orgName }),
    });
    showToast(`Organisation "${orgName}" selected. Zoho Books is now connected!`, 'success');
    setTimeout(() => loadZohoStatus(), 800);
  } catch (e) {
    showToast('Failed to save organisation: ' + e.message, 'error');
  }
}

// ── Trigger a manual sync ─────────────────────────────────────────────────
async function triggerZohoSync() {
  const btn      = document.getElementById('zohoSyncNowBtn');
  const statusBody = document.getElementById('zohoStatusBody');

  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }

  // Show progress indicator
  const progressEl = document.createElement('div');
  progressEl.className = 'zoho-sync-progress';
  progressEl.style.marginTop = 'var(--space-3)';
  progressEl.innerHTML = `
    <div class="ai-loading-dot"></div>
    Syncing from Zoho Books — this may take 10–30 seconds…
  `;
  if (statusBody) statusBody.prepend(progressEl);

  try {
    const result = await apiFetch('/api/zoho/sync', { method: 'POST' });
    progressEl.remove();
    showToast(`✓ Sync complete — ${result.count} accounts updated from Zoho Books`, 'success');

    // Reload data and Zoho status
    STATE.aiSuggestCache = {};
    await loadAllData();
    await loadZohoStatus();

  } catch (e) {
    progressEl.remove();
    showToast('Sync failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Sync Now'; }
  }
}

// ── Disconnect Zoho ───────────────────────────────────────────────────────
async function disconnectZoho() {
  if (!confirm('Disconnect Zoho Books? Your existing dashboard data will NOT be deleted. You can reconnect at any time.')) return;

  try {
    await apiFetch('/api/zoho/disconnect', { method: 'POST' });
    showToast('Zoho Books disconnected.', 'info');
    loadZohoStatus();
  } catch (e) {
    showToast('Error disconnecting: ' + e.message, 'error');
  }
}

// ── Sidebar badge refresh (called on init) ────────────────────────────────
async function loadZohoBadgeOnly() {
  try {
    const data  = await apiFetch('/api/zoho/status');
    const badge = document.getElementById('zohoStatusBadge');
    if (!badge) return;
    badge.style.display = 'inline-flex';
    badge.textContent   = data.configured ? '✓' : '!';
    badge.className     = 'badge ' + (data.configured ? 'badge-success' : 'badge-warning');
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════
// ── PROMISE MODULE ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

async function loadPromises() {
  const listEl   = document.getElementById('promisesList');
  const alertEl  = document.getElementById('brokenPromisesAlert');
  const brokenEl = document.getElementById('brokenPromisesList');
  const cntEl    = document.getElementById('brokenPromisesCount');

  if (listEl) listEl.innerHTML = '<div class="reminder-empty">Loading…</div>';

  try {
    const [allPromises, brokenPromises] = await Promise.all([
      apiFetch('/api/promises'),
      apiFetch('/api/promises/broken'),
    ]);

    // Update broken promises badge in sidebar
    loadPromisesBadgeOnly(brokenPromises.length);

    // Show/hide broken alert
    if (alertEl) {
      alertEl.style.display = brokenPromises.length ? '' : 'none';
      if (cntEl) cntEl.textContent = `${brokenPromises.length} overdue`;
      if (brokenEl) brokenEl.innerHTML = brokenPromises.map(renderPromiseItem.bind(null, true)).join('') || '<div class="reminder-empty">None</div>';
    }

    // Render active
    if (listEl) {
      const active = allPromises.filter(p => p.status === 'pending' || p.status === 'promise');
      listEl.innerHTML = active.length
        ? active.map(renderPromiseItem.bind(null, false)).join('')
        : '<div class="reminder-empty">No active promises. Record one from any account\'s panel.</div>';
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div class="reminder-empty">Error: ${escHtml(e.message)}</div>`;
  }
}

function renderPromiseItem(isBroken, p) {
  const dateStr  = p.promised_date ? new Date(p.promised_date + 'T00:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—';
  const amt      = p.promised_amount ? `₹${formatINR(p.promised_amount)}` : '—';
  const cls      = isBroken ? 'promise-item promise-broken' : 'promise-item';
  const brokTag  = isBroken ? '<span class="promise-chip chip-broken">OVERDUE</span>' : '';
  return `
    <div class="${cls}" data-id="${p.id}">
      <div class="promise-header">
        <div>
          <span class="promise-acc" onclick="openPanel(${p.account_id})" style="cursor:pointer">${escHtml(p.account_name)}</span>
          ${brokTag}
        </div>
        <span class="promise-amount">${amt}</span>
      </div>
      <div class="promise-meta">Promised by ${dateStr}${p.note ? ' · ' + escHtml(p.note) : ''}${p.created_by ? ' · ' + escHtml(p.created_by) : ''}</div>
      <div class="promise-actions">
        <button class="reminder-done-btn" onclick="markPromiseReceived(${p.id})">✓ Received</button>
        <button class="reminder-del-btn" onclick="deletePromise(${p.id})">Delete</button>
      </div>
    </div>
  `;
}

async function markPromiseReceived(promiseId) {
  try {
    await apiFetch(`/api/promises/${promiseId}/received`, { method: 'PATCH' });
    showToast('Promise marked as received!', 'success');
    loadPromises();
    // Refresh badge
    loadPromisesBadgeOnly();
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  }
}

async function deletePromise(promiseId) {
  if (!confirm('Delete this promise record?')) return;
  try {
    await apiFetch(`/api/promises/${promiseId}`, { method: 'DELETE' });
    showToast('Promise deleted.', 'info');
    loadPromises();
    loadPromisesBadgeOnly();
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  }
}

async function loadPanelPromises(accountId) {
  const listEl = document.getElementById('panelPromisesList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="font-size:var(--text-xs);color:var(--color-text-faint);padding:4px 0">Loading promises…</div>';
  try {
    const promises = await apiFetch(`/api/accounts/${accountId}/promises`);
    const active = promises.filter(p => p.status === 'pending' || p.status === 'promise');
    listEl.innerHTML = active.length
      ? active.map(p => {
          const dateStr = p.promised_date ? new Date(p.promised_date + 'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '—';
          const amt = p.promised_amount ? `₹${formatINR(p.promised_amount)}` : '';
          return `<div class="promise-item" style="margin-top:var(--space-2)">
            <div class="promise-header">
              <span style="font-size:var(--text-xs);color:var(--color-text)">Promised ${dateStr}</span>
              <span class="promise-amount">${amt}</span>
            </div>
            ${p.note ? `<div class="promise-meta">${escHtml(p.note)}</div>` : ''}
            <div class="promise-actions">
              <button class="reminder-done-btn" onclick="markPromiseReceived(${p.id}); loadPanelPromises(${accountId})">✓ Received</button>
              <button class="reminder-del-btn" onclick="deletePromise(${p.id}); loadPanelPromises(${accountId})">Del</button>
            </div>
          </div>`;
        }).join('')
      : '';
  } catch (_) { listEl.innerHTML = ''; }
}

async function setPromise(accountId) {
  const amtEl  = document.getElementById('promiseAmount');
  const dateEl = document.getElementById('promiseDate');
  const noteEl = document.getElementById('promiseNote');
  const btn    = document.getElementById('promiseSetBtn');

  const amount = parseFloat(amtEl && amtEl.value);
  const date   = dateEl && dateEl.value;
  const note   = noteEl && noteEl.value.trim();

  if (!amount || !date) { showToast('Enter amount and date.', 'error'); return; }
  if (btn) btn.disabled = true;
  try {
    await apiFetch(`/api/accounts/${accountId}/promises`, {
      method: 'POST',
      body: JSON.stringify({ promised_amount: amount, promised_date: date, note }),
    });
    if (amtEl) amtEl.value = '';
    if (dateEl) dateEl.value = '';
    if (noteEl) noteEl.value = '';
    showToast('Promise recorded!', 'success');
    loadPanelPromises(accountId);
    loadPromisesBadgeOnly();
    // Update account status to promise in local state
    const acc = STATE.accounts.find(a => a.id === accountId);
    if (acc) {
      acc.status = 'promise';
      renderTopDebtors();
      updateProgressStats();
    }
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function loadPromisesBadgeOnly(count) {
  const badge = document.getElementById('brokenPromiseBadge');
  if (!badge) return;
  if (count !== undefined) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
    return;
  }
  apiFetch('/api/promises/broken').then(broken => {
    badge.textContent = broken.length;
    badge.style.display = broken.length > 0 ? 'inline-flex' : 'none';
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════
// ── SETTINGS / USERS MODULE ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

async function loadUsersView() {
  const listEl = document.getElementById('usersList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="reminder-empty">Loading…</div>';
  try {
    const users = await apiFetch('/api/users');
    if (!users || users.length === 0) {
      listEl.innerHTML = '<div class="reminder-empty">No users found.</div>';
      return;
    }
    listEl.innerHTML = users.map(u => `
      <div class="user-row">
        <div class="user-info">
          <span class="user-name">${escHtml(u.name)}</span>
          <span class="user-badge badge-${u.role}">${u.role}</span>
          ${!u.active ? '<span class="user-badge badge-inactive">inactive</span>' : ''}
        </div>
        <div class="user-actions">
          ${u.active ? `<button class="reminder-del-btn" onclick="deactivateUser(${u.id}, '${escHtml(u.name)}')">Deactivate</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="reminder-empty">Error: ${escHtml(e.message)}<br><small>Admin access required.</small></div>`;
  }
}

async function addUser() {
  const nameEl   = document.getElementById('newUserName');
  const pinEl    = document.getElementById('newUserPin');
  const roleEl   = document.getElementById('newUserRole');
  const statusEl = document.getElementById('addUserStatus');

  const name = nameEl && nameEl.value.trim();
  const pin  = pinEl  && pinEl.value.trim();
  const role = roleEl && roleEl.value;

  if (!name || !pin) { if (statusEl) { statusEl.textContent = 'Name and PIN are required.'; statusEl.style.color = 'var(--color-error)'; } return; }

  try {
    await apiFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, pin, role }),
    });
    if (nameEl) nameEl.value = '';
    if (pinEl)  pinEl.value  = '';
    if (statusEl) { statusEl.textContent = `✓ ${name} added!`; statusEl.style.color = 'var(--color-success)'; }
    loadUsersView();
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.style.color = 'var(--color-error)'; }
  }
}

async function deactivateUser(userId, name) {
  if (!confirm(`Deactivate ${name}? They will not be able to log in.`)) return;
  try {
    await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
    showToast(`${name} deactivated.`, 'info');
    loadUsersView();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function changePin() {
  const oldPinEl  = document.getElementById('changePinOld');
  const newPinEl  = document.getElementById('changePinNew');
  const statusEl  = document.getElementById('changePinStatus');

  const old_pin = oldPinEl && oldPinEl.value.trim();
  const new_pin = newPinEl && newPinEl.value.trim();

  if (!old_pin || !new_pin) { if (statusEl) { statusEl.textContent = 'Both fields required.'; statusEl.style.color = 'var(--color-error)'; } return; }
  if (new_pin.length < 4)   { if (statusEl) { statusEl.textContent = 'New PIN must be at least 4 characters.'; statusEl.style.color = 'var(--color-error)'; } return; }

  try {
    await apiFetch('/api/users/pin', {
      method: 'PATCH',
      body: JSON.stringify({ name: STATE.authorName, old_pin, new_pin }),
    });
    if (oldPinEl) oldPinEl.value = '';
    if (newPinEl) newPinEl.value = '';
    if (statusEl) { statusEl.textContent = '✓ PIN changed successfully.'; statusEl.style.color = 'var(--color-success)'; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.style.color = 'var(--color-error)'; }
  }
}
