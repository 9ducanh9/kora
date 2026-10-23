import { KoraArchitectureModel, IRContainer, IRNode } from '../ir/types';

/**
 * Positively identifies whether a node is an AWS service or resource.
 * Never relies on negative exclusion (e.g. kind !== 'external').
 * Generic and external nodes are never treated as AWS entities.
 */
export function isAwsNode(node: { kind?: string; assetId?: string }): boolean {
  if (node.kind === 'aws-service' || node.kind === 'aws-resource') {
    return true;
  }
  if (node.assetId && node.assetId.toLowerCase().startsWith('aws.')) {
    return true;
  }
  return false;
}

/**
 * Positively identifies whether a container is an AWS container.
 * Logical groups need positive AWS evidence in their descendants. Empty, browser,
 * third-party and mixed-provider groups are not assumed to be AWS boundaries.
 */
export function isAwsContainer(
  container: { type: string; id?: string },
  nodes: { kind?: string; containerId?: string; assetId?: string }[] = [],
  containers: { type: string; id: string; parentId?: string }[] = []
): boolean {
  if (container.type === 'corporate-data-center') {
    return false;
  }
  if (container.type === 'generic-group') {
    if (!container.id) return false;
    const descendants = new Set([container.id]);
    const pending = [container.id];
    let hasAwsBoundary = false;
    while (pending.length) {
      const parent = pending.pop();
      for (const child of containers.filter(item => item.parentId === parent)) {
        if (descendants.has(child.id)) continue;
        if (child.type === 'corporate-data-center') return false;
        if (child.type !== 'generic-group') hasAwsBoundary = true;
        descendants.add(child.id);
        pending.push(child.id);
      }
    }
    const members = nodes.filter(node => node.containerId && descendants.has(node.containerId));
    if (members.some(node => node.kind === 'external' || node.kind === 'actor')) return false;
    return hasAwsBoundary || members.some(isAwsNode);
  }
  return true;
}

/**
 * Enforces exactly ONE canonical AWS Cloud root boundary:
 * - If absent and AWS resources exist: creates one with origin: 'system'
 * - If an explicit AWS Cloud exists: reuses and canonicalizes it (origin: 'explicit')
 * - If duplicate AWS Cloud containers exist: canonicalizes to the primary root and safely remaps references
 * - Scopes unassigned AWS nodes and top-level AWS containers inside AWS Cloud
 * - Preserves existing explicit child/parent relationships untouched (e.g. VPC -> Subnet -> ECS)
 * - Generic/external nodes and corporate data centers remain strictly outside AWS Cloud
 * - Never infers VPC, Region, AZ, or Subnet membership
 */
export function ensureAwsCloudHierarchy(model: KoraArchitectureModel): KoraArchitectureModel {
  const hasAwsNodes = model.nodes.some(isAwsNode);
  const hasAwsContainers = model.containers.some(c => isAwsContainer(c, model.nodes, model.containers) && c.type !== 'cloud');

  if (!hasAwsNodes && !hasAwsContainers) {
    return model;
  }

  // 1. Identify all cloud containers to handle absent, existing, and duplicate cases
  const cloudContainers = model.containers.filter(c => c.type === 'cloud');

  let canonicalCloudId = 'cloud-aws';
  let canonicalCloudOrigin: 'explicit' | 'system' = 'system';
  let canonicalCloudLabel = 'AWS Cloud';
  const duplicateCloudIds = new Set<string>();

  if (cloudContainers.length > 0) {
    // Reuse the first cloud container as canonical
    const primaryCloud = cloudContainers[0];
    canonicalCloudId = primaryCloud.id;
    canonicalCloudLabel = primaryCloud.label || 'AWS Cloud';
    canonicalCloudOrigin = primaryCloud.origin || 'explicit';

    // Track any duplicate cloud containers for safe reference remapping
    for (let i = 1; i < cloudContainers.length; i++) {
      duplicateCloudIds.add(cloudContainers[i].id);
    }
  } else {
    // Generated system boundary must not take an ID already owned by a node/container.
    const occupiedIds = new Set([...model.nodes.map(node => node.id), ...model.containers.map(container => container.id)]);
    let suffix = 1;
    canonicalCloudId = 'cloud-aws';
    while (occupiedIds.has(canonicalCloudId)) canonicalCloudId = `cloud-aws-${++suffix}`;
  }

  const remapContainerId = (id?: string): string | undefined => {
    if (!id) return undefined;
    if (duplicateCloudIds.has(id)) return canonicalCloudId;
    return id;
  };

  // 2. Canonicalize containers: drop duplicate clouds, remap parent references, attach top-level AWS containers
  const canonicalContainers: IRContainer[] = [];
  let addedCloud = false;

  for (const c of model.containers) {
    if (c.id === canonicalCloudId || c.type === 'cloud') {
      if (!addedCloud) {
        canonicalContainers.push({
          ...c,
          id: canonicalCloudId,
          label: canonicalCloudLabel,
          type: 'cloud',
          parentId: undefined, // AWS Cloud is always root
          origin: canonicalCloudOrigin
        });
        addedCloud = true;
      }
      // Duplicate cloud containers are filtered out
      continue;
    }

    const remappedParentId = remapContainerId(c.parentId);

    if (isAwsContainer(c, model.nodes, model.containers)) {
      if (!remappedParentId) {
        // Top-level AWS container without parent gets attached to AWS Cloud
        canonicalContainers.push({
          ...c,
          parentId: canonicalCloudId
        });
      } else {
        // Preserves existing explicit parent relationship
        canonicalContainers.push({
          ...c,
          parentId: remappedParentId
        });
      }
    } else {
      // Non-AWS container (e.g. corporate-data-center) remains outside AWS Cloud
      canonicalContainers.push({
        ...c,
        parentId: remappedParentId
      });
    }
  }

  // If no cloud container existed, insert the system-generated cloud root
  if (!addedCloud) {
    canonicalContainers.unshift({
      id: canonicalCloudId,
      label: canonicalCloudLabel,
      type: 'cloud',
      origin: 'system'
    });
  }

  // 3. Canonicalize nodes: attach unassigned AWS nodes to AWS Cloud; keep external and generic nodes outside
  const canonicalNodes: IRNode[] = model.nodes.map(n => {
    const remappedContainerId = remapContainerId(n.containerId);

    if (isAwsNode(n)) {
      if (!remappedContainerId) {
        // Unassigned AWS node enclosed by AWS Cloud
        return {
          ...n,
          containerId: canonicalCloudId
        };
      }
      // Explicitly contained AWS node preserves its container
      return {
        ...n,
        containerId: remappedContainerId
      };
    }

    // Generic, external, or actor nodes remain strictly outside AWS Cloud
    return {
      ...n,
      containerId: remappedContainerId
    };
  });

  return {
    ...model,
    nodes: canonicalNodes,
    containers: canonicalContainers
  };
}

/**
 * Single core architecture preparation pipeline.
 * Every architecture source (AI generation, test fixture, local storage, manual import)
 * passes through this pipeline to enforce architectural invariants.
 */
export function prepareArchitectureModel(model: KoraArchitectureModel): KoraArchitectureModel {
  return ensureAwsCloudHierarchy(model);
}
