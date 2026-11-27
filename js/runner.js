/*
 * 六十六卷 — 跑酷画面引擎。
 *
 * 场景、人物、门、粒子全部用 canvas 现画，不用任何图片文件，所以离线也是完整的。
 * 这个文件只管「画」和「跑」，不认识题目；出什么题、怎么算分由 app.js 决定。
 *
 * 画面是从人物背后看过去的：左边是旷野和帐幕（旧约世界），右边是湖和小镇（新约世界），
 * 所以左边那扇门永远是旧约，右边那扇门永远是新约。
 */
window.Runner = (function () {
  'use strict';

  const TAU = Math.PI * 2;
  const D = 5;           // 镜头离人物多远：越大，远近的大小差别越平缓
  const Z_FAR = 30;      // 门从多远的地方出现
  const Z_NEAR = -3.6;   // 东西跑过人物之后，再过多远就不画了
  const LANE_X = 0.56;   // 左右两条道离路中心多远（半个路宽 = 1）
  const SHORE = 2.25;    // 右边从这里往外是湖

  const C = {
    ot: '#f5a93b', otDeep: '#b97514', otInk: '#2b1a00',
    nt: '#5b9dff', ntDeep: '#2c68c9', ntInk: '#03122b',
    ok: '#3ddc97', bad: '#ff6b6b'
  };

  // 可选的人物。衣服颜色特意避开琥珀色和蓝色，免得和「旧约 / 新约」的颜色搞混
  const LOOKS = [
    { id: 'olive', name: '橄榄', tunic: '#46a36f', trim: '#2c7a50', sash: '#f6e7b4', hair: '#3a2a1c', style: 'short', skin: '#f2c9a0', band: '#ef6a4c' },
    { id: 'pome',  name: '石榴', tunic: '#df5068', trim: '#a8324a', sash: '#fbe9c8', hair: '#2a1d16', style: 'braid', skin: '#f7d6b5', band: '#ffd166' },
    { id: 'grape', name: '葡萄', tunic: '#8e62c9', trim: '#63409a', sash: '#f6e7b4', hair: '#1f1a17', style: 'curly', skin: '#c98e62', band: '#7be0c3' },
    { id: 'jade',  name: '碧玉', tunic: '#1fa39a', trim: '#147a73', sash: '#fbe9c8', hair: '#5a3a22', style: 'bun',   skin: '#e7b88d', band: '#ff8fa3' }
  ];

  /* ================= 画图小工具 ================= */

  function ell(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
  }

  function rr(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  // 一根圆头的粗线：胳膊、腿都用它
  function cap(ctx, x1, y1, x2, y2, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function starPath(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + i * Math.PI / 5;
      const rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
  }

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    const p = rgb(a), q = rgb(b);
    return 'rgb(' + Math.round(p[0] + (q[0] - p[0]) * t) + ',' + Math.round(p[1] + (q[1] - p[1]) * t) + ',' + Math.round(p[2] + (q[2] - p[2]) * t) + ')';
  }

  function rgbOf(color) {
    return color.charAt(0) === '#' ? rgb(color).join(',') : color.slice(4, -1);
  }

  // 固定的「随机数」：同一个 n 永远得到同一个值，这样每棵树每帧长得都一样
  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ================= 人物 ================= */

  function tunicPath(ctx, u, sy, hy, sway) {
    ctx.beginPath();
    ctx.moveTo(-0.15 * u, sy + 0.035 * u);
    ctx.quadraticCurveTo(-0.15 * u, sy, -0.1 * u, sy);
    ctx.lineTo(0.1 * u, sy);
    ctx.quadraticCurveTo(0.15 * u, sy, 0.15 * u, sy + 0.035 * u);
    ctx.lineTo(0.205 * u, hy);
    ctx.quadraticCurveTo(0.1 * u, hy + 0.04 * u + sway, 0, hy + 0.014 * u);
    ctx.quadraticCurveTo(-0.1 * u, hy + 0.04 * u - sway, -0.205 * u, hy);
    ctx.closePath();
  }

  function ribbon(ctx, x0, y0, len, phase, color, w, droop) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 1; i <= 6; i++) {
      const f = i / 6;
      ctx.lineTo(x0 + f * len, y0 + f * Math.abs(len) * droop + Math.sin(phase + f * 4.2) * Math.abs(len) * 0.13 * f);
    }
    ctx.stroke();
  }

  function scroll(ctx, x, y, u, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#f6ecd0';
    rr(ctx, -0.03 * u, -0.11 * u, 0.06 * u, 0.22 * u, 0.02 * u);
    ctx.fill();
    ctx.fillStyle = '#c9a56a';
    rr(ctx, -0.038 * u, -0.12 * u, 0.076 * u, 0.03 * u, 0.012 * u);
    ctx.fill();
    rr(ctx, -0.038 * u, 0.09 * u, 0.076 * u, 0.03 * u, 0.012 * u);
    ctx.fill();
    ctx.fillStyle = '#d9483b';
    ctx.fillRect(-0.03 * u, -0.012 * u, 0.06 * u, 0.024 * u);
    ctx.restore();
  }

  /*
   * 背影（跑酷画面里用）。
   * p: { phase 步子, still 站着不跑, lift 跳起多高 0..1, lean 往哪边歪, spin 翻跟头的角度,
   *      alpha 透明度, cheer 举手欢呼, down 摔坐在地上 }
   */
  function drawBack(ctx, x, y, u, look, p, t) {
    const still = !!p.still;
    const run = still ? 0 : Math.sin(p.phase);
    const bob = still ? Math.sin(t * 2.4) * u * 0.006 : -Math.abs(Math.cos(p.phase)) * u * 0.036;
    const lift = p.lift || 0;

    ctx.save();
    ctx.translate(x, y);

    // 影子留在地上，人跳起来时影子变小
    const sh = 1 - lift * 0.45;
    ctx.fillStyle = 'rgba(40,26,10,.24)';
    ell(ctx, 0, u * 0.012, u * 0.27 * sh, u * 0.07 * sh);
    ctx.fill();

    ctx.translate(0, -lift * u * 0.36);
    if (p.spin) {
      ctx.translate(0, -u * 0.45);
      ctx.rotate(p.spin);
      ctx.translate(0, u * 0.45);
    }
    ctx.rotate((p.lean || 0) * 0.14);
    if (p.down) {
      ctx.translate(0, u * 0.1);
      ctx.scale(1.06, 0.8);
    }
    if (p.alpha !== undefined) ctx.globalAlpha = p.alpha;

    const sy = -0.57 * u + bob;      // 肩
    const hy = -0.21 * u + bob;      // 下摆

    // 腿：k > 0 时这条腿正往后抬，能看见鞋底
    function leg(dx, k) {
      const up = p.down ? 0 : Math.max(0, k);
      const fx = dx * u * (1 + up * 0.3);
      const fy = -up * u * 0.17;
      cap(ctx, dx * u, hy - 0.05 * u, fx, fy - u * 0.035, u * 0.086, look.skin);
      ctx.fillStyle = up > 0.25 ? '#caa26c' : '#6b4a2b';
      ell(ctx, fx, fy - u * 0.016, u * (0.06 - up * 0.008), u * (0.03 + up * 0.03));
      ctx.fill();
    }
    leg(-0.078, run);
    leg(0.078, -run);

    // 衣服
    tunicPath(ctx, u, sy, hy, run * 0.014 * u);
    ctx.fillStyle = look.tunic;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    ctx.fillRect(0.06 * u, sy, 0.2 * u, 0.5 * u);
    ctx.fillStyle = look.trim;
    ctx.fillRect(-0.25 * u, hy - 0.022 * u, 0.5 * u, 0.09 * u);
    ctx.restore();

    // 腰带，一头垂下来随风摆
    ribbon(ctx, -0.15 * u, -0.385 * u + bob, -0.13 * u, t * 9, look.sash, u * 0.034, 0.75);
    ctx.fillStyle = look.sash;
    rr(ctx, -0.172 * u, -0.41 * u + bob, 0.344 * u, 0.05 * u, 0.02 * u);
    ctx.fill();

    // 斜挎的书卷袋
    cap(ctx, -0.12 * u, sy + 0.02 * u, 0.15 * u, -0.34 * u + bob, u * 0.028, '#7a5230');
    const bagY = -0.3 * u + bob * 1.8;
    scroll(ctx, 0.2 * u, bagY - 0.07 * u, u * 0.9, 0.38);
    ctx.fillStyle = '#8c6239';
    rr(ctx, 0.1 * u, bagY - 0.05 * u, 0.15 * u, 0.13 * u, 0.035 * u);
    ctx.fill();
    ctx.fillStyle = '#6f4a28';
    rr(ctx, 0.1 * u, bagY - 0.05 * u, 0.15 * u, 0.05 * u, 0.03 * u);
    ctx.fill();

    // 胳膊
    function arm(side, k) {
      const ax = side * 0.163 * u;
      const ay = sy + 0.05 * u;
      let hx, hY;
      if (p.cheer) {
        hx = side * (0.27 + Math.sin(t * 9 + side) * 0.012) * u;
        hY = -0.86 * u + bob + Math.sin(t * 9) * 0.015 * u;
      } else if (p.down) {
        hx = side * 0.27 * u;
        hY = -0.24 * u;
      } else {
        hx = side * (0.218 + 0.02 * Math.abs(k)) * u;
        hY = -0.365 * u + bob - k * 0.09 * u;
      }
      cap(ctx, ax, ay, hx, hY, u * 0.068, look.skin);
      cap(ctx, ax, ay, ax + (hx - ax) * 0.4, ay + (hY - ay) * 0.4, u * 0.088, look.tunic);
      ctx.fillStyle = look.skin;
      ell(ctx, hx, hY, u * 0.04, u * 0.04);
      ctx.fill();
    }
    arm(-1, -run);
    arm(1, run);

    // 脖子和后脑勺
    const hcy = -0.775 * u + bob * 1.2;
    const R = 0.205 * u;
    ctx.fillStyle = look.skin;
    rr(ctx, -0.045 * u, sy - 0.055 * u, 0.09 * u, 0.08 * u, 0.02 * u);
    ctx.fill();
    ell(ctx, -R * 0.97, hcy + R * 0.14, R * 0.2, R * 0.26);
    ctx.fill();
    ell(ctx, R * 0.97, hcy + R * 0.14, R * 0.2, R * 0.26);
    ctx.fill();

    ctx.fillStyle = look.hair;
    if (look.style === 'braid') {
      // 辫子垂在背后，跑起来左右甩
      for (let i = 0; i < 5; i++) {
        const swing = Math.sin(p.phase + i * 0.55) * (still ? 0.2 : 1) * i * 0.012 * u;
        ell(ctx, swing, hcy + R * 0.85 + i * 0.062 * u, (0.05 - i * 0.004) * u, 0.042 * u);
        ctx.fill();
      }
      ctx.fillStyle = look.band;
      ell(ctx, Math.sin(p.phase + 2.2) * (still ? 0.2 : 1) * 0.05 * u, hcy + R * 0.85 + 0.3 * u, 0.028 * u, 0.022 * u);
      ctx.fill();
      ctx.fillStyle = look.hair;
    }
    if (look.style === 'curly') {
      for (let i = 0; i < 11; i++) {
        const a = Math.PI * 0.9 + i * (Math.PI * 1.2 / 10);
        ell(ctx, Math.cos(a) * R * 0.92, hcy + Math.sin(a) * R * 0.9, R * 0.3, R * 0.3);
        ctx.fill();
      }
    }
    if (look.style === 'bun') {
      ell(ctx, 0, hcy - R * 1.02, R * 0.42, R * 0.4);
      ctx.fill();
    }
    ell(ctx, 0, hcy, R, R * 0.98);
    ctx.fill();
    if (look.style === 'short') {
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, hcy - R * 0.8);
      ctx.lineTo(-R * 0.25, hcy - R * 1.2);
      ctx.lineTo(-R * 0.02, hcy - R * 0.9);
      ctx.lineTo(R * 0.25, hcy - R * 1.22);
      ctx.lineTo(R * 0.5, hcy - R * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    // 头发上的一道高光
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = R * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, hcy, R * 0.72, Math.PI * 1.12, Math.PI * 1.42);
    ctx.stroke();

    // 头带和飘在后面的带子
    ribbon(ctx, R * 0.1, hcy - R * 0.1, R * 1.5, t * 10, look.band, u * 0.03, 0.42);
    ribbon(ctx, R * 0.1, hcy - R * 0.06, R * 1.2, t * 10 + 1.4, look.band, u * 0.026, 0.72);
    ctx.strokeStyle = look.band;
    ctx.lineWidth = u * 0.044;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(-R * 0.96, hcy - R * 0.3);
    ctx.quadraticCurveTo(0, hcy - R * 0.02, R * 0.96, hcy - R * 0.3);
    ctx.stroke();
    ctx.fillStyle = look.band;
    ell(ctx, R * 0.1, hcy - R * 0.13, R * 0.14, R * 0.14);
    ctx.fill();

    // 摔晕了：头顶转小星星
    if (p.down) {
      ctx.globalAlpha = 1;
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + i * TAU / 3;
        ctx.fillStyle = '#ffd166';
        starPath(ctx, Math.cos(a) * R * 1.15, hcy - R * 1.35 + Math.sin(a) * R * 0.3, R * 0.2, a);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /*
   * 正面（首页、选人物、结果页用）。mood: idle 站着 | wave 挥手 | cheer 举着书卷欢呼 | sad 垂头
   */
  function drawFront(ctx, x, y, u, look, mood, t) {
    const cheer = mood === 'cheer';
    const sad = mood === 'sad';
    const hop = cheer ? Math.abs(Math.sin(t * 5.2)) * u * 0.07 : 0;
    const breathe = Math.sin(t * 2.2) * u * 0.007;

    ctx.save();
    ctx.translate(x, y);
    const sh = 1 - hop / (u * 0.25);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ell(ctx, 0, u * 0.012, u * 0.27 * sh, u * 0.065 * sh);
    ctx.fill();
    ctx.translate(0, -hop);

    const sy = -0.57 * u + breathe;
    const hy = -0.21 * u;

    // 腿和凉鞋
    cap(ctx, -0.078 * u, hy - 0.05 * u, -0.082 * u, -0.045 * u, u * 0.086, look.skin);
    cap(ctx, 0.078 * u, hy - 0.05 * u, 0.082 * u, -0.045 * u, u * 0.086, look.skin);
    ctx.fillStyle = '#6b4a2b';
    ell(ctx, -0.09 * u, -0.02 * u, 0.07 * u, 0.034 * u);
    ctx.fill();
    ell(ctx, 0.09 * u, -0.02 * u, 0.07 * u, 0.034 * u);
    ctx.fill();

    // 背后的头发要先画，才会被身体挡住
    const hcy = -0.775 * u + breathe * 1.3 + (sad ? 0.012 * u : 0);
    const R = 0.205 * u;
    ctx.fillStyle = look.hair;
    if (look.style === 'braid') {
      for (let i = 0; i < 5; i++) {
        ell(ctx, R * 0.92 + i * 0.008 * u, hcy + R * 0.5 + i * 0.062 * u, (0.05 - i * 0.004) * u, 0.042 * u);
        ctx.fill();
      }
    }
    if (look.style === 'curly') {
      for (let i = 0; i < 13; i++) {
        const a = Math.PI * 0.82 + i * (Math.PI * 1.36 / 12);
        ell(ctx, Math.cos(a) * R * 0.95, hcy + Math.sin(a) * R * 0.92, R * 0.3, R * 0.3);
        ctx.fill();
      }
    }
    if (look.style === 'bun') {
      ell(ctx, 0, hcy - R * 1.05, R * 0.42, R * 0.4);
      ctx.fill();
    }

    // 衣服
    tunicPath(ctx, u, sy, hy, 0);
    ctx.fillStyle = look.tunic;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.09)';
    ctx.fillRect(0.07 * u, sy, 0.2 * u, 0.5 * u);
    ctx.fillStyle = look.trim;
    ctx.fillRect(-0.25 * u, hy - 0.022 * u, 0.5 * u, 0.09 * u);
    // 领口
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.moveTo(-0.055 * u, sy - 0.01 * u);
    ctx.lineTo(0, sy + 0.07 * u);
    ctx.lineTo(0.055 * u, sy - 0.01 * u);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = look.sash;
    rr(ctx, -0.172 * u, -0.41 * u, 0.344 * u, 0.05 * u, 0.02 * u);
    ctx.fill();
    ribbon(ctx, 0.13 * u, -0.385 * u, 0.1 * u, t * 3, look.sash, u * 0.034, 1.1);

    // 斜挎的书卷袋（从正面看在另一侧）
    cap(ctx, 0.12 * u, sy + 0.02 * u, -0.15 * u, -0.34 * u, u * 0.028, '#7a5230');
    if (!cheer) scroll(ctx, -0.2 * u, -0.37 * u, u * 0.9, -0.38);
    ctx.fillStyle = '#8c6239';
    rr(ctx, -0.25 * u, -0.35 * u, 0.15 * u, 0.13 * u, 0.035 * u);
    ctx.fill();
    ctx.fillStyle = '#6f4a28';
    rr(ctx, -0.25 * u, -0.35 * u, 0.15 * u, 0.05 * u, 0.03 * u);
    ctx.fill();

    // 胳膊
    function arm(side, hx, hY) {
      const ax = side * 0.163 * u;
      const ay = sy + 0.05 * u;
      cap(ctx, ax, ay, hx, hY, u * 0.068, look.skin);
      cap(ctx, ax, ay, ax + (hx - ax) * 0.4, ay + (hY - ay) * 0.4, u * 0.088, look.tunic);
      ctx.fillStyle = look.skin;
      ell(ctx, hx, hY, u * 0.042, u * 0.042);
      ctx.fill();
    }
    if (cheer) {
      const w = Math.sin(t * 10) * 0.012 * u;
      arm(-1, -0.27 * u + w, -0.86 * u);
      scroll(ctx, 0.29 * u - w, -0.95 * u, u * 1.05, 0.5 + Math.sin(t * 10) * 0.12);
      arm(1, 0.27 * u - w, -0.86 * u);
    } else if (mood === 'wave') {
      arm(-1, -0.215 * u, -0.34 * u);
      arm(1, (0.3 + Math.sin(t * 7) * 0.035) * u, -0.74 * u);
    } else if (sad) {
      arm(-1, -0.19 * u, -0.31 * u);
      arm(1, 0.19 * u, -0.31 * u);
    } else {
      const s = Math.sin(t * 2.2) * 0.006 * u;
      arm(-1, -0.215 * u - s, -0.34 * u);
      arm(1, 0.215 * u + s, -0.34 * u);
    }

    // 头
    ctx.fillStyle = look.skin;
    rr(ctx, -0.045 * u, sy - 0.055 * u, 0.09 * u, 0.08 * u, 0.02 * u);
    ctx.fill();
    ell(ctx, -R * 0.97, hcy + R * 0.1, R * 0.19, R * 0.25);
    ctx.fill();
    ell(ctx, R * 0.97, hcy + R * 0.1, R * 0.19, R * 0.25);
    ctx.fill();
    ell(ctx, 0, hcy, R, R * 0.98);
    ctx.fill();

    // 刘海
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.arc(0, hcy, R * 1.03, Math.PI * 1.02, Math.PI * 1.98);
    if (look.style === 'short') {
      ctx.lineTo(R * 0.7, hcy - R * 0.2);
      ctx.lineTo(R * 0.42, hcy - R * 0.5);
      ctx.lineTo(R * 0.16, hcy - R * 0.22);
      ctx.lineTo(-R * 0.1, hcy - R * 0.52);
      ctx.lineTo(-R * 0.4, hcy - R * 0.2);
      ctx.lineTo(-R * 0.68, hcy - R * 0.48);
    } else if (look.style === 'braid') {
      ctx.quadraticCurveTo(R * 0.55, hcy - R * 0.5, -R * 0.15, hcy - R * 0.5);
      ctx.quadraticCurveTo(-R * 0.75, hcy - R * 0.45, -R * 1.0, hcy + R * 0.02);
    } else if (look.style === 'bun') {
      ctx.quadraticCurveTo(R * 0.6, hcy - R * 0.62, 0, hcy - R * 0.72);
      ctx.quadraticCurveTo(-R * 0.6, hcy - R * 0.62, -R * 1.0, hcy - R * 0.05);
    } else {
      ctx.quadraticCurveTo(R * 0.5, hcy - R * 0.36, 0, hcy - R * 0.44);
      ctx.quadraticCurveTo(-R * 0.5, hcy - R * 0.36, -R * 1.0, hcy - R * 0.05);
    }
    ctx.closePath();
    ctx.fill();
    if (look.style === 'curly') {
      for (let i = 0; i < 7; i++) {
        ell(ctx, (-0.84 + i * 0.28) * R, hcy - R * (0.5 + Math.sin(i * 1.3) * 0.06), R * 0.24, R * 0.22);
        ctx.fill();
      }
    }

    // 头带，结打在一侧
    ctx.strokeStyle = look.band;
    ctx.lineWidth = u * 0.04;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(-R * 0.985, hcy - R * 0.3);
    ctx.quadraticCurveTo(0, hcy - R * 0.74, R * 0.985, hcy - R * 0.3);
    ctx.stroke();
    ribbon(ctx, R * 0.98, hcy - R * 0.28, R * 0.55, t * 3.4, look.band, u * 0.028, 1.5);
    ribbon(ctx, R * 0.98, hcy - R * 0.28, R * 0.32, t * 3.4 + 1.3, look.band, u * 0.026, 2.4);
    ctx.fillStyle = look.band;
    ell(ctx, R * 0.98, hcy - R * 0.3, R * 0.13, R * 0.13);
    ctx.fill();

    // 脸
    const ey = hcy + R * 0.2;
    const ex = R * 0.4;
    const blinkT = (t + hash(look.tunic.length + look.name.length) * 3) % 3.4;
    const blink = blinkT > 3.26 ? 0.12 : 1;
    ctx.fillStyle = 'rgba(240,110,110,.36)';
    ell(ctx, -R * 0.62, ey + R * 0.3, R * 0.19, R * 0.12);
    ctx.fill();
    ell(ctx, R * 0.62, ey + R * 0.3, R * 0.19, R * 0.12);
    ctx.fill();

    ctx.strokeStyle = '#2a1c14';
    ctx.fillStyle = '#2a1c14';
    ctx.lineCap = 'round';
    if (cheer) {
      // 笑成两道弯
      ctx.lineWidth = R * 0.09;
      ctx.beginPath();
      ctx.arc(-ex, ey + R * 0.06, R * 0.15, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey + R * 0.06, R * 0.15, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.fillStyle = '#7a2d2d';
      ctx.beginPath();
      ctx.arc(0, ey + R * 0.3, R * 0.24, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ef8a8d';
      ell(ctx, 0, ey + R * 0.46, R * 0.12, R * 0.07);
      ctx.fill();
    } else {
      ell(ctx, -ex, ey, R * 0.125, R * 0.175 * blink);
      ctx.fill();
      ell(ctx, ex, ey, R * 0.125, R * 0.175 * blink);
      ctx.fill();
      if (blink === 1) {
        ctx.fillStyle = '#ffffff';
        ell(ctx, -ex + R * 0.04, ey - R * 0.06, R * 0.045, R * 0.045);
        ctx.fill();
        ell(ctx, ex + R * 0.04, ey - R * 0.06, R * 0.045, R * 0.045);
        ctx.fill();
      }
      ctx.lineWidth = R * 0.08;
      ctx.beginPath();
      if (sad) {
        ctx.arc(0, ey + R * 0.52, R * 0.16, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        // 八字眉
        ctx.lineWidth = R * 0.07;
        ctx.beginPath();
        ctx.moveTo(-ex - R * 0.16, ey - R * 0.2);
        ctx.lineTo(-ex + R * 0.14, ey - R * 0.32);
        ctx.moveTo(ex + R * 0.16, ey - R * 0.2);
        ctx.lineTo(ex - R * 0.14, ey - R * 0.32);
        ctx.stroke();
      } else {
        ctx.arc(0, ey + R * 0.22, R * 0.2, Math.PI * 0.18, Math.PI * 0.82);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ================= 路边的东西 =================
   * x, y 是落地点；k 是这一层「一个单位」有多少像素（越远越小）。
   */

  function shadow(ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(40,26,10,.17)';
    ell(ctx, x, y, rx, ry);
    ctx.fill();
  }

  function drawPalm(ctx, x, y, k, seed, t) {
    const lean = (hash(seed) - 0.5) * 0.5 * k;
    const tx = x + lean;
    const ty = y - (1.55 + hash(seed + 1) * 0.5) * k;
    shadow(ctx, x + 0.2 * k, y, 0.5 * k, 0.08 * k);
    ctx.strokeStyle = '#8a5a34';
    ctx.lineWidth = Math.max(1.5, 0.12 * k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * 0.1, y - 0.8 * k, tx, ty);
    ctx.stroke();
    const sway = Math.sin(t * 1.4 + seed * 7) * 0.07;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.5 + sway * (1 + Math.abs(i - 3) * 0.3);
      const len = (0.62 + hash(seed + i * 3.3) * 0.25) * k;
      const ex = tx + Math.cos(a) * len;
      const ey = ty + Math.sin(a) * len * 0.6 + Math.abs(Math.cos(a)) * 0.36 * k;
      const mx = tx + Math.cos(a) * len * 0.5;
      const my = ty + Math.sin(a) * len * 0.75 - 0.12 * k;
      ctx.fillStyle = i % 2 ? '#3f9a5a' : '#2f8249';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(mx, my - 0.1 * k, ex, ey);
      ctx.quadraticCurveTo(mx, my + 0.12 * k, tx, ty);
      ctx.fill();
    }
    ctx.fillStyle = '#6b3f22';
    ell(ctx, tx - 0.05 * k, ty + 0.06 * k, 0.055 * k, 0.055 * k);
    ctx.fill();
    ell(ctx, tx + 0.06 * k, ty + 0.08 * k, 0.05 * k, 0.05 * k);
    ctx.fill();
  }

  function drawTent(ctx, x, y, k, seed) {
    const w = 0.8 * k;
    const h = 0.85 * k;
    const stripe = hash(seed) > 0.5 ? '#c4553f' : '#7a5aa8';
    shadow(ctx, x + 0.1 * k, y, w * 1.05, 0.09 * k);
    ctx.fillStyle = '#f1e4c6';
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x - w * 0.28, y - h);
    ctx.lineTo(x + w * 0.28, y - h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = stripe;
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const bx = x + i * w * 0.36;
      const top = x + i * w * 0.1;
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.06, y);
      ctx.lineTo(top - w * 0.02, y - h);
      ctx.lineTo(top + w * 0.02, y - h);
      ctx.lineTo(bx + w * 0.06, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    ctx.fillRect(x + w * 0.2, y - h, w, h);
    ctx.restore();
    ctx.fillStyle = '#4a3423';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.2, y);
    ctx.lineTo(x, y - h * 0.62);
    ctx.lineTo(x + w * 0.2, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = Math.max(1, 0.03 * k);
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x, y - h - 0.22 * k);
    ctx.stroke();
    ctx.fillStyle = stripe;
    ctx.beginPath();
    ctx.moveTo(x, y - h - 0.22 * k);
    ctx.lineTo(x + 0.16 * k, y - h - 0.17 * k);
    ctx.lineTo(x, y - h - 0.11 * k);
    ctx.closePath();
    ctx.fill();
  }

  function drawRock(ctx, x, y, k, seed) {
    const w = (0.22 + hash(seed) * 0.2) * k;
    const h = w * (0.55 + hash(seed + 2) * 0.3);
    shadow(ctx, x + 0.05 * k, y, w * 1.2, 0.05 * k);
    ctx.fillStyle = '#b9a48a';
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x - w * 0.7, y - h * 0.7);
    ctx.lineTo(x - w * 0.1, y - h);
    ctx.lineTo(x + w * 0.6, y - h * 0.8);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.13)';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.1, y - h);
    ctx.lineTo(x + w * 0.6, y - h * 0.8);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w * 0.15, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawJar(ctx, x, y, k) {
    shadow(ctx, x + 0.04 * k, y, 0.2 * k, 0.045 * k);
    ctx.fillStyle = '#c97c4a';
    ell(ctx, x, y - 0.2 * k, 0.15 * k, 0.2 * k);
    ctx.fill();
    rr(ctx, x - 0.06 * k, y - 0.47 * k, 0.12 * k, 0.12 * k, 0.02 * k);
    ctx.fill();
    ctx.fillStyle = '#a85f33';
    rr(ctx, x - 0.085 * k, y - 0.5 * k, 0.17 * k, 0.045 * k, 0.02 * k);
    ctx.fill();
    ctx.fillRect(x - 0.145 * k, y - 0.24 * k, 0.29 * k, 0.035 * k);
  }

  function drawSheep(ctx, x, y, k, seed, t) {
    const hop = Math.max(0, Math.sin(t * 3 + seed * 9)) * 0.03 * k;
    const dir = hash(seed) > 0.5 ? 1 : -1;
    shadow(ctx, x, y, 0.24 * k, 0.045 * k);
    ctx.fillStyle = '#3b2f2a';
    for (let i = -1; i <= 1; i += 2) {
      ctx.fillRect(x + i * 0.1 * k - 0.02 * k, y - 0.13 * k - hop, 0.04 * k, 0.13 * k);
    }
    ctx.fillStyle = '#fbf7ee';
    ell(ctx, x - 0.09 * k, y - 0.22 * k - hop, 0.12 * k, 0.11 * k);
    ctx.fill();
    ell(ctx, x + 0.07 * k, y - 0.23 * k - hop, 0.13 * k, 0.12 * k);
    ctx.fill();
    ell(ctx, x, y - 0.29 * k - hop, 0.13 * k, 0.1 * k);
    ctx.fill();
    ctx.fillStyle = '#3b2f2a';
    ell(ctx, x + dir * 0.2 * k, y - 0.27 * k - hop, 0.065 * k, 0.075 * k);
    ctx.fill();
  }

  function drawShrub(ctx, x, y, k, seed, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      ell(ctx, x + (i - 1.5) * 0.09 * k, y - (0.07 + hash(seed + i) * 0.07) * k, 0.1 * k, 0.1 * k);
      ctx.fill();
    }
  }

  function drawHouse(ctx, x, y, k, seed) {
    const w = (0.55 + hash(seed) * 0.2) * k;
    const h = (0.8 + hash(seed + 1) * 0.35) * k;
    const dome = hash(seed + 2) > 0.5;
    shadow(ctx, x + 0.12 * k, y, w * 1.15, 0.08 * k);
    ctx.fillStyle = '#f3e8d0';
    ctx.fillRect(x - w, y - h, w * 2, h);
    ctx.fillStyle = '#dccdae';
    ctx.fillRect(x + w * 0.45, y - h, w * 0.55, h);
    ctx.fillStyle = '#e6d7b6';
    ctx.fillRect(x - w * 1.06, y - h - 0.07 * k, w * 2.12, 0.1 * k);
    if (dome) {
      ctx.fillStyle = '#efe2c6';
      ctx.beginPath();
      ctx.arc(x - w * 0.25, y - h - 0.07 * k, w * 0.48, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      // 屋顶上晾着的布
      ctx.fillStyle = hash(seed + 5) > 0.5 ? '#d9675a' : '#5f8fd9';
      ctx.fillRect(x - w * 0.6, y - h - 0.27 * k, w * 0.7, 0.2 * k);
      ctx.fillStyle = '#6b4a2b';
      ctx.fillRect(x - w * 0.62, y - h - 0.3 * k, 0.025 * k, 0.25 * k);
      ctx.fillRect(x + w * 0.1, y - h - 0.3 * k, 0.025 * k, 0.25 * k);
    }
    // 门
    ctx.fillStyle = '#6b4a2b';
    const dw = 0.14 * k;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.35 - dw, y);
    ctx.lineTo(x - w * 0.35 - dw, y - 0.3 * k);
    ctx.arc(x - w * 0.35, y - 0.3 * k, dw, Math.PI, 0);
    ctx.lineTo(x - w * 0.35 + dw, y);
    ctx.closePath();
    ctx.fill();
    // 窗
    ctx.fillStyle = '#4a6c9c';
    rr(ctx, x + w * 0.1, y - h * 0.68, 0.16 * k, 0.2 * k, 0.07 * k);
    ctx.fill();
  }

  function drawOlive(ctx, x, y, k, seed) {
    shadow(ctx, x + 0.1 * k, y, 0.55 * k, 0.08 * k);
    ctx.strokeStyle = '#6d4c2e';
    ctx.lineWidth = Math.max(1.5, 0.16 * k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 0.1 * k, y - 0.3 * k, x + 0.04 * k, y - 0.62 * k);
    ctx.stroke();
    const greens = ['#7fa069', '#6c8f57', '#8fae78'];
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = greens[i % 3];
      ell(ctx, x + (hash(seed + i) - 0.5) * 0.7 * k, y - (0.72 + hash(seed + i * 2.1) * 0.4) * k, (0.26 + hash(seed + i * 5) * 0.12) * k, 0.24 * k);
      ctx.fill();
    }
  }

  function drawCypress(ctx, x, y, k) {
    shadow(ctx, x + 0.05 * k, y, 0.2 * k, 0.05 * k);
    ctx.fillStyle = '#6d4c2e';
    ctx.fillRect(x - 0.03 * k, y - 0.2 * k, 0.06 * k, 0.2 * k);
    ctx.fillStyle = '#3d7a55';
    ctx.beginPath();
    ctx.moveTo(x, y - 1.5 * k);
    ctx.quadraticCurveTo(x + 0.26 * k, y - 0.6 * k, x + 0.12 * k, y - 0.14 * k);
    ctx.lineTo(x - 0.12 * k, y - 0.14 * k);
    ctx.quadraticCurveTo(x - 0.26 * k, y - 0.6 * k, x, y - 1.5 * k);
    ctx.fill();
  }

  function drawWell(ctx, x, y, k) {
    shadow(ctx, x + 0.05 * k, y, 0.35 * k, 0.06 * k);
    ctx.fillStyle = '#b3a590';
    ctx.fillRect(x - 0.25 * k, y - 0.3 * k, 0.5 * k, 0.3 * k);
    ctx.fillStyle = '#978a76';
    ell(ctx, x, y - 0.3 * k, 0.25 * k, 0.07 * k);
    ctx.fill();
    ctx.fillStyle = '#3f6fa8';
    ell(ctx, x, y - 0.3 * k, 0.18 * k, 0.045 * k);
    ctx.fill();
    ctx.strokeStyle = '#6d4c2e';
    ctx.lineWidth = Math.max(1, 0.04 * k);
    ctx.beginPath();
    ctx.moveTo(x - 0.22 * k, y - 0.3 * k);
    ctx.lineTo(x - 0.22 * k, y - 0.78 * k);
    ctx.lineTo(x + 0.22 * k, y - 0.78 * k);
    ctx.lineTo(x + 0.22 * k, y - 0.3 * k);
    ctx.stroke();
  }

  function drawBoat(ctx, x, y, k, seed, t) {
    const bobY = Math.sin(t * 1.8 + seed * 5) * 0.03 * k;
    const yy = y + bobY;
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = Math.max(1, 0.025 * k);
    ctx.beginPath();
    ctx.moveTo(x - 0.5 * k, y + 0.03 * k);
    ctx.lineTo(x + 0.5 * k, y + 0.03 * k);
    ctx.stroke();
    ctx.fillStyle = '#8c5a34';
    ctx.beginPath();
    ctx.moveTo(x - 0.45 * k, yy - 0.16 * k);
    ctx.quadraticCurveTo(x, yy + 0.12 * k, x + 0.45 * k, yy - 0.16 * k);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6d4c2e';
    ctx.lineWidth = Math.max(1, 0.03 * k);
    ctx.beginPath();
    ctx.moveTo(x, yy - 0.12 * k);
    ctx.lineTo(x, yy - 0.82 * k);
    ctx.stroke();
    ctx.fillStyle = '#fbf3df';
    ctx.beginPath();
    ctx.moveTo(x + 0.03 * k, yy - 0.8 * k);
    ctx.lineTo(x + 0.4 * k, yy - 0.24 * k);
    ctx.lineTo(x + 0.03 * k, yy - 0.24 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e4d5b2';
    ctx.beginPath();
    ctx.moveTo(x - 0.03 * k, yy - 0.7 * k);
    ctx.lineTo(x - 0.28 * k, yy - 0.24 * k);
    ctx.lineTo(x - 0.03 * k, yy - 0.24 * k);
    ctx.closePath();
    ctx.fill();
  }

  const LEFT_KINDS = ['palm', 'tent', 'rock', 'palm', 'jar', 'sheep', 'shrub', 'palm', 'tent', 'sheep'];
  const RIGHT_KINDS = ['house', 'olive', 'cypress', 'house', 'well', 'olive', 'shrub', 'house', 'cypress', 'olive'];

  function drawProp(ctx, kind, x, y, k, seed, t) {
    if (kind === 'palm') drawPalm(ctx, x, y, k, seed, t);
    else if (kind === 'tent') drawTent(ctx, x, y, k, seed);
    else if (kind === 'rock') drawRock(ctx, x, y, k, seed);
    else if (kind === 'jar') drawJar(ctx, x, y, k);
    else if (kind === 'sheep') drawSheep(ctx, x, y, k, seed, t);
    else if (kind === 'house') drawHouse(ctx, x, y, k, seed);
    else if (kind === 'olive') drawOlive(ctx, x, y, k, seed);
    else if (kind === 'cypress') drawCypress(ctx, x, y, k);
    else if (kind === 'well') drawWell(ctx, x, y, k);
    else if (kind === 'boat') drawBoat(ctx, x, y, k, seed, t);
    else drawShrub(ctx, x, y, k, seed, kind === 'shrubL' ? '#b9a25c' : '#6fa35f');
  }

  /* ================= 一天里的四段天色 ================= */

  const SKIES = [
    { name: '清晨', top: '#6fb6ee', bot: '#fde9c9', sunX: 0.24, sunY: 0.72, sun: '#fff3cf', glow: '#ffd98a', tint: '#ffcf8a', tintA: 0.05, night: 0 },
    { name: '正午', top: '#3d93e6', bot: '#cfeafc', sunX: 0.62, sunY: 0.18, sun: '#ffffff', glow: '#fff6c9', tint: '#ffffff', tintA: 0, night: 0 },
    { name: '黄昏', top: '#5a4ea8', bot: '#ffb877', sunX: 0.78, sunY: 0.8, sun: '#ffe0a3', glow: '#ff9d5c', tint: '#ff7a2f', tintA: 0.13, night: 0 },
    { name: '夜晚', top: '#0b1340', bot: '#33407f', sunX: 0.3, sunY: 0.22, sun: '#f4f1de', glow: '#aeb9ff', tint: '#101a5c', tintA: 0.34, night: 1 }
  ];

  /* ================= 引擎 ================= */

  function create(canvas, hooks) {
    const ctx = canvas.getContext('2d');
    hooks = hooks || {};
    let font = 'sans-serif';
    try { font = window.getComputedStyle(document.body).fontFamily || font; } catch (e) { /* 用默认字体 */ }

    let W = 1, H = 1, dpr = 1;
    let cx = 0, horizonY = 0, baseY = 0, roadHalf = 1, sBottom = 1;
    let raf = 0, alive = false, last = 0, time = 0;

    const S = {};
    let props = [];
    let particles = [];
    let clouds = [];
    let seedCounter = 1;

    function resetState(look) {
      S.look = look || S.look || LOOKS[0];
      S.v = 0;            // 现在的速度
      S.vTarget = 0;      // 想达到的速度
      S.dist = 0;
      S.lane = 0;         // -1 左，0 中，1 右
      S.x = 0;
      S.lean = 0;
      S.phase = 0;
      S.pose = 'idle';
      S.poseT = 0;
      S.gate = null;
      S.finish = null;
      S.shake = 0;
      S.slow = 1;
      S.canChoose = false;
      S.laneBackAt = 0;
      S.skyFrom = S.skyTo === undefined ? 0 : S.skyTo;
      S.skyTo = S.skyTo === undefined ? 0 : S.skyTo;
      S.skyT = 1;
      S.stepSide = 1;
      S.glow = 0;         // 连击的势头：大于 0 时身后拖出星星
      S.glowT = 0;
      particles = [];
      props = [];
      // 两边先摆好一路的东西
      for (let z = 1.5; z < Z_FAR; z += 2.6) {
        props.push(makeProp(-1, z + hash(z) * 1.2));
        props.push(makeProp(1, z + 1.3 + hash(z + 9) * 1.2));
      }
      for (let i = 0; i < 3; i++) props.push(makeBoat(6 + i * 9));
    }

    function makeProp(side, z) {
      const seed = seedCounter++;
      const kinds = side < 0 ? LEFT_KINDS : RIGHT_KINDS;
      let kind = kinds[Math.floor(hash(seed * 1.7) * kinds.length)];
      if (kind === 'shrub') kind = side < 0 ? 'shrubL' : 'shrubR';
      const big = kind === 'house' || kind === 'tent';
      const xMax = side > 0 ? SHORE - 0.3 : 3.4;
      const x = side * (1.62 + (big ? 0.22 : 0) + hash(seed * 3.1) * (xMax - 1.9));
      return { side: side, x: x, z: z, kind: kind, seed: seed };
    }

    function makeBoat(z) {
      const seed = seedCounter++;
      return { side: 1, x: SHORE + 1.2 + hash(seed) * 2.6, z: z, kind: 'boat', seed: seed, boat: true };
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      cx = W / 2;
      horizonY = H * 0.37;
      baseY = H * 0.8;
      roadHalf = Math.min(W * 0.36, (H - horizonY) * 0.52);
      sBottom = (H - horizonY) / (baseY - horizonY);
      if (!clouds.length) {
        for (let i = 0; i < 6; i++) {
          clouds.push({ x: hash(i * 3.3), y: 0.08 + hash(i * 7.7) * 0.5, s: 0.6 + hash(i * 1.9) * 0.8, v: 0.004 + hash(i * 5.1) * 0.006 });
        }
      }
      if (!alive) draw();
    }

    function scaleAt(z) { return D / (D + z); }
    function camX() { return S.x * 0.32; }
    function px(x, z) { return cx + (x - camX()) * roadHalf * scaleAt(z); }
    function py(z) { return horizonY + (baseY - horizonY) * scaleAt(z); }

    /* ---------- 粒子 ---------- */

    function burst(x, y, n, colors, power) {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const sp = (0.35 + Math.random() * 0.75) * power;
        particles.push({
          kind: 'star', x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.25,
          g: power * 1.7, life: 0.7 + Math.random() * 0.5, age: 0,
          r: roadHalf * (0.035 + Math.random() * 0.04), rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 9,
          color: colors[i % colors.length]
        });
      }
    }

    function confetti() {
      const colors = [C.ot, C.nt, C.ok, C.bad, '#ffffff', '#ffd166'];
      for (let i = 0; i < 90; i++) {
        const fromLeft = i % 2 === 0;
        particles.push({
          kind: 'paper', x: fromLeft ? -10 : W + 10, y: H * (0.35 + Math.random() * 0.2),
          vx: (fromLeft ? 1 : -1) * W * (0.25 + Math.random() * 0.55), vy: -H * (0.25 + Math.random() * 0.5),
          g: H * 0.9, life: 1.6 + Math.random() * 1.2, age: 0,
          r: roadHalf * (0.028 + Math.random() * 0.02), rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12,
          color: colors[i % colors.length]
        });
      }
    }

    function dust(x, y) {
      particles.push({
        kind: 'dust', x: x, y: y, vx: (Math.random() - 0.5) * roadHalf * 0.3, vy: roadHalf * 0.25,
        g: 0, life: 0.38, age: 0, r: roadHalf * 0.035, rot: 0, vr: 0, color: 'rgba(226,205,165,'
      });
    }

    /* ---------- 每一帧先算再画 ---------- */

    function setPose(p) {
      S.pose = p;
      S.poseT = 0;
    }

    function judge(g) {
      g.judged = true;
      S.canChoose = false;
      const res = (hooks.onGate && hooks.onGate(S.lane)) || {};
      g.ok = !!res.ok;
      g.correct = res.correct || 0;
      g.chosen = S.lane;
      g.flash = 1;
      S.laneBackAt = time + 0.42;
      const bx = px(S.x, 0);
      if (g.ok) {
        setPose('hop');
        burst(bx, baseY - roadHalf * 0.5, 16, [S.lane < 0 ? C.ot : C.nt, '#ffffff', '#ffd166'], roadHalf * 2.6);
      } else {
        setPose('tumble');
        S.shake = 1;
        S.slow = 0.3;
        burst(bx, baseY - roadHalf * 0.4, 8, ['#ff8a80', '#ffffff'], roadHalf * 1.8);
      }
    }

    function update(dt) {
      time += dt;
      // 摔倒后的慢动作会慢慢恢复
      S.slow += (1 - S.slow) * Math.min(1, dt * 1.6);
      const sdt = dt * S.slow;

      S.v += (S.vTarget - S.v) * Math.min(1, dt * 3.2);
      const dz = S.v * sdt;
      S.dist += dz;

      const moving = S.v > 0.4 && S.pose !== 'cheer' && S.pose !== 'down' && S.pose !== 'idle';
      if (moving) {
        const before = Math.cos(S.phase) > 0;
        S.phase += Math.min(19, 7 + S.v * 1.15) * sdt;
        // 每落一步扬一点土
        if ((Math.cos(S.phase) > 0) !== before && S.pose === 'run') {
          S.stepSide = -S.stepSide;
          dust(px(S.x, 0) + S.stepSide * roadHalf * 0.07, baseY);
        }
      }

      if (S.glow > 0 && moving) {
        S.glowT -= dt;
        if (S.glowT <= 0) {
          S.glowT = 0.07;
          const u = roadHalf * 0.86;
          particles.push({
            kind: 'star', x: px(S.x, 0) + (Math.random() - 0.5) * u * 0.34, y: baseY - u * (0.2 + Math.random() * 0.5),
            vx: (Math.random() - 0.5) * u * 0.3, vy: u * (0.55 + Math.random() * 0.5),
            g: 0, life: 0.5 + Math.random() * 0.25, age: 0,
            r: u * (0.035 + Math.random() * 0.035) * Math.min(1.6, 0.8 + S.glow * 0.1), rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 8,
            color: Math.random() < 0.5 ? '#ffd166' : '#ffffff'
          });
        }
      }

      if (S.laneBackAt && time >= S.laneBackAt) {
        S.laneBackAt = 0;
        S.lane = 0;
      }
      const tx = S.lane * LANE_X;
      S.x += (tx - S.x) * Math.min(1, dt * 14);
      S.lean += ((tx - S.x) * 2.4 - S.lean) * Math.min(1, dt * 12);

      S.poseT += dt;
      if (S.pose === 'hop' && S.poseT > 0.46) setPose('run');
      if (S.pose === 'tumble' && S.poseT > 1.35) setPose('run');

      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        p.z -= dz;
        if (p.z < Z_NEAR) props[i] = p.boat ? makeBoat(p.z + Z_FAR - Z_NEAR) : makeProp(p.side, p.z + Z_FAR - Z_NEAR);
      }

      if (S.gate) {
        const g = S.gate;
        g.z -= dz;
        g.flash = Math.max(0, g.flash - dt * 1.5);
        if (!g.judged && g.z <= 0) judge(g);
        if (g.z < Z_NEAR) S.gate = null;
      }

      if (S.finish) {
        const f = S.finish;
        f.z -= dz;
        if (!f.crossed && f.z <= 0) {
          f.crossed = true;
          S.vTarget = 0;
          setPose('cheer');
          confetti();
          if (hooks.onFinish) hooks.onFinish();
        }
        if (f.z < Z_NEAR) S.finish = null;
      }

      S.shake = Math.max(0, S.shake - dt * 2.4);
      if (S.skyT < 1) S.skyT = Math.min(1, S.skyT + dt * 0.45);

      for (let i = 0; i < clouds.length; i++) {
        clouds[i].x += clouds[i].v * dt * (1 + S.v * 0.05);
        if (clouds[i].x > 1.2) clouds[i].x = -0.2;
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }

    /* ---------- 画：天空和远景 ---------- */

    function skyNow() {
      const a = SKIES[S.skyFrom % 4];
      const b = SKIES[S.skyTo % 4];
      const t = S.skyT;
      return {
        top: mix(a.top, b.top, t), bot: mix(a.bot, b.bot, t),
        sun: mix(a.sun, b.sun, t), glow: mix(a.glow, b.glow, t),
        sunX: a.sunX + (b.sunX - a.sunX) * t, sunY: a.sunY + (b.sunY - a.sunY) * t,
        tint: mix(a.tint, b.tint, t), tintA: a.tintA + (b.tintA - a.tintA) * t,
        night: a.night + (b.night - a.night) * t
      };
    }

    function drawSky(g, sky) {
      const grad = g.createLinearGradient(0, 0, 0, horizonY);
      grad.addColorStop(0, sky.top);
      grad.addColorStop(1, sky.bot);
      g.fillStyle = grad;
      g.fillRect(-20, -20, W + 40, horizonY + 22);

      if (sky.night > 0.05) {
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 46; i++) {
          const tw = 0.55 + 0.45 * Math.sin(time * 2.2 + i * 1.7);
          g.globalAlpha = sky.night * tw * 0.9;
          const r = 0.8 + hash(i * 2.3) * 1.4;
          ell(g, hash(i * 5.1) * W, hash(i * 9.7) * horizonY * 0.9, r, r);
          g.fill();
        }
        g.globalAlpha = 1;
      }

      // 太阳（夜里就是月亮）
      const sx = W * sky.sunX;
      const sy = horizonY * sky.sunY;
      const sr = Math.min(W, H) * 0.05;
      const halo = g.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 4.2);
      halo.addColorStop(0, sky.glow);
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = 0.55;
      g.fillStyle = halo;
      ell(g, sx, sy, sr * 4.2, sr * 4.2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = sky.sun;
      ell(g, sx, sy, sr, sr);
      g.fill();

      // 云
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        const x = c.x * W;
        const y = c.y * horizonY;
        const s = c.s * Math.min(W, H) * 0.06;
        g.globalAlpha = 0.9 - sky.night * 0.62;
        g.fillStyle = '#ffffff';
        ell(g, x, y, s * 1.5, s * 0.5);
        g.fill();
        ell(g, x - s * 0.5, y - s * 0.3, s * 0.7, s * 0.55);
        g.fill();
        ell(g, x + s * 0.35, y - s * 0.42, s * 0.8, s * 0.62);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function drawBackdrop(g) {
      const ox = -camX() * roadHalf * 0.06;
      const hz = horizonY + 1;
      const u = Math.min(W * 0.5, H * 0.62);     // 远景的尺寸跟着屏幕里较短的一边走

      // 左边远处：两座金字塔，再近一点是西奈山
      g.fillStyle = '#e6cb93';
      g.beginPath();
      g.moveTo(cx - u * 0.98 + ox, hz); g.lineTo(cx - u * 0.84 + ox, hz - u * 0.13); g.lineTo(cx - u * 0.7 + ox, hz);
      g.closePath(); g.fill();
      g.fillStyle = '#cfb074';
      g.beginPath();
      g.moveTo(cx - u * 0.84 + ox, hz - u * 0.13); g.lineTo(cx - u * 0.7 + ox, hz); g.lineTo(cx - u * 0.78 + ox, hz);
      g.closePath(); g.fill();
      g.fillStyle = '#dcc189';
      g.beginPath();
      g.moveTo(cx - u * 1.12 + ox, hz); g.lineTo(cx - u * 1.02 + ox, hz - u * 0.085); g.lineTo(cx - u * 0.92 + ox, hz);
      g.closePath(); g.fill();

      g.fillStyle = '#c4a184';
      g.beginPath();
      g.moveTo(cx - u * 0.74 + ox, hz);
      g.lineTo(cx - u * 0.52 + ox, hz - u * 0.2);
      g.lineTo(cx - u * 0.44 + ox, hz - u * 0.15);
      g.lineTo(cx - u * 0.34 + ox, hz - u * 0.3);
      g.lineTo(cx - u * 0.22 + ox, hz - u * 0.12);
      g.lineTo(cx - u * 0.1 + ox, hz);
      g.closePath();
      g.fill();
      g.fillStyle = '#a98567';
      g.beginPath();
      g.moveTo(cx - u * 0.34 + ox, hz - u * 0.3);
      g.lineTo(cx - u * 0.22 + ox, hz - u * 0.12);
      g.lineTo(cx - u * 0.1 + ox, hz);
      g.lineTo(cx - u * 0.3 + ox, hz);
      g.closePath();
      g.fill();
      // 山顶的云
      g.fillStyle = 'rgba(255,255,255,.82)';
      ell(g, cx - u * 0.35 + ox, hz - u * 0.285, u * 0.1, u * 0.024);
      g.fill();
      ell(g, cx - u * 0.3 + ox, hz - u * 0.305, u * 0.06, u * 0.022);
      g.fill();

      // 右边远处：青山和山坡上的小镇
      g.fillStyle = '#9dbd97';
      g.beginPath();
      g.moveTo(cx + u * 0.08 + ox, hz);
      g.quadraticCurveTo(cx + u * 0.32 + ox, hz - u * 0.17, cx + u * 0.56 + ox, hz - u * 0.06);
      g.quadraticCurveTo(cx + u * 0.82 + ox, hz - u * 0.2, cx + u * 1.2 + ox, hz - u * 0.03);
      g.lineTo(cx + u * 1.2 + ox, hz);
      g.closePath();
      g.fill();
      g.fillStyle = '#84ab85';
      g.beginPath();
      g.moveTo(cx + u * 0.18 + ox, hz);
      g.quadraticCurveTo(cx + u * 0.46 + ox, hz - u * 0.085, cx + u * 0.78 + ox, hz);
      g.closePath();
      g.fill();
      // 小镇
      const tx = cx + u * 0.34 + ox;
      const ty = hz - u * 0.06;
      g.fillStyle = '#f4ead4';
      g.fillRect(tx - u * 0.07, ty - u * 0.05, u * 0.045, u * 0.06);
      g.fillRect(tx - u * 0.02, ty - u * 0.075, u * 0.05, u * 0.085);
      g.fillRect(tx + u * 0.035, ty - u * 0.045, u * 0.045, u * 0.055);
      g.beginPath();
      g.arc(tx + u * 0.005, ty - u * 0.075, u * 0.024, Math.PI, 0);
      g.fill();
      g.fillStyle = '#d9cbac';
      g.fillRect(tx + u * 0.012, ty - u * 0.075, u * 0.018, u * 0.085);
      g.fillStyle = '#3d7a55';
      ell(g, tx + u * 0.1, ty - u * 0.03, u * 0.012, u * 0.045);
      g.fill();
      ell(g, tx - u * 0.095, ty - u * 0.022, u * 0.011, u * 0.04);
      g.fill();
    }

    /* ---------- 画：地面和路 ---------- */

    // 画地上一块「从 z1 到 z2、从 x1 到 x2」的四边形
    function groundQuad(g, x1, x2, z1, z2) {
      g.beginPath();
      g.moveTo(px(x1, z1), py(z1));
      g.lineTo(px(x2, z1), py(z1));
      g.lineTo(px(x2, z2), py(z2));
      g.lineTo(px(x1, z2), py(z2));
      g.closePath();
    }

    function drawGround(g) {
      const vx = cx;      // 所有线都汇到地平线正中
      // 左：沙地
      let grad = g.createLinearGradient(0, horizonY, 0, H);
      grad.addColorStop(0, '#edd6a6');
      grad.addColorStop(1, '#e0bb78');
      g.fillStyle = grad;
      g.fillRect(-20, horizonY, cx + 20, H - horizonY + 20);
      // 右：草地
      grad = g.createLinearGradient(0, horizonY, 0, H);
      grad.addColorStop(0, '#b5d394');
      grad.addColorStop(1, '#8fbd6c');
      g.fillStyle = grad;
      g.fillRect(cx, horizonY, W - cx + 20, H - horizonY + 20);

      // 右边再往外是湖
      const off = -camX() * roadHalf * sBottom;
      const shoreB = cx + SHORE * roadHalf * sBottom + off;
      const sandB = cx + (SHORE - 0.32) * roadHalf * sBottom + off;
      g.fillStyle = '#efe0b8';
      g.beginPath();
      g.moveTo(vx, horizonY); g.lineTo(sandB, H + 20); g.lineTo(W + 40, H + 20); g.lineTo(W + 40, horizonY);
      g.closePath(); g.fill();
      grad = g.createLinearGradient(0, horizonY, 0, H);
      grad.addColorStop(0, '#a9d8f2');
      grad.addColorStop(1, '#4f9fe0');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(vx, horizonY); g.lineTo(shoreB, H + 20); g.lineTo(W + 40, H + 20); g.lineTo(W + 40, horizonY);
      g.closePath(); g.fill();

      // 地上一道一道往后退的纹路，让人感觉到速度
      const gap = 3;
      const shift = S.dist % gap;
      for (let z = Z_NEAR + gap - shift; z < Z_FAR; z += gap) {
        const a = clamp((Z_FAR - z) / 6, 0, 1);
        g.fillStyle = 'rgba(170,120,50,' + (0.13 * a) + ')';
        groundQuad(g, -9, -1.1, z + 0.28, z);
        g.fill();
        g.fillStyle = 'rgba(60,120,60,' + (0.12 * a) + ')';
        groundQuad(g, 1.1, SHORE - 0.32, z + 0.28, z);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,' + (0.3 * a) + ')';
        groundQuad(g, SHORE + 0.3 + hash(Math.round((z + S.dist) / gap)) * 2, SHORE + 1.6 + hash(Math.round((z + S.dist) / gap) + 4) * 3, z + 0.1, z);
        g.fill();
      }
    }

    function drawRoad(g) {
      // 路是一个尖顶在地平线上的三角形
      function tri(half, color) {
        const b = half * roadHalf * sBottom;
        const off = -camX() * roadHalf * sBottom;
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(cx, horizonY);
        g.lineTo(cx + b + off, H + 20);
        g.lineTo(cx - b + off, H + 20);
        g.closePath();
        g.fill();
      }
      tri(1.1, '#bfa77a');
      tri(1.0, '#dfcba3');

      const gap = 2;
      const shift = S.dist % gap;
      for (let z = Z_NEAR + gap - shift; z < Z_FAR; z += gap) {
        const a = clamp((Z_FAR - z) / 6, 0, 1);
        if (Math.round((z + S.dist) / gap) % 2 === 0) {
          g.fillStyle = 'rgba(120,90,50,' + (0.07 * a) + ')';
          groundQuad(g, -1, 1, z + gap, z);
          g.fill();
        }
        g.fillStyle = 'rgba(120,90,50,' + (0.2 * a) + ')';
        groundQuad(g, -1, 1, z + 0.07, z);
        g.fill();
      }
    }

    /* ---------- 画：门 ---------- */

    function drawCarpet(g, gate) {
      // 门前两条道各铺一段颜色：左琥珀（旧约），右蓝（新约）
      const z2 = gate.z;
      const z1 = Math.max(0.05, gate.z - 9);
      if (z2 <= z1) return;
      const a = clamp((Z_FAR - gate.z) / 8, 0, 1) * 0.42;
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const za = z1 + (z2 - z1) * i / steps;
        const zb = z1 + (z2 - z1) * (i + 1) / steps;
        const fade = (i + 1) / steps;
        g.fillStyle = 'rgba(245,169,59,' + (a * fade) + ')';
        groundQuad(g, -1, -0.12, zb, za);
        g.fill();
        g.fillStyle = 'rgba(91,157,255,' + (a * fade) + ')';
        groundQuad(g, 0.12, 1, zb, za);
        g.fill();
      }
    }

    function drawGate(g, gate) {
      const s = scaleAt(gate.z);
      const k = roadHalf * s;
      const gx = px(0, gate.z);
      const gy = py(gate.z);
      const halfW = 1.2 * k;
      const doorH = 1.55 * k;
      const lintelH = 0.46 * k;
      const pw = 0.2 * k;
      const mw = 0.2 * k;

      // 离得很近、已经穿过去的时候慢慢变透明，免得把人挡住
      let alpha = clamp((Z_FAR - gate.z) / 3, 0, 1);
      if (gate.z < 0) alpha *= clamp(1 + gate.z / 0.55, 0, 1);
      if (alpha <= 0) return;
      g.save();
      g.globalAlpha = alpha;

      // 两扇门里的光
      const doors = [
        { side: -1, x0: gx - halfW + pw, x1: gx - mw / 2, c: [245, 169, 59] },
        { side: 1, x0: gx + mw / 2, x1: gx + halfW - pw, c: [91, 157, 255] }
      ];
      for (let i = 0; i < 2; i++) {
        const d = doors[i];
        const pulse = 0.5 + 0.12 * Math.sin(time * 5 + i);
        const grad = g.createLinearGradient(0, gy - doorH, 0, gy);
        grad.addColorStop(0, 'rgba(' + d.c.join(',') + ',' + (pulse + 0.12) + ')');
        grad.addColorStop(1, 'rgba(' + d.c.join(',') + ',0.14)');
        g.fillStyle = grad;
        g.fillRect(d.x0, gy - doorH, d.x1 - d.x0, doorH);
        if (gate.judged && gate.flash > 0) {
          if (gate.correct === d.side) {
            g.fillStyle = 'rgba(255,255,255,' + (gate.flash * 0.75) + ')';
            g.fillRect(d.x0, gy - doorH, d.x1 - d.x0, doorH);
          } else if (!gate.ok && gate.chosen === d.side) {
            g.fillStyle = 'rgba(255,70,70,' + (gate.flash * 0.6) + ')';
            g.fillRect(d.x0, gy - doorH, d.x1 - d.x0, doorH);
          }
        }
      }

      // 石柱
      function pillar(x, w) {
        g.fillStyle = '#dccbaa';
        g.fillRect(x, gy - doorH, w, doorH);
        g.fillStyle = '#b9a67f';
        g.fillRect(x + w * 0.62, gy - doorH, w * 0.38, doorH);
        g.fillStyle = '#c8b690';
        g.fillRect(x - w * 0.14, gy - 0.1 * k, w * 1.28, 0.1 * k);
      }
      pillar(gx - halfW, pw);
      pillar(gx + halfW - pw, pw);
      pillar(gx - mw / 2, mw);

      // 门楣和两块牌子
      g.fillStyle = '#e4d5b6';
      rr(g, gx - halfW - 0.08 * k, gy - doorH - lintelH, halfW * 2 + 0.16 * k, lintelH, 0.06 * k);
      g.fill();
      g.fillStyle = '#b9a67f';
      g.fillRect(gx - halfW - 0.08 * k, gy - doorH - 0.07 * k, halfW * 2 + 0.16 * k, 0.07 * k);

      const plateW = halfW - 0.2 * k;
      const plateH = lintelH - 0.16 * k;
      const plateY = gy - doorH - lintelH + 0.06 * k;
      g.fillStyle = C.ot;
      rr(g, gx - halfW + 0.08 * k, plateY, plateW, plateH, 0.07 * k);
      g.fill();
      g.fillStyle = C.nt;
      rr(g, gx + 0.12 * k, plateY, plateW, plateH, 0.07 * k);
      g.fill();
      if (k > 30) {
        g.font = '800 ' + Math.round(plateH * 0.74) + 'px ' + font;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = C.otInk;
        g.fillText('旧约', gx - halfW + 0.08 * k + plateW / 2, plateY + plateH * 0.54);
        g.fillStyle = C.ntInk;
        g.fillText('新约', gx + 0.12 * k + plateW / 2, plateY + plateH * 0.54);
      }
      g.restore();
    }

    function drawFinish(g, f) {
      const s = scaleAt(f.z);
      const k = roadHalf * s;
      const gx = px(0, f.z);
      const gy = py(f.z);
      let alpha = clamp((Z_FAR - f.z) / 3, 0, 1);
      if (f.z < 0) alpha *= clamp(1 + f.z / 1.2, 0, 1);
      if (alpha <= 0) return;
      g.save();
      g.globalAlpha = alpha;
      // 两根杆子拉着一条彩带
      g.fillStyle = '#8c6239';
      g.fillRect(gx - 1.22 * k, gy - 1.5 * k, 0.1 * k, 1.5 * k);
      g.fillRect(gx + 1.12 * k, gy - 1.5 * k, 0.1 * k, 1.5 * k);
      const bandY = gy - 1.48 * k;
      const bandH = 0.44 * k;
      g.fillStyle = '#ffffff';
      g.fillRect(gx - 1.14 * k, bandY, 2.28 * k, bandH);
      // 黑白格
      const cell = bandH / 2;
      g.fillStyle = '#1b2238';
      for (let i = 0; i * cell < 2.28 * k; i++) {
        g.fillRect(gx - 1.14 * k + i * cell, bandY + (i % 2 ? cell : 0), Math.min(cell, 2.28 * k - i * cell), cell);
      }
      if (!f.crossed) {
        g.fillStyle = '#ffd166';
        g.fillRect(gx - 1.14 * k, gy - 0.62 * k, 2.28 * k, 0.06 * k);
      }
      g.restore();
    }

    /* ---------- 画：人物、粒子 ---------- */

    function drawPlayer(g) {
      const u = roadHalf * 0.86;
      const p = { phase: S.phase, lean: S.lean };
      if (S.pose === 'idle') p.still = true;
      if (S.pose === 'hop') p.lift = Math.sin(clamp(S.poseT / 0.46, 0, 1) * Math.PI);
      if (S.pose === 'tumble') {
        const f = clamp(S.poseT / 0.62, 0, 1);
        p.spin = f * TAU;
        p.lift = Math.sin(f * Math.PI) * 0.7;
        if (S.poseT > 0.62) {
          p.spin = 0;
          p.lift = 0;
          p.alpha = Math.sin(S.poseT * 34) > 0 ? 1 : 0.35;     // 爬起来之后闪几下
        }
      }
      if (S.pose === 'cheer') {
        p.still = true;
        p.cheer = true;
        p.lift = Math.abs(Math.sin(S.poseT * 6.5)) * 0.42;
      }
      if (S.pose === 'down') {
        p.still = true;
        p.down = true;
      }
      drawBack(g, px(S.x, 0), baseY, u, S.look, p, time);
    }

    function drawParticles(g) {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const f = p.age / p.life;
        if (p.kind === 'dust') {
          g.fillStyle = p.color + (0.55 * (1 - f)) + ')';
          ell(g, p.x, p.y, p.r * (1 + f * 2), p.r * (0.7 + f * 1.3));
          g.fill();
        } else if (p.kind === 'paper') {
          g.save();
          g.globalAlpha = clamp(1.6 - f * 1.6, 0, 1);
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = p.color;
          g.fillRect(-p.r, -p.r * 0.55, p.r * 2, p.r * 1.1);
          g.restore();
        } else {
          g.globalAlpha = clamp(1.4 - f * 1.4, 0, 1);
          g.fillStyle = p.color;
          starPath(g, p.x, p.y, p.r, p.rot);
          g.fill();
          g.globalAlpha = 1;
        }
      }
    }

    // 跑得快的时候，画面两边拉出几道白线
    function drawSpeedLines(g) {
      const f = clamp((S.v * S.slow - 9) / 7, 0, 1);
      if (f <= 0) return;
      g.strokeStyle = '#ffffff';
      g.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        const side = i % 2 ? 1 : -1;
        const prog = (hash(i * 3.7) + S.dist * (0.06 + hash(i) * 0.05)) % 1;
        const ang = (0.15 + hash(i * 1.3) * 0.5) * side;
        const r0 = (0.25 + prog * 0.6) * Math.max(W, H) * 0.75;
        const r1 = r0 + (0.05 + prog * 0.12) * Math.max(W, H);
        const dx = Math.sin(ang);
        const dy = Math.cos(ang) * 0.55;
        g.globalAlpha = f * prog * 0.5;
        g.lineWidth = 1.5 + prog * 2.5;
        g.beginPath();
        g.moveTo(cx + dx * r0 * 1.6, horizonY + dy * r0);
        g.lineTo(cx + dx * r1 * 1.6, horizonY + dy * r1);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    function draw() {
      const g = ctx;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.save();
      if (S.shake > 0.01) g.translate((Math.random() - 0.5) * S.shake * 16, (Math.random() - 0.5) * S.shake * 11);

      const sky = skyNow();
      drawSky(g, sky);
      drawBackdrop(g);
      drawGround(g);
      drawRoad(g);
      if (S.gate && S.gate.z > 0) drawCarpet(g, S.gate);

      // 远的先画，近的后画
      const list = props.slice();
      if (S.gate) list.push({ gate: S.gate, z: S.gate.z });
      if (S.finish) list.push({ finish: S.finish, z: S.finish.z });
      list.push({ player: true, z: 0 });
      list.sort(function (a, b) { return b.z - a.z; });
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.player) { drawPlayer(g); continue; }
        if (o.gate) { drawGate(g, o.gate); continue; }
        if (o.finish) { drawFinish(g, o.finish); continue; }
        const s = scaleAt(o.z);
        const x = px(o.x, o.z);
        const k = roadHalf * s;
        if (x < -k * 2.5 || x > W + k * 2.5) continue;
        g.globalAlpha = clamp((Z_FAR - o.z) / 4, 0, 1);
        drawProp(g, o.kind, x, py(o.z), k, o.seed, time);
        g.globalAlpha = 1;
      }

      // 黄昏和夜里，给整个画面罩一层颜色
      if (sky.tintA > 0.005) {
        const c = rgbOf(sky.tint);
        const veil = g.createLinearGradient(0, 0, 0, horizonY);
        veil.addColorStop(0, 'rgba(' + c + ',0)');
        veil.addColorStop(1, 'rgba(' + c + ',' + sky.tintA + ')');
        g.fillStyle = veil;
        g.fillRect(-20, -20, W + 40, horizonY + 20);
        g.fillStyle = 'rgba(' + c + ',' + sky.tintA + ')';
        g.fillRect(-20, horizonY, W + 40, H - horizonY + 20);
      }

      drawParticles(g);
      drawSpeedLines(g);
      g.restore();
    }

    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!(hooks.paused && hooks.paused())) update(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }

    const onResize = function () { resize(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    let observer = null;
    if (window.ResizeObserver) {
      observer = new ResizeObserver(onResize);
      observer.observe(canvas);
    }

    resetState(LOOKS[0]);

    return {
      resize: resize,
      // 换人物、清空场景，回到「站在起点」的样子
      reset: function (look, stage) {
        S.skyTo = undefined;
        resetState(look);
        S.skyFrom = S.skyTo = (stage || 0) % 4;
        S.skyT = 1;
      },
      start: function () {
        if (alive) return;
        alive = true;
        resize();
        last = performance.now();
        raf = requestAnimationFrame(frame);
      },
      stop: function () {
        alive = false;
        cancelAnimationFrame(raf);
      },
      // 开跑
      run: function (approachSeconds) {
        setPose('run');
        S.vTarget = Z_FAR / (approachSeconds || 4);
      },
      // 远处出现一道门，approachSeconds 秒后跑到跟前
      spawnGate: function (approachSeconds) {
        S.gate = { z: Z_FAR, judged: false, flash: 0, ok: false, correct: 0, chosen: 0 };
        S.vTarget = Z_FAR / approachSeconds;
        S.lane = 0;
        S.laneBackAt = 0;
        S.canChoose = true;
        if (S.pose === 'idle') setPose('run');
      },
      spawnFinish: function (approachSeconds) {
        S.finish = { z: Z_FAR, crossed: false };
        S.vTarget = Z_FAR / approachSeconds;
        S.canChoose = false;
      },
      // 选左边（-1）还是右边（1）。还没出题或已经过门时不起作用
      choose: function (dir) {
        if (!S.canChoose || !S.gate || S.gate.judged) return false;
        if (S.lane === dir) return false;
        S.lane = dir;
        return true;
      },
      // 停下来：cheer 欢呼，down 摔坐在地上
      halt: function (pose) {
        S.vTarget = 0;
        S.canChoose = false;
        setPose(pose);
        if (pose === 'cheer') confetti();
      },
      setStage: function (n) {
        if (n % 4 === S.skyTo % 4) return;
        S.skyFrom = S.skyTo;
        S.skyTo = n % 4;
        S.skyT = 0;
      },
      stageName: function (n) { return SKIES[n % 4].name; },
      // 连击到了几：0 就没有尾迹
      setGlow: function (n) { S.glow = n; },
      destroy: function () {
        alive = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
        if (observer) observer.disconnect();
      }
    };
  }

  /* ================= 人物立绘（首页、选人物、结果页上的小画布） ================= */

  const portraits = [];
  let portraitTimer = 0;

  function portraitLoop() {
    portraitTimer = 0;
    let visible = 0;
    const t = performance.now() / 1000;
    for (let i = portraits.length - 1; i >= 0; i--) {
      const c = portraits[i];
      if (!c.isConnected) { portraits.splice(i, 1); continue; }
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) continue;      // 所在的页面没显示，就不画
      visible++;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const u = Math.min(r.height * 0.86, r.width * 1.5);
      drawFront(ctx, r.width / 2, r.height * 0.95, u, c._look, c._mood, t);
    }
    if (!portraits.length) return;
    // 有立绘在屏幕上就每帧画；都不可见时放慢，省电
    if (visible) portraitTimer = requestAnimationFrame(portraitLoop);
    else portraitTimer = setTimeout(portraitLoop, 300);
  }

  // 让一块 <canvas> 显示某个人物的正面动画。再调用一次可以换人物或换表情
  function portrait(canvas, look, mood) {
    canvas._look = look;
    canvas._mood = mood || 'idle';
    if (portraits.indexOf(canvas) === -1) portraits.push(canvas);
    if (!portraitTimer) portraitTimer = requestAnimationFrame(portraitLoop);
  }

  return { create: create, portrait: portrait, LOOKS: LOOKS, drawFront: drawFront, drawBack: drawBack };
})();
