import { config } from './config.js';
import { logger } from './utils/logger.js';
import { getDbPool, closeDbPool } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { createApiClient } from './api/client.js';
import { Fetcher } from './api/fetcher.js';
import { DBWriter } from './db/writer.js';
import { Pipeline } from './ingestion/pipeline.js';

async function main() {
  logger.info('Starting Data Sync Ingestion pipeline...');
  
  // 1. Init Dependencies
  const pool = getDbPool();
  
  const apiClient = createApiClient({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    streamToken: config.streamToken
  });
  
  const fetcher = new Fetcher(apiClient, !!config.streamToken);
  
  // We use batch size 5000 based on API limits
  const writer = new DBWriter(pool, config.batchSize);
  
  const pipeline = new Pipeline(fetcher, writer, pool);
  
  // 2. Setup Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    pipeline.stop();
    // In pipeline.ts, stop() will cause the next loop to end
    // and close out the writer + save cursor safely
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 3. Database Initialization
  try {
    logger.info('Running database migrations...');
    await runMigrations(pool);
    logger.info('Database migrations successful.');
  } catch (error) {
    logger.error({ err: error }, 'Run migrations failed');
    process.exit(1);
  }

  // 4. Progress Reporting
  pipeline.onProgress((summary) => {
    logger.info(summary);
  });

  // 5. Start ingestion
  try {
    logger.info('Pipeline execution started');
    await pipeline.run();
    logger.info('Pipeline execution completed cleanly.');
  } catch (error) {
    logger.error({ err: error }, 'Pipeline encountered an error');
    // We don't exit(1) immediately, allow closeDbPool to run
  } finally {
    await closeDbPool();
    logger.info('Database connections closed.');
    
    // Required exact output by assignment guidelines
    console.log('ingestion complete');
  }
}

main().catch(err => {
  logger.fatal({ err }, 'Fatal unexpected error in main process');
  process.exit(1);
});
