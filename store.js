// Simple JSON-file-backed store. Fine for an MVP at low traffic;
// swap for a real database (Postgres, etc.) before scaling past a
// few hundred concurrent users, since writes are not concurrency-safe.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) return { users: {} };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: {} };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getOrCreateUser(anonId) {
  const data = load();
  if (!data.users[anonId]) {
    data.users[anonId] = {
      anonId,
      usageCount: 0,
      isPaid: false,
      stripeCustomerId: null,
      createdAt: new Date().toISOString(),
    };
    save(data);
  }
  return data.users[anonId];
}

function incrementUsage(anonId) {
  const data = load();
  if (!data.users[anonId]) return;
  data.users[anonId].usageCount += 1;
  save(data);
}

function setPaid(anonId, stripeCustomerId) {
  const data = load();
  if (!data.users[anonId]) {
    data.users[anonId] = {
      anonId,
      usageCount: 0,
      isPaid: false,
      stripeCustomerId: null,
      createdAt: new Date().toISOString(),
    };
  }
  data.users[anonId].isPaid = true;
  data.users[anonId].stripeCustomerId = stripeCustomerId;
  save(data);
}

function unsetPaidByCustomerId(stripeCustomerId) {
  const data = load();
  for (const user of Object.values(data.users)) {
    if (user.stripeCustomerId === stripeCustomerId) {
      user.isPaid = false;
    }
  }
  save(data);
}

module.exports = { getOrCreateUser, incrementUsage, setPaid, unsetPaidByCustomerId };
