import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { VerifiedDeepSeekArchitectureParser } from '@/core/ai/providers/verifiedDeepseek.parser';
import { ArchitectureParseError } from '@/core/ai/parser.interface';
import { readBoundedJsonBody } from '@/core/server/boundedJsonBody';
import { reserveLocalGeneration } from '@/core/server/localGenerationLimiter';
import { isPublicGenerationLocked } from '@/core/server/publicGenerationGate';

const RequestSchema = z.object({
  prompt: z.string().max(20_000).refine(value => value.trim().length > 0, 'Prompt cannot be empty.'),
  scope: z.string().max(120).optional(),
  apiKey: z.string().max(512).optional()
}).strict();

const MAX_REQUEST_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  // Public launch stays closed until server-side identity, entitlement, shared
  // limits, and usage accounting are integrated. No environment flag bypasses this gate.
  if (isPublicGenerationLocked(process.env.NODE_ENV)) {
    return NextResponse.json({
      success: false,
      code: 'PUBLIC_LAUNCH_NOT_CONFIGURED',
      error: 'Architecture generation is not enabled for this deployment.'
    }, { status: 503 });
  }

  const boundedBody = await readBoundedJsonBody(req, MAX_REQUEST_BYTES);
  if (!boundedBody.ok) {
    if (boundedBody.reason === 'too-large') {
      return NextResponse.json({
        success: false,
        code: 'REQUEST_TOO_LARGE',
        error: 'Request body exceeds the 64 KiB limit.'
      }, { status: 413 });
    }
    return NextResponse.json({
      success: false,
      code: 'INVALID_JSON',
      error: 'Request body must be valid UTF-8 JSON.'
    }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(boundedBody.text);
  } catch {
    return NextResponse.json({ success: false, code: 'INVALID_JSON', error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const request = RequestSchema.safeParse(rawBody);
  if (!request.success) {
    return NextResponse.json({
      success: false,
      code: 'INVALID_REQUEST',
      error: 'Request must contain a non-empty prompt and only supported fields.'
    }, { status: 400 });
  }

  const reservation = reserveLocalGeneration('local-development');
  if (!reservation.allowed) {
    return NextResponse.json({
      success: false,
      code: 'LOCAL_GENERATION_LIMIT',
      error: reservation.reason === 'rate'
        ? 'Local generation limit reached. Wait before trying again.'
        : 'A local generation is already running.'
    }, {
      status: 429,
      headers: { 'Retry-After': String(reservation.retryAfterSeconds) }
    });
  }

  const effectiveApiKey = request.data.apiKey?.trim() || process.env.DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY;
  if (!effectiveApiKey) {
    reservation.release();
    return NextResponse.json({
      success: false,
      code: 'MISSING_PROVIDER_KEY',
      error: 'Thiếu DeepSeek API Key. Vui lòng nhập key trong phần cài đặt.'
    }, { status: 401 });
  }

  const parser = new VerifiedDeepSeekArchitectureParser(effectiveApiKey);
  try {
    const parsed = await parser.parse(request.data.prompt, { scope: request.data.scope }, { signal: req.signal });
    return NextResponse.json({
      success: true,
      model: parsed.model,
      issues: parsed.issues,
      review: parsed.review,
      parser: { id: parser.id, name: parser.name, model: parser.getModelName() }
    });
  } catch (error: unknown) {
    if (error instanceof ArchitectureParseError) {
      return NextResponse.json({ success: false, code: error.code, error: error.publicMessage, issues: error.issues }, { status: error.status });
    }
    // Provider/network exception details can contain response data or credentials; only log a safe event marker.
    console.error('[parse-architecture] Provider request failed.');
    return NextResponse.json({
      success: false,
      code: 'PROVIDER_REQUEST_FAILED',
      error: 'Không thể hoàn tất yêu cầu phân tích kiến trúc.'
    }, { status: 502 });
  } finally {
    reservation.release();
  }
}
