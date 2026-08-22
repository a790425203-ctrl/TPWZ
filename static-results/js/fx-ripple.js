'use strict';
/* 全局交互特效 v8
   1) 艺术化高对比光标
   2) 精致小涟漪
   3) 主题流动背景：galaxy=科技星云网格 / landscape=真实极光山峦
   4) 背景氛围音乐生成（轻柔钢琴式氛围乐，无版权）
   挂载到 window.FX。 */

(function () {
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  /* ---------------- 艺术化光标 ---------------- */
  function initCursor() {
    if (reduceMotion || isTouch) return;
    const dot = document.createElement('div');
    dot.className = 'fx-cursor';
    const ring = document.createElement('div');
    ring.className = 'fx-cursor-ring';
    document.body.appendChild(dot);
    document.body.appendChild(ring);
    document.body.classList.add('has-fx-cursor');

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;
    let raf = null;

    function loop() {
      dot.style.transform = 'translate(' + mx + 'px,' + my + 'px) translate(-50%,-50%)';
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px) translate(-50%,-50%)';
      raf = requestAnimationFrame(loop);
    }

    window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; dot.style.opacity = '1'; ring.style.opacity = '1'; }, { passive: true });
    document.addEventListener('mouseleave', () => { dot.style.opacity = '0'; ring.style.opacity = '0'; });

    const interactiveSel = 'button, a, input, .check-item, .theme-card, .results-block, .rank-card, .ledger-row, label, .music-toggle';
    document.addEventListener('mouseover', (e) => { if (e.target.closest(interactiveSel)) ring.classList.add('fx-cursor-ring--active'); });
    document.addEventListener('mouseout', (e) => { if (e.target.closest(interactiveSel)) ring.classList.remove('fx-cursor-ring--active'); });
    document.addEventListener('mousedown', () => ring.classList.add('fx-cursor-ring--down'));
    document.addEventListener('mouseup', () => ring.classList.remove('fx-cursor-ring--down'));

    loop();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = null; }
      else if (!raf) loop();
    });
  }

  /* ---------------- 点击涟漪（小幅） ---------------- */
  function initRipple() {
    if (reduceMotion) return;
    const layer = document.createElement('div');
    layer.className = 'fx-ripple-layer';
    document.body.appendChild(layer);

    document.addEventListener('click', (e) => {
      const t = e.target;
      const interactive = t.closest('button, a, .check-item, .theme-card, .results-block, .rank-card, .ledger-row');
      if (!interactive) return;
      const r = interactive.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const span = document.createElement('span');
      span.className = 'fx-ripple';
      span.style.left = x + 'px';
      span.style.top = y + 'px';
      span.style.width = span.style.height = '90px';
      interactive.appendChild(span);
      setTimeout(() => span.remove(), 550);
    }, { passive: true });
  }

  /* ---------------- 工具 ---------------- */
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------------- 主题流动背景 ---------------- */
  function spawnFluid(container, kind) {
    if (reduceMotion) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-fluid';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = null, t0 = performance.now();

    function resize() {
      const rect = container.getBoundingClientRect();
      w = Math.max(1, rect.width); h = Math.max(1, rect.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* --- Galaxy: 科技星云 --- */
    const stars = Array.from({ length: 120 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.4 + Math.random() * 2.0,
      tw: Math.random() * Math.PI * 2,
      tws: 0.02 + Math.random() * 0.05,
      col: Math.random() > 0.7 ? '#D4A84B' : (Math.random() > 0.45 ? '#8B5CF6' : '#A5B4FC'),
    }));

    const gridPoints = [];
    for (let x = 0; x <= 1; x += 0.10) {
      for (let y = 0; y <= 1; y += 0.10) {
        gridPoints.push({ x, y, ox: x, oy: y, ph: Math.random() * Math.PI * 2 });
      }
    }

    const streamParticles = Array.from({ length: 60 }, () => ({
      arm: Math.floor(Math.random() * 4),
      t: Math.random(),
      speed: 0.0002 + Math.random() * 0.0003,
      rOffset: (Math.random() - 0.5) * 24,
    }));

    const techRings = [
      { r: 0.18, speed: 0.00035, width: 1.2, a: 0.35 },
      { r: 0.30, speed: -0.00028, width: 1.0, a: 0.28 },
      { r: 0.42, speed: 0.00022, width: 0.8, a: 0.22 },
    ];

    function drawGalaxy(time) {
      // 深空底 + 星云
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.9);
      bg.addColorStop(0, 'rgba(35, 25, 80, 0.85)');
      bg.addColorStop(0.35, 'rgba(18, 18, 55, 0.70)');
      bg.addColorStop(0.7, 'rgba(8, 10, 30, 0.55)');
      bg.addColorStop(1, 'rgba(4, 6, 16, 0.45)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

      // 弥散星云
      const nebula = ctx.createRadialGradient(w * 0.35, h * 0.35, 0, w * 0.35, h * 0.35, w * 0.55);
      nebula.addColorStop(0, 'rgba(139, 92, 246, 0.22)');
      nebula.addColorStop(0.5, 'rgba(99, 102, 241, 0.10)');
      nebula.addColorStop(1, 'rgba(139, 92, 246, 0)');
      ctx.fillStyle = nebula; ctx.fillRect(0, 0, w, h);

      const nebula2 = ctx.createRadialGradient(w * 0.72, h * 0.55, 0, w * 0.72, h * 0.55, w * 0.45);
      nebula2.addColorStop(0, 'rgba(26, 163, 158, 0.16)');
      nebula2.addColorStop(0.6, 'rgba(26, 163, 158, 0.06)');
      nebula2.addColorStop(1, 'rgba(26, 163, 158, 0)');
      ctx.fillStyle = nebula2; ctx.fillRect(0, 0, w, h);

      // 透视网格（HUD 感）
      ctx.save();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.22)';
      ctx.lineWidth = 1;
      const horizon = h * 0.74;
      for (let i = 0; i < 12; i++) {
        const y = horizon - (horizon * Math.pow(0.72, i)) * (0.5 + 0.5 * Math.sin(time * 0.00025 + i));
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let i = -10; i <= 10; i++) {
        const x = w * 0.5 + i * w * 0.09;
        ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.42); ctx.lineTo(x, horizon); ctx.stroke();
      }
      ctx.restore();

      // 旋转旋臂（科技星轨）
      const cx = w * 0.5, cy = h * 0.40;
      const spin = time * 0.00014;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      for (let arm = 0; arm < 4; arm++) {
        const base = (arm / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.strokeStyle = hexA(arm % 2 ? '#A78BFA' : '#818CF8', 0.28 + 0.12 * Math.sin(time * 0.0012 + arm));
        ctx.lineWidth = 2.2;
        ctx.shadowColor = arm % 2 ? '#8B5CF6' : '#6366F1';
        ctx.shadowBlur = 10;
        for (let t = 0; t < 1; t += 0.015) {
          const a = base + t * 5.0;
          const r = t * Math.min(w, h) * 0.58;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r * 0.48;
          if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.restore();

      // 旋臂粒子流
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin * 1.05);
      for (const p of streamParticles) {
        p.t += p.speed;
        if (p.t > 1) p.t = 0;
        const base = (p.arm / 4) * Math.PI * 2 + p.t * 5.0;
        const r = p.t * Math.min(w, h) * 0.58;
        const x = Math.cos(base) * r + (Math.random() - 0.5) * 4;
        const y = Math.sin(base) * r * 0.48 + p.rOffset;
        const a = 1 - p.t;
        ctx.beginPath(); ctx.arc(x, y, 1.3 * a, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(212, 168, 75, ' + (0.6 * a) + ')';
        ctx.fill();
      }
      ctx.restore();

      // 发光核心 + 脉冲环
      const pulse = 1 + 0.14 * Math.sin(time * 0.002);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 55 * pulse);
      core.addColorStop(0, 'rgba(255,255,255,0.98)');
      core.addColorStop(0.25, 'rgba(212,168,75,0.65)');
      core.addColorStop(0.55, 'rgba(139,92,246,0.25)');
      core.addColorStop(1, 'rgba(139,92,246,0)');
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, 55 * pulse, 0, Math.PI * 2); ctx.fill();

      // 科技环
      for (const ring of techRings) {
        const rad = Math.min(w, h) * ring.r * (1 + 0.03 * Math.sin(time * ring.speed * 4));
        ctx.strokeStyle = 'rgba(26, 163, 158, ' + ring.a + ')';
        ctx.lineWidth = ring.width;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, time * ring.speed, time * ring.speed + Math.PI * 1.7);
        ctx.stroke();
      }

      // 星点 + 闪烁
      for (const s of stars) {
        s.tw += s.tws;
        const alpha = 0.25 + 0.6 * Math.abs(Math.sin(s.tw));
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fillStyle = hexA(s.col, alpha);
        ctx.fill();
        if (s.r > 1.2) {
          ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = hexA(s.col, alpha * 0.18);
          ctx.fill();
        }
      }

      // 网格点流动连线
      const pts = gridPoints.map(p => {
        const dx = Math.sin(time * 0.00035 + p.ph) * 10;
        const dy = Math.cos(time * 0.0003 + p.ph) * 8;
        return { x: p.x * w + dx, y: p.y * h * 0.72 + dy };
      });
      ctx.lineWidth = 0.8;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 100) {
            ctx.strokeStyle = 'rgba(139, 92, 246, ' + (0.18 * (1 - d / 100)) + ')';
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
          }
        }
      }
    }

    /* --- Natural Landscape: 真实极光山峦 --- */
    const skyStars = Array.from({ length: 80 }, () => ({
      x: Math.random(), y: Math.random() * 0.55,
      r: 0.3 + Math.random() * 1.2,
      tw: Math.random() * Math.PI * 2,
      tws: 0.02 + Math.random() * 0.05,
    }));


    function drawLandscape(time) {
      // 夜空底
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, 'rgba(6, 18, 38, 0.92)');
      sky.addColorStop(0.45, 'rgba(5, 24, 36, 0.78)');
      sky.addColorStop(0.8, 'rgba(4, 28, 32, 0.68)');
      sky.addColorStop(1, 'rgba(3, 22, 22, 0.58)');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // 星空
      for (const s of skyStars) {
        s.tw += s.tws;
        const a = 0.2 + 0.55 * Math.abs(Math.sin(s.tw));
        ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + a + ')';
        ctx.fill();
      }

      // 月亮
      const moonX = w * 0.82, moonY = h * 0.18;
      const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, 90);
      moonGlow.addColorStop(0, 'rgba(255, 250, 230, 0.18)');
      moonGlow.addColorStop(0.5, 'rgba(255, 250, 230, 0.06)');
      moonGlow.addColorStop(1, 'rgba(255, 250, 230, 0)');
      ctx.fillStyle = moonGlow; ctx.beginPath(); ctx.arc(moonX, moonY, 90, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(moonX, moonY, 22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 252, 235, 0.95)'; ctx.fill();

      // 极光帷幔（多层流动，更强更明显）
      const bands = [
        { col: [45, 212, 191], yb: 0.20, amp: 26, ph: 0, spd: 0.0006, alpha: 0.42 },
        { col: [94, 234, 212], yb: 0.32, amp: 34, ph: 1.6, spd: 0.00085, alpha: 0.38 },
        { col: [52, 211, 153], yb: 0.26, amp: 20, ph: 3.1, spd: 0.00055, alpha: 0.34 },
        { col: [16, 185, 129], yb: 0.40, amp: 24, ph: 4.4, spd: 0.00075, alpha: 0.32 },
        { col: [167, 243, 208], yb: 0.16, amp: 18, ph: 5.8, spd: 0.00045, alpha: 0.28 },
      ];
      for (const b of bands) {
        const baseY = h * b.yb;
        const grad = ctx.createLinearGradient(0, baseY - 90, 0, baseY + 160);
        grad.addColorStop(0, 'rgba(' + b.col.join(',') + ', 0)');
        grad.addColorStop(0.3, 'rgba(' + b.col.join(',') + ', ' + b.alpha + ')');
        grad.addColorStop(0.55, 'rgba(' + b.col.join(',') + ', ' + (b.alpha * 0.55) + ')');
        grad.addColorStop(0.75, 'rgba(' + b.col.join(',') + ', ' + (b.alpha * 0.25) + ')');
        grad.addColorStop(1, 'rgba(' + b.col.join(',') + ', 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= w; x += 5) {
          const y = baseY
            + Math.sin(x * 0.007 + time * b.spd + b.ph) * b.amp
            + Math.sin(x * 0.019 + time * b.spd * 1.6 + b.ph) * (b.amp * 0.4)
            + Math.sin(x * 0.003 + time * b.spd * 0.7 + b.ph) * (b.amp * 0.2);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, baseY + 190); ctx.lineTo(0, baseY + 190);
        ctx.closePath(); ctx.fill();
      }

      // 远山剪影（多层，带雪顶）
      const mountain = (baseY, color, seed, alpha, snow) => {
        ctx.fillStyle = 'rgba(' + color.join(',') + ',' + alpha + ')';
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, baseY);
        const peaks = [];
        for (let x = 0; x <= w; x += 14) {
          const v = Math.sin((x + seed) * 0.0055) * 0.5 + Math.sin((x + seed * 2) * 0.013) * 0.5;
          const y = baseY - Math.abs(v) * 100 - 30;
          peaks.push({ x, y });
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

        // 雪顶
        if (snow) {
          ctx.fillStyle = 'rgba(230, 245, 255, 0.18)';
          ctx.beginPath();
          for (let i = 0; i < peaks.length - 1; i++) {
            const p = peaks[i], n = peaks[i + 1];
            if (p.y < baseY - 55 && n.y < baseY - 40) {
              ctx.moveTo(p.x, p.y + 12);
              ctx.lineTo((p.x + n.x) / 2, Math.min(p.y, n.y) - 2);
              ctx.lineTo(n.x, n.y + 12);
              ctx.lineTo(n.x, n.y + 28);
              ctx.lineTo(p.x, p.y + 28);
            }
          }
          ctx.fill();
        }
      };
      mountain(h * 0.72, [14, 50, 58], 0, 0.80, true);
      mountain(h * 0.80, [9, 40, 46], 130, 0.90, false);
      mountain(h * 0.88, [5, 28, 34], 260, 0.98, false);

      // 湖面/雾气倒影
      const lakeY = h * 0.90;
      const lake = ctx.createLinearGradient(0, lakeY, 0, h);
      lake.addColorStop(0, 'rgba(45, 212, 191, 0.10)');
      lake.addColorStop(0.4, 'rgba(45, 212, 191, 0.04)');
      lake.addColorStop(1, 'rgba(4, 22, 22, 0.25)');
      ctx.fillStyle = lake; ctx.fillRect(0, lakeY, w, h - lakeY);

      // 雾气
      const fog = ctx.createLinearGradient(0, h * 0.72, 0, h);
      fog.addColorStop(0, 'rgba(255,255,255,0)');
      fog.addColorStop(0.5, 'rgba(200,235,245,0.05)');
      fog.addColorStop(1, 'rgba(200,235,245,0.12)');
      ctx.fillStyle = fog; ctx.fillRect(0, h * 0.72, w, h * 0.28);

    }

    function tick(now) {
      const time = now - t0;
      if (kind === 'galaxy') drawGalaxy(time);
      else drawLandscape(time);
      raf = requestAnimationFrame(tick);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize(); tick(performance.now());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = null; }
      else if (!raf) tick(performance.now());
    });
  }

  /* ---------------- 背景音乐：使用用户提供的 MP3 ----------------
     通过 HTML5 <audio> 循环播放，右下角按钮控制播放/暂停。
     默认暂停，音量较低；切换状态即时生效。
  */
  function initMusic() {
    if (!window.Audio || !window.localStorage) return;

    const LS_PLAYING = 'mrv_music_playing';
    const LS_TIME = 'mrv_music_time';
    const LS_UPDATED = 'mrv_music_updated';

    const audio = document.createElement('audio');
    audio.src = '/audio/grand_project-wonders-of-the-earth-550792.mp3';
    audio.loop = true;
    audio.volume = 0.18;
    audio.preload = 'auto';
    audio.style.display = 'none';
    document.body.appendChild(audio);

    let toggleBtn = null;

    function getStored() {
      return {
        playing: localStorage.getItem(LS_PLAYING) === '1',
        time: parseFloat(localStorage.getItem(LS_TIME) || '0') || 0,
        updated: parseInt(localStorage.getItem(LS_UPDATED) || '0', 10) || 0,
      };
    }

    function store(playing, time) {
      localStorage.setItem(LS_PLAYING, playing ? '1' : '0');
      localStorage.setItem(LS_TIME, String(time || 0));
      localStorage.setItem(LS_UPDATED, String(Date.now()));
    }

    function updateUI() {
      if (!toggleBtn) return;
      const playing = !audio.paused;
      toggleBtn.classList.toggle('playing', playing);
      toggleBtn.innerHTML = (playing
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>') +
        '<span>' + (playing ? 'Music On' : 'Music Off') + '</span>';
    }

    async function playFromStore() {
      const st = getStored();
      if (st.playing && st.time > 0 && st.time < audio.duration) {
        try { audio.currentTime = st.time; } catch {}
      }
      try { await audio.play(); } catch {}
    }

    async function toggle() {
      try {
        if (audio.paused) {
          const st = getStored();
          if (st.playing && st.time > 0 && st.time < audio.duration) {
            try { audio.currentTime = st.time; } catch {}
          }
          await audio.play();
        } else {
          audio.pause();
        }
      } catch (e) {
        // 自动播放策略拒绝时保持静默
      }
      updateUI();
    }

    audio.addEventListener('play', () => { store(true, audio.currentTime); updateUI(); });
    audio.addEventListener('pause', () => { store(false, audio.currentTime); updateUI(); });
    audio.addEventListener('ended', () => { store(false, 0); updateUI(); });
    audio.addEventListener('timeupdate', () => {
      const now = Date.now();
      const last = parseInt(localStorage.getItem(LS_UPDATED) || '0', 10) || 0;
      if (now - last > 3000) store(!audio.paused, audio.currentTime);
    });

    window.addEventListener('beforeunload', () => {
      store(!audio.paused, audio.currentTime);
    });

    window.addEventListener('storage', (e) => {
      if (e.key === LS_PLAYING) {
        const st = getStored();
        if (st.playing && audio.paused) playFromStore();
        else if (!st.playing && !audio.paused) audio.pause();
      }
      if (e.key === LS_TIME && !audio.paused) {
        const st = getStored();
        if (st.time > 0 && st.time < audio.duration && Math.abs(audio.currentTime - st.time) > 2) {
          try { audio.currentTime = st.time; } catch {}
        }
      }
    });

    toggleBtn = document.createElement('div');
    toggleBtn.className = 'music-toggle glass';
    toggleBtn.title = 'Toggle background music';
    toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg><span>Music Off</span>';
    toggleBtn.addEventListener('click', toggle);
    document.body.appendChild(toggleBtn);

    const st = getStored();
    if (st.playing) {
      if (audio.readyState >= 2) playFromStore();
      else audio.addEventListener('canplaythrough', playFromStore, { once: true });
    }
    updateUI();
  }

  /* ---------------- 点击音效（Web Audio 生成，清脆短促） ---------------- */
  function playClickSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
      setTimeout(() => ctx.close(), 250);
    } catch (e) {}
  }

  /* ---------------- 导出 / 启动 ---------------- */
  window.FX = { cursor: initCursor, ripple: initRipple, fluid: spawnFluid, music: initMusic, playClickSound };

  function boot() {
    initCursor();
    initRipple();
    initMusic();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
