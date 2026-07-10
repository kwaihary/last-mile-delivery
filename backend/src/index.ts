// feat(socket): initiate socket.io gateway handler for high-frequency geolocation signals
import express from 'express';
import 'reflect-metadata';
import cors from 'cors';
import { AppDataSource } from './config/database'
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { initSockets } from './sockets';
import { socketAuthMiddleware } from './middlewares/socketAuth';
import driverRoutes from './routes/driverRoutes'
import orderRoutes from './routes/orderRoutes'
import userRoutes from './routes/userRoutes'
// Load biến môi trường
dotenv.config();

// Khởi tạo ứng dụng express
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
// Tăng limit JSON body để nhận ảnh minh chứng dạng base64 từ driver-app
app.use(express.json({ limit: '10mb' }));

const customerTrackingRoot = '../frontend/customer-tracking/src';
const driverAppRoot = '../frontend/driver-app/src';

// ── Static Files: Customer Tracking (public, no auth required) ──────────────
app.use('/track', express.static(customerTrackingRoot));

// ── Static Files: Driver App (auth required on API) ────────────────────────
app.use('/driver', express.static(driverAppRoot));

// ── Redirect root → driver app ──────────────────────────────────────────────
app.get('/', (req, res) => {
    res.redirect('/driver/');
});

// Kết nối Database
AppDataSource.initialize()
    .then(() => {
        console.log('ĐÃ KẾT NỐI THÀNH CÔNG ĐẾN POSTGRESQL');
    })
    .catch((error) => {
        console.error('Lỗi kết nối PostgreSQL:', error);
    });


// Tạo HTTP dùng cho SocketIO
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Bảo mật Socket.IO — bắt buộc xác thực JWT trước khi kết nối
io.use(socketAuthMiddleware);

initSockets(io);

// Expose Socket.IO gateway for realtime status broadcasts from controllers
(global as any).io = io;

app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/drivers', driverRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'Server is working nicely!'
    });
});

// ── Customer Tracking Page ──────────────────────────────────────────────
// Serve /track → customer-tracking/src/index.html (static, no auth needed)
// Note: /track/:token is handled by the static middleware too
const customerTrackingPath = './index.html';
// /track/:token cũng phải trả về cùng file HTML (token được đọc từ URL path ở phía client)
app.get(['/track', '/track/:token'], (req, res) => {
    res.sendFile(customerTrackingPath, { root: customerTrackingRoot }, (err) => {
        if (err) {
            console.error('Không tìm thấy customer-tracking page:', err);
            res.status(404).send('Không tìm thấy trang theo dõi');
        }
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on: http://localhost:${PORT}`);
});
