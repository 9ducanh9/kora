import { IRNode, IRConnection, IRContainer, IRScope } from '../ir/types';
import type { SemanticGenerationReview } from '../ai/semantics/requirements';

export interface NodePresentation {
  x: number;
  y: number;
  width?: number;
  height?: number;
  selected?: boolean;
}

export interface ContainerPresentation {
  x: number;
  y: number;
  width: number;
  height: number;
  selected?: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type ConnectionSide = 'top' | 'right' | 'bottom' | 'left';

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface ConnectionRoute {
  version: '1.0';
  inputSignature: string;
  points: Point[];
  label?: Rect;
}

export interface ConnectionPresentation {
  sourceSide?: ConnectionSide;
  targetSide?: ConnectionSide;
  route?: ConnectionRoute;
}

/** Immutable provenance for the prompt or fixture that produced a diagram. */
export interface DiagramSource {
  kind: 'prompt' | 'fixture';
  prompt: string;
  context?: { scope?: string };
  parser: { id: string; model?: string };
  generatedAt: string;
  semanticReview?: SemanticGenerationReview;
}

/**
 * DiagramDocument is the single canonical source of truth for Kora.
 * Strictly separates semantic meaning (WHAT exists, HOW components relate)
 * from visual presentation (WHERE objects appear, visual bounding boxes).
 */
export interface DiagramDocument {
  version: '1.0';

  // SEMANTIC LAYER (WHAT exists, labels, connectivity, container membership)
  semantic: {
    scope?: IRScope;
    nodes: Record<string, IRNode>;             // Keyed by nodeId
    connections: Record<string, IRConnection>; // Keyed by connectionId
    containers: Record<string, IRContainer>;   // Keyed by containerId
  };

  // PRESENTATION LAYER (Coordinates, dimensions, viewport)
  presentation: {
    nodes: Record<string, NodePresentation>;           // Keyed by nodeId
    containers: Record<string, ContainerPresentation>; // Keyed by containerId
    connections?: Record<string, ConnectionPresentation>; // Sparse per-connection side and route cache
    viewport: Viewport;
  };

  metadata: {
    title: string;
    createdAt: string;
    updatedAt: string;
    source?: DiagramSource;
  };
}

/**
 * Creates an empty canonical DiagramDocument
 */
export function createEmptyDiagramDocument(title = 'Untitled Architecture'): DiagramDocument {
  const now = new Date().toISOString();
  return {
    version: '1.0',
    semantic: {
      nodes: {},
      connections: {},
      containers: {}
    },
    presentation: {
      nodes: {},
      containers: {},
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    metadata: {
      title,
      createdAt: now,
      updatedAt: now
    }
  };
}
