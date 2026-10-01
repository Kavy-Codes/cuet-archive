#!/usr/bin/env node
// One-off: nuke CUET 2027 — create "end", delete every other channel, delete all
// custom roles, kick every human except the two keep-list. Idempotent (re-runnable).

const cfg = require('./config.cjs');

const GUILD = cfg.GUILD_ID;
const KEEP_CHANNEL = 'end';
const KEEP_USERS = new Set(['1383430498696691834']); // dyettcoke
const KEEP_USER_NAMES = new Set(['krush91']); // resolved from member usernames
const KEEP_MANAGED_ROLES = true; // never touch integration roles

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function del(path) {
  try {
    return await cfg.api(path, { method: 'DELETE' });
  } catch (e) {
    return { __err: e.message };
  }
}

async function main() {
  const me = await cfg.api('/users/@me');
  console.log(`Acting as ${me.username}\n`);

  // ---- resolve krush91 id ----
  let members = await cfg.api(`/guilds/${GUILD}/members?limit=1000`);
  for (const m of members) {
    const u = m.user;
    if (KEEP_USER_NAMES.has(u.username) || KEEP_USER_NAMES.has((u.global_name || '').toLowerCase())) {
      KEEP_USERS.add(u.id);
      console.log(`keep user resolved: ${u.username} -> ${u.id}`);
    }
  }
  console.log(`keep list: ${[...KEEP_USERS].join(', ')}\n`);

  // ---- create "end" first ----
  let chans = await cfg.api(`/guilds/${GUILD}/channels`);
  let end = chans.find((c) => c.name === KEEP_CHANNEL && c.type === 0);
  if (!end) {
    end = await cfg.api(`/guilds/${GUILD}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: KEEP_CHANNEL, type: 0 }),
    });
    console.log(`created #${KEEP_CHANNEL} (${end.id})`);
  } else {
    console.log(`#${KEEP_CHANNEL} already exists (${end.id})`);
  }

  // ---- pass 1: delete channels (children before categories) ----
  const targets = chans.filter((c) => c.id !== end.id);
  targets.sort((a, b) => (a.type === 4 ? 1 : 0) - (b.type === 4 ? 1 : 0));
  console.log(`\nDeleting ${targets.length} channels…`);
  let chDel = 0, chFail = [];
  for (const c of targets) {
    const r = await del(`/channels/${c.id}`);
    if (r && r.__err) chFail.push(`${c.name}: ${r.__err.slice(0, 80)}`);
    else chDel++;
    await sleep(120);
  }
  console.log(`  deleted ${chDel}/${targets.length}${chFail.length ? ', failed: ' + chFail.join(' | ') : ''}`);

  // ---- delete custom roles ----
  let roles = await cfg.api(`/guilds/${GUILD}/roles`);
  const roleTargets = roles.filter((r) => !r.managed && r.name !== '@everyone');
  console.log(`\nDeleting ${roleTargets.length} custom roles…`);
  let rDel = 0, rFail = [];
  for (const r of roleTargets) {
    const res = await del(`/guilds/${GUILD}/roles/${r.id}`);
    if (res && res.__err) rFail.push(r.name);
    else rDel++;
    await sleep(120);
  }
  console.log(`  deleted ${rDel}/${roleTargets.length}${rFail.length ? ', blocked: ' + rFail.join(', ') : ''}`);

  // ---- kicks ----
  members = await cfg.api(`/guilds/${GUILD}/members?limit=1000`);
  roles = await cfg.api(`/guilds/${GUILD}/roles`);
  const pos = new Map(roles.map((r) => [r.id, r.position]));
  const botPos = Math.max(...roles.filter((r) => r.name === 'Chill Chillies Bot').map((r) => r.position), -1);
  const humans = members.filter((m) => !m.user.bot);
  const kickables = [], blocked = [], kept = [];
  for (const m of humans) {
    if (KEEP_USERS.has(m.user.id)) { kept.push(m.user.username); continue; }
    const top = m.roles.reduce((hi, id) => Math.max(hi, pos.get(id) ?? 0), 0);
    if (top >= botPos && m.user.id !== '1383430498696691834') blocked.push(`${m.user.username} (top role pos ${top})`);
    else kickables.push(m);
  }
  console.log(`\nKicking ${kickables.length} humans (kept: ${kept.join(', ')}${blocked.length ? '; blocked by hierarchy: ' + blocked.length : ''})…`);
  let kDel = 0, kFail = [];
  for (const m of kickables) {
    const res = await del(`/guilds/${GUILD}/members/${m.user.id}`);
    if (res && res.__err) kFail.push(`${m.user.username}: ${res.__err.slice(0, 60)}`);
    else kDel++;
    await sleep(150);
  }
  console.log(`  kicked ${kDel}/${kickables.length}${kFail.length ? ', failed: ' + kFail.map((f) => f.split(':')[0]).join(', ') : ''}`);

  // ---- pass 2: race sweep ----
  chans = await cfg.api(`/guilds/${GUILD}/channels`);
  const leftovers = chans.filter((c) => c.id !== end.id);
  if (leftovers.length) {
    console.log(`\nSweep: ${leftovers.length} channels appeared mid-run, deleting…`);
    for (const c of leftovers) { await del(`/channels/${c.id}`); await sleep(120); }
  }
  roles = await cfg.api(`/guilds/${GUILD}/roles`);
  const roleLeft = roles.filter((r) => !r.managed && r.name !== '@everyone');
  for (const r of roleLeft) { await del(`/guilds/${GUILD}/roles/${r.id}`); await sleep(120); }

  // ---- verify ----
  const fChans = await cfg.api(`/guilds/${GUILD}/channels`);
  const fRoles = await cfg.api(`/guilds/${GUILD}/roles`);
  const fMembers = await cfg.api(`/guilds/${GUILD}/members?limit=1000`);
  const threads = await cfg.api(`/guilds/${GUILD}/threads/active`);
  const fHumans = fMembers.filter((m) => !m.user.bot);
  const blockedNow = [];
  for (const m of fHumans) {
    const top = m.roles.reduce((hi, id) => Math.max(hi, pos.get(id) ?? 0), 0);
    if (top >= botPos && !KEEP_USERS.has(m.user.id)) blockedNow.push(m.user.username);
  }
  const fManaged = fRoles.filter((r) => r.managed).map((r) => r.name);

  console.log('\n--- final verification ---');
  console.log(`  channels:   ${fChans.length} ${fChans.map((c) => '#' + c.name).join(', ')}`);
  console.log(`  threads:    ${(threads.threads || []).length}`);
  console.log(`  roles:      ${fRoles.length} (${fRoles.filter((r) => !r.managed && r.name !== '@everyone').length} custom left) -> ${fRoles.map((r) => r.name).join(', ')}`);
  console.log(`  humans:     ${fHumans.map((m) => m.user.username).join(', ')}`);
  console.log(`  bots kept:  ${fMembers.filter((m) => m.user.bot).length} in-server, managed roles: ${fManaged.join(', ')}`);

  const ok = fChans.length === 1 && fChans[0].id === end.id &&
    fRoles.filter((r) => !r.managed && r.name !== '@everyone').length === 0 &&
    (threads.threads || []).length === 0;
  if (blockedNow.length) console.log(`\nMANUAL: kick these (wearing roles above the bot): ${blockedNow.join(', ')}`);
  if (rFail.length) console.log(`MANUAL: delete roles: ${rFail.join(', ')} (drag Chill Chillies Bot above them, then rerun)`);
  console.log(ok && !blockedNow.length ? '\nNUKE COMPLETE' : '\nPARTIAL — fix + rerun');
  process.exit(ok && !blockedNow.length ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
