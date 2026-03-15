'use strict';
require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const helmet    = require('helmet');
const path      = require('path');
const fs        = require('fs');

const {
  getAllAccounts, getComments, addComment, deleteComment,
  updateStatus, logActivity, getActivity, getAccountById, bulkLoad,
  addReminder, getRemindersForAccount, getAllReminders, getDueReminders,
  markReminderDone, deleteReminder,
  addPromise, getPromisesForAccount, getAllActivePromises, getBrokenPromises,
  updatePromiseStatus, deletePromise,
  getUserByName, getAllUsers, addUser, updateUserPin, deactivateUser,
  db,
} = require('./db');

const zoho = require('./zoho-sync');
const tg   = require('./telegram');

const app  = express();
const PORT = process.env.PORT || 3000;
const PWD  = process.env.DASHBOARD_PASSWORD || 'Prakash_9892284364';

// ── Security + parsing ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Session ──
app.use(session({
  secret:            process.env.SESSION_SECRET || 'vlights-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ── Auth middleware ──
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login');
}

// ── Static files (assets) ──
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// ── Login page ──
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  let { author, author2, pin, password } = req.body;

  // author may be an array if both hidden+visible inputs share name="author"
  if (Array.isArray(author)) author = author.find(v => v && v.trim()) || '';
  if (Array.isArray(author2)) author2 = author2.find(v => v && v.trim()) || '';

  const name = (author || '').trim();
  const name2 = (author2 || '').trim();

  // ── Named user login (name + PIN) ──
  if (name && pin) {
    const user = getUserByName.get(name);
    if (user && user.active !== 0 && user.pin === pin.trim()) {
      req.session.authenticated = true;
      req.session.author = user.name;
      req.session.role   = user.role;
      return res.redirect('/');
    }
    return res.send(loginPage('Wrong name or PIN. Try again.'));
  }

  // ── Legacy shared-password login (backward compat) ──
  const legacyName = name2 || name;
  if (password === PWD && legacyName.length > 0) {
    req.session.authenticated = true;
    req.session.author = legacyName;
    req.session.role   = 'member';
    return res.redirect('/');
  }

  res.send(loginPage('Wrong name, PIN or password. Try again.'));
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── All routes below require auth ──
app.use(requireAuth);

// ── Serve the dashboard ──
app.get('/', (req, res) => {
  const dashPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(dashPath)) {
    res.sendFile(dashPath);
  } else {
    res.status(503).send('Dashboard not found.');
  }
});
app.use(express.static(path.join(__dirname, 'public')));

// ── API: current user ──
app.get('/api/me', (req, res) => {
  res.json({ author: req.session.author, role: req.session.role || 'member' });
});

// ── API: get all accounts ──
app.get('/api/accounts', (req, res) => {
  const accounts = getAllAccounts.all();
  const result = accounts.map(a => ({
    ...a,
    comment_count: a.comment_count || 0,
  }));
  res.json(result);
});

// ── API: get comments for one account ──
app.get('/api/accounts/:id/comments', (req, res) => {
  const comments = getComments.all(req.params.id);
  res.json(comments);
});

// ── API: add comment ──
app.post('/api/accounts/:id/comments', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  const author = req.session.author;
  const info = addComment.run({
    account_id: req.params.id,
    author,
    text: text.trim(),
  });
  const acc = getAccountById.get(req.params.id);
  logActivity.run({
    account_id:   req.params.id,
    account_name: acc ? acc.name : '',
    action:       'comment',
    old_value:    '',
    new_value:    text.trim().slice(0, 100),
    actor:        author,
  });
  tg.notifyComment(acc ? acc.name : `#${req.params.id}`, author, text.trim());
  res.json({ id: info.lastInsertRowid, author, text: text.trim(), created_at: new Date().toISOString() });
});

// ── API: delete comment ──
app.delete('/api/accounts/:id/comments/:cid', (req, res) => {
  deleteComment.run({ id: req.params.cid, account_id: req.params.id });
  res.json({ ok: true });
});

// ── API: update status ──
app.patch('/api/accounts/:id/status', (req, res) => {
  const { status } = req.body;
  const allowed = ['pending','called','promise','partial','paid','disputed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });

  const acc = getAccountById.get(req.params.id);
  if (!acc) return res.status(404).json({ error: 'not found' });

  const author = req.session.author;
  updateStatus.run({ id: req.params.id, status, updated_by: author });
  logActivity.run({
    account_id:   req.params.id,
    account_name: acc.name,
    action:       'status_change',
    old_value:    acc.status,
    new_value:    status,
    actor:        author,
  });
  res.json({ ok: true, status });
});

// ── API: bulk load accounts from upload ──
app.post('/api/accounts/bulk', (req, res) => {
  const { accounts } = req.body;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res.status(400).json({ error: 'accounts array required' });
  }
  const count = bulkLoad(accounts);
  logActivity.run({
    account_id:   null,
    account_name: 'SYSTEM',
    action:       'bulk_upload',
    old_value:    '',
    new_value:    `${count} accounts loaded`,
    actor:        req.session.author,
  });
  // notify data import
  try {
    const totRow = db.prepare('SELECT SUM(balance) as t FROM accounts').get();
    tg.notifyDataImport(count, totRow ? totRow.t : null);
  } catch(_){}
  res.json({ ok: true, count });
});

// ── API: AI-backed smart suggestion for an account ──
app.get('/api/accounts/:id/suggest', (req, res) => {
  const acc = getAccountById.get(req.params.id);
  if (!acc) return res.status(404).json({ error: 'not found' });

  const comments  = getComments.all(req.params.id);
  const reminders = getRemindersForAccount.all(req.params.id);

  const days        = acc.oldest_days || 0;
  const balance     = acc.balance     || 0;
  const status      = acc.status      || 'pending';
  const commentCnt  = comments.length;
  const hasComments = commentCnt > 0;

  // Analyse comment text for signals
  const allText      = comments.map(c => (c.text||'').toLowerCase()).join(' ');
  const hasPromise   = allText.includes('promis') || allText.includes('will pay');
  const hasVoicemail = allText.includes('voicemail') || allText.includes('no answer');
  const hasWhatsApp  = allText.includes('whatsapp') || allText.includes('wa ');
  const hasLegalMention = allText.includes('legal') || allText.includes('notice') || allText.includes('lawyer');

  // Latest comment date
  let daysSinceLastContact = 999;
  if (hasComments) {
    const latest = comments[comments.length - 1];
    const then   = new Date(latest.created_at);
    daysSinceLastContact = Math.floor((Date.now() - then.getTime()) / 86400000);
  }

  // Upcoming reminders
  const today           = new Date().toISOString().slice(0, 10);
  const dueReminders    = reminders.filter(r => !r.done && r.remind_date <= today);
  const pendingReminders = reminders.filter(r => !r.done && r.remind_date > today);

  // ── Decision engine ──
  let suggestion = {};

  // 1. Overdue reminder — highest priority
  if (dueReminders.length > 0) {
    const r = dueReminders[0];
    suggestion = {
      priority: 'critical',
      icon: '🔔',
      action: 'Follow up on due reminder',
      detail: `Reminder set for today${r.note ? ': ' + r.note : ''}. Contact immediately.`,
      channel: 'call',
      urgency: 'TODAY',
      cls: 'sug-urgent',
    };
  }
  // 2. Paid / partial — confirm & close
  else if (status === 'paid') {
    suggestion = {
      priority: 'resolved',
      icon: '✅',
      action: 'Account settled',
      detail: 'Payment received. Confirm reconciliation and close the account.',
      channel: 'none',
      urgency: 'CLOSED',
      cls: 'sug-paid',
    };
  }
  else if (status === 'partial') {
    suggestion = {
      priority: 'medium',
      icon: '💰',
      action: 'Follow up for balance',
      detail: 'Partial payment received. Call to confirm remaining balance payment timeline.',
      channel: 'call',
      urgency: 'THIS WEEK',
      cls: 'sug-partial',
    };
  }
  // 3. Disputed — management loop-in
  else if (status === 'disputed') {
    suggestion = {
      priority: 'high',
      icon: '⚠️',
      action: 'Escalate dispute',
      detail: hasLegalMention
        ? 'Legal angle already raised. Loop in senior management and legal team for resolution.'
        : 'Disputed account. Escalate to senior management with documentation.',
      channel: 'escalate',
      urgency: 'URGENT',
      cls: 'sug-escalate',
    };
  }
  // 4. Promise — verify if paid
  else if (status === 'promise') {
    const stalePromise = daysSinceLastContact > 3;
    suggestion = {
      priority: 'high',
      icon: '🤝',
      action: stalePromise ? 'Promise follow-up overdue' : 'Check payment received',
      detail: stalePromise
        ? `Promise was given ${daysSinceLastContact} days ago but no update. Call to confirm if payment was made.`
        : 'Payment promised. Confirm receipt or get new commitment date.',
      channel: 'call',
      urgency: stalePromise ? 'OVERDUE' : 'TODAY',
      cls: 'sug-promise',
    };
  }
  // 5. Very old 720d+
  else if (days >= 720) {
    if (balance >= 200000) {
      suggestion = {
        priority: 'critical',
        icon: '🚨',
        action: 'Send legal notice',
        detail: `₹${Math.round(balance/1000)}K outstanding for 720+ days. Issue formal legal/demand notice immediately. Engage legal team.`,
        channel: 'legal',
        urgency: 'CRITICAL',
        cls: 'sug-legal',
      };
    } else if (hasLegalMention) {
      suggestion = {
        priority: 'critical',
        icon: '🚨',
        action: 'Enforce legal action',
        detail: 'Legal notice already mentioned. Follow through — file formal case or send lawyer letter.',
        channel: 'legal',
        urgency: 'CRITICAL',
        cls: 'sug-legal',
      };
    } else {
      suggestion = {
        priority: 'critical',
        icon: '🚨',
        action: 'Final warning call',
        detail: `${days} days overdue. This is the final opportunity before legal action. Call and mention legal consequences.`,
        channel: 'call',
        urgency: 'CRITICAL',
        cls: 'sug-legal',
      };
    }
  }
  // 6. Old 360–719d
  else if (days >= 360) {
    if (hasComments && hasWhatsApp && hasVoicemail) {
      suggestion = {
        priority: 'high',
        icon: '📈',
        action: 'Escalate to management',
        detail: 'Multiple attempts (calls + WhatsApp) made with no resolution. Escalate to senior management or director.',
        channel: 'escalate',
        urgency: 'URGENT',
        cls: 'sug-escalate',
      };
    } else if (balance >= 100000) {
      suggestion = {
        priority: 'high',
        icon: '📞',
        action: 'Director-level call',
        detail: `₹${Math.round(balance/1000)}K outstanding for 360+ days. Bypass regular contact — call the decision maker or director directly.`,
        channel: 'call',
        urgency: 'TODAY',
        cls: 'sug-urgent',
      };
    } else {
      suggestion = {
        priority: 'high',
        icon: '📋',
        action: 'Send demand letter',
        detail: 'Account overdue by 360+ days. Send a formal written demand letter with a payment deadline.',
        channel: 'letter',
        urgency: 'THIS WEEK',
        cls: 'sug-escalate',
      };
    }
  }
  // 7. Aging 180–359d
  else if (days >= 180) {
    if (hasVoicemail && !hasWhatsApp) {
      suggestion = {
        priority: 'medium',
        icon: '💬',
        action: 'Switch to WhatsApp',
        detail: 'Voicemail attempts made. Switch contact channel — send a formal WhatsApp message with invoice details.',
        channel: 'whatsapp',
        urgency: 'TODAY',
        cls: 'sug-whatsapp',
      };
    } else if (daysSinceLastContact > 7) {
      suggestion = {
        priority: 'medium',
        icon: '📞',
        action: 'Resume follow-up',
        detail: `Last contact was ${daysSinceLastContact} days ago. Resume follow-up with call + WhatsApp.`,
        channel: 'call',
        urgency: 'TODAY',
        cls: 'sug-urgent',
      };
    } else {
      suggestion = {
        priority: 'medium',
        icon: '📞',
        action: 'Formal reminder',
        detail: 'Account aging 180+ days. Send formal email/call reminder with outstanding invoice list.',
        channel: 'call',
        urgency: 'THIS WEEK',
        cls: 'sug-call',
      };
    }
  }
  // 8. Recent 90–179d
  else if (days >= 90) {
    if (!hasComments) {
      suggestion = {
        priority: 'low',
        icon: '📞',
        action: 'First follow-up call',
        detail: 'No previous contact logged. Make first follow-up call — be courteous, confirm receipt of invoices.',
        channel: 'call',
        urgency: 'THIS WEEK',
        cls: 'sug-call',
      };
    } else {
      suggestion = {
        priority: 'low',
        icon: '💬',
        action: 'WhatsApp reminder',
        detail: `Contact previously made. Send a polite WhatsApp reminder with payment link or bank details.`,
        channel: 'whatsapp',
        urgency: 'THIS WEEK',
        cls: 'sug-whatsapp',
      };
    }
  }
  // 9. New <90d
  else {
    if (!hasComments) {
      suggestion = {
        priority: 'low',
        icon: '📩',
        action: 'Courtesy reminder',
        detail: 'New outstanding. Send a friendly payment reminder — email or WhatsApp with invoice summary.',
        channel: 'whatsapp',
        urgency: 'NEXT WEEK',
        cls: 'sug-call',
      };
    } else {
      suggestion = {
        priority: 'low',
        icon: '✔️',
        action: 'Monitor',
        detail: 'Contact made. Monitor — follow up again if payment is not received by due date.',
        channel: 'monitor',
        urgency: 'MONITOR',
        cls: 'sug-paid',
      };
    }
  }

  // ── Build full response ──
  res.json({
    account_id:    acc.id,
    account_name:  acc.name,
    balance,
    days,
    status,
    comment_count: commentCnt,
    suggestion,
    context: {
      has_promise:    hasPromise,
      has_voicemail:  hasVoicemail,
      has_whatsapp:   hasWhatsApp,
      has_legal:      hasLegalMention,
      days_since_contact: daysSinceLastContact,
      due_reminders:  dueReminders.length,
      pending_reminders: pendingReminders.length,
    },
  });
});

// ── API: reminders ──
app.get('/api/reminders', (req, res) => {
  res.json(getAllReminders.all());
});

app.get('/api/reminders/due', (req, res) => {
  res.json(getDueReminders.all());
});

app.get('/api/accounts/:id/reminders', (req, res) => {
  res.json(getRemindersForAccount.all(req.params.id));
});

app.post('/api/accounts/:id/reminders', (req, res) => {
  const { remind_date, note } = req.body;
  if (!remind_date) return res.status(400).json({ error: 'remind_date required' });
  const acc = getAccountById.get(req.params.id);
  if (!acc) return res.status(404).json({ error: 'account not found' });
  const info = addReminder.run({
    account_id:   req.params.id,
    account_name: acc.name,
    remind_date,
    note:         note || '',
    created_by:   req.session.author,
  });
  logActivity.run({
    account_id:   req.params.id,
    account_name: acc.name,
    action:       'reminder_set',
    old_value:    '',
    new_value:    remind_date + (note ? ' — ' + note : ''),
    actor:        req.session.author,
  });
  res.json({
    id:           info.lastInsertRowid,
    account_id:   +req.params.id,
    account_name: acc.name,
    remind_date,
    note:         note || '',
    created_by:   req.session.author,
    done:         0,
    created_at:   new Date().toISOString(),
  });
});

app.patch('/api/reminders/:id/done', (req, res) => {
  markReminderDone.run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/reminders/:id', (req, res) => {
  deleteReminder.run(req.params.id);
  res.json({ ok: true });
});

// ── API: activity log ──
app.get('/api/activity', (req, res) => {
  res.json(getActivity.all());
});

// ════════════════════════════════════════════════════════════════════════════
// ── PROMISE TRACKER ROUTES ──
// ════════════════════════════════════════════════════════════════════════════

// GET all active promises (for Promises view)
app.get('/api/promises', (req, res) => {
  res.json(getAllActivePromises.all());
});

// GET broken promises (promised_date passed, still pending)
app.get('/api/promises/broken', (req, res) => {
  res.json(getBrokenPromises.all());
});

// GET promises for one account
app.get('/api/accounts/:id/promises', (req, res) => {
  res.json(getPromisesForAccount.all(req.params.id));
});

// POST set a new promise on an account
app.post('/api/accounts/:id/promises', (req, res) => {
  const { promised_amount, promised_date, note } = req.body;
  if (!promised_date) return res.status(400).json({ error: 'promised_date required' });
  const acc = getAccountById.get(req.params.id);
  if (!acc) return res.status(404).json({ error: 'account not found' });

  const info = addPromise.run({
    account_id:      req.params.id,
    account_name:    acc.name,
    promised_amount: promised_amount || 0,
    promised_date,
    note:            note || '',
    created_by:      req.session.author,
  });

  // Auto-set account status to 'promise'
  updateStatus.run({ id: req.params.id, status: 'promise', updated_by: req.session.author });

  logActivity.run({
    account_id:   req.params.id,
    account_name: acc.name,
    action:       'promise_set',
    old_value:    '',
    new_value:    `₹${promised_amount || 0} by ${promised_date}${note ? ' — ' + note : ''}`,
    actor:        req.session.author,
  });

  tg.notifyPromise(acc.name, req.session.author, promised_amount, promised_date, note);
  res.json({ id: info.lastInsertRowid, ok: true });
});

// PATCH mark promise received (paid)
app.patch('/api/promises/:id/received', (req, res) => {
  updatePromiseStatus.run({ id: req.params.id, status: 'received' });
  res.json({ ok: true });
});

// PATCH mark promise broken
app.patch('/api/promises/:id/broken', (req, res) => {
  // fetch promise details before marking broken
  const p = db.prepare('SELECT * FROM promises WHERE id=?').get(req.params.id);
  updatePromiseStatus.run({ id: req.params.id, status: 'broken' });
  if (p) tg.notifyPromiseBroken(p.account_name, p.promised_amount, p.promised_date);
  res.json({ ok: true });
});

// DELETE a promise
app.delete('/api/promises/:id', (req, res) => {
  deletePromise.run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// ── USER MANAGEMENT ROUTES (admin only) ──
// ════════════════════════════════════════════════════════════════════════════

function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// GET all users
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(getAllUsers.all());
});

// POST add a user
app.post('/api/users', requireAdmin, (req, res) => {
  const { name, pin, role } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
  if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
  try {
    const info = addUser.run({ name: name.trim(), pin: pin.trim(), role: role || 'member' });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Name already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PATCH update PIN
app.patch('/api/users/pin', (req, res) => {
  const { name, old_pin, new_pin } = req.body;
  if (!name || !old_pin || !new_pin) return res.status(400).json({ error: 'name, old_pin, new_pin required' });
  const user = getUserByName.get(name);
  if (!user || user.pin !== old_pin) return res.status(401).json({ error: 'Wrong current PIN' });
  if (new_pin.length < 4) return res.status(400).json({ error: 'New PIN must be at least 4 digits' });
  updateUserPin.run({ pin: new_pin.trim(), name: name.trim() });
  res.json({ ok: true });
});

// DELETE (deactivate) a user
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (String(req.session.author) === String(req.body?.name)) {
    return res.status(400).json({ error: "Can't deactivate yourself" });
  }
  deactivateUser.run(req.params.id);
  res.json({ ok: true });
});

// GET current user's role
app.get('/api/me', (req, res) => {
  res.json({ author: req.session.author, role: req.session.role || 'member' });
});

// ════════════════════════════════════════════════════════════════════════════
// ── ZOHO BOOKS INTEGRATION ROUTES ──
// ════════════════════════════════════════════════════════════════════════════

// GET /api/zoho/status — config + last sync info
app.get('/api/zoho/status', (req, res) => {
  const configured = zoho.isConfigured();
  const cfg        = zoho.getConfig();
  const log        = zoho.loadSyncLog();
  res.json({
    configured,
    org_id:      cfg.org_id    || null,
    org_name:    cfg.org_name  || null,
    last_sync:   log.last_sync  || null,
    last_status: log.last_status || null,
    last_count:  log.last_count  || 0,
    last_error:  log.last_error  || null,
    history:     (log.history || []).slice(0, 5),
  });
});

// POST /api/zoho/setup — save credentials and exchange grant code for tokens
app.post('/api/zoho/setup', async (req, res) => {
  const { client_id, client_secret, grant_code, org_id, org_name } = req.body;
  if (!client_id || !client_secret) {
    return res.status(400).json({ error: 'client_id and client_secret are required' });
  }

  try {
    if (grant_code) {
      // Exchange grant code for refresh token
      await zoho.setupWithGrantCode(client_id, client_secret, grant_code);
    } else {
      // Just save the credentials (refresh token will be provided separately)
      const cfg = zoho.getConfig();
      zoho.saveConfig({ ...cfg, client_id, client_secret });
    }

    // Save org if provided
    if (org_id) {
      const cfg = zoho.getConfig();
      zoho.saveConfig({ ...cfg, org_id, org_name: org_name || '' });
    }

    res.json({ ok: true, message: 'Credentials saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/zoho/setup/refresh-token — save refresh token directly
app.post('/api/zoho/setup/refresh-token', (req, res) => {
  const { client_id, client_secret, refresh_token, org_id, org_name } = req.body;
  if (!client_id || !client_secret || !refresh_token || !org_id) {
    return res.status(400).json({ error: 'client_id, client_secret, refresh_token, org_id are all required' });
  }
  const cfg = zoho.getConfig();
  zoho.saveConfig({
    ...cfg,
    client_id,
    client_secret,
    refresh_token,
    org_id,
    org_name: org_name || '',
  });
  res.json({ ok: true, message: 'Zoho Books credentials saved successfully' });
});

// GET /api/zoho/organizations — list orgs (after credentials saved)
app.get('/api/zoho/organizations', async (req, res) => {
  try {
    const orgs = await zoho.fetchOrganizations();
    res.json(orgs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/zoho/sync — manual trigger
app.post('/api/zoho/sync', async (req, res) => {
  if (!zoho.isConfigured()) {
    return res.status(400).json({ error: 'Zoho Books not configured. Complete setup first.' });
  }
  try {
    // Prevent concurrent syncs
    if (global._zohoSyncing) {
      return res.status(409).json({ error: 'Sync already in progress. Please wait.' });
    }
    global._zohoSyncing = true;
    const result = await zoho.syncFromZoho(bulkLoad, logActivity, req.session.author || 'MANUAL_SYNC');
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    global._zohoSyncing = false;
  }
});

// POST /api/zoho/disconnect — clear Zoho credentials
app.post('/api/zoho/disconnect', (req, res) => {
  try {
    const configPath = require('path').resolve('./data/zoho_config.json');
    const tokenPath  = require('path').resolve('./data/zoho_tokens.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    if (fs.existsSync(tokenPath))  fs.unlinkSync(tokenPath);
    res.json({ ok: true, message: 'Zoho Books disconnected successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Zoho OAuth callback (for server-based app flow if needed)
app.get('/zoho/callback', (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code received from Zoho.');
  // Show the grant code to admin to complete setup
  res.send(`
    <!DOCTYPE html><html><head><title>Zoho OAuth Callback</title>
    <style>body{font-family:monospace;padding:40px;background:#f8fafc}pre{background:#1e293b;color:#e2e8f0;padding:20px;border-radius:8px;word-break:break-all}</style>
    </head><body>
    <h2>✅ Zoho Authorization Code Received</h2>
    <p>Copy this code and paste it into the dashboard setup panel:</p>
    <pre>${code}</pre>
    <p style="color:#64748b">This code expires in a few minutes. Complete the setup quickly.</p>
    </body></html>
  `);
});

// ── AUTO-SYNC: every hour ──
function startZohoAutoSync() {
  const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  async function runAutoSync() {
    if (!zoho.isConfigured()) return;
    if (global._zohoSyncing) return;
    global._zohoSyncing = true;
    console.log('[Zoho Auto-Sync] Starting scheduled sync…');
    try {
      const result = await zoho.syncFromZoho(bulkLoad, logActivity, 'AUTO_SYNC');
      console.log(`[Zoho Auto-Sync] Done — ${result.count} accounts`);
    } catch (e) {
      console.error('[Zoho Auto-Sync] Error:', e.message);
    } finally {
      global._zohoSyncing = false;
    }
  }

  // Run once after 10 seconds on startup (if configured)
  setTimeout(runAutoSync, 10000);

  // Then every hour
  setInterval(runAutoSync, SYNC_INTERVAL_MS);
  console.log('[Zoho] Auto-sync scheduled every 60 minutes');
}

startZohoAutoSync();

// ── Daily Telegram Summary at 9:00 AM IST (03:30 UTC) ──
(function scheduleDailySummary() {
  function msUntilNext930UTC() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }
  setTimeout(function fire() {
    tg.sendDailySummary(db);
    setTimeout(fire, 24 * 60 * 60 * 1000); // repeat every 24h
  }, msUntilNext930UTC());
  console.log('[Telegram] Daily summary scheduled at 9:00 AM IST');
})();

// ── Start ──
app.listen(PORT, () => {
  console.log(`\n✅ vlights AR Dashboard running on port ${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   Password:  ${PWD}\n`);
});

// ── Login page HTML ──
function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>vlights AR — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;background:#f1f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(15,23,42,.12);padding:40px;width:100%;max-width:400px}
  .logo{display:flex;align-items:center;gap:12px;margin-bottom:32px}
  .logo-icon{width:40px;height:40px;background:#1e40af;border-radius:10px;display:flex;align-items:center;justify-content:center}
  .logo-text{font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-.02em}
  .logo-sub{font-size:13px;color:#64748b;margin-top:2px}
  h1{font-size:22px;font-weight:700;color:#0f172a;margin-bottom:6px}
  p{font-size:14px;color:#64748b;margin-bottom:28px}
  label{display:block;font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
  input{width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:14px;font-family:inherit;color:#0f172a;outline:none;transition:border-color .15s;margin-bottom:16px}
  input:focus{border-color:#1e40af}
  .btn{width:100%;background:#1e40af;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s;margin-top:4px}
  .btn:hover{background:#1d3a98}
  .error{background:#fee2e2;color:#dc2626;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px;border:1px solid #fca5a5}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none"><path d="M7 8L14 20L21 8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="20" r="2" fill="white"/></svg>
    </div>
    <div>
      <div class="logo-text">vlights</div>
      <div class="logo-sub">AR Followup Dashboard</div>
    </div>
  </div>
  <h1>Sign in</h1>
  <p>Enter your name and PIN to continue.</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST" action="/login" id="loginForm">
    <!-- Tab switcher -->
    <div style="display:flex;gap:8px;margin-bottom:20px;">
      <button type="button" class="tab-btn active" id="tabPin" onclick="showTab('pin')" style="flex:1;padding:8px;border-radius:8px;border:1.5px solid #1e40af;background:#1e40af;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Name + PIN</button>
      <button type="button" class="tab-btn" id="tabPwd" onclick="showTab('pwd')" style="flex:1;padding:8px;border-radius:8px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Team Password</button>
    </div>

    <!-- PIN login -->
    <div id="pinSection">
      <label>Your Name</label>
      <input type="text" name="author" id="authorInput" placeholder="e.g. Chirag" maxlength="40" autocomplete="name">
      <label>PIN</label>
      <input type="password" name="pin" id="pinInput" placeholder="4-digit PIN" maxlength="10" autocomplete="off" inputmode="numeric">
    </div>

    <!-- Legacy password login (hidden by default) -->
    <div id="pwdSection" style="display:none">
      <label>Your Name</label>
      <input type="text" name="author2" id="authorInput2" placeholder="e.g. Chirag" maxlength="40" autocomplete="name">
      <label>Team Password</label>
      <input type="password" name="password" id="pwdInput" placeholder="Team password" autocomplete="current-password">
    </div>

    <button type="submit" class="btn">Enter Dashboard →</button>
  </form>
  <script>
    function showTab(tab) {
      const pinSection = document.getElementById('pinSection');
      const pwdSection = document.getElementById('pwdSection');
      const tabPin = document.getElementById('tabPin');
      const tabPwd = document.getElementById('tabPwd');
      if (tab === 'pin') {
        pinSection.style.display = '';
        pwdSection.style.display = 'none';
        tabPin.style.background = '#1e40af'; tabPin.style.color = '#fff'; tabPin.style.borderColor = '#1e40af';
        tabPwd.style.background = '#fff'; tabPwd.style.color = '#475569'; tabPwd.style.borderColor = '#e2e8f0';
        document.getElementById('authorInput').required = true;
        document.getElementById('pinInput').required = true;
        document.getElementById('authorInput2').required = false;
        document.getElementById('pwdInput').required = false;
      } else {
        pinSection.style.display = 'none';
        pwdSection.style.display = '';
        tabPin.style.background = '#fff'; tabPin.style.color = '#475569'; tabPin.style.borderColor = '#e2e8f0';
        tabPwd.style.background = '#1e40af'; tabPwd.style.color = '#fff'; tabPwd.style.borderColor = '#1e40af';
        document.getElementById('authorInput').required = false;
        document.getElementById('pinInput').required = false;
        document.getElementById('authorInput2').required = true;
        document.getElementById('pwdInput').required = true;
      }
    }
    // Set initial required state
    document.getElementById('authorInput').required = true;
    document.getElementById('pinInput').required = true;
    // When switching to password tab, sync name
    document.getElementById('tabPwd').addEventListener('click', function() {
      document.getElementById('authorInput2').value = document.getElementById('authorInput').value;
    });
  </script>
</div>
</body>
</html>`;
}
