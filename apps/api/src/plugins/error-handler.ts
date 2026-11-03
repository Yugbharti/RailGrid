import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { ERROR_CODES } from '@railgrid/shared';

async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    // Fastify validation errors (from zod type provider)
    if ('validation' in error && Array.isArray((error as { validation?: unknown }).validation)) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Request validation failed',
          requestId,
          details: (error as { validation: unknown }).validation,
        },
      });
    }

    // Direct zod errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Validation failed',
          requestId,
          details: error.issues,
        },
      });
    }

    // Known application errors
    if ('statusCode' in error && 'code' in error) {
      const statusCode = (error as { statusCode: number }).statusCode;
      const code = (error as { code: string }).code;
      return reply.status(statusCode).send({
        error: {
          code,
          message: error.message,
          requestId,
        },
      });
    }

    // Fastify 404
    if (error.statusCode === 404) {
      return reply.status(404).send({
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Route not found',
          requestId,
        },
      });
    }

    // Default 500
    app.log.error({ err: error, requestId }, 'Unhandled error');
    return reply.status(500).send({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
        requestId,
      },
    });
  });
}

export const errorHandler = fp(errorHandlerPlugin);
