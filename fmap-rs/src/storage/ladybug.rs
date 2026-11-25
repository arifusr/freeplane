use crate::model::{MapMeta, MapNode, TreeNode};
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use lbug::{Connection, Database, SystemConfig, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

const OPEN_MAX_ATTEMPTS: u32 = 20;
const OPEN_RETRY_DELAY: Duration = Duration::from_millis(50);

pub struct LadybugStorage {
    db_path: PathBuf,
}

impl LadybugStorage {
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self> {
        let storage = Self {
            db_path: db_path.as_ref().to_path_buf(),
        };
        storage.init_schema()?;
        Ok(storage)
    }

    fn open_db(&self) -> Result<Database> {
        let path_str = self.db_path.to_string_lossy().to_string();
        let mut last_error = String::new();

        for attempt in 0..OPEN_MAX_ATTEMPTS {
            match Database::new(&path_str, SystemConfig::default()) {
                Ok(db) => return Ok(db),
                Err(err) => {
                    last_error = err.to_string();
                    let is_locked = last_error.contains("lock") || last_error.contains("Lock");
                    if !is_locked || attempt + 1 >= OPEN_MAX_ATTEMPTS {
                        break;
                    }
                    thread::sleep(OPEN_RETRY_DELAY);
                }
            }
        }

        Err(anyhow!(
            "Gagal membuka database LadybugDB di: {}. Database sedang dipakai proses lain? Detail: {}",
            self.db_path.display(),
            last_error
        ))
    }

    fn with_db<T>(&self, f: impl FnOnce(&Database) -> Result<T>) -> Result<T> {
        let db = self.open_db()?;
        f(&db)
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        self.with_db(|db| {
            let conn = Connection::new(db).context("Gagal membuat koneksi ke LadybugDB")?;
            f(&conn)
        })
    }

    fn delete_map_with_conn(conn: &Connection, map_id: &str) -> Result<()> {
        let rel_q = format!(
            "MATCH (a:MapNode)-[r:PARENT_OF]->(b:MapNode) WHERE a.map_id = '{}' DELETE r",
            esc_cypher(map_id)
        );
        let _ = conn.query(&rel_q);
        let arrow_rel_q = format!(
            "MATCH (a:MapNode)-[r:CONNECTS_TO]->(b:MapNode) WHERE a.map_id = '{}' DELETE r",
            esc_cypher(map_id)
        );
        let _ = conn.query(&arrow_rel_q);

        let node_q = format!(
            "MATCH (n:MapNode {{map_id: '{}'}}) DELETE n",
            esc_cypher(map_id)
        );
        let _ = conn.query(&node_q);

        let map_q = format!(
            "MATCH (m:MindMap {{id: '{}'}}) DELETE m",
            esc_cypher(map_id)
        );
        conn.query(&map_q).context("Gagal delete MindMap")?;
        Ok(())
    }

    fn init_schema(&self) -> Result<()> {
        self.with_conn(|conn| {
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
                )
                .context("Gagal membuat tabel node MindMap")?;
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
                        sort_order INT64,
                        PRIMARY KEY(id)
                    )",
                )
                .context("Gagal membuat tabel node MapNode")?;
            } else if !has_node_column(conn, "MapNode", "sort_order") {
                // Migrasi database lama: tambahkan kolom urutan sibling.
                conn.query("ALTER TABLE MapNode ADD sort_order INT64")
                    .context("Gagal menambahkan kolom sort_order pada MapNode")?;
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
        })
    }

    pub fn list_maps(&self) -> Result<Vec<MapMeta>> {
        self.with_conn(|conn| {
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
                    let count_q = format!(
                        "MATCH (n:MapNode) WHERE n.map_id = '{}' RETURN count(n)",
                        esc_cypher(&id)
                    );
                    let node_count = if let Ok(mut c_res) = conn.query(&count_q) {
                        c_res.next()
                            .and_then(|r| r.get(0).map(val_to_i64))
                            .unwrap_or(0) as usize
                    } else {
                        0
                    };

                    // Hitung jumlah edge
                    let edge_q = format!("MATCH (a:MapNode)-[r:PARENT_OF]->(b:MapNode) WHERE a.map_id = '{}' RETURN count(r)", esc_cypher(&id));
                    let edge_count = if let Ok(mut e_res) = conn.query(&edge_q) {
                        e_res.next()
                            .and_then(|r| r.get(0).map(val_to_i64))
                            .unwrap_or(0) as usize
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
        })
    }

    pub fn create_map(&self, title: &str, root_text: &str) -> Result<(String, String)> {
        self.with_conn(|conn| {
            let now = now_string();
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
                "CREATE (:MapNode {{id: '{}', map_id: '{}', text: '{}', note: '', position: '', folded: false, created_at: '{}', updated_at: '{}', sort_order: 0}})",
                esc_cypher(&root_id),
                esc_cypher(&map_id),
                esc_cypher(root_text),
                esc_cypher(&now),
                esc_cypher(&now)
            );
            conn.query(&node_cypher)
                .context("Gagal insert root MapNode")?;

            Ok((map_id, root_id))
        })
    }

    pub fn add_node(&self, map_id: &str, parent_id: &str, text: &str) -> Result<String> {
        self.with_conn(|conn| {
            let now = now_string();
            let new_id = format!(
                "ID_{:x}",
                Utc::now().timestamp_nanos_opt().unwrap_or(0)
            );

            // Node baru selalu diletakkan paling bawah di antara sibling-nya.
            let siblings_q = format!(
                "MATCH (p:MapNode {{id: '{}'}})-[:PARENT_OF]->(c:MapNode) RETURN c.sort_order",
                esc_cypher(parent_id)
            );
            let mut next_order = 0_i64;
            if let Ok(mut res) = conn.query(&siblings_q) {
                let mut max_order = -1_i64;
                for row in &mut res {
                    if let Some(value) = row.get(0) {
                        max_order = max_order.max(val_to_i64(value));
                    }
                }
                next_order = max_order + 1;
            }

            let node_q = format!(
                "CREATE (:MapNode {{id: '{}', map_id: '{}', text: '{}', note: '', position: '', folded: false, created_at: '{}', updated_at: '{}', sort_order: {}}})",
                esc_cypher(&new_id),
                esc_cypher(map_id),
                esc_cypher(text),
                esc_cypher(&now),
                esc_cypher(&now),
                next_order
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
        })
    }

    /// Geser urutan node di antara sibling-nya. `delta` -1 = naik, +1 = turun.
    /// Mengembalikan `true` jika urutan berubah.
    pub fn move_node(&self, map_id: &str, node_id: &str, delta: i64) -> Result<bool> {
        self.with_conn(|conn| {
            let exists_q = format!(
                "MATCH (n:MapNode {{id: '{}', map_id: '{}'}}) RETURN count(n)",
                esc_cypher(node_id),
                esc_cypher(map_id)
            );
            let mut exists_res = conn.query(&exists_q).context("Gagal memvalidasi node")?;
            let exists = exists_res
                .next()
                .and_then(|row| row.get(0).map(val_to_i64))
                .unwrap_or(0);
            if exists == 0 {
                return Err(anyhow!(
                    "Node '{}' tidak ditemukan di peta '{}'",
                    node_id,
                    map_id
                ));
            }

            let parent_q = format!(
                "MATCH (p:MapNode {{map_id: '{}'}})-[:PARENT_OF]->(n:MapNode {{id: '{}', map_id: '{}'}}) RETURN p.id",
                esc_cypher(map_id),
                esc_cypher(node_id),
                esc_cypher(map_id)
            );
            let mut parent_res = conn.query(&parent_q).context("Gagal query induk node")?;
            let Some(parent_row) = parent_res.next() else {
                // Root tidak punya sibling, jadi tidak bisa digeser.
                return Ok(false);
            };
            let parent_id = val_to_string(&parent_row[0]);
            if parent_id.is_empty() {
                return Ok(false);
            }

            let siblings_q = format!(
                "MATCH (p:MapNode {{id: '{}'}})-[:PARENT_OF]->(c:MapNode {{map_id: '{}'}}) RETURN c.id, c.sort_order, c.created_at",
                esc_cypher(&parent_id),
                esc_cypher(map_id)
            );
            let mut res = conn.query(&siblings_q).context("Gagal query sibling")?;
            let mut siblings: Vec<(i64, String, String)> = Vec::new();
            for row in &mut res {
                if row.len() >= 3 {
                    siblings.push((
                        val_to_i64(&row[1]),
                        val_to_string(&row[2]),
                        val_to_string(&row[0]),
                    ));
                }
            }
            siblings.sort_by(|a, b| {
                a.0.cmp(&b.0)
                    .then_with(|| a.1.cmp(&b.1))
                    .then_with(|| a.2.cmp(&b.2))
            });

            let Some(index) = siblings.iter().position(|(_, _, id)| id == node_id) else {
                return Ok(false);
            };
            let target = index as i64 + delta;
            if target < 0 || target >= siblings.len() as i64 {
                return Ok(false);
            }
            siblings.swap(index, target as usize);

            // Tulis ulang seluruh urutan agar nilai yang masih NULL/duplikat
            // (dari database lama) ikut dinormalisasi.
            for (order, (_, _, sibling_id)) in siblings.iter().enumerate() {
                let update_q = format!(
                    "MATCH (n:MapNode {{id: '{}', map_id: '{}'}}) SET n.sort_order = {}",
                    esc_cypher(sibling_id),
                    esc_cypher(map_id),
                    order
                );
                conn.query(&update_q)
                    .context("Gagal menyimpan urutan node")?;
            }

            let now = now_string();
            touch_map(conn, map_id, &now)?;
            Ok(true)
        })
    }

    pub fn edit_node(&self, node_id: &str, text: &str) -> Result<()> {
        self.with_conn(|conn| {
            let now = now_string();
            let q = format!(
                "MATCH (n:MapNode {{id: '{}'}}) SET n.text = '{}', n.updated_at = '{}'",
                esc_cypher(node_id),
                esc_cypher(text),
                esc_cypher(&now)
            );
            conn.query(&q).context("Gagal update teks node")?;

            touch_map_of_node(conn, node_id, &now);

            Ok(())
        })
    }

    pub fn edit_node_note(&self, node_id: &str, note: &str) -> Result<()> {
        self.with_conn(|conn| {
            let now = now_string();
            let q = format!(
                "MATCH (n:MapNode {{id: '{}'}}) SET n.note = '{}', n.updated_at = '{}'",
                esc_cypher(node_id),
                esc_cypher(note),
                esc_cypher(&now)
            );
            conn.query(&q).context("Gagal update catatan node")?;

            touch_map_of_node(conn, node_id, &now);

            Ok(())
        })
    }

    pub fn delete_node(&self, node_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            let now = now_string();

            // Kumpulkan seluruh descendant agar subtree tidak tertinggal sebagai
            // node yatim (orphan) di database.
            let mut ids = vec![node_id.to_string()];
            let mut cursor = 0;
            while cursor < ids.len() {
                let child_q = format!(
                    "MATCH (p:MapNode {{id: '{}'}})-[:PARENT_OF]->(c:MapNode) RETURN c.id",
                    esc_cypher(&ids[cursor])
                );
                if let Ok(mut res) = conn.query(&child_q) {
                    for row in &mut res {
                        if let Some(value) = row.get(0) {
                            let child_id = val_to_string(value);
                            if !child_id.is_empty() && !ids.contains(&child_id) {
                                ids.push(child_id);
                            }
                        }
                    }
                }
                cursor += 1;
            }

            touch_map_of_node(conn, node_id, &now);

            for id in &ids {
                let escaped = esc_cypher(id);
                let rel_q = format!("MATCH (a:MapNode)-[r:PARENT_OF]->(b:MapNode) WHERE a.id = '{}' OR b.id = '{}' DELETE r", escaped, escaped);
                let _ = conn.query(&rel_q);
                let arrow_rel_q = format!("MATCH (a:MapNode)-[r:CONNECTS_TO]->(b:MapNode) WHERE a.id = '{}' OR b.id = '{}' DELETE r", escaped, escaped);
                let _ = conn.query(&arrow_rel_q);

                let node_q = format!("MATCH (n:MapNode {{id: '{}'}}) DELETE n", escaped);
                conn.query(&node_q).context("Gagal delete node")?;
            }

            Ok(())
        })
    }

    pub fn delete_map(&self, map_id: &str) -> Result<()> {
        self.with_conn(|conn| Self::delete_map_with_conn(conn, map_id))
    }

    pub fn load_tree(&self, map_id: &str) -> Result<TreeNode> {
        self.with_conn(|conn| {
            let map_q = format!(
                "MATCH (m:MindMap {{id: '{}'}}) RETURN m.root_id, m.title",
                esc_cypher(map_id)
            );
            let mut m_res = conn.query(&map_q).context("Gagal query MindMap meta")?;
            let (root_id, title) = if let Some(row) = m_res.next() {
                (val_to_string(&row[0]), val_to_string(&row[1]))
            } else {
                return Err(anyhow!("Mindmap ID '{}' tidak ditemukan", map_id));
            };

            let nodes_q = format!(
                "MATCH (n:MapNode {{map_id: '{}'}}) RETURN n.id, n.text, n.note, n.position, n.folded, n.created_at, n.updated_at",
                esc_cypher(map_id)
            );
            let mut n_res = conn.query(&nodes_q).context("Gagal query nodes")?;
            let mut node_map: HashMap<String, TreeNode> = HashMap::new();

            for row in &mut n_res {
                if row.len() >= 7 {
                    let id = val_to_string(&row[0]);
                    let text = val_to_string(&row[1]);
                    let note = val_to_string(&row[2]);
                    let pos = val_to_string(&row[3]);
                    let folded = val_to_bool(&row[4]);
                    let created_at = val_to_string(&row[5]);
                    let updated_at = val_to_string(&row[6]);

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
                        arrow_links: Vec::new(),
                        created_at: non_empty(created_at),
                        updated_at: non_empty(updated_at),
                        children: Vec::new(),
                    };
                    node_map.insert(id, tree_node);
                }
            }

            let edges_q = format!(
                "MATCH (p:MapNode {{map_id: '{}'}})-[r:PARENT_OF]->(c:MapNode {{map_id: '{}'}}) RETURN p.id, c.id, c.sort_order, c.created_at",
                esc_cypher(map_id),
                esc_cypher(map_id)
            );
            let mut e_res = conn.query(&edges_q).context("Gagal query edges")?;
            let mut parent_to_children: HashMap<String, Vec<(i64, String, String)>> =
                HashMap::new();

            for row in &mut e_res {
                if row.len() >= 4 {
                    let p_id = val_to_string(&row[0]);
                    let c_id = val_to_string(&row[1]);
                    let sort_order = val_to_i64(&row[2]);
                    let created_at = val_to_string(&row[3]);
                    parent_to_children
                        .entry(p_id)
                        .or_default()
                        .push((sort_order, created_at, c_id));
                }
            }

            // Urutkan sibling: yang paling lama di atas, yang baru di bawah.
            // created_at menjadi fallback untuk database lama yang sort_order-nya NULL.
            for children in parent_to_children.values_mut() {
                children.sort_by(|a, b| {
                    a.0.cmp(&b.0)
                        .then_with(|| a.1.cmp(&b.1))
                        .then_with(|| a.2.cmp(&b.2))
                });
            }

            let arrow_edges_q = format!(
                "MATCH (s:MapNode {{map_id: '{}'}})-[r:CONNECTS_TO]->(t:MapNode {{map_id: '{}'}}) RETURN s.id, t.id",
                esc_cypher(map_id),
                esc_cypher(map_id)
            );
            let mut arrow_res = conn
                .query(&arrow_edges_q)
                .context("Gagal query arrow links")?;
            for row in &mut arrow_res {
                if row.len() >= 2 {
                    let source_id = val_to_string(&row[0]);
                    let target_id = val_to_string(&row[1]);
                    if let Some(source) = node_map.get_mut(&source_id) {
                        source.arrow_links.push(target_id);
                    }
                }
            }

            fn assemble(
                curr_id: &str,
                node_map: &mut HashMap<String, TreeNode>,
                parent_to_children: &HashMap<String, Vec<(i64, String, String)>>,
            ) -> Option<TreeNode> {
                let mut curr_node = node_map.remove(curr_id)?;
                if let Some(child_entries) = parent_to_children.get(curr_id) {
                    for (_, _, cid) in child_entries {
                        if let Some(child_node) = assemble(cid, node_map, parent_to_children) {
                            curr_node.children.push(child_node);
                        }
                    }
                }
                Some(curr_node)
            }

            assemble(&root_id, &mut node_map, &parent_to_children).ok_or_else(|| {
                anyhow!(
                    "Root node '{}' tidak ditemukan untuk peta '{}'",
                    root_id,
                    title
                )
            })
        })
    }

    pub fn save_tree(&self, map_id: &str, title: &str, root: &TreeNode) -> Result<()> {
        self.with_conn(|conn| {
            let now = now_string();

            // Periksa apakah ID root sudah ada di peta lain untuk menghindari konflik primary key
            let check_q = format!(
                "MATCH (n:MapNode {{id: '{}'}}) WHERE n.map_id <> '{}' RETURN n.id",
                esc_cypher(&root.id),
                esc_cypher(map_id)
            );
            let needs_remap = if let Ok(mut r) = conn.query(&check_q) {
                r.next().is_some()
            } else {
                false
            };

            let mut processed_tree = root.clone();
            if needs_remap {
                fn collect_remapped_ids(
                    node: &TreeNode,
                    map_id: &str,
                    id_map: &mut HashMap<String, String>,
                ) {
                    id_map.insert(node.id.clone(), format!("{}_{}", map_id, node.id));
                    for child in &node.children {
                        collect_remapped_ids(child, map_id, id_map);
                    }
                }
                fn apply_remapped_ids(node: &mut TreeNode, id_map: &HashMap<String, String>) {
                    if let Some(new_id) = id_map.get(&node.id) {
                        node.id = new_id.clone();
                    }
                    for target_id in &mut node.arrow_links {
                        if let Some(new_id) = id_map.get(target_id) {
                            *target_id = new_id.clone();
                        }
                    }
                    for child in &mut node.children {
                        apply_remapped_ids(child, id_map);
                    }
                }
                let mut id_map = HashMap::new();
                collect_remapped_ids(&processed_tree, map_id, &mut id_map);
                apply_remapped_ids(&mut processed_tree, &id_map);
            }

            fn collect_node_ids(node: &TreeNode, ids: &mut std::collections::HashSet<String>) {
                ids.insert(node.id.clone());
                for child in &node.children {
                    collect_node_ids(child, ids);
                }
            }
            fn validate_arrow_targets(
                node: &TreeNode,
                ids: &std::collections::HashSet<String>,
            ) -> Result<()> {
                for target_id in &node.arrow_links {
                    if !ids.contains(target_id) {
                        return Err(anyhow!(
                            "Arrow link dari node '{}' mengarah ke node '{}' yang tidak ada di peta",
                            node.id,
                            target_id
                        ));
                    }
                }
                for child in &node.children {
                    validate_arrow_targets(child, ids)?;
                }
                Ok(())
            }
            let mut node_ids = std::collections::HashSet::new();
            collect_node_ids(&processed_tree, &mut node_ids);
            validate_arrow_targets(&processed_tree, &node_ids)?;

            let _ = Self::delete_map_with_conn(conn, map_id);

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
                sort_order: i64,
                now: &str,
            ) -> Result<()> {
                let n_q = format!(
                    "CREATE (:MapNode {{id: '{}', map_id: '{}', text: '{}', note: '{}', position: '{}', folded: {}, created_at: '{}', updated_at: '{}', sort_order: {}}})",
                    esc_cypher(&node.id),
                    esc_cypher(map_id),
                    esc_cypher(&node.text),
                    esc_cypher(node.note.as_deref().unwrap_or("")),
                    esc_cypher(node.position.as_deref().unwrap_or("")),
                    node.folded,
                    esc_cypher(now),
                    esc_cypher(now),
                    sort_order
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

                for (idx, child) in node.children.iter().enumerate() {
                    insert_recursive(conn, map_id, Some(&node.id), child, idx as i64, now)?;
                }

                Ok(())
            }

            fn insert_arrow_links(conn: &Connection, map_id: &str, node: &TreeNode) -> Result<()> {
                for target_id in &node.arrow_links {
                    let q = format!(
                        "MATCH (s:MapNode {{id: '{}', map_id: '{}'}}), (t:MapNode {{id: '{}', map_id: '{}'}}) CREATE (s)-[:CONNECTS_TO]->(t)",
                        esc_cypher(&node.id),
                        esc_cypher(map_id),
                        esc_cypher(target_id),
                        esc_cypher(map_id)
                    );
                    conn.query(&q).context("Gagal menyimpan arrow link")?;
                }
                for child in &node.children {
                    insert_arrow_links(conn, map_id, child)?;
                }
                Ok(())
            }

            insert_recursive(conn, map_id, None, &processed_tree, 0, &now)?;
            insert_arrow_links(conn, map_id, &processed_tree)?;
            Ok(())
        })
    }

    pub fn add_arrow_link(&self, map_id: &str, source_id: &str, target_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            let validate_q = format!(
                "MATCH (s:MapNode {{id: '{}', map_id: '{}'}}), (t:MapNode {{id: '{}', map_id: '{}'}}) RETURN count(*)",
                esc_cypher(source_id),
                esc_cypher(map_id),
                esc_cypher(target_id),
                esc_cypher(map_id)
            );
            let mut res = conn.query(&validate_q).context("Gagal memvalidasi node arrow link")?;
            let count = res.next().and_then(|row| row.get(0).map(val_to_i64)).unwrap_or(0);
            if count == 0 {
                return Err(anyhow!(
                    "Node sumber '{}' atau target '{}' tidak ditemukan di peta '{}'",
                    source_id,
                    target_id,
                    map_id
                ));
            }

            let exists_q = format!(
                "MATCH (s:MapNode {{id: '{}', map_id: '{}'}})-[r:CONNECTS_TO]->(t:MapNode {{id: '{}', map_id: '{}'}}) RETURN count(r)",
                esc_cypher(source_id),
                esc_cypher(map_id),
                esc_cypher(target_id),
                esc_cypher(map_id)
            );
            let mut exists_res = conn.query(&exists_q).context("Gagal memeriksa arrow link")?;
            let exists = exists_res
                .next()
                .and_then(|row| row.get(0).map(val_to_i64))
                .unwrap_or(0);
            if exists == 0 {
                let create_q = format!(
                    "MATCH (s:MapNode {{id: '{}', map_id: '{}'}}), (t:MapNode {{id: '{}', map_id: '{}'}}) CREATE (s)-[:CONNECTS_TO]->(t)",
                    esc_cypher(source_id),
                    esc_cypher(map_id),
                    esc_cypher(target_id),
                    esc_cypher(map_id)
                );
                conn.query(&create_q).context("Gagal membuat arrow link")?;
            }

            let now = now_string();
            touch_map(conn, map_id, &now)?;
            Ok(())
        })
    }

    pub fn remove_arrow_link(&self, map_id: &str, source_id: &str, target_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            let validate_q = format!(
                "MATCH (s:MapNode {{id: '{}', map_id: '{}'}}), (t:MapNode {{id: '{}', map_id: '{}'}}) RETURN count(*)",
                esc_cypher(source_id),
                esc_cypher(map_id),
                esc_cypher(target_id),
                esc_cypher(map_id)
            );
            let mut res = conn.query(&validate_q).context("Gagal memvalidasi node arrow link")?;
            let count = res.next().and_then(|row| row.get(0).map(val_to_i64)).unwrap_or(0);
            if count == 0 {
                return Err(anyhow!(
                    "Node sumber '{}' atau target '{}' tidak ditemukan di peta '{}'",
                    source_id,
                    target_id,
                    map_id
                ));
            }

            let delete_q = format!(
                "MATCH (s:MapNode {{id: '{}', map_id: '{}'}})-[r:CONNECTS_TO]->(t:MapNode {{id: '{}', map_id: '{}'}}) DELETE r",
                esc_cypher(source_id),
                esc_cypher(map_id),
                esc_cypher(target_id),
                esc_cypher(map_id)
            );
            conn.query(&delete_q).context("Gagal menghapus arrow link")?;
            let now = now_string();
            touch_map(conn, map_id, &now)?;
            Ok(())
        })
    }

    pub fn search(&self, query_str: &str, map_id: Option<&str>) -> Result<Vec<MapNode>> {
        self.with_conn(|conn| {
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
                            if s.is_empty() {
                                None
                            } else {
                                Some(s)
                            }
                        },
                        position: {
                            let s = val_to_string(&row[4]);
                            if s.is_empty() {
                                None
                            } else {
                                Some(s)
                            }
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
        })
    }

    pub fn find_path(&self, node_a: &str, node_b: &str) -> Result<Option<Vec<String>>> {
        self.with_conn(|conn| {
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
                    let parts: Vec<String> =
                        cleaned.split(',').map(|x| x.trim().to_string()).collect();
                    return Ok(Some(parts));
                }
            }
            Ok(None)
        })
    }

    pub fn update_node_folded(&self, node_id: &str, folded: bool) -> Result<()> {
        self.with_conn(|conn| {
            let now = now_string();
            let q = format!(
                "MATCH (n:MapNode {{id: '{}'}}) SET n.folded = {}, n.updated_at = '{}'",
                esc_cypher(node_id),
                folded,
                esc_cypher(&now)
            );
            conn.query(&q).context("Gagal update status folded node")?;

            touch_map_of_node(conn, node_id, &now);

            Ok(())
        })
    }

    pub fn execute_cypher(&self, cypher_query: &str) -> Result<String> {
        self.with_conn(|conn| {
            let res = conn
                .query(cypher_query)
                .context("Gagal eksekusi query Cypher")?;
            Ok(format!("{}", res))
        })
    }
}

fn touch_map_of_node(conn: &Connection, node_id: &str, now: &str) {
    let q = format!(
        "MATCH (m:MindMap), (n:MapNode) WHERE n.id = '{}' AND m.id = n.map_id SET m.updated_at = '{}'",
        esc_cypher(node_id),
        esc_cypher(now)
    );
    let _ = conn.query(&q);
}

fn touch_map(conn: &Connection, map_id: &str, now: &str) -> Result<()> {
    let query = format!(
        "MATCH (m:MindMap {{id: '{}'}}) SET m.updated_at = '{}'",
        esc_cypher(map_id),
        esc_cypher(now)
    );
    conn.query(&query).context("Gagal memperbarui waktu peta")?;
    Ok(())
}

fn non_empty(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn now_string() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
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

fn has_node_column(conn: &Connection, table: &str, column: &str) -> bool {
    let q = format!("CALL TABLE_INFO('{}') RETURN *", esc_cypher(table));
    let Ok(mut res) = conn.query(&q) else {
        return false;
    };
    for row in &mut res {
        if row.len() > 1 && val_to_string(&row[1]) == column {
            return true;
        }
    }
    false
}

fn esc_cypher(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "")
}
