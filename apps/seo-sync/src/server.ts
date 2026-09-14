import { PrismaClient } from '@prisma/client';

import { loadConfig } from './config';
import { handler } from './handler';
import { createRuntimeServer, requireTriggerSecret } from './runtime-server';

const port = Number(process.env.FC_SERVER_PORT || process.env.PORT || 9000);
const triggerSecret = requireTriggerSecret('SEO_TRIGGER_SECRET');
const config = loadConfig();
const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });

const server = createRuntimeServer({
  serviceName: 'seo-sync',
  handler,
  triggerSecret,
  readiness: async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  },
});

server.listen(port, () => {
  console.log(`seo-sync 服务已启动，监听端口 ${port}`);
});
