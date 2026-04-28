import { connection } from "next/server";
import {
  getConfiguredGarminDomain,
  getGarminRunningActivities,
  getPublicGarminError,
  type ActivitySummary,
  type GarminActivitiesResult,
} from "@/lib/garmin";

type EmbedRunningProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type EmbedResult = GarminActivitiesResult & {
  error?: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RunningEmbed({ searchParams }: EmbedRunningProps) {
  await connection();

  const params = await searchParams;
  const limit = parseLimit(params?.limit);
  const result = await loadRunningActivities(limit);

  return (
    <main className="min-h-screen bg-[#101412] p-3 text-neutral-100">
      <section className="mx-auto w-full max-w-[760px] overflow-hidden border border-emerald-300/20 bg-[#151a17]">
        <header className="border-b border-white/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Garmin Running
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">
                Recent Running Overview
              </h1>
            </div>
            <div className="shrink-0 text-right text-[11px] text-neutral-500">
              <div>{result.domain}</div>
              <div>{formatFetchedAt(result.fetchedAt)}</div>
            </div>
          </div>
        </header>

        {result.error ? (
          <div className="px-4 py-6 text-sm leading-6 text-red-100">
            {result.error}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 border-b border-white/10 sm:grid-cols-4">
              <Stat label="Runs" value={String(result.activities.length)} />
              <Stat label="Distance" value={formatDistance(totalDistance(result.activities))} />
              <Stat label="Time" value={formatDuration(totalDuration(result.activities))} />
              <Stat label="Avg Pace" value={formatPace(totalDuration(result.activities), totalDistance(result.activities))} />
            </div>

            {result.activities.length > 1 ? (
              <DistanceTrendGraph activities={result.activities} />
            ) : result.activities.length === 1 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-400">
                More running activities are needed to draw a trend.
              </p>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-neutral-400">
                No running activities were returned.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

async function loadRunningActivities(limit: number): Promise<EmbedResult> {
  try {
    return await getGarminRunningActivities(limit);
  } catch (error) {
    return {
      activities: [],
      fetchedAt: new Date().toISOString(),
      start: 0,
      limit,
      domain: getFallbackGarminDomain(),
      error: getPublicGarminError(error).message,
    };
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-white/10 px-4 py-3 last:border-r-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function DistanceTrendGraph({
  activities,
}: {
  activities: ActivitySummary[];
}) {
  const points = activities
    .slice()
    .reverse()
    .map((activity) => ({
      id: activity.activityId,
      date: activity.startTimeLocal,
      distanceKm: activity.distanceMeters / 1000,
    }));
  const distances = points.map((point) => point.distanceKm);
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const range = maxDistance - minDistance || 1;
  const width = 640;
  const height = 170;
  const padding = {
    top: 20,
    right: 24,
    bottom: 34,
    left: 42,
  };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const plotted = points.map((point, index) => {
    const x =
      padding.left +
      (points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth);
    const y =
      padding.top +
      chartHeight -
      ((point.distanceKm - minDistance) / range) * chartHeight;

    return {
      ...point,
      x,
      y,
    };
  });
  const path = plotted
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${path} L ${plotted[plotted.length - 1].x} ${padding.top + chartHeight} L ${plotted[0].x} ${padding.top + chartHeight} Z`;

  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Distance trend</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Last {activities.length} running activities
          </p>
        </div>
        <div className="text-right text-xs text-neutral-400">
          <div>{formatDistance(maxDistance * 1000)} max</div>
          <div>{formatDistance(minDistance * 1000)} min</div>
        </div>
      </div>

      <svg
        aria-label="Distance trend graph"
        className="h-auto w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="1"
          x1={padding.left}
          x2={padding.left + chartWidth}
          y1={padding.top}
          y2={padding.top}
        />
        <line
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="1"
          x1={padding.left}
          x2={padding.left + chartWidth}
          y1={padding.top + chartHeight}
          y2={padding.top + chartHeight}
        />
        <path d={areaPath} fill="rgba(52,211,153,0.12)" />
        <path
          d={path}
          fill="none"
          stroke="#34d399"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {plotted.map((point) => (
          <g key={point.id}>
            <circle
              cx={point.x}
              cy={point.y}
              fill="#101412"
              r="5"
              stroke="#34d399"
              strokeWidth="2"
            />
            <text
              fill="#d1d5db"
              fontSize="11"
              textAnchor="middle"
              x={point.x}
              y={point.y - 10}
            >
              {point.distanceKm.toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })}
            </text>
          </g>
        ))}
        <text fill="#737373" fontSize="11" x={padding.left} y={height - 10}>
          {formatShortDate(points[0].date)}
        </text>
        <text
          fill="#737373"
          fontSize="11"
          textAnchor="end"
          x={padding.left + chartWidth}
          y={height - 10}
        >
          {formatShortDate(points[points.length - 1].date)}
        </text>
        <text fill="#737373" fontSize="11" x="0" y={padding.top + 4}>
          km
        </text>
      </svg>
    </section>
  );
}

function parseLimit(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(rawValue ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return 5;
  }

  return Math.min(Math.max(parsed, 1), 10);
}

function totalDistance(activities: ActivitySummary[]) {
  return activities.reduce((total, activity) => total + activity.distanceMeters, 0);
}

function totalDuration(activities: ActivitySummary[]) {
  return activities.reduce(
    (total, activity) => total + activity.durationSeconds,
    0,
  );
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

function formatPace(seconds: number, meters: number) {
  if (meters <= 0 || seconds <= 0) {
    return "n/a";
  }

  const secondsPerKm = seconds / (meters / 1000);
  const minutes = Math.floor(secondsPerKm / 60);
  const remainingSeconds = Math.round(secondsPerKm % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}/km`;
}

function formatShortDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatFetchedAt(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFallbackGarminDomain() {
  try {
    return getConfiguredGarminDomain();
  } catch {
    return "garmin.com";
  }
}
