import { ValueTransformer } from 'typeorm';

// CURRENT_TIMESTAMP in the existing cloud MySQL database uses Beijing time.
// Its generated metadata dates need this conversion; event dates are already
// written as UTC and must retain their existing values and interpretation.
const beijingOffset = 8 * 60 * 60 * 1000;

export const databaseTimestamp: ValueTransformer = {
  from(value: Date | null) {
    return process.env.DB_TYPE === 'mysql' && value instanceof Date
      ? new Date(value.getTime() - beijingOffset) : value;
  },
  to(value: Date | null) {
    return process.env.DB_TYPE === 'mysql' && value instanceof Date
      ? new Date(value.getTime() + beijingOffset) : value;
  },
};
