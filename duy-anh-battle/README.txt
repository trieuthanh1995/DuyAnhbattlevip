DUY ANH BATTLE  (bắn súng bong bóng nhìn từ trên xuống, có chơi online)
=====================================================================================
Gồm: index.html, assets/ (game), server.js + game-server.js + ws-lite.js (server riêng).
Không cần cài thư viện nào. Chỉ cần Node.js 18 trở lên.

1) CHẠY THỬ TRÊN MÁY
   node server.js            -> mở http://localhost:3000
   Mở 2 tab (hoặc 2 máy cùng wifi: http://IP-máy-bạn:3000) để thử online.

2) ĐƯA LÊN LINK RIÊNG ĐỂ BẠN BÈ CHƠI (Render.com, miễn phí)
   Giống bản Pickle Ball cũ: đẩy toàn bộ thư mục lên GitHub, trên Render chọn
   New > Web Service > Runtime = Node | Build Command = (trống) | Start Command = node server.js | Free.
   Gói Free: không ai vào một lúc thì server "ngủ", người vào đầu tiên chờ ~30-60 giây.
   Bảng xếp hạng lưu trong file tạm nên có thể bị xóa khi server khởi động lại.

3) LUẬT CHƠI
   - Mỗi người 100 máu. Ai (hoặc đội nào) hết máu trước thì thua hiệp. Thể thức: 1 hiệp hoặc thắng 2/3 hiệp.
   - Súng trường bong bóng: 1 viên / 0,5s, băng 5 viên rồi nạp 1,5s. 10 máu / viên.
     Không xuyên vật cản, nhưng nảy tối đa 5 lần vào tường và chướng ngại vật.
   - Ná cao su bắn tỉa: 1 phát / 1s, 50 máu, xuyên mọi vật thể và mọi kẻ địch trên đường bắn.
   - Cứ 3 giây có 1 vật phẩm ngẫu nhiên rơi xuống sân (tối đa 8 cái, biến mất sau 16s):
       ❤️ Hồi 10 máu   💪 +10 sát thương mỗi phát (cộng dồn đến hết hiệp)
       🛡️ Khiên 2s (miễn sát thương)   ❄️ Đóng băng đối phương 2s (đứng im, không bắn được)
   - Đạn không gây sát thương cho đồng đội (và cho chính mình).
   - Đổi súng mất 0,3s. Khiên không chặn đóng băng.

4) ĐIỀU KHIỂN
   Máy tính : WASD đi · chuột ngắm · bấm chuột / Space / J bắn · Q hoặc chuột phải hoặc 1 / 2 đổi súng
              (hoặc mũi tên = ngắm + bắn, không cần chuột) · Esc / P tạm dừng
   Điện thoại: cần trái đi, cần phải ngắm (giữ cần là bắn), nút 🔁 đổi súng. Màn dọc sẽ tự xoay sân dọc.
   Tay cầm  : cần trái đi, cần phải ngắm, RT/RB bắn, Y/LB đổi súng.

5) CHẾ ĐỘ
   Chơi với Bot (đấu đơn hoặc đấu đôi cùng bot, 3 cấp bot) · Giải đấu 8 người (Đồng/Bạc/Vàng, chung kết 2/3 hiệp)
   Chơi online: ghép nhanh, tạo phòng bằng mã 4 ký tự, xem trực tiếp, chat, bảng xếp hạng,
   2v2 thiếu người thì bật "Thêm bot vào chỗ trống". Mất mạng trong trận được chờ 30 giây.
   Tủ đồ và Tủ đồ VIP giữ nguyên: đổi trang phục, kit áo/quần theo ảnh của bạn (chỉ hiển thị trên máy bạn).
   Màu "Súng / vợt" trong Tủ đồ chính là màu thân súng bong bóng khi vào trận.

6) SỬA NHANH
   Hằng số game (máu, sát thương, thời gian, vật phẩm...) và 6 bản đồ : assets/config.js  (khối "const C" và MAPS)
   Cách vẽ bản đồ: obstacles là 1 góc phần tư, game tự lấy đối xứng ra 4 góc (hàm mirror4).
   Bot : assets/config.js (LEVELS) và assets/ai.js
   Tên game : assets/config.js (GAME_NAME), index.html (thẻ <title> và <h1 class="logo">)

7) KIẾN TRÚC (cho ai muốn sửa code)
   shooter.js : lõi mô phỏng (đạn nảy, ná xuyên vật, vật phẩm, hiệp đấu) - chạy cả trên trình duyệt lẫn server.
   Online: server giữ luật + sát thương; máy khách tự đi (server kẹp tốc độ và va chạm), đạn bay mô phỏng cục bộ từ sự kiện "shoot".
