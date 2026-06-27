import { io } from 'socket.io-client'

// Kết nối Socket chạy cổng 5000
const socket = io('http://localhost:5000');

// Tọa độ khu vực Hồ Chí Minh để giả lập di chuyển
let lat = 10.8231;
let lng = 106.6297;

socket.on('connect', () => {
    console.log('✅ Giả lập tài xế kết nối tới Gateway cổng 5000 thành công!');

    // Gửi tọa độ sau mỗi 4 giây
    setInterval(() => {
        lat += (Math.random() - 0.5) * 0.0005;
        lng += (Math.random() - 0.5) * 0.0005;

        socket.emit('driver:share-location', {
            orderId: 999,
            driverId: 101,
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6))
        });
        console.log(`📤 Đang truyền dữ liệu GPS: [${lat.toFixed(6)}, ${lng.toFixed(6)}]`);
    }, 5000);
});

socket.on('disconnect', () => {
    console.log('❌ Mất kết nối tới Gateway.');
});

socket.on('connect_error', (error) => {
    console.log('💥 Lỗi kết nối Socket:', error.message);
});
