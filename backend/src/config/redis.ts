import { Redis } from "ioredis";
import dotenv from 'dotenv'

dotenv.config();

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redisClient.on('connect', () => {
    console.log('Đã kết nối thành công đến Redis Cache!')
});

redisClient.on('error', (err) => {
    console.error('Lỗi kết nối Redis', err)
});

export default redisClient;