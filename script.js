/* Precision Stop — game logic
 * Positions are in "units" on a 0–100 bar. Results are judged on values rounded to
 * one decimal, the same numbers the player sees, so the readout always matches the outcome.
 */
(() => {
  'use strict';

  /* ---------- settings (tweak here) ---------- */
  const CFG = {
    CHANCES: 5,                        // attempts per game
    ZONE_WIDTH: 6,                     // green zone width, in units of 100
    NEEDLE_SPEED: 130,                 // needle speed, units per second
    NEAR_BAND: 10,                     // near miss = within this many units of the zone edge
    // Zone speed per chance, as a fraction of the needle speed: slow, medium, medium, fast, fast
    ZONE_SPEED: [.25, .375, .375, .5, .5],
    WIN_MIN_PTS: 50,                   // points at the zone edge
    WIN_MAX_PTS: 100,                  // points at dead center
    NEAR_PTS: 10,
    RESULT_LOCK_MS: 380,               // stops a double tap from instantly starting the next chance
    GAME_OVER_DELAY_MS: 1200,          // pause on the last result before the game-over screen
  };
  const MAX_SCORE = CFG.CHANCES * CFG.WIN_MAX_PTS;
  const STORE = { best: 'precision-stop:best', muted: 'precision-stop:muted' };

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const r1 = (n) => Math.round(n * 10) / 10;
  const f1 = (n) => r1(n).toFixed(1);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: ignore */ } },
  };

  const el = {
    app: $('app'), track: $('track'), zone: $('zone'), needle: $('needle'), bar: $('bar'), marks: $('marks'),
    result: $('result'), btn: $('btn'), btnLabel: $('btnLabel'), hint: $('hint'),
    round: $('round'), roundNum: $('roundNum'), roundTag: $('roundTag'),
    score: $('score'), dots: $('dots'),
    soundBtn: $('soundBtn'), restartBtn: $('restartBtn'), homeBtn: $('homeBtn'),
    playBtn: $('playBtn'), bestTitle: $('bestTitle'),
    finalScore: $('finalScore'), rank: $('rank'), newBest: $('newBest'), chips: $('chips'),
    winsStat: $('winsStat'), closeStat: $('closeStat'), closeLabel: $('closeLabel'), bestStat: $('bestStat'),
    againBtn: $('againBtn'), menuBtn: $('menuBtn'),
    fx: $('fx'), toast: $('toast'),
  };

  /* ---------- state ---------- */
  const S = {
    screen: 'title',      // title | game | over
    phase: 'ready',       // ready | running | waiting (between last stop and game over)
    used: 0, score: 0, history: [], nearStreak: 0,
    zone0: 47, zone: 47, zoneSpeed: 0, t0: 0, pos: 0, lockUntil: 0,
    best: Number(store.get(STORE.best, 0)) || 0,
    muted: !!store.get(STORE.muted, false),
    timers: [],
  };
  let trackW = el.track.clientWidth;

  /* ---------- audio ---------- */
  let ac = null;
  function tone(freq, at, dur, type = 'triangle', vol = .15) {
    if (S.muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + .01);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + dur + .03);
    } catch (e) { /* audio unavailable */ }
  }
  const sfx = {
    start()   { tone(440, 0, .07, 'square', .05); tone(660, .05, .07, 'square', .04); },
    perfect() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * .07, .24)); },
    win()     { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .08, .2)); },
    near()    { tone(620, 0, .12); tone(560, .12, .22); },
    miss()    { tone(180, 0, .26, 'sawtooth', .07); },
    token()   { [784, 988, 1175, 1568].forEach((f, i) => tone(f, .3 + i * .07, .18, 'sine')); },
    over()    { [392, 330, 262].forEach((f, i) => tone(f, i * .12, .3, 'triangle', .12)); },
    click()   { tone(880, 0, .04, 'square', .03); },
  };
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* no haptics */ } };

  /* ---------- particles ---------- */
  const fx = { ctx: el.fx.getContext('2d'), parts: [], raf: 0, dpr: 1 };
  function sizeFx() {
    fx.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = el.app.getBoundingClientRect();
    el.fx.width = Math.round(r.width * fx.dpr);
    el.fx.height = Math.round(r.height * fx.dpr);
  }
  function burst(x, y, colors, count = 40, power = 1) {
    if (reduceMotion) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = (2 + Math.random() * 6) * power;
      fx.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3 * power,
        life: 1, decay: .012 + Math.random() * .018,
        size: 2 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - .5) * .4,
        color: colors[(Math.random() * colors.length) | 0], rect: Math.random() > .4,
      });
    }
    if (!fx.raf) fx.raf = requestAnimationFrame(fxLoop);
  }
  function fxLoop() {
    const c = fx.ctx, d = fx.dpr;
    c.clearRect(0, 0, el.fx.width, el.fx.height);
    fx.parts = fx.parts.filter((p) => p.life > 0);
    for (const p of fx.parts) {
      p.vy += .22; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay;
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = p.color;
      c.save(); c.translate(p.x * d, p.y * d); c.rotate(p.rot);
      if (p.rect) c.fillRect(-p.size * d / 2, -p.size * d / 4, p.size * d, p.size * d / 2);
      else { c.beginPath(); c.arc(0, 0, p.size * d / 2, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    c.globalAlpha = 1;
    fx.raf = fx.parts.length ? requestAnimationFrame(fxLoop) : 0;
  }
  function needlePoint() {
    const app = el.app.getBoundingClientRect(), t = el.track.getBoundingClientRect();
    return { x: t.left - app.left + (S.pos / 100) * t.width, y: t.top - app.top + t.height / 2 };
  }
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ---------- drawing ---------- */
  const placeNeedle = (p) => { el.needle.style.transform = `translateX(${(p / 100) * trackW}px)`; };
  function drawZone() { el.zone.style.left = S.zone + '%'; el.zone.style.width = CFG.ZONE_WIDTH + '%'; }
  function drawMarks() {
    el.marks.innerHTML = S.history.map((h, i) =>
      `<span class="mark ${h.r}${i === S.history.length - 1 ? ' latest' : ''}" style="left:${h.p}%"></span>`).join('');
  }
  function drawDots(justIndex = -1) {
    let html = '';
    for (let i = 0; i < CFG.CHANCES; i++) {
      let cls = 'dot';
      if (i < S.used) cls += ' ' + S.history[i].r;
      else if (i === S.used && S.screen === 'game' && S.phase !== 'waiting') cls += ' current';
      else cls += ' left';
      if (i === justIndex) cls += ' just';
      html += `<span class="${cls}"></span>`;
    }
    el.dots.innerHTML = html;
    el.dots.setAttribute('aria-label', `${CFG.CHANCES - S.used} of ${CFG.CHANCES} chances left`);
  }
  let scoreAnim = 0;
  function countTo(node, from, to, ms) {
    cancelAnimationFrame(scoreAnim);
    if (reduceMotion || from === to) { node.textContent = to; return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(from + (to - from) * e);
      if (k < 1) scoreAnim = requestAnimationFrame(step);
    };
    scoreAnim = requestAnimationFrame(step);
  }
  function restartAnim(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

  function setButton(state) {
    el.btn.classList.remove('ready', 'running', 'waiting');
    el.btn.classList.add(state);
    el.btnLabel.textContent = state === 'running' ? 'STOP' : state === 'waiting' ? '…' : (S.used === 0 ? 'START' : 'NEXT');
    el.btn.setAttribute('aria-label', state === 'running' ? 'Stop the needle' : state === 'waiting' ? 'Please wait' : 'Start the next chance');
  }
  function drawRound() {
    const moving = CFG.ZONE_SPEED[S.used] > 0;
    el.roundNum.textContent = `Chance ${Math.min(S.used + 1, CFG.CHANCES)} of ${CFG.CHANCES}`;
    const f = CFG.ZONE_SPEED[Math.min(S.used, CFG.CHANCES - 1)];
    el.roundTag.textContent = !moving ? 'Zone still' : f >= .5 ? 'Zone fast' : f > .25 ? 'Zone medium' : 'Zone slow';
    el.roundTag.classList.toggle('fast', f >= .5);
    el.roundTag.classList.toggle('medium', f > .25 && f < .5);
    el.roundTag.classList.toggle('moving', moving);
    restartAnim(el.round, 'enter');
  }
  function setSound() {
    el.soundBtn.classList.toggle('muted', S.muted);
    el.soundBtn.setAttribute('aria-label', S.muted ? 'Turn sound on' : 'Mute sound');
  }

  /* ---------- timers ---------- */
  const later = (fn, ms) => { const id = setTimeout(fn, ms); S.timers.push(id); return id; };
  const clearTimers = () => { S.timers.forEach(clearTimeout); S.timers = []; };

  /* ---------- screens ---------- */
  function setScreen(name) {
    S.screen = name;
    el.app.dataset.screen = name;
    const focusTarget = name === 'title' ? el.playBtn : name === 'over' ? el.againBtn : null;
    if (focusTarget) later(() => focusTarget.focus({ preventScroll: true }), 60);
  }

  function goTitle() {
    clearTimers();
    S.phase = 'ready';
    el.bar.classList.remove('running');
    el.bestTitle.textContent = S.best;
    setScreen('title');
  }

  function newGame() {
    clearTimers();
    Object.assign(S, { phase: 'ready', used: 0, score: 0, history: [], nearStreak: 0, pos: 0, lockUntil: performance.now() + 150 });
    S.zone0 = S.zone = randomZone();
    S.zoneSpeed = 0;
    el.toast.hidden = true;
    el.zone.classList.remove('moving', 'hit');
    el.bar.classList.remove('running', 'shake');
    el.score.textContent = '0';
    el.result.className = 'result';
    el.result.textContent = '';
    el.hint.classList.remove('gone');
    drawZone(); placeNeedle(0); drawMarks();
    setScreen('game');
    drawDots(); drawRound(); setButton('ready');
    el.btn.focus({ preventScroll: true });
  }

  const randomZone = () => r1(12 + Math.random() * (76 - CFG.ZONE_WIDTH));

  /* ---------- motion ---------- */
  function needleAt(t) {
    const d = Math.max(0, t - S.t0) / 1000 * CFG.NEEDLE_SPEED, m = d % 200;
    return m <= 100 ? m : 200 - m;
  }
  // The zone bounces between 0 and 100 − width. It starts at zone0 heading left, toward the needle.
  function zoneAt(t) {
    if (!S.zoneSpeed) return S.zone0;
    const R = 100 - CFG.ZONE_WIDTH, d = Math.max(0, t - S.t0) / 1000 * S.zoneSpeed;
    const u = (2 * R - S.zone0 + d) % (2 * R);
    return u <= R ? u : 2 * R - u;
  }
  function frame(now) {
    if (S.phase !== 'running') return;
    S.pos = needleAt(now); placeNeedle(S.pos);
    if (S.zoneSpeed) { S.zone = zoneAt(now); drawZone(); }
    requestAnimationFrame(frame);
  }

  /* ---------- round flow ---------- */
  function start(now) {
    S.phase = 'running';
    S.t0 = now; S.pos = 0;
    S.zone0 = S.zone = randomZone();
    S.zoneSpeed = CFG.NEEDLE_SPEED * CFG.ZONE_SPEED[S.used];
    el.zone.classList.remove('hit');
    el.zone.classList.toggle('moving', S.zoneSpeed > 0);
    el.bar.classList.add('running');
    drawZone(); placeNeedle(0);
    el.result.className = 'result'; el.result.textContent = '';
    if (S.used === 0) el.hint.classList.add('gone');
    setButton('running');
    sfx.start();
    requestAnimationFrame(frame);
  }

  function judge(p, a) {
    const b = r1(a + CFG.ZONE_WIDTH);
    const dist = r1(p < a ? a - p : p > b ? p - b : 0);
    if (dist === 0) {
      const center = Math.abs(p - (a + CFG.ZONE_WIDTH / 2));
      const precision = clamp(1 - center / (CFG.ZONE_WIDTH / 2), 0, 1);
      const pts = CFG.WIN_MIN_PTS + Math.round((CFG.WIN_MAX_PTS - CFG.WIN_MIN_PTS) * precision);
      return { r: 'win', dist, pts, perfect: pts >= 95 };
    }
    if (dist <= CFG.NEAR_BAND) return { r: 'near', dist, pts: CFG.NEAR_PTS };
    return { r: 'miss', dist, pts: 0 };
  }

  function stop(at) {
    S.zone = r1(zoneAt(at)); drawZone();
    const p = r1(needleAt(at));
    S.pos = p; placeNeedle(p);
    el.bar.classList.remove('running');
    el.zone.classList.remove('moving');

    const j = judge(p, S.zone);
    S.history.push({ p, ...j });
    S.used++;
    const prevScore = S.score;
    S.score += j.pts;

    // feedback
    const pt = needlePoint();
    if (j.r === 'win') {
      S.nearStreak = 0;
      el.result.innerHTML = `<b>${j.perfect ? 'PERFECT!' : 'WIN!'}</b><span class="pts">+${j.pts}</span>`;
      restartAnim(el.zone, 'hit');
      burst(pt.x, pt.y, [css('--win'), css('--brass'), css('--fg'), css('--brass-hi')], j.perfect ? 90 : 55, j.perfect ? 1.3 : 1);
      j.perfect ? sfx.perfect() : sfx.win();
      buzz([30, 40, 70]);
    } else if (j.r === 'near') {
      S.nearStreak++;
      el.result.innerHTML = `<b>SO CLOSE!</b>off by ${f1(j.dist)} <span class="pts">+${j.pts}</span>`;
      burst(pt.x, pt.y, [css('--near')], 14, .6);
      sfx.near(); buzz([50, 40, 50]);
      if (S.nearStreak >= 3) { S.nearStreak = 0; showToast('Sticker token earned! 3 near misses in a row'); sfx.token(); }
    } else {
      S.nearStreak = 0;
      el.result.innerHTML = `<b>MISS</b>off by ${f1(j.dist)}`;
      if (!reduceMotion) restartAnim(el.bar, 'shake');
      sfx.miss(); buzz(30);
    }
    el.result.className = 'result ' + (j.perfect ? 'perfect' : j.r);
    restartAnim(el.result, 'pop');

    if (j.pts) { countTo(el.score, prevScore, S.score, 500); restartAnim(el.score, 'bump'); }
    drawMarks();

    if (S.used >= CFG.CHANCES) {
      S.phase = 'waiting';
      drawDots(S.used - 1);
      setButton('waiting');
      later(finishGame, CFG.GAME_OVER_DELAY_MS);
    } else {
      S.phase = 'ready';
      S.lockUntil = performance.now() + CFG.RESULT_LOCK_MS;
      drawDots(S.used - 1);
      setButton('ready');
      later(drawRound, 250);
    }
  }

  function rankFor(score) {
    if (score >= 450) return 'Sharpshooter';
    if (score >= 300) return 'Steady hand';
    if (score >= 150) return 'Getting there';
    if (score > 0)    return 'Warming up';
    return 'Keep practicing';
  }

  function finishGame() {
    const isBest = S.score > S.best;
    if (isBest) { S.best = S.score; store.set(STORE.best, S.best); }

    el.rank.textContent = rankFor(S.score);
    el.newBest.hidden = !isBest;
    el.chips.innerHTML = S.history.map((h, i) =>
      `<li class="chip ${h.r}" style="animation-delay:${.15 + i * .07}s"><span>#${i + 1}</span><b>${h.pts ? '+' + h.pts : '0'}</b></li>`).join('');
    const wins = S.history.filter((h) => h.r === 'win').length;
    const misses = S.history.filter((h) => h.r !== 'win').map((h) => h.dist);
    el.winsStat.textContent = `${wins}/${CFG.CHANCES}`;
    // With a win, show the best single hit; without one, the closest miss distance.
    el.closeLabel.textContent = wins ? 'Best hit' : 'Closest';
    el.closeStat.textContent = wins ? '+' + Math.max(...S.history.map((h) => h.pts)) : f1(Math.min(...misses));
    el.bestStat.textContent = S.best;
    el.bestTitle.textContent = S.best;
    el.finalScore.textContent = '0';

    setScreen('over');
    countTo(el.finalScore, 0, S.score, 900);
    sfx.over();
    if (isBest || wins >= 3) {
      later(() => {
        const r = el.app.getBoundingClientRect();
        burst(r.width / 2, r.height * .32, [css('--win'), css('--brass'), css('--near'), css('--fg')], 110, 1.4);
      }, 350);
    }
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    restartAnim(el.toast, 'show');
    later(() => { el.toast.hidden = true; }, 2600);
  }

  /* ---------- input ---------- */
  // Use the tap's own timestamp so a slow frame never moves the stop point.
  function tapTime(e) {
    const now = performance.now();
    return e && e.timeStamp && Math.abs(now - e.timeStamp) < 1000 ? e.timeStamp : now;
  }
  function act(e) {
    if (S.screen !== 'game') return;
    if (S.phase === 'running') stop(tapTime(e));
    else if (S.phase === 'ready' && performance.now() >= S.lockUntil) start(performance.now());
  }
  function press(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    act(e);
    el.btn.classList.add('pressed');
    setTimeout(() => el.btn.classList.remove('pressed'), 90);
  }
  el.btn.addEventListener('pointerdown', press);
  el.bar.addEventListener('pointerdown', press);
  el.btn.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard activation of the main button (Enter/Space with focus) comes through keydown below;
  // this only catches assistive-tech clicks that have no pointer or key event.
  let lastKey = 0;
  el.btn.addEventListener('click', (e) => { if (e.detail === 0 && performance.now() - lastKey > 400) act(e); });

  document.addEventListener('keydown', (e) => {
    const k = e.key;
    const onOtherButton = e.target && e.target.tagName === 'BUTTON' && e.target !== el.btn;
    if (k === ' ' || k === 'Enter') {
      if (onOtherButton) return;                       // let that button's own click run
      e.preventDefault();
      if (e.repeat) return;
      lastKey = performance.now();
      if (S.screen === 'game') act(e);
      else newGame();
    } else if (k === 'r' || k === 'R') {
      if (S.screen !== 'title') newGame();
    } else if (k === 'm' || k === 'M') {
      toggleSound();
    } else if (k === 'Escape') {
      if (S.screen === 'game') goTitle();
    }
  });

  function toggleSound() {
    S.muted = !S.muted;
    store.set(STORE.muted, S.muted);
    setSound();
    sfx.click();
  }

  el.playBtn.addEventListener('click', newGame);
  el.againBtn.addEventListener('click', newGame);
  el.restartBtn.addEventListener('click', () => { sfx.click(); newGame(); });
  el.homeBtn.addEventListener('click', () => { sfx.click(); goTitle(); });
  el.menuBtn.addEventListener('click', goTitle);
  el.soundBtn.addEventListener('click', toggleSound);

  // Leaving the tab mid-swing cancels that swing without using up the chance.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.phase === 'running') {
      S.phase = 'ready';
      el.bar.classList.remove('running');
      el.zone.classList.remove('moving');
      S.pos = 0; placeNeedle(0);
      el.result.className = 'result';
      el.result.textContent = 'Paused. That chance was not used.';
      setButton('ready');
    }
  });

  new ResizeObserver(() => { trackW = el.track.clientWidth; placeNeedle(S.pos); sizeFx(); }).observe(el.app);

  /* ---------- boot ---------- */
  sizeFx();
  setSound();
  el.bestTitle.textContent = S.best;
  drawZone(); placeNeedle(0); drawDots(); drawRound(); setButton('ready');
  setScreen('title');
})();
