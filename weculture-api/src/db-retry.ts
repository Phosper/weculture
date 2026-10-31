import { Logger } from '@nestjs/common';

export function transientDatabaseDisconnect(error: unknown) {
  const failure = error as { code?: string; driverError?: { code?: string } } | null;
  const code = failure?.driverError?.code || failure?.code;
  return code === 'ECONNRESET' || code === 'PROTOCOL_CONNECTION_LOST' ? code : undefined;
}

/** Retry only a single idempotent database read, never a request or transaction. */
export class DbRetry {
  static async read<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      const code = transientDatabaseDisconnect(error);
      if (!code) throw error;
      Logger.warn(`Retrying database read after transient disconnect (${code})`, DbRetry.name);
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      return operation();
    }
  }
}
