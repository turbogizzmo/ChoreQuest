// @ts-check
import { defineConfig, devices } from '@playwright/test';

const BACKEND_PORT = 8199;
const FRONTEND_PORT = 5174;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // sequential — shared test DB
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['line']],
  timeout: 30_000,

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: './tests/e2e/global-setup.js',
  globalTeardown: './tests/e2e/global-teardown.js',

  webServer: [
    {
      // FastAPI backend on test port with isolated temp DB
      command: [
        'SECRET_KEY=e2e_test_secret_key_1234',
        'REGISTRATION_ENABLED=true',
        `DATABASE_URL=sqlite+aiosqlite:////tmp/chorequest_e2e.db`,
        'ACCESS_TOKEN_EXPIRE_MINUTES=60',
        'TZ=America/Chicago',
        `python3 -m uvicorn backend.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      ].join(' '),
      port: BACKEND_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: process.cwd(),
    },
    {
      // Vite dev server proxying to test backend
      command: `VITE_BACKEND_PORT=${BACKEND_PORT} VITE_PORT=${FRONTEND_PORT} npm run dev`,
      port: FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: `${process.cwd()}/frontend`,
    },
  ],
});
