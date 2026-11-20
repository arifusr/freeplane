import { GraphStorageAdapter } from './adapter.mjs';

export class LadybugAdapter extends GraphStorageAdapter {
  constructor(options = {}) {
    super(options);
    this.dbPath = options.dbPath || './mindmaps.lbug';
    this.db = null;
    this.conn = null;
    this.driver = null;
  }

  async init() {
    try {
      // Dynamic import to allow optional dependency
      this.driver = await import('@ladybugdb/core').catch(() => import('kuzu'));
    } catch {
      throw new Error(
        'LadybugDB driver (@ladybugdb/core or kuzu) is not installed.\n' +
        'You can install it with: npm install @ladybugdb/core\n' +
        'Or run fmap with the embedded SQLite engine (default).'
      );
    }

    const { Database, Connection } = this.driver;
    this.db = new Database(this.dbPath);
    this.conn = new Connection(this.db);

    // Initialize Ladybug Property Graph Schema
    await this.conn.query(`
      CREATE NODE TABLE IF NOT EXISTS Map (
        id STRING,
        title STRING,
        root_id STRING,
        created_at TIMESTAMP,
        PRIMARY KEY (id)
      );

      CREATE NODE TABLE IF NOT EXISTS MindNode (
        id STRING,
        map_id STRING,
        text STRING,
        note STRING,
        folded BOOLEAN,
        side STRING,
        color STRING,
        style STRING,
        font_family STRING,
        font_size INT64,
        font_bold BOOLEAN,
        font_italic BOOLEAN,
        font_underline BOOLEAN,
        hgap INT64,
        vgap INT64,
        shift_y INT64,
        raw_props STRING,
        PRIMARY KEY (id)
      );

      CREATE REL TABLE IF NOT EXISTS PARENT_OF (
        FROM MindNode TO MindNode,
        map_id STRING,
        sort_order INT64,
        MANY_ONE
      );

      CREATE REL TABLE IF NOT EXISTS CONNECTS_TO (
        FROM MindNode TO MindNode,
        id STRING,
        map_id STRING,
        color STRING,
        arrow_start STRING,
        arrow_end STRING,
        label STRING,
        props STRING,
        MANY_MANY
      );

      CREATE REL TABLE IF NOT EXISTS HAS_TAG (
        FROM MindNode TO MindNode,
        name STRING,
        MANY_MANY
      );
    `);
  }

  async close() {
    this.conn = null;
    this.db = null;
  }

  async createMap({ id, title, root_id = null }) {
    await this.conn.query(
      `MERGE (m:Map {id: $id}) ON CREATE SET m.title = $title, m.root_id = $root_id, m.created_at = timestamp();`,
      { id, title, root_id }
    );
    return this.getMap(id);
  }

  async getMap(mapId) {
    const res = await this.conn.query(`MATCH (m:Map {id: $id}) RETURN m.*;`, { id: mapId });
    const rows = await res.getAll();
    return rows[0] || null;
  }

  async listMaps() {
    const res = await this.conn.query(`MATCH (m:Map) RETURN m.* ORDER BY m.created_at DESC;`);
    return await res.getAll();
  }

  async deleteMap(mapId) {
    await this.conn.query(`MATCH (m:Map {id: $id}) DETACH DELETE m;`, { id: mapId });
    await this.conn.query(`MATCH (n:MindNode {map_id: $id}) DETACH DELETE n;`, { id: mapId });
    return true;
  }

  async addNode(node) {
    await this.conn.query(`
      MERGE (n:MindNode {id: $id})
      SET n.map_id = $map_id,
          n.text = $text,
          n.note = $note,
          n.folded = $folded,
          n.side = $side,
          n.color = $color,
          n.style = $style,
          n.font_family = $font_family,
          n.font_size = $font_size,
          n.font_bold = $font_bold,
          n.font_italic = $font_italic,
          n.font_underline = $font_underline,
          n.hgap = $hgap,
          n.vgap = $vgap,
          n.shift_y = $shift_y,
          n.raw_props = $raw_props;
    `, {
      id: node.id,
      map_id: node.map_id,
      text: node.text || '',
      note: node.note || '',
      folded: Boolean(node.folded),
      side: node.side || '',
      color: node.color || '',
      style: node.style || '',
      font_family: node.font_family || '',
      font_size: node.font_size || 12,
      font_bold: Boolean(node.font_bold),
      font_italic: Boolean(node.font_italic),
      font_underline: Boolean(node.font_underline),
      hgap: node.hgap ?? 20,
      vgap: node.vgap ?? 3,
      shift_y: node.shift_y ?? 0,
      raw_props: JSON.stringify(node.raw_props || {})
    });
    return this.getNode(node.id);
  }

  async getNode(nodeId) {
    const res = await this.conn.query(`MATCH (n:MindNode {id: $id}) RETURN n.*;`, { id: nodeId });
    const rows = await res.getAll();
    return rows[0] || null;
  }

  async addEdge(edge) {
    if (edge.type === 'PARENT_OF') {
      await this.conn.query(`
        MATCH (p:MindNode {id: $source}), (c:MindNode {id: $target})
        MERGE (p)-[r:PARENT_OF]->(c)
        SET r.map_id = $map_id, r.sort_order = $order;
      `, {
        source: edge.source,
        target: edge.target,
        map_id: edge.map_id,
        order: edge.sort_order ?? 0
      });
    } else if (edge.type === 'CONNECTS_TO') {
      await this.conn.query(`
        MATCH (s:MindNode {id: $source}), (t:MindNode {id: $target})
        MERGE (s)-[r:CONNECTS_TO {id: $id}]->(t)
        SET r.map_id = $map_id, r.color = $color, r.label = $label;
      `, {
        id: edge.id || `conn_${edge.source}_${edge.target}`,
        source: edge.source,
        target: edge.target,
        map_id: edge.map_id,
        color: edge.props?.color || '',
        label: edge.props?.label || ''
      });
    }
    return edge;
  }

  async getSubtree(rootNodeId) {
    const res = await this.conn.query(`
      MATCH (root:MindNode {id: $rootId})
      OPTIONAL MATCH path = (root)-[:PARENT_OF*]->(child:MindNode)
      RETURN root, collect(path) as paths;
    `, { rootId: rootNodeId });
    return await res.getAll();
  }

  async getNeighborhood(nodeId, hops = 2) {
    const res = await this.conn.query(`
      MATCH (center:MindNode {id: $id})
      OPTIONAL MATCH path = (center)-[r:PARENT_OF|CONNECTS_TO*1..${hops}]-(neighbor:MindNode)
      RETURN center, neighbor, r, path;
    `, { id: nodeId });
    return await res.getAll();
  }

  async findPath(sourceId, targetId) {
    const res = await this.conn.query(`
      MATCH p = (a:MindNode {id: $source})-[* SHORTEST]-(b:MindNode {id: $target})
      RETURN p;
    `, { source: sourceId, target: targetId });
    const rows = await res.getAll();
    return rows[0] || null;
  }

  async search(queryText, mapId = null) {
    let cypher = `MATCH (n:MindNode) WHERE n.text CONTAINS $q OR n.note CONTAINS $q`;
    if (mapId) cypher += ` AND n.map_id = $mapId`;
    cypher += ` RETURN n.id as node_id, n.map_id as map_id, n.text as text, n.note as note LIMIT 50;`;
    const res = await this.conn.query(cypher, { q: queryText, mapId });
    return await res.getAll();
  }

  async query(queryString, params = {}) {
    const res = await this.conn.query(queryString, params);
    return await res.getAll();
  }
}
