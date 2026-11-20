import { migrateSqliteToPg } from './migrate-sqlite-to-pg.js';

export interface MigrationOptions {
  dataDir?: string;
  sqlitePath?: string;
  pgUrl?: string;
  pgPool?: any;
}

export interface MigrationSummary {
  totalTables: number;
  migratedTables: number;
  totalRows: number;
  errors: Array<{ table: string; error: string }>;
}

export { migrateSqliteToPg };

if (typeof require !== 'undefined' && require.main === module) {
  migrateSqliteToPg()
    .then((res: MigrationSummary) => {
      if (res.errors.length > 0) process.exit(1);
      process.exit(0);
    })
    .catch((err: any) => {
      console.error('[migrate-to-pg] Unhandled error:', err);
      process.exit(1);
    });
}
