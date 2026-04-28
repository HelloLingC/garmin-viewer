import {
  beginActivitySyncRun,
  finishActivitySyncRun,
  hasCachedActivities,
  hasCachedActivity,
  upsertCachedActivities,
} from "@/lib/activity-cache";
import { fetchGarminActivitiesWindow } from "@/lib/garmin";

const SYNC_BATCH_SIZE = 100;
const DAILY_MAX_PAGES = 5;

export type ActivitySyncKind = "initial" | "daily" | "manual";

let activeSync: Promise<void> | undefined;

export function syncActivitiesInBackground(kind: ActivitySyncKind) {
  if (activeSync) {
    return activeSync;
  }

  activeSync = syncActivities(kind)
    .catch((error) => {
      console.error("Garmin activity sync failed", error);
    })
    .finally(() => {
      activeSync = undefined;
    });

  return activeSync;
}

export async function syncActivities(kind: ActivitySyncKind) {
  const syncRunId = beginActivitySyncRun(kind);

  if (!syncRunId) {
    return;
  }

  try {
    if (kind === "initial" || !hasCachedActivities()) {
      await backfillActivities();
    } else {
      await refreshRecentActivities();
    }

    finishActivitySyncRun(syncRunId, "success");
  } catch (error) {
    finishActivitySyncRun(syncRunId, "failed", getErrorMessage(error));
    throw error;
  }
}

async function backfillActivities() {
  let start = 0;

  while (true) {
    const result = await fetchGarminActivitiesWindow(start, SYNC_BATCH_SIZE);
    upsertCachedActivities(result.activities);

    if (result.activities.length < SYNC_BATCH_SIZE) {
      return;
    }

    start += SYNC_BATCH_SIZE;
  }
}

async function refreshRecentActivities() {
  for (let page = 0; page < DAILY_MAX_PAGES; page += 1) {
    const result = await fetchGarminActivitiesWindow(
      page * SYNC_BATCH_SIZE,
      SYNC_BATCH_SIZE,
    );

    if (result.activities.length === 0) {
      return;
    }

    const sawKnownActivity = result.activities.some((activity) =>
      hasCachedActivity(activity.activityId),
    );

    upsertCachedActivities(result.activities);

    if (result.activities.length < SYNC_BATCH_SIZE || sawKnownActivity) {
      return;
    }
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown sync error.";
}
