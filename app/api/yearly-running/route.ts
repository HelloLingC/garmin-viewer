import { getCachedYearlyRunningStats } from "@/lib/activity-cache";
import { getPublicGarminError } from "@/lib/garmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cachedResult: ReturnType<typeof getCachedYearlyRunningStats> | null = null;
let cachedAt = 0;

/**
 * GET /api/yearly-running
 *
 * 获取按年汇总的跑步统计数据（跑量、时间、平均配速）。
 * 数据来源为本地 SQLite 缓存，由后台同步任务定期从 Garmin Connect 拉取。
 * 结果在内存中缓存 6 小时，避免每次请求重复计算。
 *
 * @route GET /api/yearly-running
 *
 * @query 无查询参数
 *
 * @returns 200 - 成功响应
 * ```json
 * {
 *   "yearly": [
 *     {
 *       "year": 2026,
 *       "distanceKm": 1234.56,
 *       "totalHours": 120.5,
 *       "paceMinPerKm": 5.86
 *     },
 *     {
 *       "year": 2025,
 *       "distanceKm": 890.12,
 *       "totalHours": 85.3,
 *       "paceMinPerKm": 5.75
 *     }
 *   ],
 *   "fetchedAt": "2026-05-29T12:00:00.000Z",
 *   "domain": "garmin.com"
 * }
 * ```
 *
 * @field yearly       - 按年降序排列的跑步统计数组
 * @field year         - 年份（整数）
 * @field distanceKm   - 年度跑量，单位 km，保留两位小数
 * @field totalHours   - 年度总运动时间，单位小时（基于 moving_duration），保留两位小数
 * @field paceMinPerKm - 年度平均配速，单位 分钟/km，保留两位小数（计算方式：总时间 / 总距离）
 * @field fetchedAt    - 缓存最后同步时间（ISO 8601）
 * @field domain       - Garmin 域名（"garmin.com" 或 "garmin.cn"）
 *
 * @returns 500 - 服务端错误
 * ```json
 * { "error": "错误描述" }
 * ```
 */
export async function GET() {
  try {
    const now = Date.now();
    if (cachedResult && now - cachedAt < CACHE_TTL_MS) {
      return Response.json(cachedResult);
    }

    const result = getCachedYearlyRunningStats();
    cachedResult = result;
    cachedAt = now;

    return Response.json(result);
  } catch (error) {
    const publicError = getPublicGarminError(error);

    return Response.json(
      { error: publicError.message },
      { status: publicError.status },
    );
  }
}
