DUY ANH BATTLE  (game bắn nước 3D, góc nhìn sau lưng như Pickle Ball, có chơi online)
===================================================================================
Gồm: index.html, assets/ (game), server.js + game-server.js + ws-lite.js (server riêng).
Không cần cài thư viện nào. Chỉ cần Node.js 18 trở lên.

1) CHẠY THỬ TRÊN MÁY
   node server.js            -> mở http://localhost:3000
   Mở 2 tab (hoặc 2 máy cùng wifi: http://IP-máy-bạn:3000) để thử online.

2) ĐƯA LÊN LINK RIÊNG: xem hướng dẫn GitHub + Render ở cuối tin nhắn trả lời (hoặc tài liệu Render: Web Service > Node).
   Build Command: (trống) · Start Command: node server.js

3) LUẬT CHƠI
   - Đầu mỗi ván có 5 GIÂY chọn 1 vũ khí: 💦 Súng nước hoặc 🎯 Ná cao su. Hết 5 giây là KHÓA, cả ván không đổi.
     (Có thể đặt sẵn lựa chọn mặc định trong Tủ đồ > Vũ khí.)
   - Số mạng mỗi bên: 5, 7 hoặc 11 (đấu đôi 2v2 có thêm 22; 2v2 dùng chung kho mạng của đội).
     Mỗi lần bị hạ mất 1 mạng. Hết mạng trước thì thua.
   - Còn mạng thì hồi sinh sau 1,5 giây ở một vị trí ngẫu nhiên (ưu tiên xa đối thủ).
     Đầu ván và mỗi lần hồi sinh đều BẤT TỬ 2 giây.
   - Mỗi lần xuất hiện có 100 máu.
   - Súng nước: 1 viên / 0,5s, băng 5 viên rồi nạp 1,5s. 10 máu / viên. Không xuyên vật cản, đạn nảy tối đa 5 lần vào tường và chướng ngại vật.
   - Ná cao su: 1 phát / 1s, 50 máu, xuyên mọi vật thể và mọi kẻ địch trên đường bắn.
   - Cứ 3 giây có 1 vật phẩm ngẫu nhiên rơi xuống sân (tối đa 8 cái, biến mất sau 16s):
       ❤️ Hồi 10 máu   💪 +10 sát thương mỗi phát (cộng dồn, mất khi bị hạ)
       🛡️ Khiên 2s (miễn sát thương)   ❄️ Đóng băng đối phương 2s (đứng im, không bắn được)
   - Đạn không gây sát thương cho đồng đội (và cho chính mình).

4) ĐIỀU KHIỂN
   Máy tính : WASD đi · chuột ngắm · bấm chuột / Space / J bắn · mũi tên = ngắm + bắn (không cần chuột) · Esc / P tạm dừng
   Điện thoại: cần trái đi, cần phải ngắm (giữ cần là bắn). Màn dọc vẫn dùng được.
   Tay cầm  : cần trái đi, cần phải ngắm, RT/RB bắn.

5) CAMERA
   Giống Pickle Ball: đặt sau vạch cuối sân của đội mình, cao, nhìn chếch xuống, bám theo nhân vật;
   đội B (online) cũng nhìn từ phía của mình. Công thức nằm trong assets/arena.js (world.updateCamera).

6) CHẾ ĐỘ
   Chơi với Bot (đấu đơn / đấu đôi cùng bot, 3 cấp bot) · Giải đấu 8 người (tứ kết 5 mạng, bán kết 7 mạng, chung kết 11 mạng)
   Chơi online: ghép nhanh, tạo phòng bằng mã 4 ký tự, xem trực tiếp, chat, bảng xếp hạng,
   2v2 thiếu người thì bật "Thêm bot vào chỗ trống". Mất mạng internet trong trận được chờ 30 giây.
   Tủ đồ: chọn nhân vật, màu áo/quần, phụ kiện, MÀU SÚNG và VŨ KHÍ (Súng nước / Ná). Nhân vật cầm súng ở mọi màn hình.
   Tủ đồ VIP: kit áo, quần theo ảnh của bạn (chỉ hiển thị trên máy bạn).

7) SỬA NHANH
   Hằng số (máu, sát thương, thời gian chọn súng, bất tử, hồi sinh, vật phẩm...) và 6 bản đồ: assets/config.js
   Cân bằng súng: config.js > C.RIFLE (dmg, delay, mag...) và C.SNIPER (dmg, delay).
   Bot: config.js (LEVELS) + assets/ai.js. Lõi luật: assets/shooter.js (chạy cả trên trình duyệt lẫn server).
