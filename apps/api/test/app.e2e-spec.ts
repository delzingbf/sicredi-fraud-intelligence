import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // e2e tests require IBM_PROJECT_ID and IBM_ACCESS_TOKEN in the environment.
    // Set them before running: IBM_PROJECT_ID=x IBM_ACCESS_TOKEN=x pnpm test:e2e
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('GET /health returns 200 with status ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
