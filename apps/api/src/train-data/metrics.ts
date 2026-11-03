type ProviderMetrics = {
  requests: number;
  failures: number;
  cacheHits: number;
  staleResponses: number;
  quotaBlocked: number;
  latencyMsTotal: number;
  circuitOpen: boolean;
};

const metrics: ProviderMetrics = {
  requests: 0,
  failures: 0,
  cacheHits: 0,
  staleResponses: 0,
  quotaBlocked: 0,
  latencyMsTotal: 0,
  circuitOpen: false,
};

export function updateTrainDataMetrics(update: Partial<ProviderMetrics>): void {
  Object.assign(metrics, update);
}

export function incrementTrainDataMetric(key: 'requests' | 'failures' | 'cacheHits' | 'staleResponses' | 'quotaBlocked'): void {
  metrics[key] += 1;
}

export function addTrainDataLatency(milliseconds: number): void {
  metrics.latencyMsTotal += milliseconds;
}

export function getTrainDataMetrics(): Readonly<ProviderMetrics> {
  return { ...metrics };
}
