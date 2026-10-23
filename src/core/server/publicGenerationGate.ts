export function isPublicGenerationLocked(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production';
}
