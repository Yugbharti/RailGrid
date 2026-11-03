import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseEnv } from '@railgrid/shared';
import { buildApp } from '../app.js';

describe('live train status route', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app?.close();
  });

  it('returns normalized fixture data without exposing provider credentials', async () => {
    app = await buildApp({
      env: parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        REDIS_URL: 'redis://localhost:6379',
        JWT_ACCESS_SECRET: 'test-access-secret-value-at-least-32-characters',
        REFRESH_TOKEN_PEPPER: 'test-refresh-pepper-value-at-least-32-characters',
        OUTBOX_ENCRYPTION_KEY: 'test-outbox-key-value-at-least-32-characters',
        TRAIN_DATA_PROVIDER: 'fixture',
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/v1/trains/12919/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      trainNumber: '12919',
      currentStation: 'Ujjain Jn',
      nextStation: 'Maksi Jn',
      stale: false,
    });
    expect(response.body).not.toContain('test-key');
  });

  it('rejects impossible dates before calling a provider', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/trains/12919/live?date=2026-02-30',
    });
    expect(response.statusCode).toBe(400);
  });

  it('publishes provider metrics in Prometheus text format', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('railgrid_train_data_requests_total');
    expect(response.body).toContain('railgrid_train_data_circuit_open');
  });
});
