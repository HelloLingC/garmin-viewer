import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCachedActivities } from "@/lib/activity-cache";
import { ManualSyncSubmit } from "@/app/manual-sync-submit";
import { syncActivities } from "@/lib/activity-sync";
import {
  getConfiguredGarminDomain,
  getPublicGarminError,
  parseActivityWindow,
  type GarminActivitiesResult,
  type ActivitySummary,
} from "@/lib/garmin";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type PageActivitiesResult = GarminActivitiesResult & {
  error?: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: HomeProps) {
  await connection();

  const params = await searchParams;
  const { start, limit } = parseActivityWindow(params);
  const result = await loadActivities(start, limit);
  const syncMessage = getManualSyncMessage(params);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-300">
              Garmin Connect ({result.domain})
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Activity Data
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-neutral-300">
              Cached Garmin Connect data synced from the configured account.
            </p>
            <form action={manualSyncActivities} className="mt-5">
              <input name="start" type="hidden" value={result.start} />
              <input name="limit" type="hidden" value={result.limit} />
              <ManualSyncSubmit />
            </form>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
            <MetricCard label="Loaded" value={String(result.activities.length)} />
            <MetricCard label="Distance" value={formatTotalDistance(result.activities)} />
            <MetricCard label="Time" value={formatTotalDuration(result.activities)} />
            <MetricCard label="Calories" value={formatTotalCalories(result.activities)} />
          </div>
        </header>

        {syncMessage ? (
          <div
            className={`border p-4 text-sm ${
              syncMessage.kind === "success"
                ? "border-emerald-300/30 bg-emerald-950/40 text-emerald-100"
                : "border-red-400/30 bg-red-950/60 text-red-100"
            }`}
            role="status"
          >
            {syncMessage.message}
          </div>
        ) : null}

        {result.error ? (
          <div className="border border-red-400/30 bg-red-950/60 p-5 text-red-100">
            <h2 className="text-lg font-semibold">Unable to load activities</h2>
            <p className="mt-2 text-sm leading-6 text-red-100/85">{result.error}</p>
          </div>
        ) : (
          <div className="overflow-hidden border border-white/10 bg-neutral-900">
            <div className="flex flex-col justify-between gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Recent activities
                </h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Showing {result.start + 1} through{" "}
                  {result.start + result.activities.length}; fetched{" "}
                  {formatFetchedAt(result.fetchedAt)}
                </p>
              </div>
              <a
                className="inline-flex h-10 items-center justify-center border border-emerald-300/50 px-4 text-sm font-medium text-emerald-200 transition hover:bg-emerald-300/10"
                href={`/api/activities?start=${result.start}&limit=${result.limit}`}
              >
                JSON
              </a>
            </div>

            {result.activities.length > 0 ? (
              <ActivityTable activities={result.activities} />
            ) : (
              <p className="px-4 py-12 text-center text-neutral-400">
                No cached Garmin activities were returned for this range.
              </p>
            )}
          </div>
        )}

        <nav className="flex flex-wrap items-center gap-3">
          <PageLink
            disabled={result.start === 0}
            href={`/?start=${Math.max(result.start - result.limit, 0)}&limit=${result.limit}`}
          >
            Previous
          </PageLink>
          <PageLink href={`/?start=${result.start + result.limit}&limit=${result.limit}`}>
            Next
          </PageLink>
          <span className="text-sm text-neutral-500">
            Use <code className="text-neutral-300">?limit=50</code> to adjust
            page size, up to 100.
          </span>
        </nav>
      </section>
    </main>
  );
}

async function manualSyncActivities(formData: FormData) {
  "use server";

  const { start, limit } = parseActivityWindow({
    start: String(formData.get("start") ?? ""),
    limit: String(formData.get("limit") ?? ""),
  });
  const redirectParams = new URLSearchParams({
    start: String(start),
    limit: String(limit),
  });

  try {
    await syncActivities("manual");
    revalidatePath("/");
    redirectParams.set("sync", "success");
  } catch (error) {
    redirectParams.set("sync", "error");
    redirectParams.set("message", getPublicGarminError(error).message);
  }

  redirect(`/?${redirectParams.toString()}`);
}

async function loadActivities(
  start: number,
  limit: number,
): Promise<PageActivitiesResult> {
  try {
    return getCachedActivities(start, limit);
  } catch (error) {
    return {
      activities: [],
      fetchedAt: new Date().toISOString(),
      start,
      limit,
      domain: getFallbackGarminDomain(),
      error: getPublicGarminError(error).message,
    };
  }
}

function getManualSyncMessage(
  params?: Record<string, string | string[] | undefined>,
) {
  const sync = getParamValue(params, "sync");

  if (sync === "success") {
    return {
      kind: "success",
      message: "Manual sync completed.",
    };
  }

  if (sync === "error") {
    return {
      kind: "error",
      message:
        getParamValue(params, "message") || "Manual sync failed.",
    };
  }

  return undefined;
}

function getFallbackGarminDomain() {
  try {
    return getConfiguredGarminDomain();
  } catch {
    return "garmin.com";
  }
}

function getParamValue(
  params: Record<string, string | string[] | undefined> | undefined,
  key: string,
) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-white/[0.04] px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </dt>
      <dd className="mt-2 text-xl font-semibold text-white">{value}</dd>
    </div>
  );
}

function ActivityTable({ activities }: { activities: ActivitySummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.14em] text-neutral-500">
          <tr>
            <th className="px-4 py-3 font-medium">Activity</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 text-right font-medium">Distance</th>
            <th className="px-4 py-3 text-right font-medium">Duration</th>
            <th className="px-4 py-3 text-right font-medium">Elev</th>
            <th className="px-4 py-3 text-right font-medium">HR</th>
            <th className="px-4 py-3 text-right font-medium">Calories</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {activities.map((activity) => (
            <tr key={activity.activityId} className="hover:bg-white/[0.03]">
              <td className="max-w-[260px] px-4 py-4">
                <div className="font-medium text-white">
                  {activity.activityName || "Untitled activity"}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {activity.locationName ?? `ID ${activity.activityId}`}
                </div>
              </td>
              <td className="px-4 py-4 text-neutral-300">
                {formatActivityType(activity.activityType)}
              </td>
              <td className="px-4 py-4 text-neutral-300">
                {formatActivityDate(activity.startTimeLocal)}
              </td>
              <td className="px-4 py-4 text-right text-neutral-200">
                {formatDistance(activity.distanceMeters)}
              </td>
              <td className="px-4 py-4 text-right text-neutral-200">
                {formatDuration(activity.durationSeconds)}
              </td>
              <td className="px-4 py-4 text-right text-neutral-200">
                {formatElevation(activity.elevationGainMeters)}
              </td>
              <td className="px-4 py-4 text-right text-neutral-200">
                {formatHeartRate(activity.averageHeartRate)}
              </td>
              <td className="px-4 py-4 text-right text-neutral-200">
                {Math.round(activity.calories).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageLink({
  children,
  disabled = false,
  href,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  href: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-10 items-center justify-center border border-white/10 px-4 text-sm font-medium text-neutral-600">
        {children}
      </span>
    );
  }

  return (
    <a
      className="inline-flex h-10 items-center justify-center border border-white/15 px-4 text-sm font-medium text-neutral-200 transition hover:bg-white/10"
      href={href}
    >
      {children}
    </a>
  );
}

function formatTotalDistance(activities: ActivitySummary[]) {
  const totalMeters = activities.reduce(
    (total, activity) => total + activity.distanceMeters,
    0,
  );

  return formatDistance(totalMeters);
}

function formatTotalDuration(activities: ActivitySummary[]) {
  const totalSeconds = activities.reduce(
    (total, activity) => total + activity.durationSeconds,
    0,
  );

  return formatDuration(totalSeconds);
}

function formatTotalCalories(activities: ActivitySummary[]) {
  const totalCalories = activities.reduce(
    (total, activity) => total + activity.calories,
    0,
  );

  return Math.round(totalCalories).toLocaleString();
}

function formatDistance(meters: number) {
  return `${(meters / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} km`;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function formatElevation(meters: number) {
  return `${Math.round(meters).toLocaleString()} m`;
}

function formatHeartRate(heartRate: number | null) {
  return heartRate ? `${Math.round(heartRate)} bpm` : "n/a";
}

function formatActivityDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFetchedAt(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatActivityType(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
