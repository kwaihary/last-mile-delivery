import { DataSource } from 'typeorm';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL;

export const AppDataSource = new DataSource({
    type: 'postgres',
    ...(databaseUrl
        ? { url: databaseUrl }
        : {
            host: process.env.DB_HOST as string,
            port: parseInt(process.env.DB_PORT || '5432'),
            username: process.env.DB_USER as string,
            password: process.env.DB_PASS as string,
            database: process.env.DB_NAME as string,
        }),
    synchronize: true,
    logging: false,
    entities: [__dirname + '/../models/*.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    subscribers: [],
    ssl: isProduction || databaseUrl?.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : false,
    extra: {
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    }
});