import { createApp } from './app.js';
import { config } from './config.js';
import { ensureInitialized, closeDb } from './db.js';

await ensureInitialized();

const app = createApp();
const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[crm] Слушаю http://localhost:${config.port} (env: ${config.env})`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[crm] ${signal}, останавливаюсь…`);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
