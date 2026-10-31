import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, UserPlan } from '../src/entities';
import { InitialSchema1789560000000 } from '../src/migrations/1789560000000-InitialSchema';
import { PostSubmissionIdentity1790899200000 } from '../src/migrations/1790899200000-PostSubmissionIdentity';
import { PostCircles1791417600000 } from '../src/migrations/1791417600000-PostCircles';
import { RoutePlanDetails1792454400000 } from '../src/migrations/1792454400000-RoutePlanDetails';

const legacyTable = () => new Table({ name: 'user_plans', columns: [
  { name: 'id', type: 'varchar', isPrimary: true }, { name: 'userId', type: 'varchar' },
  { name: 'targetType', type: 'varchar' }, { name: 'targetId', type: 'varchar' },
  { name: 'status', type: 'varchar' },
], indices: [{ name: 'IDX_legacy_plan_identity', columnNames: ['userId', 'targetType', 'targetId'], isUnique: true }] });

describe('Route plan details migration', () => {
  it('preserves legacy route/event plans with null parameters and reverts only the added columns', async () => {
    const source = await new DataSource({ type: 'sqljs' }).initialize(), runner = source.createQueryRunner();
    try {
      await runner.createTable(legacyTable());
      await runner.query('INSERT INTO user_plans VALUES (?, ?, ?, ?, ?)', ['legacy-route', 'user-a', 'route', 'route-a', 'active']);
      await runner.query('INSERT INTO user_plans VALUES (?, ?, ?, ?, ?)', ['legacy-event', 'user-b', 'event', 'event-a', 'cancelled']);
      const before = await runner.query('SELECT * FROM user_plans ORDER BY id');
      const migration = new RoutePlanDetails1792454400000();
      await migration.up(runner);
      expect(await runner.query('SELECT * FROM user_plans ORDER BY id')).toEqual(before.map((row: object) => ({ ...row, departDate: null, companions: null })));
      await runner.query('UPDATE user_plans SET departDate = ?, companions = ? WHERE id = ?', ['2028-02-29', 0, 'legacy-route']);
      await migration.up(runner);
      expect((await runner.query('SELECT departDate, companions FROM user_plans WHERE id = ?', ['legacy-route']))[0]).toEqual({ departDate: '2028-02-29', companions: 0 });
      await expect(runner.query('INSERT INTO user_plans (id, userId, targetType, targetId, status) VALUES (?, ?, ?, ?, ?)', ['duplicate', 'user-a', 'route', 'route-a', 'active'])).rejects.toThrow();
      await migration.down(runner);
      expect(await runner.query('SELECT * FROM user_plans ORDER BY id')).toEqual(before);
      expect((await runner.getTable('user_plans'))?.indices).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'IDX_legacy_plan_identity', isUnique: true })]));
      await migration.down(runner);
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts a synchronized schema and preserves parameters through the registered migration chain', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, synchronize: true, migrations: [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000] }).initialize();
    try {
      const saved = await source.getRepository(UserPlan).save({ userId: 'user-a', targetType: 'route', targetId: 'route-a', departDate: '2028-02-29', companions: 0 });
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(['InitialSchema1789560000000', 'PostSubmissionIdentity1790899200000', 'PostCircles1791417600000', 'RoutePlanDetails1792454400000']);
      expect(await source.getRepository(UserPlan).findOneByOrFail({ id: saved.id })).toMatchObject({ departDate: '2028-02-29', companions: 0, status: 'active' });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });

  it('generates reversible nullable MySQL column changes without connecting to a database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_migration_sql_only' });
    const runner = source.createQueryRunner();
    runner.loadedTables.push(legacyTable());
    // The actual MySQL driver builds SQL in memory; only schema discovery is supplied locally.
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    const migration = new RoutePlanDetails1792454400000();
    await migration.up(runner);
    expect(runner.getMemorySql().upQueries.map((query) => query.query)).toEqual([
      'ALTER TABLE `user_plans` ADD `departDate` varchar(10) NULL',
      'ALTER TABLE `user_plans` ADD `companions` int NULL',
    ]);
    runner.clearSqlMemory();
    await migration.down(runner);
    expect(runner.getMemorySql().upQueries.map((query) => query.query)).toEqual([
      'ALTER TABLE `user_plans` DROP COLUMN `departDate`',
      'ALTER TABLE `user_plans` DROP COLUMN `companions`',
    ]);
  });

  it('registers the migration for both MySQL and SQLite data source options', () => {
    const before = { NODE_ENV: process.env.NODE_ENV, DB_TYPE: process.env.DB_TYPE };
    try {
      for (const type of ['mysql', 'sqljs']) {
        process.env.NODE_ENV = 'development'; process.env.DB_TYPE = type;
        expect(createDataSourceOptions().migrations).toEqual(expect.arrayContaining([RoutePlanDetails1792454400000]));
      }
    } finally {
      for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});
