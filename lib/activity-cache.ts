import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getConfiguredGarminDomain,
  type ActivitySummary,
  type GarminActivitiesResult,
  type GarminTrainingLoadResult,
  type JsonValue,
  type TrainingLoadSummary,
} from "@/lib/garmin";

type ActivityRow = {
  activity_id: number;
  activity_name: string;
  activity_type: string;
  start_time_local: string;
  distance_meters: number;
  duration_seconds: number;
  moving_duration_seconds: number;
  elevation_gain_meters: number;
  calories: number;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  average_speed_meters_per_second: number | null;
  location_name: string | null;
};

type SyncRunRow = {
  id: number;
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { lastInsertRowid: number | bigint };
  };
};

const DEFAULT_DB_PATH = ".data/garmin.sqlite";
const RUNNING_SYNC_STALE_MS = 6 * 60 * 60 * 1000;

let db: SqliteDatabase | undefined;

export function getActivityCacheDb() {
  if (!db) {
    const dbPath = getDatabasePath();
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath) as SqliteDatabase;
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
  }

  return db;
}

function getDatabasePath() {
  if (process.env.GARMIN_DB_PATH) {
    return resolve(/* turbopackIgnore: true */ process.env.GARMIN_DB_PATH);
  }

  return join(process.cwd(), DEFAULT_DB_PATH);
}

export function ensureActivityCacheSchema() {
  const database = getActivityCacheDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      activity_id INTEGER PRIMARY KEY,
      activity_name TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      start_time_local TEXT NOT NULL,
      distance_meters REAL NOT NULL,
      duration_seconds REAL NOT NULL,
      moving_duration_seconds REAL NOT NULL,
      elevation_gain_meters REAL NOT NULL,
      calories REAL NOT NULL,
      average_heart_rate REAL,
      max_heart_rate REAL,
      average_speed_meters_per_second REAL,
      location_name TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activities_start_time_local
      ON activities (start_time_local DESC);

    CREATE INDEX IF NOT EXISTS idx_activities_type_start_time_local
      ON activities (activity_type, start_time_local DESC);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_runs_status_started_at
      ON sync_runs (status, started_at);

    CREATE TABLE IF NOT EXISTS training_load_cache (
      cache_date TEXT PRIMARY KEY,
      current_load REAL,
      chronic_load REAL,
      load_ratio REAL,
      load_trend TEXT,
      training_status TEXT,
      vo2_max REAL,
      aerobic_low REAL,
      aerobic_high REAL,
      anaerobic REAL,
      raw_data TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      domain TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_training_load_cache_fetched_at
      ON training_load_cache (fetched_at DESC);
  `);
}

export function getCachedActivities(
  start: number,
  limit: number,
): GarminActivitiesResult {
  ensureActivityCacheSchema();

  const activities = getActivityCacheDb()
    .prepare(
      `
      SELECT *
      FROM activities
      ORDER BY start_time_local DESC, activity_id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(limit, start)
    .map(toActivitySummary);

  return {
    activities,
    fetchedAt: getCacheFetchedAt(),
    start,
    limit,
    domain: getConfiguredGarminDomain(),
  };
}

export function getCachedCurrentMonthRunningActivities(): GarminActivitiesResult {
  ensureActivityCacheSchema();

  const { startKey, endKey } = getCurrentMonthBounds();
  const activities = getActivityCacheDb()
    .prepare(
      `
      SELECT *
      FROM activities
      WHERE lower(activity_type) LIKE '%running%'
        AND start_time_local >= ?
        AND start_time_local < ?
      ORDER BY start_time_local DESC, activity_id DESC
    `,
    )
    .all(startKey, endKey)
    .map(toActivitySummary);

  return {
    activities,
    fetchedAt: getCacheFetchedAt(),
    start: 0,
    limit: activities.length,
    domain: getConfiguredGarminDomain(),
  };
}

export function getCachedYearlyRunningStats() {
  ensureActivityCacheSchema();

  const rows = getActivityCacheDb()
    .prepare(
      `
      SELECT
        substr(start_time_local, 1, 4) AS year,
        SUM(distance_meters) / 1000.0 AS distance_km,
        SUM(moving_duration_seconds) AS total_seconds
      FROM activities
      WHERE lower(activity_type) LIKE '%running%'
      GROUP BY substr(start_time_local, 1, 4)
      ORDER BY year DESC
    `,
    )
    .all() as { year: string; distance_km: number; total_seconds: number }[];

  return {
    yearly: rows.map((r) => {
      const distanceKm = Math.round(r.distance_km * 100) / 100;
      const totalHours = Math.round((r.total_seconds / 3600) * 100) / 100;
      const paceMinPerKm =
        distanceKm > 0
          ? Math.round(((r.total_seconds / 60) / distanceKm) * 100) / 100
          : 0;

      return {
        year: Number(r.year),
        distanceKm,
        totalHours,
        paceMinPerKm,
      };
    }),
    fetchedAt: getCacheFetchedAt(),
    domain: getConfiguredGarminDomain(),
  };
}

export function upsertCachedActivities(activities: ActivitySummary[]) {
  ensureActivityCacheSchema();

  const syncedAt = new Date().toISOString();
  const statement = getActivityCacheDb().prepare(`
    INSERT INTO activities (
      activity_id,
      activity_name,
      activity_type,
      start_time_local,
      distance_meters,
      duration_seconds,
      moving_duration_seconds,
      elevation_gain_meters,
      calories,
      average_heart_rate,
      max_heart_rate,
      average_speed_meters_per_second,
      location_name,
      synced_at
    ) VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
    )
    ON CONFLICT(activity_id) DO UPDATE SET
      activity_name = excluded.activity_name,
      activity_type = excluded.activity_type,
      start_time_local = excluded.start_time_local,
      distance_meters = excluded.distance_meters,
      duration_seconds = excluded.duration_seconds,
      moving_duration_seconds = excluded.moving_duration_seconds,
      elevation_gain_meters = excluded.elevation_gain_meters,
      calories = excluded.calories,
      average_heart_rate = excluded.average_heart_rate,
      max_heart_rate = excluded.max_heart_rate,
      average_speed_meters_per_second = excluded.average_speed_meters_per_second,
      location_name = excluded.location_name,
      synced_at = excluded.synced_at
  `);

  const database = getActivityCacheDb();

  database.exec("BEGIN");

  try {
    for (const activity of activities) {
      statement.run(
        activity.activityId,
        activity.activityName,
        activity.activityType,
        activity.startTimeLocal,
        activity.distanceMeters,
        activity.durationSeconds,
        activity.movingDurationSeconds,
        activity.elevationGainMeters,
        activity.calories,
        activity.averageHeartRate,
        activity.maxHeartRate,
        activity.averageSpeedMetersPerSecond,
        activity.locationName,
        syncedAt,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function hasCachedActivities() {
  ensureActivityCacheSchema();

  const row = getActivityCacheDb()
    .prepare("SELECT COUNT(*) AS count FROM activities")
    .get() as { count: number };

  return row.count > 0;
}

export function hasCachedActivity(activityId: number) {
  ensureActivityCacheSchema();

  const row = getActivityCacheDb()
    .prepare("SELECT 1 FROM activities WHERE activity_id = ?")
    .get(activityId);

  return Boolean(row);
}

export function beginActivitySyncRun(kind: string) {
  ensureActivityCacheSchema();
  failStaleSyncRuns();

  const database = getActivityCacheDb();

  database.exec("BEGIN");

  try {
    const running = getActivityCacheDb()
      .prepare("SELECT id FROM sync_runs WHERE status = 'running' LIMIT 1")
      .get() as SyncRunRow | undefined;

    if (running) {
      database.exec("COMMIT");
      return undefined;
    }

    const result = getActivityCacheDb()
      .prepare(
        `
        INSERT INTO sync_runs (kind, status, started_at)
        VALUES (?, 'running', ?)
      `,
      )
      .run(kind, new Date().toISOString());

    database.exec("COMMIT");

    return Number(result.lastInsertRowid);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function finishActivitySyncRun(
  syncRunId: number,
  status: "success" | "failed",
  error?: string,
) {
  ensureActivityCacheSchema();

  getActivityCacheDb()
    .prepare(
      `
      UPDATE sync_runs
      SET status = ?, finished_at = ?, error = ?
      WHERE id = ?
    `,
    )
    .run(status, new Date().toISOString(), error ?? null, syncRunId);
}

function failStaleSyncRuns() {
  const staleBefore = new Date(Date.now() - RUNNING_SYNC_STALE_MS).toISOString();

  getActivityCacheDb()
    .prepare(
      `
      UPDATE sync_runs
      SET status = 'failed',
        finished_at = ?,
        error = 'Sync run was marked stale after server restart or timeout.'
      WHERE status = 'running'
        AND started_at < ?
    `,
    )
    .run(new Date().toISOString(), staleBefore);
}

function getCacheFetchedAt() {
  const row = getActivityCacheDb()
    .prepare("SELECT MAX(synced_at) AS fetchedAt FROM activities")
    .get() as { fetchedAt: string | null };

  return row.fetchedAt ?? new Date().toISOString();
}

function getCurrentMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    startKey: toLocalDateKey(start),
    endKey: toLocalDateKey(end),
  };
}

function toLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function toActivitySummary(row: unknown) {
  const activity = row as ActivityRow;

  return {
    activityId: activity.activity_id,
    activityName: activity.activity_name,
    activityType: activity.activity_type,
    startTimeLocal: activity.start_time_local,
    distanceMeters: activity.distance_meters,
    durationSeconds: activity.duration_seconds,
    movingDurationSeconds: activity.moving_duration_seconds,
    elevationGainMeters: activity.elevation_gain_meters,
    calories: activity.calories,
    averageHeartRate: activity.average_heart_rate,
    maxHeartRate: activity.max_heart_rate,
    averageSpeedMetersPerSecond: activity.average_speed_meters_per_second,
    locationName: activity.location_name,
  };
}

// --- Training load cache ---

const TRAINING_LOAD_TTL_MS = 30 * 60 * 1000; // 30 minutes

type TrainingLoadCacheRow = {
  cache_date: string;
  current_load: number | null;
  chronic_load: number | null;
  load_ratio: number | null;
  load_trend: string | null;
  training_status: string | null;
  vo2_max: number | null;
  aerobic_low: number | null;
  aerobic_high: number | null;
  anaerobic: number | null;
  raw_data: string;
  fetched_at: string;
  domain: string;
};

export function getCachedTrainingLoad(
  date: string,
): GarminTrainingLoadResult | null {
  ensureActivityCacheSchema();

  const row = getActivityCacheDb()
    .prepare("SELECT * FROM training_load_cache WHERE cache_date = ?")
    .get(date) as TrainingLoadCacheRow | undefined;

  if (!row) {
    return null;
  }

  return {
    date: row.cache_date,
    fetchedAt: row.fetched_at,
    domain: row.domain as "garmin.com" | "garmin.cn",
    summary: {
      currentLoad: row.current_load,
      chronicLoad: row.chronic_load,
      loadRatio: row.load_ratio,
      loadTrend: row.load_trend,
      trainingStatus: row.training_status,
      vo2Max: row.vo2_max,
      aerobicLow: row.aerobic_low,
      aerobicHigh: row.aerobic_high,
      anaerobic: row.anaerobic,
    },
    data: JSON.parse(row.raw_data) as JsonValue,
  };
}

export function isTrainingLoadCacheStale(date: string): boolean {
  ensureActivityCacheSchema();

  const row = getActivityCacheDb()
    .prepare("SELECT fetched_at FROM training_load_cache WHERE cache_date = ?")
    .get(date) as { fetched_at: string } | undefined;

  if (!row) {
    return true;
  }

  return Date.now() - new Date(row.fetched_at).getTime() > TRAINING_LOAD_TTL_MS;
}

export function upsertCachedTrainingLoad(result: GarminTrainingLoadResult) {
  ensureActivityCacheSchema();

  getActivityCacheDb()
    .prepare(
      `
      INSERT INTO training_load_cache (
        cache_date, current_load, chronic_load, load_ratio, load_trend,
        training_status, vo2_max, aerobic_low, aerobic_high, anaerobic,
        raw_data, fetched_at, domain
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_date) DO UPDATE SET
        current_load = excluded.current_load,
        chronic_load = excluded.chronic_load,
        load_ratio = excluded.load_ratio,
        load_trend = excluded.load_trend,
        training_status = excluded.training_status,
        vo2_max = excluded.vo2_max,
        aerobic_low = excluded.aerobic_low,
        aerobic_high = excluded.aerobic_high,
        anaerobic = excluded.anaerobic,
        raw_data = excluded.raw_data,
        fetched_at = excluded.fetched_at,
        domain = excluded.domain
    `,
    )
    .run(
      result.date,
      result.summary.currentLoad,
      result.summary.chronicLoad,
      result.summary.loadRatio,
      result.summary.loadTrend,
      result.summary.trainingStatus,
      result.summary.vo2Max,
      result.summary.aerobicLow,
      result.summary.aerobicHigh,
      result.summary.anaerobic,
      JSON.stringify(result.data),
      result.fetchedAt,
      result.domain,
    );
}
