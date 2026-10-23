import { Command } from './types';
import {
  ConnectionPresentation,
  ContainerPresentation,
  DiagramDocument,
  NodePresentation
} from '../diagram/types';
import { IRConnection, IRContainer, IRNode } from '../ir/types';
import { getNodeDimensions } from '../layout/nodeDimensions';
import { getContainerVisualConfig } from '../containers/registry';

let commandSequence = 0;
const commandId = (prefix: string) => `${prefix}-${++commandSequence}`;

type Point = { x: number; y: number };
export type DiagramMove = { kind: 'node' | 'container'; from: Point; to: Point };

function withUpdatedAt(doc: DiagramDocument): DiagramDocument {
  return { ...doc, metadata: { ...doc.metadata, updatedAt: new Date().toISOString() } };
}

function invalidateRoutes(doc: DiagramDocument, deletedConnectionIds: string[] = []): DiagramDocument {
  const current = doc.presentation.connections;
  if (!current) return doc;
  let changed = false;
  const next: Record<string, ConnectionPresentation> = { ...current };

  for (const id of deletedConnectionIds) {
    if (Object.prototype.hasOwnProperty.call(next, id)) {
      delete next[id];
      changed = true;
    }
  }

  for (const [id, presentation] of Object.entries(next)) {
    if (!presentation.route) continue;
    const { route: _route, ...sides } = presentation;
    if (Object.keys(sides).length === 0) delete next[id];
    else next[id] = sides;
    changed = true;
  }

  return changed ? { ...doc, presentation: { ...doc.presentation, connections: next } } : doc;
}

function sideFromHandle(handle: string | null | undefined, role: 'source' | 'target'): ConnectionPresentation['sourceSide'] {
  if (!handle) return undefined;
  const suffix = `-${role}`;
  const side = handle.endsWith(suffix) ? handle.slice(0, -suffix.length) : handle;
  return side === 'top' || side === 'right' || side === 'bottom' || side === 'left' ? side : undefined;
}

abstract class SnapshotCommand implements Command {
  readonly id: string;
  readonly description: string;
  private before?: DiagramDocument;
  private after?: DiagramDocument;

  protected constructor(prefix: string, description: string) {
    this.id = commandId(prefix);
    this.description = description;
  }

  protected abstract build(doc: DiagramDocument): DiagramDocument;

  execute(doc: DiagramDocument): DiagramDocument {
    if (!this.before) {
      this.before = doc;
      this.after = this.build(doc);
    }
    return this.after ?? doc;
  }

  undo(doc: DiagramDocument): DiagramDocument {
    return this.before ?? doc;
  }
}

export class MoveDiagramObjectsCommand extends SnapshotCommand {
  constructor(private moves: Record<string, DiagramMove>, description = 'Move Diagram Objects') {
    super('move', description);
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const nodes = { ...doc.presentation.nodes };
    const containers = { ...doc.presentation.containers };
    let changed = false;
    for (const [id, move] of Object.entries(this.moves)) {
      if (move.kind === 'node') {
        const box = nodes[id];
        if (!box || (box.x === move.to.x && box.y === move.to.y)) continue;
        nodes[id] = { ...box, x: move.to.x, y: move.to.y };
        changed = true;
      } else {
        const box = containers[id];
        if (!box || (box.x === move.to.x && box.y === move.to.y)) continue;
        containers[id] = { ...box, x: move.to.x, y: move.to.y };
        changed = true;
      }
    }
    if (!changed) return doc;
    const geometryChanged = { ...doc, presentation: { ...doc.presentation, nodes, containers } };
    return withUpdatedAt(invalidateRoutes(geometryChanged));
  }
}

/** Backward-compatible node-only command used by older callers. */
export class MoveNodesCommand extends SnapshotCommand {
  constructor(private moves: Record<string, { from: Point; to: Point }>) {
    super('move-node', 'Move Nodes');
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const moves: Record<string, DiagramMove> = {};
    for (const [id, move] of Object.entries(this.moves)) moves[id] = { ...move, kind: 'node' };
    return new MoveDiagramObjectsCommand(moves).execute(doc);
  }
}

export class UpdateNodeLabelCommand extends SnapshotCommand {
  private nodeId: string;
  private newLabel: string;
  private dimensions?: { width: number; height: number };

  constructor(document: DiagramDocument, nodeId: string, newLabel: string, dimensions?: { width: number; height: number });
  constructor(nodeId: string, newLabel: string, dimensions?: { width: number; height: number });
  constructor(nodeId: string, oldLabel: string, newLabel: string, dimensions?: { width: number; height: number });
  constructor(first: DiagramDocument | string, second: string, third?: string | { width: number; height: number }, fourth?: { width: number; height: number }) {
    const newLabel = typeof third === 'string' ? third : second;
    super('rename-node', `Rename Node to "${newLabel}"`);
    this.nodeId = typeof first === 'string' ? first : second;
    this.newLabel = newLabel;
    this.dimensions = typeof third === 'object' ? third : fourth;
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const node = doc.semantic.nodes[this.nodeId];
    if (!node || !this.newLabel.trim() || node.label === this.newLabel) return doc;
    const measured = this.dimensions ?? getNodeDimensions({ label: this.newLabel, subtitle: node.subtitle, assetId: node.assetId });
    const nodePresentation = doc.presentation.nodes[this.nodeId];
    const updated = {
      ...doc,
      semantic: { ...doc.semantic, nodes: { ...doc.semantic.nodes, [this.nodeId]: { ...node, label: this.newLabel } } },
      presentation: nodePresentation ? {
        ...doc.presentation,
        nodes: { ...doc.presentation.nodes, [this.nodeId]: { ...nodePresentation, width: measured.width, height: measured.height } }
      } : doc.presentation
    };
    return withUpdatedAt(invalidateRoutes(updated));
  }
}

export class UpdateContainerLabelCommand extends SnapshotCommand {
  constructor(private containerId: string, private newLabel: string, private metrics?: { minimumWidth: number; oldContentTop: number; newContentTop: number }) {
    super('rename-container', `Rename Container to "${newLabel}"`);
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const container = doc.semantic.containers[this.containerId];
    if (!container || !this.newLabel.trim() || container.label === this.newLabel) return doc;
    const containers = { ...doc.presentation.containers };
    const nodes = { ...doc.presentation.nodes };
    const targetBox = containers[this.containerId];
    const headerDelta = Math.max(0, (this.metrics?.newContentTop ?? 0) - (this.metrics?.oldContentTop ?? 0));
    if (targetBox) {
      const visualConfig = getContainerVisualConfig(container.type);
      containers[this.containerId] = {
        ...targetBox,
        width: Math.max(targetBox.width, this.metrics?.minimumWidth ?? targetBox.width),
        height: Math.max(targetBox.height + headerDelta, (this.metrics?.newContentTop ?? 0) + visualConfig.bottomPadding)
      };
    }
    if (headerDelta > 0) {
      const descendants = new Set<string>([this.containerId]);
      let added = true;
      while (added) {
        added = false;
        for (const child of Object.values(doc.semantic.containers)) {
          if (child.parentId && descendants.has(child.parentId) && !descendants.has(child.id)) { descendants.add(child.id); added = true; }
        }
      }
      for (const child of descendants) {
        if (child === this.containerId) continue;
        const box = containers[child];
        if (box) containers[child] = { ...box, y: box.y + headerDelta };
      }
      for (const node of Object.values(doc.semantic.nodes)) {
        if (node.containerId && descendants.has(node.containerId) && nodes[node.id]) nodes[node.id] = { ...nodes[node.id], y: nodes[node.id].y + headerDelta };
      }
    }
    let childId: string | undefined = this.containerId;
    let parentId = container.parentId;
    while (childId && parentId) {
      const childBox = containers[childId]; const parentBox = containers[parentId];
      const parentSemantic = doc.semantic.containers[parentId];
      if (!childBox || !parentBox || !parentSemantic) break;
      const config = getContainerVisualConfig(parentSemantic.type);
      containers[parentId] = {
        ...parentBox,
        width: Math.max(parentBox.width, childBox.x - parentBox.x + childBox.width + config.sidePadding),
        height: Math.max(parentBox.height, childBox.y - parentBox.y + childBox.height + config.bottomPadding)
      };
      childId = parentId;
      parentId = doc.semantic.containers[parentId]?.parentId;
    }
    const updated = {
      ...doc,
      semantic: { ...doc.semantic, containers: { ...doc.semantic.containers, [this.containerId]: { ...container, label: this.newLabel } } },
      presentation: { ...doc.presentation, nodes, containers }
    };
    return withUpdatedAt(invalidateRoutes(updated));
  }
}

export class UpdateConnectionLabelCommand extends SnapshotCommand {
  constructor(private connectionId: string, private newLabel: string) {
    super('rename-edge', 'Update Connection Label');
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const connection = doc.semantic.connections[this.connectionId];
    if (!connection || connection.label === this.newLabel) return doc;
    const updated = {
      ...doc,
      semantic: { ...doc.semantic, connections: { ...doc.semantic.connections, [this.connectionId]: { ...connection, label: this.newLabel } } }
    };
    return withUpdatedAt(invalidateRoutes(updated));
  }
}

export class CreateConnectionCommand extends SnapshotCommand {
  constructor(private connection: IRConnection, private sides: Pick<ConnectionPresentation, 'sourceSide' | 'targetSide'> = {}) {
    super('create-edge', 'Create Connection');
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    if (doc.semantic.connections[this.connection.id] || !doc.semantic.nodes[this.connection.source] || !doc.semantic.nodes[this.connection.target]) return doc;
    const withoutRoutes = invalidateRoutes(doc);
    const connections = { ...withoutRoutes.semantic.connections, [this.connection.id]: { ...this.connection } };
    let presentations = withoutRoutes.presentation.connections;
    if (this.sides.sourceSide || this.sides.targetSide) {
      presentations = { ...(presentations ?? {}), [this.connection.id]: { ...this.sides } };
    }
    return withUpdatedAt({
      ...withoutRoutes,
      semantic: { ...withoutRoutes.semantic, connections },
      presentation: { ...withoutRoutes.presentation, ...(presentations ? { connections: presentations } : {}) }
    });
  }
}

export class ReconnectConnectionCommand extends SnapshotCommand {
  constructor(
    private connectionId: string,
    private newSource: string,
    private newTarget: string,
    private sourceHandle?: string | null,
    private targetHandle?: string | null
  ) {
    super('reconnect-edge', 'Reconnect Connection');
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const connection = doc.semantic.connections[this.connectionId];
    if (!connection || !doc.semantic.nodes[this.newSource] || !doc.semantic.nodes[this.newTarget]) return doc;
    const oldPresentation = doc.presentation.connections?.[this.connectionId] ?? {};
    const sourceSide = sideFromHandle(this.sourceHandle, 'source') ?? oldPresentation.sourceSide;
    const targetSide = sideFromHandle(this.targetHandle, 'target') ?? oldPresentation.targetSide;
    if (connection.source === this.newSource && connection.target === this.newTarget && sourceSide === oldPresentation.sourceSide && targetSide === oldPresentation.targetSide) return doc;

    const withoutRoutes = invalidateRoutes(doc);
    const updatedConnection = { ...connection, source: this.newSource, target: this.newTarget };
    let presentations = withoutRoutes.presentation.connections;
    if (sourceSide || targetSide || presentations?.[this.connectionId]) {
      presentations = { ...(presentations ?? {}), [this.connectionId]: { ...(presentations?.[this.connectionId] ?? {}), sourceSide, targetSide } };
    }
    return withUpdatedAt({
      ...withoutRoutes,
      semantic: { ...withoutRoutes.semantic, connections: { ...withoutRoutes.semantic.connections, [this.connectionId]: updatedConnection } },
      presentation: { ...withoutRoutes.presentation, ...(presentations ? { connections: presentations } : {}) }
    });
  }
}

export class DeleteSelectionCommand extends SnapshotCommand {
  constructor(
    private selectedNodes: string[],
    private selectedContainers: string[],
    private selectedConnections: string[]
  ) {
    super('delete-selection', 'Delete Selection');
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const containersToDelete = new Set(this.selectedContainers.filter(id => doc.semantic.containers[id]));
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const container of Object.values(doc.semantic.containers)) {
        if (container.parentId && containersToDelete.has(container.parentId) && !containersToDelete.has(container.id)) {
          containersToDelete.add(container.id);
          expanded = true;
        }
      }
    }
    const nodesToDelete = new Set(this.selectedNodes.filter(id => doc.semantic.nodes[id]));
    for (const node of Object.values(doc.semantic.nodes)) if (node.containerId && containersToDelete.has(node.containerId)) nodesToDelete.add(node.id);
    const connectionsToDelete = new Set(this.selectedConnections.filter(id => doc.semantic.connections[id]));
    for (const connection of Object.values(doc.semantic.connections)) {
      if (nodesToDelete.has(connection.source) || nodesToDelete.has(connection.target)) connectionsToDelete.add(connection.id);
    }
    if (!nodesToDelete.size && !containersToDelete.size && !connectionsToDelete.size) return doc;

    const nodes = { ...doc.semantic.nodes };
    const nodePresentation = { ...doc.presentation.nodes };
    const containers = { ...doc.semantic.containers };
    const containerPresentation = { ...doc.presentation.containers };
    const connections = { ...doc.semantic.connections };
    for (const id of nodesToDelete) { delete nodes[id]; delete nodePresentation[id]; }
    for (const id of containersToDelete) { delete containers[id]; delete containerPresentation[id]; }
    for (const id of connectionsToDelete) delete connections[id];

    const base = {
      ...doc,
      semantic: { ...doc.semantic, nodes, connections, containers },
      presentation: { ...doc.presentation, nodes: nodePresentation, containers: containerPresentation }
    };
    return withUpdatedAt(invalidateRoutes(base, [...connectionsToDelete]));
  }
}

/** Compatibility wrapper for callers that already provide node and edge snapshots. */
export class DeleteElementsCommand extends SnapshotCommand {
  constructor(
    private deletedNodes: Record<string, { node: IRNode; presentation: NodePresentation }>,
    private deletedConnections: Record<string, IRConnection>
  ) {
    super('delete-elements', 'Delete Elements');
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    return new DeleteSelectionCommand(Object.keys(this.deletedNodes), [], Object.keys(this.deletedConnections)).execute(doc);
  }
}

export class ApplyLayoutCommand extends SnapshotCommand {
  constructor(
    private oldNodePresentation: Record<string, NodePresentation>,
    private oldContainerPresentation: Record<string, ContainerPresentation>,
    private newNodePresentation: Record<string, NodePresentation>,
    private newContainerPresentation: Record<string, ContainerPresentation>,
    private newConnectionPresentation?: Record<string, ConnectionPresentation>
  ) {
    super('layout', 'Auto Layout');
  }

  protected build(doc: DiagramDocument): DiagramDocument {
    const connections = this.newConnectionPresentation ?? doc.presentation.connections;
    if (JSON.stringify(doc.presentation.nodes) === JSON.stringify(this.newNodePresentation) &&
      JSON.stringify(doc.presentation.containers) === JSON.stringify(this.newContainerPresentation) &&
      JSON.stringify(doc.presentation.connections) === JSON.stringify(connections)) return doc;
    return withUpdatedAt({
      ...doc,
      presentation: {
        ...doc.presentation,
        nodes: this.newNodePresentation,
        containers: this.newContainerPresentation,
        ...(connections ? { connections } : {})
      }
    });
  }
}

export class SetDiagramDocumentCommand implements Command {
  readonly id = commandId('replace-document');
  readonly documentChangeKind = 'replacement' as const;
  readonly description: string;

  constructor(
    private previousDoc: DiagramDocument,
    private nextDoc: DiagramDocument,
    description = 'Replace Diagram'
  ) {
    this.description = description;
  }

  execute(): DiagramDocument { return this.nextDoc; }
  undo(): DiagramDocument { return this.previousDoc; }
}
