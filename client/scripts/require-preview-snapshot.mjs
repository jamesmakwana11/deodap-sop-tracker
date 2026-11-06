// The static demo (npm run build:preview) runs on a snapshot of DEVELOPMENT sample data that is
// generated locally and git-ignored. Stop early with instructions when it is missing.
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../src/preview/snapshot.json', import.meta.url))) {
  console.error(
    'The preview build needs client/src/preview/snapshot.json, made from development sample data:\n' +
      '  npm run db:seed:dev && npm run preview:snapshot --workspace server\n' +
      'The production build (npm run build) does not need it.',
  );
  process.exit(1);
}
