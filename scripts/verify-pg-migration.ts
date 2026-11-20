import { verifyPgMigration } from './verify-pg-migration.js';

export interface VerifyOptions {
  dataDir?: string;
  sqlitePath?: string;
  pgUrl?: string;
  pgPool?: any;
}

export interface VerifyReport {
  totalTables: number;
  passedTables: number;
  failedTables: number;
  diffs: Array<{ table: string; error?: string; reason?: string }>;
  details: Array<{ table: string; sqliteCount: number; pgCount: number; passed: boolean }>;
}

export { verifyPgMigration };

if (typeof require !== 'undefined' && require.main === module) {
  verifyPgMigration()
    .then((res: VerifyReport) => {
      if (res.failedTables > 0) process.exit(1);
      process.exit(0);
    })
    .catch((err: any) => {
      console.error('[verify-pg] Unhandled error:', err);
      process.exit(1);
    });
}
