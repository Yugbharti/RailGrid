import './load-env.js';
import { parseEnv } from '@railgrid/shared';
import { buildApp } from './app.js';

const env = parseEnv(process.env);

const app = await buildApp({ env });

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`RailGrid API listening on http://${env.HOST}:${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`);
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
