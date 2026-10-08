import web from '../../../apps/web/vitest.config.mts';
import integration from '../../../apps/backend/vitest.integration.config.mts';

console.log(JSON.stringify({ web: web.test?.projects, integration: integration.test }));
