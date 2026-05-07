import type { NextRequest } from "next/server";
import {
  getGarminTrainingLoad,
  getPublicGarminError,
  parseTrainingLoadDate,
} from "@/lib/garmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const date = parseTrainingLoadDate(request.nextUrl.searchParams);
    const result = await getGarminTrainingLoad(date);

    return Response.json(result);
  } catch (error) {
    const publicError = getPublicGarminError(error);

    return Response.json(
      { error: publicError.message },
      { status: publicError.status },
    );
  }
}
