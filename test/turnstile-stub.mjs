import { createServer } from 'node:http';

const server = createServer((request, response) => {
	if (request.method === 'GET' && request.url === '/health') {
		response.writeHead(200);
		response.end('ok');
		return;
	}
	if (request.method !== 'POST' || request.url !== '/siteverify') {
		response.writeHead(404);
		response.end();
		return;
	}
	request.resume();
	request.on('end', () => {
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ success: true }));
	});
});

server.listen(Number(process.env.PORT || 8790), '127.0.0.1');
