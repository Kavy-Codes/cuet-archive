/* CUET '27 Archive — front-end engine.
 * Vanilla core (search, lab filters, counters, copy, reveals) always runs.
 * GSAP + ScrollTrigger + Barba are progressive enhancement only.
 */
(function () {
  'use strict';
  const BASE = window.__BASE__ || '';
  const reducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  /* per-page cleanups (observers etc.) — run on every Barba leave */
  const cleanups = [];
  const onTeardown = (fn) => cleanups.push(fn);
  function teardownPage() {
    cleanups.splice(0).forEach((fn) => {
      try { fn(); } catch (e) {}
    });
    if (window.ScrollTrigger) {
      try { window.ScrollTrigger.getAll().forEach((t) => t.kill()); } catch (e) {}
    }
    if (window.gsap) {
      try { window.gsap.killTweensOf('*'); } catch (e) {}
    }
  }
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  /* ---------------- search ---------------- */
  let INDEX = null;
  let loading = null;
  function loadIndex() {
    if (INDEX) return Promise.resolve(INDEX);
    if (loading) return loading;
    loading = fetch(BASE + 'search.json')
      .then((r) => r.json())
      .then((d) => (INDEX = d))
      .catch(() => (INDEX = []));
    return loading;
  }
  function score(e, q) {
    const t = String(e.t || '').toLowerCase();
    const topic = String(e.tp || '').toLowerCase();
    const d = String(e.d || '').toLowerCase();
    const dm = String(e.dm || '').toLowerCase();
    if (t === q) return 100;
    if (t.startsWith(q)) return 82;
    if (topic.startsWith(q)) return 72;
    if (t.includes(q)) return 62;
    if (topic.includes(q)) return 52;
    if (dm.includes(q)) return 42;
    if (d.includes(q)) return 32;
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => (t + ' ' + topic + ' ' + d).includes(w))) return 22;
    return 0;
  }
  function doSearch(q, limit) {
    if (!INDEX) return [];
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    return INDEX.map((e) => ({ e, s: score(e, query) }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit || 30)
      .map((h) => h.e);
  }
  function entryUrl(e) {
    if (e.k === 'topic') return BASE + 'topics/' + e.ts + '.html';
    if (e.lu) return BASE + e.lu;
    return e.u;
  }
  function mark(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return safe;
    return safe.slice(0, i) + '<mark>' + safe.slice(i, i + q.length) + '</mark>' + safe.slice(i + q.length);
  }
  function paint(box, items, q) {
    if (!q.trim()) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    if (!items.length) {
      box.innerHTML = '<div class="empty">Nothing found for &ldquo;' + esc(q) + '&rdquo; — try &ldquo;mock&rdquo;, &ldquo;GAT&rdquo; or &ldquo;books&rdquo;.</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = items
      .map((e) => {
        const sub =
          e.k === 'topic'
            ? '<span class="r-kind">Topic</span> &middot; ' + e.n + ' resources'
            : '<span class="r-kind">' + esc(e.dm || 'link') + '</span> &middot; ' + esc(e.tp);
        // mock papers are standalone apps — always open in a new tab, never Barba-swap
        const newtab = e.k !== 'topic';
        const external = newtab;
        return (
          '<a class="result" href="' +
          esc(entryUrl(e)) +
          '"' +
          (newtab ? ' target="_blank" rel="noopener"' : '') +
          '><div class="r-title">' +
          mark(e.t, q) +
          '</div><div class="r-sub">' +
          sub +
          '</div></a>'
        );
      })
      .join('');
    box.hidden = false;
  }
  function bindSearch(input) {
    if (input.dataset.bound) return;
    input.dataset.bound = '1';
    const box = input.parentElement.querySelector('.results');
    if (!box) return;
    let timer = null;
    let active = -1;
    const run = () => {
      const q = input.value;
      loadIndex().then(() => {
        paint(box, doSearch(q), q);
        active = -1;
      });
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 90);
    });
    input.addEventListener('focus', loadIndex);
    input.addEventListener('keydown', (ev) => {
      const items = $$('.result', box);
      if (ev.key === 'Escape') {
        box.hidden = true;
        input.blur();
        return;
      }
      if (!items.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        active += ev.key === 'ArrowDown' ? 1 : -1;
        if (active < 0) active = items.length - 1;
        if (active >= items.length) active = 0;
        items.forEach((el, i) => el.classList.toggle('active', i === active));
        items[active].scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Enter') {
        const t = items[active >= 0 ? active : 0];
        if (t) {
          ev.preventDefault();
          window.location.href = t.getAttribute('href');
        }
      }
    });
    document.addEventListener('click', (ev) => {
      if (!input.parentElement.contains(ev.target)) box.hidden = true;
    });
  }

  /* ---------------- mock lab ---------------- */
  function initLab() {
    const grid = $('#mock-grid');
    if (!grid) return;
    const cards = $$('.mock-card', grid);
    const empty = $('#lab-empty');
    const count = $('#lab-count');
    const search = $('#lab-search');
    const chips = $$('.fchip[data-f]');
    const sort = $('#lab-sort');
    let subject = 'all';
    const norm = (s) => String(s || '').toLowerCase();
    function apply() {
      const q = norm(search && search.value).trim();
      let shown = 0;
      cards.forEach((c) => {
        const okSub = subject === 'all' || c.dataset.subject === subject;
        const hay = norm(c.dataset.title + ' ' + c.dataset.subject + ' ' + c.dataset.engine);
        const okQ = !q || q.split(/\s+/).every((w) => hay.includes(w));
        const show = okSub && okQ;
        c.hidden = !show;
        if (show) shown++;
      });
      if (empty) empty.hidden = shown !== 0;
      if (count) count.textContent = shown + ' / ' + cards.length + ' papers';
    }
    function order() {
      if (!sort) return;
      const list = cards.slice();
      if (sort.value === 'az') list.sort((a, b) => norm(a.dataset.title).localeCompare(norm(b.dataset.title)));
      else if (sort.value === 'qs') list.sort((a, b) => (+b.dataset.qs || 0) - (+a.dataset.qs || 0));
      else list.sort((a, b) => (+a.dataset.order || 0) - (+b.dataset.order || 0));
      list.forEach((c) => grid.appendChild(c));
    }
    chips.forEach((ch) =>
      ch.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('on'));
        ch.classList.add('on');
        subject = ch.dataset.f;
        apply();
      })
    );
    if (search) {
      let t = null;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(apply, 80);
      });
    }
    if (sort) sort.addEventListener('change', order);
    const dice = $('#lab-random');
    if (dice) {
      const label = $('.lab-random-label', dice) || dice;
      dice.addEventListener('click', () => {
        const pool = cards.filter((c) => !c.hidden);
        if (!pool.length) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        label.textContent = (pick.dataset.title || 'paper').split(' ').slice(0, 3).join(' ') + '…';
        setTimeout(() => {
          window.open(pick.getAttribute('href'), '_blank', 'noopener');
          label.textContent = 'Surprise me';
        }, 450);
      });
    }
    apply();
  }

  /* ---------------- counters ---------------- */
  function initCounters() {
    const els = $$('[data-countup]');
    if (!els.length) return;
    const set = (el) => {
      el.textContent = (+el.dataset.countup || 0).toLocaleString('en-IN');
    };
    if (reducedMotion || !('IntersectionObserver' in window)) {
      els.forEach(set);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          io.unobserve(el);
          const target = +el.dataset.countup || 0;
          const t0 = performance.now();
          const dur = 1100;
          const tick = (t) => {
            const p = Math.min(1, (t - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(target * eased).toLocaleString('en-IN');
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.4 }
    );
    els.forEach((el) => io.observe(el));
    onTeardown(() => io.disconnect());
  }

  /* ---------------- copy buttons ---------------- */
  function initCopy() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-copy]');
      if (!btn) return;
      ev.preventDefault();
      let url = btn.getAttribute('data-copy');
      if (url && !/^[a-z]+:/i.test(url)) {
        try {
          url = new URL(url, location.href).href;
        } catch (e) {}
      }
      const done = () => {
        const old = btn.textContent;
        btn.textContent = 'Copied ✓';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = old;
          btn.classList.remove('copied');
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
      else {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  }

  /* ---------------- card cursor glow (fine pointers only) ---------------- */
  function initGlow() {
    if (reducedMotion) return;
    if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return;
    $$('.topic-card, .stream-card').forEach((card) => {
      card.addEventListener('pointermove', (ev) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ev.clientX - r.left + 'px');
        card.style.setProperty('--my', ev.clientY - r.top + 'px');
      });
    });
  }

  /* ---------------- dates ---------------- */
  function initDates() {
    $$('[data-iso]').forEach((el) => {
      if (!el.dataset.iso) return;
      const d = new Date(el.dataset.iso);
      if (isNaN(d)) return;
      el.textContent = d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    });
  }

  /* ---------------- theme toggle (dark default, paper light) ---------------- */
  const THEME_KEY = 'cuet27:theme';
  function initTheme() {
    const btn = $('[data-theme-toggle]');
    const meta = document.querySelector('meta[name="theme-color"]');
    const current = () =>
      document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const apply = (mode) => {
      if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      if (meta) meta.setAttribute('content', mode === 'light' ? '#F8F3E7' : '#0B0E14');
      if (btn) btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
    };
    apply(current());
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = current() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      apply(next);
    });
  }

  /* ---------------- back to top (all viewports — long library pages) ---------------- */
  function initToTop() {
    const btn = document.createElement('button');
    btn.className = 'to-top';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="' + (window.__BASE__ || '') + 'assets/icons.svg#i-arrow-up"></use></svg>';
    document.body.appendChild(btn);
    let ticking = false;
    const sync = () => {
      ticking = false;
      btn.classList.toggle('show', window.scrollY > 700);
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(sync);
      }
    }, { passive: true });
    sync();
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  }

  /* ---------------- motion: GSAP + Anime, guarded ---------------- */
  function initMotion(simple) {
    const targets = $$('.reveal');
    targets.forEach((el) => el.classList.add('reveal'));
    if (reducedMotion) {
      document.documentElement.classList.add('no-motion');
      targets.forEach((el) => el.classList.add('in'));
      return;
    }
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    const rise = isMobile ? 16 : 30;
    const dur = isMobile ? 0.5 : 0.75;
    // Path 1 — GSAP + ScrollTrigger (skipped for Barba enters: curtain owns the motion)
    if (!simple && window.gsap && window.ScrollTrigger) {
      try {
        gsap.registerPlugin(ScrollTrigger);
        if (window.ScrollTrigger.config) ScrollTrigger.config({ ignoreMobileResize: true });
        gsap.fromTo(
          '.hero-copy > *',
          { y: isMobile ? 18 : 34, opacity: 0 },
          { y: 0, opacity: 1, duration: isMobile ? 0.6 : 0.9, stagger: isMobile ? 0.05 : 0.09, ease: 'power3.out', delay: 0.05, overwrite: 'auto' }
        );
        gsap.fromTo(
          '.hero-art',
          { y: isMobile ? 16 : 28, opacity: 0 },
          { y: 0, opacity: 1, duration: isMobile ? 0.6 : 0.9, ease: 'power3.out', delay: 0.24, overwrite: 'auto' }
        );
        gsap.fromTo(
          '.hero .stats',
          { y: rise, opacity: 0 },
          { y: 0, opacity: 1, duration: dur, ease: 'power3.out', delay: 0.34, overwrite: 'auto' }
        );
        $$('.reveal').forEach((el) => {
          if (el.closest('.hero')) {
            el.classList.add('in');
            return;
          }
          gsap.fromTo(
            el,
            { y: rise, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: dur,
              ease: 'power3.out',
              overwrite: 'auto',
              scrollTrigger: { trigger: el, start: 'top 92%', once: true },
              onComplete: () => el.classList.add('in'),
            }
          );
        });
      } catch (e) {
        fallbackReveal(targets);
      }
    } else {
      fallbackReveal(targets);
    }
  }
  function fallbackReveal(targets) {
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.04 }
    );
    targets.forEach((el) => io.observe(el));
    onTeardown(() => io.disconnect());
    setTimeout(() => targets.forEach((el) => el.classList.add('in')), 3000);
  }

  /* ---------------- hero: Zdog paper stack (drag to spin, inertia) ---------------- */
  function initPaperStack() {
    const canvas = $('#paper-stack');
    if (!canvas || !window.Zdog) return;
    const Zdog = window.Zdog;
    const fine = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
    const draggable = fine && !reducedMotion;
    const amber = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim() || '#e9a13b';
    const illo = new Zdog.Illustration({
      element: canvas,
      zoom: 2.3,
      resize: true,
      dragRotate: draggable,
    });
    /* Zdog 1.1.3 quirk: `fill` is a boolean — the shape fills with `color`.
     * Layered shapes (fill + outline) fake a fill/stroke split. */
    const PAGE_W = 76;
    const PAGE_H = 100;
    const edge = 'rgba(59, 44, 16, 0.5)';
    const sway = [];
    const swayBase = [];
    for (let i = 0; i < 8; i++) {
      const z = 22 - i * 3.2;
      const x = ((i % 3) - 1) * 1.6;
      const y = (i % 2 ? 1.4 : -1.4);
      const rot = (i % 2 ? 1 : -1) * (0.012 + i * 0.006);
      const fill = new Zdog.RoundedRect({
        addTo: illo,
        width: PAGE_W,
        height: PAGE_H,
        cornerRadius: 5,
        fill: true,
        color: i % 2 ? '#ece1c8' : '#f7f0df',
        stroke: 0,
        translate: { z, x, y },
        rotate: { z: rot },
      });
      const outline = new Zdog.RoundedRect({
        addTo: illo,
        width: PAGE_W,
        height: PAGE_H,
        cornerRadius: 5,
        fill: false,
        stroke: 1.2,
        color: edge,
        translate: { z: z + 0.35, x, y },
        rotate: { z: rot },
      });
      sway.push(fill, outline);
      swayBase.push(rot, rot);
    }
    const ink = 'rgba(38, 28, 10, 0.6)';
    [[-8, -34, 46], [-8, -26, 52], [-8, -18, 34], [-16, -10, 44]].forEach(([x, y, w]) => {
      new Zdog.RoundedRect({
        addTo: illo,
        width: w,
        height: 2.6,
        cornerRadius: 1.3,
        fill: true,
        color: ink,
        stroke: 0,
        translate: { x, y, z: 22.9 },
      });
    });
    new Zdog.Ellipse({ addTo: illo, diameter: 15, fill: true, color: amber, stroke: 0, translate: { x: 22, y: 32, z: 22.9 } });
    new Zdog.Ellipse({ addTo: illo, diameter: 7, fill: true, color: ink, stroke: 0, translate: { x: 22, y: 32, z: 23.1 } });
    new Zdog.RoundedRect({
      addTo: illo,
      width: 36,
      height: 32,
      cornerRadius: 3,
      fill: true,
      color: '#f0bd63',
      stroke: 0,
      translate: { x: -32, y: -40, z: 24.4 },
      rotate: { z: -0.14 },
    });
    new Zdog.RoundedRect({
      addTo: illo,
      width: 36,
      height: 32,
      cornerRadius: 3,
      fill: false,
      stroke: 1,
      color: 'rgba(70, 46, 4, 0.3)',
      translate: { x: -32, y: -40, z: 24.8 },
      rotate: { z: -0.14 },
    });
    new Zdog.RoundedRect({
      addTo: illo,
      width: 10,
      height: 44,
      cornerRadius: 3,
      fill: true,
      color: '#d96d97',
      stroke: 0,
      translate: { x: 24, y: -58, z: 20 },
      rotate: { z: 0.08 },
    });
    illo.translate.y = -18;
    illo.rotate.x = -0.3;
    illo.rotate.y = 0.26;
    if (reducedMotion) {
      illo.updateRenderGraph();
      return;
    }
    const stage = canvas.closest('.stack-stage') || canvas.parentElement;
    const spin = 0.25;
    let dragging = false;
    let vel = 0;
    let raf = 0;
    let lastY = illo.rotate.y;
    let lastT = 0;
    const frame = (now) => {
      const t = now / 1000;
      const dt = Math.min(Math.max(t - lastT, 0.001), 0.05);
      lastT = t;
      const dY = illo.rotate.y - lastY;
      lastY = illo.rotate.y;
      if (dragging) {
        vel = Math.max(-6, Math.min(6, dY / dt));
      } else if (Math.abs(vel) > 0.04) {
        illo.rotate.y += vel * dt;
        vel *= Math.pow(0.12, dt);
      } else {
        vel = 0;
        illo.rotate.y += spin * dt;
      }
      for (let i = 0; i < sway.length; i++) {
        sway[i].rotate.z = swayBase[i] + Math.sin(t * 0.7 + (i >> 1) * 0.55) * 0.01;
      }
      illo.translate.y = -18 + Math.sin(t * 0.85) * 3;
      illo.updateRenderGraph();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf) return;
      lastY = illo.rotate.y;
      lastT = performance.now() / 1000;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const endDrag = () => { dragging = false; };
    canvas.addEventListener('pointerdown', () => { dragging = true; vel = 0; });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    if ('IntersectionObserver' in window && stage) {
      const io = new IntersectionObserver(([en]) => (en.isIntersecting ? start() : stop()), { threshold: 0.05 });
      io.observe(stage);
      onTeardown(() => io.disconnect());
    } else {
      start();
    }
    onTeardown(() => {
      stop();
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.removeEventListener('visibilitychange', onVis);
    });
  }

  /* ---------------- hero: countdown to the exam date ---------------- */
  function initCountdown() {
    const box = $('[data-countdown]');
    if (!box) return;
    const target = new Date(box.getAttribute('data-countdown')).getTime();
    const cells = {
      d: $('[data-cd="d"]', box),
      h: $('[data-cd="h"]', box),
      m: $('[data-cd="m"]', box),
      s: $('[data-cd="s"]', box),
    };
    if (!target || !cells.d) return;
    const pad = (n) => String(n).padStart(2, '0');
    let id = 0;
    const tick = () => {
      const t = target - Date.now();
      if (t <= 0) {
        box.classList.add('is-done');
        clearInterval(id);
        cells.d.textContent = '0';
        cells.h.textContent = '00';
        cells.m.textContent = '00';
        cells.s.textContent = '00';
        return;
      }
      cells.d.textContent = String(Math.floor(t / 86400000));
      cells.h.textContent = pad(Math.floor((t % 86400000) / 3600000));
      cells.m.textContent = pad(Math.floor((t % 3600000) / 60000));
      cells.s.textContent = pad(Math.floor((t % 60000) / 1000));
    };
    tick();
    id = setInterval(tick, 1000);
    onTeardown(() => clearInterval(id));
  }

  /* ---------------- command palette (⌘K / Ctrl+K) ---------------- */
  function initPalette() {
    const svgIco = (name) =>
      '<svg class="ico" aria-hidden="true"><use href="' + BASE + 'assets/icons.svg#i-' + name + '"></use></svg>';
    let overlay = null;
    let input = null;
    let list = null;
    let defs = [];
    let active = 0;
    const actions = [
      { icon: 'home', title: 'Home', sub: 'Front page of the archive', href: BASE + 'index.html' },
      { icon: 'bolt', title: 'Mock Lab', sub: 'Every in-browser paper, one page', href: BASE + 'mocks.html' },
      { icon: 'archive', title: 'Library', sub: 'Books, notes, lectures and links', href: BASE + 'library.html' },
      { icon: 'sun', title: 'Toggle light / dark', sub: 'Flip between ink and paper', run: () => { const b = $('[data-theme-toggle]'); if (b) b.click(); } },
    ];
    const invite = document.body.getAttribute('data-invite');
    if (invite) actions.push({ icon: 'chat', title: 'Join the Discord', sub: 'The community behind the archive', href: invite, blank: true });
    const markup = (o, i) => {
      defs.push(o);
      const inner =
        '<span class="ci-ico">' + svgIco(o.icon || 'link') + '</span>' +
        '<span class="ci-main"><span class="ci-title">' + o.titleHtml + '</span><span class="ci-sub">' + o.sub + '</span></span>' +
        (o.kind ? '<span class="ci-kind">' + o.kind + '</span>' : '');
      return o.href
        ? '<a class="cmdk-item" data-idx="' + i + '" role="option" href="' + esc(o.href) + '"' + (o.blank ? ' target="_blank" rel="noopener"' : '') + '>' + inner + '</a>'
        : '<button type="button" class="cmdk-item" data-idx="' + i + '" role="option">' + inner + '</button>';
    };
    const setActive = (i) => {
      active = i;
      defs.forEach((d, k) => {
        if (!d.el) return;
        d.el.classList.toggle('active', k === i);
        if (k === i) d.el.setAttribute('aria-selected', 'true');
        else d.el.removeAttribute('aria-selected');
      });
      if (defs[i] && defs[i].el) defs[i].el.scrollIntoView({ block: 'nearest' });
    };
    const render = () => {
      const q = (input.value || '').trim();
      const ql = q.toLowerCase();
      const acts = actions.filter((a) => !ql || (a.title + ' ' + a.sub).toLowerCase().includes(ql));
      const res = ql.length >= 2 ? doSearch(q, 6) : [];
      defs = [];
      let html = '';
      if (acts.length) {
        html += '<div class="cmdk-group">Actions</div>';
        html += acts
          .map((a) => {
            const o = { icon: a.icon, titleHtml: esc(a.title), sub: esc(a.sub), href: a.href, blank: a.blank, run: a.run };
            o.kind = a.href && a.run === undefined && !a.blank ? 'Go' : a.blank ? 'Discord' : 'Action';
            return markup(o, defs.length);
          })
          .join('');
      }
      if (res.length) {
        html += '<div class="cmdk-group">Results</div>';
        html += res
          .map((e) => {
            const kind = e.k === 'topic' ? 'Topic' : e.lu ? 'Mock' : 'Link';
            const sub = e.k === 'topic' ? e.n + ' resources · ' + e.tp : (e.dm || 'link') + ' · ' + e.tp;
            return markup({ icon: e.k === 'topic' ? 'archive' : 'bolt', titleHtml: mark(e.t, q), sub: esc(sub), kind, href: entryUrl(e), blank: e.k !== 'topic' }, defs.length);
          })
          .join('');
      }
      if (!html) html = '<div class="cmdk-empty">No matches for &ldquo;' + esc(q) + '&rdquo; — try &ldquo;mock&rdquo;, &ldquo;GAT&rdquo; or &ldquo;books&rdquo;.</div>';
      list.innerHTML = html;
      $$('.cmdk-item', list).forEach((el) => {
        const d = defs[+el.getAttribute('data-idx')];
        if (d) d.el = el;
      });
      if (defs.length) setActive(0);
    };
    const open = () => {
      if (!overlay) build();
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      input.value = '';
      render();
      loadIndex().then(() => {
        if (!overlay.hidden && input.value.trim().length >= 2) render();
      });
      requestAnimationFrame(() => input.focus());
    };
    const close = () => {
      if (!overlay || overlay.hidden) return;
      overlay.hidden = true;
      document.body.style.overflow = '';
    };
    const build = () => {
      overlay = document.createElement('div');
      overlay.className = 'cmdk';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<div class="cmdk-head">' + svgIco('command') +
        '<input type="text" placeholder="Search resources or type a command…" aria-label="Command palette search" autocomplete="off" spellcheck="false">' +
        '<kbd>esc</kbd></div>' +
        '<div class="cmdk-list" role="listbox" aria-label="Commands and results"></div>' +
        '<div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span class="kb-hint cf-right">Type to search topics, mocks and links</span></div>' +
        '</div>';
      document.body.appendChild(overlay);
      input = $('.cmdk-head input', overlay);
      list = $('.cmdk-list', overlay);
      overlay.addEventListener('pointerdown', (ev) => {
        if (ev.target === overlay) close();
      });
      input.addEventListener('input', render);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          close();
        } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          if (defs.length) setActive((active + (ev.key === 'ArrowDown' ? 1 : -1) + defs.length) % defs.length);
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          const el = defs[active] && defs[active].el;
          if (el) el.click();
        } else if (ev.key === 'Tab') {
          ev.preventDefault();
          input.focus();
        }
      });
      list.addEventListener('click', (ev) => {
        const el = ev.target.closest('.cmdk-item');
        if (!el) return;
        if (el.tagName === 'BUTTON') {
          ev.preventDefault();
          const d = defs[+el.getAttribute('data-idx')];
          if (d && d.run) d.run();
          close();
        } else {
          close();
        }
      });
    };
    document.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'k' || ev.key === 'K')) {
        ev.preventDefault();
        overlay && !overlay.hidden ? close() : open();
      } else if (ev.key === 'Escape' && overlay && !overlay.hidden) {
        close();
      }
    });
  }

  /* ---------------- per-page boot (runs on load + every Barba enter) ---------------- */
  function bootPage(simple) {
    $$('.search-input').forEach(bindSearch);
    initLab();
    initCounters();
    initGlow();
    initDates();
    initPaperStack();
    initCountdown();
    initMotion(!!simple);
    $$('img.favicon').forEach((img) => {
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.className = 'favicon';
        span.innerHTML = '<svg class="ico ico-lg" aria-hidden="true"><use href="' + (window.__BASE__ || '') + 'assets/icons.svg#i-link"></use></svg>';
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      });
    });
  }

  /* ---------------- nav highlight sync (tabbar + topbar live outside Barba) ---------------- */
  function syncNav() {
    const container = document.querySelector('[data-barba="container"]');
    const ns = container ? container.getAttribute('data-barba-namespace') : document.body.getAttribute('data-nav');
    const page = { home: 'index.html', mocks: 'mocks.html', library: 'library.html' }[ns] || '';
    document.body.setAttribute('data-nav', ns || '');
    $$('.tabbar a, .nav-links a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const on = !!page && href.endsWith(page);
      a.classList.toggle('current', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ---------------- Barba page transitions (progressive enhancement) ---------------- */
  function barbaOK() {
    return !!(window.barba && window.gsap) && !reducedMotion;
  }
  function internalLink(a) {
    if (!a || a.target === '_blank') return false;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return false;
    if (href.includes('/mocks/') || href.endsWith('.html') && href.includes('mocks/')) return false;
    if (/^(mailto:|tel:|javascript:)/.test(href)) return false;
    if (/^https?:/.test(href)) {
      try {
        if (new URL(href, location.href).origin !== location.origin) return false;
      } catch (e) {
        return false;
      }
    }
    return true;
  }
  /* hover-prefetch: warm the HTTP cache so Barba swaps feel instant */
  function initPrefetch() {
    let last = 0;
    const warm = (a) => {
      if (!internalLink(a)) return;
      const now = Date.now();
      if (now - last < 150) return;
      last = now;
      try {
        fetch(a.href, { mode: 'same-origin', credentials: 'same-origin' }).catch(() => {});
      } catch (e) {}
    };
    document.addEventListener('mouseover', (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (a) warm(a);
    }, { passive: true });
    document.addEventListener('focusin', (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (a) warm(a);
    }, { passive: true });
  }
  function veil() {
    let v = $('.page-veil');
    if (v) return v;
    v = document.createElement('div');
    v.className = 'page-veil';
    v.setAttribute('aria-hidden', 'true');
    const base = window.__BASE__ || '';
    v.innerHTML =
      '<div class="veil-inner"><img src="' + base + 'assets/logo.svg" alt=""><span>CUET <em>\'27</em></span></div>';
    document.body.appendChild(v);
    return v;
  }
  function initBarba() {
    if (!barbaOK()) return;
    const mobile = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    const D = mobile ? 0.38 : 0.5;
    let busy = false;
    let watchdog = null;
    /* promise that ALWAYS resolves — a stuck tween can never strand the veil */
    const tweenTo = (targets, vars) =>
      new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        const timer = setTimeout(finish, (vars.duration || 0.5) * 1000 + 1500);
        try {
          gsap.to(targets, {
            ...vars,
            onComplete: () => {
              clearTimeout(timer);
              finish();
            },
            onInterrupt: () => {
              clearTimeout(timer);
              finish();
            },
          });
        } catch (e) {
          clearTimeout(timer);
          finish();
        }
      });
    const hideVeilNow = () => {
      const v = $('.page-veil');
      if (!v) return;
      try {
        gsap.killTweensOf(v);
        gsap.set(v, { yPercent: 101 });
      } catch (e) {
        v.style.transform = 'translateY(101%)';
      }
    };
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        // last-resort recovery: never leave the user staring at the curtain
        hideVeilNow();
        busy = false;
        const c = document.querySelector('[data-barba="container"]');
        if (c) {
          try {
            gsap.set(c, { opacity: 1, y: 0 });
          } catch (e) {
            c.style.opacity = '1';
            c.style.transform = 'none';
          }
        }
      }, 3500);
    };
    try {
      window.barba.init({
        timeout: 4000,
        prevent: ({ el }) => {
          if (busy) return true; // ignore taps while a transition is in flight
          return !internalLink(el);
        },
        transitions: [
          {
            name: 'curtain',
            async leave() {
              busy = true;
              armWatchdog();
              teardownPage();
              const v = veil();
              try {
                gsap.set(v, { yPercent: 101 });
              } catch (e) {}
              await tweenTo(v, { yPercent: 0, duration: D, ease: 'power4.inOut' });
            },
            async beforeEnter(data) {
              try {
                const m = String(data.next.html || '').match(/<title>([\s\S]*?)<\/title>/i);
                if (m) {
                  const ta = document.createElement('textarea');
                  ta.innerHTML = m[1];
                  document.title = ta.value;
                }
              } catch (e) {}
              try {
                bootPage(true);
              } catch (e) {}
            },
            async enter(data) {
              try {
                const v = veil();
                const hash = data.next.url && data.next.url.hash ? data.next.url.hash.slice(1) : '';
                const container = data.next.container;
                try {
                  gsap.set(container, { opacity: 0, y: mobile ? 16 : 26 });
                } catch (e) {}
                if (!hash) window.scrollTo(0, 0);
                await Promise.all([
                  tweenTo(v, { yPercent: -101, duration: D + 0.1, ease: 'power4.inOut', delay: 0.05 }),
                  tweenTo(container, { opacity: 1, y: 0, duration: D + 0.15, ease: 'power3.out', delay: 0.12 }),
                ]);
                if (hash) {
                  const t = document.getElementById(hash);
                  if (t) t.scrollIntoView({ behavior: 'auto' });
                }
              } catch (e) {
                hideVeilNow();
              }
            },
            after() {
              clearTimeout(watchdog);
              busy = false;
              hideVeilNow();
              try { syncNav(); } catch (e) {}
              if (window.ScrollTrigger) {
                try { window.ScrollTrigger.refresh(); } catch (e) {}
              }
            },
          },
        ],
      });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    // global-once bindings (document-delegated — survive Barba swaps)
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const box = $('.hero-search .search-input') || $('.search-input');
      if (box) {
        ev.preventDefault();
        box.focus();
        box.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    });
    initTheme();
    initCopy();
    initToTop();
    initPalette();
    bootPage(false);
    initPrefetch();
    initBarba();
  });
})();
