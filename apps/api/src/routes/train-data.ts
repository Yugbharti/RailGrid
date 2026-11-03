import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { liveStatusSchema } from '@railgrid/shared';
import { TrainDataService, TrainDataUnavailable } from '../train-data/service.js';

const paramsSchema = z.object({
  number: z.string().regex(/^[0-9A-Za-z\s_/-]{1,20}$/),
});
const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function trainDataRoutes(app: FastifyInstance, service: TrainDataService) {
  app.get(
    '/trains/:number/live',
    {
      schema: {
        params: paramsSchema,
        querystring: querySchema,
        response: { 200: liveStatusSchema },
      },
    },
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);
      if (query.date) {
        const parsed = new Date(`${query.date}T00:00:00.000Z`);
        if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== query.date) {
          return reply.status(400).send({ error: 'Invalid calendar date' });
        }
      }
      try {
        return await service.getLiveStatus(params.number, query.date);
      } catch (error) {
        if (error instanceof TrainDataUnavailable) {
          return reply.status(503).send({ error: 'Live train data is temporarily unavailable' });
        }
        throw error;
      }
    },
  );
}
