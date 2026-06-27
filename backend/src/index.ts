// feat(socket): initiate socket.io gateway handler for high-frequency geolocation signals  
import express from 'express';
import 'reflect-metadata';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import redisClient from './config/redis';
import cors from 'cors';
import { initSockets } from './sockets';
// Load biến môi trường
dotenv.config();

// Khởi tạo ứng dụng express
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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


app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'Server is working nicely!'
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on: http://localhost:${PORT}`);
});
