import manifestData from './manifest.json';
import { AssetEntry, AssetManifest } from './types';
import { CANONICAL_ASSET_METADATA } from './canonicalMetadata';

const rawManifest = manifestData as AssetManifest;

function augmentEntry(entry: AssetEntry): AssetEntry {
  const meta = CANONICAL_ASSET_METADATA[entry.id];
  if (!meta) return entry;
  return {
    ...entry,
    shortName: meta.shortName,
    aliases: meta.aliases ? Array.from(new Set([...entry.aliases, ...meta.aliases])) : entry.aliases
  };
}

const manifest: AssetManifest = Object.fromEntries(
  Object.entries(rawManifest).map(([id, entry]) => [id, augmentEntry(entry)])
);

/**
 * Returns exact asset by its canonical ID (e.g. "aws.cloudfront")
 */
export function getAsset(id: string): AssetEntry | undefined {
  return manifest[id];
}

export interface DetailedAssetResolution {
  source: 'canonical' | 'alias' | 'label-derived' | 'fallback';
  requestedValue?: string;
  asset: AssetEntry;
}

function findCanonicalOrAlias(input: string): { asset: AssetEntry; source: 'canonical' | 'alias' } | undefined {
  const query = input.trim().toLowerCase();
  const direct = manifest[query];
  if (direct) return { asset: direct, source: 'canonical' };

  if (query === 'aws.alb' && manifest['aws.elb.alb']) return { asset: manifest['aws.elb.alb'], source: 'alias' };
  if (query === 'aws.fargate' && manifest['aws.ecs.fargate']) return { asset: manifest['aws.ecs.fargate'], source: 'alias' };

  for (const entry of Object.values(manifest)) {
    if (entry.displayName.trim().toLowerCase() === query || entry.aliases.some(alias => alias.trim().toLowerCase() === query)) {
      return { asset: entry, source: 'alias' };
    }
  }
  return undefined;
}

/** Resolve an explicit asset ID or derive a display asset from a label without losing why it resolved. */
export function resolveAssetDetailed(input: { assetId?: string; label?: string }): DetailedAssetResolution {
  const explicit = input.assetId;
  const requestedValue = explicit ?? input.label;
  const generic = manifest['generic.component'];

  if (explicit !== undefined) {
    const match = findCanonicalOrAlias(explicit);
    if (match) return { ...match, requestedValue: explicit };
    return { source: 'fallback', requestedValue: explicit, asset: generic };
  }

  if (input.label) {
    const match = findCanonicalOrAlias(input.label);
    if (match) return { source: 'label-derived', requestedValue: input.label, asset: match.asset };
  }

  return { source: 'fallback', requestedValue, asset: generic };
}

/**
 * Resolves an asset ID or user/LLM alias into a canonical AssetEntry.
 * Returns the fallback 'generic.component' if not found.
 */
export function resolveAsset(input?: string): AssetEntry {
  if (!input) {
    return manifest['generic.component'] || {
      id: 'generic.component',
      displayName: 'Component',
      category: 'generic',
      assetPath: '/assets/aws/generic/generic-component.svg',
      aliases: []
    };
  }

  // 1. Direct ID match
  const direct = manifest[input.toLowerCase()];
  if (direct) return direct;

  // 2. Normalized direct match (e.g. "aws.alb" -> "aws.elb.alb")
  if (input.toLowerCase() === 'aws.alb' && manifest['aws.elb.alb']) {
    return manifest['aws.elb.alb'];
  }
  if (input.toLowerCase() === 'aws.fargate' && manifest['aws.ecs.fargate']) {
    return manifest['aws.ecs.fargate'];
  }

  // 3. Alias or DisplayName match (case-insensitive)
  const query = input.trim().toLowerCase();
  for (const entry of Object.values(manifest)) {
    if (entry.displayName.toLowerCase() === query) {
      return entry;
    }
    for (const alias of entry.aliases) {
      if (alias.toLowerCase() === query) {
        return entry;
      }
    }
  }

  // 4. Fallback to generic component (never hallucinate an SVG)
  return manifest['generic.component'];
}

export function getAllAssets(): AssetEntry[] {
  return Object.values(manifest);
}

export function getAssetsByCategory(category: string): AssetEntry[] {
  return Object.values(manifest).filter(entry => entry.category === category);
}

export function searchAssets(keyword: string): AssetEntry[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return getAllAssets();

  return Object.values(manifest).filter(entry => {
    return (
      entry.id.toLowerCase().includes(q) ||
      entry.displayName.toLowerCase().includes(q) ||
      entry.aliases.some(a => a.toLowerCase().includes(q))
    );
  });
}

export function getAssetShortName(assetId?: string): string | undefined {
  if (!assetId) return undefined;
  const asset = resolveAsset(assetId);
  return asset.shortName || asset.displayName;
}

export interface ResolvedNodeDisplay {
  primaryLabel: string;
  subtitle?: string;
  isCanonicalLabel: boolean;
  asset: AssetEntry;
}

/**
 * Resolves presentation display for an architecture node:
 * - Checks if normalized label exactly matches the asset displayName or known canonical alias
 * - If matching, uses the canonical shortName (e.g. "Amazon CloudFront" -> "CloudFront")
 * - Otherwise preserves the custom semantic label (e.g. "Backend API", "Private S3 Bucket")
 * - Generates presentation-only derived subtitle when explicit subtitle is undefined
 */
export function resolveNodeDisplay(
  label: string,
  explicitSubtitle?: string,
  assetId?: string
): ResolvedNodeDisplay {
  const asset = resolveAsset(assetId || label);
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedDisplayName = asset.displayName.trim().toLowerCase();

  // Exact match check: only use shortName when normalized label matches displayName or canonical alias
  const matchesCanonical =
    normalizedLabel === normalizedDisplayName ||
    asset.aliases.some(a => a.trim().toLowerCase() === normalizedLabel);

  if (matchesCanonical) {
    return {
      primaryLabel: asset.shortName || asset.displayName,
      subtitle: explicitSubtitle && explicitSubtitle.trim() ? explicitSubtitle.trim() : undefined,
      isCanonicalLabel: true,
      asset
    };
  }

  // Custom semantic label: preserve label
  // Presentation-only subtitle: explicit subtitle takes precedence;
  // if undefined, use service shortName as secondary context
  const derivedSubtitle = explicitSubtitle !== undefined
    ? (explicitSubtitle.trim() || undefined)
    : (asset.shortName || asset.displayName);

  return {
    primaryLabel: label,
    subtitle: derivedSubtitle,
    isCanonicalLabel: false,
    asset
  };
}

