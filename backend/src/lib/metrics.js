/**
 * In-memory HTTP metrics (Prometheus text exposition, no prom-client).
 */

/** @type {Map<string, number>} */
const httpRequestsTotal = new Map();

let httpRequestDurationMsSum = 0;
let httpRequestDurationMsCount = 0;

function counterKey(method, status) {
  return `${String(method || 'GET').toUpperCase()}|${Number(status) || 0}`;
}

function observeHttp(method, status, ms) {
  const key = counterKey(method, status);
  httpRequestsTotal.set(key, (httpRequestsTotal.get(key) || 0) + 1);
  const duration = Number(ms);
  if (Number.isFinite(duration) && duration >= 0) {
    httpRequestDurationMsSum += duration;
    httpRequestDurationMsCount += 1;
  }
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderPrometheus() {
  const lines = [];

  lines.push('# HELP http_requests_total Total HTTP API requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, count] of httpRequestsTotal.entries()) {
    const [method, status] = key.split('|');
    lines.push(`http_requests_total{method="${escapeLabel(method)}",status="${escapeLabel(status)}"} ${count}`);
  }

  lines.push('# HELP http_request_duration_ms HTTP request duration in milliseconds');
  lines.push('# TYPE http_request_duration_ms summary');
  lines.push(`http_request_duration_ms_sum ${httpRequestDurationMsSum}`);
  lines.push(`http_request_duration_ms_count ${httpRequestDurationMsCount}`);

  return `${lines.join('\n')}\n`;
}

module.exports = {
  observeHttp,
  renderPrometheus,
};
