import { createApp } from './app.js';
import { config } from './config.js';
import { getDb, closeDb } from './db.js';

getDb(); // ensure schema + default admin

const app = createApp();
const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[crm] Listening on http://localhost:${config.port} (env: ${config.env})`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[crm] ${signal} received, shutting down…`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
