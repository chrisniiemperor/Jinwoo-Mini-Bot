const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'dashboard-stats.json');
const API_KEY_FILE = path.join(DATA_DIR, 'api-key.json');

const empty = () => ({
  startedAt: new Date().toISOString(),
  messages: 0,
  commands: 0,
  users: {},
  groups: {},
  commandUsage: {},
  recent: [],
  aiRequests: 0,
  downloads: 0
});

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, JSON.stringify(empty(), null, 2));
}
function load() {
  ensure();
  try { return { ...empty(), ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; }
  catch { return empty(); }
}
function save(data) {
  ensure();
  const tmp = `${STATS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STATS_FILE);
}
function touch(fn) {
  const data = load();
  fn(data);
  save(data);
  return data;
}
function cleanId(v) { return String(v || '').split(':')[0]; }
function recordMessage({ sender, isGroup, groupId, groupName }) {
  touch(d => {
    d.messages++;
    const uid = cleanId(sender);
    if (uid) {
      d.users[uid] = d.users[uid] || { id: uid, messages: 0, lastSeen: null };
      d.users[uid].messages++;
      d.users[uid].lastSeen = new Date().toISOString();
    }
    if (isGroup && groupId) {
      d.groups[groupId] = d.groups[groupId] || { id: groupId, name: groupName || groupId, messages: 0, lastSeen: null };
      if (groupName) d.groups[groupId].name = groupName;
      d.groups[groupId].messages++;
      d.groups[groupId].lastSeen = new Date().toISOString();
    }
  });
}
function recordCommand({ name, sender, isGroup, groupId, groupName }) {
  touch(d => {
    d.commands++;
    d.commandUsage[name] = (d.commandUsage[name] || 0) + 1;
    d.recent.unshift({ time: new Date().toISOString(), type: 'command', command: name, sender: cleanId(sender), group: groupName || null });
    d.recent = d.recent.slice(0, 100);
    if (isGroup && groupId && d.groups[groupId]) d.groups[groupId].lastCommand = name;
  });
}
function recordAi() { touch(d => { d.aiRequests++; }); }
function recordDownload() { touch(d => { d.downloads++; }); }
function getStats() { return load(); }
function generateApiKey() {
  ensure();
  const key = `jinwoo_${crypto.randomBytes(32).toString('hex')}`;
  fs.writeFileSync(API_KEY_FILE, JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 2));
  return key;
}
function getApiKey() {
  if (process.env.BOT_API_KEY) return process.env.BOT_API_KEY;
  try { return JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf8')).key || ''; } catch { return ''; }
}
module.exports = { getStats, recordMessage, recordCommand, recordAi, recordDownload, generateApiKey, getApiKey, STATS_FILE, API_KEY_FILE };
