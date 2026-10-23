export type AssetCategory = 
  | 'edge'
  | 'compute'
  | 'storage'
  | 'database'
  | 'networking'
  | 'security'
  | 'integration'
  | 'aiml'
  | 'operations'
  | 'containers'
  | 'external'
  | 'generic';

export interface AssetEntry {
  id: string;
  displayName: string;
  shortName?: string;
  category: AssetCategory;
  assetPath: string;
  aliases: string[];
}

export type AssetManifest = Record<string, AssetEntry>;
