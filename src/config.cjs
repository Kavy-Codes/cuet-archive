const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const CHILL_DIR = '/home/hypruser/chill-chillies-setup';
const API = 'https://discord.com/api/v10';

function loadEnv() {
  if (process.env.DISCORD_BOT_TOKEN) return;
  try {
    const raw = fs.readFileSync(path.join(CHILL_DIR, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {
    throw new Error('Could not load DISCORD_BOT_TOKEN: ' + e.message);
  }
}

async function api(endpoint, opts = {}) {
  loadEnv();
  const doFetch = () =>
    fetch(API + endpoint, {
      ...opts,
      headers: {
        Authorization: 'Bot ' + process.env.DISCORD_BOT_TOKEN,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await doFetch();
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const wait = (body.retry_after || 1) * 1000 + 250;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Discord API ${res.status} on ${endpoint}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
  throw new Error('Discord API rate limited too many times on ' + endpoint);
}

async function apiPaged(endpoint, key) {
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const q = after ? `${sep}after=${after}` : '';
    const batch = await api(`${endpoint}${q}`);
    const items = batch[key];
    if (!items || !items.length) break;
    out.push(...items);
    after = items[items.length - 1].id;
    if (items.length < 100) break;
  }
  return out;
}

module.exports = {
  ROOT,
  CHILL_DIR,
  API_BASE: API,
  GUILD_ID: '1540430445483917342',
  FORUM_ID: '1553291830198538340',
  FORUM_NAME: '📚︱resources',
  GUILD_NAME: 'CUET 2027',
  EXCLUDE_THREAD_IDS: ['1553773839647899798'],
  DATA_FILE: path.join(ROOT, 'data', 'resources.json'),
  SITE_DIR: path.join(ROOT, 'site'),
  ASSETS_SRC: path.join(ROOT, 'src', 'assets'),
  loadEnv,
  api,
  apiPaged,
};
