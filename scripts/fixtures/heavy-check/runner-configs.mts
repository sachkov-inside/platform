import web from '../../../apps/web/vitest.config.mts';
import integration from '../../../apps/backend/vitest.integration.config.mts';
import backend from '../../../apps/backend/vitest.config.mts';
import telegram from '../../../apps/telegram/vitest.config.ts';

console.log(JSON.stringify({
  unit: { backend: backend.test?.maxWorkers, telegram: telegram.test?.maxWorkers },
  web: web.test?.projects,
  integration: integration.test,
}));
