import { NextResponse } from 'next/server';
import { isPublicGenerationLocked } from '@/core/server/publicGenerationGate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const productionLocked = isPublicGenerationLocked(process.env.NODE_ENV);
  return NextResponse.json(
    {
      status: 'ok',
      generation: productionLocked ? 'disabled' : 'local'
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' }
    }
  );
}
