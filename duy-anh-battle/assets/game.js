/* Bubble Blast – vòng lặp game bắn súng nhìn từ trên xuống, chế độ Offline (bot) & Online, menu */
(function (PP) {
  'use strict';
  const C = PP.C, A = PP.Audio, UI = PP.UI, $ = UI.$, Protocol = PP.Protocol, Shooter = PP.Shooter, Arena = PP.Arena;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const CHAR = (id) => PP.CHARACTERS.find((c) => c.id === id) || PP.CHARACTERS[0];
  const VENUE = (id) => PP.VENUES.find((v) => v.id === id) || PP.VENUES[0];
  const IS_FILE = location.protocol === 'file:';
  const other = (t) => (t === 'A' ? 'B' : 'A');
  const TAU = Math.PI * 2;
  const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');

  /* ================= Lưu trữ ================= */
  const DEFAULT_SETTINGS = { quality: 'auto', volume: 80, music: true, sfx: true, musicVol: 50, aimline: true, shake: true };
  const Save = {
    data: { wins: 0, losses: 0, char: 'bunny', level: 'pro', venue: 'candy', bo: 1, mode: 1, muted: false, name: '', deviceId: '', settings: {}, looks: {} },
    load() {
      try { Object.assign(this.data, JSON.parse(localStorage.getItem('bb-save') || '{}')); } catch (e) { /* localStorage bị chặn */ }
      this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings || {});
      if (!this.data.looks || typeof this.data.looks !== 'object') this.data.looks = {};
      if (![1, 3].includes(+this.data.bo)) this.data.bo = 1;
      if (!this.data.deviceId) {
        this.data.deviceId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'd' + Math.random().toString(16).slice(2) + Date.now().toString(16);
        this.save();
      }
      if (CHAR(this.data.char).unlock > this.data.wins) this.data.char = 'bunny';
      if (!PP.VENUES.some((v) => v.id === this.data.venue)) this.data.venue = 'candy';
    },
    save() { try { localStorage.setItem('bb-save', JSON.stringify(this.data)); } catch (e) { /* bỏ qua */ } },
  };
  const S = () => Save.data.settings;
  let softwareGL = false;
  function quality() {
    const q = S().quality;
    if (q && q !== 'auto') return q;
    if (softwareGL) return 'low';
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    return coarse || (navigator.hardwareConcurrency || 4) <= 4 ? 'medium' : 'high';
  }

  /* ================= Trang phục (look) ================= */
  const pickOne = (a) => a[(Math.random() * a.length) | 0];
  function myLook(id) {
    const cid = id || Save.data.char;
    const l = Object.assign({}, Save.data.looks[cid] || {});
    if (PP.Kit && PP.Kit.has(cid)) l.kit = true;     // kit VIP chỉ hiển thị trên máy này
    return l;
  }
  function fullLook(id) {
    const d = PP.Character.defaultLook ? PP.Character.defaultLook(id) : {};
    return Object.assign({}, d, myLook(id));
  }
  function botLook() {
    const O = PP.Character.OPTIONS;
    if (!O) return {};
    const look = {};
    if (Math.random() < 0.5 && O.patterns) look.pattern = pickOne(O.patterns).id;
    if (Math.random() < 0.4 && O.accessories) look.accessory = pickOne(O.accessories.filter((a) => !a.unlock)).id;
    return look;
  }

  /* ================= Three.js ================= */
  let renderer, world = null, clock, bullets, pickups, fx, aimDots = [];
  const camBase = new THREE.Vector3();
  const _v = new THREE.Vector3();
  let shake = 0, time = 0;

  /* ================= Trạng thái ================= */
  let mode = 'menu';            // menu | offline | online | spectate
  let paused = false;
  let session = null;
  const players = new Map();
  let me = null, myTeam = 'A', myPid = null;
  const V = {};
  const ctl = { w: 'rifle', aim: 0, sendT: 0, lastAmmo: 5, lastReload: false, cdShown: -1, menuT: 0 };
  function resetView(cfg) {
    Object.assign(V, { phase: 'idle', score: { A: 0, B: 0 }, round: 0, teamSize: 1, bo: 1, venue: 'candy', cdEnd: 0, over: false }, cfg || {});
    ctl.w = 'rifle'; ctl.sendT = 0; ctl.cdShown = -1; ctl.lastAmmo = C.RIFLE.mag; ctl.lastReload = false;
  }
  resetView();
  const now = () => (session ? session.now() : time);

  function detectSoftwareGL(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (e) { return false; }
  }
  function initRenderer() {
    renderer = Arena.createRenderer($('#game'), 'low');
    softwareGL = detectSoftwareGL(renderer);
    Arena.applyQuality(renderer, quality());
    if (softwareGL) renderer.setPixelRatio(Math.min(1, 0.75 * (window.devicePixelRatio || 1)));
    clock = new THREE.Clock();
    window.addEventListener('resize', resize);
    renderer.setSize(window.innerWidth, window.innerHeight);
    PP.Input.init($('#game'));
  }
  function applyView() {
    if (!world) return;
    world.setView(window.innerWidth, window.innerHeight, myTeam);
    camBase.copy(world.camera.position);
  }
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyView();
    document.body.classList.toggle('touch', PP.Input.isTouch());
  }

  function disposeWorld() {
    for (const p of players.values()) { try { p.ch.dispose(); } catch (e) { /* bỏ qua */ } if (p.holder && p.holder.parent) p.holder.parent.remove(p.holder); }
    players.clear();
    if (bullets) bullets.clear();
    if (world) { try { world.dispose(); } catch (e) { /* bỏ qua */ } }
    world = null; bullets = pickups = fx = null; aimDots = [];
    $('#tags').textContent = ''; $('#floaters').textContent = '';
  }

  function buildScene(mapId, list, tags) {
    disposeWorld();
    world = Arena.build(renderer, mapId, quality());
    bullets = new Arena.Bullets(world); pickups = new Arena.Pickups(world); fx = new Arena.Fx(world);
    const dotGeo = new THREE.CircleGeometry(0.07, 8), dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 46; i++) { const m = new THREE.Mesh(dotGeo, dotMat.clone()); m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.visible = false; world.scene.add(m); aimDots.push(m); }
    for (const p of list) {
      const def = CHAR(p.char), look = p.look || {};
      const ch = PP.Character.build(def, { team: 'B', look });     // 'B' = hướng +z, xoay bằng holder
      ch.root.traverse((o) => { if (o.userData && o.userData.paddle) o.visible = false; });
      ch.setHighlight(Arena.TEAM_COL[p.team]);
      const holder = new THREE.Group(); holder.add(ch.root); world.scene.add(holder);
      const guns = Arena.makeGuns(); holder.add(guns.rifle, guns.sniper);
      const col = look.paddle ? parseInt(String(look.paddle).replace('#', ''), 16) : (def.paddle != null ? def.paddle : 0xff6f91);
      guns.rifle.children[0].material.color.set(col).convertSRGBToLinear();
      const shield = Arena.makeShield(), ice = Arena.makeIce(); shield.visible = ice.visible = false; holder.add(shield, ice);
      const obj = Object.assign({ x: 0, z: 0, vx: 0, vz: 0, aim: p.team === 'A' ? Math.PI / 2 : -Math.PI / 2, yaw: 0, hp: C.HP, alive: true, w: 'rifle', am: C.RIFLE.mag, rl: 0, sn: 0, sh: 0, fr: 0, pw: 0,
        buf: [], tag: null, deadT: 0, kick: 0, celebrate: false }, p, { ch, holder, guns, shield, ice });
      obj.yaw = obj.aim;
      if (tags) {
        const el = document.createElement('div');
        el.className = 'nametag hp ' + (p.isMe ? 'me ' : '') + (p.team === 'A' ? 'ta' : 'tb');
        const nm = document.createElement('span'); nm.textContent = p.isMe ? 'Bạn' : p.name;
        const mini = document.createElement('div'); mini.className = 'mini'; const bar = document.createElement('i'); bar.style.width = '100%'; mini.append(bar);
        el.append(nm, mini); $('#tags').append(el);
        obj.tag = el; obj.tagBar = bar;
      }
      players.set(p.id, obj);
    }
    applyView();
  }
  function buildMenuScene() {
    const pick = PP.CHARACTERS.filter((c) => c.id !== Save.data.char);
    myTeam = 'A';
    buildScene(Save.data.venue, [
      { id: 'm1', team: 'A', char: Save.data.char, name: '', look: myLook() },
      { id: 'm2', team: 'B', char: pickOne(pick).id, name: '', look: botLook() },
    ], false);
    const a = players.get('m1'), b = players.get('m2');
    a.x = -3.2; a.z = 0.4; b.x = 3.2; b.z = -0.4; a.aim = Math.PI / 2; b.aim = -Math.PI / 2;
    if (A.ambience) A.ambience(false);
  }

  function teamName(t) {
    const ps = [...players.values()].filter((p) => p.team === t);
    if (mode !== 'spectate' && t === myTeam) return V.teamSize === 2 ? 'Đội bạn' : 'Bạn';
    if (V.teamSize === 2) return mode === 'offline' ? 'Đối thủ' : ps.map((p) => p.name).join(' & ');
    return ps[0] ? ps[0].name : '?';
  }
  function floater(x, z, text, cls, y) {
    if (!world) return;
    const pt = world.project(x, y || 1.5, z); if (!pt.vis) return;
    const el = document.createElement('div'); el.className = 'floater ' + (cls || ''); el.textContent = text;
    el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
    $('#floaters').append(el); setTimeout(() => el.remove(), 950);
  }
  let hitSndT = 0;
  const CS = C.CHAR_SCALE || 1.3;

  /* ================= Sự kiện trận đấu (cả offline lẫn online) ================= */
  function applyEvent(e) {
    switch (e.t) {
      case 'round_start': {
        V.phase = 'countdown'; V.round = e.round; V.score = e.scores; V.cdEnd = e.ts + e.countdown; ctl.cdShown = -1; V.over = false;
        if (bullets) bullets.clear(); if (pickups) pickups.clear();
        for (const p of players.values()) {
          p.hp = C.HP; p.alive = true; p.sh = p.fr = p.pw = p.rl = p.sn = 0; p.am = C.RIFLE.mag; p.w = 'rifle'; p.buf.length = 0;
          p.holder.visible = true; p.deadT = 0; p.celebrate = false; p.vx = p.vz = 0;
          if (p.tag) p.tag.classList.remove('dead');
        }
        for (const pos of e.positions) { const p = players.get(pos.id); if (p) { p.x = pos.x; p.z = pos.z; p.aim = pos.aim; p.yaw = pos.aim; } }
        ctl.w = 'rifle';
        if (me) ctl.aim = me.aim;
        UI.hideScreens(); UI.banner(null);
        UI.setMsg(V.bo === 3 ? `Hiệp ${e.round}` : '');
        updateHUD();
        break;
      }
      case 'fight': V.phase = 'fight'; UI.call('BẮN!', '', 'good'); A.beep(true); UI.setMsg(''); break;
      case 'shoot': {
        const p = players.get(e.owner); if (!bullets) break;
        bullets.spawn(e, p ? p.team : 'A', now() - e.ts);
        if (p) { p.kick = 1; if (p.isMe) { me.am = e.ammo; } }
        if (p && (p.isMe || Math.random() < 0.6)) A.gunShot(p.pw);
        if (p && me && p === me && e.ammo === 0) setTimeout(() => A.reloadClick(), 250);
        break;
      }
      case 'snipe': {
        const p = players.get(e.owner);
        fx.beam(e.x, e.z, e.ex, e.ez, 0xffe27a);
        fx.burst(e.x, e.z, 0xffe27a, 6, 2.5, 0.6, 0.07);
        if (p) p.kick = 1.6;
        A.snipeShot();
        for (const id of e.hits) { const q = players.get(id); if (q) fx.ring(q.x, q.z, 0xffe27a, 2.2); }
        break;
      }
      case 'hit': {
        const q = players.get(e.target); if (!q) break;
        q.hp = e.hp;
        if (e.shielded) { floater(q.x, q.z, '🛡️', 'shield'); fx.ring(q.x, q.z, 0x6fdcff, 1.8); A.shieldBlock(); break; }
        floater(q.x, q.z, '-' + e.dmg, 'dmg');
        fx.burst(q.x, q.z, 0xff6b8a, e.dmg >= 40 ? 16 : 7, 3.2, 0.7, 0.1);
        if (q.isMe) {
          A.hurt(e.dmg >= 40);
          if (S().shake) shake = Math.max(shake, e.dmg >= 40 ? 1 : 0.5);
          document.body.classList.remove('hit-flash'); void document.body.offsetWidth; document.body.classList.add('hit-flash');
        } else if (performance.now() - hitSndT > 80) { hitSndT = performance.now(); A.hurt(false); }
        const r = q.ch; if (r && r.splitStep) { try { r.splitStep(); } catch (x) { /* bỏ qua */ } }
        updateHUD();
        break;
      }
      case 'dead': {
        const q = players.get(e.id); if (!q) break;
        q.alive = false; q.hp = 0; q.deadT = 0.0001;
        fx.burst(q.x, q.z, 0xffffff, 22, 4, 0.7, 0.13); fx.ring(q.x, q.z, 0xff6b8a, 2.8);
        if (q.tag) q.tag.classList.add('dead');
        A.dead();
        if (q.isMe) UI.hint('Bạn bị hạ rồi! Xem đồng đội chiến đấu nhé', 3500);
        updateHUD();
        break;
      }
      case 'bpop': {
        if (!bullets) break;
        const b = bullets.remove(e.id);
        if (b || e.hit) { fx.burst(e.x, e.z, 0xcff4ff, e.hit ? 9 : 5, 2, 0.55, 0.07); if (!e.hit && Math.random() < 0.7) A.bubblePop(); }
        break;
      }
      case 'pickup_spawn': if (pickups) { pickups.add(e); A.spawnPing(); } break;
      case 'pickup_expire': if (pickups) pickups.remove(e.id); break;
      case 'pickup_take': {
        if (pickups) pickups.remove(e.id);
        const p = players.get(e.by), info = Arena.PK[e.type];
        fx.burst(e.x, e.z, info.color, 14, 3.2, 0.8, 0.1); fx.ring(e.x, e.z, info.color, 2);
        if (p) {
          if (e.type === 'heal') { p.hp = e.hp; floater(p.x, p.z, '+' + C.HEAL, 'heal'); }
          else if (e.type === 'power') { p.pw = e.power; floater(p.x, p.z, '💪 +' + C.POWER_BONUS + ' sát thương', 'heal'); }
          else if (e.type === 'shield') { p.sh = C.SHIELD; floater(p.x, p.z, '🛡️ Khiên ' + C.SHIELD + 's', 'shield'); }
          else if (e.type === 'freeze') {
            for (const id of (e.frozen || [])) { const q = players.get(id); if (q) { q.fr = C.FREEZE; q.vx = q.vz = 0; floater(q.x, q.z, '❄️', 'shield'); } }
            floater(p.x, p.z, '❄️ Đóng băng!', 'shield');
          }
          if (p.isMe || me && p.team === me.team) A.pickup(e.type); else A.pickup(e.type);
        }
        updateHUD();
        break;
      }
      case 'round_end': {
        V.phase = 'round_end'; V.score = e.scores;
        const L = mode === 'spectate' ? 'A' : myTeam;
        for (const p of players.values()) p.celebrate = e.winner && p.team === e.winner && p.alive;
        if (!e.winner) UI.call('HÒA', 'Đấu lại hiệp này', '');
        else if (mode === 'spectate') UI.call(teamName(e.winner) + ' thắng hiệp', '', 'good');
        else if (e.winner === myTeam) UI.call(e.final ? 'CHIẾN THẮNG!' : 'THẮNG HIỆP!', V.bo === 3 ? `${e.scores[L]} – ${e.scores[other(L)]}` : '', 'good');
        else UI.call(e.final ? 'THUA RỒI' : 'THUA HIỆP', V.bo === 3 ? `${e.scores[L]} – ${e.scores[other(L)]}` : '', 'bad');
        if (bullets) bullets.clear();
        updateHUD();
        break;
      }
      case 'over': V.phase = 'over'; onOver(e); break;
      case 'paused': V.phase = 'paused'; UI.banner('Đang chờ người chơi kết nối lại…'); break;
    }
  }

  function onOver(e) {
    const spect = mode === 'spectate';
    const won = !spect && e.winner === myTeam;
    const L = spect ? 'A' : myTeam, R = other(L);
    let unlockText = '';
    if (!spect) { if (won) Save.data.wins++; else Save.data.losses++; Save.save(); }
    const cupRes = (mode === 'offline' && session && session.cfg.cup) ? Cup.record(won, e.scores) : null;
    if (cupRes && cupRes.text) unlockText = cupRes.text;
    if (won) for (const p of players.values()) p.celebrate = p.team === myTeam && p.alive;
    V.over = true;
    setTimeout(() => {
      if (!session) return;
      $('#over-title').textContent = spect ? 'Trận đấu kết thúc' : won ? 'CHIẾN THẮNG! 🏆' : 'THUA RỒI! 😿';
      $('#over-score').textContent = `${e.scores[L]} – ${e.scores[R]}`;
      $('#over-reason').textContent = e.reason === 'forfeit' ? (won ? 'Đối thủ đã rời trận.' : 'Bạn bị xử thua do rời trận.') : (spect ? teamName(e.winner) + ' thắng' : '');
      const ul = $('#over-unlock');
      ul.textContent = unlockText; ul.classList.toggle('hidden', !unlockText);
      const again = $('#btn-again');
      again.disabled = false;
      again.classList.toggle('hidden', spect);
      again.textContent = cupRes ? '🏆 Xem nhánh đấu' : 'Đấu lại';
      $('#btn-over-menu').textContent = mode === 'offline' ? 'Về menu' : spect ? 'Về sảnh' : 'Về phòng';
      UI.show('scr-over');
      if (!spect) (won ? A.win : A.lose)();
    }, e.reason === 'forfeit' ? 300 : 1500);
  }

  /* ================= Phiên chơi Offline ================= */
  class OfflineSession {
    constructor(cfg) {
      this.cfg = cfg; this.t = 0;
      const pool = PP.CHARACTERS.filter((c) => c.id !== Save.data.char).map((c) => c.id).sort(() => Math.random() - 0.5);
      const list = [{ id: 'me', team: 'A', char: Save.data.char, name: 'Bạn', isMe: true, look: myLook() }];
      if (cfg.teamSize === 2) {
        list.push({ id: 'mate', team: 'A', char: pool[0], name: 'Đồng đội', isBot: true, look: botLook() });
        list.push({ id: 'b1', team: 'B', char: pool[1], name: CHAR(pool[1]).name, isBot: true, look: botLook() });
        list.push({ id: 'b2', team: 'B', char: pool[2], name: CHAR(pool[2]).name, isBot: true, look: botLook() });
      } else if (cfg.opponent) list.push({ id: 'b1', team: 'B', char: cfg.opponent.char, name: cfg.opponent.name, isBot: true, look: botLook() });
      else list.push({ id: 'b1', team: 'B', char: pool[0], name: CHAR(pool[0]).name, isBot: true, look: botLook() });
      this.list = list;
      this.sim = new Shooter.Sim({ map: cfg.venue, teamSize: cfg.teamSize, bo: cfg.bo, seed: (Math.random() * 1e9) | 0, players: list.map((p) => ({ id: p.id, team: p.team })) });
      this.bots = list.filter((p) => p.isBot).map((p, i) => new PP.BotBrain(this.sim, p.id, p.team === 'A' ? 'pro' : cfg.level, Shooter.mulberry32(((Math.random() * 1e9) | 0) + i)));
    }
    now() { return this.t; }
    start() { this.sim.start(0); this.flush(); }
    update(dt) {
      this.t += dt;
      const sim = this.sim, t = this.t;
      if (me) sim.setPlayerState('me', { x: me.x, z: me.z, vx: me.vx, vz: me.vz, aim: me.aim, fire: ctl.fire, w: ctl.w }, false, t);
      for (const b of this.bots) b.tick(dt, t);
      sim.update(t);
      this.flush();
      for (const sp of sim.players) {
        const v = players.get(sp.id); if (!v) continue;
        v.hp = sp.hp; v.alive = sp.alive; v.am = sp.ammo; v.pw = sp.power;
        v.rl = sp.reloadUntil ? Math.max(0, sp.reloadUntil - sim.t) : 0; v.sn = Math.max(0, sp.nextSnipe - sim.t);
        v.sh = Math.max(0, sp.shieldUntil - sim.t); v.fr = Math.max(0, sp.freezeUntil - sim.t);
        if (!v.isMe) { v.x = sp.x; v.z = sp.z; v.vx = sp.vx; v.vz = sp.vz; v.aim = sp.aim; v.w = sp.weapon; }
      }
    }
    flush() { for (const e of this.sim.drain()) applyEvent(e); }
  }

  /* ================= Phiên chơi Online ================= */
  class OnlineSession {
    constructor(start) { this.matchId = start.matchId; this.inputT = 0; }
    now() { return net ? net.serverNow() : 0; }
    update(dt) {
      this.inputT += dt;
      if (me && this.inputT >= 1 / 30) {
        this.inputT = 0;
        const r = (v) => Math.round(v * 1000) / 1000;
        net.send({ t: 'input', x: r(me.x), z: r(me.z), vx: r(me.vx), vz: r(me.vz), aim: r(wrapA(me.aim)), fire: !!ctl.fire, w: ctl.w });
      }
      const rt = this.now() - 0.09;
      for (const p of players.values()) {
        if (p.isMe || p.buf.length === 0) continue;
        const buf = p.buf;
        let a = buf[0], b = buf[buf.length - 1];
        for (let i = 0; i < buf.length - 1; i++) if (buf[i].ts <= rt && buf[i + 1].ts >= rt) { a = buf[i]; b = buf[i + 1]; break; }
        if (rt >= b.ts) { const ex = Math.min(0.2, rt - b.ts); p.x = b.x + b.vx * ex; p.z = b.z + b.vz * ex; p.vx = b.vx; p.vz = b.vz; p.aim = b.aim; }
        else if (rt <= a.ts) { p.x = a.x; p.z = a.z; p.aim = a.aim; }
        else {
          const k = (rt - a.ts) / (b.ts - a.ts || 1);
          p.x = a.x + (b.x - a.x) * k; p.z = a.z + (b.z - a.z) * k; p.vx = b.vx; p.vz = b.vz; p.aim = a.aim + wrapA(b.aim - a.aim) * k;
        }
      }
    }
  }

  /* ================= Điều khiển người chơi ================= */
  function controlMe(dt) {
    const inp = PP.Input.poll();
    ctl.fire = false;
    if (!me) return;
    const canAct = me.alive && V.phase === 'fight' && me.fr <= 0;
    for (let i = 0; i < inp.swap; i++) ctl.w = ctl.w === 'rifle' ? 'sniper' : 'rifle';
    if (inp.pick) ctl.w = inp.pick;
    me.w = ctl.w;
    // ngắm: cần/mũi tên > chuột
    if (inp.aimScreen) { const d = world.dirFromScreen(inp.aimScreen.x, inp.aimScreen.y); if (Math.hypot(d.x, d.z) > 0.01) me.aim = Math.atan2(d.x, d.z); }
    else if (inp.aimMouse) { const g = world.groundAt(inp.aimMouse.px, inp.aimMouse.py); if (g && Math.hypot(g.x - me.x, g.z - me.z) > 0.25) me.aim = Math.atan2(g.x - me.x, g.z - me.z); }
    // đi
    if (canAct || (me.alive && V.phase === 'countdown' && false)) {
      const d = world.dirFromScreen(inp.mx, inp.my);
      Shooter.stepMove(world.map, me, d.x, d.z, dt, 1);
    } else { me.vx = me.vz = 0; }
    ctl.fire = !!(inp.fire && canAct);
    // tiếng "hết đạn"
    if (inp.fire && canAct && me.w === 'rifle' && me.am === 0 && performance.now() - (ctl.emptyT || 0) > 400) { ctl.emptyT = performance.now(); A.empty(); }
  }

  /** Vạch ngắm: súng bong bóng thấy cả quỹ đạo nảy, ná thấy tia thẳng */
  function updateAimLine() {
    let n = 0;
    if (S().aimline && me && me.alive && (V.phase === 'fight' || V.phase === 'countdown') && mode !== 'spectate') {
      const dx = Math.sin(me.aim), dz = Math.cos(me.aim);
      if (me.w === 'rifle') {
        const R = C.RIFLE, b = { x: me.x + dx * 0.6, z: me.z + dz * 0.6, vx: dx * R.speed, vz: dz * R.speed, r: R.r, bounces: 0, age: 0 };
        let acc = 0;
        for (let i = 0; i < 700 && n < aimDots.length; i++) {
          const ox = b.x, oz = b.z;
          const r = Shooter.stepBullet(world.map, b, 0.02);
          acc += Math.hypot(b.x - ox, b.z - oz);
          if (r === 'pop' || b.bounces >= 3) break;
          if (acc >= 0.6) {
            acc = 0; const m = aimDots[n++]; m.visible = true; m.position.x = b.x; m.position.z = b.z;
            m.material.color.setHex(0x2b2d42); m.scale.setScalar(1 - n / 60); m.material.opacity = 0.5 - n * 0.008;
          }
        }
      } else {
        const len = Math.min(C.SNIPER.range, Shooter.rayToBounds(world.map, me.x, me.z, dx, dz));
        for (let d = 0.8; d < len && n < aimDots.length; d += 0.75) {
          const m = aimDots[n++]; m.visible = true; m.position.x = me.x + dx * d; m.position.z = me.z + dz * d;
          m.material.color.setHex(0xff9f1c); m.scale.setScalar(0.9); m.material.opacity = 0.75;
        }
      }
    }
    for (let i = n; i < aimDots.length; i++) aimDots[i].visible = false;
  }

  /* ================= Hiển thị mỗi khung hình ================= */
  function updatePlayers(dt) {
    for (const p of players.values()) {
      // quay thân theo hướng ngắm (mượt); người mình quay tức thì
      p.yaw = p.isMe ? p.aim : p.yaw + wrapA(p.aim - p.yaw) * Math.min(1, dt * 16);
      p.holder.position.set(p.x, 0, p.z);
      p.holder.rotation.y = p.yaw;
      p.holder.updateMatrixWorld(true);
      const ct = Math.cos(p.yaw), st = Math.sin(p.yaw);
      const moving = p.alive && p.fr <= 0;
      const lvx = moving ? p.vx * ct - p.vz * st : 0, lvz = moving ? p.vx * st + p.vz * ct : 0;
      p.ch.update(dt, { x: 0, z: 0, vx: lvx, vz: lvz, mode: !p.alive ? 'sad' : (p.celebrate ? 'celebrate' : 'ready') });
      // súng bám theo tay phải
      p.ch.getHandWorld('R', _v); p.holder.worldToLocal(_v);
      p.kick = Math.max(0, p.kick - dt * 6);
      const g = p.w === 'sniper' ? p.guns.sniper : p.guns.rifle;
      p.guns.rifle.visible = p.alive && p.w !== 'sniper'; p.guns.sniper.visible = p.alive && p.w === 'sniper';
      g.position.set(_v.x, _v.y + 0.03, _v.z + 0.12 - p.kick * 0.06);
      g.rotation.set(-p.kick * 0.18, 0, 0);
      // hiệu ứng khiên / băng
      const t = world._t;
      p.shield.visible = p.sh > 0 && p.alive; if (p.shield.visible) { const k = 1 + Math.sin(t * 10) * 0.04; p.shield.scale.set(k, k, k); p.shield.material.opacity = p.sh < 0.5 ? 0.15 + 0.15 * Math.sin(t * 40) : 0.28; }
      p.ice.visible = p.fr > 0 && p.alive;
      // người bị hạ: thu nhỏ rồi ẩn
      if (!p.alive && p.deadT > 0) { p.deadT += dt; const k = Math.max(0, 1 - p.deadT / 0.9); p.holder.scale.setScalar(CS * (0.4 + 0.6 * k)); if (p.deadT > 0.9) p.holder.visible = false; }
      else p.holder.scale.setScalar(CS);
      // tên + thanh máu
      if (p.tag) {
        const pt = world.project(p.x, 1.55 * CS, p.z);
        p.tag.style.display = pt.vis && p.holder.visible ? '' : 'none';
        p.tag.style.left = pt.x + 'px'; p.tag.style.top = pt.y + 'px';
        p.tagBar.style.width = Math.max(0, p.hp) + '%';
        p.tagBar.style.background = p.hp <= 30 ? '#ff6b6b' : '#7cff6b';
      }
    }
  }

  function gameUpdate(dt) {
    controlMe(dt);
    session.update(dt);
    const t = now();
    // đếm ngược đầu hiệp
    if (V.phase === 'countdown') {
      const left = Math.ceil(V.cdEnd - t - 0.02);
      if (left >= 1 && left <= C.COUNTDOWN && left !== ctl.cdShown) { ctl.cdShown = left; UI.call(String(left), V.round > 1 || V.bo === 3 ? `Hiệp ${V.round}` : 'Sẵn sàng!', ''); A.beep(false); }
    }
    bullets.update(dt, t, {
      onBounce(b) { fx.burst(b.x, b.z, 0xcff4ff, 2, 1.2, 0.55, 0.05); if (Math.random() < 0.5) A.bubbleBounce(); },
      onPop(b) { fx.burst(b.x, b.z, 0xcff4ff, 4, 1.5, 0.55, 0.06); },
    });
  }

  function updateVisuals(dt) {
    if (!world) return;
    time += dt;
    world.update(dt, time);
    if (mode === 'menu') menuTick(dt);
    updatePlayers(dt);
    if (pickups) pickups.update(dt, time);
    if (fx) fx.update(dt);
    updateAimLine();
    // rung camera
    shake = Math.max(0, shake - dt * 3);
    const cam = world.camera;
    cam.position.copy(camBase);
    if (shake > 0) cam.position.add(_v.set((Math.random() - 0.5) * shake * 0.5, (Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.5));
    cam.lookAt(0, 0, 0);
    document.body.classList.toggle('frozen-fx', !!(me && me.fr > 0 && me.alive));
  }
  /** Nền menu: hai nhân vật đứng bắn bong bóng qua lại cho vui mắt */
  function menuTick(dt) {
    ctl.menuT -= dt;
    const a = players.get('m1'), b = players.get('m2'); if (!a || !b) return;
    a.aim = Math.PI / 2 + Math.sin(time * 0.7) * 0.25; b.aim = -Math.PI / 2 + Math.sin(time * 0.9) * 0.25;
    if (ctl.menuT <= 0) {
      ctl.menuT = 1.1 + Math.random();
      const s = Math.random() < 0.5 ? a : b;
      s.kick = 1;
      bullets.spawn({ id: 'm' + Math.random(), x: s.x + Math.sin(s.aim) * 0.6, z: s.z + Math.cos(s.aim) * 0.6, vx: Math.sin(s.aim) * 9, vz: Math.cos(s.aim) * 9, dmg: 10 }, s.team, 0);
    }
    bullets.update(dt, time, { onPop(bb) { fx.burst(bb.x, bb.z, 0xcff4ff, 4, 1.5, 0.55, 0.06); } });
  }

  let lastT = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const playing = !!session && !paused;
    PP.Input.setActive(playing && mode !== 'spectate' && !document.querySelector('.screen:not(.hidden)'));
    if (playing && world) gameUpdate(dt);
    else if (session && paused && world) { /* tạm dừng: đứng hình */ }
    if (!paused) updateVisuals(dt);
    if (session) updateHUD(true);
    if (renderer && world) renderer.render(world.scene, world.camera);
  }

  /* ================= HUD ================= */
  let hudCache = '';
  function sumHp(t) { let s = 0; for (const p of players.values()) if (p.team === t) s += Math.max(0, p.hp); return s; }
  function updateHUD(light) {
    const L = mode === 'spectate' ? 'A' : myTeam, R = other(L), max = C.HP * V.teamSize;
    const setHp = (side, team) => {
      const s = sumHp(team); const bar = $('#hud-' + side + '-hp');
      bar.style.width = (s / max * 100) + '%'; bar.parentElement.classList.toggle('low', s / max <= 0.3);
      $('#hud-' + side + '-hpt').textContent = s + (V.teamSize === 2 ? '/' + max : '');
    };
    setHp('l', L); setHp('r', R);
    if (light) { updateWeaponHud(); return; }
    $('#hud-l-score').textContent = V.score[L]; $('#hud-r-score').textContent = V.score[R];
    $('#hud-l-name').textContent = teamName(L); $('#hud-r-name').textContent = teamName(R);
    const first = (t) => (t === myTeam && me) ? me : [...players.values()].find((p) => p.team === t);
    const key = [V.bo, V.round, first(L) && first(L).char, first(R) && first(R).char].join('|');
    if (key !== hudCache) {
      hudCache = key;
      const setAva = (sel, p) => { const el = $(sel); el.textContent = ''; if (p) el.append(UI.avatarEl(p.char, 'em')); };
      setAva('#hud-l-ava', first(L)); setAva('#hud-r-ava', first(R));
    }
    $('#hud-target').textContent = V.bo === 3 ? 'Thắng 2/3 hiệp' : '1 hiệp';
    $('#hud-wind').textContent = 'Hiệp ' + Math.max(1, V.round);
  }
  function updateWeaponHud() {
    if (!me) { $('#wpn').classList.add('hidden'); $('#fxbar').textContent = ''; return; }
    $('#wpn').classList.remove('hidden');
    $('#w-rifle').classList.toggle('sel', me.w === 'rifle'); $('#w-sniper').classList.toggle('sel', me.w === 'sniper');
    const pips = $('#w-rifle-pips');
    const key = me.am + '/' + (me.rl > 0 ? 1 : 0);
    if (pips.dataset.k !== key) {
      pips.dataset.k = key; pips.textContent = '';
      for (let i = 0; i < C.RIFLE.mag; i++) { const u = document.createElement('u'); if (i >= me.am) u.className = 'off'; pips.append(u); }
    }
    $('#w-rifle-cd').style.width = me.rl > 0 ? (100 * (1 - me.rl / C.RIFLE.reload)) + '%' : '0';
    $('#w-sniper-cd').style.width = me.sn > 0 ? (100 * (1 - me.sn / C.SNIPER.delay)) + '%' : '0';
    const fxs = [];
    if (me.pw > 0) fxs.push('💪 +' + me.pw * C.POWER_BONUS + ' dmg');
    if (me.sh > 0) fxs.push('🛡️ ' + me.sh.toFixed(1) + 's');
    if (me.fr > 0) fxs.push('❄️ ' + me.fr.toFixed(1) + 's');
    const s = fxs.join('|');
    const bar = $('#fxbar');
    if (bar.dataset.k !== s || me.sh > 0 || me.fr > 0) { bar.dataset.k = s; bar.textContent = ''; for (const f of fxs) { const sp = document.createElement('span'); sp.textContent = f; bar.append(sp); } }
  }
  function showHUD(on) {
    $('#hud').classList.toggle('hidden', !on);
    const touch = on && PP.Input.isTouch() && mode !== 'spectate';
    $('#touch').classList.toggle('hidden', !touch);
    document.body.classList.toggle('touch', PP.Input.isTouch());
    if (!on) { $('#floaters').textContent = ''; document.body.classList.remove('frozen-fx', 'hit-flash'); }
    hudCache = '';
  }

  /* ================= Điều hướng ================= */
  function endSession() {
    session = null; me = null; paused = false;
    resetView();
    showHUD(false);
    UI.banner(null); UI.setMsg(''); UI.hideCall();
    if (net) net.watch = false;
  }
  function goMenu() {
    endSession();
    if (net) { net.send({ t: 'queue_leave' }); if (room) net.send({ t: 'room_leave' }); net.close(); net = null; room = null; }
    mode = 'menu';
    buildMenuScene();
    refreshMainStats();
    UI.show('scr-main');
  }
  function refreshMainStats() {
    const d = Save.data;
    const tr = d.trophies || {};
    const cups = CUP_TIERS.map((t) => (tr[t.id] ? t.icon + '×' + tr[t.id] : '')).filter(Boolean).join(' ');
    $('#main-stats').textContent = `Thắng ${d.wins} · Thua ${d.losses}` + (cups ? ' · Cúp ' + cups : '');
    $('#btn-sound').textContent = (!S().music && !S().sfx) ? '🔇 Âm thanh: Tắt' : '🔊 Âm thanh: Bật';
  }

  function startOffline(cupCfg) {
    endSession();
    const d = Save.data;
    const teamSize = cupCfg ? 1 : (+d.mode === 2 ? 2 : 1);
    const cfg = cupCfg || { teamSize, level: d.level, venue: d.venue, bo: +d.bo === 3 ? 3 : 1 };
    mode = 'offline';
    session = new OfflineSession(cfg);
    resetView({ teamSize, bo: cfg.bo, venue: cfg.venue });
    myTeam = 'A';
    buildScene(cfg.venue, session.list, true);
    me = players.get('me');
    UI.hideScreens();
    showHUD(true);
    $('#hud-ping').classList.add('hidden');
    session.start();
    updateHUD();
  }

  /* ================= Giải đấu (offline, loại trực tiếp 8 người) ================= */
  const CUP_TIERS = [
    { id: 'bronze', icon: '🥉', name: 'Cúp Đồng', desc: 'Khởi động nhẹ nhàng', levels: ['rookie', 'rookie', 'pro'] },
    { id: 'silver', icon: '🥈', name: 'Cúp Bạc',  desc: 'Đối thủ chắc tay hơn', levels: ['pro', 'pro', 'ace'] },
    { id: 'gold',   icon: '🥇', name: 'Cúp Vàng', desc: 'Chỉ dành cho cao thủ', levels: ['pro', 'ace', 'ace'] },
  ];
  const CUP_ROUNDS = ['Tứ kết', 'Bán kết', 'Chung kết'];
  const CUP_BO = [1, 1, 3];
  const Cup = {
    get data() { return Save.data.cup || null; },
    tier(id) { return CUP_TIERS.find((t) => t.id === id) || CUP_TIERS[0]; },
    create(tierId) {
      const pool = PP.CHARACTERS.filter((c) => c.id !== Save.data.char).sort(() => Math.random() - 0.5).slice(0, 7);
      const entrants = pool.map((c) => ({ char: c.id, name: c.name }));
      const meIdx = (Math.random() * 8) | 0;
      entrants.splice(meIdx, 0, { char: Save.data.char, name: Save.data.name || 'Bạn', me: true });
      const venues = PP.VENUES.map((v) => v.id).sort(() => Math.random() - 0.5).slice(0, 3);
      Save.data.cup = { tier: tierId, round: 0, status: 'playing', entrants, me: meIdx, venues,
        bracket: [entrants.map((_, i) => i)], scores: [[]] };
      Save.save();
    },
    /** cặp đấu của mình ở vòng hiện tại */
    pairing() {
      const c = this.data; const r = c.bracket[c.round];
      const i = r.indexOf(c.me); if (i < 0) return null;
      const j = i % 2 === 0 ? i + 1 : i - 1;
      return { slot: i >> 1, opp: r[j], meFirst: i % 2 === 0 };
    },
    simScore(bo) {
      const need = (bo + 1) / 2;
      return [need, (Math.random() * need) | 0];
    },
    /** xử lý các trận còn lại của vòng (bot đấu bot) và đẩy người thắng lên vòng sau */
    advance(myResult) {
      const c = this.data; const r = c.bracket[c.round]; const sc = c.scores[c.round] || (c.scores[c.round] = []);
      const next = [];
      for (let k = 0; k < r.length; k += 2) {
        let w, a, b;
        if (myResult && (r[k] === c.me || r[k + 1] === c.me)) {
          const meFirst = r[k] === c.me;
          w = myResult.won ? c.me : r[meFirst ? k + 1 : k];
          a = meFirst ? myResult.mine : myResult.theirs; b = meFirst ? myResult.theirs : myResult.mine;
        } else {
          const first = Math.random() < 0.5;
          w = r[first ? k : k + 1];
          const [x, y] = this.simScore(CUP_BO[c.round]);
          a = first ? x : y; b = first ? y : x;
        }
        sc[k >> 1] = a + '–' + b;
        next.push(w);
      }
      c.round++;
      c.bracket[c.round] = next;
      c.scores[c.round] = [];
    },
    record(won, score) {
      const c = this.data;
      if (!c || c.status !== 'playing') return null;
      const tier = this.tier(c.tier);
      const roundName = CUP_ROUNDS[c.round];
      this.advance({ won, mine: score.A, theirs: score.B });
      let text;
      if (!won) {
        c.status = 'out';
        while (c.round < 3) this.advance(null);   // đấu nốt để có nhà vô địch
        text = `Dừng bước ở ${roundName} – ${tier.name}`;
      } else if (c.round >= 3) {
        c.status = 'won';
        Save.data.trophies = Save.data.trophies || {};
        Save.data.trophies[tier.id] = (Save.data.trophies[tier.id] || 0) + 1;
        text = `${tier.icon} VÔ ĐỊCH ${tier.name.toUpperCase()}!`;
      } else text = `Vào ${CUP_ROUNDS[c.round]} – ${tier.name}`;
      Save.save();
      return { text };
    },
    abandon() {
      const c = this.data;
      if (c && c.status === 'playing' && !window.confirm('Bỏ giải đấu đang dở? Tiến trình sẽ mất.')) return;
      Save.data.cup = null; Save.save();
      this.open();
    },
    play() {
      const c = this.data;
      if (!c || c.status !== 'playing') return;
      const pr = this.pairing(); if (!pr) return;
      const opp = c.entrants[pr.opp];
      startOffline({ teamSize: 1, cup: true, level: this.tier(c.tier).levels[c.round], venue: c.venues[c.round],
        bo: CUP_BO[c.round], opponent: { char: opp.char, name: opp.name } });
      UI.toast(`${CUP_ROUNDS[c.round]} · ${this.tier(c.tier).name}: Bạn vs ${opp.name}`, 3000);
    },
    open() {
      const c = this.data;
      UI.show('scr-cup');
      const tiers = $('#cup-tiers'), view = $('#cup-view');
      const tr = Save.data.trophies || {};
      $('#cup-cabinet').textContent = CUP_TIERS.map((t) => `${t.icon} ${tr[t.id] || 0}`).join('   ');
      if (!c) {
        tiers.classList.remove('hidden'); view.classList.add('hidden');
        tiers.textContent = '';
        for (const t of CUP_TIERS) {
          const b = document.createElement('button');
          b.className = 'cup-tier';
          const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = t.icon;
          const tx = document.createElement('span');
          const n = document.createElement('b'); n.textContent = t.name;
          const d = document.createElement('small');
          d.textContent = t.desc + ' · ' + t.levels.map((l) => PP.LEVELS[l].name).join(' → ');
          tx.append(n, d); b.append(ic, tx);
          b.onclick = () => { A.click(); this.create(t.id); this.open(); };
          tiers.append(b);
        }
        $('#cup-title').textContent = 'Giải đấu';
        $('#cup-status').textContent = '8 tay súng · loại trực tiếp · Tứ kết & Bán kết 1 hiệp, Chung kết thắng 2/3 hiệp. Chọn một giải để bắt đầu:';
        $('#cup-play').classList.add('hidden'); $('#cup-quit').classList.add('hidden');
        return;
      }
      tiers.classList.add('hidden'); view.classList.remove('hidden');
      const tier = this.tier(c.tier);
      $('#cup-title').textContent = `${tier.icon} ${tier.name}`;
      this.renderBracket();
      const play = $('#cup-play'), quit = $('#cup-quit');
      quit.classList.remove('hidden');
      if (c.status === 'playing') {
        const pr = this.pairing(), opp = c.entrants[pr.opp];
        const lv = PP.LEVELS[tier.levels[c.round]].name;
        $('#cup-status').textContent = `${CUP_ROUNDS[c.round]}: Bạn vs ${opp.name} (${lv}) · ${VENUE(c.venues[c.round]).name} · ${CUP_BO[c.round] === 3 ? 'Thắng 2/3 hiệp' : '1 hiệp'}`;
        play.classList.remove('hidden'); play.textContent = '▶ Thi đấu ' + CUP_ROUNDS[c.round];
        quit.textContent = 'Bỏ giải';
      } else {
        const champ = c.entrants[c.bracket[3][0]];
        $('#cup-status').textContent = c.status === 'won' ? `🏆 Bạn là nhà vô địch ${tier.name}!` : `Nhà vô địch: ${champ.name}. Thử lại nhé!`;
        play.classList.add('hidden');
        quit.textContent = '＋ Giải mới';
      }
    },
    renderBracket() {
      const c = this.data, el = $('#cup-bracket');
      el.textContent = '';
      const titles = CUP_ROUNDS.concat(['Vô địch']);
      for (let r = 0; r < 4; r++) {
        const col = document.createElement('div'); col.className = 'cup-col';
        const h = document.createElement('h4'); h.textContent = titles[r]; col.append(h);
        const ids = c.bracket[r];
        const n = 8 >> r;
        for (let k = 0; k < n; k += r === 3 ? 1 : 2) {
          const box = document.createElement('div'); box.className = 'cup-match';
          for (let q = 0; q < (r === 3 ? 1 : 2); q++) {
            const idx = ids ? ids[k + q] : undefined;
            const row = document.createElement('div'); row.className = 'cup-p';
            if (idx === undefined) { row.classList.add('tbd'); row.textContent = '…'; }
            else {
              const e = c.entrants[idx];
              row.append(UI.avatarEl(e.char, 'em'));
              const nm = document.createElement('span'); nm.textContent = e.me && e.name !== 'Bạn' ? e.name + ' (Bạn)' : e.name; row.append(nm);
              if (e.me) row.classList.add('me');
              const nextIds = c.bracket[r + 1];
              if (r < 3 && nextIds && !nextIds.includes(idx)) row.classList.add('lost');
              if (r === 3) row.classList.add('champ');
            }
            box.append(row);
          }
          const sc = r < 3 && c.scores[r] && c.scores[r][k >> 1];
          if (sc) { const s2 = document.createElement('div'); s2.className = 'cup-sc'; s2.textContent = sc; box.append(s2); }
          col.append(box);
        }
        el.append(col);
      }
    },
  };

  function togglePause() {
    if (!session) return;
    if (UI.visible('scr-over') || UI.visible('scr-settings')) return;
    if (UI.visible('scr-pause')) { resume(); return; }
    if (mode === 'offline') paused = true;
    $('#pause-online-note').classList.toggle('hidden', mode === 'offline');
    const code = mode === 'spectate' ? watchCode : (room && room.code);
    $('#pause-online-note').textContent = 'Trận online vẫn đang diễn ra!' + (code ? ` Mã phòng: ${code} – bạn bè nhập mã này để xem.` : '');
    const cup = mode === 'offline' && session.cfg.cup;
    $('#btn-restart').classList.toggle('hidden', mode !== 'offline' || cup);
    $('#btn-quit').textContent = cup ? 'Bỏ trận (bị xử thua)' : mode === 'offline' ? 'Về menu' : mode === 'spectate' ? 'Thôi xem' : 'Rời trận (bị xử thua)';
    UI.show('scr-pause');
  }
  function resume() {
    UI.hideScreens();
    paused = false;
    clock.getDelta();
  }

  /* ================= Âm thanh: nhạc nền và hiệu ứng tắt/mở riêng ================= */
  function applyAudioSettings() {
    const st = S();
    A.setMuted(!st.sfx);
    A.setVolume(st.volume / 100);
    A.setMusicVolume(st.musicVol / 100);
    A.setMusicOn(!!st.music);
  }

  /* ================= Tủ đồ VIP: thay kit bằng ảnh của người chơi ================= */
  let vipPreview = null, vipChar = 'bunny', vipScope = 'char', vipSlot = 'shirt';
  const VIP_SLOT_TEXT = {
    shirt:  { tee: ['👕 Áo', 'Ảnh áo: giữa ảnh là mặt trước, hai mép ảnh là mặt sau'] },
    shorts: { tee: ['🩳 Quần', 'Ảnh quần, quấn quanh hông'] },
    paddle: { tee: ['🏓 Vợt', 'Ảnh dán lên mặt vợt'] },
  };
  const VIP_STYLE_TEXT = {
    dress: { shirt: ['👗 Thân váy (phần áo)', 'Ảnh phần thân váy: giữa ảnh là mặt trước'], shorts: ['👗 Chân váy xòe', 'Ảnh chân váy, quấn quanh eo'] },
    suit:  { shirt: ['🤵 Vest (áo khoác)', 'Ảnh áo vest: giữa ảnh là mặt trước'], shorts: ['👖 Quần tây', 'Ảnh quần tây, quấn quanh hông'] },
  };
  const VIP_LABELS = {
    dress: { shirt: { top: 'CỔ / NGỰC VÁY', bottom: 'EO VÁY' }, shorts: { top: 'EO VÁY', bottom: 'GẤU VÁY' } },
    suit:  { shirt: { top: 'CỔ VEST', bottom: 'GẤU VEST' }, shorts: { top: 'LƯNG QUẦN', bottom: 'GẤU QUẦN' } },
  };
  function vipStyle() { return (fullLook(vipChar) || {}).shirtStyle; }
  function vipSlots() {
    return ['shirt', 'shorts', 'paddle'].map((slot) => {
      const o = (VIP_STYLE_TEXT[vipStyle()] || {})[slot] || VIP_SLOT_TEXT[slot].tee;
      return [slot, o[0], o[1]];
    });
  }
  function vipLabels(slot) { return (VIP_LABELS[vipStyle()] || {})[slot] || null; }
  const vipScopeId = () => (vipScope === 'all' ? 'all' : vipChar);
  function openVip() {
    closeSetupPreview();
    vipChar = Save.data.char;
    UI.show('scr-vip');
    if (!vipPreview && PP.Character.createPreview) {
      try { vipPreview = PP.Character.createPreview($('#vip-canvas')); } catch (e) { vipPreview = null; }
    }
    vipRender();
  }
  function vipRender() {
    UI.charGrid($('#vip-chars'), vipChar, Save.data.wins, (id) => { vipChar = id; Save.data.char = id; Save.save(); vipRender(); });
    UI.$$('#vip-scope button').forEach((b) => b.classList.toggle('sel', b.dataset.v === vipScope));
    const box = $('#vip-slots'); box.textContent = '';
    const scope = vipScopeId();
    for (const [slot, title, hint] of vipSlots()) {
      const mine = PP.Kit.own(scope, slot);
      const eff = PP.Kit.get(vipChar, slot);
      const card = document.createElement('div'); card.className = 'vip-slot';
      let th;
      if (eff) { th = document.createElement('canvas'); th.width = th.height = 88; const g = th.getContext('2d'); const k = eff.canvas, sc = Math.min(88 / k.width, 88 / k.height); g.drawImage(k, (88 - k.width * sc) / 2, (88 - k.height * sc) / 2, k.width * sc, k.height * sc); th.className = 'vip-thumb'; }
      else { th = document.createElement('div'); th.className = 'vip-thumb'; th.textContent = '➕'; }
      th.onclick = () => vipPick(slot);
      const info = document.createElement('div');
      const h4 = document.createElement('h4'); h4.textContent = title;
      const spec = document.createElement('div'); spec.className = 'vip-spec'; spec.textContent = PP.Kit.specLine(slot);
      const st = document.createElement('div'); st.className = 'vip-status';
      st.textContent = mine ? (scope === 'all' ? 'Đang dùng kit chung cho mọi nhân vật' : 'Đang dùng kit riêng của nhân vật này')
        : (eff ? 'Đang dùng kit chung (từ mục "Tất cả")' : hint);
      const row = document.createElement('div'); row.className = 'vip-actions';
      const bPick = document.createElement('button'); bPick.className = 'btn tiny primary'; bPick.textContent = '📁 Chọn ảnh'; bPick.onclick = () => vipPick(slot);
      const bDel = document.createElement('button'); bDel.className = 'btn tiny ghost'; bDel.textContent = 'Xóa'; bDel.onclick = () => { A.click(); PP.Kit.clear(scope, slot); vipRender(); };
      const bTpl = document.createElement('button'); bTpl.className = 'btn tiny ghost'; bTpl.textContent = '⬇ Ảnh mẫu'; bTpl.onclick = () => vipTemplate(slot);
      const bEdit = document.createElement('button'); bEdit.className = 'btn tiny'; bEdit.textContent = '✂ Chỉnh lại';
      bEdit.onclick = () => vipReedit(slot);
      if (eff) row.append(bPick, bEdit, bDel, bTpl); else row.append(bPick, bTpl);
      info.append(h4, st, spec, row);
      card.append(th, info);
      box.append(card);
    }
    vipRefresh();
  }
  function vipRefresh() {
    $('#vip-name').textContent = CHAR(vipChar).name;
    if (vipPreview) vipPreview.set(CHAR(vipChar), fullLook(vipChar));
  }
  /** Mở trình chỉnh ảnh (kéo + phóng to/thu nhỏ) rồi lưu kit */
  function vipEditAndSave(src, slot, scope) {
    const title = (vipSlots().find((x) => x[0] === slot) || [slot, slot])[1].replace(/\s*\(.*\)$/, '');
    PP.Kit.edit(src, slot, { title, labels: vipLabels(slot) })
      .then((cv) => (cv ? PP.Kit.addCanvas(cv, scope, slot).then(() => { UI.toast('Đã thay kit!'); vipRender(); }) : null))
      .catch((e) => UI.toast(e && e.message ? e.message : 'Không thêm được ảnh'));
  }
  function vipReedit(slot) {
    A.click();
    const e = PP.Kit.get(vipChar, slot); if (!e) return;
    vipEditAndSave(e.canvas, slot, vipScopeId());
  }
  function vipPick(slot) { A.click(); vipSlot = slot; const f = $('#vip-file'); f.value = ''; f.click(); }
  function vipTemplate(slot) {
    A.click();
    try {
      const cv = PP.Kit.template(slot, vipLabels(slot));
      cv.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'kit-mau-' + slot + '-' + PP.Kit.SPECS[slot].rec[0] + 'x' + PP.Kit.SPECS[slot].rec[1] + '.png';
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    } catch (e) { UI.toast('Không tạo được ảnh mẫu'); }
  }
  function closeVip() {
    A.click();
    if (vipPreview) { try { vipPreview.dispose(); } catch (e) { /* bỏ qua */ } vipPreview = null; }
    refreshPortrait(vipChar);
    if (mode === 'menu') buildMenuScene();
    refreshMainStats(); UI.show('scr-main');
  }

  /* ================= Cài đặt ================= */
  let settingsBack = 'scr-main';
  function openSettings() {
    settingsBack = UI.visible('scr-pause') ? 'scr-pause' : 'scr-main';
    const st = S();
    UI.seg($('#set-quality'), st.quality, (v) => {
      st.quality = v; Save.save();
      Arena.applyQuality(renderer, quality());
      UI.toast('Đã chuyển đồ họa: ' + ({ low: 'Thấp', medium: 'Vừa', high: 'Cao' })[quality()]);
    });
    $('#set-music').checked = !!st.music;
    $('#set-music').onchange = () => { st.music = $('#set-music').checked; applyAudioSettings(); Save.save(); refreshMainStats(); };
    $('#set-sfx').checked = !!st.sfx;
    $('#set-sfx').onchange = () => { st.sfx = $('#set-sfx').checked; applyAudioSettings(); Save.save(); refreshMainStats(); if (st.sfx) A.click(); };
    $('#set-musicvol').value = st.musicVol;
    $('#set-musicvol').oninput = () => { st.musicVol = +$('#set-musicvol').value; applyAudioSettings(); Save.save(); };
    $('#set-volume').value = st.volume;
    $('#set-volume').oninput = () => { st.volume = +$('#set-volume').value; A.setVolume && A.setVolume(st.volume / 100); Save.save(); };
    const bindCheck = (id, key) => { const el = $(id); el.checked = !!st[key]; el.onchange = () => { st[key] = el.checked; Save.save(); }; };
    bindCheck('#set-aimline', 'aimline'); bindCheck('#set-shake', 'shake');
    UI.show('scr-settings');
  }
  function closeSettings() {
    A.click();
    if (settingsBack === 'scr-pause' && session) UI.show('scr-pause');
    else if (session) resume();
    else UI.show('scr-main');
  }

  /* ================= Ảnh chân dung ================= */
  function loadPortraits() {
    if (!PP.Character.portraits || softwareGL) return;   // máy không GPU: dùng emoji, tránh vài giây đứng hình
    PP.Character.portraits(PP.CHARACTERS, 128, Save.data.looks).then((map) => {
      PP.Portraits = map;
      if (UI.visible('scr-setup')) openSetup();
      if (UI.visible('scr-profile')) openProfile();
      if (session) updateHUD();
    }).catch(() => { /* giữ emoji */ });
  }
  function refreshPortrait(id) {
    if (!PP.Character.portraits) return;
    PP.Character.portraits([CHAR(id)], 128, { [id]: myLook(id) }).then((m) => {
      PP.Portraits = PP.Portraits || new Map();
      const u = m.get(id); if (u) PP.Portraits.set(id, u);
      if (UI.visible('scr-setup')) openSetup();
      if (UI.visible('scr-profile')) openProfile();
    }).catch(() => {});
  }

  /* ================= Tủ đồ ================= */
  let wdPreview = null, wdChar = 'bunny', wdBack = 'scr-main';
  const COLOR_KEYS = [['shirt', 'Áo'], ['shorts', 'Quần'], ['accent', 'Viền'], ['shoes', 'Giày'], ['paddle', 'Súng / vợt']];
  const FALLBACK_PALETTE = ['#ffffff', '#2b2d42', '#ff6f91', '#ff9f1c', '#ffd23f', '#9ad06a', '#2ec4b6', '#4cc9f0', '#3f8cff', '#5468d9', '#9b5de5', '#e63946', '#8d5a3c', '#ffb3c7', '#b5e48c', '#a0c4ff'];
  const hex = (v) => (typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : String(v || '#ffffff')).toLowerCase();
  function setLook(patch) {
    Save.data.looks[wdChar] = Object.assign({}, Save.data.looks[wdChar] || {}, patch);
    Save.save();
    wdRefresh();
  }
  function openWardrobe() {
    closeSetupPreview();
    const vis = ['scr-setup', 'scr-profile', 'scr-main'].find((id) => UI.visible(id));
    wdBack = vis || 'scr-main';
    wdChar = Save.data.char;
    UI.show('scr-wardrobe');
    if (!wdPreview && PP.Character.createPreview) {
      try { wdPreview = PP.Character.createPreview($('#wardrobe-canvas')); } catch (e) { wdPreview = null; }
    }
    wdRender();
  }
  // khi chọn Váy / Vest: gợi ý bảng màu đẹp ngay (người chơi vẫn đổi màu tự do sau đó)
  const STYLE_PRESET = {
    dress: { shirt: '#ff8fc7', shorts: '#ffc2e2', accent: '#ffd23f' },
    suit:  { shirt: '#2b2d42', shorts: '#2b2d42', accent: '#e63946' },
  };
  const COLOR_LABELS = {
    dress: { shirt: 'Thân váy', shorts: 'Chân váy', accent: 'Nơ & viền' },
    suit:  { shirt: 'Vest', shorts: 'Quần tây', accent: 'Cà vạt' },
  };
  function wdSeg(el, items, key) {
    el.textContent = '';
    for (const it of items) { const b = document.createElement('button'); b.dataset.v = it.id; b.textContent = it.name; el.append(b); }
    return UI.seg(el, fullLook(wdChar)[key], (v) => setLook(key === 'shirtStyle' ? Object.assign({ [key]: v }, STYLE_PRESET[v] || {}) : { [key]: v }));
  }
  function wdRender() {
    const O = PP.Character.OPTIONS || {};
    UI.charGrid($('#wd-chars'), wdChar, Save.data.wins, (id) => { wdChar = id; Save.data.char = id; Save.save(); wdRender(); });
    const box = $('#wd-colors'); box.textContent = '';
    const h = document.createElement('h3'); h.textContent = 'Màu sắc'; box.append(h);
    const palette = (O.palette && O.palette.length ? O.palette : FALLBACK_PALETTE).map(hex);
    for (const [key, label] of COLOR_KEYS) {
      const row = document.createElement('div'); row.className = 'color-row'; row.dataset.key = key;
      const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label; row.append(l);
      for (const c of palette) {
        const b = document.createElement('button'); b.className = 'sw-btn'; b.style.background = c; b.dataset.c = c; b.title = c;
        b.onclick = () => { A.click(); setLook({ [key]: c }); };
        row.append(b);
      }
      const inp = document.createElement('input'); inp.type = 'color'; inp.title = 'Màu tự chọn';
      inp.oninput = () => setLook({ [key]: inp.value.toLowerCase() });
      row.append(inp);
      box.append(row);
    }
    wdSeg($('#wd-shirtstyle'), O.shirtStyles || [{ id: 'tee', name: 'Áo thun' }], 'shirtStyle');
    wdSeg($('#wd-pattern'), O.patterns || [{ id: 'solid', name: 'Trơn' }], 'pattern');
    const acc = $('#wd-acc'); acc.textContent = '';
    for (const a of (O.accessories || [])) {
      const locked = (a.unlock || 0) > Save.data.wins;
      const b = document.createElement('button'); b.dataset.v = a.id;
      b.textContent = (locked ? '🔒 ' : '') + a.name;
      if (locked) { b.classList.add('locked'); b.title = 'Thắng ' + a.unlock + ' trận để mở'; }
      b.onclick = () => { if (locked) { UI.toast('Thắng ' + a.unlock + ' trận để mở khóa ' + a.name); return; } A.click(); setLook({ accessory: a.id }); };
      acc.append(b);
    }
    $('#wd-number').onchange = () => { const n = Math.max(0, Math.min(99, Math.round(+$('#wd-number').value || 0))); setLook({ number: n }); };
    wdRefresh();
  }
  function wdRefresh() {
    const look = fullLook(wdChar);
    $('#wd-name').textContent = CHAR(wdChar).name;
    UI.$$('#wd-colors .color-row').forEach((row) => {
      const lbl = row.querySelector('.lbl');
      if (lbl) lbl.textContent = ((COLOR_LABELS[look.shirtStyle] || {})[row.dataset.key]) || (COLOR_KEYS.find((c) => c[0] === row.dataset.key) || [0, ''])[1];
      const cur = hex(look[row.dataset.key]);
      row.querySelectorAll('.sw-btn').forEach((b) => b.classList.toggle('sel', b.dataset.c === cur));
      row.querySelector('input').value = /^#[0-9a-f]{6}$/.test(cur) ? cur : '#ffffff';
    });
    UI.$$('#wd-acc button').forEach((b) => b.classList.toggle('sel', b.dataset.v === (look.accessory || 'default')));
    UI.$$('#wd-shirtstyle button').forEach((b) => b.classList.toggle('sel', b.dataset.v === look.shirtStyle));
    UI.$$('#wd-pattern button').forEach((b) => b.classList.toggle('sel', b.dataset.v === look.pattern));
    $('#wd-number').value = look.number != null ? look.number : 0;
    if (wdPreview) wdPreview.set(CHAR(wdChar), look);
  }
  function wdRandom() {
    const O = PP.Character.OPTIONS || {};
    const palette = (O.palette && O.palette.length ? O.palette : FALLBACK_PALETTE).map(hex);
    const look = {};
    for (const [key] of COLOR_KEYS) look[key] = pickOne(palette);
    if (O.patterns) look.pattern = pickOne(O.patterns).id;
    if (O.shirtStyles) look.shirtStyle = pickOne(O.shirtStyles).id;
    if (O.accessories) look.accessory = pickOne(O.accessories.filter((a) => (a.unlock || 0) <= Save.data.wins)).id;
    look.number = (Math.random() * 100) | 0;
    Save.data.looks[wdChar] = look; Save.save();
    wdRender();
  }
  function closeWardrobe() {
    A.click();
    if (wdPreview) { try { wdPreview.dispose(); } catch (e) { /* bỏ qua */ } wdPreview = null; }
    refreshPortrait(wdChar);
    if (net) net.send({ t: 'set_profile', name: Save.data.name || 'Người chơi', char: Save.data.char, look: myLook() });
    if (mode === 'menu') buildMenuScene();
    if (wdBack === 'scr-setup') openSetup();
    else if (wdBack === 'scr-profile') openProfile();
    else { refreshMainStats(); UI.show('scr-main'); }
  }

  /* ================= Online: sảnh, phòng ================= */
  let net = null, room = null, pendingRoom = null, queueStart = 0, queueTimer = 0, watchCode = '', lastPing = 0;
  /** Pill trên HUD: mã phòng (để bạn bè nhập mã xem trận) + ping */
  function hudPing() {
    const ms = lastPing, cls = !ms ? '' : ms < 90 ? 'good' : ms < 200 ? 'mid' : 'bad';
    const code = mode === 'spectate' ? watchCode : (room && room.code);
    const parts = [];
    if (code) parts.push('Phòng ' + code);
    if (ms) parts.push(ms + ' ms' + (ms > 400 ? ' · Mạng chậm' : ''));
    const hp = $('#hud-ping'); hp.textContent = parts.join(' · '); hp.className = 'pill small ' + cls;
    if ((mode !== 'online' && mode !== 'spectate') || !parts.length) hp.classList.add('hidden');
  }

  function ensureNet() {
    if (net) return net;
    net = new PP.NetClient({
      onOpen() { net.send({ t: 'hello', deviceId: Save.data.deviceId, name: Save.data.name, char: Save.data.char, look: myLook(), version: Protocol.PROTOCOL_VERSION }); },
      onMessage: onNet,
      onStatus(s) {
        const pill = $('#online-ping');
        if (s !== 'open') { pill.textContent = s === 'reconnecting' ? '● đang kết nối lại…' : '● đang kết nối…'; pill.className = 'pill bad'; }
        if (mode === 'online' || mode === 'spectate') UI.banner(s === 'open' ? null : 'Mất kết nối, đang kết nối lại…');
      },
      onPing(ms) {
        const cls = ms < 90 ? 'good' : ms < 200 ? 'mid' : 'bad';
        const pill = $('#online-ping'); pill.textContent = '● ' + ms + ' ms'; pill.className = 'pill ' + cls;
        lastPing = ms;
        hudPing();
      },
    });
    net.connect();
    return net;
  }

  function goOnline() {
    if (IS_FILE) { UI.toast('Hãy mở game qua server (http/https) để chơi online. Chế độ chơi với bot vẫn dùng được.', 4000); return; }
    if (!Save.data.name) { openProfile(); return; }
    ensureNet();
    $('#online-me').textContent = `${CHAR(Save.data.char).emoji} ${Save.data.name}`;
    UI.show('scr-online');
    net.send({ t: 'leaderboard' });
  }
  function openProfile() {
    $('#profile-name').value = Save.data.name || '';
    UI.charGrid($('#profile-chars'), Save.data.char, Save.data.wins, (id) => { Save.data.char = id; });
    UI.show('scr-profile');
    setTimeout(() => $('#profile-name').focus(), 50);
  }

  function onNet(m) {
    switch (m.t) {
      case 'welcome':
        myPid = m.playerId;
        if (UI.visible('scr-queue')) { stopQueueTimer(); UI.show('scr-online'); UI.toast('Mất kết nối khi đang tìm trận, hãy tìm lại nhé'); }
        if (pendingRoom) { net.send({ t: 'room_join', code: pendingRoom }); pendingRoom = null; }
        net.send({ t: 'leaderboard' });
        break;
      case 'error':
        UI.toast(m.message || 'Có lỗi xảy ra');
        if (m.code === 'version') UI.banner('Game đã có bản mới. Vui lòng tải lại trang.');
        if (m.code === 'room_not_found' || m.code === 'room_full') { if (!session) UI.show('scr-online'); }
        break;
      case 'queue_status':
        if (m.waiting === false) { stopQueueTimer(); if (!session && !room) UI.show('scr-online'); break; }
        $('#queue-title').textContent = 'Đang tìm trận ' + m.mode + '…';
        $('#queue-info').textContent = 'Đang có ' + (m.count || 1) + ' người chờ';
        if (!UI.visible('scr-queue')) { queueStart = performance.now(); startQueueTimer(); UI.show('scr-queue'); }
        break;
      case 'room_state':
        room = m;
        if (session) hudPing();
        stopQueueTimer();
        renderRoom();
        if (!session) UI.show('scr-room');
        break;
      case 'room_left':
        room = null;
        if (!session) UI.show('scr-online');
        break;
      case 'chat': addChat(m.name, m.text, m.sys); break;
      case 'match_start': startOnlineMatch(m); break;
      case 'sync': if (session) applySync(m.snapshot); break;
      case 'round_start': case 'fight': case 'shoot': case 'snipe': case 'hit': case 'dead': case 'bpop':
      case 'pickup_spawn': case 'pickup_take': case 'pickup_expire': case 'round_end': case 'over': case 'paused':
        if (session && session.matchId === m.matchId) applyEvent(m);
        break;
      case 'state': {
        if (!session || session.matchId !== m.matchId) break;
        for (const s of m.players) {
          const p = players.get(s.id); if (!p) continue;
          p.hp = s.hp; p.alive = s.al; p.am = s.am; p.rl = s.rl; p.sn = s.sn; p.sh = s.sh; p.fr = s.fr; p.pw = s.pw;
          if (p.isMe) { if (Math.hypot(s.x - p.x, s.z - p.z) > 2.2) { p.x = s.x; p.z = s.z; } }   // server kéo lại khi lệch quá xa
          else { p.w = s.w; p.buf.push({ ts: m.ts, x: s.x, z: s.z, vx: s.vx, vz: s.vz, aim: s.aim }); if (p.buf.length > 24) p.buf.shift(); }
        }
        break;
      }
      case 'player_status': {
        const p = players.get(m.id);
        if (!session) break;
        if (m.connected) UI.banner(null);
        else UI.banner(`${p ? p.name : 'Người chơi'} mất kết nối. Chờ tối đa ${m.graceSec}s…`);
        break;
      }
      case 'player_replaced': {
        const p = players.get(m.id);
        if (p) { p.isBot = true; p.name = m.name; }
        UI.banner(null);
        UI.toast(m.name + ' thay thế người chơi đã rời trận');
        updateHUD();
        break;
      }
      case 'leaderboard': renderLeaderboard(m.top); break;
      case 'server_restart': UI.toast('Server đang cập nhật, đang kết nối lại…', 5000); break;
    }
  }

  function startQueueTimer() {
    stopQueueTimer();
    queueTimer = setInterval(() => {
      const s = Math.floor((performance.now() - queueStart) / 1000);
      $('#queue-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 250);
  }
  function stopQueueTimer() { clearInterval(queueTimer); queueTimer = 0; }

  function renderRoom() {
    if (!room) return;
    const isHost = room.hostId === myPid;
    $('#room-code').textContent = room.code;
    $('#room-mode').textContent = room.mode + (room.quick ? ' · ghép nhanh' : '');
    const size = room.mode === '2v2' ? 2 : 1;
    for (const t of ['A', 'B']) {
      const ul = $('#room-team-' + t); ul.textContent = '';
      const ps = room.players.filter((p) => p.team === t);
      for (const p of ps) {
        const li = document.createElement('li');
        li.className = p.ready || p.id === room.hostId ? 'ready' : '';
        const em = UI.avatarEl(p.char, 'em');
        const nm = document.createElement('span'); nm.textContent = p.name + (p.id === myPid ? ' (bạn)' : '');
        const st = document.createElement('span'); st.className = 'st';
        st.textContent = !p.connected ? 'mất kết nối' : p.id === room.hostId ? '👑 chủ phòng' : p.ready ? '✓ sẵn sàng' : 'chưa sẵn sàng';
        li.append(em, nm, st);
        ul.append(li);
      }
      for (let i = ps.length; i < size; i++) {
        const li = document.createElement('li');
        li.textContent = room.mode === '2v2' && room.fillBots ? '🤖 Bot (' + PP.LEVELS[room.botLevel].name + ')' : '… chờ người chơi';
        li.style.opacity = 0.6;
        ul.append(li);
      }
    }
    UI.$$('[data-team]').forEach((b) => b.classList.toggle('hidden', room.mode !== '2v2' || room.quick));
    const venueSel = $('#room-venue');
    if (!venueSel.options.length) for (const v of PP.VENUES) { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; venueSel.append(o); }
    venueSel.value = room.settings.venue;
    $('#room-bo').value = String(room.settings.bo);
    $('#room-fill').checked = !!room.fillBots;
    $('#room-botlevel').value = room.botLevel || 'pro';
    for (const id of ['#room-venue', '#room-bo', '#room-fill', '#room-botlevel']) $(id).disabled = !isHost || room.quick;
    $('#room-fill-wrap').classList.toggle('hidden', room.mode !== '2v2');
    $('#room-host-note').textContent = room.quick ? '(ghép nhanh)' : isHost ? '(bạn là chủ phòng)' : '(chủ phòng chỉnh)';
    const meP = room.players.find((p) => p.id === myPid);
    const rb = $('#btn-ready');
    rb.classList.toggle('hidden', isHost || room.quick);
    rb.textContent = meP && meP.ready ? '✓ Đã sẵn sàng' : 'Sẵn sàng';
    rb.classList.toggle('on', !!(meP && meP.ready));
    $('#btn-room-start').classList.toggle('hidden', !isHost || room.quick);
    $('#btn-room-start').disabled = !!room.inMatch;
  }

  function addChat(name, text, sys) {
    const log = $('#chat-log');
    const p = document.createElement('p');
    if (sys) { p.className = 'sys'; p.textContent = text; }
    else { const b = document.createElement('b'); b.textContent = name + ': '; p.append(b, document.createTextNode(text)); }
    log.append(p);
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function renderLeaderboard(top) {
    const ol = $('#lb-list'); ol.textContent = '';
    if (!top || !top.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Chưa có ai. Hãy là người đầu tiên!'; ol.append(li); return; }
    for (const r of top) {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.textContent = r.name;
      const w = document.createElement('span'); w.textContent = r.wins + ' thắng · ' + r.losses + ' thua';
      w.className = 'muted';
      li.append(n, w);
      ol.append(li);
    }
  }

  function startOnlineMatch(m) {
    endSession();
    const spect = !m.yourTeam;
    mode = spect ? 'spectate' : 'online';
    session = new OnlineSession(m);
    const s = m.settings;
    resetView({ teamSize: s.teamSize, bo: s.bo, venue: s.venue });
    myTeam = m.yourTeam || 'A';
    const list = m.players.map((p) => ({ id: p.id, team: p.team, char: p.char, name: p.name, isBot: p.isBot, isMe: p.id === myPid && !spect, look: p.look || {} }));
    buildScene(s.venue, list, true);
    me = spect ? null : players.get(myPid) || null;
    UI.hideScreens();
    showHUD(true);
    hudPing();
    net.watch = true;
    updateHUD();
    if (spect) UI.setMsg('Đang xem trực tiếp');
  }

  function applySync(s) {
    V.phase = s.phase; V.score = s.scores; V.round = s.round; V.cdEnd = s.ts + s.cd; ctl.cdShown = -1;
    for (const st of s.players) {
      const p = players.get(st.id); if (!p) continue;
      Object.assign(p, { x: st.x, z: st.z, vx: st.vx, vz: st.vz, aim: st.aim, yaw: st.aim, hp: st.hp, alive: st.al, w: st.w, am: st.am, rl: st.rl, sn: st.sn, sh: st.sh, fr: st.fr, pw: st.pw });
      p.buf.length = 0;
      if (!p.alive) { p.holder.visible = false; if (p.tag) p.tag.classList.add('dead'); }
    }
    for (const pk of s.pickups) pickups.add(pk);
    for (const b of s.bullets) { const o = players.get(b.owner); bullets.spawn(b, o ? o.team : 'A', 0); }
    if (me) ctl.aim = me.aim;
    updateHUD();
    if (s.phase === 'paused') UI.banner('Đang chờ người chơi kết nối lại…');
  }

  /* ================= Gắn sự kiện giao diện ================= */
  function bindUI() {
    UI.$$('[data-act="back-main"]').forEach((b) => b.onclick = () => { A.click(); closeSetupPreview(); if (mode === 'menu') { refreshMainStats(); UI.show('scr-main'); } });
    $('[data-act="offline"]').onclick = () => { A.unlock(); A.click(); openSetup(); };
    $('[data-act="cup"]').onclick = () => { A.unlock(); A.click(); Cup.open(); };
    $('#cup-back').onclick = () => { A.click(); refreshMainStats(); UI.show('scr-main'); };
    $('#cup-quit').onclick = () => { A.click(); Cup.abandon(); };
    $('#cup-play').onclick = () => { A.unlock(); A.click(); Cup.play(); };
    $('[data-act="online"]').onclick = () => { A.unlock(); A.click(); goOnline(); };
    $('[data-act="help"]').onclick = () => { A.click(); UI.show('scr-help'); };
    $('[data-act="vip"]').onclick = () => { A.unlock(); A.click(); openVip(); };
    $('#vip-done').onclick = closeVip;
    $('#vip-clear').onclick = () => { A.click(); PP.Kit.clear(vipScopeId()); vipRender(); };
    UI.seg($('#vip-scope'), 'char', (v) => { vipScope = v; vipRender(); });
    UI.seg($('#vip-anim'), 'ready', (v) => { if (vipPreview && vipPreview.setAnim) vipPreview.setAnim(v); });
    $('#vip-file').onchange = () => {
      const f = $('#vip-file').files && $('#vip-file').files[0]; if (!f) return;
      vipEditAndSave(f, vipSlot, vipScopeId());
    };
    $('#btn-sound').onclick = () => { const st = S(), on = !st.music && !st.sfx; st.music = on; st.sfx = on; Save.data.muted = !on; applyAudioSettings(); Save.save(); refreshMainStats(); A.click(); };
    $('#btn-start').onclick = () => { A.unlock(); A.click(); closeSetupPreview(); startOffline(); };
    UI.$$('[data-act="settings"]').forEach((b) => b.onclick = () => { A.click(); openSettings(); });
    $('#btn-settings-close').onclick = closeSettings;
    UI.$$('[data-act="wardrobe"]').forEach((b) => b.onclick = () => { A.unlock(); A.click(); openWardrobe(); });
    $('#wd-done').onclick = closeWardrobe;
    $('#wd-reset').onclick = () => { A.click(); delete Save.data.looks[wdChar]; Save.save(); wdRender(); };
    $('#wd-random').onclick = () => { A.click(); wdRandom(); };
    UI.seg($('#wd-anim'), 'ready', (v) => { if (wdPreview && wdPreview.setAnim) wdPreview.setAnim(v); });
    window.addEventListener('resize', () => { if (wdPreview && wdPreview.resize) wdPreview.resize(); });

    $('#btn-pause').onclick = () => togglePause();
    $('#btn-resume').onclick = () => { A.click(); resume(); };
    $('#btn-restart').onclick = () => { A.click(); startOffline(); };
    $('#btn-quit').onclick = () => {
      A.click();
      if (mode === 'offline' && session.cfg.cup) { Cup.record(false, { A: 0, B: (session.cfg.bo + 1) / 2 }); endSession(); mode = 'menu'; buildMenuScene(); Cup.open(); return; }
      if (mode === 'offline') { goMenu(); return; }
      if (mode === 'spectate') net.send({ t: 'spectate_leave' }); else net.send({ t: 'room_leave' });
      endSession(); mode = 'menu'; buildMenuScene(); room = null;
      goOnline();
    };
    $('#btn-again').onclick = () => {
      A.click();
      if (mode === 'offline' && session && session.cfg.cup) { endSession(); mode = 'menu'; buildMenuScene(); Cup.open(); return; }
      if (mode === 'offline') { startOffline(); return; }
      net.send({ t: 'rematch' });
      $('#btn-again').disabled = true;
      $('#btn-again').textContent = 'Đang chờ đối thủ…';
    };
    $('#btn-over-menu').onclick = () => {
      A.click();
      if (mode === 'offline') { goMenu(); return; }
      const wasSpect = mode === 'spectate';
      endSession(); mode = 'menu'; buildMenuScene();
      if (wasSpect || !room) goOnline(); else { renderRoom(); UI.show('scr-room'); }
    };

    $('#btn-profile-ok').onclick = () => {
      const name = Protocol.cleanName($('#profile-name').value);
      if (name.length < 2) { UI.toast('Biệt danh cần ít nhất 2 ký tự'); return; }
      Save.data.name = name; Save.save();
      if (net) net.send({ t: 'set_profile', name, char: Save.data.char, look: myLook() });
      A.click();
      goOnline();
    };
    $('#profile-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-profile-ok').click(); });
    $('#btn-edit-profile').onclick = () => { A.click(); openProfile(); };
    $('#btn-online-back').onclick = () => { A.click(); goMenu(); };
    UI.$$('[data-queue]').forEach((b) => b.onclick = () => { A.click(); net.send({ t: 'queue_join', mode: b.dataset.queue }); });
    UI.$$('[data-create]').forEach((b) => b.onclick = () => {
      A.click();
      net.send({ t: 'room_create', mode: b.dataset.create, settings: { venue: Save.data.venue, bo: +Save.data.bo } });
    });
    $('#btn-join').onclick = () => {
      const code = $('#join-code').value.trim().toUpperCase();
      if (code.length !== 4) { UI.toast('Mã phòng gồm 4 ký tự'); return; }
      A.click(); net.send({ t: 'room_join', code });
    };
    $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
    $('#btn-live-refresh').onclick = () => { net.send({ t: 'leaderboard' }); };
    $('#btn-watch').onclick = () => {
      const code = $('#watch-code').value.trim().toUpperCase();
      if (code.length !== 4) { UI.toast('Mã phòng gồm 4 ký tự'); return; }
      A.click(); watchCode = code; net.send({ t: 'spectate', code });
    };
    $('#watch-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-watch').click(); });
    $('#btn-queue-cancel').onclick = () => { A.click(); net.send({ t: 'queue_leave' }); stopQueueTimer(); UI.show('scr-online'); };

    $('#btn-copy-link').onclick = () => {
      if (!room) return;
      const link = location.origin + location.pathname + '?room=' + room.code;
      const done = () => UI.toast('Đã sao chép link mời: ' + link, 3500);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => window.prompt('Sao chép link mời:', link));
      else window.prompt('Sao chép link mời:', link);
    };
    UI.$$('[data-team]').forEach((b) => b.onclick = () => net.send({ t: 'room_update', team: b.dataset.team }));
    const sendSettings = () => net.send({ t: 'room_update', settings: { venue: $('#room-venue').value, bo: +$('#room-bo').value } });
    $('#room-venue').onchange = sendSettings; $('#room-bo').onchange = sendSettings;
    $('#room-fill').onchange = () => net.send({ t: 'room_update', fillBots: $('#room-fill').checked });
    $('#room-botlevel').onchange = () => net.send({ t: 'room_update', botLevel: $('#room-botlevel').value });
    $('#btn-ready').onclick = () => {
      const meP = room && room.players.find((p) => p.id === myPid);
      net.send({ t: 'room_ready', ready: !(meP && meP.ready) });
    };
    $('#btn-room-start').onclick = () => { A.click(); net.send({ t: 'room_start' }); };
    $('#btn-room-leave').onclick = () => { A.click(); net.send({ t: 'room_leave' }); room = null; $('#chat-log').textContent = ''; UI.show('scr-online'); };
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('#chat-input');
      const text = Protocol.cleanChat(inp.value);
      if (text) net.send({ t: 'chat', text });
      inp.value = '';
    });

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') togglePause();
    });
    $('#w-rifle').onclick = () => { ctl.w = 'rifle'; A.click(); };
    $('#w-sniper').onclick = () => { ctl.w = 'sniper'; A.click(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'offline' && session && !paused) togglePause(); });
  }

  const BLURB = {
    bunny: 'Công chúa xinh xinh, bắn bong bóng cực đáng yêu', bear: 'Chú bé tinh nghịch', cat: 'Đoa toàn xịt', pig: 'Lì đòn, chạy không biết mệt',
    frog: 'Nhảy nhót né đạn siêu đỉnh', penguin: 'Chậm mà chắc', fox: 'Ranh mãnh, hay bắn vòng', panda: 'Cái gì cũng hay',
    dino: 'Đạn to như quả bóng bay', monkey: 'Lăng xăng khắp sân', elephant: 'Cái gì cũng chắn được', raccoon: 'Chuyên bắn lén',
    deer: 'Cái gì cũng giỏi', turtle: 'Phòng thủ như bức tường', capybara: 'Không gì làm nao núng', seal: 'Bắn bong bóng như làm xiếc',
    lion: 'Thủ lĩnh đấu trường', sloth: 'Chậm rãi nhưng ngắm chuẩn từng li',
  };
  let setupPreview = null;
  function closeSetupPreview() {
    if (setupPreview) { try { setupPreview.dispose(); } catch (e) { /* bỏ qua */ } setupPreview = null; }
  }
  function setupHero() {
    const d = Save.data, def = CHAR(d.char);
    $('#setup-hero-name').textContent = def.name;
    $('#setup-hero-tag').textContent = BLURB[def.id] || '';
    const pic = $('#setup-hero-pic');
    if (setupPreview) { setupPreview.set(def, fullLook(def.id)); pic.classList.add('hidden'); }
    else { pic.textContent = ''; pic.append(UI.avatarEl(def.id, 'em')); pic.classList.remove('hidden'); }
  }
  function setupSummary() {
    const d = Save.data, v = VENUE(d.venue);
    const chips = [CHAR(d.char).name, +d.mode === 2 ? 'Đấu đôi' : 'Đấu đơn', PP.LEVELS[d.level].name, +d.bo === 3 ? 'Thắng 2/3 hiệp' : '1 hiệp', v.name];
    const el = $('#setup-summary'); el.textContent = '';
    for (const c of chips) { const s2 = document.createElement('span'); s2.className = 'chip'; s2.textContent = c; el.append(s2); }
    $('#setup-venue-info').textContent = v.desc;
  }
  function openSetup() {
    const d = Save.data;
    $('#setup-wins').textContent = `🏆 ${d.wins} thắng · ${d.losses} thua`;
    UI.charGrid($('#setup-chars'), d.char, d.wins, (id) => { d.char = id; Save.save(); setupHero(); setupSummary(); });
    UI.seg($('#setup-mode'), d.mode, (v) => { d.mode = +v; Save.save(); setupSummary(); });
    UI.seg($('#setup-level'), d.level, (v) => { d.level = v; Save.save(); setupSummary(); });
    UI.seg($('#setup-bo'), d.bo, (v) => { d.bo = +v; Save.save(); setupSummary(); });
    UI.venueList($('#setup-venue'), d.venue, (v) => { d.venue = v; Save.save(); setupSummary(); });
    UI.show('scr-setup');
    if (!setupPreview && !softwareGL && PP.Character.createPreview) {
      try { setupPreview = PP.Character.createPreview($('#setup-canvas')); } catch (e) { setupPreview = null; }
    }
    $('#setup-canvas').classList.toggle('hidden', !setupPreview);
    setupHero(); setupSummary();
  }

  /* ================= Khởi động ================= */
  /** Chờ trình duyệt vẽ lại để chữ trên màn tải kịp cập nhật giữa các bước nặng */
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  function bootStep(text) { const el = document.getElementById('loading-text'); if (el) el.textContent = text; return nextPaint(); }
  function bootFail(msg) { if (window.__bootFail) window.__bootFail(msg); else $('#loading').textContent = msg; }

  const HTML_REV = 1;   // phải khớp window.PP_HTML_REV trong index.html
  async function boot() {
    if (window.PP_HTML_REV !== HTML_REV) {
      bootFail('Trang đang dùng bản cũ trong bộ nhớ đệm của trình duyệt. Bấm "Tải lại" (hoặc Ctrl+F5 / Cmd+Shift+R).');
      const btn = document.getElementById('loading-reload');
      if (btn) btn.onclick = () => { const u = new URL(location.href); u.searchParams.set('r', Date.now()); location.replace(u.toString()); };
      return;
    }
    // lỗi khi đang chơi: báo cho người dùng thay vì để giao diện đứng im
    let lastErrToast = 0;
    window.addEventListener('error', (e) => {
      if (!$('#loading').classList.contains('hidden')) return;
      if (Date.now() - lastErrToast < 4000) return;
      lastErrToast = Date.now();
      UI.toast('Có lỗi: ' + (e.message || 'không rõ') + '. Thử tải lại trang (Ctrl+F5).', 6000);
    });
    try {
      Save.load();
      try { if (PP.Kit) await PP.Kit.init(); } catch (e) { /* bỏ qua */ }
      // bản lưu cũ chỉ có nút tắt chung: chuyển thành tắt cả nhạc và hiệu ứng
      if (Save.data.muted && !(Save.data.audioV2)) { S().music = false; S().sfx = false; }
      Save.data.audioV2 = true; Save.save();
      applyAudioSettings();
      await bootStep('Đang khởi tạo đồ họa…');
      try { initRenderer(); }
      catch (e) { bootFail('Trình duyệt không hỗ trợ WebGL. Hãy bật "Tăng tốc phần cứng" hoặc dùng Chrome/Edge/Safari bản mới.'); return; }
      bindUI();
      await bootStep(softwareGL ? 'Đang dựng sân (máy không dùng GPU nên sẽ hơi lâu)…' : 'Đang dựng sân…');
      buildMenuScene();
      refreshMainStats();
      document.body.classList.toggle('touch', PP.Input.isTouch());
      await bootStep('Đang chuẩn bị đồ họa…');
      updateVisuals(0);
      renderer.render(world.scene, world.camera);   // biên dịch shader trước khi tắt màn tải
    } catch (e) {
      console.error(e);
      bootFail('Lỗi: ' + (e && e.message ? e.message : e));
      return;
    }
    $('#loading').classList.add('hidden');
    UI.show('scr-main');
    if (softwareGL) UI.toast('Trình duyệt đang không dùng GPU nên game sẽ chậm. Hãy bật "Tăng tốc phần cứng" trong cài đặt trình duyệt.', 7000);
    // việc nặng (ảnh chân dung, ảnh sân) để sau khi menu đã hiện
    setTimeout(loadPortraits, 600);
    const params = new URLSearchParams(location.search);
    const code = (params.get('room') || '').toUpperCase();
    if (code.length === 4) {
      pendingRoom = code;
      params.delete('room');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
      goOnline();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', boot);
  PP.Game = { Save, Cup, now, get state() { return { mode, V, players, me, ctl, myTeam, world, bullets, pickups }; } };
})(window.PP);
