import { getSmoothStepPath, Position } from '@xyflow/react';
import { ConnectionRoute, ConnectionSide, Point, Rect } from '../diagram/types';

export interface ConnectionGeometryInput {
  source: Point;
  target: Point;
  sourceSide: ConnectionSide;
  targetSide: ConnectionSide;
  sourceId?: string;
  targetId?: string;
  route?: ConnectionRoute;
  borderRadius?: number;
}

export interface ConnectionGeometry {
  path: string;
  points: Point[];
  labelX: number;
  labelY: number;
  label?: Rect;
}

const positions: Record<ConnectionSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left
};

function pathPoints(path: string): Point[] {
  const values = path.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu)?.map(Number) ?? [];
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
  return points;
}

function polyline(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function resolveConnectionGeometry(input: ConnectionGeometryInput): ConnectionGeometry {
  if (input.route?.points.length) {
    const points = input.route.points;
    return {
      path: polyline(points),
      points,
      labelX: input.route.label ? input.route.label.x + input.route.label.width / 2 : points[Math.floor(points.length / 2)].x,
      labelY: input.route.label ? input.route.label.y + input.route.label.height / 2 : points[Math.floor(points.length / 2)].y,
      label: input.route.label
    };
  }

  if (input.sourceId && input.sourceId === input.targetId) {
    const { source, target, sourceSide } = input;
    let points: Point[];
    if (sourceSide === input.targetSide && source.x === target.x && source.y === target.y) {
      // Coincident centered handles still need an exterior loop with normal
      // departure/arrival segments; never collapse it to a line at the node.
      const outward = sourceSide === 'right' ? { x: 1, y: 0 } : sourceSide === 'left' ? { x: -1, y: 0 }
        : sourceSide === 'top' ? { x: 0, y: -1 } : { x: 0, y: 1 };
      const tangent = { x: -outward.y, y: outward.x };
      const at = (normal: number, along: number): Point => ({
        x: source.x + outward.x * normal + tangent.x * along,
        y: source.y + outward.y * normal + tangent.y * along
      });
      points = [source, at(32, 0), at(32, 24), at(16, 24), at(16, 0), target];
    } else if (sourceSide === 'right') {
      const outside = Math.max(source.x, target.x) + 32; const top = Math.min(source.y, target.y) - 24;
      points = [source, { x: outside, y: source.y }, { x: outside, y: top }, { x: target.x, y: top }, target];
    } else if (sourceSide === 'left') {
      const outside = Math.min(source.x, target.x) - 32; const top = Math.min(source.y, target.y) - 24;
      points = [source, { x: outside, y: source.y }, { x: outside, y: top }, { x: target.x, y: top }, target];
    } else if (sourceSide === 'top') {
      const outside = Math.min(source.y, target.y) - 32; const right = Math.max(source.x, target.x) + 24;
      points = [source, { x: source.x, y: outside }, { x: right, y: outside }, { x: right, y: target.y }, target];
    } else {
      const outside = Math.max(source.y, target.y) + 32; const right = Math.max(source.x, target.x) + 24;
      points = [source, { x: source.x, y: outside }, { x: right, y: outside }, { x: right, y: target.y }, target];
    }
    return { path: polyline(points), points, labelX: points[2].x, labelY: points[2].y };
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: input.source.x,
    sourceY: input.source.y,
    sourcePosition: positions[input.sourceSide],
    targetX: input.target.x,
    targetY: input.target.y,
    targetPosition: positions[input.targetSide],
    borderRadius: input.borderRadius ?? 8
  });
  return { path, points: pathPoints(path), labelX, labelY };
}
