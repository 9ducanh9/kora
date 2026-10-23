export function safeExportFilename(title: string, extension: 'json' | 'svg' | 'png'): string {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  const normalized = title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '-').replace(/[. ]+$/u, '').trim();
  const graphemes = Segmenter ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized), part => part.segment) : Array.from(normalized);
  const stem = graphemes.slice(0, 80).join('').replace(/[. ]+$/u, '') || 'architecture';
  return `${stem}.${extension}`;
}
