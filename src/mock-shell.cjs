/* CUET Archive — unified mock shell injector.
 * Rerunnable + idempotent. Operates on site/mocks (never on site-archive/).
 *  - proper <title> from payload, lang="en", accessible viewport
 *  - meta description / theme-color / favicon
 *  - in-flow archive bar (zero clash with either quiz engine)
 *  - Telegram promos rewired to the CUET '27 Discord invite
 */
const fs = require('fs');
const path = require('path');

const MOCK_DIR = path.join(__dirname, '..', 'site', 'mocks');
const INVITE = 'https://discord.gg/XwVtsUUygy';
const OLD_INVITES = ['https://discord.gg/ZM7XNMapD'];
const MARK = 'cuet-archbar';

const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B0E14"/><text x="32" y="42" font-family="sans-serif" font-size="30" font-weight="bold" text-anchor="middle" fill="#F2EAD6">C<tspan fill="#E9A13B">27</tspan></text></svg>`
  );

const ARCH_CSS = `<style data-cuet-shell>
.cuet-archbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between;padding:8px 14px;background:#0B0E14;color:#F2EAD6;border-bottom:1px solid rgba(233,161,59,.35);font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.cuet-archbar a{color:#E9A13B;text-decoration:none;font-weight:700;white-space:nowrap}
.cuet-archbar a:hover{text-decoration:underline}
.cuet-archbar .cuet-archbar-title{opacity:.75;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}
.cuet-archbar .cuet-archbar-right{display:flex;gap:12px;align-items:center}
</style>`;

function payloadTitle(html) {
  const m = html.match(/"title":\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse('"' + m[1] + '"');
  } catch {
    return m[1];
  }
}

function escTitle(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function processFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  const orig = s;
  const changes = [];
  const isPayload = s.includes('QUIZ_PAYLOAD');

  // 1. lang
  if (/<html[^>]*lang="hi"/.test(s)) {
    s = s.replace(/<html([^>]*)lang="hi"/, '<html$1lang="en"');
    changes.push('lang');
  }

  // 2. title
  if (isPayload) {
    const t = payloadTitle(s);
    if (t) {
      const nt = `<title>${escTitle(t)} — CUET Archive Mock</title>`;
      if (/<title>Adda247 — CBT<\/title>/.test(s)) {
        s = s.replace(/<title>Adda247 — CBT<\/title>/, nt);
        changes.push('title');
      }
    }
  } else {
    const m = s.match(/<title>([\s\S]*?)<\/title>/);
    if (m && !m[1].includes('CUET Archive')) {
      s = s.replace(/<title>([\s\S]*?)<\/title>/, `<title>${escTitle(m[1].trim())} — CUET Archive Mock</title>`);
      changes.push('title');
    }
  }

  // 3. viewport: allow pinch zoom (accessibility)
  if (/maximum-scale=1\.0,\s*user-scalable=no/.test(s)) {
    s = s.replace(/maximum-scale=1\.0,\s*user-scalable=no/, 'viewport-fit=cover');
    changes.push('viewport');
  }

  // 4. meta extras after charset
  if (!s.includes('name="theme-color"')) {
    const meta =
      `\n<meta name="theme-color" content="#0B0E14">` +
      `\n<meta name="description" content="Free CUET mock test — attempt in your browser. From the CUET Archive, synced with the CUET '27 Discord community.">` +
      `\n<link rel="icon" href="${FAVICON}">`;
    s = s.replace(/(<meta charset=[^>]*>)/i, '$1' + meta);
    changes.push('meta');
  }

  // 5. archive bar CSS (once)
  if (!s.includes('data-cuet-shell')) {
    s = s.replace(/<\/head>/i, ARCH_CSS + '\n</head>');
    changes.push('css');
  }

  // 6. engine-specific chrome (marker is the injected link/bar, NOT the CSS)
  const hasChrome = s.includes('../../mocks.html');
  if (!hasChrome) {
    if (isPayload) {
      // header-left: prepend back-link, rewire ogbot-link to Discord
      const bar =
        `<a class="${MARK}-link" href="../../mocks.html" title="Back to the Mock Lab">‹ Mock Lab</a>`;
      s = s.replace(/(<span id="exam-title">.*?<\/span>)/s, bar + ' $1');
      changes.push('archbar-payload');
    } else {
      // mode-selection screen: slim in-flow bar on top
      const m = s.match(/<title>([\s\S]*?)<\/title>/);
      const t = m ? m[1].replace(/ — CUET Archive Mock$/, '').trim() : 'Mock Test';
      const bar =
        `<div class="${MARK}"><a href="../../mocks.html" title="Back to the Mock Lab">‹ Mock Lab</a>` +
        `<span class="${MARK}-title">${escTitle(t)}</span>` +
        `<span class="${MARK}-right"><a href="${INVITE}" target="_blank" rel="noopener">CUET &#8217;27 Discord</a></span></div>`;
      s = s.replace(/(<div id="modeSelection">)/, '$1\n' + bar);
      // results-screen telegram button -> discord
      s = s.replace(/https:\/\/t\.me\/crackcuetug/i, INVITE);
      s = s.replace(/Join Telegram Channel/, 'Join CUET &#8217;27 Discord');
      s = s.replace(/fab fa-telegram/, 'fab fa-discord');
      changes.push('archbar-rawdata');
    }
  }

  // 6b. brand rewrites (always safe + idempotent — run outside the chrome guard)
  if (s.includes('title="Open Telegram"')) {
    s = s.replace(
      /<a class="ogbot-link" href="[^"]*"([^>]*)title="Open Telegram"([^>]*)>@CrackcuetUG<\/a>/i,
      `<a class="ogbot-link" href="${INVITE}"$1title="Open CUET '27 Discord"$2>CUET &#8217;27 Discord</a>`
    );
    changes.push('ogbot-discord');
  }
  if (s.includes('@CrackcuetUG') || s.includes('@Crackcuetug')) {
    s = s.replace(
      /Made with ❤️ by <b>@CrackcuetUG( @ProviderOG)?<\/b>/,
      `Part of the <b>CUET &#8217;27 Archive</b> · free forever`
    );
    changes.push('credit-archive');
  }

  // 7. catch-all: any remaining t.me links -> discord invite
  const before = (s.match(/t\.me\//g) || []).length;
  s = s.replace(/https:\/\/t\.me\/[A-Za-z0-9_]+/g, INVITE);
  const after = (s.match(/t\.me\//g) || []).length;
  if (before !== after) changes.push(`tme:${before - after}`);

  // 8. migrate retired invite codes -> current invite
  for (const old of OLD_INVITES) {
    if (s.includes(old)) {
      s = s.split(old).join(INVITE);
      changes.push('invite-migrate');
    }
  }

  if (s !== orig) {
    fs.writeFileSync(file, s);
    return changes;
  }
  return ['noop'];
}

function main() {
  const dirs = fs.readdirSync(MOCK_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  let touched = 0;
  const summary = {};
  for (const d of dirs) {
    const files = fs.readdirSync(path.join(MOCK_DIR, d.name)).filter((f) => f.endsWith('.html'));
    for (const f of files) {
      const ch = processFile(path.join(MOCK_DIR, d.name, f));
      if (!(ch.length === 1 && ch[0] === 'noop')) {
        touched++;
        console.log(`  ${d.name}/${f}: ${ch.join(', ')}`);
      }
      for (const c of ch) summary[c] = (summary[c] || 0) + 1;
    }
  }
  console.log(`\nmock-shell: touched ${touched} files`);
  console.log('change histogram:', JSON.stringify(summary));
}

if (require.main === module) main();
module.exports = { processFile };
