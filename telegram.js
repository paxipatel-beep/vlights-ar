'use strict';
// ── Telegram Notification Module ──────────────────────────────────────────
const https = require('https');

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '8666300315:AAGVUPQNmYMf9iQX_o2giKfQFcnPKxl2uCE';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID   || '5767644169';

function sendTelegram(text) {
  if (!TOKEN || !CHAT_ID) return;
  const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, res => {
    // consume response to free socket
    res.resume();
  });
  req.on('error', e => console.error('[Telegram] send error:', e.message));
  req.write(body);
  req.end();
}

// ── Notification helpers ──────────────────────────────────────────────────

function notifyComment(accountName, author, text) {
  sendTelegram(
    `💬 <b>New Comment</b>\n` +
    `👤 <b>${accountName}</b>\n` +
    `by ${author}\n` +
    `"${text}"`
  );
}

function notifyPromise(accountName, author, amount, date, note) {
  const amt = amount ? `₹${Number(amount).toLocaleString('en-IN')}` : 'amount TBD';
  sendTelegram(
    `🤝 <b>Payment Promise</b>\n` +
    `👤 <b>${accountName}</b>\n` +
    `${amt} by <b>${date}</b>\n` +
    (note ? `Note: ${note}` : '') +
    `\nRecorded by ${author}`
  );
}

function notifyPromiseBroken(accountName, promisedAmount, promisedDate) {
  const amt = promisedAmount ? `₹${Number(promisedAmount).toLocaleString('en-IN')}` : '';
  sendTelegram(
    `🚨 <b>Promise Broken</b>\n` +
    `👤 <b>${accountName}</b>\n` +
    `${amt} was due on ${promisedDate} — <b>not received</b>`
  );
}

function notifyDataImport(count, total) {
  const totalFmt = total ? `₹${Number(total).toLocaleString('en-IN')}` : '';
  sendTelegram(
    `📥 <b>AR Data Updated</b>\n` +
    `${count} accounts loaded\n` +
    (totalFmt ? `Total outstanding: <b>${totalFmt}</b>` : '')
  );
}

function sendDailySummary(db) {
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as total_accounts,
             SUM(balance) as total_outstanding,
             SUM(CASE WHEN oldest_days > 45 THEN 1 ELSE 0 END) as overdue_count,
             SUM(CASE WHEN oldest_days > 45 THEN balance ELSE 0 END) as overdue_amount
      FROM accounts WHERE balance > 0
    `).get();

    const promises = db.prepare(`
      SELECT COUNT(*) as cnt, SUM(promised_amount) as total
      FROM promises WHERE status = 'pending'
    `).get();

    const broken = db.prepare(`
      SELECT COUNT(*) as cnt FROM promises
      WHERE status = 'pending' AND promised_date < date('now')
    `).get();

    const fmt = n => n ? `₹${Number(n).toLocaleString('en-IN')}` : '₹0';
    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    sendTelegram(
      `📊 <b>Daily AR Summary — ${today}</b>\n\n` +
      `💰 Total Outstanding: <b>${fmt(row.total_outstanding)}</b>\n` +
      `📋 Active Accounts: <b>${row.total_accounts}</b>\n` +
      `⚠️ Overdue (>45d): <b>${row.overdue_count}</b> accounts — ${fmt(row.overdue_amount)}\n\n` +
      `🤝 Open Promises: <b>${promises.cnt}</b> — ${fmt(promises.total)}\n` +
      (broken.cnt > 0 ? `🚨 Broken Promises: <b>${broken.cnt}</b>` : `✅ No broken promises`)
    );
  } catch (e) {
    console.error('[Telegram] Daily summary error:', e.message);
  }
}

module.exports = { sendTelegram, notifyComment, notifyPromise, notifyPromiseBroken, notifyDataImport, sendDailySummary };
