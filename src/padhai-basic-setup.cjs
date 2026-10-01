const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');

const G = '1551614250508746814';
const DRY = process.argv.includes('--dry-run');
const REPORT = path.join(cfg.ROOT, 'data', 'padhai-basic-report.json');
const PANELS_FILE = path.join(cfg.ROOT, 'data', 'padhai-role-panels.json');
const REASON = { 'X-Audit-Log-Reason': 'Padhai basic setup' };

const WELCOME = '1551614251951587409';
const COMMUNITY = '1551614251951587418';

const VIEW = 1024n, SEND = 2048n, EMBED = 16384n, ATTACH = 32768n, HISTORY = 65536n, ADDREACT = 64n;
const READ_ONLY = (VIEW | HISTORY).toString();
const PANEL_VIEW = (VIEW | HISTORY | ADDREACT).toString();
const STAFF_SEND = (SEND | EMBED | ATTACH).toString();
const DENY_SEND = SEND.toString();

const GUILD_DESC = 'Class 12 & university aspirants — notes, mocks, resources & study partners \ud83d\udcda';

const NEW_CHANNELS = [
  {
    key: 'rules', name: '│-✦-📜-rules', type: 0, parent: WELCOME,
    overwrites: 'readonly-staff',
  },
  {
    key: 'announcements', name: '│-✦-📢-announcements', type: 0, parent: COMMUNITY,
    overwrites: 'readonly-staff',
  },
  {
    key: 'roles', name: '│-✦-🎭-roles', type: 0, parent: WELCOME,
    overwrites: 'panel-staff',
  },
];

const RULES = [
  '**1 \u2022 Respect comes first** \u2014 no harassment, slurs, hate speech, racism, sexism, or personal attacks. Roasting friends is not bullying.',
  '**2 \u2022 Keep it civil** \u2014 disagreements are fine, drama is not. If a debate heats up, take it to DMs.',
  '**3 \u2022 Stay on topic** \u2014 study talk in study channels, fun in the interests channels. Use threads for long questions.',
  '**4 \u2022 No spam** \u2014 no flooding, no mass pings (`@everyone` / `@here` are auto-blocked), no command spam outside bot channels.',
  '**5 \u2022 Absolutely no NSFW** \u2014 porn, gore, or shock content is an instant ban.',
  '**6 \u2022 No scams or raid links** \u2014 fake nitro / phishing links and outside server invites are auto-blocked. Do not try to dodge the filter.',
  '**7 \u2022 No unsolicited promotion** \u2014 no ads, DM spam, or channel/media self-promo without staff permission.',
  '**8 \u2022 Share smart** \u2014 your own notes and resources are what this server is for. Do not resell or mass-dump paid courses/books.',
  '**9 \u2022 Talk however you like** \u2014 English is best for study help; Hindi, Hinglish and regional languages are welcome for casual chat.',
  '**10 \u2022 Staff decisions are final in the moment** \u2014 warn \u2192 timeout \u2192 ban at staff discretion. Appeals and reports go in <REPORTS_CHANNEL>.',
  '',
  'Report rule-breakers in <REPORTS_CHANNEL> (everyone can post there). Be kind, help each other pass. \ud83c\udf1f',
].join('\n');

const E = (o) => o; // readability

const startMessages = (ids) => [
  {
    key: 'rules', channelKey: 'rules', pin: true,
    embed: E({
      color: 0xe74c3c,
      title: '\ud83d\udcdc Padhai Khana \u2014 Server Rules',
      description: RULES.replace('<REPORTS_CHANNEL>', `<#${ids.reports}>`),
      footer: { text: 'Padhai Khana \u2022 v1.0 \u2022 Last updated: 1 Oct 2026' },
    }),
  },
  {
    key: 'start-here', channelKey: 'start-here', pin: false,
    embed: E({
      color: 0xee96ba,
      title: '\ud83d\udc4b Start here',
      description: [
        'Welcome to **Padhai Khana** \u2014 get set up in 30 seconds:',
        '',
        `\ud83d\udcdc **Read the rules** \u2192 <#${ids.rules}>`,
        `\ud83c\udfad **Claim your roles** \u2192 <#${ids.roles}>`,
        `\ud83d\udce2 **Follow announcements** \u2192 <#${ids.announcements}>`,
        `\ud83e\udd1b **Introduce yourself** \u2192 <#${ids.introductions}>`,
        `\ud83d\udcac **Just chat** \u2192 <#${ids.general}>`,
        `\u2753 **Stuck on a question?** \u2192 <#${ids.studyHelp}> (ask in a thread!)`,
        '',
        `\ud83d\udee1\ufe0f New account? You can chat once your account is **10+ minutes old** (verification: Medium).`,
      ].join('\n'),
      footer: { text: 'Padhai Khana \u2022 tap a channel name to jump' },
    }),
  },
  {
    key: 'roles-intro', channelKey: 'roles', pin: false,
    embed: E({
      color: 0x8e44ad,
      title: '\ud83c\udfad Pick your roles',
      description: [
        'React on the panels below to grab roles \u2014 **click a reaction again to remove it**.',
        '',
        `\ud83c\udf93 **Course / Batch** \u2014 where you are right now *(\u200bpick all that apply)*`,
        `\ud83d\udcda **Subjects** \u2014 what you are preparing *(\u200bpick all)*`,
        `\ud83e\udded **Pronouns** \u2014 how to refer to you *(\u200bpick one)*`,
        `\ud83c\udf92 **Dropper status** \u2014 gap-year status *(\u200bpick one)*`,
        `\ud83d\udd14 **Pings** \u2014 VC & game pings *(opt in!)*`,
        '',
        'Roles unlock the right channels and help everyone find their people. Scroll down and start clicking \ud83d\udc47',
      ].join('\n'),
      footer: { text: 'Padhai Khana \u2022 roles apply instantly' },
    }),
  },
  {
    key: 'course', channelKey: 'roles', pin: false,
    pairs: [
      ['\ud83c\udfaf', 'class 12'], ['\ud83d\udcd4', 'bcom'], ['\ud83d\udcbc', 'bba/bms'],
      ['\ud83d\udd2c', 'bsc'], ['\ud83d\udcd7', 'eco hons'], ['\ud83d\udcd8', 'english hons'],
      ['\ud83d\udcd9', 'other ba'],
    ],
    embed: E({
      color: 0x3498db,
      title: '\ud83c\udf93 Course / Batch',
      description: [
        'Your current stage \u2014 react to claim, click again to remove:',
        '',
        '\ud83c\udfaf `class 12`',
        '\ud83d\udcd4 `bcom`',
        '\ud83d\udcbc `bba/bms`',
        '\ud83d\udd2c `bsc`',
        '\ud83d\udcd7 `eco hons`',
        '\ud83d\udcd8 `english hons`',
        '\ud83d\udcd9 `other ba`',
      ].join('\n'),
      footer: { text: 'Multi-select \u2022 pick every label that fits you' },
    }),
  },
  {
    key: 'subjects', channelKey: 'roles', pin: false,
    pairs: [
      ['\ud83d\udcd6', 'english'], ['\u269b\ufe0f', 'physics'], ['\ud83e\uddea', 'chemistry'],
      ['\ud83e\uddec', 'biology'], ['\ud83d\udcca', 'accountancy'], ['\ud83d\udcc8', 'bst'],
      ['\ud83d\udcb0', 'economics'], ['\u2795', 'maths'], ['\ud83c\udfdb\ufe0f', 'history'],
      ['\ud83c\udf0d', 'geography'], ['\ud83d\uddf3\ufe0f', 'political science'], ['\ud83e\udde0', 'psychology'],
      ['\ud83d\udc65', 'sociology'], ['\u2696\ufe0f', 'legal studies'], ['\ud83d\udcbb', 'ip/cs'],
      ['\ud83c\udfc3', 'physical education'], ['\ud83c\udfaf', 'gat'],
    ],
    embed: E({
      color: 0x27ae60,
      title: '\ud83d\udcda Subjects',
      description: [
        'Your subjects \u2014 pick all you are preparing:',
        '',
        '\ud83d\udcd6 `english`',
        '\u269b\ufe0f `physics`',
        '\ud83e\uddea `chemistry`',
        '\ud83e\uddec `biology`',
        '\ud83d\udcca `accountancy`',
        '\ud83d\udcc8 `bst`',
        '\ud83d\udcb0 `economics`',
        '\u2795 `maths`',
        '\ud83c\udfdb\ufe0f `history`',
        '\ud83c\udf0d `geography`',
        '\ud83d\uddf3\ufe0f `political science`',
        '\ud83e\udde0 `psychology`',
        '\ud83d\udc65 `sociology`',
        '\u2696\ufe0f `legal studies`',
        '\ud83d\udcbb `ip/cs`',
        '\ud83c\udfc3 `physical education`',
        '\ud83c\udfaf `gat`',
      ].join('\n'),
      footer: { text: 'Multi-select \u2022 pick all your subjects' },
    }),
  },
  {
    key: 'pronouns', channelKey: 'roles', pin: false, unique: true,
    pairs: [
      ['\u2642\uFE0F', 'he'], ['\u2640\uFE0F', 'she'], ['\u26A7\uFE0F', 'they'],
    ],
    embed: E({
      color: 0xe91e63,
      title: '\ud83e\udded Pronouns',
      description: [
        'How should we refer to you? **Pick one** \u2014 react again to remove:',
        '',
        '\u2642\uFE0F `he`',
        '\u2640\uFE0F `she`',
        '\u26A7\uFE0F `they`',
      ].join('\n'),
      footer: { text: 'Unique \u2022 pick only one' },
    }),
  },
  {
    key: 'dropper', channelKey: 'roles', pin: false, unique: true,
    pairs: [
      ['\ud83d\udd34', 'full dropper'], ['\ud83d\udfe1', 'partial dropper'],
    ],
    embed: E({
      color: 0xf39c12,
      title: '\ud83c\udf92 Dropper status',
      description: [
        'Taking a gap year? **Pick one** \u2014 react again to remove:',
        '',
        '\ud83d\udd34 `full dropper`',
        '\ud83d\udfe1 `partial dropper`',
      ].join('\n'),
      footer: { text: 'Unique \u2022 pick only one' },
    }),
  },
  {
    key: 'pings', channelKey: 'roles', pin: false,
    pairs: [
      ['\ud83d\udd0a', 'vc ping'], ['\ud83c\udfae', 'game ping'],
    ],
    embed: E({
      color: 0x9b59b6,
      title: '\ud83d\udd14 Pings',
      description: [
        'Opt in to what you care about \u2014 click again to mute:',
        '',
        '\ud83d\udd0a `vc ping`',
        '\ud83c\udfae `game ping`',
      ].join('\n'),
      footer: { text: 'Multi-select \u2022 only pinged when it matters' },
    }),
  },
  {
    key: 'announcements', channelKey: 'announcements', pin: true,
    embed: E({
      color: 0xeb459e,
      title: '\ud83d\udce2 Announcements',
      description: [
        'Official updates only \u2014 events, resource drops, schedule changes & server news.',
        '',
        '\ud83d\udce2 **Staff post here** \u2014 everyone can read.',
        '\u2705 **Turn on notifications** for this channel (`···` menu \u2192 Notification Settings \u2192 **All Messages**) so you never miss an update.',
        '',
        '*Missed something? Scroll up \u2014 history is enabled.*',
      ].join('\n'),
      footer: { text: 'Padhai Khana \u2022 announce \u2192 follow' },
    }),
  },
  {
    key: 'intros', channelKey: 'introductions', pin: false,
    embed: E({
      color: 0x10b981,
      title: '\ud83e\udd1b Introduce yourself',
      description: [
        'Drop a quick intro so we know you! Something like:',
        '',
        '\u2022 **Nickname / name**',
        '\u2022 **What you are preparing** \u2014 Class 12? Which course?',
        '\u2022 **Subjects** you want help with',
        '\u2022 **One fun fact** about you',
        '',
        'Then grab matching roles in <#' + ids.roles + '> and you are all set \ud83c\udf89',
      ].join('\n'),
      footer: { text: 'Padhai Khana \u2022 say hi \ud83d\udc4b' },
    }),
  },
];

function owFor(kind, staffIds) {
  if (kind === 'readonly-staff') {
    return [
      { id: G, type: 0, allow: READ_ONLY, deny: DENY_SEND },
      ...staffIds.map(id => ({ id, type: 0, allow: STAFF_SEND, deny: '0' })),
    ];
  }
  if (kind === 'panel-staff') {
    return [
      { id: G, type: 0, allow: PANEL_VIEW, deny: DENY_SEND },
      ...staffIds.map(id => ({ id, type: 0, allow: STAFF_SEND, deny: '0' })),
    ];
  }
  return [];
}

async function main() {
  console.log(DRY ? '=== PADHAI BASIC SETUP — DRY RUN ===' : '=== PADHAI BASIC SETUP ===');
  const actions = [];
  const checks = [];
  const failures = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

  let roles = await cfg.api(`/guilds/${G}/roles`);
  const staffRoles = ['admin', 'moderator', 'developer'].map(n => roles.find(r => r.name === n));
  if (staffRoles.some(r => !r)) { console.error('staff roles missing'); process.exit(2); }
  const staffIds = staffRoles.map(r => r.id);

  let chans = await cfg.api(`/guilds/${G}/channels`);
  const byName = (n) => chans.find(c => c.name === n);

  // ---- channels ----
  for (const def of NEW_CHANNELS) {
    let ch = chans.find(c => c.name === def.name);
    if (!ch) {
      actions.push(`create channel ${def.name} (type ${def.type})`);
      if (!DRY) {
        ch = await cfg.api(`/guilds/${G}/channels`, {
          method: 'POST',
          body: JSON.stringify({
            name: def.name, type: def.type, parent_id: def.parent,
            permission_overwrites: owFor(def.overwrites, staffIds),
          }),
          headers: REASON,
        });
        chans = await cfg.api(`/guilds/${G}/channels`);
      }
    } else actions.push(`channel exists: ${def.name}`);
    def.id = ch ? ch.id : null;
  }

  // ---- positions: absolute assignment, distinct within category ----
  const startHere = byName('╭──-✦-start-here');
  const getDef = (k) => NEW_CHANNELS.find(d => d.key === k);
  const rulesC = getDef('rules'), annC = getDef('announcements'), rolesC = getDef('roles');
  const setPos = async (ch, pos, label) => {
    if (!ch) return;
    if (ch.position === pos) { actions.push(`position ok: ${label}=${pos}`); return; }
    actions.push(`position ${label} ${ch.position} -> ${pos}`);
    if (DRY) return;
    try {
      await cfg.api(`/channels/${ch.id}`, { method: 'PATCH', body: JSON.stringify({ position: pos }), headers: REASON });
      const u = chans.find(c => c.id === ch.id); if (u) u.position = pos;
    } catch (e) { failures.push(`pos ${label}: ${e.message}`); }
  };
  if (!DRY && rulesC.id && startHere) {
    const byId = (id) => chans.find(c => c.id === id);
    const info = byName('│-✦-info');
    const intro = byName('╰──-✦-introductions');
    const general = byName('╭──-✦-💬-general');
    const media = byName('│-✦-📸-media');
    const alerts = byName('╰──-✦-🔒-security-alerts');
    await setPos(startHere, 0, 'start-here');
    await setPos(byId(rulesC.id), 1, 'rules');
    await setPos(byId(rolesC.id), 2, 'roles');
    await setPos(info, 3, 'info');
    await setPos(intro, 4, 'introductions');
    await setPos(general, 3, 'general');
    await setPos(byId(annC.id), 4, 'announcements');
    await setPos(media, 5, 'media');
    await setPos(alerts, 6, 'security-alerts');
  }

  // ---- verify overwrites on new channels ----
  const expectOw = (ch, kind, label) => {
    if (!ch) { check(`${label}-exists`, false, 'missing'); return; }
    const ows = ch.permission_overwrites || [];
    const ev = ows.find(o => o.id === G);
    const want = kind === 'panel-staff'
      ? { allow: PANEL_VIEW, deny: DENY_SEND }
      : { allow: READ_ONLY, deny: DENY_SEND };
    const evOk = ev && BigInt(ev.allow) === BigInt(want.allow) && BigInt(ev.deny) === BigInt(want.deny);
    const staffOk = staffIds.every(id => ows.some(o => o.id === id && BigInt(o.allow) === BigInt(STAFF_SEND)));
    check(`${label}-overwrites`, !!evOk && staffOk, ev ? `everyone a=${ev.allow} d=${ev.deny}` : 'no @everyone ow');
  };
  const fresh = () => cfg.api(`/guilds/${G}/channels`);
  if (!DRY) {
    chans = await fresh();
    expectOw(chans.find(c => c.id === rulesC.id), 'readonly-staff', 'rules');
    expectOw(chans.find(c => c.id === annC.id), 'readonly-staff', 'announcements');
    expectOw(chans.find(c => c.id === rolesC.id), 'panel-staff', 'roles');
  }

  // ---- guild settings ----
  const guild = await cfg.api(`/guilds/${G}`);
  const gPatch = {};
  if (rulesC.id && guild.rules_channel_id !== rulesC.id) gPatch.rules_channel_id = rulesC.id;
  if (guild.description !== GUILD_DESC) gPatch.description = GUILD_DESC;
  if (guild.default_message_notifications !== 0) gPatch.default_message_notifications = 0;
  if (Object.keys(gPatch).length) {
    actions.push(`guild patch: ${JSON.stringify(gPatch)}`);
    if (!DRY) {
      try { await cfg.api(`/guilds/${G}`, { method: 'PATCH', body: JSON.stringify(gPatch), headers: REASON }); }
      catch (e) { failures.push('guild: ' + e.message); }
    }
  } else actions.push('guild settings already correct');

  // ---- resolve link ids ----
  const general = byName('╭──-✦-💬-general');
  const intros = byName('╰──-✦-introductions');
  const studyHelp = chans.find(c => c.name.includes('study-help'));
  const reports = byName('╰──-✦-reports');
  const ids = {
    rules: rulesC.id, roles: rolesC.id, announcements: annC.id,
    reports: reports && reports.id, introductions: intros && intros.id,
    general: general && general.id, studyHelp: studyHelp && studyHelp.id,
  };
  if (Object.values(ids).some(v => !v)) {
    if (!DRY) { console.error('missing link ids', ids); process.exit(2); }
    for (const k of Object.keys(ids)) if (!ids[k]) ids[k] = `new-${k}`;
  }

  // ---- messages ----
  const chanByKey = {
    rules: rulesC.id, announcements: annC.id, roles: rolesC.id,
    'start-here': startHere.id, introductions: intros.id,
  };
  const msgDefs = startMessages(ids);
  const posted = {};
  for (const m of msgDefs) {
    const chId = chanByKey[m.channelKey];
    if (!chId) {
      actions.push(`post message: ${m.key} -> #${m.channelKey} (new channel)`);
      continue;
    }
    const history = await cfg.api(`/channels/${chId}/messages?limit=50`);
    const existing = history.find(msg =>
      msg.author && msg.author.bot && (msg.embeds || []).some(eb => eb.title === m.embed.title));
    if (existing) {
      posted[m.key] = existing.id;
      actions.push(`message exists: ${m.key} (${existing.id})`);
      continue;
    }
    actions.push(`post message: ${m.key} -> #${m.channelKey}`);
    if (!DRY) {
      try {
        const msg = await cfg.api(`/channels/${chId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ embeds: [m.embed] }),
          headers: REASON,
        });
        posted[m.key] = msg.id;
      } catch (e) { failures.push(`post ${m.key}: ${e.message}`); }
    }
  }

  // ---- pins ----
  for (const m of msgDefs.filter(x => x.pin)) {
    const msgId = posted[m.key];
    if (!msgId) continue;
    const chId = chanByKey[m.channelKey];
    const pins = await cfg.api(`/channels/${chId}/pins`).catch(() => []);
    if (pins.some(p => p.id === msgId)) { actions.push(`already pinned: ${m.key}`); continue; }
    actions.push(`pin: ${m.key}`);
    if (!DRY) {
      try { await cfg.api(`/channels/${chId}/pins/${msgId}`, { method: 'PUT', headers: REASON }); }
      catch (e) { failures.push(`pin ${m.key}: ${e.message}`); }
    }
  }

  if (DRY) {
    console.log('\n--- planned ---');
    actions.forEach(a => console.log(' *', a));
    console.log('\nDRY RUN — no changes.');
    return;
  }

  // ---- final verification ----
  console.log('\n--- verification ---');
  chans = await fresh();
  const findFrag = (f) => chans.find(c => c.name && c.name.includes(f));
  const welcomeKids = chans.filter(c => c.parent_id === WELCOME).sort((a, b) => a.position - b.position).map(c => c.name);
  const commKids = chans.filter(c => c.parent_id === COMMUNITY).sort((a, b) => a.position - b.position).map(c => c.name);
  check('welcome-order', JSON.stringify(welcomeKids) === JSON.stringify(['╭──-✦-start-here', '│-✦-📜-rules', '│-✦-🎭-roles', '│-✦-info', '╰──-✦-introductions']), welcomeKids.join(' > '));
  check('community-order', commKids[0] === '╭──-✦-💬-general' && commKids[1] === '│-✦-📢-announcements' && commKids[2] === '│-✦-📸-media' && commKids[3] === '╰──-✦-🔒-security-alerts', commKids.join(' > '));
  const annCh = chans.find(c => c.id === annC.id);
  check('announcements-in-community', annCh && annCh.parent_id === COMMUNITY && annCh.type === 0, annCh ? `type ${annCh.type}` : 'missing');

  const g2 = await cfg.api(`/guilds/${G}`);
  check('rules-channel-set', g2.rules_channel_id === rulesC.id, String(g2.rules_channel_id));
  check('description-set', g2.description === GUILD_DESC, JSON.stringify(g2.description));
  check('notifications-all', g2.default_message_notifications === 0, String(g2.default_message_notifications));

  let msgOk = true; const missingMsg = [];
  for (const m of msgDefs) if (!posted[m.key]) { msgOk = false; missingMsg.push(m.key); }
  check('all-messages-posted', msgOk, msgOk ? `${msgDefs.length} msgs` : 'missing: ' + missingMsg.join(', '));

  let pinOk = true; const pinMissing = [];
  for (const m of msgDefs.filter(x => x.pin)) {
    const pins = await cfg.api(`/channels/${chanByKey[m.channelKey]}/pins`).catch(() => []);
    if (!pins.some(p => p.id === posted[m.key])) { pinOk = false; pinMissing.push(m.key); }
  }
  check('pins', pinOk, pinOk ? 'rules + announcements pinned' : 'missing: ' + pinMissing.join(', '));

  // ---- role panel cheat sheet ----
  const cheat = msgDefs.filter(m => m.pairs).map(m => ({
    key: m.key,
    channel: '#│-✦-🎭-roles',
    channelId: ids.roles,
    messageId: posted[m.key] || null,
    unique: !!m.unique,
    commands: [
      ...(m.unique ? [`!rr unique ${posted[m.key]}`] : []),
      ...m.pairs.map(([emoji, role]) => `!rr add ${posted[m.key]} ${emoji} @${role}`),
    ],
  }));
  fs.writeFileSync(PANELS_FILE, JSON.stringify(cheat, null, 2));

  console.log('\n=== REACTION-ROLE CHEAT SHEET (paste into chat) ===');
  for (const p of cheat) {
    console.log(`\n# ${p.key}  [msg ${p.messageId}]${p.unique ? '  (UNIQUE — run unique first)' : ''}`);
    p.commands.forEach(c => console.log('  ' + c));
  }
  console.log(`\nsaved -> ${PANELS_FILE}`);

  const report = { when: new Date().toISOString(), actions, failures, checks, ids, posted, cheat };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`report -> ${REPORT}`);
  const failed = checks.filter(c => !c.ok).length + failures.length;
  if (failures.length) failures.forEach(f => console.log('FAIL:', f));
  console.log(failed === 0 ? '\nALL GREEN ✓' : `\n${failed} problem(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
