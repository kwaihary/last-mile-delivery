// feat(socket): initiate socket.io gateway handler for high-frequency geolocation signals  
import express from 'express';
import 'reflect-metadata';
import { AppDataSource } from './config/database'
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import { initSockets } from './sockets';
import driverRoutes from './routes/driverRoutes'
// Load biến môi trường
dotenv.config();

// Khởi tạo ứng dụng express
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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
})

initSockets(io);
app.use('/api/drivers', driverRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'Server is working nicely!'
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on: http://localhost:${PORT}`);
});
