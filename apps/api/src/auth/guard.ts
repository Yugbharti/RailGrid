import type { preHandlerHookHandler } from 'fastify';
import { ERROR_CODES } from '@railgrid/shared';
import { verifyAccessToken } from './tokens.js';

export const authenticate: preHandlerHookHandler = async (request) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    const error = new Error('Sign in to continue.') as Error & { statusCode: number; code: string };
    error.statusCode = 401;
    error.code = ERROR_CODES.UNAUTHORIZED;
    throw error;
  }
  const claims = verifyAccessToken(
    authorization.slice(7).trim(),
    request.server.env.JWT_ACCESS_SECRET,
  );
  if (!claims) {
    const error = new Error('Sign in to continue.') as Error & { statusCode: number; code: string };
    error.statusCode = 401;
    error.code = ERROR_CODES.UNAUTHORIZED;
    throw error;
  }
  request.authUser = claims;
};
