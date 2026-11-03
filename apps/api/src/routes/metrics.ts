import { FastifyInstance } from 'fastify';
import { getTrainDataMetrics } from '../train-data/metrics.js';

export async function metricsRoutes(app: FastifyInstance) {
  // Prometheus-compatible metrics endpoint (placeholder - will be enhanced with real metrics)
  app.get('/metrics', async (_request, reply) => {
    const trainData = getTrainDataMetrics();
    const metrics = [
      `# HELP railgrid_info RailGrid application info`,
      `# TYPE railgrid_info gauge`,
      `railgrid_info{version="0.0.1",node_env="${app.env.NODE_ENV}"} 1`,
      `# HELP process_uptime_seconds Process uptime in seconds`,
      `# TYPE process_uptime_seconds gauge`,
      `process_uptime_seconds ${process.uptime().toFixed(3)}`,
      `# HELP railgrid_train_data_requests_total Outbound train-data provider requests`,
      `# TYPE railgrid_train_data_requests_total counter`,
      `railgrid_train_data_requests_total{provider="${app.env.TRAIN_DATA_PROVIDER}"} ${trainData.requests}`,
      `# HELP railgrid_train_data_failures_total Failed train-data provider requests`,
      `# TYPE railgrid_train_data_failures_total counter`,
      `railgrid_train_data_failures_total{provider="${app.env.TRAIN_DATA_PROVIDER}"} ${trainData.failures}`,
      `# HELP railgrid_train_data_cache_hits_total Train-data cache hits`,
      `# TYPE railgrid_train_data_cache_hits_total counter`,
      `railgrid_train_data_cache_hits_total ${trainData.cacheHits}`,
      `# HELP railgrid_train_data_stale_responses_total Stale train-data responses served`,
      `# TYPE railgrid_train_data_stale_responses_total counter`,
      `railgrid_train_data_stale_responses_total ${trainData.staleResponses}`,
      `# HELP railgrid_train_data_quota_blocked_total Calls blocked by the provider quota guard`,
      `# TYPE railgrid_train_data_quota_blocked_total counter`,
      `railgrid_train_data_quota_blocked_total ${trainData.quotaBlocked}`,
      `# HELP railgrid_train_data_latency_ms_total Total provider request latency in milliseconds`,
      `# TYPE railgrid_train_data_latency_ms_total counter`,
      `railgrid_train_data_latency_ms_total ${trainData.latencyMsTotal}`,
      `# HELP railgrid_train_data_circuit_open Whether the process-local provider circuit is open`,
      `# TYPE railgrid_train_data_circuit_open gauge`,
      `railgrid_train_data_circuit_open ${trainData.circuitOpen ? 1 : 0}`,
    ].join('\n');

    return reply.status(200).header('content-type', 'text/plain; version=0.0.4').send(metrics);
  });
}
