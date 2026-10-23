/** Only explicit, source-grounded stages affect layout; legacy diagrams keep their original options. */
export function stageLayoutPriorities(description?: string): Record<string, string> | undefined {
  const stage = description?.match(/\bstage=(runtime|delivery|control|startup|deployment)\b/)?.[1];
  if (!stage) return undefined;
  // ELK direction priority is a cycle-breaking preference, not a semantic edge reversal.
  // https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-priority-direction.html
  return {
    'elk.layered.priority.direction': stage === 'runtime' ? '100' : stage === 'control' ? '10' : '0',
    'elk.layered.priority.shortness': stage === 'runtime' || stage === 'delivery' ? '100' : '0'
  };
}
