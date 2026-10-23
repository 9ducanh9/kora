export interface LocalGenerationPolicy {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
}

interface LocalGenerationBucket {
  windowStartedAt: number;
  requests: number;
  active: number;
}

interface LocalGenerationState {
  buckets: Map<string, LocalGenerationBucket>;
}

export const DEFAULT_LOCAL_GENERATION_POLICY: Readonly<LocalGenerationPolicy> = {
  maxRequests: 5,
  windowMs: 60_000,
  maxConcurrent: 1
};

const globalState = globalThis as typeof globalThis & {
  __koraLocalGenerationLimiterState?: LocalGenerationState;
};
const state = globalState.__koraLocalGenerationLimiterState ??= { buckets: new Map() };

export type LocalGenerationReservation =
  | { allowed: true; release: () => void }
  | { allowed: false; reason: 'rate' | 'concurrency'; retryAfterSeconds: number };

export function reserveLocalGeneration(
  key: string,
  nowMs = Date.now(),
  policy: Readonly<LocalGenerationPolicy> = DEFAULT_LOCAL_GENERATION_POLICY
): LocalGenerationReservation {
  let bucket = state.buckets.get(key);
  if (!bucket) {
    bucket = { windowStartedAt: nowMs, requests: 0, active: 0 };
    state.buckets.set(key, bucket);
  } else if (nowMs - bucket.windowStartedAt >= policy.windowMs || nowMs < bucket.windowStartedAt) {
    bucket.windowStartedAt = nowMs;
    bucket.requests = 0;
  }

  if (bucket.active >= policy.maxConcurrent) {
    return { allowed: false, reason: 'concurrency', retryAfterSeconds: 1 };
  }
  if (bucket.requests >= policy.maxRequests) {
    const remainingMs = Math.max(1, policy.windowMs - (nowMs - bucket.windowStartedAt));
    return { allowed: false, reason: 'rate', retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
  }

  bucket.requests += 1;
  bucket.active += 1;
  let released = false;

  return {
    allowed: true,
    release() {
      if (released) return;
      released = true;
      bucket!.active = Math.max(0, bucket!.active - 1);
    }
  };
}
