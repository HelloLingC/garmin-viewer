import type { NextRequest } from "next/server";
import { getCachedActivities } from "@/lib/activity-cache";
import {
  getPublicGarminError,
  parseActivityWindow,
} from "@/lib/garmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { start, limit } = parseActivityWindow(request.nextUrl.searchParams);

  try {
    const result = getCachedActivities(start, limit);
    return Response.json(result);
  } catch (error) {
    const publicError = getPublicGarminError(error);

    return Response.json(
      { error: publicError.message },
      { status: publicError.status },
    );
  }
}
