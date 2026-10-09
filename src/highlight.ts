import type { Finding } from "./types.ts";

export type DraftSegment = {
  text: string;
  finding?: Finding;
};

export function draftSegments(text: string, findings: Finding[]): DraftSegment[] {
  const sorted = [...findings].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: DraftSegment[] = [];
  let cursor = 0;

  for (const finding of sorted) {
    if (finding.end <= finding.start || finding.start < cursor || finding.start >= text.length) continue;
    const end = Math.min(finding.end, text.length);
    if (finding.start > cursor) segments.push({ text: text.slice(cursor, finding.start) });
    segments.push({ text: text.slice(finding.start, end), finding });
    cursor = end;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
