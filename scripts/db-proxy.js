const net = require('net');
const { execSync } = require('child_process');

function getTargetIp() {
  if (process.env.TARGET_PG_HOST) {
    return process.env.TARGET_PG_HOST;
  }
  try {
    const out = execSync('wsl -e hostname -I', { encoding: 'utf8' }).trim();
    const ip = out.split(' ')[0];
    if (ip) return ip;
  } catch (err) {
    console.warn('WSL hostname -I not available, defaulting to 127.0.0.1:', err.message);
  }
  return '127.0.0.1';
}

const targetIp = getTargetIp();
console.log(`Forwarding 127.0.0.1:55432 to ${targetIp}:5432`);

const server = net.createServer((socket) => {
  const client = net.connect(5432, targetIp);
  socket.pipe(client);
  client.pipe(socket);
  socket.on('error', () => {});
  client.on('error', () => {});
});

server.listen(55432, '127.0.0.1', () => {
  console.log(`PostgreSQL proxy ready on 127.0.0.1:55432`);
});
