'use strict';
// ── Database layer — SQLite via better-sqlite3 ──
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

const dbPath = process.env.DB_PATH || './data/vlights.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY,
    customer_id   TEXT    UNIQUE,
    name          TEXT    NOT NULL,
    balance       REAL    DEFAULT 0,
    oldest_days   INTEGER DEFAULT 0,
    inv_count     INTEGER DEFAULT 1,
    aging_flag    TEXT    DEFAULT 'new',
    oldest_due    TEXT    DEFAULT '',
    status        TEXT    DEFAULT 'pending',
    updated_at    TEXT    DEFAULT (datetime('now','localtime')),
    updated_by    TEXT    DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS comments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER NOT NULL,
    author       TEXT    NOT NULL,
    text         TEXT    NOT NULL,
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER NOT NULL,
    account_name TEXT    NOT NULL,
    remind_date  TEXT    NOT NULL,
    note         TEXT    DEFAULT '',
    created_by   TEXT    NOT NULL,
    done         INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS promises (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    account_name    TEXT    NOT NULL,
    promised_amount REAL    DEFAULT 0,
    promised_date   TEXT    NOT NULL,
    note            TEXT    DEFAULT '',
    status          TEXT    DEFAULT 'pending',  -- pending | received | broken
    created_by      TEXT    NOT NULL,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    resolved_at     TEXT    DEFAULT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    pin        TEXT    NOT NULL,
    role       TEXT    DEFAULT 'member',  -- admin | member
    active     INTEGER DEFAULT 1,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS activity (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER,
    account_name TEXT,
    action       TEXT    NOT NULL,
    old_value    TEXT    DEFAULT '',
    new_value    TEXT    DEFAULT '',
    actor        TEXT    NOT NULL,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
`);

// ── Prepared statements ──
const upsertAccount = db.prepare(`
  INSERT INTO accounts (id, customer_id, name, balance, oldest_days, inv_count, aging_flag, oldest_due)
  VALUES (@id, @customer_id, @name, @balance, @oldest_days, @inv_count, @aging_flag, @oldest_due)
  ON CONFLICT(customer_id) DO UPDATE SET
    name        = excluded.name,
    balance     = excluded.balance,
    oldest_days = excluded.oldest_days,
    inv_count   = excluded.inv_count,
    aging_flag  = excluded.aging_flag,
    oldest_due  = excluded.oldest_due
`);

const getAllAccounts = db.prepare(`
  SELECT
    a.*,
    (SELECT COUNT(*) FROM comments c WHERE c.account_id = a.id) AS comment_count
  FROM accounts a
  ORDER BY a.balance DESC
`);

const getComments = db.prepare(`
  SELECT * FROM comments WHERE account_id = ? ORDER BY created_at ASC
`);

const addComment = db.prepare(`
  INSERT INTO comments (account_id, author, text) VALUES (@account_id, @author, @text)
`);

const deleteComment = db.prepare(`
  DELETE FROM comments WHERE id = @id AND account_id = @account_id
`);

const updateStatus = db.prepare(`
  UPDATE accounts
  SET status = @status, updated_at = datetime('now','localtime'), updated_by = @updated_by
  WHERE id = @id
`);

const logActivity = db.prepare(`
  INSERT INTO activity (account_id, account_name, action, old_value, new_value, actor)
  VALUES (@account_id, @account_name, @action, @old_value, @new_value, @actor)
`);

const getActivity = db.prepare(`
  SELECT * FROM activity ORDER BY created_at DESC LIMIT 200
`);

const getAccountById = db.prepare(`SELECT * FROM accounts WHERE id = ?`);

// ── Bulk load (transaction) ──
// SAFE UPSERT: updates balance/aging fields only.
// Status, comments, and activity are NEVER deleted or overwritten.
// Matches by customer_id first, falls back to name match.
const upsertSafe = db.prepare(`
  INSERT INTO accounts (customer_id, name, balance, oldest_days, inv_count, aging_flag, oldest_due)
  VALUES (@customer_id, @name, @balance, @oldest_days, @inv_count, @aging_flag, @oldest_due)
  ON CONFLICT(customer_id) DO UPDATE SET
    name        = excluded.name,
    balance     = excluded.balance,
    oldest_days = excluded.oldest_days,
    inv_count   = excluded.inv_count,
    aging_flag  = excluded.aging_flag,
    oldest_due  = excluded.oldest_due
    -- status, updated_at, updated_by intentionally NOT updated
`);

// Update by name when no customer_id — preserves status/comments
const updateByName = db.prepare(`
  UPDATE accounts SET
    balance     = @balance,
    oldest_days = CASE WHEN @oldest_days > 0 THEN @oldest_days ELSE oldest_days END,
    inv_count   = CASE WHEN @inv_count   > 0 THEN @inv_count   ELSE inv_count   END,
    aging_flag  = @aging_flag,
    oldest_due  = CASE WHEN @oldest_due != '' THEN @oldest_due ELSE oldest_due END
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(@name))
`);

const getByName = db.prepare(`SELECT id, customer_id FROM accounts WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`);

const bulkLoad = db.transaction((accounts) => {
  let count = 0;
  for (const a of accounts) {
    const cid  = (a.customer_id || a.id || '').toString().trim();
    const name = (a.name || '').trim();
    if (!name) continue;

    const payload = {
      balance:     a.balance     || 0,
      oldest_days: a.oldest_days || a.oldestDays     || 0,
      inv_count:   a.inv_count   || a.invCount        || 1,
      aging_flag:  a.aging_flag  || a.agingFlag       || computeAgingFlag(a.oldest_days || a.oldestDays || 0),
      oldest_due:  a.oldest_due  || a.oldestDueDate   || '',
    };

    if (cid) {
      // Have a customer_id — use UPSERT on UNIQUE(customer_id)
      upsertSafe.run({ customer_id: cid, name, ...payload });
    } else {
      // No customer_id — try name match first
      const existing = getByName.get(name);
      if (existing) {
        // Update existing row by name
        updateByName.run({ name, ...payload });
        // If existing row has no customer_id, leave it null
      } else {
        // Truly new account — insert with null customer_id
        upsertSafe.run({ customer_id: null, name, ...payload });
      }
    }
    count++;
  }
  return count;
});

function computeAgingFlag(days) {
  if (days >= 720) return 'very_old';
  if (days >= 360) return 'old';
  if (days >= 180) return 'aging';
  if (days >= 90)  return 'recent';
  return 'new';
}

// ── Reminder statements ──
const addReminder = db.prepare(`
  INSERT INTO reminders (account_id, account_name, remind_date, note, created_by)
  VALUES (@account_id, @account_name, @remind_date, @note, @created_by)
`);

const getRemindersForAccount = db.prepare(`
  SELECT * FROM reminders WHERE account_id = ? ORDER BY remind_date ASC
`);

const getAllReminders = db.prepare(`
  SELECT r.*, a.name as account_name, a.balance, a.aging_flag, a.oldest_days
  FROM reminders r
  JOIN accounts a ON a.id = r.account_id
  WHERE r.done = 0
  ORDER BY r.remind_date ASC
`);

const getDueReminders = db.prepare(`
  SELECT r.*, a.name as account_name, a.balance, a.aging_flag
  FROM reminders r
  JOIN accounts a ON a.id = r.account_id
  WHERE r.done = 0 AND r.remind_date <= date('now','localtime')
  ORDER BY r.remind_date ASC
`);

const markReminderDone = db.prepare(`
  UPDATE reminders SET done = 1 WHERE id = ?
`);

const deleteReminder = db.prepare(`
  DELETE FROM reminders WHERE id = ?
`);

// ── Promise statements ──
const addPromise = db.prepare(`
  INSERT INTO promises (account_id, account_name, promised_amount, promised_date, note, created_by)
  VALUES (@account_id, @account_name, @promised_amount, @promised_date, @note, @created_by)
`);

const getPromisesForAccount = db.prepare(`
  SELECT * FROM promises WHERE account_id = ? ORDER BY created_at DESC
`);

const getAllActivePromises = db.prepare(`
  SELECT p.*, a.balance, a.aging_flag, a.oldest_days
  FROM promises p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.status = 'pending'
  ORDER BY p.promised_date ASC
`);

const getBrokenPromises = db.prepare(`
  SELECT p.*, a.balance, a.aging_flag
  FROM promises p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.status = 'pending' AND p.promised_date < date('now','localtime')
  ORDER BY p.promised_date ASC
`);

const updatePromiseStatus = db.prepare(`
  UPDATE promises SET status = @status, resolved_at = datetime('now','localtime') WHERE id = @id
`);

const deletePromise = db.prepare(`
  DELETE FROM promises WHERE id = ?
`);

// ── User statements ──
const getUserByName = db.prepare(`SELECT * FROM users WHERE name = ? AND active = 1`);
const getAllUsers   = db.prepare(`SELECT id, name, role, active, created_at FROM users ORDER BY name ASC`);
const addUser       = db.prepare(`INSERT INTO users (name, pin, role) VALUES (@name, @pin, @role)`);
const updateUserPin = db.prepare(`UPDATE users SET pin = @pin WHERE name = @name`);
const deactivateUser = db.prepare(`UPDATE users SET active = 0 WHERE id = ?`);

// Seed default admin user if users table is empty
const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
if (userCount === 0) {
  // Default admin — PIN 1234 (user should change on first login)
  addUser.run({ name: 'Admin', pin: '9892', role: 'admin' });
  console.log('[DB] Default admin user created (PIN: 9892)');
}

module.exports = {
  db,
  getAllAccounts,
  getComments,
  addComment,
  deleteComment,
  updateStatus,
  logActivity,
  getActivity,
  getAccountById,
  bulkLoad,
  addReminder,
  getRemindersForAccount,
  getAllReminders,
  getDueReminders,
  markReminderDone,
  deleteReminder,
  // promises
  addPromise,
  getPromisesForAccount,
  getAllActivePromises,
  getBrokenPromises,
  updatePromiseStatus,
  deletePromise,
  // users
  getUserByName,
  getAllUsers,
  addUser,
  updateUserPin,
  deactivateUser,
  // raw db instance (for ad-hoc queries)
  db,
};

