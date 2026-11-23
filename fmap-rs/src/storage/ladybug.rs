use crate::model::{MapMeta, MapNode, TreeNode};
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use lbug::{Connection, Database, SystemConfig, Value};
use std::collections::HashMap;
use std::path::Path;

pub struct LadybugStorage {
    db: Database,
}

impl LadybugStorage {
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self> {
        let path_str = db_path.as_ref().to_string_lossy().to_string();
        let db = Database::new(&path_str, SystemConfig::default())
            .with_context(|| format!("Gagal membuka database LadybugDB di: {}", path_str))?;

        let storage = Self { db };
        storage.init_schema()?;
        Ok(storage)
    }

    fn conn(&self) -> Result<Connection<'_>> {
        Connection::new(&self.db).context("Gagal membuat koneksi ke LadybugDB")
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn()?;
        let tables_res = conn.query("CALL SHOW_TABLES() RETURN *");
        let mut existing_tables = Vec::new();
        if let Ok(mut res) = tables_res {
            for row in &mut res {
                if row.len() > 1 {
                    existing_tables.push(val_to_string(&row[1]));
                }
            }
        }

        if !existing_tables.contains(&"MindMap".to_string()) {
            conn.query(
                "CREATE NODE TABLE MindMap(
                    id STRING,
                    title STRING,
                    root_id STRING,
                    created_at STRING,
                    updated_at STRING,
                    PRIMARY KEY(id)
                )",
            ).context("Gagal membuat tabel node MindMap")?;
        }

        if !existing_tables.contains(&"MapNode".to_string()) {
            conn.query(
                "CREATE NODE TABLE MapNode(
                    id STRING,
                    map_id STRING,
                    text STRING,
                    note STRING,
                    position STRING,
                    folded BOOLEAN,
                    created_at STRING,
                    updated_at STRING,
                    PRIMARY KEY(id)
                )",
            ).context("Gagal membuat tabel node MapNode")?;
        }

        if !existing_tables.contains(&"PARENT_OF".to_string()) {
            conn.query("CREATE REL TABLE PARENT_OF(FROM MapNode TO MapNode)")
                .context("Gagal membuat tabel relasi PARENT_OF")?;
        }

        if !existing_tables.contains(&"CONNECTS_TO".to_string()) {
            conn.query("CREATE REL TABLE CONNECTS_TO(FROM MapNode TO MapNode)")
                .context("Gagal membuat tabel relasi CONNECTS_TO")?;
        }

        Ok(())
    }

    pub fn list_maps(&self) -> Result<Vec<MapMeta>> {
        let conn = self.conn()?;
        let q = "MATCH (m:MindMap) RETURN m.id, m.title, m.root_id, m.created_at, m.updated_at ORDER BY m.updated_at DESC";
        let mut res = conn.query(q).context("Gagal query list_maps")?;
        let mut maps = Vec::new();

        for row in &mut res {
            if row.len() >= 5 {
                let id = val_to_string(&row[0]);
                let title = val_to_string(&row[1]);
                let root_id = val_to_string(&row[2]);
                let created_at = val_to_string(&row[3]);
                let updated_at = val_to_string(&row[4]);

                // Hitung jumlah node
                let count_q = format!("MATCH (n:MapNode) WHERE n.map_id = '{}' RETURN count(n)", esc_cypher(&id));
                let node_count = if let Ok(mut c_res) = conn.query(&count_q) {
                    c_res.next().and_then(|r| r.get(0).map(val_to_i64)).unwrap_or(0) as usize
                } else {
                    0
                };

                // Hitung jumlah edge
                let edge_q = format!("MATCH (a:MapNode)-[r:PARENT_OF]->(b:MapNode) WHERE a.map_id = '{}' RETURN count(r)", esc_cypher(&id));
                let edge_count = if let Ok(mut e_res) = conn.query(&edge_q) {
                    e_res.next().and_then(|r| r.get(0).map(val_to_i64)).unwrap_or(0) as usize
                } else {
                    0
                };

                maps.push(MapMeta {
                    id,
                    title,
                    root_id,
                    created_at,
                    updated_at,
                    node_count,
                    edge_count,
                });
            }
        }

        Ok(maps)
    }

    pub fn create_map(&self, title: &str, root_text: &str) -> Result<(String, String)> {
        let conn = self.conn()?;
        let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let ts = Utc::now().timestamp_millis();
        let map_id = format!("map_{:x}", ts);
        let root_id = format!("ID_{:x}_root", ts);

        let map_cypher = format!(
            "CREATE (:MindMap {{id: '{}', title: '{}', root_id: '{}', created_at: '{}', updated_at: '{}'}})",
            esc_cypher(&map_id),
            esc_cypher(title),
            esc_cypher(&root_id),
            esc_cypher(&now),
            esc_cypher(&now)
        );
        conn.query(&map_cypher).context("Gagal insert MindMap")?;

        let node_cypher = format!(
            "CREATE (:MapNode {{id: '{}', map_id: '{}', text: '{}', note: '', position: '', folded: false, created_at: '{}', updated_at: '{}'}})",
            esc_cypher(&root_id),
            esc_cypher(&map_id),
            esc_cypher(root_text),
            esc_cypher(&now),
            esc_cypher(&now)
        );
        conn.query(&node_cypher).context("Gagal insert root MapNode")?;

        Ok((map_id, root_id))
    }

    pub fn add_node(&self, map_id: &str, parent_id: &str, text: &str) -> Result<String> {
        let conn = self.conn()?;
        let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let new_id = format!("ID_{:x}", Utc::now().timestamp_nanos_opt().unwrap_or(0));

        let node_q = format!(
            "CREATE (:MapNode {{id: '{}', map_id: '{}', text: '{}', note: '', position: '', folded: false, created_at: '{}', updated_at: '{}'}})",
            esc_cypher(&new_id),
            esc_cypher(map_id),
            esc_cypher(text),
            esc_cypher(&now),
            esc_cypher(&now)
        );
        conn.query(&node_q).context("Gagal create child node")?;

        let rel_q = format!(
            "MATCH (p:MapNode {{id: '{}'}}), (c:MapNode {{id: '{}'}}) CREATE (p)-[:PARENT_OF]->(c)",
            esc_cypher(parent_id),
            esc_cypher(&new_id)
        );
        conn.query(&rel_q).context("Gagal link PARENT_OF")?;

        let touch_q = format!(
            "MATCH (m:MindMap {{id: '{}'}}) SET m.updated_at = '{}'",
            esc_cypher(map_id),
            esc_cypher(&now)
        );
        let _ = conn.query(&touch_q);

        Ok(new_id)
    }

    pub fn edit_node(&self, node_id: &str, text: &str) -> Result<()> {
        let conn = self.conn()?;
        let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let q = format!(
            "MATCH (n:MapNode {{id: '{}'}}) SET n.text = '{}', n.updated_at = '{}'",
            esc_cypher(node_id),
            esc_cypher(text),
            esc_cypher(&now)
        );
        conn.query(&q).context("Gagal update teks node")?;
        Ok(())
    }

    pub fn delete_node(&self, node_id: &str) -> Result<()> {
        let conn = self.conn()?;
        let rel_q = format!("MATCH (a:MapNode)-[r:PARENT_OF]->(b:MapNode) WHERE a.id = '{}' OR b.id = '{}' DELETE r", esc_cypher(node_id), esc_cypher(node_id));
        let _ = conn.query(&rel_q);

        let node_q = format!("MATCH (n:MapNode {{id: '{}'}}) DELETE n", esc_cypher(node_id));
        conn.query(&node_q).context("Gagal delete node")?;
        Ok(())
    }

    pub fn delete_map(&self, map_id: &str) -> Result<()> {
        let conn = self.conn()?;
        let rel_q = format!("MATCH (a:MapNode)-[r:PARENT_OF]->(b:MapNode) WHERE a.map_id = '{}' DELETE r", esc_cypher(map_id));
        let _ = conn.query(&rel_q);

        let node_q = format!("MATCH (n:MapNode {{map_id: '{}'}}) DELETE n", esc_cypher(map_id));
        let _ = conn.query(&node_q);

        let map_q = format!("MATCH (m:MindMap {{id: '{}'}}) DELETE m", esc_cypher(map_id));
        conn.query(&map_q).context("Gagal delete MindMap")?;
        Ok(())
    }

    pub fn load_tree(&self, map_id: &str) -> Result<TreeNode> {
        let conn = self.conn()?;
        let map_q = format!("MATCH (m:MindMap {{id: '{}'}}) RETURN m.root_id, m.title", esc_cypher(map_id));
        let mut m_res = conn.query(&map_q).context("Gagal query MindMap meta")?;
        let (root_id, title) = if let Some(row) = m_res.next() {
            (val_to_string(&row[0]), val_to_string(&row[1]))
        } else {
            return Err(anyhow!("Mindmap ID '{}' tidak ditemukan", map_id));
        };

        let nodes_q = format!(
            "MATCH (n:MapNode {{map_id: '{}'}}) RETURN n.id, n.text, n.note, n.position, n.folded",
            esc_cypher(map_id)
        );
        let mut n_res = conn.query(&nodes_q).context("Gagal query nodes")?;
        let mut node_map: HashMap<String, TreeNode> = HashMap::new();

        for row in &mut n_res {
            if row.len() >= 5 {
                let id = val_to_string(&row[0]);
                let text = val_to_string(&row[1]);
                let note = val_to_string(&row[2]);
                let pos = val_to_string(&row[3]);
                let folded = val_to_bool(&row[4]);

                let tree_node = TreeNode {
                    id: id.clone(),
                    text,
                    note: if note.is_empty() { None } else { Some(note) },
                    position: if pos.is_empty() { None } else { Some(pos) },
                    folded,
                    color: None,
                    background_color: None,
                    style: None,
                    link: None,
                    children: Vec::new(),
                };
                node_map.insert(id, tree_node);
            }
        }

        let edges_q = format!(
            "MATCH (p:MapNode {{map_id: '{}'}})-[r:PARENT_OF]->(c:MapNode {{map_id: '{}'}}) RETURN p.id, c.id",
            esc_cypher(map_id),
            esc_cypher(map_id)
        );
        let mut e_res = conn.query(&edges_q).context("Gagal query edges")?;
        let mut parent_to_children: HashMap<String, Vec<String>> = HashMap::new();

        for row in &mut e_res {
            if row.len() >= 2 {
                let p_id = val_to_string(&row[0]);
                let c_id = val_to_string(&row[1]);
                parent_to_children.entry(p_id).or_default().push(c_id);
            }
        }

        fn assemble(
            curr_id: &str,
            node_map: &mut HashMap<String, TreeNode>,
            parent_to_children: &HashMap<String, Vec<String>>,
        ) -> Option<TreeNode> {
            let mut curr_node = node_map.remove(curr_id)?;
            if let Some(child_ids) = parent_to_children.get(curr_id) {
                for cid in child_ids {
                    if let Some(child_node) = assemble(cid, node_map, parent_to_children) {
                        curr_node.children.push(child_node);
                    }
                }
            }
            Some(curr_node)
        }

        assemble(&root_id, &mut node_map, &parent_to_children)
            .ok_or_else(|| anyhow!("Root node '{}' tidak ditemukan untuk peta '{}'", root_id, title))
    }

    pub fn save_tree(&self, map_id: &str, title: &str, root: &TreeNode) -> Result<()> {
        let conn = self.conn()?;
        let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let _ = self.delete_map(map_id);

        // Periksa apakah ID root sudah ada di peta lain untuk menghindari konflik primary key
        let check_q = format!("MATCH (n:MapNode {{id: '{}'}}) RETURN n.id", esc_cypher(&root.id));
        let needs_remap = if let Ok(mut r) = conn.query(&check_q) {
            r.next().is_some()
        } else {
            false
        };

        let mut processed_tree = root.clone();
        if needs_remap {
            fn remap_ids(node: &mut TreeNode, map_id: &str) {
                node.id = format!("{}_{}", map_id, node.id);
                for child in &mut node.children {
                    remap_ids(child, map_id);
                }
            }
            remap_ids(&mut processed_tree, map_id);
        }

        let map_q = format!(
            "CREATE (:MindMap {{id: '{}', title: '{}', root_id: '{}', created_at: '{}', updated_at: '{}'}})",
            esc_cypher(map_id),
            esc_cypher(title),
            esc_cypher(&processed_tree.id),
            esc_cypher(&now),
            esc_cypher(&now)
        );
        conn.query(&map_q).context("Gagal membuat entri MindMap")?;

        fn insert_recursive(
            conn: &Connection,
            map_id: &str,
            parent_id: Option<&str>,
            node: &TreeNode,
            now: &str,
        ) -> Result<()> {
            let n_q = format!(
                "CREATE (:MapNode {{id: '{}', map_id: '{}', text: '{}', note: '{}', position: '{}', folded: {}, created_at: '{}', updated_at: '{}'}})",
                esc_cypher(&node.id),
                esc_cypher(map_id),
                esc_cypher(&node.text),
                esc_cypher(node.note.as_deref().unwrap_or("")),
                esc_cypher(node.position.as_deref().unwrap_or("")),
                node.folded,
                esc_cypher(now),
                esc_cypher(now)
            );
            conn.query(&n_q).context("Gagal insert node")?;

            if let Some(pid) = parent_id {
                let r_q = format!(
                    "MATCH (p:MapNode {{id: '{}'}}), (c:MapNode {{id: '{}'}}) CREATE (p)-[:PARENT_OF]->(c)",
                    esc_cypher(pid),
                    esc_cypher(&node.id)
                );
                conn.query(&r_q).context("Gagal link edge PARENT_OF")?;
            }

            for child in &node.children {
                insert_recursive(conn, map_id, Some(&node.id), child, now)?;
            }

            Ok(())
        }

        insert_recursive(&conn, map_id, None, &processed_tree, &now)?;
        Ok(())
    }

    pub fn search(&self, query_str: &str, map_id: Option<&str>) -> Result<Vec<MapNode>> {
        let conn = self.conn()?;
        let cypher = if let Some(mid) = map_id {
            format!(
                "MATCH (n:MapNode) WHERE n.map_id = '{}' AND (n.text CONTAINS '{}' OR n.note CONTAINS '{}') RETURN n.id, n.map_id, n.text, n.note, n.position, n.folded",
                esc_cypher(mid),
                esc_cypher(query_str),
                esc_cypher(query_str)
            )
        } else {
            format!(
                "MATCH (n:MapNode) WHERE n.text CONTAINS '{}' OR n.note CONTAINS '{}' RETURN n.id, n.map_id, n.text, n.note, n.position, n.folded",
                esc_cypher(query_str),
                esc_cypher(query_str)
            )
        };

        let mut res = conn.query(&cypher).context("Gagal search query")?;
        let mut results = Vec::new();

        for row in &mut res {
            if row.len() >= 6 {
                results.push(MapNode {
                    id: val_to_string(&row[0]),
                    map_id: val_to_string(&row[1]),
                    text: val_to_string(&row[2]),
                    note: {
                        let s = val_to_string(&row[3]);
                        if s.is_empty() { None } else { Some(s) }
                    },
                    position: {
                        let s = val_to_string(&row[4]);
                        if s.is_empty() { None } else { Some(s) }
                    },
                    folded: val_to_bool(&row[5]),
                    color: None,
                    background_color: None,
                    style: None,
                    link: None,
                    created_at: None,
                    updated_at: None,
                });
            }
        }

        Ok(results)
    }

    pub fn find_path(&self, node_a: &str, node_b: &str) -> Result<Option<Vec<String>>> {
        let conn = self.conn()?;
        let q = format!(
            "MATCH p = (a:MapNode {{id: '{}'}})-[* SHORTEST]->(b:MapNode {{id: '{}'}}) RETURN PROPERTIES(NODES(p), 'id')",
            esc_cypher(node_a),
            esc_cypher(node_b)
        );
        let mut res = conn.query(&q).context("Gagal query shortest path")?;
        if let Some(row) = res.next() {
            if let Some(val) = row.get(0) {
                let s = val_to_string(val);
                let cleaned = s.trim_matches(|c| c == '[' || c == ']');
                let parts: Vec<String> = cleaned.split(',').map(|x| x.trim().to_string()).collect();
                return Ok(Some(parts));
            }
        }
        Ok(None)
    }

    pub fn execute_cypher(&self, cypher_query: &str) -> Result<String> {
        let conn = self.conn()?;
        let res = conn.query(cypher_query).context("Gagal eksekusi query Cypher")?;
        Ok(format!("{}", res))
    }
}

fn val_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Int64(i) => i.to_string(),
        Value::Int32(i) => i.to_string(),
        Value::UInt64(u) => u.to_string(),
        Value::Double(d) => d.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null(_) => String::new(),
        _ => format!("{}", v),
    }
}

fn val_to_bool(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::String(s) => s == "true",
        _ => false,
    }
}

fn val_to_i64(v: &Value) -> i64 {
    match v {
        Value::Int64(i) => *i,
        Value::Int32(i) => *i as i64,
        Value::UInt64(u) => *u as i64,
        Value::String(s) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn esc_cypher(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "")
}
