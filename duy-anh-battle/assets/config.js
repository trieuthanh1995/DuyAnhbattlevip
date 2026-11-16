/* Duy Anh Battle – hằng số & dữ liệu dùng chung (trình duyệt + Node) */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_VERSION = '1.2.0';
  const GAME_NAME = 'Duy Anh Battle';

  const C = {
    HP: 100,                  // máu mặc định mỗi lần xuất hiện (người chơi có thể chọn 100–1000 trước trận)
    HP_MIN: 100, HP_MAX: 1000,
    PLAYER_R: 0.42,           // bán kính va chạm của nhân vật
    SPEED: 4.6,               // m/s
    STEP: 1 / 60,             // bước mô phỏng cố định
    SELECT_TIME: 5,           // đầu ván: 5 giây chọn 1 loại vũ khí, chọn xong không đổi được
    SPAWN_SHIELD: 2,          // mỗi lần xuất hiện (đầu ván và mỗi lần hồi sinh): bất tử 2 giây
    RESPAWN_DELAY: 1.5,       // chờ trước khi hồi sinh ở vị trí ngẫu nhiên
    END_DELAY: 1.6,           // dừng một nhịp trước khi hiện bảng kết quả
    LIVES: [5, 7, 11, 22],    // số mạng mỗi bên (22 chỉ dành cho đấu đôi 2v2)
    // Súng nước: 1 viên / 0,3s, băng 10 viên rồi thay đạn 0,5s, 10 máu/viên, không xuyên vật cản.
    // Đạn va chạm 3 lần: 2 lần đầu nảy, lần thứ 3 vỡ ra; nếu lần thứ 3 đập vào VẬT CẢN thì phá một phần vật cản đó (tường bao thì không).
    RIFLE: { dmg: 10, delay: 0.3, mag: 10, reload: 0.5, speed: 11, r: 0.17, bounces: 3, life: 10 },
    // Ná cao su: 1 viên / 1,5s, 40 máu (3 phát hạ 1 người), đạn đá bay 32 m/s (né được), xuyên vật cản và mọi kẻ địch trên đường bay
    SNIPER: { dmg: 40, delay: 1.5, speed: 32, range: 40, width: 0.16 },
    // phá vật cản: mỗi viên đạn vỡ ở lần va chạm thứ 3 vào vật cản = 1 "nhát". Vật cản bé cần hitsMin nhát, to cần hitsMax nhát
    // (nội suy theo diện tích so với vật cản bé/to nhất của mọi bản đồ). Mỗi nhát thu nhỏ dần, nhát cuối thì biến mất. minScale = cỡ còn lại ngay trước nhát cuối.
    // chip: mỗi lần đạn NẢY vào vật cản (lần va chạm 1, 2) cũng làm sứt nửa nhát, để súng nước phá nhanh hơn; lần thứ 3 vẫn tính trọn 1 nhát.
    BREAK: { hitsMin: 3, hitsMax: 5, minScale: 0.3, chip: 0.5 },
    // 💣 Bom ném: nhặt là tự ném BOMB.count quả vào chỗ gần địch, rơi sau tối đa BOMB.fall giây (địch chạy ra khỏi vùng nổ là né được)
    BOMB: { count: 2, dmg: 20, fall: 1.0, stagger: 0.3, spread: 0.8, radius: 1.2 },
    // 👟 Giày: chạy nhanh BOOST_MUL lần trong BOOST_TIME giây
    BOOST_MUL: 1.5, BOOST_TIME: 3,
    POWER_BONUS: 10,          // vật phẩm sức mạnh: +10 sát thương mỗi phát (cộng dồn)
    HEAL: 10, SHIELD: 2, FREEZE: 1,   // đóng băng 1s: đứng im nhưng vẫn ngắm & bắn được
    POWER_TIME: 2,            // vật phẩm sức mạnh: +10 sát thương trong 2 giây, KHÔNG cộng dồn (nhặt thêm chỉ làm mới lại 2s)
    PICKUP_EVERY: 3, PICKUP_MAX: 8, PICKUP_LIFE: 16, PICKUP_R: 0.55,
    HW: 13, HD: 8,            // nửa chiều dài / nửa chiều rộng sân (m) – sân 26×16, rộng gấp đôi DIỆN TÍCH bản cũ (18×11)
    CHAR_SCALE: 1.3,          // hệ số phóng to nhân vật khi hiển thị
  };
  const PICKUP_TYPES = ['heal', 'power', 'shield', 'freeze', 'bomb', 'boots'];
  /** Máu mỗi trận: để trống / không hợp lệ → 100; còn lại giới hạn trong 100–1000 */
  function normHp(v) {
    if (v === '' || v === null || v === undefined) return C.HP;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return C.HP;
    return Math.max(C.HP_MIN, Math.min(C.HP_MAX, n));
  }

  /* ---------- bản đồ: obstacles là 1 góc phần tư (x>0,z>0), tự lấy đối xứng 4 góc ---------- */
  const box = (x, z, w, d) => ({ t: 'box', x, z, w, d });
  const cir = (x, z, r) => ({ t: 'circle', x, z, r });
  function mirror4(list) {
    const out = [], seen = new Set();
    for (const o of list) {
      for (const sx of (o.x === 0 ? [1] : [1, -1])) {
        for (const sz of (o.z === 0 ? [1] : [1, -1])) {
          const c = Object.assign({}, o, { x: o.x * sx, z: o.z * sz });
          const k = c.t + c.x + ',' + c.z;
          if (!seen.has(k)) { seen.add(k); out.push(c); }
        }
      }
    }
    return out;
  }
  const SPAWNS = { A: [[-11.7, -2], [-11.7, 2]], B: [[11.7, -2], [11.7, 2]] };
  const MAPS = [
    { id: 'candy', name: 'Sân Kẹo Ngọt', desc: 'Hộp quà & kẹo tròn · nhiều chỗ nấp', sky: 0xffd6ea, court: 0xff9ec7,
      theme: { floor: 0xffc2dc, floor2: 0xffadd0, wall: 0xff7eb3, wallTop: 0xffe3f0, outer: 0xffe9a8, obst: 0x7bd3ff, obst2: 0xffe066, accent: 0xff4f93, circle: 'scoop', box: 'gift' },
      obstacles: mirror4([box(3, 2.4, 1.6, 1.6), box(6.5, 4.2, 2.2, 0.9), box(0, 3.9, 1.2, 1.2), cir(0, 0, 1.1)]) },
    { id: 'mushroom', name: 'Rừng Nấm Thần Kỳ', desc: 'Toàn nấm tròn · đạn nảy lung tung', sky: 0xcdf0b8, court: 0x7fbf5a,
      theme: { floor: 0x9be07a, floor2: 0x8ad06a, wall: 0x8a5a33, wallTop: 0xb98a5e, outer: 0x4f9a6c, obst: 0xff6f6f, obst2: 0xffffff, accent: 0xffd23f, circle: 'mushroom', box: 'log' },
      obstacles: mirror4([cir(2.6, 1.8, 0.8), cir(5.6, 3.9, 1.0), cir(7.8, 3.4, 0.6), cir(0, 4.0, 0.9), cir(0, 0, 1.2), box(4, 5.6, 1.6, 0.6)]) },
    { id: 'beach', name: 'Bãi Biển Con Cua', desc: 'Thùng gỗ, đá và tường cát', sky: 0x9edcff, court: 0xf0d9a0,
      theme: { floor: 0xf6e3b0, floor2: 0xefd79a, wall: 0x2ba3c4, wallTop: 0x9fe6f5, outer: 0x45b8d8, obst: 0xc98b4f, obst2: 0xff8a5c, accent: 0x2b86b0, circle: 'rock', box: 'crate' },
      obstacles: mirror4([box(3, 4, 2, 1), box(5.6, 1.4, 0.9, 1.6), cir(8, 4.2, 0.9), cir(1.6, 1.6, 0.6), box(0, 0, 1, 3)]) },
    { id: 'ice', name: 'Hồ Kem Lạnh', desc: 'Cột kem tròn rải khắp sân', sky: 0xdff3ff, court: 0xbfe6ff,
      theme: { floor: 0xdff4ff, floor2: 0xc9ebff, wall: 0x8fd0f5, wallTop: 0xf2fbff, outer: 0xb8e2f7, obst: 0xffb3d1, obst2: 0xb9f6ca, accent: 0x4cc9f0, circle: 'scoop', box: 'gift' },
      obstacles: mirror4([cir(2.2, 2.1, 0.7), cir(5.0, 3.4, 0.8), cir(7.0, 4.3, 0.7), cir(6.6, 1.9, 0.55), cir(0, 4.2, 0.8), cir(0, 0, 0.8)]) },
    { id: 'toy', name: 'Phòng Đồ Chơi', desc: 'Khối xếp hình thành mê cung', sky: 0xfff0c2, court: 0x6bb5ff,
      theme: { floor: 0x8fc8ff, floor2: 0x7fbaf5, wall: 0xffd23f, wallTop: 0xfff3a8, outer: 0xffe0a3, obst: 0xff6b6b, obst2: 0x5ad1a8, accent: 0xff9f1c, circle: 'pillar', box: 'block' },
      obstacles: mirror4([box(2, 2.6, 1.2, 1.2), box(4.6, 2.2, 0.8, 1.8), box(7, 4.4, 2, 0.8), box(0, 3.4, 3, 0.7), box(5.2, 5.4, 0.9, 0.9), box(0, 0, 0.8, 0.8)]) },
    { id: 'space', name: 'Trạm Vũ Trụ Sao Mai', desc: 'Rào chắn dài & trụ năng lượng', sky: 0x1a1d4a, court: 0x5b4bd6,
      theme: { floor: 0x4a4bb8, floor2: 0x5b5cd0, wall: 0x2a2d6a, wallTop: 0x8f93ff, outer: 0x0f1236, obst: 0x9b8cff, obst2: 0x5ad1ff, accent: 0xffd23f, circle: 'pillar', box: 'block' },
      obstacles: mirror4([box(3.6, 0, 0.8, 3), box(0, 4.3, 4, 0.7), cir(7, 4, 0.9), cir(0, 0, 0.9)]) },
  ];
  // bố cục vẽ gốc cho sân 18×11 (thu ×0.82 vị trí, ×0.9 kích thước); sân mới 26×16 nên vị trí vật cản
  // nhân theo tỉ lệ sân (HW/9) và kích thước phóng thêm ×1.15 để sân vẫn có chỗ nấp
  const POS_K = 0.82 * (C.HW / 9), SIZE_K = 0.9 * 1.15;
  for (const m of MAPS) {
    m.HW = C.HW; m.HD = C.HD; m.spawns = SPAWNS;
    m.obstacles = m.obstacles.map((o) => o.t === 'box'
      ? Object.assign({}, o, { x: +(o.x * POS_K).toFixed(2), z: +(o.z * POS_K).toFixed(2), w: +(o.w * SIZE_K).toFixed(2), d: +(o.d * SIZE_K).toFixed(2) })
      : Object.assign({}, o, { x: +(o.x * POS_K).toFixed(2), z: +(o.z * POS_K).toFixed(2), r: +(o.r * SIZE_K).toFixed(2) }));
  }
  // Vật cản BỔ SUNG (toạ độ cuối cùng, 1 góc phần tư rồi tự lấy đối xứng 4 góc), rải vào các chỗ trống lớn
  // của sân 26×16; giữ trống quanh chỗ xuất phát và chừa khoảng hở đủ cho nhân vật lách qua.
  const EXTRA = {
    candy: [cir(7.6, 1.6, 0.8), box(2.8, 6, 1.1, 1.1), cir(10.8, 6, 0.8), box(5.2, 6.4, 1.1, 1.1)],
    mushroom: [cir(7.6, 1.2, 0.7), cir(10.8, 6, 0.85), cir(2.8, 4.8, 0.6)],
    beach: [box(6.4, 6, 1.5, 0.9), cir(4.4, 1.2, 0.7)],
    ice: [cir(3.2, 5.6, 0.65), cir(10.8, 6, 0.75), cir(5.2, 1.2, 0.55), cir(6.4, 6.4, 0.55)],
    toy: [box(8, 1.2, 1.1, 1.1), box(2.8, 6, 0.8, 1.7), box(11.2, 5.6, 1.7, 0.8)],
    space: [box(4.8, 5.2, 0.7, 1.9), cir(7.6, 1.2, 0.6), box(2, 2.4, 1.9, 0.7), cir(10.8, 6, 0.6)],
  };
  for (const m of MAPS) m.obstacles = m.obstacles.concat(mirror4(EXTRA[m.id] || []));
  // khoảng diện tích vật cản (để quy ra số nhát phá, vật cản ngoài khoảng được kẹp về hitsMin hoặc hitsMax)
  const obsArea = (o) => (o.t === 'box' ? o.w * o.d : Math.PI * o.r * o.r);
  const AREAS = MAPS.reduce((a, m) => a.concat(m.obstacles.map(obsArea)), []);
  const SORTED = AREAS.slice().sort((a, b) => a - b), PCT = (p) => SORTED[Math.min(SORTED.length - 1, Math.floor(p * SORTED.length))];
  const OBS_AREA = { min: PCT(0.03), max: PCT(0.97) };   // bỏ vài vật cản quá bé/quá to để số nhát phân bố đều hơn
  const VENUES = MAPS;   // ui.js dùng tên VENUES cho danh sách sân

  /* ---------- nhân vật (giữ nguyên) ---------- */
  const CHARACTERS = [
    { id: 'bunny',   name: 'Kiều Anh',         emoji: '🐰', body: 0xfff4f7, accent: 0xffb3c7, belly: 0xffffff, paddle: 0xff6f91, ears: 'long',    unlock: 0 },
    { id: 'bear',    name: 'Duy Anh',          emoji: '🐻', body: 0xc68a55, accent: 0x8a5a33, belly: 0xf0d2a8, paddle: 0x3fa7d6, ears: 'round',   unlock: 0 },
    { id: 'panda',   name: 'Zin',              emoji: '🐼', body: 0xffffff, accent: 0x222222, belly: 0xffffff, paddle: 0xe63946, ears: 'panda',   unlock: 0 },
    { id: 'deer',     name: 'Bi',               emoji: '🦌', body: 0xd59a66, accent: 0x9ad06a, belly: 0xfbe6cc, paddle: 0xf4a261, ears: 'deer',     unlock: 0 },
    { id: 'cat',     name: 'Khánh Zô',         emoji: '🐱', body: 0x3b3b48, accent: 0xff9fb8, belly: 0xe9e9f2, paddle: 0xf7c948, ears: 'tri',     unlock: 0 },
    { id: 'pig',     name: 'Heo Hồng',        emoji: '🐷', body: 0xffb6c6, accent: 0xff8aa5, belly: 0xffd3dd, paddle: 0x7bd389, ears: 'pig',     unlock: 0 },
    { id: 'frog',    name: 'Ếch Cốm',         emoji: '🐸', body: 0x7ccf5b, accent: 0x4fa83a, belly: 0xe6f7c6, paddle: 0xff8c42, ears: 'frog',    unlock: 0 },
    { id: 'penguin', name: 'Cánh Cụt Đá',     emoji: '🐧', body: 0x2f3a4f, accent: 0xffa630, belly: 0xffffff, paddle: 0x9b6dff, ears: 'penguin', unlock: 0 },
    { id: 'fox',     name: 'Cáo Lửa',         emoji: '🦊', body: 0xff8a3d, accent: 0x5a2e14, belly: 0xffffff, paddle: 0x2ec4b6, ears: 'fox',     unlock: 0 },
    { id: 'dino',    name: 'Khủng Long Xanh', emoji: '🦖', body: 0x5bc0a8, accent: 0xffd166, belly: 0xd8f3e9, paddle: 0xef476f, ears: 'dino',    unlock: 0 },
    // v3 – 9 nhân vật mới
    { id: 'monkey',   name: 'Khỉ Chuối',        emoji: '🐵', body: 0xb07a4f, accent: 0xffd23f, belly: 0xf6d7b0, paddle: 0xffd23f, ears: 'monkey',   unlock: 0 },
    { id: 'elephant', name: 'Voi Mây',          emoji: '🐘', body: 0xa9b4c8, accent: 0xff8fab, belly: 0xd8deea, paddle: 0x7bdff2, ears: 'elephant', unlock: 0 },
    { id: 'raccoon',  name: 'Gấu Mèo Mặt Nạ',   emoji: '🦝', body: 0x8d8f9c, accent: 0x5ad1a8, belly: 0xe9e9ef, paddle: 0xff7a59, ears: 'raccoon',  unlock: 0 },
    { id: 'turtle',   name: 'Rùa Lá',           emoji: '🐢', body: 0x8fd17a, accent: 0x3e8e5e, belly: 0xf3eab0, paddle: 0x48cae4, ears: 'turtle',   unlock: 0 },
    { id: 'capybara', name: 'Chuột Lang Nước',  emoji: '🦫', body: 0xb98a5e, accent: 0xff9f1c, belly: 0xd9b38c, paddle: 0x2ec4b6, ears: 'capybara', unlock: 0 },
    { id: 'seal',     name: 'Hải Cẩu Bọt',      emoji: '🦭', body: 0xc8d3dd, accent: 0x4cc9f0, belly: 0xf1f5f9, paddle: 0xff70a6, ears: 'seal',     unlock: 0 },
    { id: 'lion',     name: 'Sư Tử Nắng',       emoji: '🦁', body: 0xf2b84b, accent: 0xe76f51, belly: 0xfde8b8, paddle: 0xe63946, ears: 'lion',     unlock: 0 },
    { id: 'sloth',    name: 'Lười Thong Thả',   emoji: '🦥', body: 0xa58b74, accent: 0xb5e48c, belly: 0xe6d5c3, paddle: 0x9b5de5, ears: 'sloth',    unlock: 0 },
  ];

  // bot: speed × tốc độ nhân vật, err = sai số ngắm (rad), turn = tốc độ xoay nòng (rad/s), react = thời gian phản ứng (s)
  const LEVELS = {
    rookie: { id: 'rookie', name: 'Tập sự',        speed: 0.62, err: 0.30, turn: 3.2,  react: 0.65, lead: 0.2, pickSniper: 0.30, dodge: 0.0, pickup: 0.35, range: 6.5 },
    pro:    { id: 'pro',    name: 'Chuyên nghiệp', speed: 0.85, err: 0.12, turn: 6.0,  react: 0.30, lead: 0.8, pickSniper: 0.50, dodge: 0.5, pickup: 0.75, range: 5.5 },
    ace:    { id: 'ace',    name: 'Cao thủ',       speed: 1.0,  err: 0.035, turn: 12.0, react: 0.10, lead: 1.0, pickSniper: 0.60, dodge: 0.9, pickup: 1.0,  range: 5.0 },
  };

  const LOOK = {
    patterns: ['solid', 'stripe', 'dots', 'split', 'flame', 'star', 'wave', 'check'],
    accessories: ['default', 'none', 'cap', 'capBack', 'visor', 'band', 'beanie', 'bow', 'shades', 'crown', 'flower', 'headphones', 'halo', 'party'],
    shirtStyles: ['tee', 'tank', 'jersey', 'hoodie', 'dress', 'suit'],
    colorKeys: ['shirt', 'shorts', 'accent', 'shoes', 'paddle'],
    numberMax: 99,
  };

  return { GAME_NAME, APP_VERSION, normHp, C, OBS_AREA, obsArea, PICKUP_TYPES, MAPS, VENUES, CHARACTERS, LEVELS, LOOK };
});
