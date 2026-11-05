import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppEnv } from '../config/app.config.js';
import { Transaction } from './transaction.entity.js';
import { DataService } from './data.service.js';

/**
 * DataModule — owns all database access.
 * Exports DataService so tool providers in ToolsModule can inject it.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL', { infer: true }),
        entities: [Transaction],
        synchronize: false,
        migrations: [],
        logging: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Transaction]),
  ],
  providers: [DataService],
  exports: [DataService],
})
export class DataModule {}
