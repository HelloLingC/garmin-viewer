import type { NextRequest } from "next/server";
import {
  getGarminTrainingLoad,
  getPublicGarminError,
  parseTrainingLoadDate,
} from "@/lib/garmin";
import {
  getCachedTrainingLoad,
  isTrainingLoadCacheStale,
  upsertCachedTrainingLoad,
} from "@/lib/activity-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://lycois.org",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/training-load
 *
 * 获取 Garmin Training Load 数据（当前训练负荷、负荷比、趋势、训练状态）。
 * 数据缓存在 SQLite 中，30 分钟内直接返回缓存，超过后重新从 Garmin Connect 拉取。
 *
 * @route GET /api/training-load
 *
 * @query date - 可选，格式 YYYY-MM-DD，默认今天
 *
 * @returns 200 - 成功响应
 * ```json
 * {
 *   "date": "2026-05-29",
 *   "fetchedAt": "2026-05-29T12:00:00.000Z",
 *   "domain": "garmin.com",
 *   "summary": {
 *     "currentLoad": 268,
 *     "chronicLoad": 894,
 *     "loadRatio": 1.1,
 *     "loadTrend": "LOW",
 *     "trainingStatus": "Recovery",
 *     "vo2Max": 59.6,
 *     "aerobicLow": 604.98,
 *     "aerobicHigh": 1765.75,
 *     "anaerobic": 1082.50
 *   },
 *   "data": { ... }
 * }
 * ```
 *
 * @field date           - 查询日期（YYYY-MM-DD）
 * @field fetchedAt      - 数据获取时间（ISO 8601）
 * @field domain         - Garmin 域名（"garmin.com" 或 "garmin.cn"）
 * @field summary        - 提取后的关键指标
 * @field currentLoad    - 当前训练负荷（急性负荷），无数据时为 null
 * @field chronicLoad    - 慢性训练负荷，无数据时为 null
 * @field loadRatio      - 急性/慢性负荷比（ACWR），无数据时为 null
 * @field loadTrend      - 负荷趋势状态文本，无数据时为 null
 * @field trainingStatus - 训练状态文本（如 "Productive"、"Recovery"），无数据时为 null
 * @field vo2Max         - 最大摄氧量，无数据时为 null
 * @field aerobicLow     - 月度有氧低负荷，无数据时为 null
 * @field aerobicHigh    - 月度有氧高负荷，无数据时为 null
 * @field anaerobic      - 月度无氧负荷，无数据时为 null
 * @field data           - Garmin Connect 原始响应数据
 *
 * @returns 500 - 服务端错误
 * ```json
 * { "error": "错误描述" }
 * ```
 */
export async function GET(request: NextRequest) {
  try {
    const date = parseTrainingLoadDate(request.nextUrl.searchParams);

    const cached = getCachedTrainingLoad(date);
    if (cached && !isTrainingLoadCacheStale(date)) {
      return Response.json(cached, { headers: CORS_HEADERS });
    }

    const result = await getGarminTrainingLoad(date);
    upsertCachedTrainingLoad(result);

    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    const publicError = getPublicGarminError(error);

    return Response.json(
      { error: publicError.message },
      { status: publicError.status, headers: CORS_HEADERS },
    );
  }
}
