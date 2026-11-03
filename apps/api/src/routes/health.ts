import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  // Liveness probe - is the process alive?
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Readiness probe - can the process serve traffic?
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let allHealthy = true;

    // Check DB connectivity
    try {
      const { prisma } = await import('@railgrid/db');
      await prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'ok';
    } catch {
      checks['database'] = 'error';
      allHealthy = false;
    }

    // Check Redis connectivity
    try {
      if (app.redis.status === 'wait' || app.redis.status === 'end') await app.redis.connect();
      await app.redis.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
      allHealthy = false;
    }

    const status = allHealthy ? 200 : 503;
    return reply.status(status).send({
      status: allHealthy ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}
