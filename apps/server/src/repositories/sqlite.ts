import Database from 'better-sqlite3';

export class SqliteDatabase {
  readonly connection: Database.Database;

  constructor(databasePath: string) {
    this.connection = new Database(databasePath);
    this.connection.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        status TEXT NOT NULL,
        script_json TEXT,
        script_metadata_json TEXT,
        review_json TEXT,
        publication_json TEXT NOT NULL DEFAULT '[]',
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_connections (
        platform TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduler_runs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        created_job_id TEXT,
        error_message TEXT,
        next_retry_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(profile_id, scheduled_for)
      );

      CREATE TABLE IF NOT EXISTS scheduler_state (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduler_profile_state (
        profile_id TEXT PRIMARY KEY,
        resume_from TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.ensureColumn('jobs', 'script_metadata_json', 'TEXT');
  }

  close(): void {
    this.connection.close();
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.connection.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name: string;
    }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.connection.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
