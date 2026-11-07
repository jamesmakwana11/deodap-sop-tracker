/** Every test file: Meta back-off waits are recorded instead of slept, so retries run instantly. */
import { beforeEach } from 'vitest';
import { setGraphSleep } from '../src/meta/graphClient.js';

export const graphWaits: number[] = [];
beforeEach(() => {
  graphWaits.length = 0;
  setGraphSleep(async (ms) => {
    graphWaits.push(ms);
  });
});
