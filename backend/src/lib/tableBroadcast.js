/** Late-bound so jobs can tell tills to refresh without requiring server.js. */
let emit = () => {};

function setTableBroadcaster(fn) {
  emit = typeof fn === 'function' ? fn : () => {};
}

function broadcastTable(table, entityId = null) {
  try {
    emit(table, entityId);
  } catch (_) { /* socket not up */ }
}

module.exports = { setTableBroadcaster, broadcastTable };
