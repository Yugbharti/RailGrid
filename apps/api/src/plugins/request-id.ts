import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { v4 as uuidv4 } from 'uuid';

async function requestIdPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    // Use provided request ID or generate one
    if (!request.id) {
      (request as { id: string }).id = uuidv4();
    }
    reply.header('x-request-id', request.id);
  });
}

export const requestId = fp(requestIdPlugin);
