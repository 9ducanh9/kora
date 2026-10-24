import { NextResponse } from 'next/server';
import { isPublicGenerationLocked } from '@/core/server/publicGenerationGate';

export const dynamic = 'force-dynamic';

/** Readiness for paid generation is separate from editor liveness. */
export async function GET() {
  const locked = isPublicGenerationLocked(process.env.NODE_ENV);
  return NextResponse.json({ status: locked ? 'not_ready' : 'ready', generation: locked ? 'disabled' : 'local' }, {
    status: locked ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' }
  });
}
