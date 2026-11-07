import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Meta values here are test placeholders; Meta itself is replaced by test/fakeGraph.ts.
    env: {
      NODE_ENV: 'test',
      // A throw-away data folder, wiped by the tests. Never the real server/data.
      DATA_DIR: process.env.TEST_DATA_DIR ?? `${tmpdir()}/sop-tracker-test-data`,
      CLIENT_ORIGIN: 'http://localhost:5173',
      META_APP_ID: 'test-app-id',
      META_APP_SECRET: 'test-app-secret',
      TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      SYNC_TIME_IST: '',
    },
    fileParallelism: false,
  },
});
