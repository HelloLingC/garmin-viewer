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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type TrainingLoadSummary = {
  currentLoad: number | null;
  chronicLoad: number | null;
  loadRatio: number | null;
  loadTrend: string | null;
  trainingStatus: string | null;
  vo2Max: number | null;
  aerobicLow: number | null;
  aerobicHigh: number | null;
  anaerobic: number | null;
};

export type GarminTrainingLoadResult = {
  date: string;
  fetchedAt: string;
  domain: GarminDomain;
  summary: TrainingLoadSummary;
  data: JsonValue;
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
  const domain = getConfiguredGarminDomain();
  const client = await createGarminClient(domain);

  const activities = await client.getActivities(start, limit);

  return {
    activities: activities.map(toActivitySummary),
    fetchedAt: new Date().toISOString(),
    start,
    limit,
    domain,
  };
}

export async function getGarminTrainingLoad(
  date = getGarminDateString(new Date()),
): Promise<GarminTrainingLoadResult> {
  const domain = getConfiguredGarminDomain();
  const client = await createGarminClient(domain);
  const normalizedDate = parseGarminDate(date);
  const data = await client.get<JsonValue>(
    `https://connectapi.${domain}/metrics-service/metrics/trainingstatus/aggregated/${normalizedDate}`,
  );

  return {
    date: normalizedDate,
    fetchedAt: new Date().toISOString(),
    domain,
    summary: summarizeTrainingLoad(data),
    data,
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

export function parseTrainingLoadDate(
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  const rawValue = getSearchParam(searchParams, "date");
  return parseGarminDate(rawValue ?? getGarminDateString(new Date()));
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

function getSearchParam(
  searchParams:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | undefined,
  key: string,
) {
  if (!searchParams) {
    return undefined;
  }

  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key) ?? undefined;
  }

  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

async function createGarminClient(domain: GarminDomain) {
  const username = process.env.GARMIN_USERNAME;
  const password = process.env.GARMIN_PASSWORD;

  if (!username || !password) {
    throw new GarminConfigurationError(
      "Set GARMIN_USERNAME and GARMIN_PASSWORD before fetching Garmin Connect data.",
    );
  }

  const client = new GarminConnect({ username, password }, domain);

  await client.login();

  return client;
}

function parseGarminDate(value: string) {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  throw new GarminConfigurationError(
    'Training load date must use "YYYY-MM-DD" format.',
  );
}

function getGarminDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function summarizeTrainingLoad(data: JsonValue): TrainingLoadSummary {
  return {
    currentLoad: findNumericValue(data, [
      "dailyTrainingLoadAcute",
      "currentTrainingLoad",
      "acuteTrainingLoad",
      "trainingLoad",
      "load",
    ]),
    chronicLoad: findNumericValue(data, [
      "dailyTrainingLoadChronic",
      "chronicTrainingLoad",
    ]),
    loadRatio: findNumericValue(data, [
      "dailyAcuteChronicWorkloadRatio",
      "loadRatio",
      "trainingLoadRatio",
      "acuteChronicWorkloadRatio",
    ]),
    loadTrend: findStringValue(data, [
      "acwrStatus",
      "loadTrend",
      "trainingLoadTrend",
      "trend",
    ]),
    trainingStatus: mapTrainingStatusLabel(
      findStringValue(data, [
        "trainingStatusFeedbackPhrase",
        "trainingStatus",
        "status",
      ]),
    ),
    vo2Max: findNumericValue(data, [
      "vo2MaxPreciseValue",
      "vo2MaxValue",
    ]),
    aerobicLow: findNumericValue(data, [
      "monthlyLoadAerobicLow",
    ]),
    aerobicHigh: findNumericValue(data, [
      "monthlyLoadAerobicHigh",
    ]),
    anaerobic: findNumericValue(data, [
      "monthlyLoadAnaerobic",
    ]),
  };
}

function findNumericValue(data: JsonValue, keys: string[]) {
  const value = findValueByKey(data, keys);
  return coerceFiniteNumber(value);
}

function findStringValue(data: JsonValue, keys: string[]) {
  const value = findValueByKey(data, keys);
  return coerceNonEmptyString(value);
}

function findValueByKey(data: JsonValue, keys: string[]): JsonValue | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findValueByKey(item, keys);

      if (result !== undefined) {
        return result;
      }
    }

    return undefined;
  }

  const keySet = new Set(keys);
  const lowerKeySet = new Set(keys.map((key) => key.toLowerCase()));
  const record = data as Record<string, JsonValue>;

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return record[key];
    }
  }

  const keyValuePairKeyFields = [
    "key",
    "name",
    "type",
    "metric",
    "metricType",
    "statKey",
    "metricKey",
  ];
  const keyValuePairValueFields = [
    "value",
    "val",
    "amount",
    "data",
    "result",
    "rawValue",
  ];

  for (const keyField of keyValuePairKeyFields) {
    const candidateKey = record[keyField];

    if (typeof candidateKey !== "string") {
      continue;
    }

    const trimmedKey = candidateKey.trim();
    const lowerTrimmedKey = trimmedKey.toLowerCase();

    if (!keySet.has(trimmedKey) && !lowerKeySet.has(lowerTrimmedKey)) {
      continue;
    }

    for (const valueField of keyValuePairValueFields) {
      if (Object.prototype.hasOwnProperty.call(record, valueField)) {
        return record[valueField];
      }
    }
  }

  for (const value of Object.values(data)) {
    const result = findValueByKey(value, keys);

    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}

function coerceFiniteNumber(value: JsonValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().replaceAll(",", "");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = coerceFiniteNumber(entry);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  const record = value as Record<string, JsonValue>;
  const candidateFields = [
    "value",
    "val",
    "amount",
    "rawValue",
    "current",
    "numericValue",
  ];

  for (const field of candidateFields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      const parsed = coerceFiniteNumber(record[field]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

const TRAINING_STATUS_LABELS: Record<number, string> = {
  0: "Detraining",
  1: "Peaking",
  2: "Unproductive",
  3: "Maintaining",
  4: "Productive",
  5: "Recovery",
  6: "No Status",
  7: "High Training Load",
  8: "Low Training Load",
  9: "Optimal",
};

const TRAINING_STATUS_PHRASES: Record<string, string> = {
  DETRAINING: "Detraining",
  PEAKING: "Peaking",
  UNPRODUCTIVE: "Unproductive",
  MAINTAINING: "Maintaining",
  PRODUCTIVE: "Productive",
  RECOVERY: "Recovery",
  NO_STATUS: "No Status",
  HIGH_TRAINING_LOAD: "High Training Load",
  LOW_TRAINING_LOAD: "Low Training Load",
  OPTIMAL: "Optimal",
  AEROBIC_LOW_SHORTAGE: "Aerobic Low Shortage",
  AEROBIC_HIGH_SHORTAGE: "Aerobic High Shortage",
  ANAEROBIC_SHORTAGE: "Anaerobic Shortage",
};

function mapTrainingStatusLabel(value: string | null): string | null {
  if (value === null) return null;

  // Handle numeric status codes (e.g. "5")
  const numericValue = Number.parseInt(value, 10);
  if (Number.isFinite(numericValue) && numericValue in TRAINING_STATUS_LABELS) {
    return TRAINING_STATUS_LABELS[numericValue];
  }

  // Handle phrase format like "RECOVERY_2" → extract base status
  const basePhrase = value.replace(/_\d+$/, "");
  if (basePhrase in TRAINING_STATUS_PHRASES) {
    return TRAINING_STATUS_PHRASES[basePhrase];
  }

  // Fallback: convert SNAKE_CASE to Title Case
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function coerceNonEmptyString(value: JsonValue | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = coerceNonEmptyString(entry);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  const record = value as Record<string, JsonValue>;
  const candidateFields = ["value", "label", "name", "display", "text", "phrase"];

  for (const field of candidateFields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      const parsed = coerceNonEmptyString(record[field]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
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
