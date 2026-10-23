/** Stable references let extraction cite source text without retyping/translating it. */
export function sourceEvidence(prompt: string): Array<{ id: string; text: string }> {
  const fragments: string[] = [];
  for (const line of prompt.split(/\r?\n/u)) {
    let remaining = line.trim();
    while (remaining) {
      let end = Math.min(600, remaining.length);
      if (end < remaining.length) {
        const space = remaining.lastIndexOf(' ', end);
        if (space > 300) end = space;
        else if (/[\uD800-\uDBFF]/u.test(remaining[end - 1])) end--;
      }
      fragments.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
  }
  return fragments.map((text, index) => ({ id: `@source:${index + 1}`, text }));
}

/** Resolve only exact known evidence references; unknown refs fail normal grounding. */
export function resolveSourceEvidence(raw: unknown, prompt: string): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const lookup = new Map(sourceEvidence(prompt).map(source => [source.id, source.text]));
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key,
    ['entities', 'flows', 'contextRelations', 'forbiddenFlows', 'placements', 'exclusions', 'notes'].includes(key) && Array.isArray(value)
      ? value.map(row => row && typeof row === 'object' && typeof row.evidence === 'string' && lookup.has(row.evidence)
        ? { ...row, evidence: lookup.get(row.evidence) } : row)
      : value
  ]));
}
