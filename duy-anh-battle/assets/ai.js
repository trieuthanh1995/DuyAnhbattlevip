/* Bubble Blast – Bot AI (chạy offline trong trình duyệt và trên server online)
 * Bot tự di chuyển bằng stepMove và điều khiển súng qua sim.setInput. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.PP;
  const sh = isNode ? require('./shooter.js') : root.PP;
  const mod = factory(cfg, sh);
  if (isNode) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function (cfg, sh) {
  'use strict';
  const { C, LEVELS } = cfg;
  const { Shooter } = sh;
  const { stepMove, segClear, blocked } = Shooter;
  const TAU = Math.PI * 2;
  const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  class BotBrain {
    constructor(sim, id, levelId, rng) {
      this.sim = sim; this.id = id;
      this.L = LEVELS[levelId] || LEVELS.pro;
      this.rng = rng;
      this.aim = 0; this.errAng = 0; this.errT = 0;
      this.strafe = rng() < 0.5 ? 1 : -1; this.strafeT = 0;
      this.seeT = 0; this.wpnT = 0; this.want = 'rifle';
      this.goal = null; this.goalT = 0;
      this.stuckT = 0; this.lastX = 0; this.lastZ = 0; this.unstick = 0; this.unstickDir = 1;
    }
    get p() { return this.sim.player(this.id); }
    rand(a, b) { return a + this.rng() * (b - a); }

    nearestEnemy(p) {
      let best = null, bd = Infinity;
      for (const q of this.sim.players) {
        if (!q.alive || q.team === p.team) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd) { bd = d; best = q; }
      }
      return best ? { q: best, d: bd } : null;
    }
    /** Chọn hướng đi tốt nhất (tránh vật cản) hướng tới vector mong muốn (dx,dz) */
    steer(p, dx, dz) {
      const map = this.sim.map, l = Math.hypot(dx, dz);
      if (l < 1e-6) return [0, 0];
      dx /= l; dz /= l;
      let best = [0, 0], bs = -Infinity;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU, cx = Math.sin(a), cz = Math.cos(a);
        let s = cx * dx + cz * dz;
        for (const k of [0.7, 1.4]) if (blocked(map, p.x + cx * k, p.z + cz * k, C.PLAYER_R + 0.05)) s -= k === 0.7 ? 2.5 : 1.0;
        if (s > bs) { bs = s; best = [cx, cz]; }
      }
      return best;
    }
    chooseGoalPickup(p, en) {
      const L = this.L, pk = this.sim.pickups;
      if (!pk.length || this.rng() > L.pickup + 0.2) return null;
      let best = null, bs = -Infinity;
      for (const q of pk) {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        let w = q.type === 'heal' ? (p.hp < 70 ? 3 : 0.6) : q.type === 'freeze' ? 2 : q.type === 'power' ? 1.6 : 1.4;
        if (q.type === 'heal' && p.hp < 40) w = 6;
        // đối thủ ở gần vật phẩm hơn thì bỏ
        if (en && Math.hypot(q.x - en.q.x, q.z - en.q.z) + 1 < d && d > 4) w *= 0.3;
        const s = w * 3 - d;
        if (s > bs && d < 9) { bs = s; best = q; }
      }
      return bs > 0 ? best : null;
    }
    incomingBullet(p) {
      let worst = null, wt = 1.2;
      for (const b of this.sim.bullets) {
        if (b.team === p.team) continue;
        const rx = p.x - b.x, rz = p.z - b.z, sp = Math.hypot(b.vx, b.vz);
        const t = (rx * b.vx + rz * b.vz) / (sp * sp);
        if (t < 0 || t > wt) continue;
        const cx = b.x + b.vx * t - p.x, cz = b.z + b.vz * t - p.z;
        if (Math.hypot(cx, cz) < 0.9) { wt = t; worst = { b, cx, cz }; }
      }
      return worst;
    }

    tick(dt, now) {
      const sim = this.sim, p = this.p, L = this.L;
      if (!p || !p.alive) return;
      if (sim.phase !== 'fight' && sim.phase !== 'countdown') { p.vx = p.vz = 0; return; }
      const frozen = p.freezeUntil > sim.t;
      const en = this.nearestEnemy(p);
      // ---- ngắm & bắn
      let fire = false;
      if (en) {
        const q = en.q, d = en.d;
        const los = segClear(sim.map, p.x, p.z, q.x, q.z, 0.12);
        this.seeT = los ? this.seeT + dt : 0;
        this.wpnT -= dt;
        if (this.wpnT <= 0) {
          this.wpnT = this.rand(0.6, 1.2);
          const wantSniper = (!los && d < 30 && this.rng() < L.sniper) || (los && d > 8 && this.rng() < L.sniper * 0.8) || (p.ammo === 0 && this.rng() < 0.7);
          this.want = wantSniper ? 'sniper' : 'rifle';
        }
        const sniper = p.weapon === 'sniper';
        // dự đoán vị trí (đạn trường bay tốc độ hữu hạn)
        const tf = sniper ? 0 : d / C.RIFLE.speed;
        const tx = q.x + q.vx * tf * L.lead, tz = q.z + q.vz * tf * L.lead;
        this.errT -= dt;
        if (this.errT <= 0) { this.errT = this.rand(0.35, 0.8); this.errAng = (this.rng() + this.rng() + this.rng() - 1.5) * 2 * L.err; }
        const want = Math.atan2(tx - p.x, tz - p.z) + this.errAng;
        const diff = wrap(want - this.aim), maxTurn = L.turn * dt;
        this.aim = wrap(this.aim + Math.max(-maxTurn, Math.min(maxTurn, diff)));
        const aligned = Math.abs(wrap(want - this.aim)) < (sniper ? 0.04 : 0.1);
        const ready = this.seeT > L.react;
        if (!frozen && aligned) {
          if (sniper) fire = d < 36 && (los ? ready : true);       // ná xuyên vật: bắn cả khi bị che
          else fire = los && ready && p.ammo > 0 && d < 16;
        }
      } else this.errT = 0;
      sim.setInput(this.id, { aim: this.aim, fire, w: this.want });

      // ---- di chuyển
      if (frozen || sim.phase !== 'fight') { p.vx = p.vz = 0; return; }
      let dx = 0, dz = 0, speed = L.speed;
      const inc = L.dodge > 0 ? this.incomingBullet(p) : null;
      this.goalT -= dt;
      if (this.goalT <= 0) { this.goalT = this.rand(0.5, 1.1); this.goal = this.chooseGoalPickup(p, en); }
      if (this.goal && !sim.pickups.includes(this.goal)) this.goal = null;
      if (inc && this.rng() < L.dodge * 0.12 + 0.02) {
        // né sang ngang quỹ đạo đạn
        const sgn = inc.cx * -1 >= 0 ? 1 : -1;
        const bl = Math.hypot(inc.b.vx, inc.b.vz);
        dx = -inc.b.vz / bl * sgn; dz = inc.b.vx / bl * sgn;
        this.dodgeUntil = sim.t + 0.35; this.dodgeDir = [dx, dz];
      } else if (this.dodgeUntil && sim.t < this.dodgeUntil) { dx = this.dodgeDir[0]; dz = this.dodgeDir[1]; }
      else if (this.goal) { dx = this.goal.x - p.x; dz = this.goal.z - p.z; }
      else if (en) {
        const q = en.q, ex = q.x - p.x, ez = q.z - p.z, d = en.d;
        const los = segClear(sim.map, p.x, p.z, q.x, q.z, 0.2);
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = this.rand(0.8, 2.0); if (this.rng() < 0.6) this.strafe = -this.strafe; }
        const pref = p.weapon === 'sniper' ? L.range + 4 : L.range;
        const ux = ex / (d || 1), uz = ez / (d || 1);
        if (!los) { dx = ux; dz = uz; }                                  // chưa thấy: áp sát
        else {
          const radial = d > pref + 1 ? 1 : d < pref - 1.5 ? -1 : 0;
          dx = ux * radial + -uz * this.strafe * 0.9; dz = uz * radial + ux * this.strafe * 0.9;
        }
        speed *= los ? 0.9 : 1;
      }
      // chống kẹt
      const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
      if (Math.hypot(dx, dz) > 0.3 && moved < 0.2 * dt * 60 * 0.02) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      this.lastX = p.x; this.lastZ = p.z;
      if (this.stuckT > 0.5) { this.unstick = 0.6; this.unstickDir = this.rng() < 0.5 ? 1 : -1; this.stuckT = 0; }
      if (this.unstick > 0) { this.unstick -= dt; const a = Math.atan2(dx, dz) + this.unstickDir * 1.4; dx = Math.sin(a); dz = Math.cos(a); }
      const [mx, mz] = this.steer(p, dx, dz);
      const mag = Math.hypot(dx, dz) < 0.05 ? 0 : 1;
      stepMove(sim.map, p, mx * mag, mz * mag, dt, speed);
    }
  }

  return { BotBrain };
});
