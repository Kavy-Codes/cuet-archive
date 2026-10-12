/* CUET Archive — site + mock validator.
 * Checks: internal links, asset refs, search targets, mock question
 * integrity (options/correct answers), leftover brand URLs, JS syntax.
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
for (const f of ['index.html', 'mocks.html', 'library.html', 'search.json', 'mocks.json', 'sitemap.xml', 'robots.txt', '.nojekyll', 'assets/style.css', 'assets/app.js', 'assets/logo.svg']) {
  if (!fs.existsSync(path.join(SITE, f))) fail('missing site file: ' + f);
}
const home = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
for (const tag of ['gsap.min.js', 'ScrollTrigger.min.js', 'anime.min.js', 'application/ld+json', 'og:title', 'rel="canonical"']) {
  if (!home.includes(tag)) fail('home missing: ' + tag);
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
