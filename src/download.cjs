const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');

const MOCK_DIR = path.join(cfg.SITE_DIR, 'mocks');
const CONCURRENCY = 6;

function htmlAttachments(data) {
  const out = [];
  const seen = new Set();
  for (const t of data.topics) {
    for (const m of t.messages || []) {
      for (const b of m.blocks || []) {
        if (b.type !== 'attachment') continue;
        if (!(b.contentType || '').includes('html')) continue;
        if (!b.attId || seen.has(b.attId)) continue;
        seen.add(b.attId);
        out.push({ attId: b.attId, filename: b.filename || b.attId + '.html', url: b.url, size: b.size || 0 });
      }
    }
  }
  return out;
}

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'file.html';
}

async function fetchOne(item) {
  const dir = path.join(MOCK_DIR, item.attId);
  const target = path.join(dir, safeName(item.filename));
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return { status: 'skip', item, target };

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(item.url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 64) throw new Error('suspiciously small response');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, buf);
      return { status: 'ok', item, target, bytes: buf.length };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return { status: 'fail', item, error: lastErr ? lastErr.message : 'unknown' };
}

async function downloadMocks() {
  if (!fs.existsSync(cfg.DATA_FILE)) {
    throw new Error('data/resources.json not found — run extraction first');
  }
  const data = JSON.parse(fs.readFileSync(cfg.DATA_FILE, 'utf8'));
  const items = htmlAttachments(data);
  fs.mkdirSync(MOCK_DIR, { recursive: true });

  let ok = 0,
    skip = 0,
    fail = 0,
    bytes = 0;
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const r = await fetchOne(items[i]);
      if (r.status === 'ok') {
        ok++;
        bytes += r.bytes;
        console.log(`  [${ok + skip}/${items.length}] downloaded ${r.item.attId}/${r.item.filename} (${(r.bytes / 1024).toFixed(0)} KB)`);
      } else if (r.status === 'skip') {
        skip++;
      } else {
        fail++;
        console.log(`  [${ok + skip}/${items.length}] FAILED ${r.item.filename}: ${r.error}`);
      }
    }
  });
  await Promise.all(workers);

  console.log(`\nMocks: ${ok} downloaded, ${skip} already present, ${fail} failed, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  return { total: items.length, ok, skip, fail };
}

if (require.main === module) {
  downloadMocks().catch((e) => {
    console.error('DOWNLOAD FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { downloadMocks };
