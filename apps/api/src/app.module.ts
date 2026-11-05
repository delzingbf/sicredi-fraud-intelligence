import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';
import { InvestigationModule } from './investigation/investigation.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { appConfig, validate } from './config/app.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validate,
    }),
    HealthModule,
    InvestigationModule,
    ToolsModule,
  ],
})
export class AppModule {}
