import {
  ensureActivityCacheSchema,
  hasCachedActivities,
  isTrainingLoadCacheStale,
  upsertCachedTrainingLoad,
} from "@/lib/activity-cache";
import { syncActivitiesInBackground } from "@/lib/activity-sync";
import { getGarminTrainingLoad } from "@/lib/garmin";

const DEFAULT_SYNC_TIME = "04:00";

let schedulerStarted = false;
let timer: NodeJS.Timeout | undefined;

export function startActivitySyncScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  ensureActivityCacheSchema();

  if (!hasCachedActivities()) {
    syncActivitiesInBackground("initial");
  }

  scheduleNextDailySync();
}

function scheduleNextDailySync() {
  const delay = getNextSyncDelayMs();

  timer = setTimeout(() => {
    syncActivitiesInBackground("daily");
    syncTrainingLoadInBackground();
    scheduleNextDailySync();
  }, delay);

  timer.unref?.();
}

function getNextSyncDelayMs() {
  const now = new Date();
  const { hours, minutes } = parseSyncTime();
  const next = new Date(now);

  next.setHours(hours, minutes, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function parseSyncTime() {
  const value = process.env.GARMIN_SYNC_TIME?.trim() || DEFAULT_SYNC_TIME;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);

  if (!match) {
    return { hours: 4, minutes: 0 };
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  if (hours > 23 || minutes > 59) {
    return { hours: 4, minutes: 0 };
  }

  return { hours, minutes };
}

function syncTrainingLoadInBackground() {
  const today = getLocalDateString(new Date());

  if (!isTrainingLoadCacheStale(today)) {
    return;
  }

  getGarminTrainingLoad(today)
    .then((result) => {
      upsertCachedTrainingLoad(result);
    })
    .catch((error) => {
      console.error("Training load sync failed", error);
    });
}

function getLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
