import { DataSource } from 'typeorm';
import dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST as string,
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USER as string,
    password: process.env.DB_PASS as string,
    database: process.env.DB_NAME as string,
    synchronize: true,
    logging: false,
    entities: ['src/models/**/*.ts'],
    migrations: [],
    subscribers: [],
    extra: {
        max: 20, 
        idleTimeoutMillis: 30000, 
        connectionTimeoutMillis: 2000, 
    }
});