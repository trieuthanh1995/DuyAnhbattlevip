/* Duy Anh Battle – lõi mô phỏng (trình duyệt + Node): hình học, đạn, súng, vật phẩm, hiệp đấu.
 * Hệ tọa độ: mặt sân là mặt phẳng (x, z). Hướng ngắm `aim` (rad): hướng = (sin aim, cos aim).
 * Đội A xuất phát bên trái (x<0), đội B bên phải (x>0).
 * Sim phát sự kiện vào hàng đợi drain():
 *   select_start, fight, shoot, snipe (đạn ná bay), spop (đạn ná hết đường), obs_break (vật cản bị phá), hit, dead, respawn, bpop, pickup_spawn, pickup_take, pickup_expire, match_end, over, paused, resumed */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.PP;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function (cfg) {
  'use strict';
  const { C, MAPS, PICKUP_TYPES, OBS_AREA, obsArea, normHp } = cfg;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const other = (t) => (t === 'A' ? 'B' : 'A');
  const mapOf = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
  /** Bản sao riêng của bản đồ (vật cản có thể bị phá nên mỗi ván / mỗi màn hình dựng cảnh phải có bản của mình) */
  /** Số viên đạn cần để phá hết 1 vật cản: 5 (bé nhất) … 10 (to nhất) theo diện tích */
  function hitsToBreak(o) {
    const K = C.BREAK, span = Math.max(1e-6, OBS_AREA.max - OBS_AREA.min);
    const k = clamp((obsArea(o) - OBS_AREA.min) / span, 0, 1);
    return Math.round(K.hitsMin + k * (K.hitsMax - K.hitsMin));
  }
  const cloneMap = (m) => Object.assign({}, m, { obstacles: m.obstacles.map((o) => {
    const c = Object.assign({}, o); c.w0 = o.w; c.d0 = o.d; c.r0 = o.r; c.need = hitsToBreak(o); c.hits = 0; return c;
  }) });
  /** Áp dụng sự kiện obs_break lên bản đồ (dùng ở cả sim lẫn máy khách) */
  function applyBreak(map, e) {
    const o = map.obstacles[e.i]; if (!o) return null;
    if (o.t === 'box') { o.w = e.w; o.d = e.d; } else o.r = e.r;
    o.broken = true; if (e.gone) o.gone = true;
    return o;
  }
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================= hình học ================= */
  /** Vòng tròn (x,z,r) có chạm vật cản o không → {nx,nz,pen} hoặc null */
  function hitObstacle(o, x, z, r) {
    if (o.gone) return null;                 // vật cản đã bị phá hết
    if (o.t === 'box') {
      const hx = o.w / 2, hz = o.d / 2;
      const cx = clamp(x, o.x - hx, o.x + hx), cz = clamp(z, o.z - hz, o.z + hz);
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return null;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); return { nx: dx / d, nz: dz / d, pen: r - d }; }
      // tâm nằm trong hộp: đẩy ra theo cạnh gần nhất
      const px = hx - Math.abs(x - o.x), pz = hz - Math.abs(z - o.z);
      if (px < pz) return { nx: x >= o.x ? 1 : -1, nz: 0, pen: px + r };
      return { nx: 0, nz: z >= o.z ? 1 : -1, pen: pz + r };
    }
    const dx = x - o.x, dz = z - o.z, rr = o.r + r, d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { nx: 1, nz: 0, pen: rr };
    return { nx: dx / d, nz: dz / d, pen: rr - d };
  }
  function blocked(map, x, z, r) {
    if (Math.abs(x) > map.HW - r || Math.abs(z) > map.HD - r) return true;
    for (const o of map.obstacles) if (hitObstacle(o, x, z, r)) return true;
    return false;
  }
  /** Đẩy vòng tròn ra khỏi tường và vật cản; trả về true nếu có va chạm */
  function pushOut(map, p, r) {
    let moved = false;
    for (let it = 0; it < 3; it++) {
      let any = false;
      const mx = map.HW - r, mz = map.HD - r;
      if (p.x > mx) { p.x = mx; any = true; } else if (p.x < -mx) { p.x = -mx; any = true; }
      if (p.z > mz) { p.z = mz; any = true; } else if (p.z < -mz) { p.z = -mz; any = true; }
      for (const o of map.obstacles) {
        const h = hitObstacle(o, p.x, p.z, r);
        if (h) { p.x += h.nx * h.pen; p.z += h.nz * h.pen; any = true; }
      }
      if (!any) break;
      moved = true;
    }
    return moved;
  }
  /** Di chuyển nhân vật theo hướng (mx,mz) trong [-1,1]; có quán tính nhẹ */
  function stepMove(map, p, mx, mz, dt, speedMul) {
    let l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    const sp = C.SPEED * (speedMul || 1);
    const k = Math.min(1, dt * 14);
    p.vx += (mx * sp - p.vx) * k; p.vz += (mz * sp - p.vz) * k;
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (pushOut(map, p, C.PLAYER_R)) { p.vx *= 0.6; p.vz *= 0.6; }
  }
  /** Đoạn thẳng a→b có thông thoáng (không vật cản) cho vòng tròn bán kính r? */
  function segClear(map, x1, z1, x2, z2, r) {
    const d = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.ceil(d / 0.3));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      for (const o of map.obstacles) if (hitObstacle(o, x, z, r)) return false;
    }
    return true;
  }
  /** Khoảng cách từ (x,z) theo hướng (dx,dz) tới biên sân */
  function rayToBounds(map, x, z, dx, dz) {
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (map.HW - x) / dx); else if (dx < -1e-9) t = Math.min(t, (-map.HW - x) / dx);
    if (dz > 1e-9) t = Math.min(t, (map.HD - z) / dz); else if (dz < -1e-9) t = Math.min(t, (-map.HD - z) / dz);
    return Math.max(0, t);
  }

  /** Một bước đạn bong bóng: 'bounce' nếu vừa nảy, 'pop' nếu vỡ (lần va chạm thứ 3 hoặc hết giờ).
   *  Khi vỡ do va chạm thứ 3, b.popObs = chỉ số vật cản bị đập (-1 nếu là tường bao hoặc hết giờ) */
  function stepBullet(map, b, dt) {
    b.x += b.vx * dt; b.z += b.vz * dt; b.age += dt; b.popObs = -1; b.bounceObs = -1;
    let bounced = false, obsIdx = -1;
    const mx = map.HW - b.r, mz = map.HD - b.r;
    if (b.x > mx) { b.x = mx; b.vx = -Math.abs(b.vx); bounced = true; }
    else if (b.x < -mx) { b.x = -mx; b.vx = Math.abs(b.vx); bounced = true; }
    if (b.z > mz) { b.z = mz; b.vz = -Math.abs(b.vz); bounced = true; }
    else if (b.z < -mz) { b.z = -mz; b.vz = Math.abs(b.vz); bounced = true; }
    for (let k = 0; k < map.obstacles.length; k++) {
      const o = map.obstacles[k];
      const h = hitObstacle(o, b.x, b.z, b.r);
      if (!h) continue;
      b.x += h.nx * h.pen; b.z += h.nz * h.pen;
      const dot = b.vx * h.nx + b.vz * h.nz;
      if (dot < 0) { b.vx -= 2 * dot * h.nx; b.vz -= 2 * dot * h.nz; }
      bounced = true;
      if (obsIdx < 0) obsIdx = k;
    }
    if (bounced) {
      b.bounces++;
      if (b.bounces >= C.RIFLE.bounces) { b.popObs = obsIdx; return 'pop'; }
    }
    if (b.age > C.RIFLE.life) return 'pop';
    if (bounced) { b.bounceObs = obsIdx; return 'bounce'; }
    return null;
  }

  /* ================= Sim ================= */
  class Sim {
    /** opts = {map, teamSize, lives, seed, players:[{id, team, weapon}]}
     *  Luật: đầu ván có SELECT_TIME giây chọn súng (rồi khóa). Mỗi bên có `lives` mạng (2v2 là kho chung của đội);
     *  chết 1 lần mất 1 mạng, còn mạng thì hồi sinh ngẫu nhiên và bất tử SPAWN_SHIELD giây. Hết mạng trước thì thua. */
    constructor(opts) {
      this.map = cloneMap(mapOf(opts.map || opts.venue));
      this.teamSize = opts.teamSize === 2 ? 2 : 1;
      const lv = C.LIVES.includes(opts.lives) ? opts.lives : 5;
      this.livesMax = (lv === 22 && this.teamSize === 1) ? 11 : lv;
      this.lives = { A: this.livesMax, B: this.livesMax };
      this.hpBase = normHp(opts.hp);                    // máu mỗi lần xuất hiện (100–1000)
      this.healAmt = Math.max(1, Math.round(this.hpBase * C.HEAL_PCT));
      this.bombDmg = Math.max(1, Math.round(this.hpBase * C.BOMB.pct));
      this.fightStart = 0; this.sudden = false;
      this.rng = mulberry32((opts.seed >>> 0) || 1);
      this.players = opts.players.map((p) => ({
        id: p.id, team: p.team, x: 0, z: 0, vx: 0, vz: 0, aim: 0, hp: this.hpBase, hpMax: this.hpBase, alive: true,
        weapon: p.weapon === 'sniper' ? 'sniper' : 'rifle', ammo: C.RIFLE.mag, reloadUntil: 0, nextRifle: 0, nextSnipe: 0,
        shieldUntil: 0, freezeUntil: 0, speedUntil: 0, power: 0, powerUntil: 0, fire: false, lastSet: 0, respawnAt: 0, lockUntil: 0, deaths: 0, kills: 0,
      }));
      this.phase = 'idle';
      this.t = 0; this.wall = 0; this.last = null; this.acc = 0;
      this.bullets = []; this.stones = []; this.bombs = []; this.pickups = []; this.bid = 0; this.pid = 0;
      this.selectEnd = 0; this.nextPickup = 0; this.endAt = 0; this.winner = null;
      this.out = [];
    }
    player(id) { return this.players.find((p) => p.id === id) || null; }
    drain() { const o = this.out; this.out = []; return o; }
    emit(e) { e.ts = this.wall; this.out.push(e); }

    start(now) {
      this.wall = now; this.last = now;
      this.phase = 'select';
      this.selectEnd = this.t + C.SELECT_TIME;
      const idx = { A: 0, B: 0 };
      for (const p of this.players) {
        const sp = this.map.spawns[p.team][idx[p.team]++ % 2];
        p.x = sp[0]; p.z = sp[1]; p.vx = p.vz = 0;
        p.aim = p.team === 'A' ? Math.PI / 2 : -Math.PI / 2;
      }
      this.emit({ t: 'select_start', lives: this.livesMax, hp: this.hpBase, select: C.SELECT_TIME,
        positions: this.players.map((p) => ({ id: p.id, x: p.x, z: p.z, aim: p.aim })) });
    }
    /** Chọn súng: chỉ được trong 5 giây đầu ván (sau đó đã khóa) */
    pick(id, w) {
      if (this.phase !== 'select') return false;
      const p = this.player(id);
      if (!p || (w !== 'rifle' && w !== 'sniper')) return false;
      p.weapon = w; return true;
    }

    /** Bot: đặt hướng ngắm / bóp cò (di chuyển do bot tự làm bằng stepMove) */
    setInput(id, inp) {
      const p = this.player(id);
      if (!p) return;
      if (typeof inp.aim === 'number' && Number.isFinite(inp.aim)) p.aim = inp.aim;
      p.fire = !!inp.fire;
    }
    /** Người chơi: trạng thái do máy khách báo. strict=true (server): giới hạn tốc độ + va chạm */
    setPlayerState(id, s, strict, now) {
      const p = this.player(id);
      if (!p) return;
      if (typeof s.aim === 'number' && Number.isFinite(s.aim)) p.aim = s.aim;
      p.fire = !!s.fire;
      const locked = !p.alive || this.phase !== 'fight' || p.freezeUntil > this.t || this.t < p.lockUntil;
      if (locked) { p.vx = p.vz = 0; p.lastSet = now || 0; return; }
      let nx = s.x, nz = s.z;
      if (strict) {
        const dt = clamp((now || 0) - p.lastSet, 0.01, 0.25);
        const maxStep = C.SPEED * 1.3 * (p.speedUntil > this.t ? C.BOOST_MUL : 1) * dt + 0.15;
        const dx = nx - p.x, dz = nz - p.z, d = Math.hypot(dx, dz);
        if (d > maxStep) { nx = p.x + dx / d * maxStep; nz = p.z + dz / d * maxStep; }
      }
      p.lastSet = now || 0;
      p.x = nx; p.z = nz; p.vx = s.vx || 0; p.vz = s.vz || 0;
      pushOut(this.map, p, C.PLAYER_R);
    }

    update(now) {
      if (this.last === null) { this.last = now; this.wall = now; }
      const dt = clamp(now - this.last, 0, 0.1);
      this.last = now; this.wall = now;
      if (this.phase === 'idle' || this.phase === 'paused' || this.phase === 'over') return;
      this.acc += dt;
      while (this.acc >= C.STEP) { this.acc -= C.STEP; this.step(C.STEP); if (this.phase === 'over') break; }
    }

    step(dt) {
      this.t += dt;
      if (this.phase === 'select') {
        if (this.t >= this.selectEnd) this.beginFight();
        return;
      }
      if (this.phase === 'ending') {
        if (this.t >= this.endAt) { this.phase = 'over'; this.emit({ t: 'over', winner: this.winner, lives: Object.assign({}, this.lives), reason: 'lives' }); }
        return;
      }
      if (this.phase !== 'fight') return;
      this.updatePlayers();
      this.updateBullets(dt);
      this.updateStones(dt);
      this.updateBombs();
      this.updateSudden();
      this.updatePickups();
    }
    beginFight() {
      this.phase = 'fight'; this.fightStart = this.t;
      this.nextPickup = this.t + C.PICKUP_EVERY;
      for (const p of this.players) { p.shieldUntil = this.t + C.SPAWN_SHIELD; p.lockUntil = 0; }
      const weapons = {}; for (const p of this.players) weapons[p.id] = p.weapon;
      this.emit({ t: 'fight', weapons, shield: C.SPAWN_SHIELD });
    }

    updatePlayers() {
      const t = this.t;
      for (const p of this.players) {
        if (!p.alive) {
          if (this.lives[p.team] > 0 && p.respawnAt && t >= p.respawnAt) this.respawn(p);
          continue;
        }
        if (p.reloadUntil && t >= p.reloadUntil) { p.ammo = C.RIFLE.mag; p.reloadUntil = 0; }
        if (p.power > 0 && t >= p.powerUntil) { p.power = 0; p.powerUntil = 0; this.emit({ t: 'power_end', id: p.id }); }   // hết 5s: mất sức mạnh
        if (!p.fire) continue;      // đang bị đóng băng vẫn bắn được (chỉ không di chuyển được)
        if (p.weapon === 'rifle') {
          if (p.ammo > 0 && !p.reloadUntil && t >= p.nextRifle) this.shootRifle(p);
        } else if (t >= p.nextSnipe) this.shootSnipe(p);
      }
    }
    dmgOf(p, base) { return base + p.power * C.POWER_BONUS; }

    /** Điểm hồi sinh ngẫu nhiên: thử nhiều điểm, ưu tiên điểm xa đối thủ đang sống */
    spawnPoint(p) {
      const m = this.map, foes = this.players.filter((q) => q.alive && q.team !== p.team);
      let best = null, bd = -1;
      for (let k = 0; k < 30; k++) {
        const x = (this.rng() * 2 - 1) * (m.HW - 1.0), z = (this.rng() * 2 - 1) * (m.HD - 1.0);
        if (blocked(m, x, z, 0.8)) continue;
        let d = Infinity; for (const q of foes) d = Math.min(d, Math.hypot(q.x - x, q.z - z));
        if (foes.length === 0) d = this.rng();
        if (d > bd && (k < 8 || d > 4)) { bd = d; best = { x, z }; }
        if (k >= 8 && best && bd > 6) break;
      }
      return best || { x: m.spawns[p.team][0][0], z: m.spawns[p.team][0][1] };
    }
    respawn(p) {
      const pt = this.spawnPoint(p), t = this.t;
      p.x = pt.x; p.z = pt.z; p.vx = p.vz = 0; p.hp = p.hpMax = Math.min(this.hpBase, this.hpCap()); p.alive = true; p.respawnAt = 0; p.speedUntil = 0;
      p.aim = Math.atan2(-pt.x, -pt.z);                      // quay về giữa sân
      p.ammo = C.RIFLE.mag; p.reloadUntil = 0; p.nextRifle = t + 0.3; p.nextSnipe = t + 0.3;
      p.power = 0; p.powerUntil = 0; p.freezeUntil = 0; p.fire = false;
      p.shieldUntil = t + C.SPAWN_SHIELD; p.lockUntil = t + 0.4;   // 0,4s bỏ qua vị trí cũ do máy khách gửi trễ
      this.emit({ t: 'respawn', id: p.id, x: p.x, z: p.z, aim: p.aim, shield: C.SPAWN_SHIELD, hp: p.hp });
    }

    shootRifle(p) {
      const R = C.RIFLE, dx = Math.sin(p.aim), dz = Math.cos(p.aim);
      let sx = p.x + dx * 0.55, sz = p.z + dz * 0.55;
      if (blocked(this.map, sx, sz, R.r)) { sx = p.x; sz = p.z; }
      const b = { id: ++this.bid, owner: p.id, team: p.team, x: sx, z: sz, vx: dx * R.speed, vz: dz * R.speed,
        bounces: 0, age: 0, r: R.r, dmg: this.dmgOf(p, R.dmg) };
      this.bullets.push(b);
      p.ammo--; p.nextRifle = this.t + R.delay;
      if (p.ammo <= 0) p.reloadUntil = this.t + R.reload;
      this.emit({ t: 'shoot', id: b.id, owner: p.id, x: b.x, z: b.z, vx: b.vx, vz: b.vz, dmg: b.dmg, ammo: p.ammo });
    }
    /** Ná cao su: bắn ra 1 viên đá bay thẳng 32 m/s, xuyên vật cản và mọi kẻ địch (mỗi người chỉ trúng 1 lần) */
    shootSnipe(p) {
      const S = C.SNIPER, dx = Math.sin(p.aim), dz = Math.cos(p.aim);
      p.nextSnipe = this.t + S.delay;
      const sx = p.x + dx * 0.55, sz = p.z + dz * 0.55;
      const len = Math.min(S.range, rayToBounds(this.map, p.x, p.z, dx, dz));
      const st = { id: ++this.bid, owner: p.id, team: p.team, x: sx, z: sz, vx: dx * S.speed, vz: dz * S.speed,
        dist: 0, len, dmg: this.dmgOf(p, S.dmg), hit: [] };
      this.stones.push(st);
      this.emit({ t: 'snipe', id: st.id, owner: p.id, x: st.x, z: st.z, vx: st.vx, vz: st.vz, len, dmg: st.dmg });
    }
    updateStones(dt) {
      const S = C.SNIPER, rr = C.PLAYER_R + S.width;
      for (let i = this.stones.length - 1; i >= 0; i--) {
        const st = this.stones[i];
        const step = Math.min(S.speed * dt, st.len - st.dist);
        const ux = st.vx / S.speed, uz = st.vz / S.speed;
        const x0 = st.x, z0 = st.z;
        // quét đoạn x0→x1 để đạn nhanh không xuyên qua người
        for (const q of this.players) {
          if (!q.alive || q.team === st.team || st.hit.includes(q.id)) continue;
          const rx = q.x - x0, rz = q.z - z0;
          const s = Math.max(0, Math.min(step, rx * ux + rz * uz));
          const cx = rx - ux * s, cz = rz - uz * s;
          if (cx * cx + cz * cz <= rr * rr) {
            const dmg = st.hit.length === 0 ? st.dmg : Math.round(st.dmg * C.PIERCE2);   // người thứ 2 trở đi: 50%
            st.hit.push(q.id);
            this.damage(q, this.player(st.owner) || { id: st.owner }, dmg, 'snipe');
            if (this.phase !== 'fight') return;
          }
        }
        st.x += ux * step; st.z += uz * step; st.dist += step;
        if (st.dist >= st.len - 1e-6) {
          this.stones.splice(i, 1);
          this.emit({ t: 'spop', id: st.id, x: st.x, z: st.z });
        }
      }
    }

    damage(q, by, dmg, kind) {
      if (!q.alive || this.phase !== 'fight') return;
      if (q.shieldUntil > this.t) { this.emit({ t: 'hit', target: q.id, by: by.id, dmg: 0, hp: q.hp, shielded: true, kind }); return; }
      q.hp = Math.max(0, q.hp - dmg);
      this.emit({ t: 'hit', target: q.id, by: by.id, dmg, hp: q.hp, kind });
      if (q.hp > 0) return;
      // ---- chết: mất 1 mạng của đội
      q.alive = false; q.fire = false; q.deaths++; q.vx = q.vz = 0;
      if (by && by.team && by.team !== q.team) by.kills = (by.kills || 0) + 1;
      this.lives[q.team] = Math.max(0, this.lives[q.team] - 1);
      q.power = 0; q.powerUntil = 0; q.freezeUntil = 0; q.speedUntil = 0;
      q.respawnAt = this.t + C.RESPAWN_DELAY;
      this.emit({ t: 'dead', id: q.id, by: by.id, lives: Object.assign({}, this.lives), respawn: this.lives[q.team] > 0 });
      if (this.lives[q.team] <= 0) {
        this.phase = 'ending'; this.winner = other(q.team); this.endAt = this.t + C.END_DELAY; this.bullets = []; this.stones = []; this.bombs = [];
        this.emit({ t: 'match_end', winner: this.winner, lives: Object.assign({}, this.lives) });
      }
    }

    updateBullets(dt) {
      const h = dt / 2;
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        let dead = false, hitP = null;
        for (let s = 0; s < 2 && !dead; s++) {
          const r = stepBullet(this.map, b, h);
          if (r === 'pop') { dead = true; break; }
          if (r === 'bounce' && b.bounceObs >= 0 && b.bounces >= 2) this.breakObstacle(b.bounceObs, b.x, b.z, C.BREAK.chip);   // chỉ lần va chạm thứ 2 mới sứt nhẹ (lần 1 không gây hại)
          for (const q of this.players) {
            if (!q.alive || q.team === b.team) continue;
            const dx = q.x - b.x, dz = q.z - b.z, rr = C.PLAYER_R + b.r;
            if (dx * dx + dz * dz < rr * rr) { hitP = q; dead = true; break; }
          }
        }
        if (dead) {
          this.bullets.splice(i, 1);
          this.emit({ t: 'bpop', id: b.id, x: b.x, z: b.z, hit: !!hitP });
          if (!hitP && b.popObs >= 0) this.breakObstacle(b.popObs, b.x, b.z, 1);   // va chạm thứ 3 vào vật cản: phá một phần
          if (hitP) this.damage(hitP, this.player(b.owner) || { id: b.owner }, b.dmg, 'rifle');
          if (this.phase !== 'fight') break;
        }
      }
    }

    /** Phá một phần vật cản: thu nhỏ lại; quá nhỏ thì biến mất. Tường bao không bao giờ bị phá. */
    breakObstacle(i, x, z, amount) {
      const o = this.map.obstacles[i], K = C.BREAK;
      if (!o || o.gone) return;
      o.broken = true; o.hits += amount;
      if (o.hits >= o.need - 1e-9) o.gone = true;
      else {
        // thu nhỏ đều từ 100% xuống minScale khi gần đủ số nhát
        const sc = 1 - (1 - K.minScale) * o.hits / o.need;
        if (o.t === 'box') { o.w = +(o.w0 * sc).toFixed(3); o.d = +(o.d0 * sc).toFixed(3); } else o.r = +(o.r0 * sc).toFixed(3);
      }
      this.emit({ t: 'obs_break', i, w: o.w, d: o.d, r: o.r, gone: !!o.gone, hits: o.hits, need: o.need, full: amount >= 1, x, z });
    }

    freePoint() {
      const m = this.map;
      for (let k = 0; k < 40; k++) {
        const x = (this.rng() * 2 - 1) * (m.HW - 1.2), z = (this.rng() * 2 - 1) * (m.HD - 1.2);
        if (blocked(m, x, z, 0.8)) continue;
        if (this.pickups.some((q) => Math.hypot(q.x - x, q.z - z) < 1.6)) continue;
        return { x, z };
      }
      return null;
    }
    updatePickups() {
      const t = this.t;
      if (t >= this.nextPickup) {
        this.nextPickup += C.PICKUP_EVERY;
        if (this.pickups.length < C.PICKUP_MAX) {
          const pt = this.freePoint();
          if (pt) {
            const type = PICKUP_TYPES[(this.rng() * PICKUP_TYPES.length) | 0];
            const pk = { id: ++this.pid, type, x: pt.x, z: pt.z, until: t + C.PICKUP_LIFE };
            this.pickups.push(pk);
            this.emit({ t: 'pickup_spawn', id: pk.id, type, x: pk.x, z: pk.z, life: C.PICKUP_LIFE });
          }
        }
      }
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        if (t >= pk.until) { this.pickups.splice(i, 1); this.emit({ t: 'pickup_expire', id: pk.id }); continue; }
        for (const p of this.players) {
          if (!p.alive || Math.hypot(p.x - pk.x, p.z - pk.z) > C.PICKUP_R + C.PLAYER_R) continue;
          this.pickups.splice(i, 1);
          this.applyPickup(p, pk);
          break;
        }
      }
    }
    applyPickup(p, pk) {
      const t = this.t, ev = { t: 'pickup_take', id: pk.id, by: p.id, type: pk.type, x: pk.x, z: pk.z };
      if (pk.type === 'heal') {
        // hồi máu; phần thừa khi đã đầy được cộng vào máu gốc (tối đa) của người chơi, giữ nguyên tới khi mất mạng
        const heal = this.healAmt, room = p.hpMax - p.hp, over = Math.max(0, heal - room);
        const bonus = Math.max(0, Math.min(over, this.hpLimit() - p.hpMax));     // trần máu cộng thêm (+50% máu gốc, hoặc trần đột tử)
        p.hpMax += bonus; p.hp = Math.min(p.hpMax, p.hp + heal);
        ev.bonus = bonus; ev.heal = heal;
      }
      else if (pk.type === 'bomb') this.throwBombs(p);
      else if (pk.type === 'boots') { p.speedUntil = t + C.BOOST_TIME; p.freezeUntil = 0; ev.speedTime = C.BOOST_TIME; }
      else if (pk.type === 'power') { p.power = 1; p.powerUntil = t + C.POWER_TIME; }   // không cộng dồn: nhặt thêm chỉ làm mới 2s
      else if (pk.type === 'shield') p.shieldUntil = Math.max(p.shieldUntil, t + C.SHIELD);
      else if (pk.type === 'freeze') {
        ev.frozen = [];
        ev.immune = [];
        for (const q of this.players) if (q.alive && q.team !== p.team) {
          if (q.speedUntil > t) { ev.immune.push(q.id); continue; }     // đang chạy nhanh bằng giày: miễn nhiễm đóng băng
          q.freezeUntil = t + C.FREEZE; q.vx = q.vz = 0; ev.frozen.push(q.id);
        }
      }
      ev.hp = p.hp; ev.hpMax = p.hpMax; ev.power = p.power; ev.powerTime = C.POWER_TIME;
      this.emit(ev);
    }

    /** Trần máu tối đa hiện tại: máu gốc +50% (hồi máu đầy), và bị kéo xuống dần khi đột tử */
    hpLimit() { return Math.min(Math.round(this.hpBase * (1 + C.HP_EXTRA)), this.hpCap(true)); }
    /** Trần do đột tử (không đột tử thì bằng hpBase hoặc vô hạn nếu inf) */
    hpCap(inf) {
      const S = C.SUDDEN, el = this.t - this.fightStart;
      if (this.phase === 'select' || !this.fightStart && this.phase !== 'fight' || el < S.after) return inf ? Infinity : this.hpBase;
      const floor = Math.max(10, Math.round(this.hpBase * S.floor));
      return Math.max(floor, Math.round(this.hpBase - this.hpBase * S.rate * (el - S.after)));
    }
    updateSudden() {
      if (this.t - this.fightStart < C.SUDDEN.after) return;
      if (!this.sudden) { this.sudden = true; this.emit({ t: 'sudden' }); }
      const cap = this.hpCap(true);
      for (const p of this.players) {
        if (!p.alive || p.hpMax <= cap) continue;
        p.hpMax = cap; if (p.hp > cap) p.hp = cap;
      }
    }
    /** Bom ném: tự ném BOMB.count quả vào vị trí gần địch (lệch ngẫu nhiên ≤ spread). Địch chạy khỏi vùng nổ trong lúc bom rơi là né được. */
    throwBombs(p) {
      const B = C.BOMB;
      let foes = this.players.filter((q) => q.team !== p.team && q.alive);
      if (!foes.length) foes = this.players.filter((q) => q.team !== p.team);
      if (!foes.length) return;
      for (let i = 0; i < B.count; i++) {
        const f = foes[i % foes.length], a = this.rng() * Math.PI * 2, d = this.rng() * B.spread;
        const x = clamp(f.x + Math.sin(a) * d, -(this.map.HW - 0.3), this.map.HW - 0.3);
        const z = clamp(f.z + Math.cos(a) * d, -(this.map.HD - 0.3), this.map.HD - 0.3);
        const fall = Math.max(0.3, B.fall - (B.count - 1 - i) * B.stagger);   // quả cuối rơi đúng ~1s, quả đầu sớm hơn
        const b = { id: ++this.bid, owner: p.id, team: p.team, x, z, land: this.t + fall, fall };
        this.bombs.push(b);
        this.emit({ t: 'bomb_throw', id: b.id, owner: p.id, fx: +p.x.toFixed(3), fz: +p.z.toFixed(3), x: +x.toFixed(3), z: +z.toFixed(3), fall });
      }
    }
    updateBombs() {
      const B = C.BOMB;
      for (let i = 0; i < this.bombs.length; i++) {
        const b = this.bombs[i];
        if (this.t < b.land) continue;
        this.bombs.splice(i, 1); i--;
        this.emit({ t: 'bomb_boom', id: b.id, x: b.x, z: b.z, r: B.radius });
        const owner = this.player(b.owner) || { id: b.owner, team: b.team };
        for (const q of this.players) {
          if (!q.alive || q.team === b.team) continue;
          if (Math.hypot(q.x - b.x, q.z - b.z) <= B.radius) {
            this.damage(q, owner, this.bombDmg, 'bomb');
            if (this.phase !== 'fight') return;
          }
        }
      }
    }

    pause() {
      if (this.phase === 'over') return;
      this.phase = 'paused'; this.bullets = []; this.stones = []; this.bombs = []; this.pickups = [];
      this.emit({ t: 'paused' });
    }
    /** Kết nối lại sau khi bị tạm dừng: ván đấu tiếp tục (mạng đã mất vẫn giữ nguyên) */
    resume() {
      if (this.phase !== 'paused') return;
      if (this.winner) { this.phase = 'over'; this.emit({ t: 'over', winner: this.winner, lives: Object.assign({}, this.lives), reason: 'lives' }); return; }
      this.phase = 'fight';
      this.nextPickup = this.t + C.PICKUP_EVERY;
      for (const p of this.players) {
        if (p.alive) { p.shieldUntil = this.t + C.SPAWN_SHIELD; p.lockUntil = this.t + 0.4; }
        else if (this.lives[p.team] > 0) p.respawnAt = this.t + 0.5;
      }
      this.emit({ t: 'resumed', shield: C.SPAWN_SHIELD });
    }
    forfeit(team) {
      if (this.phase === 'over') return;
      this.phase = 'over'; this.winner = other(team); this.bullets = []; this.stones = []; this.bombs = [];
      this.emit({ t: 'over', winner: this.winner, lives: Object.assign({}, this.lives), reason: 'forfeit' });
    }

    pstate(p) {
      const t = this.t;
      return { id: p.id, team: p.team, x: +p.x.toFixed(3), z: +p.z.toFixed(3), vx: +p.vx.toFixed(2), vz: +p.vz.toFixed(2), aim: +p.aim.toFixed(3),
        hp: p.hp, hm: p.hpMax, al: p.alive, w: p.weapon, sp: Math.max(0, +(p.speedUntil - t).toFixed(2)), am: p.ammo, rl: Math.max(0, +(p.reloadUntil - t).toFixed(2)),
        sn: Math.max(0, +(p.nextSnipe - t).toFixed(2)), sh: Math.max(0, +(p.shieldUntil - t).toFixed(2)),
        fr: Math.max(0, +(p.freezeUntil - t).toFixed(2)), pw: p.power, pwt: p.power > 0 ? Math.max(0, +(p.powerUntil - t).toFixed(2)) : 0, rs: p.alive ? 0 : Math.max(0, +(p.respawnAt - t).toFixed(2)) };
    }
    /** Cập nhật định kỳ (≈20Hz) */
    state() { return { phase: this.phase, lives: Object.assign({}, this.lives), players: this.players.map((p) => this.pstate(p)) }; }
    /** Ảnh chụp đầy đủ (cho người vào xem / kết nối lại) */
    snapshot() {
      return Object.assign(this.state(), {
        sd: this.sudden,
        livesMax: this.livesMax, hpBase: this.hpBase, bombs: this.bombs.map((b) => ({ id: b.id, owner: b.owner, x: b.x, z: b.z, fall: b.fall, left: Math.max(0, +(b.land - this.t).toFixed(2)) })), sel: Math.max(0, +(this.selectEnd - this.t).toFixed(2)),
        pickups: this.pickups.map((q) => ({ id: q.id, type: q.type, x: q.x, z: q.z, life: Math.max(0, +(q.until - this.t).toFixed(1)) })),
        bullets: this.bullets.map((b) => ({ id: b.id, owner: b.owner, x: b.x, z: b.z, vx: b.vx, vz: b.vz, dmg: b.dmg, bounces: b.bounces })),
        broken: this.map.obstacles.map((o, i) => o.broken ? { i, w: o.w, d: o.d, r: o.r, gone: !!o.gone } : null).filter(Boolean),
        stones: this.stones.map((b) => ({ id: b.id, owner: b.owner, x: b.x, z: b.z, vx: b.vx, vz: b.vz, dmg: b.dmg, left: Math.max(0, +(b.len - b.dist).toFixed(2)) })),
        ts: this.wall,
      });
    }
  }

  const Shooter = { Sim, mapOf, cloneMap, hitsToBreak, applyBreak, mulberry32, hitObstacle, blocked, pushOut, stepMove, segClear, rayToBounds, stepBullet };
  return { Shooter, Sim };
});
