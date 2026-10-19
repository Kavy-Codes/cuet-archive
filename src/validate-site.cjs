/* CUET Archive — site + mock validator.
 * Checks: internal links, asset refs, search targets, mock question
 * integrity (options/correct answers), leftover brand URLs, no external
 * asset hotlinks, theme/font/icon wiring, byte budgets, JS syntax.
 * Exit 0 = pass (warnings allowed), exit 1 = failure.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

/* balanced JSON extraction respecting strings */
function extractJsonLiteral(src, startIdx) {
  let i = startIdx;
  while (i < src.length && /[\s=:]/.test(src[i])) {
    if (src[i] === '=' || src[i] === ':') { i++; break; }
    i++;
  }
  while (i < src.length && /\s/.test(src[i])) i++;
  const open = src[i];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return null;
  let depth = 0;
  let inStr = false;
  let strCh = '';
  let esc = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === strCh) inStr = false;
    } else {
      if (c === '"' || c === "'") { inStr = true; strCh = c; }
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const raw = src.slice(i, j + 1);
          try {
            return JSON.parse(raw);
          } catch {
            try {
              return JSON.parse(raw.replace(/'/g, '"'));
            } catch {
              return null;
            }
          }
        }
      }
    }
  }
  return null;
}

function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/* ---- 1. internal links + assets ---- */
const pages = walk(SITE).filter((p) => !p.includes(`${path.sep}mocks${path.sep}`));
const allFiles = new Set();
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else allFiles.add(path.relative(SITE, p).replace(/\\/g, '/'));
  }
})(SITE);

const linkRe = /\s(?:href|src)="([^"#]+)(?:#[^"]*)?"/g;
let linkCount = 0;
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const base = path.dirname(path.relative(SITE, page)).replace(/\\/g, '/');
  let m;
  while ((m = linkRe.exec(html))) {
    const url = m[1];
    if (/^(https?:|data:|mailto:|javascript:)/.test(url)) continue;
    linkCount++;
    const resolved = path.posix.normalize(path.posix.join(base === '.' ? '' : base, url));
    if (!allFiles.has(resolved)) fail(`broken link in ${path.relative(SITE, page)} -> ${url}`);
  }
}
console.log(`links: checked ${linkCount} internal refs across ${pages.length} pages`);

/* ---- 2. search.json targets ---- */
try {
  const idx = JSON.parse(fs.readFileSync(path.join(SITE, 'search.json'), 'utf8'));
  let bad = 0;
  for (const e of idx) {
    if (e.k === 'topic') {
      if (!allFiles.has('topics/' + e.ts + '.html')) { bad++; fail(`search topic target missing: ${e.ts}`); }
    } else if (e.lu && !allFiles.has(e.lu)) { bad++; fail(`search local target missing: ${e.lu}`); }
  }
  console.log(`search: ${idx.length} entries, ${bad} bad targets`);
} catch (e) {
  fail('search.json unreadable: ' + e.message);
}

/* ---- 3. mock integrity ---- */
const mockFiles = walk(path.join(SITE, 'mocks'));
let totalQ = 0;
let emptyOpt = 0;
let noCorrect = 0;
let multiCorrect = 0;
let engineFail = 0;
for (const file of mockFiles) {
  const rel = path.relative(SITE, file);
  const html = fs.readFileSync(file, 'utf8');
  let questions = null;
  const pi = html.indexOf('QUIZ_PAYLOAD');
  const ri = html.indexOf('const rawData');
  if (pi !== -1) {
    const data = extractJsonLiteral(html, pi + 'QUIZ_PAYLOAD'.length);
    if (data && Array.isArray(data.questions)) questions = data.questions.map((q) => ({
      opts: (q.options || []).map((o) => ({ text: o.text || '', img: false })),
      correct: (q.options || []).filter((o) => o.is_correct).length,
      hasImg: !!(q.qs_img || q.opt_img || q.so_img),
    }));
  } else if (ri !== -1) {
    const data = extractJsonLiteral(html, ri + 'const rawData'.length);
    if (Array.isArray(data)) {
      questions = data.map((q) => {
        const opts = [];
        for (let n = 1; n <= 10; n++) {
          const t = q['option_' + n];
          if (t === undefined || t === null) continue;
          opts.push({ text: String(t), img: !!q['option_image_' + n] });
        }
        const ans = parseInt(q.answer, 10);
        return { opts, correct: ans >= 1 && ans <= opts.length ? 1 : 0, hasImg: opts.some((o) => o.img), classic: true };
      });
    }
  }
  if (!questions) {
    engineFail++;
    fail(`mock engine unparseable: ${rel}`);
    continue;
  }
  totalQ += questions.length;
  questions.forEach((q, i) => {
    const texts = q.opts.map((o) => stripTags(o.text));
    const nonEmpty = texts.filter((t) => t.length > 0);
    if (!q.classic) {
      if (nonEmpty.length === 0 && !q.hasImg) {
        emptyOpt++;
        warn(`all-empty options (no image): ${rel} Q${i + 1}`);
      }
      if (q.correct === 0) { noCorrect++; warn(`no correct answer: ${rel} Q${i + 1}`); }
      if (q.correct > 1) { multiCorrect++; warn(`multiple correct: ${rel} Q${i + 1}`); }
    } else if (nonEmpty.length < 2) {
      emptyOpt++;
      warn(`classic thin options: ${rel} Q${i + 1}`);
    }
  });
}
console.log(`mocks: ${mockFiles.length} files, ${totalQ} questions, engine failures: ${engineFail}`);
console.log(`  all-empty option sets: ${emptyOpt}, no-correct: ${noCorrect}, multi-correct: ${multiCorrect}`);

/* ---- 4. leftover third-party brand refs.
 * Strict (fail) on shell-controlled surfaces: home, mock lab, mocks.
 * Topics/library mirror verbatim community posts — shared t.me links
 * there are legitimate content, reported as warnings only. */
const brandRe = [/t\.me\//g, /@Crackcuet\w*/g, /Open Telegram/g, /Join Telegram/g];
const STRICT = new Set(['index.html', 'mocks.html']);
for (const page of walk(SITE)) {
  const rel = path.relative(SITE, page);
  const strict = STRICT.has(rel) || rel.startsWith('mocks' + path.sep);
  const html = fs.readFileSync(page, 'utf8');
  for (const re of brandRe) {
    const hits = html.match(re);
    if (!hits) continue;
    const msg = `leftover "${re.source}" x${hits.length} in ${rel}`;
    if (strict) fail(msg);
    else warn(msg + ' (community-shared link, kept as content)');
  }
}
console.log('brand sweep: done');

/* ---- 5. required site files + lib tags ---- */
for (const f of ['index.html', 'mocks.html', 'library.html', 'search.json', 'mocks.json', 'sitemap.xml', 'robots.txt', '.nojekyll', 'assets/style.css', 'assets/app.js', 'assets/logo.svg', 'assets/icons.svg', 'assets/fonts.css', 'assets/fonts/figtree-latin-n-300.woff2', 'assets/fonts/fraunces-latin-n-400.woff2', 'assets/vendor/gsap.min.js', 'assets/vendor/ScrollTrigger.min.js', 'assets/vendor/barba.umd.js', 'assets/vendor/zdog.min.js', 'assets/og/home.png', 'assets/og/mocks.png', 'assets/og/library.png']) {
  if (!fs.existsSync(path.join(SITE, f))) fail('missing site file: ' + f);
}
const home = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
for (const tag of ['gsap.min.js', 'ScrollTrigger.min.js', 'barba.umd.js', 'assets/icons.svg', 'assets/fonts.css', 'data-theme-toggle', 'cuet27:theme', 'application/ld+json', 'og:title', 'rel="canonical"', 'color-scheme" content="dark light']) {
  if (!home.includes(tag)) fail('home missing: ' + tag);
}
/* home hero: countdown, paper stack, annotations, OG + palette wiring */
for (const frag of ['hero-grid', 'hero-art', 'data-countdown', 'data-cd="d"', 'id="paper-stack"', 'annot-u', 'annot-c', 'assets/vendor/zdog.min.js', 'summary_large_image', 'assets/og/home.png']) {
  if (!home.includes(frag)) fail('home missing: ' + frag);
}
if (/\banime\b|animejs/.test(fs.readFileSync(path.join(SITE, 'assets', 'app.js'), 'utf8'))) {
  fail('app.js still references anime.js');
}
try {
  const news = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'news.json'), 'utf8'));
  if (!news.examDate || isNaN(new Date(news.examDate).getTime())) fail('data/news.json: examDate invalid');
} catch (e) {
  fail('data/news.json unreadable: ' + e.message);
}
const appSrc = fs.readFileSync(path.join(SITE, 'assets', 'app.js'), 'utf8');
if (!appSrc.includes('initPaperStack') || !appSrc.includes('initCountdown') || !appSrc.includes('initPalette')) {
  fail('app.js missing Phase 1 modules (paper stack / countdown / palette)');
}
if (!fs.readFileSync(path.join(SITE, 'assets', 'style.css'), 'utf8').includes('.cmdk')) {
  fail('style.css missing command palette styles');
}
/* zdog only on home; every topic page has an existing og card */
for (const p of ['mocks.html', 'library.html']) {
  const html = fs.readFileSync(path.join(SITE, p), 'utf8');
  if (html.includes('zdog.min.js')) fail(p + ' should not load zdog (home-only)');
  if (!html.includes('summary_large_image')) fail(p + ' missing twitter:card summary_large_image');
}
for (const t of fs.readdirSync(path.join(SITE, 'topics'))) {
  const html = fs.readFileSync(path.join(SITE, 'topics', t), 'utf8');
  const og = html.match(/og:image" content="[^"]*?(assets\/og\/[^"]+)"/);
  if (!og) {
    fail('topics/' + t + ': no og:image');
  } else if (!fs.existsSync(path.join(SITE, og[1]))) {
    fail('topics/' + t + ': og:image file missing (' + og[1] + ') — run npm run og');
  }
}

/* ---- 5b. shell pages must not hotlink third-party scripts/styles ---- */
const SHELL = ['index.html', 'mocks.html', 'library.html', '404.html'];
const extTagRe = /<(script|link)\b[^>]*\b(?:src|href)="(https?:\/\/[^"]+)"[^>]*>/g;
for (const p of SHELL) {
  const html = fs.readFileSync(path.join(SITE, p), 'utf8');
  let m;
  while ((m = extTagRe.exec(html))) {
    if (m[0].includes('rel="canonical"')) continue;
    fail(`external asset hotlink in ${p}: ${m[2]}`);
  }
}
/* topic pages get the same treatment for script/link tags */
for (const t of fs.readdirSync(path.join(SITE, 'topics'))) {
  const html = fs.readFileSync(path.join(SITE, 'topics', t), 'utf8');
  let m;
  while ((m = extTagRe.exec(html))) {
    if (m[0].includes('rel="canonical"')) continue;
    fail(`external asset hotlink in topics/${t}: ${m[2]}`);
  }
}
console.log('external asset sweep: done');

/* ---- 5c. byte budgets ---- */
const budget = (rel, maxKB) => {
  const b = fs.statSync(path.join(SITE, rel)).size;
  if (b > maxKB * 1024) warn(`budget: ${rel} is ${(b / 1024).toFixed(0)}KB (budget ${maxKB}KB)`);
  return b;
};
budget('assets/style.css', 60);
budget('assets/app.js', 40);
budget('assets/fonts.css', 8);
let fontBytes = 0;
for (const f of fs.readdirSync(path.join(SITE, 'assets', 'fonts'))) fontBytes += fs.statSync(path.join(SITE, 'assets', 'fonts', f)).size;
if (fontBytes > 700 * 1024) warn(`budget: fonts total ${(fontBytes / 1024).toFixed(0)}KB (budget 700KB)`);
console.log(`budgets: css ${(fs.statSync(path.join(SITE, 'assets', 'style.css')).size / 1024).toFixed(0)}KB, app.js ${(fs.statSync(path.join(SITE, 'assets', 'app.js')).size / 1024).toFixed(0)}KB, fonts ${(fontBytes / 1024).toFixed(0)}KB`);
/* barba shell: every page needs wrapper + namespaced container */
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const rel = path.relative(SITE, page);
  if (!html.includes('data-barba="wrapper"')) fail('no barba wrapper: ' + rel);
  const ns = html.match(/data-barba="container" data-barba-namespace="([^"]+)"/);
  if (!ns) fail('no namespaced barba container: ' + rel);
}
try {
  execSync('node --check ' + path.join(SITE, 'assets', 'app.js'), { stdio: 'pipe' });
  console.log('app.js: syntax OK');
} catch {
  fail('app.js syntax error');
}

/* ---- report ---- */
console.log(`\nwarnings: ${warnings.length}`);
warnings.slice(0, 25).forEach((w) => console.log('  ~ ' + w));
if (warnings.length > 25) console.log(`  ~ ... and ${warnings.length - 25} more`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  failures.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
console.log('\nVALIDATE: PASS');
