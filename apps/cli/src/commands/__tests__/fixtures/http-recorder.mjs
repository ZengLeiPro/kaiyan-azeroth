import { createServer } from 'node:http';

const calls = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    calls.push({
      method: request.method,
      url: request.url,
      body: rawBody ? JSON.parse(rawBody) : undefined,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ success: true }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  process.send?.({ type: 'ready', port: address.port });
});

process.on('message', (message) => {
  if (message?.type === 'get-calls') {
    process.send?.({ type: 'calls', calls });
  }
});

process.on('disconnect', () => server.close());
