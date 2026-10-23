import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Dummy credentials so AppModule's env validation passes. e2e tests never
    // call IBM: the agent is the AgentModule mock or a per-test override.
    env: {
      IBM_PROJECT_ID: 'e2e-project',
      IBM_ACCESS_TOKEN: 'e2e-token',
    },
  },
});
