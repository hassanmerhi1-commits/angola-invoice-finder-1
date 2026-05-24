/**
 * UDP LAN discovery — finds NEXOR ERP servers broadcasting on port 41234.
 */
const dgram = require('dgram');

const DISCOVERY_PORT = 41234;
const DISCOVERY_MESSAGE = 'KWANZA_ERP_DISCOVER';
const DISCOVERY_RESPONSE_PREFIX = 'KWANZA_ERP_SERVER:';

/**
 * @param {number} timeoutMs
 * @returns {Promise<Array<{ address: string; port: number; name: string; hostname?: string }>>}
 */
function scanForServers(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const servers = new Map();
    let socket;

    const finish = () => {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      resolve(Array.from(servers.values()));
    };

    const timer = setTimeout(finish, Math.max(800, timeoutMs));

    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', () => {
        clearTimeout(timer);
        finish();
      });

      socket.on('message', (msg, rinfo) => {
        const text = msg.toString();
        if (!text.startsWith(DISCOVERY_RESPONSE_PREFIX)) return;
        try {
          const payload = JSON.parse(text.slice(DISCOVERY_RESPONSE_PREFIX.length));
          const port = Number(payload?.port) || 3000;
          const key = `${rinfo.address}:${port}`;
          if (!servers.has(key)) {
            servers.set(key, {
              address: rinfo.address,
              port,
              name: String(payload?.name || 'NEXOR ERP Server'),
              hostname: payload?.hostname ? String(payload.hostname) : undefined,
            });
          }
        } catch {
          /* ignore malformed */
        }
      });

      socket.bind(() => {
        try {
          socket.setBroadcast(true);
        } catch {
          /* ignore */
        }
        const request = Buffer.from(DISCOVERY_MESSAGE);
        socket.send(request, 0, request.length, DISCOVERY_PORT, '255.255.255.255', () => {});
        // Also try subnet-directed broadcast if we can guess it
        try {
          const os = require('os');
          const ifaces = os.networkInterfaces();
          for (const list of Object.values(ifaces)) {
            for (const iface of list || []) {
              if (iface.family !== 'IPv4' || iface.internal) continue;
              const parts = iface.address.split('.').map(Number);
              if (parts.length !== 4) continue;
              const bcast = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
              socket.send(request, 0, request.length, DISCOVERY_PORT, bcast, () => {});
            }
          }
        } catch {
          /* ignore */
        }
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

module.exports = { scanForServers, DISCOVERY_PORT };
