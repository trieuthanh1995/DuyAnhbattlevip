/* Bubble Blast – cảnh 3D nhìn từ trên xuống: sân, vật cản, súng, đạn bong bóng, vật phẩm, hiệu ứng */
(function (PP) {
  'use strict';
  const T = window.THREE;
  const { C, MAPS } = PP;
  const { Shooter } = PP;
  const QUALITY = { low: { pr: 1, shadow: 0 }, medium: { pr: 1.5, shadow: 1024 }, high: { pr: 2, shadow: 2048 } };
  const qOf = (q) => (QUALITY[q] ? q : 'medium');
  const lin = (hex) => new T.Color(hex).convertSRGBToLinear();
  function mat(hex, o) { return new T.MeshStandardMaterial(Object.assign({ color: lin(hex), roughness: 0.55, metalness: 0.0 }, o || {})); }
  const TEAM_COL = { A: 0x3f8cff, B: 0xff7a45 };
  const PK = {
    heal: { emoji: '❤️', color: 0xff5c8a, name: 'Hồi máu' },
    power: { emoji: '💪', color: 0xffb020, name: 'Tăng sức mạnh' },
    shield: { emoji: '🛡️', color: 0x4cc9f0, name: 'Khiên' },
    freeze: { emoji: '❄️', color: 0x9ad8ff, name: 'Đóng băng' },
  };

  function createRenderer(canvas, quality) {
    const r = new T.WebGLRenderer({ canvas, antialias: qOf(quality) !== 'low', powerPreference: 'high-performance', alpha: false });
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.72;
    r.shadowMap.type = T.PCFSoftShadowMap;
    r.setClearColor(0x000000, 1);
    applyQuality(r, quality);
    return r;
  }
  let activeWorld = null;
  function applyQuality(r, quality) {
    quality = qOf(quality);
    const dpr = window.devicePixelRatio || 1;
    r.setPixelRatio(Math.min(dpr, QUALITY[quality].pr));
    r.shadowMap.enabled = QUALITY[quality].shadow > 0;
    r.shadowMap.needsUpdate = true;
    r.__q = quality;
    if (activeWorld && activeWorld.renderer === r) activeWorld.setQuality(quality);
  }
  function envFor(r) {
    if (r.__env) return r.__env;
    if (!T.RoomEnvironment) return null;
    const pm = new T.PMREMGenerator(r), room = new T.RoomEnvironment();
    const rt = pm.fromScene(room, 0.04);
    pm.dispose();
    r.__env = rt.texture;
    return r.__env;
  }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- vật cản ---------- */
  function addBox(g, o, th) {
    const h = 1.05, st = th.box;
    const body = new T.Mesh(new T.BoxGeometry(o.w, h, o.d), mat(st === 'crate' ? 0xc98b4f : st === 'log' ? 0x9a6a3c : th.obst, { roughness: 0.6 }));
    body.position.set(o.x, h / 2, o.z); body.castShadow = body.receiveShadow = true; g.add(body);
    if (st === 'gift') {
      const lid = new T.Mesh(new T.BoxGeometry(o.w + 0.1, 0.16, o.d + 0.1), mat(th.obst2));
      lid.position.set(o.x, h + 0.04, o.z); lid.castShadow = true; g.add(lid);
      const rib = new T.Mesh(new T.BoxGeometry(o.w + 0.12, 0.2, 0.14), mat(th.accent)); rib.position.set(o.x, h + 0.06, o.z); g.add(rib);
      const bow = new T.Mesh(new T.SphereGeometry(0.17, 12, 10), mat(th.accent)); bow.position.set(o.x, h + 0.26, o.z); bow.scale.set(1.5, 0.8, 1); g.add(bow);
    } else if (st === 'crate' || st === 'log') {
      const top = new T.Mesh(new T.BoxGeometry(o.w + 0.08, 0.1, o.d + 0.08), mat(st === 'crate' ? 0xe0a566 : 0xb98a5e));
      top.position.set(o.x, h + 0.02, o.z); g.add(top);
      for (const s of [-1, 1]) {
        const slat = new T.Mesh(new T.BoxGeometry(o.w + 0.12, 0.09, 0.09), mat(0x8a5a33));
        slat.position.set(o.x, h * 0.3 + (s > 0 ? h * 0.4 : 0), o.z + s * (o.d / 2 + 0.01)); g.add(slat);
      }
    } else {
      const nx = Math.max(1, Math.round(o.w / 0.6)), nz = Math.max(1, Math.round(o.d / 0.6));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const s = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.14, 14), mat(th.obst2 || th.obst));
        s.position.set(o.x - o.w / 2 + (i + 0.5) * o.w / nx, h + 0.08, o.z - o.d / 2 + (j + 0.5) * o.d / nz); s.castShadow = true; g.add(s);
      }
    }
  }
  function addCircle(g, o, th) {
    const st = th.circle, r = o.r;
    if (st === 'mushroom') {
      const stem = new T.Mesh(new T.CylinderGeometry(r * 0.5, r * 0.62, 0.8, 16), mat(0xfff1d6));
      stem.position.set(o.x, 0.4, o.z); stem.castShadow = true; g.add(stem);
      const cap = new T.Mesh(new T.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(th.obst, { side: T.DoubleSide }));
      cap.position.set(o.x, 0.78, o.z); cap.scale.y = 0.85; cap.castShadow = true; g.add(cap);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.047 + o.x, d = r * 0.55;
        const dot = new T.Mesh(new T.SphereGeometry(r * 0.13, 8, 6), mat(th.obst2)); dot.position.set(o.x + Math.cos(a) * d, 0.78 + r * 0.6, o.z + Math.sin(a) * d); dot.scale.y = 0.5; g.add(dot);
      }
    } else if (st === 'scoop') {
      const cone = new T.Mesh(new T.CylinderGeometry(r * 0.95, r * 0.55, 0.6, 16), mat(0xe0b070));
      cone.position.set(o.x, 0.3, o.z); cone.castShadow = true; g.add(cone);
      const sc = new T.Mesh(new T.SphereGeometry(r, 18, 14), mat(th.obst, { roughness: 0.35 }));
      sc.position.set(o.x, 0.6 + r * 0.55, o.z); sc.castShadow = true; g.add(sc);
      const ch = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), mat(0xe53956)); ch.position.set(o.x, 0.6 + r * 1.5, o.z); g.add(ch);
    } else if (st === 'rock') {
      const rk = new T.Mesh(new T.IcosahedronGeometry(r, 1), mat(0x9aa3ad, { roughness: 0.85, flatShading: true }));
      rk.position.set(o.x, r * 0.7, o.z); rk.scale.set(1, 1.0, 1); rk.rotation.y = o.x * 3; rk.castShadow = true; g.add(rk);
    } else {
      const p = new T.Mesh(new T.CylinderGeometry(r, r * 1.05, 1.1, 20), mat(th.obst));
      p.position.set(o.x, 0.55, o.z); p.castShadow = true; g.add(p);
      const ring = new T.Mesh(new T.TorusGeometry(r * 1.02, 0.06, 8, 24), mat(th.accent, { emissive: lin(th.accent), emissiveIntensity: 0.4 }));
      ring.rotation.x = Math.PI / 2; ring.position.set(o.x, 0.85, o.z); g.add(ring);
      const top = new T.Mesh(new T.SphereGeometry(r * 0.55, 14, 10), mat(th.obst2, { emissive: lin(th.obst2), emissiveIntensity: 0.35 })); top.position.set(o.x, 1.15, o.z); g.add(top);
    }
  }
  const deep = (hex, k) => (Math.round((hex >> 16 & 255) * k) << 16) | (Math.round((hex >> 8 & 255) * k) << 8) | Math.round((hex & 255) * k);
  function floorTexture(th, map) {
    const cell = 48, W = map.HW * 2, D = map.HD * 2;
    const cv = document.createElement('canvas'); cv.width = Math.ceil(W) * cell; cv.height = Math.ceil(D) * cell;
    const x = cv.getContext('2d');
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    for (let i = 0; i < Math.ceil(W); i++) for (let j = 0; j < Math.ceil(D); j++) {
      x.fillStyle = hex(deep((i + j) % 2 ? th.floor : th.floor2, 0.8)); x.fillRect(i * cell, j * cell, cell, cell);
    }
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 6;
    x.beginPath(); x.moveTo(cv.width / 2, 0); x.lineTo(cv.width / 2, cv.height); x.stroke();
    x.beginPath(); x.arc(cv.width / 2, cv.height / 2, cell * 2.2, 0, Math.PI * 2); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.35)';
    for (const sx of [-1, 1]) for (const sz of [-1.8, 1.8]) { x.beginPath(); x.arc(cv.width / 2 + sx * 9 * cell, cv.height / 2 + sz * cell, cell * 0.55, 0, Math.PI * 2); x.fill(); }
    const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
    return tex;
  }

  /* ---------- dựng cả sân ---------- */
  function build(renderer, mapId, quality) {
    const map = Shooter.mapOf(mapId), th = map.theme;
    const scene = new T.Scene();
    scene.background = lin(deep(th.outer, 0.8));
    const env = envFor(renderer); if (env) { scene.environment = env; }
    const camera = new T.PerspectiveCamera(38, 1, 0.5, 300);
    const hemi = new T.HemisphereLight(lin(0xffffff), lin(th.floor2), 0.5); scene.add(hemi);
    const sun = new T.DirectionalLight(lin(0xfff3e0), 0.95);
    sun.position.set(-6, 22, 8); sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera; sc.left = -13; sc.right = 13; sc.top = 9; sc.bottom = -9; sc.near = 5; sc.far = 60;
    sun.shadow.normalBias = 0.03; sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    const g = new T.Group(); scene.add(g);
    const outer = new T.Mesh(new T.PlaneGeometry(160, 160), mat(deep(th.outer, 0.8), { roughness: 0.95 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true; g.add(outer);
    const floor = new T.Mesh(new T.PlaneGeometry(map.HW * 2, map.HD * 2), new T.MeshStandardMaterial({ map: floorTexture(th, map), roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    // tường quanh sân
    const wh = 0.9, wt = 0.6;
    const walls = [[0, -map.HD - wt / 2, map.HW * 2 + wt * 2, wt], [0, map.HD + wt / 2, map.HW * 2 + wt * 2, wt], [-map.HW - wt / 2, 0, wt, map.HD * 2], [map.HW + wt / 2, 0, wt, map.HD * 2]];
    for (const w of walls) {
      const m = new T.Mesh(new T.BoxGeometry(w[2], wh, w[3]), mat(th.wall)); m.position.set(w[0], wh / 2, w[1]); m.castShadow = m.receiveShadow = true; g.add(m);
      const cap = new T.Mesh(new T.BoxGeometry(w[2] + 0.1, 0.12, w[3] + 0.1), mat(th.wallTop)); cap.position.set(w[0], wh + 0.04, w[1]); g.add(cap);
    }
    for (const o of map.obstacles) (o.t === 'box' ? addBox : addCircle)(g, o, th);
    // đồ trang trí bên ngoài sân
    const R = rng(map.id.length * 977 + 13), decor = [];
    const cols = [th.accent, th.obst, th.obst2, th.wallTop];
    for (let i = 0; i < 46; i++) {
      const side = R() < 0.5;
      const x = side ? (R() < 0.5 ? -1 : 1) * (map.HW + 2 + R() * 6) : (R() * 2 - 1) * (map.HW + 6);
      const z = side ? (R() * 2 - 1) * (map.HD + 6) : (R() < 0.5 ? -1 : 1) * (map.HD + 2 + R() * 5);
      const kind = (R() * 3) | 0, s = 0.5 + R() * 0.9, c = cols[(R() * cols.length) | 0];
      let m;
      if (kind === 0) { m = new T.Mesh(new T.SphereGeometry(0.6 * s, 14, 10), mat(c)); m.position.set(x, 0.6 * s, z); }
      else if (kind === 1) { m = new T.Mesh(new T.ConeGeometry(0.5 * s, 1.3 * s, 12), mat(c)); m.position.set(x, 0.65 * s, z); }
      else { m = new T.Mesh(new T.CylinderGeometry(0.4 * s, 0.4 * s, 0.9 * s, 12), mat(c)); m.position.set(x, 0.45 * s, z); }
      m.castShadow = true; g.add(m); decor.push(m);
    }

    const world = { renderer, scene, camera, map, sun, g, decor, portrait: false, upW: [0, -1], rightW: [1, 0], _t: 0 };
    const _v = new T.Vector3(), _ray = new T.Raycaster(), _pl = new T.Plane(new T.Vector3(0, 1, 0), -0.5);
    world.setQuality = (q) => {
      q = qOf(q); const s = QUALITY[q].shadow;
      sun.castShadow = s > 0;
      if (s > 0) { sun.shadow.mapSize.set(s, s); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    };
    world.setQuality(quality);

    /** Đặt góc nhìn theo kích thước màn hình: ngang → sân nằm ngang; dọc → xoay sân dọc (đội của mình ở dưới) */
    world.setView = (w, h, myTeam) => {
      camera.aspect = w / h;
      const portrait = h > w * 1.05;
      world.portrait = portrait;
      const up = portrait ? [myTeam === 'B' ? -1 : 1, 0] : [0, -1];   // hướng "lên màn hình" trên mặt sân
      camera.up.set(up[0], 0, up[1]);
      const tilt = 0.26, cx = 0, cz = 0;
      const corners = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 1.0]) corners.push([sx * (map.HW + 0.7), y, sz * (map.HD + 0.7)]);
      let lo = 6, hi = 90;
      const fits = (H) => {
        camera.position.set(cx - up[0] * H * tilt, H, cz - up[1] * H * tilt);
        camera.lookAt(cx, 0, cz); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        for (const c of corners) { _v.set(c[0], c[1], c[2]).project(camera); if (Math.abs(_v.x) > 0.97 || _v.y > 0.86 || _v.y < -0.8) return false; }
        return true;
      };
      for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      fits(hi);
      world.upW = up;
      const e = camera.matrixWorld.elements;
      const rl = Math.hypot(e[0], e[2]) || 1; world.rightW = [e[0] / rl, e[2] / rl];
    };
    world.project = (x, y, z, out) => {
      _v.set(x, y, z).project(camera);
      const r = renderer.domElement, W = r.clientWidth, H = r.clientHeight;
      out = out || {}; out.x = (_v.x * 0.5 + 0.5) * W; out.y = (-_v.y * 0.5 + 0.5) * H; out.vis = _v.z < 1;
      return out;
    };
    /** Điểm trên mặt sân dưới con trỏ (px màn hình) */
    world.groundAt = (px, py) => {
      const r = renderer.domElement;
      _ray.setFromCamera({ x: (px / r.clientWidth) * 2 - 1, y: -(py / r.clientHeight) * 2 + 1 }, camera);
      const hit = _ray.ray.intersectPlane(_pl, _v);
      return hit ? { x: _v.x, z: _v.z } : null;
    };
    /** Vector màn hình (sx sang phải, sy lên) → hướng trên mặt sân */
    world.dirFromScreen = (sx, sy) => ({ x: world.rightW[0] * sx + world.upW[0] * sy, z: world.rightW[1] * sx + world.upW[1] * sy });
    world.update = (dt, t) => {
      world._t = t;
      for (let i = 0; i < decor.length; i++) decor[i].position.y += Math.sin(t * 1.5 + i) * 0.0015;
    };
    world.dispose = () => {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      if (activeWorld === world) activeWorld = null;
    };
    activeWorld = world;
    return world;
  }

  /* ---------- súng đồ chơi (hướng +z, gắn vào tay nhân vật) ---------- */
  function makeGuns() {
    const rifle = new T.Group();
    const pink = mat(0xff6f91, { roughness: 0.35 }), white = mat(0xffffff, { roughness: 0.3 });
    const body = new T.Mesh(new T.BoxGeometry(0.11, 0.11, 0.36), pink); body.position.set(0, 0, 0.06); rifle.add(body);
    const barrel = new T.Mesh(new T.CylinderGeometry(0.035, 0.04, 0.24, 12), white); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.01, 0.3); rifle.add(barrel);
    const wand = new T.Mesh(new T.TorusGeometry(0.075, 0.017, 8, 18), mat(0x6fe3ff, { emissive: lin(0x6fe3ff), emissiveIntensity: 0.4 })); wand.position.set(0, 0.01, 0.44); rifle.add(wand);
    const tank = new T.Mesh(new T.SphereGeometry(0.085, 14, 10), new T.MeshStandardMaterial({ color: lin(0x9be7ff), transparent: true, opacity: 0.75, roughness: 0.1 })); tank.position.set(0, 0.11, 0.02); rifle.add(tank);
    const grip = new T.Mesh(new T.BoxGeometry(0.06, 0.13, 0.07), white); grip.position.set(0, -0.11, -0.03); grip.rotation.x = 0.25; rifle.add(grip);
    const sniper = new T.Group();
    const wood = mat(0x9a6a3c, { roughness: 0.7 });
    const stock = new T.Mesh(new T.BoxGeometry(0.07, 0.09, 0.5), wood); stock.position.set(0, 0, 0.12); sniper.add(stock);
    for (const s of [-1, 1]) { const arm = new T.Mesh(new T.BoxGeometry(0.035, 0.2, 0.035), wood); arm.position.set(s * 0.08, 0.1, 0.4); arm.rotation.z = -s * 0.35; sniper.add(arm); }
    const band = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.3, 6), mat(0xffd23f, { emissive: lin(0xffd23f), emissiveIntensity: 0.3 })); band.rotation.z = Math.PI / 2; band.position.set(0, 0.2, 0.3); sniper.add(band);
    const scope = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.26, 12), mat(0x2b2d42, { roughness: 0.3 })); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.095, 0.14); sniper.add(scope);
    const lens = new T.Mesh(new T.SphereGeometry(0.032, 10, 8), mat(0x6fe3ff, { emissive: lin(0x6fe3ff), emissiveIntensity: 0.7 })); lens.position.set(0, 0.095, 0.27); sniper.add(lens);
    for (const o of [rifle, sniper]) o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return { rifle, sniper };
  }
  function makeShield() {
    const m = new T.Mesh(new T.SphereGeometry(0.8, 20, 14), new T.MeshStandardMaterial({ color: lin(0x6fdcff), transparent: true, opacity: 0.28, roughness: 0.1, emissive: lin(0x3fb8ff), emissiveIntensity: 0.5, side: T.DoubleSide, depthWrite: false }));
    m.position.y = 0.5; return m;
  }
  function makeIce() {
    const m = new T.Mesh(new T.IcosahedronGeometry(0.72, 0), new T.MeshStandardMaterial({ color: lin(0xbfeaff), transparent: true, opacity: 0.5, roughness: 0.1, flatShading: true, emissive: lin(0x7fd0ff), emissiveIntensity: 0.3 }));
    m.position.y = 0.45; m.scale.set(1, 1.2, 1); return m;
  }
  function makeTeamRing(team) {
    return new T.Mesh(new T.RingGeometry(0.5, 0.62, 28), new T.MeshBasicMaterial({ color: lin(TEAM_COL[team]), transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
  }

  /* ---------- đạn bong bóng (mô phỏng cục bộ cùng công thức với server) ---------- */
  class Bullets {
    constructor(world) {
      this.world = world; this.list = new Map();
      this.geo = new T.SphereGeometry(1, 16, 12);
      this.hi = new T.SphereGeometry(0.22, 8, 6);
    }
    spawn(e, teamOf, catchUp) {
      const col = TEAM_COL[teamOf] || 0xffffff;
      const s = C.RIFLE.r * (1 + Math.min(2, (e.dmg - C.RIFLE.dmg) / 25));
      const m = new T.Mesh(this.geo, new T.MeshStandardMaterial({ color: lin(0xcff4ff), transparent: true, opacity: 0.62, roughness: 0.05, metalness: 0.1, emissive: lin(col), emissiveIntensity: 0.55, depthWrite: false }));
      m.scale.setScalar(s * 1.5);
      const h = new T.Mesh(this.hi, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })); h.position.set(-0.35, 0.4, -0.2); m.add(h);
      const b = { id: e.id, x: e.x, z: e.z, vx: e.vx, vz: e.vz, r: C.RIFLE.r, bounces: e.bounces || 0, age: 0, mesh: m, s, team: teamOf, seed: Math.random() * 6 };
      this.world.scene.add(m);
      this.list.set(e.id, b);
      // bù độ trễ mạng: chạy tiếp từ lúc đạn được bắn
      if (catchUp > 0) { let left = Math.min(catchUp, 0.5); while (left > 0 && this.list.has(b.id)) { const d = Math.min(left, 1 / 120); left -= d; this.stepOne(b, d, null); } }
      m.position.set(b.x, 0.55, b.z);
      return b;
    }
    stepOne(b, dt, cb) {
      const r = Shooter.stepBullet(this.world.map, b, dt);
      if (r === 'bounce' && cb && cb.onBounce) cb.onBounce(b);
      if (r === 'pop') { this.remove(b.id); if (cb && cb.onPop) cb.onPop(b); }
    }
    update(dt, t, cb) {
      for (const b of Array.from(this.list.values())) {
        let left = dt;
        while (left > 0 && this.list.has(b.id)) { const d = Math.min(left, 1 / 120); left -= d; this.stepOne(b, d, cb); }
        if (this.list.has(b.id)) {
          const w = 1 + Math.sin(t * 14 + b.seed) * 0.06;
          b.mesh.position.set(b.x, 0.55, b.z); b.mesh.scale.set(b.s * 1.5 * w, b.s * 1.5 / w, b.s * 1.5 * w);
        }
      }
    }
    remove(id) {
      const b = this.list.get(id); if (!b) return null;
      this.world.scene.remove(b.mesh); b.mesh.material.dispose(); b.mesh.children.forEach((c) => c.material.dispose());
      this.list.delete(id); return b;
    }
    clear() { for (const id of Array.from(this.list.keys())) this.remove(id); }
  }

  /* ---------- vật phẩm ---------- */
  const _spriteCache = {};
  function emojiTex(e) {
    if (_spriteCache[e]) return _spriteCache[e];
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d'); x.font = '92px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(e, 64, 72);
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; _spriteCache[e] = t; return t;
  }
  class Pickups {
    constructor(world) { this.world = world; this.list = new Map(); }
    add(e) {
      const info = PK[e.type]; if (!info) return;
      const g = new T.Group(); g.position.set(e.x, 0, e.z);
      const base = new T.Mesh(new T.CylinderGeometry(0.46, 0.5, 0.1, 22), mat(info.color, { emissive: lin(info.color), emissiveIntensity: 0.45, roughness: 0.3 })); base.position.y = 0.05; g.add(base);
      const ring = new T.Mesh(new T.RingGeometry(0.55, 0.72, 28), new T.MeshBasicMaterial({ color: lin(info.color), transparent: true, opacity: 0.7, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
      const sp = new T.Sprite(new T.SpriteMaterial({ map: emojiTex(info.emoji), transparent: true, depthWrite: false })); sp.scale.setScalar(1.0); sp.position.y = 0.95; g.add(sp);
      this.world.scene.add(g);
      this.list.set(e.id, { id: e.id, type: e.type, x: e.x, z: e.z, g, sp, ring, life: e.life || C.PICKUP_LIFE, age: 0, seed: Math.random() * 6 });
    }
    remove(id) { const p = this.list.get(id); if (!p) return null; this.world.scene.remove(p.g); p.g.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); }); this.list.delete(id); return p; }
    clear() { for (const id of Array.from(this.list.keys())) this.remove(id); }
    update(dt, t) {
      for (const p of this.list.values()) {
        p.age += dt;
        p.sp.position.y = 0.95 + Math.sin(t * 3 + p.seed) * 0.12;
        const k = 1 + Math.sin(t * 5 + p.seed) * 0.06; p.ring.scale.set(k, k, 1);
        const left = p.life - p.age; p.g.visible = left > 3 || Math.floor(t * 8) % 2 === 0;
      }
    }
  }

  /* ---------- hiệu ứng hạt, tia ná ---------- */
  class Fx {
    constructor(world) { this.world = world; this.parts = []; this.beams = []; this.rings = []; this.geo = new T.SphereGeometry(1, 8, 6); }
    burst(x, z, color, n, speed, y, size) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.8);
        const m = new T.Mesh(this.geo, new T.MeshBasicMaterial({ color: lin(color), transparent: true, opacity: 0.9 }));
        const s = (size || 0.09) * (0.6 + Math.random() * 0.8); m.scale.setScalar(s);
        m.position.set(x, y == null ? 0.55 : y, z); this.world.scene.add(m);
        this.parts.push({ m, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1.5 + Math.random() * 2, life: 0.45 + Math.random() * 0.3, age: 0, s });
      }
    }
    ring(x, z, color, size) {
      const m = new T.Mesh(new T.RingGeometry(0.8, 1, 28), new T.MeshBasicMaterial({ color: lin(color), transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.08, z); m.scale.setScalar(0.2); this.world.scene.add(m);
      this.rings.push({ m, age: 0, life: 0.5, size: size || 1.6 });
    }
    beam(x1, z1, x2, z2, color) {
      const L = Math.hypot(x2 - x1, z2 - z1) || 0.01;
      const m = new T.Mesh(new T.BoxGeometry(0.14, 0.14, L), new T.MeshBasicMaterial({ color: lin(color || 0xffe27a), transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }));
      m.position.set((x1 + x2) / 2, 0.6, (z1 + z2) / 2); m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      this.world.scene.add(m); this.beams.push({ m, age: 0, life: 0.3 });
    }
    update(dt) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i]; p.age += dt;
        if (p.age >= p.life) { this.world.scene.remove(p.m); p.m.material.dispose(); this.parts.splice(i, 1); continue; }
        p.vy -= 9 * dt; p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt; p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * dt);
        const k = 1 - p.age / p.life; p.m.material.opacity = 0.9 * k; p.m.scale.setScalar(p.s * (0.4 + k));
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i]; r.age += dt;
        if (r.age >= r.life) { this.world.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
        const k = r.age / r.life; r.m.scale.setScalar(0.2 + r.size * k); r.m.material.opacity = 0.85 * (1 - k);
      }
      for (let i = this.beams.length - 1; i >= 0; i--) {
        const b = this.beams[i]; b.age += dt;
        if (b.age >= b.life) { this.world.scene.remove(b.m); b.m.material.dispose(); b.m.geometry.dispose(); this.beams.splice(i, 1); continue; }
        const k = 1 - b.age / b.life; b.m.material.opacity = k; b.m.scale.set(k, k, 1);
      }
    }
    clear() {
      for (const p of this.parts) { this.world.scene.remove(p.m); p.m.material.dispose(); }
      for (const p of this.rings) { this.world.scene.remove(p.m); p.m.material.dispose(); }
      for (const p of this.beams) { this.world.scene.remove(p.m); p.m.material.dispose(); }
      this.parts = []; this.rings = []; this.beams = [];
    }
  }

  PP.Arena = { createRenderer, applyQuality, build, makeGuns, makeShield, makeIce, makeTeamRing, Bullets, Pickups, Fx, PK, TEAM_COL, qOf };
})(window.PP);
