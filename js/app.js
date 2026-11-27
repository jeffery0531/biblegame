/* 六十六卷 — 游戏逻辑。无依赖；直接双击 index.html 也能运行。 */
(function () {
  'use strict';

  const BIBLE = window.BIBLE;
  const BOOKS = BIBLE.BOOKS;
  const CATEGORIES = BIBLE.CATEGORIES;
  const CAT_ORDER = BIBLE.CAT_ORDER;

  const T_NAME = { OT: '旧约', NT: '新约' };
  const MASTER = 3;          // 同一卷连续答对几次算「掌握」
  const SOLO_MS = 60000;     // 冲刺模式时长
  const DUEL_WAIT_MS = 8000; // 抢答模式：没人按，多久后公布答案
  const DEFAULT_TEAMS = ['一队', '二队', '三队', '四队'];

  /* ================= 小工具 ================= */

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // 抢答要比谁快，所以答题按钮在「按下」的一瞬间就算数，而不是等手指抬起
  const DOWN = window.PointerEvent ? 'pointerdown' : ('ontouchstart' in window ? 'touchstart' : 'mousedown');
  function onDown(el, fn) {
    el.addEventListener(DOWN, function (e) {
      if (e.button) return;
      e.preventDefault();
      el.classList.add('pressed');
      setTimeout(function () { el.classList.remove('pressed'); }, 130);
      fn(e);
    });
  }

  /* ================= 存档（只存在本机） ================= */

  const Store = (function () {
    const KEY = 'biblegame.v1';
    function defaults() {
      return {
        stats: {},      // { 书卷id: { seen, wrong, streak } }
        scores: [],     // 冲刺排行榜
        settings: { sound: true },
        classSetup: { teams: 2, perTeam: 8, scope: 'all', limit: 10, names: DEFAULT_TEAMS.slice() },
        duelSetup: { target: 10, scope: 'all' },
        soloSetup: { scope: 'all' }
      };
    }
    let data = defaults();
    try {
      const saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        Object.keys(data).forEach(function (k) {
          const v = saved[k];
          if (v === undefined || v === null) return;
          if (Array.isArray(data[k])) { if (Array.isArray(v)) data[k] = v; }
          else if (typeof v === 'object') data[k] = Object.assign(data[k], v);
        });
      }
    } catch (e) { /* 读不到存档就用默认值 */ }

    const c = data.classSetup;
    c.teams = clamp(Number(c.teams) || 2, 2, 4);
    c.perTeam = clamp(Number(c.perTeam) || 8, 1, 16);
    if (!Array.isArray(c.names)) c.names = DEFAULT_TEAMS.slice();

    return {
      get data() { return data; },
      save: function () {
        try { window.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 存不了也不影响玩 */ }
      },
      clear: function () {
        try { window.localStorage.removeItem(KEY); } catch (e) { /* 同上 */ }
      }
    };
  })();

  function statOf(id) {
    return Store.data.stats[id] || { seen: 0, wrong: 0, streak: 0 };
  }

  function record(id, ok) {
    const s = Store.data.stats[id] || (Store.data.stats[id] = { seen: 0, wrong: 0, streak: 0 });
    s.seen++;
    if (ok) s.streak = Math.min(MASTER, s.streak + 1);
    else { s.wrong++; s.streak = 0; }
    Store.save();
  }

  function masteredCount() {
    return BOOKS.filter(function (b) { return statOf(b.id).streak >= MASTER; }).length;
  }

  function mostMissed(n) {
    return BOOKS.filter(function (b) { return statOf(b.id).wrong > 0; })
      .sort(function (a, b) { return statOf(b.id).wrong - statOf(a.id).wrong || a.id - b.id; })
      .slice(0, n);
  }

  /* ================= 出题 ================= */

  // 易错专场 = 名字容易误判的书卷 + 这台设备上错得最多的 10 卷
  function pool(scope) {
    if (scope !== 'tricky') return BOOKS.slice();
    const ids = {};
    BOOKS.forEach(function (b) { if (b.tricky) ids[b.id] = true; });
    mostMissed(10).forEach(function (b) { ids[b.id] = true; });
    return BOOKS.filter(function (b) { return ids[b.id]; });
  }

  // 洗牌发牌：一轮之内不重复，发完再洗
  function makeDealer(scope) {
    const src = pool(scope);
    let bag = [];
    let last = null;
    return function () {
      if (!bag.length) {
        bag = shuffle(src.slice());
        if (bag.length > 1 && bag[bag.length - 1] === last) bag.unshift(bag.pop());
      }
      last = bag.pop();
      return last;
    };
  }

  // 冲刺用：没掌握的、常错的出现得更多；答错的卷隔几张再考一次
  function makePicker(scope) {
    const src = pool(scope);
    const recent = [];
    const retry = [];
    let n = 0;

    function remember(book) {
      recent.push(book.id);
      const keep = clamp(src.length - 3, 1, 10);
      while (recent.length > keep) recent.shift();
    }

    function next() {
      n++;
      for (let i = 0; i < retry.length; i++) {
        if (retry[i].due <= n) {
          const again = retry.splice(i, 1)[0].book;
          remember(again);
          return again;
        }
      }
      let cands = src.filter(function (b) { return recent.indexOf(b.id) === -1; });
      if (!cands.length) cands = src;
      let total = 0;
      const weights = cands.map(function (b) {
        const s = statOf(b.id);
        const w = 1 + (MASTER - Math.min(s.streak, MASTER)) + Math.min(s.wrong, 3) * 0.5;
        total += w;
        return w;
      });
      let r = Math.random() * total;
      let pick = cands[cands.length - 1];
      for (let i = 0; i < cands.length; i++) {
        r -= weights[i];
        if (r <= 0) { pick = cands[i]; break; }
      }
      remember(pick);
      return pick;
    }

    next.retry = function (book) {
      if (!retry.some(function (x) { return x.book === book; })) retry.push({ book: book, due: n + 4 });
    };
    return next;
  }

  /* ================= 音效（现场合成，不需要音频文件） ================= */

  const Sound = (function () {
    let ctx = null;
    function ac() {
      if (!Store.data.settings.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
      }
      if (ctx.state === 'suspended' && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(function () {});
      }
      return ctx;
    }
    function tone(freq, at, dur, type, vol) {
      const c = ac();
      if (!c) return;
      try {
        const t0 = c.currentTime + at;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
      } catch (e) { /* 没声音不影响玩 */ }
    }
    return {
      unlock: function () { ac(); },
      // 连击越高，音越高
      correct: function (combo) {
        const f = 523.25 * Math.pow(2, Math.min(combo || 0, 12) / 12);
        tone(f, 0, 0.12, 'triangle', 0.22);
        tone(f * 1.5, 0.07, 0.17, 'triangle', 0.2);
      },
      wrong: function () {
        tone(196, 0, 0.18, 'sawtooth', 0.12);
        tone(147, 0.12, 0.28, 'sawtooth', 0.12);
      },
      tick: function () { tone(880, 0, 0.05, 'square', 0.05); },
      show: function () { tone(660, 0, 0.08, 'sine', 0.14); },
      count: function () { tone(440, 0, 0.13, 'sine', 0.18); },
      go: function () { tone(880, 0, 0.32, 'sine', 0.2); },
      win: function () {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, i * 0.13, 0.32, 'triangle', 0.22); });
      }
    };
  })();

  /* ================= 计时 ================= */

  const App = { screen: 'home', paused: false, lockUntil: 0 };

  // 一局结束、画面突然换掉时，孩子的手指多半还在狂点。
  // 这段时间里的点击一律不算，免得误点到「再来一次」「回首页」
  function lockInput(ms) {
    App.lockUntil = performance.now() + ms;
  }
  document.addEventListener('click', function (e) {
    if (performance.now() < App.lockUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // 一次性延时都登记在这里，退出一局时统一取消
  const Timers = {
    list: [],
    later: function (fn, ms) {
      const id = setTimeout(fn, ms);
      this.list.push(id);
      return id;
    },
    clear: function () {
      this.list.forEach(function (id) { clearTimeout(id); });
      this.list = [];
    }
  };

  // 倒计时。切到后台或弹窗打开时自动停表（单帧最多只算 250 毫秒）
  function Ticker(ms, onTick, onDone) {
    this.total = ms;
    this.left = ms;
    this.onTick = onTick;
    this.onDone = onDone;
    this.on = false;
    this.raf = 0;
  }
  Ticker.prototype.start = function () {
    const self = this;
    let last = performance.now();
    this.on = true;
    (function loop() {
      if (!self.on) return;
      const now = performance.now();
      const dt = Math.min(250, now - last);
      last = now;
      if (!App.paused) self.left -= dt;
      if (self.left <= 0) {
        self.left = 0;
        self.on = false;
        self.onTick(0, self.total);
        self.onDone();
        return;
      }
      self.onTick(self.left, self.total);
      self.raf = requestAnimationFrame(loop);
    })();
  };
  Ticker.prototype.stop = function () {
    this.on = false;
    cancelAnimationFrame(this.raf);
  };

  function setBar(bar, frac) {
    bar.firstElementChild.style.transform = 'scaleX(' + clamp(frac, 0, 1) + ')';
  }

  /* ================= 页面与弹窗 ================= */

  function show(id) {
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
    App.screen = id;
    const el = document.getElementById(id);
    if (el) el.scrollTop = 0;
    if (id === 'home') $('#home-mastered').textContent = masteredCount();
  }

  const Modal = (function () {
    const root = $('#modal');
    const body = $('#modal-body');
    const actions = $('#modal-actions');
    function close() {
      root.hidden = true;
      App.paused = false;
    }
    function open(content, buttons) {
      body.textContent = '';
      actions.textContent = '';
      body.appendChild(typeof content === 'string' ? h('p', 'modal-text', content) : content);
      buttons.forEach(function (b) {
        const btn = h('button', 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), b.label);
        btn.addEventListener('click', function () {
          close();
          if (b.onClick) b.onClick();
        });
        actions.appendChild(btn);
      });
      root.hidden = false;
      App.paused = true;
    }
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    return { open: open, close: close, isOpen: function () { return !root.hidden; } };
  })();

  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = h('div', 'confetti');
    const colors = ['#f5a93b', '#5b9dff', '#3ddc97', '#ff6b6b', '#eef2ff'];
    for (let i = 0; i < 80; i++) {
      const p = h('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.7) + 's';
      p.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
      p.style.setProperty('--dx', Math.round(Math.random() * 240 - 120) + 'px');
      p.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 4400);
  }

  /* ================= 卡片 ================= */

  const CARD_STATES = ['is-ot', 'is-nt', 'revealed', 'waiting', 'shake', 'enter', 'ok'];

  function resetCard(card) {
    CARD_STATES.forEach(function (c) { card.classList.remove(c); });
    card.textContent = '';
  }

  function nameEl(book) {
    const el = h('div', 'card-name', book.name);
    el.style.setProperty('--len', Math.max(4, book.name.length));  // 字号按字数自动缩放
    return el;
  }

  function tagsEl(book, skipTestament) {
    const tags = h('div', 'tags');
    if (!skipTestament) tags.appendChild(h('span', 'tag tag-' + book.t.toLowerCase(), T_NAME[book.t]));
    tags.appendChild(h('span', 'tag', CATEGORIES[book.cat].name));
    tags.appendChild(h('span', 'tag', '第 ' + book.id + ' 卷'));
    tags.appendChild(h('span', 'tag', book.ch + ' 章'));
    return tags;
  }

  // 出题：只显示书卷名，不能透露任何颜色线索
  function cardAsk(card, book, hint) {
    resetCard(card);
    if (hint) card.appendChild(h('div', 'card-hint', hint));
    card.appendChild(nameEl(book));
    restartAnim(card, 'enter');
  }

  // 公布答案：换上新旧约的颜色，带上类别。
  // full（课堂模式）时把「旧约 / 新约」单独放大，让后排也看得清，再加一句简介
  function cardReveal(card, book, verdict, full) {
    resetCard(card);
    card.classList.add('revealed');
    card.classList.add(book.t === 'OT' ? 'is-ot' : 'is-nt');
    if (verdict) card.appendChild(h('div', 'verdict ' + verdict.cls, verdict.text));
    card.appendChild(nameEl(book));
    if (full) card.appendChild(h('div', 'badge badge-' + book.t.toLowerCase(), T_NAME[book.t]));
    card.appendChild(tagsEl(book, full));
    if (full) card.appendChild(h('p', 'blurb', book.blurb));
  }

  // 「答错的书卷」小结；用正确答案的颜色标出来
  function renderReview(box, books, title, allGood) {
    box.textContent = '';
    const seen = {};
    const list = books.filter(function (b) {
      if (seen[b.id]) return false;
      seen[b.id] = true;
      return true;
    });
    if (!list.length) {
      if (allGood) box.appendChild(h('div', 'review-good', allGood));
      return;
    }
    box.appendChild(h('div', 'review-title', title));
    const chips = h('div', 'chips');
    list.forEach(function (b) {
      const chip = h('span', 'chip ' + b.t.toLowerCase(), b.name);
      chip.appendChild(h('small', null, T_NAME[b.t]));
      chips.appendChild(chip);
    });
    box.appendChild(chips);
  }

  // 分段选择按钮：点了就写进存档
  function bindSeg(root, getObj, onChange) {
    const paints = [];
    $$('.seg', root).forEach(function (seg) {
      const key = seg.getAttribute('data-key');
      function paint() {
        $$('button', seg).forEach(function (b) {
          b.classList.toggle('on', String(getObj()[key]) === b.getAttribute('data-v'));
        });
      }
      seg.addEventListener('click', function (e) {
        const b = e.target.closest('button');
        if (!b) return;
        const v = b.getAttribute('data-v');
        getObj()[key] = /^\d+$/.test(v) ? Number(v) : v;
        Store.save();
        paint();
        if (onChange) onChange(key);
      });
      paints.push(paint);
    });
    const paintAll = function () { paints.forEach(function (p) { p(); }); };
    paintAll();
    return paintAll;
  }

  /* ================= 模式一：课堂对抗 ================= */

  const Classroom = (function () {
    const els = {
      names: $('#team-names'),
      scores: $('#class-scores'),
      progress: $('#class-progress'),
      turn: $('#class-turn'),
      card: $('#class-card'),
      timer: $('#class-timer'),
      answers: $('#class-answers'),
      after: $('#class-after'),
      next: $('#class-next')
    };
    const cfg = function () { return Store.data.classSetup; };
    let st = null;
    let ticker = null;

    function paintNames() {
      els.names.textContent = '';
      for (let i = 0; i < cfg().teams; i++) {
        const inp = h('input');
        inp.type = 'text';
        inp.maxLength = 6;
        inp.value = cfg().names[i] || DEFAULT_TEAMS[i];
        inp.setAttribute('aria-label', '第 ' + (i + 1) + ' 队的队名');
        inp.setAttribute('autocomplete', 'off');
        inp.addEventListener('input', function () {
          cfg().names[i] = inp.value;
          Store.save();
        });
        els.names.appendChild(inp);
      }
    }

    bindSeg($('#class-setup'), cfg, function (key) { if (key === 'teams') paintNames(); });

    function openSetup() {
      paintNames();
      show('class-setup');
    }

    function stopTicker() {
      if (ticker) { ticker.stop(); ticker = null; }
    }

    function start() {
      stop();
      const c = cfg();
      const teams = [];
      for (let i = 0; i < c.teams; i++) {
        teams.push({ name: String(c.names[i] || '').trim() || DEFAULT_TEAMS[i], score: 0 });
      }
      const deal = makeDealer(c.scope);
      const deck = [];
      for (let i = 0; i < c.teams * c.perTeam; i++) deck.push(deal());
      st = { teams: teams, deck: deck, i: 0, phase: 'ask', missed: [], shownAt: 0 };
      show('class-play');
      ask();
    }

    function paintHud() {
      const turn = st.i % st.teams.length;
      els.scores.textContent = '';
      st.teams.forEach(function (t, idx) {
        const chip = h('div', 'team-chip' + (idx === turn ? ' active' : ''));
        chip.appendChild(h('span', null, t.name));
        chip.appendChild(h('b', null, t.score));
        els.scores.appendChild(chip);
      });
      els.progress.textContent = (st.i + 1) + ' / ' + st.deck.length;
      els.turn.textContent = '轮到 ';
      els.turn.appendChild(h('b', null, st.teams[turn].name));
    }

    function ask() {
      st.phase = 'ask';
      paintHud();
      cardAsk(els.card, st.deck[st.i], '旧约还是新约？');
      els.answers.hidden = false;
      els.after.hidden = true;

      stopTicker();
      const limit = cfg().limit;
      els.timer.classList.toggle('off', !limit);
      els.timer.classList.remove('low');
      setBar(els.timer, 1);
      if (limit) {
        let lastSec = limit;
        ticker = new Ticker(limit * 1000, function (left, total) {
          setBar(els.timer, left / total);
          const sec = Math.ceil(left / 1000);
          const low = left <= 3000;
          els.timer.classList.toggle('low', low);
          if (low && sec > 0 && sec !== lastSec) Sound.tick();
          lastSec = sec;
        }, function () { answer(null); });
        ticker.start();
      }
    }

    // t 为 'OT' / 'NT'；超时则为 null
    function answer(t) {
      if (!st || st.phase !== 'ask') return;
      stopTicker();
      const book = st.deck[st.i];
      const team = st.teams[st.i % st.teams.length];
      const ok = t === book.t;
      record(book.id, ok);
      if (ok) { team.score++; Sound.correct(0); }
      else { st.missed.push(book); Sound.wrong(); }

      st.phase = 'reveal';
      st.shownAt = performance.now();
      const verdict = ok
        ? { cls: 'ok', text: team.name + ' 答对了，+1 分' }
        : { cls: 'bad', text: t === null ? '时间到！' : '答错了' };
      cardReveal(els.card, book, verdict, true);
      paintHud();
      els.timer.classList.add('off');
      els.answers.hidden = true;
      els.after.hidden = false;
      els.next.textContent = st.i + 1 >= st.deck.length ? '看结果' : '下一题';
    }

    function next() {
      if (!st || st.phase !== 'reveal') return;
      if (performance.now() - st.shownAt < 500) return;   // 防止连点两下直接跳过讲解
      st.i++;
      if (st.i >= st.deck.length) lockInput(600);
      if (st.i >= st.deck.length) finish();
      else ask();
    }

    function finish() {
      st.phase = 'done';
      const ranked = st.teams.slice().sort(function (a, b) { return b.score - a.score; });
      const winners = ranked.filter(function (t) { return t.score === ranked[0].score; });
      let headline;
      if (winners.length === st.teams.length) headline = '平局！';
      else if (winners.length > 1) headline = winners.map(function (t) { return t.name; }).join('、') + ' 并列第一';
      else headline = winners[0].name + ' 获胜！';
      $('#class-winner').textContent = headline;

      const ol = $('#class-ranking');
      ol.textContent = '';
      ranked.forEach(function (t) {
        const rank = 1 + ranked.filter(function (o) { return o.score > t.score; }).length;
        const li = h('li', rank === 1 ? 'first' : '');
        li.appendChild(h('span', 'rank', rank));
        li.appendChild(h('span', 'who', t.name));
        li.appendChild(h('b', null, t.score + ' 分'));
        ol.appendChild(li);
      });

      renderReview($('#class-review'), st.missed, '这一局答错的书卷，可以再讲一讲', '全部答对，太厉害了！');
      show('class-result');
      Sound.win();
      confetti();
    }

    function stop() {
      stopTicker();
      st = null;
    }

    $$('.ans', els.answers).forEach(function (btn) {
      onDown(btn, function () { answer(btn.getAttribute('data-t')); });
    });
    // 「下一题」也在按下的瞬间生效：它正好出现在答题按钮的位置，
    // 如果等手指抬起（click），按答案那一下的抬手会被算到它头上，直接把讲解跳过去
    onDown(els.next, next);
    $('#class-start').addEventListener('click', start);
    $('#class-again').addEventListener('click', start);

    return { openSetup: openSetup, answer: answer, next: next, stop: stop };
  })();

  /* ================= 模式二：面对面抢答 ================= */

  const Duel = (function () {
    const root = $('#duel-play');
    const halves = [];   // halves[0] = 下方玩家，halves[1] = 上方玩家（画面倒过来）
    let st = null;

    bindSeg($('#duel-setup'), function () { return Store.data.duelSetup; });

    $$('.half', root).forEach(function (half) {
      const p = Number(half.getAttribute('data-p'));
      half.innerHTML =
        '<div class="half-inner">' +
          '<div class="half-score"><span>我方</span><b class="me">0</b><i>:</i><b class="them">0</b><span>对方</span></div>' +
          '<div class="card duel-card"></div>' +
          '<div class="half-msg"></div>' +
          '<div class="answers off">' +
            '<button class="ans ans-ot" data-t="OT">旧约</button>' +
            '<button class="ans ans-nt" data-t="NT">新约</button>' +
          '</div>' +
        '</div>';
      halves[p] = {
        me: $('.me', half),
        them: $('.them', half),
        card: $('.card', half),
        msg: $('.half-msg', half),
        answers: $('.answers', half)
      };
      $$('.ans', half).forEach(function (btn) {
        onDown(btn, function () { tap(p, btn.getAttribute('data-t')); });
      });
    });

    function paintScores() {
      halves.forEach(function (hf, p) {
        hf.me.textContent = st.score[p];
        hf.them.textContent = st.score[1 - p];
      });
    }

    function setMsg(hf, text, cls) {
      hf.msg.textContent = text;
      hf.msg.className = 'half-msg' + (cls ? ' ' + cls : '');
    }

    function start() {
      stop();
      const c = Store.data.duelSetup;
      st = { score: [0, 0], target: c.target, deal: makeDealer(c.scope), book: null, phase: 'wait', timeout: 0 };
      $('#duel-target').textContent = '先得 ' + c.target + ' 分获胜';
      $('#duel-target').hidden = false;
      $('#duel-end').hidden = true;
      paintScores();
      show('duel-play');
      round(1500);
    }

    // 先盖着牌等一小段随机时间，防止有人按节奏瞎按
    function round(delay) {
      st.phase = 'wait';
      st.book = st.deal();
      halves.forEach(function (hf) {
        resetCard(hf.card);
        hf.card.classList.add('waiting');
        hf.card.appendChild(h('div', 'card-wait', '准备'));
        setMsg(hf, '');
        hf.answers.classList.add('off');
      });
      Timers.later(open, delay || (700 + Math.random() * 900));
    }

    function open() {
      if (!st) return;
      st.phase = 'ask';
      Sound.show();
      halves.forEach(function (hf) {
        cardAsk(hf.card, st.book);
        hf.answers.classList.remove('off');
      });
      st.timeout = Timers.later(function () { resolve(null, null); }, DUEL_WAIT_MS);
    }

    function tap(p, t) {
      if (!st || st.phase !== 'ask') return;
      clearTimeout(st.timeout);
      resolve(p, t);
    }

    // p = 抢答的人；没人抢则为 null
    function resolve(p, t) {
      if (!st) return;
      st.phase = 'show';
      const book = st.book;
      const msgs = [['没人抢答', ''], ['没人抢答', '']];
      if (p !== null) {
        const ok = t === book.t;
        record(book.id, ok);
        if (ok) {
          st.score[p]++;
          msgs[p] = ['抢对了，+1', 'good'];
          msgs[1 - p] = ['慢了一步', ''];
          Sound.correct(0);
        } else {
          st.score[1 - p]++;
          msgs[p] = ['抢错了，对方得分', 'bad'];
          msgs[1 - p] = ['对方抢错，你 +1', 'good'];
          Sound.wrong();
        }
      }
      halves.forEach(function (hf, i) {
        cardReveal(hf.card, book, null, false);
        setMsg(hf, msgs[i][0], msgs[i][1]);
        hf.answers.classList.add('off');
      });
      paintScores();

      const winner = st.score[0] >= st.target ? 0 : (st.score[1] >= st.target ? 1 : -1);
      if (winner >= 0) Timers.later(function () { finish(winner); }, 1500);
      else Timers.later(function () { round(); }, 2000);
    }

    function finish(winner) {
      if (!st) return;
      st.phase = 'done';
      halves.forEach(function (hf, i) {
        resetCard(hf.card);
        hf.card.appendChild(h('div', 'duel-final' + (i === winner ? ' win' : ''), i === winner ? '胜利！' : '惜败'));
        setMsg(hf, i === winner ? '漂亮！' : '下一局赢回来', i === winner ? 'good' : '');
      });
      $('#duel-target').hidden = true;
      $('#duel-end').hidden = false;
      lockInput(700);
      Sound.win();
      confetti();
    }

    function stop() { st = null; }

    $('#duel-start').addEventListener('click', start);
    $('#duel-again').addEventListener('click', function () { Timers.clear(); start(); });

    return { tap: tap, stop: stop, isOver: function () { return !st || st.phase === 'done'; } };
  })();

  /* ================= 模式三：60 秒冲刺 ================= */

  function topScores() {
    return Store.data.scores.slice().sort(function (a, b) { return b.score - a.score || a.ts - b.ts; });
  }

  function paintBoard(ol, highlight) {
    ol.textContent = '';
    const list = topScores().slice(0, 10);
    if (!list.length) {
      ol.appendChild(h('li', 'empty', '还没有成绩，来当第一个！'));
      return;
    }
    list.forEach(function (s, i) {
      const li = h('li', (i === 0 ? 'first' : '') + (s === highlight ? ' me' : ''));
      li.appendChild(h('span', 'rank', i + 1));
      li.appendChild(h('span', 'who', s.name));
      li.appendChild(h('b', null, s.score));
      ol.appendChild(li);
    });
  }

  const Solo = (function () {
    const els = {
      sec: $('#solo-sec'),
      time: $('.solo-time'),
      score: $('#solo-score'),
      timer: $('#solo-timer'),
      combo: $('#solo-combo'),
      stage: $('#solo-stage'),
      card: $('#solo-card'),
      answers: $('#solo-answers'),
      count: $('#solo-countdown'),
      form: $('#solo-save'),
      name: $('#solo-name'),
      saved: $('#solo-saved'),
      board: $('#solo-board'),
      board2: $('#solo-board2')
    };
    let st = null;
    let ticker = null;

    bindSeg($('#solo-intro'), function () { return Store.data.soloSetup; });

    function openIntro() {
      paintBoard(els.board, null);
      show('solo-intro');
    }

    function stopTicker() {
      if (ticker) { ticker.stop(); ticker = null; }
    }

    function resetCardPose() {
      const c = els.card;
      c.classList.remove('dragging');
      c.style.transition = 'none';
      c.style.transform = '';
      c.style.opacity = '';
      void c.offsetWidth;
      c.style.transition = '';
      els.stage.classList.remove('pull-ot', 'pull-nt');
    }

    function paintTime(left) {
      const sec = Math.ceil(left / 1000);
      els.sec.textContent = sec;
      setBar(els.timer, left / SOLO_MS);
      const low = left <= 10000;
      els.timer.classList.toggle('low', low);
      els.time.classList.toggle('low', low);
      return sec;
    }

    function paintScore() {
      els.score.textContent = st.score;
      if (st.combo >= 2) {
        els.combo.textContent = '连击 ×' + st.combo;
        restartAnim(els.combo, 'bump');
      } else {
        els.combo.textContent = '';
      }
    }

    function pop(text) {
      const p = h('div', 'pop', text);
      els.stage.appendChild(p);
      setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 750);
    }

    function start() {
      stop();
      st = {
        score: 0, combo: 0, maxCombo: 0, right: 0, total: 0,
        missed: [], phase: 'count', book: null, entry: null,
        pick: makePicker(Store.data.soloSetup.scope)
      };
      paintTime(SOLO_MS);
      paintScore();
      resetCard(els.card);
      resetCardPose();
      els.answers.classList.add('off');
      show('solo-play');
      countdown(3);
    }

    function countdown(n) {
      els.count.hidden = false;
      if (n === 0) {
        els.count.textContent = '开始！';
        els.count.classList.add('word');
        restartAnim(els.count, 'beat');
        Sound.go();
        Timers.later(function () {
          els.count.hidden = true;
          go();
        }, 480);
        return;
      }
      els.count.classList.remove('word');
      els.count.textContent = n;
      restartAnim(els.count, 'beat');
      Sound.count();
      Timers.later(function () { countdown(n - 1); }, 720);
    }

    function go() {
      if (!st) return;
      els.answers.classList.remove('off');
      nextCard();
      let lastSec = SOLO_MS / 1000;
      ticker = new Ticker(SOLO_MS, function (left) {
        const sec = paintTime(left);
        if (sec <= 10 && sec > 0 && sec !== lastSec) Sound.tick();
        lastSec = sec;
      }, end);
      ticker.start();
    }

    function nextCard() {
      if (!st || st.phase === 'done') return;
      st.book = st.pick();
      st.phase = 'play';
      resetCardPose();
      cardAsk(els.card, st.book);
    }

    function answer(t) {
      if (!st || st.phase !== 'play') return;
      const book = st.book;
      const ok = t === book.t;
      const c = els.card;
      st.total++;
      record(book.id, ok);
      els.stage.classList.remove('pull-ot', 'pull-nt');
      c.classList.remove('dragging', 'enter');

      if (ok) {
        st.combo++;
        st.right++;
        if (st.combo > st.maxCombo) st.maxCombo = st.combo;
        const gain = 10 + Math.min(st.combo - 1, 10) * 2;   // 连击加分：最多每卷 30 分
        st.score += gain;
        Sound.correct(st.combo);
        pop('+' + gain);
        // 卡片朝答案那一侧飞出去
        st.phase = 'fly';
        const sign = t === 'OT' ? '-' : '';
        c.classList.add('ok');
        c.style.transition = 'transform .17s ease-in, opacity .17s ease-in';
        c.style.transform = 'translateX(' + sign + '120%) rotate(' + sign + '14deg)';
        c.style.opacity = '0';
        Timers.later(nextCard, 180);
      } else {
        st.combo = 0;
        st.missed.push(book);
        st.pick.retry(book);
        Sound.wrong();
        // 停一下，让人看清正确答案；这段时间表还在走，就是答错的代价
        st.phase = 'pause';
        c.style.transform = '';
        cardReveal(c, book, { cls: 'bad', text: '答错了' }, false);
        restartAnim(c, 'shake');
        Timers.later(nextCard, 1200);
      }
      paintScore();
    }

    function end() {
      if (!st) return;
      st.phase = 'done';
      Timers.clear();
      stopTicker();
      els.count.hidden = true;

      const best = topScores().length ? topScores()[0].score : 0;
      const isRecord = st.score > 0 && st.score > best;
      $('#solo-kicker').textContent = isRecord ? '新纪录！' : '时间到';
      $('#solo-final').textContent = st.score;
      $('#solo-right').textContent = st.right + ' 卷';
      $('#solo-acc').textContent = st.total ? Math.round(st.right / st.total * 100) + '%' : '—';
      $('#solo-maxcombo').textContent = st.maxCombo;

      els.name.value = '';
      els.form.hidden = st.score <= 0;
      els.saved.hidden = true;
      renderReview($('#solo-review'), st.missed, '这次答错的书卷', st.total ? '一卷都没错！' : '');
      paintBoard(els.board2, null);
      lockInput(900);
      show('solo-result');
      if (isRecord) { Sound.win(); confetti(); } else { Sound.go(); }
    }

    function stop() {
      stopTicker();
      els.count.hidden = true;
      st = null;
    }

    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!st || st.entry) return;
      const name = els.name.value.trim().slice(0, 8);
      if (!name) {
        restartAnim(els.name, 'shake');
        els.name.focus();
        return;
      }
      const entry = { name: name, score: st.score, right: st.right, total: st.total, ts: Date.now() };
      Store.data.scores.push(entry);
      Store.data.scores = topScores().slice(0, 50);
      Store.save();
      st.entry = entry;
      const rank = topScores().indexOf(entry) + 1;
      els.name.blur();
      els.form.hidden = true;
      els.saved.hidden = false;
      els.saved.textContent = rank ? '已记入排行榜，第 ' + rank + ' 名' : '已保存';
      paintBoard(els.board2, entry);
    });

    // 拖动卡片：左 = 旧约，右 = 新约
    if (window.PointerEvent) {
      const card = els.card;
      let pid = null;
      let startX = 0;
      let dx = 0;
      const threshold = function () { return Math.min(120, window.innerWidth * 0.16); };

      card.addEventListener('pointerdown', function (e) {
        if (!st || st.phase !== 'play' || pid !== null || e.button) return;
        pid = e.pointerId;
        startX = e.clientX;
        dx = 0;
        try { card.setPointerCapture(pid); } catch (err) { /* 抓不到也能拖 */ }
        card.classList.remove('enter');
        card.classList.add('dragging');
      });
      card.addEventListener('pointermove', function (e) {
        if (e.pointerId !== pid) return;
        dx = e.clientX - startX;
        card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 24) + 'deg)';
        els.stage.classList.toggle('pull-ot', dx < -24);
        els.stage.classList.toggle('pull-nt', dx > 24);
      });
      const release = function (e) {
        if (e.pointerId !== pid) return;
        pid = null;
        card.classList.remove('dragging');
        els.stage.classList.remove('pull-ot', 'pull-nt');
        if (e.type === 'pointerup' && Math.abs(dx) >= threshold() && st && st.phase === 'play') {
          answer(dx < 0 ? 'OT' : 'NT');
        } else if (st && st.phase === 'play') {
          card.style.transform = '';
        }
      };
      card.addEventListener('pointerup', release);
      card.addEventListener('pointercancel', release);
    }

    $$('.ans', els.answers).forEach(function (btn) {
      onDown(btn, function () { answer(btn.getAttribute('data-t')); });
    });
    $('#solo-start').addEventListener('click', start);
    $('#solo-again').addEventListener('click', start);

    return { openIntro: openIntro, answer: answer, stop: stop };
  })();

  /* ================= 书架 ================= */

  const Shelf = (function () {
    const body = $('#shelf-body');

    function spine(book) {
      const s = statOf(book.id);
      const btn = h('button', 'spine ' + book.t.toLowerCase() + ' m' + Math.min(s.streak, MASTER));
      btn.style.width = (34 + Math.round(book.ch * 0.22)) + 'px';   // 章数越多，书脊越厚
      btn.setAttribute('aria-label', book.name);
      btn.appendChild(h('span', 'spine-name', book.name));
      const pips = h('span', 'pips');
      for (let i = 0; i < MASTER; i++) pips.appendChild(h('i'));
      btn.appendChild(pips);
      btn.addEventListener('click', function () { sheet(book); });
      return btn;
    }

    function sheet(book) {
      const s = statOf(book.id);
      const box = h('div');
      box.appendChild(h('div', 'sheet-name', book.name));
      box.appendChild(tagsEl(book));
      box.appendChild(h('p', 'blurb', book.blurb));
      box.appendChild(h('div', 'sheet-stats', s.seen
        ? '答对 ' + (s.seen - s.wrong) + ' 次 · 答错 ' + s.wrong + ' 次 · 连对 ' + s.streak + ' / ' + MASTER
        : '还没有答过这一卷'));
      Modal.open(box, [{ label: '知道了', primary: true }]);
    }

    function open() {
      body.textContent = '';
      ['OT', 'NT'].forEach(function (t) {
        const count = BOOKS.filter(function (b) { return b.t === t; }).length;
        const sec = h('section', 'testament testament-' + t.toLowerCase());
        sec.appendChild(h('h3', 'testament-title', T_NAME[t] + ' · ' + count + ' 卷'));
        CAT_ORDER.filter(function (c) { return CATEGORIES[c].t === t; }).forEach(function (c) {
          const books = BOOKS.filter(function (b) { return b.cat === c; });
          const row = h('div', 'shelf-row');
          row.appendChild(h('div', 'shelf-label', CATEGORIES[c].name + ' · ' + books.length + ' 卷'));
          const spines = h('div', 'spines');
          books.forEach(function (b) { spines.appendChild(spine(b)); });
          row.appendChild(spines);
          sec.appendChild(row);
        });
        body.appendChild(sec);
      });
      $('#shelf-count').textContent = '已掌握 ' + masteredCount() + ' / ' + BOOKS.length;
      renderReview($('#shelf-missed'), mostMissed(8), '最容易错的书卷，下次重点复习', '');
      show('shelf');
    }

    return { open: open };
  })();

  /* ================= 设置 ================= */

  function offlineNote() {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      return standalone
        ? '已经装在主屏幕上，没有网络也能玩。'
        : '离线内容已经存好。在浏览器的「分享」菜单里选「添加到主屏幕」，以后没有网络也能玩。';
    }
    if ('serviceWorker' in navigator) return '正在保存离线内容，联网时再打开一次就可以离线玩了。';
    return '现在是直接打开的本地文件或普通网址。要在平板上离线玩，需要把游戏放到一个 https 网址，用平板打开后「添加到主屏幕」。';
  }

  function openSettings() {
    const box = h('div');
    box.appendChild(h('div', 'set-title', '设置'));

    const soundRow = h('div', 'set-row');
    soundRow.appendChild(h('span', null, '音效'));
    const soundBtn = h('button', 'btn small');
    const paintSound = function () {
      const on = Store.data.settings.sound;
      soundBtn.textContent = on ? '开' : '关';
      soundBtn.classList.toggle('primary', on);
    };
    soundBtn.addEventListener('click', function () {
      Store.data.settings.sound = !Store.data.settings.sound;
      Store.save();
      paintSound();
      Sound.show();
    });
    paintSound();
    soundRow.appendChild(soundBtn);
    box.appendChild(soundRow);

    const resetRow = h('div', 'set-row');
    resetRow.appendChild(h('span', null, '清空掌握进度和排行榜'));
    const resetBtn = h('button', 'btn small danger', '清空');
    resetBtn.addEventListener('click', function () {
      Modal.open('确定清空吗？掌握进度和排行榜都会消失，不能恢复。', [
        { label: '先不清' },
        { label: '清空', danger: true, onClick: function () { Store.clear(); window.location.reload(); } }
      ]);
    });
    resetRow.appendChild(resetBtn);
    box.appendChild(resetRow);

    box.appendChild(h('div', 'set-note', offlineNote()));
    Modal.open(box, [{ label: '完成', primary: true }]);
  }

  /* ================= 全局事件 ================= */

  function stopAll() {
    Timers.clear();
    Classroom.stop();
    Duel.stop();
    Solo.stop();
  }

  function navigate(to) {
    stopAll();
    if (to === 'class-setup') Classroom.openSetup();
    else if (to === 'solo-intro') Solo.openIntro();
    else if (to === 'shelf') Shelf.open();
    else show(to);
  }

  function quit() {
    const leave = function () { navigate('home'); };
    if (App.screen === 'duel-play' && Duel.isOver()) { leave(); return; }
    Modal.open('要退出这一局吗？', [{ label: '继续玩' }, { label: '退出', primary: true, onClick: leave }]);
  }

  document.addEventListener('click', function (e) {
    const go = e.target.closest('[data-go]');
    if (go) { navigate(go.getAttribute('data-go')); return; }
    if (e.target.closest('[data-quit]')) quit();
  });
  $('#btn-settings').addEventListener('click', openSettings);

  // 键盘：接电脑投屏时也能玩（← 旧约，→ 新约，空格下一题；抢答上方玩家用 A / D）
  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key;
    if (Modal.isOpen()) {
      if (k === 'Escape') Modal.close();
      return;
    }
    let used = true;
    if (App.screen === 'class-play') {
      if (k === 'ArrowLeft') Classroom.answer('OT');
      else if (k === 'ArrowRight') Classroom.answer('NT');
      else if (k === ' ' || k === 'Enter') Classroom.next();
      else used = false;
    } else if (App.screen === 'solo-play') {
      if (k === 'ArrowLeft') Solo.answer('OT');
      else if (k === 'ArrowRight') Solo.answer('NT');
      else used = false;
    } else if (App.screen === 'duel-play') {
      if (k === 'ArrowLeft') Duel.tap(0, 'OT');
      else if (k === 'ArrowRight') Duel.tap(0, 'NT');
      else if (k === 'a' || k === 'A') Duel.tap(1, 'OT');
      else if (k === 'd' || k === 'D') Duel.tap(1, 'NT');
      else used = false;
    } else {
      used = false;
    }
    if (!used && k === 'Escape' && /-play$/.test(App.screen)) { quit(); used = true; }
    if (used) e.preventDefault();
  });

  // iOS 要在手指抬起的那一下才允许开声音
  document.addEventListener('touchend', Sound.unlock, true);
  document.addEventListener('click', Sound.unlock, true);
  // 让 iOS 上按钮的 :active 样式生效
  document.addEventListener('touchstart', function () {}, { passive: true });
  // 游戏里不需要长按菜单和双指缩放
  document.addEventListener('contextmenu', function (e) {
    if (!(e.target && e.target.tagName === 'INPUT')) e.preventDefault();
  });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  // 离线缓存：只有通过 https（或本机 localhost）打开时才可用
  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 注册不上就当普通网页用 */ });
    });
  }

  show('home');
})();
