// feat(socket): initiate socket.io gateway handler for high-frequency geolocation signals 
import express from 'express';
import 'reflect-metadata';
import { AppDataSource } from './config/database';
import dotenv from 'dotenv';
import cors from 'cors';

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
        console.log('✅ ĐÃ KẾT NỐI THÀNH CÔNG ĐẾN POSTGRESQL VÀ ĐỒNG BỘ MODELS');
    })
    .catch((error) => {
        console.error('❌ Lỗi kết nối PostgreSQL:', error);
    });

// Test
app.get('/', (req, res) => {
    res.send('Chào mừng bạn đến với Website Giao Hàng Chặng Cuối !');
});


app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'Server is working nicely!'
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on: http://localhost:${PORT}`);
});
