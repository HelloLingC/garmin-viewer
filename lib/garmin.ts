import { GarminConnect } from "garmin-connect";
import type { IActivity } from "garmin-connect/dist/garmin/types/activity";
import type { GarminDomain } from "garmin-connect/dist/garmin/types";

export type ActivitySummary = {
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeLocal: string;
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number;
  elevationGainMeters: number;
  calories: number;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  averageSpeedMetersPerSecond: number | null;
  locationName: string | null;
};

export type GarminActivitiesResult = {
  activities: ActivitySummary[];
  fetchedAt: string;
  start: number;
  limit: number;
  domain: GarminDomain;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parseActivityWindow(
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  const getValue = (key: string) => {
    if (!searchParams) {
      return undefined;
    }

    if (searchParams instanceof URLSearchParams) {
      return searchParams.get(key) ?? undefined;
    }

    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return {
    start: clampInteger(getValue("start"), 0, 0, Number.MAX_SAFE_INTEGER),
    limit: clampInteger(getValue("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT),
  };
}

export async function getGarminActivities(
  start = 0,
  limit = DEFAULT_LIMIT,
): Promise<GarminActivitiesResult> {
  return fetchGarminActivitiesWindow(start, limit);
}

export async function getGarminRunningActivities(
  limit = 5,
): Promise<GarminActivitiesResult> {
  const fetchLimit = Math.min(Math.max(limit * 6, 20), MAX_LIMIT);
  const result = await fetchGarminActivitiesWindow(0, fetchLimit);

  return {
    ...result,
    activities: result.activities.filter(isRunningActivity).slice(0, limit),
    limit,
  };
}

export async function fetchGarminActivitiesWindow(
  start: number,
  limit: number,
): Promise<GarminActivitiesResult> {
  const username = process.env.GARMIN_USERNAME;
  const password = process.env.GARMIN_PASSWORD;
  const domain = getConfiguredGarminDomain();

  if (!username || !password) {
    throw new GarminConfigurationError(
      "Set GARMIN_USERNAME and GARMIN_PASSWORD before fetching Garmin activities.",
    );
  }

  const client = new GarminConnect({ username, password }, domain);

  await client.login();

  const activities = await client.getActivities(start, limit);

  return {
    activities: activities.map(toActivitySummary),
    fetchedAt: new Date().toISOString(),
    start,
    limit,
    domain,
  };
}

export class GarminConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GarminConfigurationError";
  }
}

export function getPublicGarminError(error: unknown) {
  if (error instanceof GarminConfigurationError) {
    return {
      status: 500,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      status: 502,
      message: `Garmin Connect request failed: ${error.message}`,
    };
  }

  return {
    status: 502,
    message: "Garmin Connect request failed.",
  };
}

export function toActivitySummary(activity: IActivity): ActivitySummary {
  return {
    activityId: activity.activityId,
    activityName: activity.activityName,
    activityType: activity.activityType?.typeKey ?? "unknown",
    startTimeLocal: activity.startTimeLocal,
    distanceMeters: asNumber(activity.distance),
    durationSeconds: asNumber(activity.duration),
    movingDurationSeconds: asNumber(activity.movingDuration),
    elevationGainMeters: asNumber(activity.elevationGain),
    calories: asNumber(activity.calories),
    averageHeartRate: nullableNumber(activity.averageHR),
    maxHeartRate: nullableNumber(activity.maxHR),
    averageSpeedMetersPerSecond: nullableNumber(activity.averageSpeed),
    locationName: activity.locationName || null,
  };
}

function clampInteger(
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number.parseInt(rawValue ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function asNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRunningActivity(activity: ActivitySummary) {
  return activity.activityType.toLowerCase().includes("running");
}

export function getConfiguredGarminDomain(): GarminDomain {
  const domain = process.env.GARMIN_DOMAIN?.trim() || "garmin.com";

  if (domain === "garmin.com" || domain === "garmin.cn") {
    return domain;
  }

  throw new GarminConfigurationError(
    'GARMIN_DOMAIN must be either "garmin.com" or "garmin.cn".',
  );
}
