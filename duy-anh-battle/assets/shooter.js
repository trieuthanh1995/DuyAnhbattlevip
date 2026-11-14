/* Bubble Blast – lõi mô phỏng (trình duyệt + Node): hình học, đạn, súng, vật phẩm, hiệp đấu.
 * Hệ tọa độ: mặt sân là mặt phẳng (x, z). Hướng ngắm `aim` (rad): hướng = (sin aim, cos aim).
 * Đội A xuất phát bên trái (x<0), đội B bên phải (x>0).
 * Sim phát sự kiện vào hàng đợi drain():
 *   round_start, fight, shoot, snipe, hit, dead, bpop, pickup_spawn, pickup_take, pickup_expire, round_end, over, paused */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.PP;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function (cfg) {
  'use strict';
  const { C, MAPS, PICKUP_TYPES } = cfg;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const other = (t) => (t === 'A' ? 'B' : 'A');
  const mapOf = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
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

  /** Một bước đạn bong bóng: trả về 'pop' nếu vỡ do nảy quá 5 lần / hết giờ, 'bounce' nếu vừa nảy */
  function stepBullet(map, b, dt) {
    b.x += b.vx * dt; b.z += b.vz * dt; b.age += dt;
    let bounced = false;
    const mx = map.HW - b.r, mz = map.HD - b.r;
    if (b.x > mx) { b.x = mx; b.vx = -Math.abs(b.vx); bounced = true; }
    else if (b.x < -mx) { b.x = -mx; b.vx = Math.abs(b.vx); bounced = true; }
    if (b.z > mz) { b.z = mz; b.vz = -Math.abs(b.vz); bounced = true; }
    else if (b.z < -mz) { b.z = -mz; b.vz = Math.abs(b.vz); bounced = true; }
    for (const o of map.obstacles) {
      const h = hitObstacle(o, b.x, b.z, b.r);
      if (!h) continue;
      b.x += h.nx * h.pen; b.z += h.nz * h.pen;
      const dot = b.vx * h.nx + b.vz * h.nz;
      if (dot < 0) { b.vx -= 2 * dot * h.nx; b.vz -= 2 * dot * h.nz; }
      bounced = true;
    }
    if (bounced) {
      b.bounces++;
      if (b.bounces > C.RIFLE.bounces) return 'pop';
    }
    if (b.age > C.RIFLE.life) return 'pop';
    return bounced ? 'bounce' : null;
  }

  /* ================= Sim ================= */
  class Sim {
    /** opts = {map, teamSize, bo, seed, players:[{id, team}]} */
    constructor(opts) {
      this.map = mapOf(opts.map || opts.venue);
      this.teamSize = opts.teamSize === 2 ? 2 : 1;
      this.bo = opts.bo === 3 ? 3 : 1;
      this.need = (this.bo + 1) / 2;
      this.rng = mulberry32((opts.seed >>> 0) || 1);
      this.players = opts.players.map((p) => ({
        id: p.id, team: p.team, x: 0, z: 0, vx: 0, vz: 0, aim: 0, hp: C.HP, alive: true,
        weapon: 'rifle', ammo: C.RIFLE.mag, reloadUntil: 0, nextRifle: 0, nextSnipe: 0,
        shieldUntil: 0, freezeUntil: 0, power: 0, fire: false, want: 'rifle', lastSet: 0,
      }));
      this.scores = { A: 0, B: 0 };
      this.round = 0; this.phase = 'idle';
      this.t = 0; this.wall = 0; this.last = null; this.acc = 0;
      this.bullets = []; this.pickups = []; this.bid = 0; this.pid = 0;
      this.fightAt = 0; this.nextPickup = 0; this.nextRoundAt = 0;
      this.winner = null; this.overPending = false;
      this.out = [];
    }
    player(id) { return this.players.find((p) => p.id === id) || null; }
    drain() { const o = this.out; this.out = []; return o; }
    emit(e) { e.ts = this.wall; this.out.push(e); }
    teamAlive(t) { return this.players.some((p) => p.team === t && p.alive); }

    start(now) { this.wall = now; this.last = now; this.newRound(); }

    newRound() {
      this.round++;
      this.phase = 'countdown';
      this.bullets = []; this.pickups = [];
      this.fightAt = this.t + C.COUNTDOWN;
      const idx = { A: 0, B: 0 };
      for (const p of this.players) {
        const sp = this.map.spawns[p.team][idx[p.team]++ % 2];
        p.x = sp[0]; p.z = sp[1]; p.vx = p.vz = 0;
        p.aim = p.team === 'A' ? Math.PI / 2 : -Math.PI / 2;
        p.hp = C.HP; p.alive = true; p.weapon = 'rifle'; p.want = 'rifle';
        p.ammo = C.RIFLE.mag; p.reloadUntil = 0; p.nextRifle = 0; p.nextSnipe = 0;
        p.shieldUntil = 0; p.freezeUntil = 0; p.power = 0; p.fire = false;
      }
      this.emit({ t: 'round_start', round: this.round, scores: Object.assign({}, this.scores), countdown: C.COUNTDOWN,
        positions: this.players.map((p) => ({ id: p.id, x: p.x, z: p.z, aim: p.aim })) });
    }

    /** Bot: đặt hướng ngắm / bắn / đổi súng (di chuyển do bot tự làm bằng stepMove) */
    setInput(id, inp) {
      const p = this.player(id);
      if (!p) return;
      if (typeof inp.aim === 'number' && Number.isFinite(inp.aim)) p.aim = inp.aim;
      p.fire = !!inp.fire;
      if (inp.w === 'rifle' || inp.w === 'sniper') p.want = inp.w;
    }
    /** Người chơi: trạng thái do máy khách báo. strict=true (server): giới hạn tốc độ + va chạm */
    setPlayerState(id, s, strict, now) {
      const p = this.player(id);
      if (!p) return;
      if (typeof s.aim === 'number' && Number.isFinite(s.aim)) p.aim = s.aim;
      p.fire = !!s.fire;
      if (s.w === 'rifle' || s.w === 'sniper') p.want = s.w;
      if (!p.alive || this.phase !== 'fight' || p.freezeUntil > this.t) { p.vx = p.vz = 0; p.lastSet = now || 0; return; }
      let nx = s.x, nz = s.z;
      if (strict) {
        const dt = clamp((now || 0) - p.lastSet, 0.01, 0.25);
        const maxStep = C.SPEED * 1.3 * dt + 0.15;
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
      if (this.phase === 'countdown') {
        if (this.t >= this.fightAt) { this.phase = 'fight'; this.nextPickup = this.t + C.PICKUP_EVERY; this.emit({ t: 'fight' }); }
        return;
      }
      if (this.phase === 'round_end') {
        if (this.t >= this.nextRoundAt) {
          if (this.overPending) { this.phase = 'over'; this.emit({ t: 'over', winner: this.winner, scores: Object.assign({}, this.scores), reason: 'score' }); }
          else this.newRound();
        }
        return;
      }
      if (this.phase !== 'fight') return;
      this.updatePlayers();
      this.updateBullets(dt);
      this.updatePickups();
      this.checkEnd();
    }

    updatePlayers() {
      const t = this.t;
      for (const p of this.players) {
        if (!p.alive) continue;
        if (p.reloadUntil && t >= p.reloadUntil) { p.ammo = C.RIFLE.mag; p.reloadUntil = 0; }
        const frozen = p.freezeUntil > t;
        if (!frozen && p.want !== p.weapon) {
          p.weapon = p.want;
          p.nextRifle = Math.max(p.nextRifle, t + C.SWITCH_DELAY);
          p.nextSnipe = Math.max(p.nextSnipe, t + C.SWITCH_DELAY);
        }
        if (!p.fire || frozen) continue;
        if (p.weapon === 'rifle') {
          if (p.ammo > 0 && !p.reloadUntil && t >= p.nextRifle) this.shootRifle(p);
        } else if (t >= p.nextSnipe) this.shootSnipe(p);
      }
    }
    dmgOf(p, base) { return base + p.power * C.POWER_BONUS; }

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
    shootSnipe(p) {
      const S = C.SNIPER, dx = Math.sin(p.aim), dz = Math.cos(p.aim);
      const len = Math.min(S.range, rayToBounds(this.map, p.x, p.z, dx, dz));
      const dmg = this.dmgOf(p, S.dmg), hits = [];
      p.nextSnipe = this.t + S.delay;
      for (const q of this.players) {
        if (!q.alive || q.team === p.team) continue;
        const rx = q.x - p.x, rz = q.z - p.z;
        const s = rx * dx + rz * dz;
        if (s < 0 || s > len + C.PLAYER_R) continue;
        if (Math.abs(rx * dz - rz * dx) <= C.PLAYER_R + S.width) hits.push(q);
      }
      this.emit({ t: 'snipe', owner: p.id, x: p.x, z: p.z, ex: p.x + dx * len, ez: p.z + dz * len, hits: hits.map((q) => q.id), dmg });
      for (const q of hits) this.damage(q, p, dmg, 'snipe');
    }

    damage(q, by, dmg, kind) {
      if (!q.alive) return;
      if (q.shieldUntil > this.t) { this.emit({ t: 'hit', target: q.id, by: by.id, dmg: 0, hp: q.hp, shielded: true, kind }); return; }
      q.hp = Math.max(0, q.hp - dmg);
      this.emit({ t: 'hit', target: q.id, by: by.id, dmg, hp: q.hp, kind });
      if (q.hp <= 0) { q.alive = false; q.fire = false; this.emit({ t: 'dead', id: q.id, by: by.id }); }
    }

    updateBullets(dt) {
      const h = dt / 2;
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        let dead = false, hitP = null;
        for (let s = 0; s < 2 && !dead; s++) {
          if (stepBullet(this.map, b, h) === 'pop') { dead = true; break; }
          for (const q of this.players) {
            if (!q.alive || q.team === b.team) continue;
            const dx = q.x - b.x, dz = q.z - b.z, rr = C.PLAYER_R + b.r;
            if (dx * dx + dz * dz < rr * rr) { hitP = q; dead = true; break; }
          }
        }
        if (dead) {
          this.bullets.splice(i, 1);
          this.emit({ t: 'bpop', id: b.id, x: b.x, z: b.z, hit: !!hitP });
          if (hitP) this.damage(hitP, this.player(b.owner) || { id: b.owner }, b.dmg, 'rifle');
        }
      }
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
      if (pk.type === 'heal') p.hp = Math.min(C.HP, p.hp + C.HEAL);
      else if (pk.type === 'power') p.power++;
      else if (pk.type === 'shield') p.shieldUntil = t + C.SHIELD;
      else if (pk.type === 'freeze') {
        ev.frozen = [];
        for (const q of this.players) if (q.alive && q.team !== p.team) { q.freezeUntil = t + C.FREEZE; q.vx = q.vz = 0; q.fire = false; ev.frozen.push(q.id); }
      }
      ev.hp = p.hp; ev.power = p.power;
      this.emit(ev);
    }

    checkEnd() {
      const a = this.teamAlive('A'), b = this.teamAlive('B');
      if (a && b) return;
      let winner = null;
      if (a) winner = 'A'; else if (b) winner = 'B';
      if (winner) this.scores[winner]++;
      this.phase = 'round_end';
      this.nextRoundAt = this.t + C.ROUND_END_DELAY;
      this.bullets = [];
      if (winner && this.scores[winner] >= this.need) { this.overPending = true; this.winner = winner; }
      this.emit({ t: 'round_end', winner, scores: Object.assign({}, this.scores), final: this.overPending });
    }

    pause() {
      if (this.phase === 'over') return;
      this.phase = 'paused'; this.bullets = []; this.pickups = [];
      this.emit({ t: 'paused' });
    }
    resume() {
      if (this.phase !== 'paused') return;
      if (this.overPending) { this.phase = 'over'; this.emit({ t: 'over', winner: this.winner, scores: Object.assign({}, this.scores), reason: 'score' }); }
      else { this.round--; this.newRound(); }
    }
    forfeit(team) {
      if (this.phase === 'over') return;
      this.phase = 'over'; this.winner = other(team); this.bullets = [];
      this.emit({ t: 'over', winner: this.winner, scores: Object.assign({}, this.scores), reason: 'forfeit' });
    }

    pstate(p) {
      const t = this.t;
      return { id: p.id, team: p.team, x: +p.x.toFixed(3), z: +p.z.toFixed(3), vx: +p.vx.toFixed(2), vz: +p.vz.toFixed(2), aim: +p.aim.toFixed(3),
        hp: p.hp, al: p.alive, w: p.weapon, am: p.ammo, rl: Math.max(0, +(p.reloadUntil - t).toFixed(2)),
        sn: Math.max(0, +(p.nextSnipe - t).toFixed(2)), sh: Math.max(0, +(p.shieldUntil - t).toFixed(2)),
        fr: Math.max(0, +(p.freezeUntil - t).toFixed(2)), pw: p.power };
    }
    /** Cập nhật định kỳ (≈20Hz) */
    state() { return { phase: this.phase, round: this.round, scores: Object.assign({}, this.scores), players: this.players.map((p) => this.pstate(p)) }; }
    /** Ảnh chụp đầy đủ (cho người vào xem / kết nối lại) */
    snapshot() {
      return Object.assign(this.state(), {
        cd: Math.max(0, +(this.fightAt - this.t).toFixed(2)),
        pickups: this.pickups.map((q) => ({ id: q.id, type: q.type, x: q.x, z: q.z, life: Math.max(0, +(q.until - this.t).toFixed(1)) })),
        bullets: this.bullets.map((b) => ({ id: b.id, owner: b.owner, x: b.x, z: b.z, vx: b.vx, vz: b.vz, dmg: b.dmg, bounces: b.bounces })),
        ts: this.wall,
      });
    }
  }

  const Shooter = { Sim, mapOf, mulberry32, hitObstacle, blocked, pushOut, stepMove, segClear, rayToBounds, stepBullet };
  return { Shooter, Sim };
});
