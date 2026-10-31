import * as mysql from 'mysql2';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../src/database';

// Use the installed driver's real queues, release method and timer, with socket-free
// connection stand-ins. No DataSource is initialized and no database is contacted.
describe('MySQL pool idle cleanup', () => {
  const originalEnvironment = { NODE_ENV: process.env.NODE_ENV, DB_TYPE: process.env.DB_TYPE };
  let pool: any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    process.env.NODE_ENV = 'production';
    process.env.DB_TYPE = 'mysql';
  });

  afterEach(() => {
    pool?.end();
    pool = undefined;
    jest.useRealTimers();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function configuredPool() {
    const options = {
      ...createDataSourceOptions(),
      host: '127.0.0.1', port: 1, username: 'isolated-pool-test', password: '', database: 'isolated_test',
    };
    const source = new DataSource(options as ConstructorParameters<typeof DataSource>[0]);
    const driver = source.driver as any;
    // This is the exact TypeORM merge used immediately before mysql2.createPool.
    return mysql.createPool(driver.createConnectionOptions(source.options, source.options));
  }

  function connection() {
    const prototype = (mysql as any).PoolConnection.prototype;
    const value: any = {
      _pool: pool, _released: false, lastActiveTime: Date.now(),
      release: prototype.release,
      destroy: jest.fn(function (this: any) { prototype._removeFromPool.call(this); }),
      _realEnd: (callback: (error?: Error) => void) => callback(),
    };
    pool._allConnections.push(value);
    return value;
  }

  it('passes the production settings through TypeORM into the actual mysql2 pool', () => {
    pool = configuredPool();
    expect(pool.config.connectionLimit).toBe(5);
    expect(pool.config.maxIdle).toBe(1);
    expect(pool.config.idleTimeout).toBe(60_000);
    expect(pool.config.connectionConfig.connectTimeout).toBe(20_000);
    expect(pool._allConnections.length).toBe(0);
    expect(pool._removeIdleTimeoutConnectionsTimer).toBeDefined();
  });

  it('reclaims every idle connection while leaving acquired connections intact until released', () => {
    pool = configuredPool();
    const active = connection();
    const released = [connection(), connection(), connection()];
    released.forEach((value) => value.release());

    jest.advanceTimersByTime(1_000);
    expect(released[0].destroy).toHaveBeenCalledTimes(1);
    expect(released[1].destroy).toHaveBeenCalledTimes(1);
    expect(released[2].destroy).not.toHaveBeenCalled();
    expect(pool._freeConnections.length).toBe(1);

    let acquired: any;
    pool.getConnection((error: Error | null, value: any) => {
      expect(error).toBeNull();
      acquired = value;
    });
    jest.runAllTicks();
    expect(acquired).toBe(released[2]);
    expect(pool._freeConnections.length).toBe(0);

    jest.advanceTimersByTime(61_000);
    expect(active.destroy).not.toHaveBeenCalled();
    expect(acquired.destroy).not.toHaveBeenCalled();

    acquired.release();
    jest.advanceTimersByTime(60_000);
    expect(acquired.destroy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(acquired.destroy).toHaveBeenCalledTimes(1);
    expect(pool._freeConnections.length).toBe(0);
    expect(pool._allConnections.length).toBe(1);
    expect(active.destroy).not.toHaveBeenCalled();

    active.release();
    jest.advanceTimersByTime(61_000);
    expect(active.destroy).toHaveBeenCalledTimes(1);
    expect(pool._allConnections.length).toBe(0);
  });

  it('keeps development and test SQLite configuration free of MySQL pool settings', () => {
    process.env.NODE_ENV = 'development';
    process.env.DB_TYPE = 'sqljs';
    const development = createDataSourceOptions();
    expect(development.type).toBe('sqljs');
    expect(development).not.toHaveProperty('extra');
    expect(development).not.toHaveProperty('connectTimeout');

    process.env.NODE_ENV = 'test';
    process.env.DB_TYPE = 'mysql';
    const isolatedTest = createDataSourceOptions();
    expect(isolatedTest).toMatchObject({ type: 'sqljs', autoSave: false, synchronize: true, dropSchema: true });
    expect(isolatedTest).not.toHaveProperty('extra');
    expect(isolatedTest).not.toHaveProperty('connectTimeout');
  });
});
