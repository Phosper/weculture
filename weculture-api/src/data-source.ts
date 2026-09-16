import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from './database';

export default new DataSource(createDataSourceOptions());
