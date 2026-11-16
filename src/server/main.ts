import { loadConfig, loadDotEnv } from './config';
import { buildApp } from './app';
import { closeContext, createContext } from './ctx';
import { createWorker, startScheduler } from './worker/handlers';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const ctx = await createContext({ config });
  const app = await buildApp(ctx);

  const worker = config.workerEnabled ? createWorker(ctx) : null;
  const scheduler = config.workerEnabled ? startScheduler(ctx) : null;
  if (worker) worker.start();

  const shutdown = async (signal: string) => {
    ctx.log.info({ signal }, 'shutting down');
    scheduler?.stop();
    try {
      await app.close();
    } catch {
      // ignore
    }
    await worker?.stop();
    closeContext(ctx);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
    ctx.log.info(
      {
        url: `http://${config.host}:${config.port}`,
        dataDir: config.dataDir,
        worker: config.workerEnabled,
        env: config.env,
      },
      'Loom is running',
    );
    if (config.workerEnabled) {
      ctx.log.info({ registered: worker?.status().registered }, 'worker started');
    }
  } catch (error) {
    ctx.log.error({ error }, 'failed to start server');
    closeContext(ctx);
    process.exit(1);
  }
}

void main();
