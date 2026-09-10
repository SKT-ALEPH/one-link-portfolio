import { createApp } from './app.mjs';
const port = Number(process.env.PORT || 3000);
const server = createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Portfolio server listening on ${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
