#!/usr/bin/env node
/* Generates 1200x630 Open Graph cards (site/assets/og/*.png) by screenshotting
 * a temporary card page in site/_ogcard.html with headless chromium.
 * Run manually: npm run og   (not part of `npm run build`)
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const cfg = require('./config.cjs');

const SITE = cfg.SITE_DIR;
const PORT = Number(process.env.OG_PORT) || 4173;
const BASE = 'http://localhost:' + PORT;
const OG_DIR = path.join(SITE, 'assets', 'og');
const TEMP_PAGE = path.join(SITE, '_ogcard.html');
const URL_LABEL = 'kavy-codes.github.io/cuet-archive';

function findChromium() {
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      execFileSync('which', [bin], { stdio: 'pipe' });
      return bin;
    } catch (e) {}
  }
  return null;
}

function cardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OG card</title>
<link rel="stylesheet" href="assets/fonts.css">
<style>
  :root { --amber: #e9a13b; --ink: #0b0e14; --paper: #f7f0df; --muted: #a8a290; --dim: #cfc8b4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    font-family: 'Figtree', system-ui, sans-serif;
    background: var(--ink);
    color: var(--paper);
    display: flex;
    flex-direction: column;
    padding: 54px 64px 46px;
    position: relative;
  }
  .bg, .grid, .vig { position: absolute; inset: 0; pointer-events: none; }
  .bg {
    background:
      radial-gradient(900px 520px at 88% -12%, rgba(233, 161, 59, 0.17), transparent 62%),
      radial-gradient(720px 440px at -6% 112%, rgba(88, 196, 178, 0.11), transparent 62%);
  }
  .grid {
    background-image:
      linear-gradient(rgba(242, 234, 214, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(242, 234, 214, 0.05) 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(760px 480px at 26% 34%, #000 32%, transparent 86%);
    mask-image: radial-gradient(760px 480px at 26% 34%, #000 32%, transparent 86%);
  }
  .vig { background: radial-gradient(1250px 730px at 50% 42%, transparent 56%, rgba(0, 0, 0, 0.42)); }
  header { display: flex; align-items: center; gap: 17px; position: relative; z-index: 1; }
  header img { width: 52px; height: 52px; }
  .brand { display: flex; flex-direction: column; gap: 3px; }
  .brand b { font-family: 'Fraunces', serif; font-weight: 600; font-size: 23px; letter-spacing: 0.015em; }
  .brand span { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.26em; text-transform: uppercase; color: var(--muted); }
  .top-chip {
    margin-left: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--amber);
    border: 1px solid rgba(233, 161, 59, 0.45);
    background: rgba(233, 161, 59, 0.1);
    border-radius: 999px;
    padding: 10px 20px;
  }
  main { position: relative; z-index: 1; margin: auto 0; max-width: 980px; }
  h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 88px; line-height: 1.03; letter-spacing: -0.015em; }
  h1 .amber { color: var(--amber); position: relative; display: inline-block; }
  h1 .u-svg { position: absolute; left: -1%; bottom: -0.14em; width: 102%; height: 0.3em; color: var(--amber); }
  h1 .u-svg path { fill: none; stroke: currentColor; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  h1 .u-svg path:first-child { stroke-width: 5.5; }
  h1 .u-svg path:last-child { stroke-width: 3.4; opacity: 0.7; }
  h1 i { font-style: italic; font-weight: 400; }
  h1 .st { color: transparent; -webkit-text-stroke: 2px var(--paper); }
  .sub { margin-top: 28px; font-size: 27px; line-height: 1.35; color: var(--dim); }
  .sub b { color: var(--paper); }
  .rule { width: 72px; height: 5px; border-radius: 3px; background: var(--amber); margin-bottom: 28px; }
  footer { position: relative; z-index: 1; display: flex; align-items: center; gap: 14px; }
  .url { font-family: 'JetBrains Mono', monospace; font-size: 16.5px; color: var(--muted); }
  .chips { margin-left: auto; display: flex; gap: 10px; }
  .chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--amber);
    border: 1px solid rgba(233, 161, 59, 0.35);
    background: rgba(233, 161, 59, 0.08);
    border-radius: 999px;
    padding: 8px 17px;
  }
  .emoji {
    position: absolute;
    right: 78px;
    top: 168px;
    font-size: 168px;
    line-height: 1;
    transform: rotate(-6deg);
    filter: drop-shadow(0 20px 46px rgba(233, 161, 59, 0.24));
    z-index: 0;
  }
  .v { display: none; }
  body.k-home .v-home, body.k-mocks .v-mocks, body.k-library .v-library, body.k-topic .v-topic { display: block; }
  body.k-topic .emoji { display: block; }
  body:not(.k-topic) .emoji { display: none; }
</style>
</head>
<body>
  <div class="bg"></div>
  <div class="grid"></div>
  <div class="vig"></div>
  <header>
    <img src="assets/logo.svg" alt="">
    <div class="brand"><b>CUET '27 Archive</b><span>Free · Community · Forever</span></div>
    <span class="top-chip" id="chip">Free forever</span>
  </header>
  <main class="v v-home">
    <h1>Every resource.<br><span class="st">One</span> <span class="amber">archive.<svg class="u-svg" viewBox="0 0 200 26" preserveAspectRatio="none" aria-hidden="true"><path d="M4 17 C 46 9, 108 6, 196 12"/><path d="M12 22 C 74 16, 138 14, 190 18"/></svg></span><br><i>Zero paywalls.</i></h1>
    <p class="sub"><b id="s-mocks">66 in-browser mocks</b> · <span id="s-qs">3,000+</span> practice questions · books, notes, lectures &amp; papers</p>
  </main>
  <main class="v v-mocks">
    <div class="rule"></div>
    <h1>The Mock Lab.</h1>
    <p class="sub"><b id="s-mocks2">66 free CUET mock tests</b> — attempt them in your browser. Timed, auto-checked, <b>zero signup</b>.</p>
  </main>
  <main class="v v-library">
    <div class="rule"></div>
    <h1>The Library.</h1>
    <p class="sub"><b id="s-res">141 links &amp; files</b> — books, notes, video lectures and past papers. All free.</p>
  </main>
  <main class="v v-topic">
    <div class="rule"></div>
    <h1 id="t-title">Topic</h1>
    <p class="sub"><b id="t-count">0 free resources</b> — books, mocks, notes and links for CUET.</p>
  </main>
  <div class="emoji" id="emoji">📚</div>
  <footer>
    <span class="url">${URL_LABEL}</span>
    <span class="chips"><span class="chip" id="chip2">Free forever</span><span class="chip">No paywalls</span></span>
  </footer>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var k = q.get('k') || 'home';
  document.body.classList.add('k-' + k);
  var chip = document.getElementById('chip');
  if (k === 'mocks') chip.textContent = 'Attempt online';
  if (k === 'library') chip.textContent = 'All free';
  if (k === 'topic') chip.textContent = "CUET '27";
  if (k === 'home') {
    document.getElementById('s-mocks').textContent = (q.get('m') || '66') + ' in-browser mocks';
    document.getElementById('s-qs').textContent = q.get('qs') || '3,000+';
  } else if (k === 'mocks') {
    document.getElementById('s-mocks2').textContent = (q.get('m') || '66') + ' free CUET mock tests';
  } else if (k === 'library') {
    document.getElementById('s-res').textContent = (q.get('r') || '141') + ' links & files';
  } else if (k === 'topic') {
    var t = q.get('t') || 'Topic';
    var h = document.getElementById('t-title');
    h.textContent = t;
    if (t.length > 26) h.style.fontSize = '62px';
    else if (t.length > 17) h.style.fontSize = '72px';
    document.getElementById('t-count').textContent = (q.get('n') || '0') + ' free resources';
    document.getElementById('emoji').textContent = q.get('e') || '📚';
  }
  document.fonts.ready.then(function () { document.body.dataset.ready = '1'; });
})();
</script>
</body>
</html>
`;
}

function targets() {
  const search = JSON.parse(fs.readFileSync(path.join(SITE, 'search.json'), 'utf8'));
  const mocks = JSON.parse(fs.readFileSync(path.join(SITE, 'mocks.json'), 'utf8'));
  const resources = JSON.parse(fs.readFileSync(cfg.DATA_FILE, 'utf8'));
  const topicsInSearch = search.filter((e) => e.k === 'topic');
  const resourceCount = search.filter((e) => e.k !== 'topic').length;
  const mockCount = (mocks.mocks || mocks).length;
  const qs = (mocks.mocks || mocks).reduce((n, m) => n + (m.questions || 0), 0);
  const emojiBySlug = {};
  for (const t of resources.topics || []) emojiBySlug[t.slug] = t.emoji || '📚';
  const list = [
    { name: 'home', q: { k: 'home', m: String(mockCount), qs: qs.toLocaleString('en-IN') } },
    { name: 'mocks', q: { k: 'mocks', m: String(mockCount) } },
    { name: 'library', q: { k: 'library', r: String(resourceCount) } },
  ];
  for (const t of topicsInSearch) {
    list.push({
      name: 'topic-' + t.ts,
      q: { k: 'topic', t: t.t, n: String(t.n || 0), e: emojiBySlug[t.ts] || '📚' },
    });
  }
  return list;
}

async function waitForServer(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(BASE + '/');
      if (r.ok) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  const chromium = findChromium();
  if (!chromium) {
    console.error('og: no chromium/chrome binary found — install chromium and retry');
    process.exit(1);
  }
  fs.mkdirSync(OG_DIR, { recursive: true });
  const list = targets();
  fs.writeFileSync(TEMP_PAGE, cardHtml());
  let child = null;
  try {
    const already = await fetch(BASE + '/').then((r) => r.ok).catch(() => false);
    if (!already) {
      child = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], { stdio: 'ignore' });
      if (!(await waitForServer(5000))) throw new Error('dev server did not start on ' + BASE);
    }
    for (const t of list) {
      const out = path.join(OG_DIR, t.name + '.png');
      const url = BASE + '/_ogcard.html?' + new URLSearchParams(t.q).toString();
      execFileSync(
        chromium,
        [
          '--headless=new',
          '--disable-gpu',
          '--hide-scrollbars',
          '--force-device-scale-factor=1',
          '--window-size=1200,630',
          '--virtual-time-budget=9000',
          '--screenshot=' + out,
          url,
        ],
        { stdio: 'pipe', timeout: 45000 }
      );
      const kb = (fs.statSync(out).size / 1024).toFixed(0);
      console.log('  og/' + t.name + '.png', kb + 'KB');
    }
  } finally {
    if (child) child.kill();
    try { fs.unlinkSync(TEMP_PAGE); } catch (e) {}
  }
  console.log('og: ' + list.length + ' cards written to site/assets/og');
}

main().catch((e) => {
  console.error('og failed:', e.message);
  process.exit(1);
});
