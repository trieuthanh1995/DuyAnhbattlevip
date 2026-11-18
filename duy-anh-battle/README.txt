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
   - Máu mỗi trận: nhập ở ô "Máu mỗi trận" (menu Trận đấu / cài đặt phòng online), từ 100 đến 1000; để trống = 100.
     Mỗi lần xuất hiện (đầu ván và mỗi lần hồi sinh) có đúng số máu đó.
   - Súng nước: 1 viên / 0,3s, băng 10 viên rồi thay đạn 0,5s. 10 máu / viên. Không xuyên vật cản. Đạn va chạm 3 lần: 2 lần đầu nảy,
     lần thứ 3 đạn vỡ; nếu lần đó đập vào vật cản thì tính 1 nhát phá. Lần va chạm thứ 1 vào vật cản KHÔNG gây hại; lần thứ 2 sứt nửa nhát (C.BREAK.chip); lần thứ 3 tính trọn 1 nhát. Vật cản bé cần 3 nhát, to cần 5 nhát (theo diện tích) mới
     biến mất, trước đó thu nhỏ dần. Tường bao không bị phá.
   - Ná cao su: 1 phát / 1,5s, 40 máu (3 phát hạ 1 người). Đạn đá bay thẳng 42 m/s (cần ngắm đón đầu), đập tường bao thì nảy lại 1 lần (tổng tầm bay tối đa 40 m),
     xuyên mọi vật cản và mọi kẻ địch trên đường bay (mỗi người chỉ trúng 1 lần/viên). Người trúng thứ nhất chịu 100% sát thương, người thứ hai chỉ 50%.
     Cách bắn: GIỮ nút bắn để ngắm (hiện đường ngắm dài tới mép tường bao đầu tiên, chỉ mình bạn thấy, đi chậm còn 60%),
     NHẢ tay để bắn. Hủy: chuột phải / phím X / nút B tay cầm, hoặc kéo cần ngắm về gần tâm (dưới C.SNIPER.cancelMag) rồi nhả.
     Nhả khi ná chưa hồi xong thì không bắn; nhả sớm tối đa 0,2s trước lúc hồi xong thì được nhớ và bắn ngay khi hồi xong.
     Bot cầm ná vẫn bắn theo kiểu cũ (không cần giữ/nhả). Số liệu: C.SNIPER (aimSlow, cancelMag, buffer, queue) trong config.js.
   - ĐỘT TỬ: sau 3 phút giao tranh, máu tối đa của mọi người giảm dần mỗi giây (2% máu gốc/giây) xuống tối thiểu 10% máu gốc, kể cả khi hồi sinh. Chỉnh trong C.SUDDEN. Tầm bay tối đa 40m.
   - Cứ 3 giây có 1 vật phẩm ngẫu nhiên rơi xuống sân (tối đa 8 cái, biến mất sau 16s):
       ❤️ Hồi 10% máu gốc của trận (100 máu → 10). Nếu máu đã đầy, phần dư được cộng vào máu tối đa, giữ tới khi mất mạng, trần +50% máu gốc   💪 +10 sát thương mỗi phát trong 2s (không cộng dồn, nhặt thêm chỉ tính lại 2s)
       🛡️ Khiên 2s (miễn sát thương)   ❄️ Đóng băng đối phương 1s (không di chuyển được, vẫn ngắm và bắn được)
       💣 Bom ném: nhặt là tự ném 2 quả xuống chỗ gần địch, mỗi quả = 20% máu gốc của trận (100 máu → 20), rơi trong ≤1s (vùng nổ bán kính 1,2 m, chạy ra là né được)
       👟 Giày: chạy nhanh gấp 2 lần trong 3 giây, miễn nhiễm đóng băng (đang bị băng thì được gỡ)
   - Đạn không gây sát thương cho đồng đội (và cho chính mình).

4) ĐIỀU KHIỂN
   Máy tính : WASD đi · chuột ngắm · bấm chuột / Space / J bắn · mũi tên = ngắm + bắn (không cần chuột) · Esc / P tạm dừng
   Điện thoại: cần trái đi, cần phải ngắm (giữ cần là bắn). Màn dọc vẫn dùng được.
   Tay cầm  : cần trái đi, cần phải ngắm, RT/RB bắn.

5) CAMERA
   (Sân 26×16 m, gấp đôi diện tích bản cũ. Camera kéo xa hơn, bám theo nhân vật và hơi dẫn về phía trước mặt; có mũi tên chỉ hướng đối thủ ngoài màn hình và bản đồ mini ở góc phải.) Giống Pickle Ball: đặt sau vạch cuối sân của đội mình, cao, nhìn chếch xuống, bám theo nhân vật;
   đội B (online) cũng nhìn từ phía của mình. Công thức nằm trong assets/arena.js (world.updateCamera).

6) CHẾ ĐỘ
   Chơi với Bot (đấu đơn / đấu đôi cùng bot, 3 cấp bot) · Giải đấu 8 người (tứ kết 5 mạng, bán kết 7 mạng, chung kết 11 mạng)
   Chơi online: ghép nhanh, tạo phòng bằng mã 4 ký tự, xem trực tiếp, chat, bảng xếp hạng,
   2v2 thiếu người thì bật "Thêm bot vào chỗ trống". Mất mạng internet trong trận được chờ 30 giây.
   Tủ đồ: chọn nhân vật, màu áo/quần, phụ kiện, MÀU SÚNG và VŨ KHÍ (Súng nước / Ná). Nhân vật cầm súng ở mọi màn hình.
   Tủ đồ VIP: kit áo, quần theo ảnh của bạn (chỉ hiển thị trên máy bạn).

7) SỬA NHANH
   Hằng số (máu mặc định/min/max HP, HP_MIN, HP_MAX, bom C.BOMB, giày C.BOOST_MUL/BOOST_TIME, sát thương, thời gian chọn súng, bất tử, hồi sinh, vật phẩm...) và 6 bản đồ: assets/config.js
   Cân bằng súng: config.js > C.RIFLE (dmg, delay, mag, bounces...), C.BREAK (số nhát phá 3–5, mức thu nhỏ) và C.SNIPER (dmg, delay, speed, range).
   Bot: config.js (LEVELS) + assets/ai.js (bot ngắm đón đầu cho cả súng nước lẫn ná, và né cả đá ná). Lõi luật: assets/shooter.js (chạy cả trên trình duyệt lẫn server).

Chat thoại online (WebRTC, làm giống game Pickle Ball):
   - Trong phòng online bấm "Bật chat thoại" (cần HTTPS hoặc localhost để trình duyệt cho dùng micro). Mic có 2 chế độ:
     mở mic liên tục (có nút tắt/bật mic) hoặc giữ để nói (giữ nút 🗣 hoặc giữ phím T). Trong trận có nút mic nhỏ ở góc trên bên trái,
     kèm ảnh những người đang trong thoại, ai đang nói thì viền sáng xanh. Có người nói thì nhạc nền và hiệu ứng tự nhỏ lại.
   - Âm thanh đi thẳng giữa các máy; server chỉ chuyển tin báo hiệu (offer/answer/ICE) trong cùng phòng, không nhận hay lưu âm thanh.
     Chỉ người chơi trong phòng nghe và nói được; khán giả xem trực tiếp không vào thoại.
   - Chỉnh được: Âm lượng thoại (mặc định 200%, tối đa 300%), Độ to mic của bạn (mặc định 180%), âm lượng và tắt tiếng riêng từng người.
   - Để nối được ở mọi loại mạng (4G, wifi công ty) nên thêm máy chủ TURN. Đặt biến môi trường trên Render:
       TURN_URL   = turn:tên-máy-chủ:443?transport=tcp   (nhiều địa chỉ: ngăn cách bằng dấu phẩy)
       TURN_USER  = tên đăng nhập
       TURN_PASS  = mật khẩu
     hoặc ICE_SERVERS = chuỗi JSON mảng iceServers do nhà cung cấp (Metered, Cloudflare, Twilio…) đưa cho bạn.
     Kiểm tra tại  https://tên-game.onrender.com/ice
   - File: assets/voice.js (WebRTC), game-server.js (chuyển tin báo hiệu), server.js (đường /ice), phần "Chat thoại" trong assets/game.js.

Vũ khí ngẫu nhiên đầu trận:
   - Trong Đấu với máy (mục "Vũ khí": Tự chọn / 🎲 Ngẫu nhiên) và trong phòng online (ô "Vũ khí ngẫu nhiên đầu trận", chủ phòng chỉnh).
   - Bật ngẫu nhiên: ngay khi trận bắt đầu, máy chọn súng nước hoặc ná cho MỌI người (kể cả bot), tỉ lệ 50/50 mỗi người. Màn hình hiện hiệu ứng quay
     khoảng 1,3 giây rồi dừng. Chọn đúng 1 lần, khóa cả trận, không tự chọn lại được. Trận đấu lại thì quay lại từ đầu.
   - Tắt: giữ nguyên cách cũ, tự chọn trong 5 giây đầu rồi khóa. Server là nơi quay, nên mọi máy thấy cùng một kết quả.

Tìm trận / dò phòng online:
   - "Tìm trận 1v1/2v2": trước hết tự vào phòng đang mở của người khác (phòng tạo bằng "Tạo phòng", chưa đầy, chưa đấu), nếu không có thì ghép với người
     cũng đang tìm. Đấu đôi: chờ 10 giây mà chưa đủ 4 người thì được bot thay chỗ trống. Người đang chờ sẽ được kéo vào ngay khi có người tạo phòng.
   - Sảnh online có danh sách "Phòng đang mở" (bấm Vào) và "Trận đang diễn ra" (bấm Xem), tự làm mới mỗi 3 giây.
   - Phòng riêng (tích 🔒 khi tạo): không hiện trong danh sách và không bị kéo người vào, chỉ vào bằng mã.
   - Lưu ý khi thử một mình: 2 tab trên cùng một trình duyệt dùng chung mã thiết bị nên bị tính là 1 người. Hãy dùng 2 thiết bị / 2 trình duyệt khác nhau.
