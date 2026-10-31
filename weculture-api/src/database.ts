import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { isProduction, isTest } from './config';
import { InitialSchema1789560000000 } from './migrations/1789560000000-InitialSchema';
import { PostSubmissionIdentity1790899200000 } from './migrations/1790899200000-PostSubmissionIdentity';
import { PostCircles1791417600000 } from './migrations/1791417600000-PostCircles';
import { RoutePlanDetails1792454400000 } from './migrations/1792454400000-RoutePlanDetails';
import { PostComments1792458000000 } from './migrations/1792458000000-PostComments';
import { ContentReports1793000000000 } from './migrations/1793000000000-ContentReports';
import { FeaturedPosts1793000001000 } from './migrations/1793000001000-FeaturedPosts';
import { AnalyticsEvents1793000002000 } from './migrations/1793000002000-AnalyticsEvents';
import { EventChanges1793000003000 } from './migrations/1793000003000-EventChanges';
import { FollowsNotifications1793000004000 } from './migrations/1793000004000-FollowsNotifications';

const MIGRATIONS = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000, ContentReports1793000000000, FeaturedPosts1793000001000, AnalyticsEvents1793000002000, EventChanges1793000003000, FollowsNotifications1793000004000];

export function createDatabaseOptions(): TypeOrmModuleOptions {
  if (isTest()) {
    return { type: 'sqljs', autoSave: false, entities: ENTITIES, migrations: MIGRATIONS, synchronize: true, dropSchema: true };
  }

  if (process.env.DB_TYPE === 'mysql') {
    return {
      type: 'mysql',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      charset: 'utf8mb4',
      timezone: 'Z',
      connectTimeout: 20_000,
      // maxIdle must be below connectionLimit to enable mysql2's idle reaper.
      // It also closes the final free connection after idleTimeout; active work is untouched.
      extra: { connectionLimit: 5, maxIdle: 1, idleTimeout: 60_000 },
      entities: ENTITIES,
      migrations: MIGRATIONS,
      migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
      synchronize: false,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
    };
  }

  if (isProduction()) throw new Error('生产环境仅支持 MySQL');
  return {
    type: 'sqljs',
    location: process.env.DB_LOCATION || 'weculture.sqlite',
    autoSave: process.env.DB_AUTOSAVE !== 'false',
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
  };
}

export const createDataSourceOptions = () => createDatabaseOptions() as DataSourceOptions;
