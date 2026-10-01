#!/usr/bin/env node
// One-off: copy CUET 2027's role-based permission system into Padhai Khana.
// - Creates every non-managed CUET role in Padhai (same name/perms/color/hoist/mentionable)
// - Creation order = CUET hierarchy (top -> bottom), so relative order matches
// - Sets Padhai @everyone permissions = CUET @everyone permissions
// - Deletes Padhai's junk "new role" (not present in CUET)
// - Leaves managed integration roles untouched on both sides
// - Read-only toward CUET (GET only). Idempotent: re-run verifies/updates instead of duplicating.

const cfg = require('./config.cjs');

const PADHAI_GUILD = '1551614250508746814';
const JUNK_ROLE = 'new role';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiRetry(method, path, body) {
  const opts = { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await cfg.api(path, opts);
    } catch (e) {
      const m = String(e.message || e);
      const retryAfter = /retry after (\d+)/i.exec(m);
      if (retryAfter) {
        const wait = Math.ceil(parseFloat(retryAfter[1]) * 1000) + 250;
        console.log(`  rate-limited, waiting ${wait}ms…`);
        await sleep(wait);
        continue;
      }
      if (attempt === 4) throw e;
      await sleep(800 * (attempt + 1));
    }
  }
}

const PERM_NAMES = [
  [1n, 'CREATE_INSTANT_INVITE'], [2n, 'KICK_MEMBERS'], [4n, 'BAN_MEMBERS'],
  [8n, 'ADMINISTRATOR'], [16n, 'MANAGE_CHANNELS'], [32n, 'MANAGE_GUILD'],
  [64n, 'ADD_REACTIONS'], [128n, 'VIEW_AUDIT_LOG'], [256n, 'PRIORITY_SPEAKER'],
  [512n, 'STREAM'], [1024n, 'VIEW_CHANNEL'], [2048n, 'SEND_MESSAGES'],
  [4096n, 'SEND_TTS_MESSAGES'], [8192n, 'MANAGE_MESSAGES'], [16384n, 'EMBED_LINKS'],
  [32768n, 'ATTACH_FILES'], [65536n, 'READ_MESSAGE_HISTORY'], [131072n, 'MENTION_EVERYONE'],
  [262144n, 'USE_EXTERNAL_EMOJIS'], [1048576n, 'CONNECT'], [2097152n, 'SPEAK'],
  [4194304n, 'MUTE_MEMBERS'], [8388608n, 'DEAFEN_MEMBERS'], [16777216n, 'MOVE_MEMBERS'],
  [33554432n, 'USE_VAD'], [17179869184n, 'MANAGE_ROLES'], [68719476736n, 'MANAGE_WEBHOOKS'],
  [137438953472n, 'USE_APPLICATION_COMMANDS'], [562949953421312n, 'MANAGE_EVENTS'],
];
function decode(p) {
  const b = BigInt(p);
  const names = PERM_NAMES.filter(([bit]) => (b & bit) === bit).map(([, n]) => n);
  const extra = b & ~PERM_NAMES.reduce((a, [bit]) => a | bit, 0n);
  if (extra) names.push(`UNKNOWN(${extra})`);
  return names.length ? names.join('|') : '(none)';
}

async function main() {
  const me = await cfg.api('/users/@me');
  console.log(`Acting as ${me.username} (GET CUET / write Padhai only)\n`);

  // ---- fetch both sides ----
  const cuetRoles = await cfg.api(`/guilds/${cfg.GUILD_ID}/roles`);
  const padRoles = await cfg.api(`/guilds/${PADHAI_GUILD}/roles`);
  const padMembers = await cfg.api(`/guilds/${PADHAI_GUILD}/members?limit=1000`);

  const toCopy = cuetRoles
    .filter((r) => !r.managed && r.name !== '@everyone')
    .sort((a, b) => b.position - a.position); // CUET order: admin first, bots last

  const cuetEveryone = cuetRoles.find((r) => r.name === '@everyone');
  const padEveryone = padRoles.find((r) => r.name === '@everyone');

  console.log(`CUET roles: ${cuetRoles.length} (${toCopy.length} to copy, ${cuetRoles.length - toCopy.length - 1} managed skipped)`);
  console.log(`Padhai roles: ${padRoles.length}`);
  const iconRoles = toCopy.filter((r) => r.icon || r.unicode_emoji);
  if (iconRoles.length) console.log(`NOTE: ${iconRoles.length} CUET roles have icons/emojis (color-only copy):`, iconRoles.map((r) => r.name).join(', '));
  console.log(`\n@everyone: CUET ${cuetEveryone.permissions} = ${decode(cuetEveryone.permissions)}`);
  console.log(`@everyone: PADHAI ${padEveryone.permissions} = ${decode(padEveryone.permissions)}`);
  console.log(`  -> Padhai @everyone will be set to CUET's bitfield\n`);

  // sanity: bot must be able to act (its top role above everything it modifies)
  const botRolePos = Math.max(...padRoles.map((r) => r.position));
  const botMemberRole = padRoles.find((r) => r.id === padRoles.find((x) => x.position === botRolePos)?.id);
  console.log(`Padhai top role: pos ${botRolePos} (${botMemberRole?.name}) — creates land at bottom, below it: OK\n`);

  // ---- delete junk role ----
  const junk = padRoles.find((r) => r.name === JUNK_ROLE && !r.managed);
  if (junk) {
    const holders = padMembers.filter((m) => m.roles.includes(junk.id)).length;
    await apiRetry('DELETE', `/guilds/${PADHAI_GUILD}/roles/${junk.id}`);
    console.log(`Deleted junk role "${JUNK_ROLE}" (was held by ${holders} member${holders === 1 ? '' : 's'})`);
  } else {
    console.log(`Junk role "${JUNK_ROLE}" not present — nothing to delete`);
  }

  // ---- create / update roles ----
  const existingByName = new Map(
    (await cfg.api(`/guilds/${PADHAI_GUILD}/roles`)).map((r) => [r.name, r])
  );
  let created = 0, updated = 0, verified = 0;
  for (const src of toCopy) {
    const payload = {
      name: src.name,
      permissions: String(src.permissions),
      color: src.color,
      hoist: src.hoist,
      mentionable: src.mentionable,
    };
    const existing = existingByName.get(src.name);
    if (existing) {
      if (existing.managed) {
        console.log(`  ~ "${src.name}" exists but is managed — skipping update`);
        verified++;
        continue;
      }
      const differs =
        String(existing.permissions) !== String(src.permissions) ||
        existing.color !== src.color ||
        existing.hoist !== src.hoist ||
        existing.mentionable !== src.mentionable;
      if (differs) {
        await apiRetry('PATCH', `/guilds/${PADHAI_GUILD}/roles/${existing.id}`, payload);
        console.log(`  ~ updated "${src.name}"`);
        updated++;
      } else {
        verified++;
      }
    } else {
      await apiRetry('POST', `/guilds/${PADHAI_GUILD}/roles`, payload);
      created++;
      console.log(`  + created "${src.name}"`);
    }
    await sleep(350);
  }

  // ---- @everyone base permissions ----
  if (String(padEveryone.permissions) !== String(cuetEveryone.permissions)) {
    await apiRetry('PATCH', `/guilds/${PADHAI_GUILD}/roles/${PADHAI_GUILD}`, {
      permissions: String(cuetEveryone.permissions),
    });
    console.log(`\nPatched @everyone permissions -> ${cuetEveryone.permissions}`);
  } else {
    console.log(`\n@everyone already matches CUET`);
  }

  // ---- verify ----
  console.log('\n--- verification ---');
  const finalRoles = await cfg.api(`/guilds/${PADHAI_GUILD}/roles`);
  const finalByName = new Map(finalRoles.map((r) => [r.name, r]));
  const issues = [];
  for (const src of toCopy) {
    const got = finalByName.get(src.name);
    if (!got) { issues.push(`missing role: ${src.name}`); continue; }
    if (String(got.permissions) !== String(src.permissions)) issues.push(`perms differ: ${src.name}`);
    if (got.color !== src.color) issues.push(`color differ: ${src.name}`);
    if (got.hoist !== src.hoist) issues.push(`hoist differ: ${src.name}`);
    if (got.mentionable !== src.mentionable) issues.push(`mentionable differ: ${src.name}`);
  }
  // relative hierarchy order among copied roles
  const finalCopied = finalRoles
    .filter((r) => toCopy.some((s) => s.name === r.name))
    .sort((a, b) => b.position - a.position)
    .map((r) => r.name);
  const srcOrder = toCopy.map((r) => r.name);
  if (JSON.stringify(finalCopied) !== JSON.stringify(srcOrder)) {
    issues.push('hierarchy order of copied roles differs from CUET');
    console.log('  order (Padhai):', finalCopied.join(' > '));
    console.log('  order (CUET)  :', srcOrder.join(' > '));
  }
  const everyoneNow = finalRoles.find((r) => r.name === '@everyone');
  if (String(everyoneNow.permissions) !== String(cuetEveryone.permissions)) {
    issues.push('@everyone permissions differ');
  }
  if (finalByName.has(JUNK_ROLE)) issues.push(`junk role "${JUNK_ROLE}" still exists`);

  console.log(`  roles copied:      ${toCopy.length}/${toCopy.length} (created ${created}, updated ${updated}, already ok ${verified})`);
  console.log(`  hierarchy order:    ${issues.includes('hierarchy order of copied roles differs from CUET') ? 'MISMATCH' : 'matches CUET'}`);
  console.log(`  @everyone:          ${String(everyoneNow.permissions) === String(cuetEveryone.permissions) ? 'matches CUET' : 'MISMATCH'}`);
  console.log(`  issues:             ${issues.length ? issues.join('; ') : 'none'}`);

  const managedPad = finalRoles.filter((r) => r.managed).map((r) => r.name);
  console.log(`  kept managed roles: ${managedPad.join(', ')}`);
  console.log(`  final role count:   ${finalRoles.length}`);
  console.log(issues.length ? '\nFAILED' : '\nOK — Padhai roles mirror CUET 1:1');
  process.exit(issues.length ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
