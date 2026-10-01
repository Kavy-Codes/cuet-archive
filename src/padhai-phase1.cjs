const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');

const G = '1551614250508746814';
const DRY = process.argv.includes('--dry-run');
const REPORT = path.join(cfg.ROOT, 'data', 'padhai-phase1-report.json');
const REASON = { 'X-Audit-Log-Reason': 'Padhai Phase1 perms hardening' };

const VIEW = 1024n, SEND = 2048n, EMBED = 16384n, ATTACH = 32768n, HISTORY = 65536n;
const PUBLIC_ALLOW = (VIEW | SEND | EMBED | ATTACH | HISTORY).toString();
const LOCK_DENY = (VIEW | SEND).toString();
const READONLY_ALLOW = (VIEW | HISTORY).toString();
const SEND_DENY = SEND.toString();
const STAFF_SEND = (SEND | EMBED | ATTACH).toString();

const ROLE_ORDER = [
  'admin', 'moderator', 'developer', 'vc ping', 'game ping',
  'he', 'she', 'they', 'class 12', 'full dropper', 'partial dropper',
  'bcom', 'bba/bms', 'bsc', 'eco hons', 'english hons', 'other ba',
  'english', 'physics', 'chemistry', 'biology', 'accountancy', 'bst',
  'economics', 'maths', 'history', 'geography', 'political science',
  'psychology', 'sociology', 'legal studies', 'ip/cs',
  'physical education', 'gat', 'bots',
];

const CAT_TARGETS = {
  'community': { allow: '1024', deny: '0' },
  'study': { allow: '1024', deny: '0' },
  'interests': { allow: '1024', deny: '0' },
  'welcome': { allow: '1024', deny: '0' },
  'staff only': { allow: '0', deny: '1024' },
};

const AUTOMOD_RULES = [
  {
    name: 'Block Invite Links',
    trigger_type: 1,
    trigger_metadata: { regex_patterns: ['discord\\.gg/', 'discord(?:app)?\\.com/invite/'] },
    custom: 'Invite links are not allowed here.',
  },
  {
    name: 'Mention Spam Limit',
    trigger_type: 5,
    trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true },
    custom: 'Too many mentions in one message.',
  },
  {
    name: 'Anti Spam',
    trigger_type: 3,
    trigger_metadata: {},
    custom: 'Slow down with the spam.',
  },
  {
    name: 'Scam Phrases',
    trigger_type: 1,
    trigger_metadata: { keyword_filter: ['free nitro', '*steam gift*', '*airdrop*', '*crypto giveaway*'] },
    custom: 'That looks like a scam message.',
  },
];

function eq(a, b) { return BigInt(a || 0) === BigInt(b || 0); }

async function snapshot() {
  const [roles, channels, guild] = await Promise.all([
    cfg.api(`/guilds/${G}/roles`),
    cfg.api(`/guilds/${G}/channels`),
    cfg.api(`/guilds/${G}`),
  ]);
  let automod = [];
  try { automod = await cfg.api(`/guilds/${G}/auto-moderation/rules`); } catch (e) { automod = [{ error: e.message }]; }
  return {
    roles: roles.map(r => ({ id: r.id, name: r.name, position: r.position, permissions: r.permissions, managed: r.managed })),
    channels: channels.filter(c => c.type === 0 || c.type === 4 || c.type === 15)
      .map(c => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id, overwrites: (c.permission_overwrites || []).map(o => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })) })),
    guild: {
      verification_level: guild.verification_level,
      explicit_content_filter: guild.explicit_content_filter,
      rules_channel_id: guild.rules_channel_id,
      system_channel_id: guild.system_channel_id,
      mfa_level: guild.mfa_level,
      afk_channel_id: guild.afk_channel_id,
    },
    automod: automod.map(r => ({ id: r.id, name: r.name, enabled: r.enabled, trigger_type: r.trigger_type })),
  };
}

function findRole(roles, name) { return roles.find(r => r.name === name); }
function findChannel(chans, frag, type) {
  return chans.find(c => c.type === type && c.name.includes(frag));
}
function ow(channel, targetId) {
  return (channel.overwrites || []).find(o => o.id === targetId);
}

async function main() {
  console.log(DRY ? '=== PADHAI PHASE 1 — DRY RUN ===' : '=== PADHAI PHASE 1 — APPLY ===');
  const before = await snapshot();
  const actions = [];
  const failures = [];

  const roleByName = {};
  for (const r of before.roles) roleByName[r.name] = r;
  const chanByName = {};
  for (const c of before.channels) chanByName[c.name] = c;

  const staffChan = ['╭──-✦-staff-chat', '│-✦-mod-logs'].map(n => chanByName[n]);
  const reportsChan = chanByName['╰──-✦-reports'];
  const secChan = chanByName['╰──-✦-🔒-security-alerts'];
  const startHere = chanByName['╭──-✦-start-here'];
  const intros = chanByName['╰──-✦-introductions'];
  const adminRole = roleByName['admin'], modRole = roleByName['moderator'], devRole = roleByName['developer'];
  const sheRole = roleByName['she'];

  const required = { staffChan, reportsChan, secChan, startHere, intros, adminRole, modRole, devRole, sheRole };
  for (const [k, v] of Object.entries(required)) {
    if (!v || (Array.isArray(v) && v.some(x => !x))) { console.error('MISSING:', k); process.exit(2); }
  }
  const staffRoles = [adminRole, modRole, devRole];

  // ---- Step 1: role positions ----
  const customsNow = ROLE_ORDER.map(n => roleByName[n]).filter(Boolean);
  const orderOkNow = customsNow.length === ROLE_ORDER.length &&
    customsNow.every((r, i) => i === 0 || customsNow[i - 1].position > r.position);
  const posPayload = [];
  if (orderOkNow) {
    actions.push({ step: 'role-positions', detail: 'relative order already correct' });
  } else ROLE_ORDER.forEach((name, i) => {
    const r = roleByName[name];
    if (!r) { failures.push(`role not found: ${name}`); return; }
    const target = 35 - i;
    if (r.position !== target) posPayload.push({ id: r.id, position: target, _name: name, _from: r.position });
  });
  if (posPayload.length) {
    actions.push({ step: 'role-positions', detail: posPayload.map(p => `${p._name}:${p._from}->${p.position}`).join(', ') });
    if (!DRY) {
      try {
        const res = await cfg.api(`/guilds/${G}/roles`, { method: 'PATCH', body: JSON.stringify(posPayload.map(p => ({ id: p.id, position: p.position }))), headers: REASON });
        for (const p of posPayload) {
          const after = res.find(x => x.id === p.id);
          if (!after || after.position !== p.position) failures.push(`position ${p._name}: wanted ${p.position} got ${after ? after.position : 'missing'}`);
        }
      } catch (e) { failures.push('role-positions: ' + e.message); }
    }
  } else actions.push({ step: 'role-positions', detail: 'already correct' });

  // ---- Step 2: she role perms -> 0 ----
  if (BigInt(sheRole.permissions) !== 0n) {
    actions.push({ step: 'she-perms', detail: `${sheRole.permissions} -> 0` });
    if (!DRY) {
      try { await cfg.api(`/guilds/${G}/roles/${sheRole.id}`, { method: 'PATCH', body: JSON.stringify({ permissions: '0' }), headers: REASON }); }
      catch (e) { failures.push('she-perms: ' + e.message); }
    }
  } else actions.push({ step: 'she-perms', detail: 'already 0' });

  // ---- Step 3: channel overwrites ----
  const owPlans = [];
  for (const ch of staffChan) {
    owPlans.push({ ch, target: G, allow: '0', deny: LOCK_DENY, label: `${ch.name} @everyone lock` });
    for (const r of staffRoles) owPlans.push({ ch, target: r.id, allow: PUBLIC_ALLOW, deny: '0', label: `${ch.name} ${r.name}` });
  }
  owPlans.push({ ch: reportsChan, target: G, allow: PUBLIC_ALLOW, deny: '0', label: 'reports @everyone public' });
  owPlans.push({ ch: secChan, target: G, allow: READONLY_ALLOW, deny: SEND_DENY, label: 'security-alerts @everyone read-only' });
  for (const r of staffRoles) owPlans.push({ ch: secChan, target: r.id, allow: STAFF_SEND, deny: '0', label: `security-alerts ${r.name} send` });

  for (const p of owPlans) {
    const cur = ow(p.ch, p.target);
    if (cur && eq(cur.allow, p.allow) && eq(cur.deny, p.deny)) continue;
    actions.push({ step: 'overwrite', detail: `${p.label} cur=${cur ? `a=${cur.allow} d=${cur.deny}` : 'none'} -> a=${p.allow} d=${p.deny}` });
    if (!DRY) {
      try {
        await cfg.api(`/channels/${p.ch.id}/permissions/${p.target}`, {
          method: 'PUT',
          body: JSON.stringify({ type: 0, allow: p.allow, deny: p.deny }),
          headers: REASON,
        });
      } catch (e) { failures.push(`overwrite ${p.label}: ${e.message}`); }
    }
  }

  // ---- Step 4: category normalization ----
  for (const [frag, target] of Object.entries(CAT_TARGETS)) {
    const cat = findChannel(before.channels, frag, 4);
    if (!cat) { failures.push(`category not found: ${frag}`); continue; }
    const cur = ow(cat, G);
    if (cur && eq(cur.allow, target.allow) && eq(cur.deny, target.deny)) continue;
    actions.push({ step: 'category', detail: `${cat.name} cur=${cur ? `a=${cur.allow} d=${cur.deny}` : 'none'} -> a=${target.allow} d=${target.deny}` });
    if (!DRY) {
      try {
        await cfg.api(`/channels/${cat.id}/permissions/${G}`, {
          method: 'PUT',
          body: JSON.stringify({ type: 0, allow: target.allow, deny: target.deny }),
          headers: REASON,
        });
      } catch (e) { failures.push(`category ${frag}: ${e.message}`); }
    }
  }

  // ---- Step 5: guild settings ----
  const gPatch = {};
  const beforeG = before.guild;
  if (beforeG.verification_level !== 2) gPatch.verification_level = 2;
  if (beforeG.explicit_content_filter !== 1) gPatch.explicit_content_filter = 1;
  if (beforeG.rules_channel_id !== startHere.id) gPatch.rules_channel_id = startHere.id;
  if (beforeG.system_channel_id !== intros.id) gPatch.system_channel_id = intros.id;
  if (Object.keys(gPatch).length) {
    actions.push({ step: 'guild-settings', detail: JSON.stringify(gPatch) });
    if (!DRY) {
      try { await cfg.api(`/guilds/${G}`, { method: 'PATCH', body: JSON.stringify(gPatch), headers: REASON }); }
      catch (e) { failures.push('guild-settings: ' + e.message); }
    }
  } else actions.push({ step: 'guild-settings', detail: 'already correct' });

  // ---- Step 6: automod ----
  const existingNames = new Set(before.automod.map(r => (r.name || '').toLowerCase()));
  const exemptRoles = staffRoles.map(r => r.id);
  for (const rule of AUTOMOD_RULES) {
    if (existingNames.has(rule.name.toLowerCase())) {
      actions.push({ step: 'automod', detail: `exists: ${rule.name}` });
      continue;
    }
    actions.push({ step: 'automod', detail: `create: ${rule.name}` });
    if (!DRY) {
      try {
        const body = {
          name: rule.name,
          event_type: 1,
          trigger_type: rule.trigger_type,
          actions: [
            { type: 1, metadata: { custom_message: rule.custom } },
            { type: 2, metadata: { channel_id: secChan.id } },
          ],
          enabled: true,
          exempt_roles: exemptRoles,
          exempt_channels: [secChan.id],
        };
        if (rule.trigger_metadata && Object.keys(rule.trigger_metadata).length) body.trigger_metadata = rule.trigger_metadata;
        await cfg.api(`/guilds/${G}/auto-moderation/rules`, { method: 'POST', body: JSON.stringify(body), headers: REASON });
      } catch (e) { failures.push(`automod ${rule.name}: ${e.message}`); }
    }
  }

  console.log('\n--- planned/applied actions ---');
  for (const a of actions) console.log(`[${a.step}] ${a.detail}`);
  if (DRY) { console.log('\nDRY RUN — no changes made.'); return; }
  if (failures.length) { console.log('\n--- failures ---'); failures.forEach(f => console.log('FAIL:', f)); }

  // ---- Step 7: verify ----
  console.log('\n--- verification ---');
  const after = await snapshot();
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

  let posOk = true, posDetail = [];
  const customsAfter = ROLE_ORDER.map(n => after.roles.find(x => x.name === n));
  for (let i = 0; i < customsAfter.length; i++) {
    if (!customsAfter[i]) { posOk = false; posDetail.push(`missing ${ROLE_ORDER[i]}`); continue; }
    if (i > 0 && customsAfter[i - 1] && !(customsAfter[i - 1].position > customsAfter[i].position)) {
      posOk = false; posDetail.push(`${ROLE_ORDER[i - 1]}(${customsAfter[i - 1].position}) !> ${ROLE_ORDER[i]}(${customsAfter[i].position})`);
    }
  }
  check('role-order-strictly-descending', posOk, posDetail.join('; '));
  const cc = after.roles.find(r => r.name === 'Chill Chillies Bot');
  const adm = after.roles.find(r => r.name === 'admin');
  check('bot-above-admin', cc && adm && cc.position > adm.position, `cc=${cc && cc.position} admin=${adm && adm.position}`);

  const sheAfter = after.roles.find(r => r.name === 'she');
  check('she-perms-zero', sheAfter && sheAfter.permissions === '0', sheAfter && sheAfter.permissions);

  const afterCh = {};
  for (const c of after.channels) afterCh[c.name] = c;
  for (const name of ['╭──-✦-staff-chat', '│-✦-mod-logs']) {
    const ch = afterCh[name];
    const e = ow(ch, G);
    check(`lock-${name}`, e && eq(e.deny, LOCK_DENY) && eq(e.allow, '0'), e ? `a=${e.allow} d=${e.deny}` : 'no overwrite');
    for (const rn of ['admin', 'moderator', 'developer']) {
      const rr = after.roles.find(x => x.name === rn);
      const o = ow(ch, rr.id);
      check(`access-${name}-${rn}`, o && eq(o.allow, PUBLIC_ALLOW), o ? `a=${o.allow}` : 'missing');
    }
  }
  const rep = ow(afterCh['╰──-✦-reports'], G);
  check('reports-public', rep && eq(rep.allow, PUBLIC_ALLOW) && eq(rep.deny, '0'), rep ? `a=${rep.allow} d=${rep.deny}` : 'missing');
  const sec = ow(afterCh['╰──-✦-🔒-security-alerts'], G);
  check('security-alerts-readonly', sec && eq(sec.allow, READONLY_ALLOW) && eq(sec.deny, SEND_DENY), sec ? `a=${sec.allow} d=${sec.deny}` : 'missing');

  for (const [frag, target] of Object.entries(CAT_TARGETS)) {
    const cat = after.channels.find(c => c.type === 4 && c.name.includes(frag));
    const o = cat && ow(cat, G);
    check(`category-${frag}`, o && eq(o.allow, target.allow) && eq(o.deny, target.deny), o ? `a=${o.allow} d=${o.deny}` : 'missing');
  }

  const ag = after.guild;
  check('verification-level-2', ag.verification_level === 2, String(ag.verification_level));
  check('content-filter-1', ag.explicit_content_filter === 1, String(ag.explicit_content_filter));
  check('rules-channel', ag.rules_channel_id === startHere.id, String(ag.rules_channel_id));
  check('system-channel', ag.system_channel_id === intros.id, String(ag.system_channel_id));

  const amNames = new Set(after.automod.map(r => (r.name || '').toLowerCase()));
  let amOk = true; const amMissing = [];
  for (const rule of AUTOMOD_RULES) if (!amNames.has(rule.name.toLowerCase())) { amOk = false; amMissing.push(rule.name); }
  check('automod-4-rules', amOk, amMissing.length ? 'missing: ' + amMissing.join(', ') : after.automod.filter(r=>r.enabled!==false).map(r=>r.name).join(', '));

  const report = { when: new Date().toISOString(), dry: false, actions, failures, checks, before, after };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`\nreport -> ${REPORT}`);
  const failed = checks.filter(c => !c.ok).length + failures.length;
  console.log(failed === 0 ? '\nALL GREEN ✓' : `\n${failed} problem(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
