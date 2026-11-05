import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Transaction } from './data/transaction.entity.js';

/**
 * Standalone DataSource for the TypeORM CLI (migration:run / migration:revert).
 * Not used at runtime — the NestJS app uses TypeOrmModule.forRootAsync() instead.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url:
    process.env['DATABASE_URL'] ??
    'postgresql://fraudlens:fraudlens@localhost:5432/fraudlens',
  entities: [Transaction],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
