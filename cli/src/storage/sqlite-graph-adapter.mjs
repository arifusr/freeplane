import { DatabaseSync } from 'node:sqlite';
import { GraphStorageAdapter } from './adapter.mjs';

export class SQLiteGraphAdapter extends GraphStorageAdapter {
  constructor(options = {}) {
    super(options);
    this.dbPath = options.dbPath || './mindmaps.db';
    this.db = null;
  }

  async init() {
    this.db = new DatabaseSync(this.dbPath);
    // WAL + busy_timeout memungkinkan sesi TUI dan proses CLI lain membaca/
    // menulis database yang sama tanpa saling mengunci.
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Schema initialization
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        root_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        label TEXT DEFAULT 'MindNode',
        text TEXT NOT NULL DEFAULT '',
        note TEXT,
        folded INTEGER DEFAULT 0,
        side TEXT,
        color TEXT,
        style TEXT,
        font_family TEXT,
        font_size INTEGER,
        font_bold INTEGER DEFAULT 0,
        font_italic INTEGER DEFAULT 0,
        font_underline INTEGER DEFAULT 0,
        hgap INTEGER DEFAULT 20,
        vgap INTEGER DEFAULT 3,
        shift_y INTEGER DEFAULT 0,
        raw_props TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_map ON nodes(map_id);

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        props TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source, type, target);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target, type, source);
      CREATE INDEX IF NOT EXISTS idx_edges_map ON edges(map_id);

      -- FTS5 Full-Text Search
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        node_id UNINDEXED,
        map_id UNINDEXED,
        text,
        note
      );

      -- Triggers for FTS synchronization
      CREATE TRIGGER IF NOT EXISTS trg_nodes_fts_insert AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(node_id, map_id, text, note)
        VALUES (new.id, new.map_id, new.text, coalesce(new.note, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS trg_nodes_fts_delete AFTER DELETE ON nodes BEGIN
        DELETE FROM nodes_fts WHERE node_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_nodes_fts_update AFTER UPDATE ON nodes BEGIN
        DELETE FROM nodes_fts WHERE node_id = old.id;
        INSERT INTO nodes_fts(node_id, map_id, text, note)
        VALUES (new.id, new.map_id, new.text, coalesce(new.note, ''));
      END;
    `);
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Naik setiap ada transaksi dari koneksi lain (proses CLI / agent lain).
  // Dipakai TUI untuk mendeteksi perubahan peta secara eksternal.
  getDataVersion() {
    if (!this.db) return 0;
    const row = this.db.prepare('PRAGMA data_version').get();
    return Number(row?.data_version || 0);
  }

  // --- Maps Management ---

  async createMap({ id, title, root_id = null }) {
    const stmt = this.db.prepare(`
      INSERT INTO maps (id, title, root_id, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, root_id = excluded.root_id, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(id, title, root_id);
    return this.getMap(id);
  }

  async getMap(mapId) {
    const row = this.db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
    if (!row) return null;
    const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes WHERE map_id = ?').get(mapId);
    const edgeCount = this.db.prepare('SELECT COUNT(*) as count FROM edges WHERE map_id = ?').get(mapId);
    return {
      ...row,
      node_count: nodeCount?.count || 0,
      edge_count: edgeCount?.count || 0
    };
  }

  async listMaps() {
    const rows = this.db.prepare(`
      SELECT m.*, 
        (SELECT COUNT(*) FROM nodes n WHERE n.map_id = m.id) as node_count,
        (SELECT COUNT(*) FROM edges e WHERE e.map_id = m.id) as edge_count
      FROM maps m
      ORDER BY m.updated_at DESC
    `).all();
    return rows;
  }

  async deleteMap(mapId) {
    this.db.prepare('DELETE FROM maps WHERE id = ?').run(mapId);
    return true;
  }

  // --- Node Operations ---

  async addNode(node) {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (
        id, map_id, label, text, note, folded, side, color, style,
        font_family, font_size, font_bold, font_italic, font_underline,
        hgap, vgap, shift_y, raw_props, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        note = excluded.note,
        folded = excluded.folded,
        side = excluded.side,
        color = excluded.color,
        style = excluded.style,
        font_family = excluded.font_family,
        font_size = excluded.font_size,
        font_bold = excluded.font_bold,
        font_italic = excluded.font_italic,
        font_underline = excluded.font_underline,
        hgap = excluded.hgap,
        vgap = excluded.vgap,
        shift_y = excluded.shift_y,
        raw_props = excluded.raw_props,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      node.id,
      node.map_id,
      node.label || 'MindNode',
      node.text || '',
      node.note || null,
      node.folded ? 1 : 0,
      node.side || null,
      node.color || null,
      node.style || null,
      node.font_family || null,
      node.font_size || null,
      node.font_bold ? 1 : 0,
      node.font_italic ? 1 : 0,
      node.font_underline ? 1 : 0,
      node.hgap ?? 20,
      node.vgap ?? 3,
      node.shift_y ?? 0,
      JSON.stringify(node.raw_props || {})
    );
    return this.getNode(node.id);
  }

  async getNode(nodeId) {
    const node = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
    if (!node) return null;
    return {
      ...node,
      folded: Boolean(node.folded),
      font_bold: Boolean(node.font_bold),
      font_italic: Boolean(node.font_italic),
      font_underline: Boolean(node.font_underline),
      raw_props: JSON.parse(node.raw_props || '{}')
    };
  }

  async updateNode(nodeId, updates = {}) {
    const existing = await this.getNode(nodeId);
    if (!existing) throw new Error(`Node not found: ${nodeId}`);
    const merged = { ...existing, ...updates };
    return this.addNode(merged);
  }

  async deleteNode(nodeId) {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    return true;
  }

  // --- Edge Operations ---

  async addEdge(edge) {
    const stmt = this.db.prepare(`
      INSERT INTO edges (id, map_id, source, target, type, sort_order, props)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sort_order = excluded.sort_order,
        props = excluded.props
    `);
    const id = edge.id || `edge_${edge.source}_${edge.type}_${edge.target}`;
    stmt.run(
      id,
      edge.map_id,
      edge.source,
      edge.target,
      edge.type,
      edge.sort_order ?? 0,
      JSON.stringify(edge.props || {})
    );
    return { ...edge, id };
  }

  async deleteEdge(edgeId) {
    this.db.prepare('DELETE FROM edges WHERE id = ?').run(edgeId);
    return true;
  }

  async getEdges(mapId, { type = null, source = null, target = null } = {}) {
    let sql = 'SELECT * FROM edges WHERE map_id = ?';
    const params = [mapId];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }
    if (target) {
      sql += ' AND target = ?';
      params.push(target);
    }
    sql += ' ORDER BY sort_order ASC';
    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => ({ ...r, props: JSON.parse(r.props || '{}') }));
  }

  // --- Graph Traversal & Queries ---

  async getSubtree(rootNodeId) {
    const query = `
      WITH RECURSIVE tree(id, parent_id, depth, sort_order, path) AS (
        SELECT id, NULL as parent_id, 0 as depth, 0 as sort_order, id as path
        FROM nodes
        WHERE id = ?
        UNION ALL
        SELECT 
          e.target as id,
          e.source as parent_id,
          t.depth + 1 as depth,
          e.sort_order as sort_order,
          t.path || '/' || e.target as path
        FROM tree t
        JOIN edges e ON e.source = t.id AND e.type = 'PARENT_OF'
      )
      SELECT 
        t.depth, t.parent_id, t.sort_order, t.path,
        n.*
      FROM tree t
      JOIN nodes n ON n.id = t.id
      ORDER BY t.depth ASC, t.sort_order ASC;
    `;
    const rows = this.db.prepare(query).all(rootNodeId);
    return rows.map(r => ({
      ...r,
      folded: Boolean(r.folded),
      font_bold: Boolean(r.font_bold),
      font_italic: Boolean(r.font_italic),
      font_underline: Boolean(r.font_underline),
      raw_props: JSON.parse(r.raw_props || '{}')
    }));
  }

  async getNeighborhood(nodeId, hops = 2) {
    const query = `
      WITH RECURSIVE neighbors(curr_id, hop, path, last_edge_type, last_edge_id) AS (
        SELECT ?, 0, ?, NULL, NULL
        UNION
        SELECT 
          CASE WHEN e.source = nb.curr_id THEN e.target ELSE e.source END as curr_id,
          nb.hop + 1 as hop,
          nb.path || ' -[' || e.type || ']-> ' || CASE WHEN e.source = nb.curr_id THEN e.target ELSE e.source END,
          e.type,
          e.id
        FROM neighbors nb
        JOIN edges e ON (e.source = nb.curr_id OR e.target = nb.curr_id)
        WHERE nb.hop < ?
          AND INSTR(nb.path, CASE WHEN e.source = nb.curr_id THEN e.target ELSE e.source END) = 0
      )
      SELECT DISTINCT 
        nb.curr_id as node_id,
        nb.hop,
        nb.path,
        nb.last_edge_type,
        n.text,
        n.note,
        n.folded,
        n.color,
        n.map_id
      FROM neighbors nb
      JOIN nodes n ON n.id = nb.curr_id
      ORDER BY nb.hop ASC;
    `;
    const rows = this.db.prepare(query).all(nodeId, nodeId, hops);
    return rows;
  }

  async findPath(sourceId, targetId, maxHops = 10) {
    const query = `
      WITH RECURSIVE search_path(curr_id, target_id, hop, path) AS (
        SELECT ?, ?, 0, ?
        UNION ALL
        SELECT 
          CASE WHEN e.source = p.curr_id THEN e.target ELSE e.source END,
          p.target_id,
          p.hop + 1,
          p.path || ' -> ' || CASE WHEN e.source = p.curr_id THEN e.target ELSE e.source END
        FROM search_path p
        JOIN edges e ON (e.source = p.curr_id OR e.target = p.curr_id)
        WHERE p.curr_id != p.target_id
          AND p.hop < ?
          AND INSTR(p.path, CASE WHEN e.source = p.curr_id THEN e.target ELSE e.source END) = 0
      )
      SELECT path, hop 
      FROM search_path 
      WHERE curr_id = target_id 
      ORDER BY hop ASC 
      LIMIT 1;
    `;
    return this.db.prepare(query).get(sourceId, targetId, sourceId, maxHops) || null;
  }

  async search(queryText, mapId = null) {
    // Sanitize query for FTS5 (avoid syntax errors on arbitrary symbols)
    const sanitized = queryText.replace(/['"*/]/g, ' ').trim();
    if (!sanitized) return [];

    let sql = `
      SELECT 
        f.node_id, f.map_id, f.text, f.note,
        snippet(nodes_fts, 2, '<b>', '</b>', '...', 10) as text_snippet,
        snippet(nodes_fts, 3, '<b>', '</b>', '...', 10) as note_snippet,
        m.title as map_title
      FROM nodes_fts f
      JOIN maps m ON m.id = f.map_id
      WHERE nodes_fts MATCH ?
    `;
    const params = [sanitized + '*'];

    if (mapId) {
      sql += ' AND f.map_id = ?';
      params.push(mapId);
    }
    sql += ' LIMIT 50';

    try {
      return this.db.prepare(sql).all(...params);
    } catch {
      // Fallback to LIKE if FTS parsing fails on strange tokens
      let fallbackSql = `
        SELECT n.id as node_id, n.map_id, n.text, n.note, m.title as map_title
        FROM nodes n
        JOIN maps m ON m.id = n.map_id
        WHERE (n.text LIKE ? OR n.note LIKE ?)
      `;
      const likeParam = `%${queryText}%`;
      const fbParams = [likeParam, likeParam];
      if (mapId) {
        fallbackSql += ' AND n.map_id = ?';
        fbParams.push(mapId);
      }
      return this.db.prepare(fallbackSql).all(...fbParams);
    }
  }

  async query(queryString, params = {}) {
    // If it's a raw SQL query, execute directly
    const trimmed = queryString.trim();
    if (trimmed.toUpperCase().startsWith('SELECT') || trimmed.toUpperCase().startsWith('WITH')) {
      return this.db.prepare(trimmed).all(params);
    }
    // Simple Cypher emulation if query starts with MATCH
    // e.g. MATCH (n:MindNode) WHERE n.text CONTAINS '...' RETURN n
    if (trimmed.toUpperCase().startsWith('MATCH')) {
      return this.executeSimpleCypher(trimmed);
    }
    return this.db.exec(trimmed);
  }

  executeSimpleCypher(cypher) {
    // Basic Cypher pattern mapper for convenience
    // 1. MATCH (n:MindNode) RETURN n
    if (/MATCH\s*\(n(?::\w+)?\)\s*RETURN\s*n/i.test(cypher)) {
      return this.db.prepare('SELECT * FROM nodes LIMIT 50').all();
    }
    // 2. MATCH (m:Map) RETURN m
    if (/MATCH\s*\(m(?::Map)?\)\s*RETURN\s*m/i.test(cypher)) {
      return this.db.prepare('SELECT * FROM maps LIMIT 50').all();
    }
    // 3. MATCH (n)-[:CONNECTS_TO]->(m)
    if (/CONNECTS_TO/i.test(cypher)) {
      return this.db.prepare(`
        SELECT e.id as edge_id, s.text as source_text, t.text as target_text, e.props
        FROM edges e
        JOIN nodes s ON s.id = e.source
        JOIN nodes t ON t.id = e.target
        WHERE e.type = 'CONNECTS_TO'
      `).all();
    }
    // Generic fallback: return all nodes
    return this.db.prepare('SELECT id, text, note FROM nodes LIMIT 30').all();
  }
}
