import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  getConfiguredGarminDomain,
  type ActivitySummary,
  type GarminActivitiesResult,
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

const DEFAULT_DB_PATH = ".data/garmin.sqlite";
const RUNNING_SYNC_STALE_MS = 6 * 60 * 60 * 1000;

let db: Database.Database | undefined;

export function getActivityCacheDb() {
  if (!db) {
    const dbPath = getDatabasePath();
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
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
      @activityId,
      @activityName,
      @activityType,
      @startTimeLocal,
      @distanceMeters,
      @durationSeconds,
      @movingDurationSeconds,
      @elevationGainMeters,
      @calories,
      @averageHeartRate,
      @maxHeartRate,
      @averageSpeedMetersPerSecond,
      @locationName,
      @syncedAt
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

  const write = getActivityCacheDb().transaction((items: ActivitySummary[]) => {
    for (const activity of items) {
      statement.run({
        ...activity,
        syncedAt,
      });
    }
  });

  write(activities);
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

  const begin = getActivityCacheDb().transaction(() => {
    const running = getActivityCacheDb()
      .prepare("SELECT id FROM sync_runs WHERE status = 'running' LIMIT 1")
      .get() as SyncRunRow | undefined;

    if (running) {
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

    return Number(result.lastInsertRowid);
  });

  return begin();
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
