import { Pool, PoolConfig } from 'pg';
import { config } from '../config.js';

let sharedPool: Pool | null = null;

export function getDbPool(): Pool {
  if (sharedPool) {
    return sharedPool;
  }

  const poolConfig: PoolConfig = {
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  sharedPool = new Pool(poolConfig);

  sharedPool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
  });

  return sharedPool;
}

export async function closeDbPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}
