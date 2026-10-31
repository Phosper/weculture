import { getMetadataArgsStorage } from 'typeorm';
import { databaseTimestamp } from '../src/database-timestamp';
import { Event } from '../src/entities';

describe('cloud database generated timestamps', () => {
  const originalType = process.env.DB_TYPE;
  afterEach(() => { if (originalType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = originalType; });

  it('returns the actual instant for the nova 9 post generated at 15:03 Beijing time', () => {
    process.env.DB_TYPE = 'mysql';
    const rawDriverDate = new Date('2026-10-02T15:03:45.000Z');
    expect(databaseTimestamp.from(rawDriverDate).toISOString()).toBe('2026-10-02T07:03:45.000Z');
    expect(rawDriverDate.toISOString()).toBe('2026-10-02T15:03:45.000Z');
  });

  it('round trips generated metadata across a day boundary and preserves null', () => {
    process.env.DB_TYPE = 'mysql';
    const midnight = new Date('2026-10-01T16:03:00.000Z');
    expect(databaseTimestamp.from(databaseTimestamp.to(midnight))).toEqual(midnight);
    expect(databaseTimestamp.from(null)).toBeNull();
    expect(databaseTimestamp.to(null)).toBeNull();
  });

  it('does not shift local or test database dates', () => {
    process.env.DB_TYPE = 'sqljs';
    const value = new Date('2026-10-02T07:03:45.000Z');
    expect(databaseTimestamp.from(value)).toBe(value);
    expect(databaseTimestamp.to(value)).toBe(value);
  });

  it('keeps existing event start, end and deadline UTC fields separate from generated metadata', () => {
    const columns = getMetadataArgsStorage().columns.filter(column => column.target === Event);
    for (const name of ['startsAt', 'endsAt', 'registrationDeadline']) {
      expect(columns.find(column => column.propertyName === name)?.options.transformer).toBeUndefined();
    }
    const generated = getMetadataArgsStorage().columns.filter(column => ['createdAt', 'updatedAt'].includes(column.propertyName));
    expect(generated).toHaveLength(2);
    expect(generated.every(column => column.options.transformer === databaseTimestamp)).toBe(true);
  });
});
