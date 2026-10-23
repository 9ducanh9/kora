import { ConnectionSide, Point, Rect } from '../diagram/types';

export type AnchorRole = 'source' | 'target';
export const PORT_ESCAPE_STUB = 12;
export const CONNECTION_ANCHOR_VERSION = 'kora-anchor-v2-centered';

/** Both roles share the side center, matching the canvas handles. */
export function resolveConnectionAnchor(box: Rect, side: ConnectionSide, _role: AnchorRole): Point {
  const ratio = 0.5;
  switch (side) {
    case 'top': return { x: box.x + box.width * ratio, y: box.y };
    case 'right': return { x: box.x + box.width, y: box.y + box.height * ratio };
    case 'bottom': return { x: box.x + box.width * ratio, y: box.y + box.height };
    case 'left': return { x: box.x, y: box.y + box.height * ratio };
  }
}

export function resolveEscapePoint(anchor: Point, side: ConnectionSide, distance = PORT_ESCAPE_STUB): Point {
  switch (side) {
    case 'top': return { x: anchor.x, y: anchor.y - distance };
    case 'right': return { x: anchor.x + distance, y: anchor.y };
    case 'bottom': return { x: anchor.x, y: anchor.y + distance };
    case 'left': return { x: anchor.x - distance, y: anchor.y };
  }
}

export function isOrthogonal(a: Point, b: Point, epsilon = 1): boolean {
  return Math.abs(a.x - b.x) <= epsilon || Math.abs(a.y - b.y) <= epsilon;
}
