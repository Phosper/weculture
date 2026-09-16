import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { isProduction, isTest } from './config';
import { InitialSchema1789560000000 } from './migrations/1789560000000-InitialSchema';

export function createDatabaseOptions(): TypeOrmModuleOptions {
  if (isTest()) {
    return { type: 'sqljs', autoSave: false, entities: ENTITIES, synchronize: true, dropSchema: true };
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
      entities: ENTITIES,
      migrations: [InitialSchema1789560000000],
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
    migrations: [InitialSchema1789560000000],
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
  };
}

export const createDataSourceOptions = () => createDatabaseOptions() as DataSourceOptions;
