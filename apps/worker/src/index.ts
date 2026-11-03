import './load-env.js';
import pino from 'pino';
import { parseEnv } from '@railgrid/shared';

const env = parseEnv(process.env);

const logger = pino({
  level: env.LOG_LEVEL,
});

logger.info('RailGrid Worker starting...');

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down worker...`);
  // Workers will be registered here in Phase 6
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Keep process alive
logger.info('Worker ready (no jobs registered yet — Phase 6)');
