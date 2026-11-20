import { ensureNodeId } from '../../../renv/projects/freemind-web-canvas/src/freemind-core.mjs';

/**
 * Converts a parsed FreeMind in-memory tree into graph nodes and edges,
 * then saves them into the GraphStorageAdapter.
 */
export async function saveTreeToGraph(storage, mapId, title, rootNode) {
  const usedIds = new Set();
  ensureNodeId(rootNode, usedIds);

  // 1. Create or update the Map record
  await storage.createMap({
    id: mapId,
    title: title || rootNode.text || 'Untitled Map',
    root_id: rootNode.id
  });

  // 2. Traverse tree and save nodes + edges
  const allNodes = [];
  const allEdges = [];

  function traverse(node, parent = null, sortOrder = 0) {
    ensureNodeId(node, usedIds);

    const graphNode = {
      id: node.id,
      map_id: mapId,
      text: node.text || '',
      note: node.note || null,
      folded: Boolean(node.folded),
      side: node.position || null,
      color: node.color || null,
      style: node.style || null,
      font_family: node.font?.name || null,
      font_size: node.font?.size || null,
      font_bold: Boolean(node.font?.bold),
      font_italic: Boolean(node.font?.italic),
      font_underline: Boolean(node.font?.underline),
      hgap: node.hGap ?? 20,
      vgap: node.vGap ?? 3,
      shift_y: node.shiftY ?? 0,
      raw_props: {
        bg: node.bg,
        textAlign: node.textAlign,
        edge: node.edge,
        rich: node.rich,
        cloud: node.cloud,
        attrs: node.attrs || [],
        icons: node.icons || []
      }
    };
    allNodes.push(graphNode);

    // Parent-child hierarchy edge
    if (parent) {
      allEdges.push({
        id: `rel_${parent.id}_to_${node.id}`,
        map_id: mapId,
        source: parent.id,
        target: node.id,
        type: 'PARENT_OF',
        sort_order: sortOrder,
        props: {}
      });
    }

    // Arrowlinks (cross-link edges)
    if (Array.isArray(node.arrowlinks)) {
      for (const al of node.arrowlinks) {
        if (al.target) {
          allEdges.push({
            id: al.id || `al_${node.id}_${al.target}`,
            map_id: mapId,
            source: node.id,
            target: al.target,
            type: 'CONNECTS_TO',
            sort_order: 0,
            props: {
              color: al.color,
              startArrow: al.startArrow,
              endArrow: al.endArrow,
              label: al.label
            }
          });
        }
      }
    }

    // Recurse children
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) {
        traverse(node.children[i], node, i);
      }
    }
  }

  traverse(rootNode);

  // Batch insert nodes and edges
  for (const n of allNodes) {
    await storage.addNode(n);
  }
  for (const e of allEdges) {
    await storage.addEdge(e);
  }

  return { mapId, nodeCount: allNodes.length, edgeCount: allEdges.length };
}

/**
 * Rehydrates a mind map tree from the GraphStorageAdapter back into
 * the standard freemind-core in-memory object format.
 */
export async function loadTreeFromGraph(storage, mapId) {
  const map = await storage.getMap(mapId);
  if (!map) throw new Error(`Map not found: ${mapId}`);

  // Fetch all edges for the map
  const edges = await storage.getEdges(mapId);
  const parentEdges = edges.filter(e => e.type === 'PARENT_OF');
  const arrowEdges = edges.filter(e => e.type === 'CONNECTS_TO');

  // Fetch all nodes
  const nodesRows = await storage.getSubtree(map.root_id);
  const nodeMap = new Map();

  for (const row of nodesRows) {
    const raw = row.raw_props || {};
    const nodeObj = {
      id: row.id,
      text: row.text || '',
      note: row.note || null,
      folded: Boolean(row.folded),
      position: row.side || null,
      color: row.color || null,
      bg: raw.bg || null,
      textAlign: raw.textAlign || null,
      style: row.style || null,
      font: (row.font_family || row.font_size) ? {
        name: row.font_family,
        size: row.font_size,
        bold: Boolean(row.font_bold),
        italic: Boolean(row.font_italic),
        underline: Boolean(row.font_underline)
      } : null,
      edge: raw.edge || null,
      rich: raw.rich || null,
      cloud: raw.cloud || null,
      attrs: raw.attrs || [],
      icons: raw.icons || [],
      arrowlinks: [],
      children: [],
      hGap: row.hgap ?? 20,
      vGap: row.vgap ?? 3,
      shiftY: row.shift_y ?? 0
    };
    nodeMap.set(row.id, nodeObj);
  }

  // Attach arrowlinks
  for (const al of arrowEdges) {
    const sourceNode = nodeMap.get(al.source);
    if (sourceNode) {
      sourceNode.arrowlinks.push({
        id: al.id,
        target: al.target,
        color: al.props?.color,
        startArrow: al.props?.startArrow,
        endArrow: al.props?.endArrow,
        label: al.props?.label
      });
    }
  }

  // Build hierarchy based on parentEdges sorted by sort_order
  parentEdges.sort((a, b) => a.sort_order - b.sort_order);
  for (const pe of parentEdges) {
    const parentNode = nodeMap.get(pe.source);
    const childNode = nodeMap.get(pe.target);
    if (parentNode && childNode) {
      parentNode.children.push(childNode);
    }
  }

  const root = nodeMap.get(map.root_id);
  return { map, root };
}
