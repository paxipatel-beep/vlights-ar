'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ZOHO BOOKS SYNC MODULE — vlights AR Dashboard
 *  Pulls AR outstanding data from Zoho Books and loads it into the local DB.
 *
 *  Auth strategy: Self-Client OAuth 2.0 (server-side, no user redirect needed)
 *  Tokens stored in: ./data/zoho_tokens.json  (never committed to git)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const https  = require('https');
const http   = require('http');
const url    = require('url');
const fs     = require('fs');
const path   = require('path');

// ── CONFIG ──────────────────────────────────────────────────────────────────
const TOKEN_FILE  = path.resolve('./data/zoho_tokens.json');
const SYNC_LOG    = path.resolve('./data/zoho_sync_log.json');

// India DC — if your Zoho account is .in, use accounts.zoho.in + zohoapis.in
// If .com, use accounts.zoho.com + zohoapis.com
const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
const API_BASE     = process.env.ZOHO_API_BASE     || 'https://www.zohoapis.in';

// ── TOKEN STORAGE ────────────────────────────────────────────────────────────
function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// ── HTTP HELPERS ─────────────────────────────────────────────────────────────
function httpsPost(endpoint, params) {
  return new Promise((resolve, reject) => {
    const body    = new URLSearchParams(params).toString();
    const parsed  = new URL(endpoint);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end',  ()    => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(endpoint, accessToken) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(endpoint);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type':  'application/json',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end',  ()    => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── TOKEN REFRESH ─────────────────────────────────────────────────────────────
async function getAccessToken() {
  const tokens = loadTokens();
  const cfg    = getConfig();

  if (!cfg.client_id || !cfg.client_secret || !cfg.refresh_token) {
    throw new Error('Zoho credentials not configured. Run zoho:setup first.');
  }

  // Check if current access token is still valid (with 5min buffer)
  const now = Date.now();
  if (tokens.access_token && tokens.expires_at && (tokens.expires_at - now) > 300000) {
    return tokens.access_token;
  }

  // Refresh
  console.log('[Zoho] Refreshing access token…');
  const res = await httpsPost(`${ACCOUNTS_URL}/oauth/v2/token`, {
    refresh_token: cfg.refresh_token,
    grant_type:    'refresh_token',
    client_id:     cfg.client_id,
    client_secret: cfg.client_secret,
  });

  if (res.status !== 200 || !res.body.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(res.body)}`);
  }

  // Save new access token
  const updated = {
    ...tokens,
    access_token: res.body.access_token,
    expires_at:   now + (res.body.expires_in || 3600) * 1000,
  };
  saveTokens(updated);
  console.log('[Zoho] Access token refreshed OK');
  return res.body.access_token;
}

// ── CONFIG HELPERS ────────────────────────────────────────────────────────────
const CONFIG_FILE = path.resolve('./data/zoho_config.json');

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function isConfigured() {
  const cfg = getConfig();
  return !!(cfg.client_id && cfg.client_secret && cfg.refresh_token && cfg.org_id);
}

// ── SYNC LOG ──────────────────────────────────────────────────────────────────
function loadSyncLog() {
  try {
    if (fs.existsSync(SYNC_LOG)) return JSON.parse(fs.readFileSync(SYNC_LOG, 'utf8'));
  } catch (e) {}
  return { last_sync: null, last_status: null, last_count: 0, last_error: null, history: [] };
}

function writeSyncLog(entry) {
  const log = loadSyncLog();
  log.last_sync   = entry.timestamp;
  log.last_status = entry.status;
  log.last_count  = entry.count  || 0;
  log.last_error  = entry.error  || null;
  log.history = [entry, ...(log.history || [])].slice(0, 20); // keep last 20
  fs.writeFileSync(SYNC_LOG, JSON.stringify(log, null, 2));
}

// ── AGING FLAG FROM DAYS ───────────────────────────────────────────────────────
function agingFlagFromDays(days) {
  const d = Number(days) || 0;
  if (d >= 720) return 'very_old';
  if (d >= 360) return 'old';
  if (d >= 180) return 'aging';
  if (d >= 90)  return 'recent';
  return 'new';
}

// ── MAIN SYNC FUNCTION ─────────────────────────────────────────────────────────
async function syncFromZoho(bulkLoad, logActivity, actor = 'ZOHO_SYNC') {
  const cfg = getConfig();

  if (!isConfigured()) {
    throw new Error('Zoho Books not configured. Please run the setup first.');
  }

  const orgId = cfg.org_id;
  const timestamp = new Date().toISOString();
  console.log(`[Zoho] Starting sync at ${timestamp} for org ${orgId}…`);

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    writeSyncLog({ timestamp, status: 'error', error: 'Token error: ' + e.message });
    throw e;
  }

  // ── Step 1: Fetch customer balances ──────────────────────────────────────────
  // GET /reports/customerbalancessummary
  let page = 1;
  const allCustomers = [];

  while (true) {
    const endpoint = `${API_BASE}/books/v3/reports/customerbalancessummary` +
      `?organization_id=${orgId}&page=${page}&per_page=200`;

    const res = await httpsGet(endpoint, accessToken);
    if (res.status !== 200) {
      // Token may be expired — try refresh once
      if (res.status === 401) {
        accessToken = await refreshAndRetry();
        continue;
      }
      throw new Error(`Customer balances API failed: ${res.status} — ${JSON.stringify(res.body).slice(0, 200)}`);
    }

    const data = res.body;
    if (data.code !== 0) {
      throw new Error(`Zoho API error: ${data.message || JSON.stringify(data)}`);
    }

    const customers = data.customer_balance_summary || [];
    allCustomers.push(...customers);

    // Pagination
    const pageCtx = data.page_context || {};
    if (!pageCtx.has_more_page) break;
    page++;
    if (page > 50) break; // safety cap (10,000 records)
  }

  console.log(`[Zoho] Fetched ${allCustomers.length} customers from customer balance summary`);

  if (allCustomers.length === 0) {
    writeSyncLog({ timestamp, status: 'ok', count: 0, error: null });
    return { count: 0, message: 'No customers found in Zoho Books' };
  }

  // ── Step 2: Fetch AR Aging Details (for days overdue per customer) ──────────
  // We'll use the AR Aging Details report to get per-invoice aging
  // Then aggregate per customer to find oldest invoice
  const agingMap = {}; // customer_id → { oldest_days, oldest_due, inv_count }
  let agingPage = 1;

  while (true) {
    const endpoint = `${API_BASE}/books/v3/reports/agedreceivables` +
      `?organization_id=${orgId}&page=${agingPage}&per_page=200`;

    const res = await httpsGet(endpoint, accessToken);
    if (res.status !== 200) break; // Aging report optional — fall back to balance summary only

    const data = res.body;
    if (data.code !== 0) break;

    const invoices = data.aged_receivables || data.invoices || [];
    for (const inv of invoices) {
      const cid  = inv.customer_id || inv.contact_id;
      const days = parseInt(inv.days_elapsed || inv.age || 0);
      const due  = inv.due_date || '';
      const bal  = parseFloat(inv.balance || 0);

      if (!cid || bal <= 0) continue;

      if (!agingMap[cid]) {
        agingMap[cid] = { oldest_days: 0, oldest_due: '', inv_count: 0 };
      }
      agingMap[cid].inv_count++;
      if (days > agingMap[cid].oldest_days) {
        agingMap[cid].oldest_days = days;
        agingMap[cid].oldest_due  = due;
      }
    }

    const pageCtx = data.page_context || {};
    if (!pageCtx.has_more_page) break;
    agingPage++;
    if (agingPage > 50) break;
  }

  console.log(`[Zoho] Aged receivables enriched for ${Object.keys(agingMap).length} customers`);

  // ── Step 3: Build accounts array and bulkLoad ─────────────────────────────
  const accounts = allCustomers.map(c => {
    const cid      = c.customer_id || c.contact_id || c.customer_name;
    const balance  = parseFloat(c.outstanding_receivable_amount || c.balance || 0);
    const aging    = agingMap[cid] || {};
    const days     = aging.oldest_days || 0;
    const dueDate  = aging.oldest_due  || '';
    const invCount = aging.inv_count   || 1;

    return {
      customer_id:  String(cid),
      name:         c.customer_name || c.display_name || 'Unknown',
      balance:      balance,
      oldest_days:  days,
      inv_count:    invCount,
      aging_flag:   agingFlagFromDays(days),
      oldest_due:   dueDate,
    };
  }).filter(a => a.balance > 0); // only load accounts with outstanding balance

  console.log(`[Zoho] Loading ${accounts.length} accounts into DB…`);

  const count = bulkLoad(accounts);

  // Log the activity
  try {
    logActivity.run({
      account_id:   null,
      account_name: 'ZOHO_SYNC',
      action:       'zoho_sync',
      old_value:    '',
      new_value:    `${count} accounts synced from Zoho Books`,
      actor,
    });
  } catch (e) {}

  writeSyncLog({ timestamp, status: 'ok', count, error: null });
  console.log(`[Zoho] Sync complete — ${count} accounts loaded`);
  return { count, message: `${count} accounts synced from Zoho Books` };
}

// Helper: force refresh and get new token
async function refreshAndRetry() {
  const cfg     = getConfig();
  const tokens  = loadTokens();
  const now     = Date.now();
  const res     = await httpsPost(`${ACCOUNTS_URL}/oauth/v2/token`, {
    refresh_token: cfg.refresh_token,
    grant_type:    'refresh_token',
    client_id:     cfg.client_id,
    client_secret: cfg.client_secret,
  });
  if (res.status !== 200 || !res.body.access_token) {
    throw new Error(`Token re-refresh failed: ${JSON.stringify(res.body)}`);
  }
  saveTokens({ ...tokens, access_token: res.body.access_token, expires_at: now + 3600000 });
  return res.body.access_token;
}

// ── SETUP: exchange grant code for refresh token ──────────────────────────────
async function setupWithGrantCode(clientId, clientSecret, grantCode) {
  const res = await httpsPost(`${ACCOUNTS_URL}/oauth/v2/token`, {
    code:          grantCode,
    grant_type:    'authorization_code',
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  'https://payments.paxipatelbot.in/zoho/callback',
  });

  if (res.status !== 200 || !res.body.refresh_token) {
    throw new Error(`Grant exchange failed: ${JSON.stringify(res.body)}`);
  }

  const cfg = getConfig();
  saveConfig({
    ...cfg,
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: res.body.refresh_token,
  });
  saveTokens({
    access_token: res.body.access_token,
    expires_at:   Date.now() + (res.body.expires_in || 3600) * 1000,
  });

  console.log('[Zoho] Setup complete. Refresh token saved.');
  return { ok: true, refresh_token: res.body.refresh_token };
}

// ── SETUP: fetch org list to let user pick their org ─────────────────────────
async function fetchOrganizations() {
  const accessToken = await getAccessToken();
  const res = await httpsGet(
    `${API_BASE}/books/v3/organizations`,
    accessToken,
  );
  if (res.status !== 200) throw new Error(`Failed to fetch orgs: ${res.status}`);
  return res.body.organizations || [];
}

module.exports = {
  syncFromZoho,
  isConfigured,
  getConfig,
  saveConfig,
  loadSyncLog,
  fetchOrganizations,
  setupWithGrantCode,
};
