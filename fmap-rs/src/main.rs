pub mod cli;
pub mod formatter;
pub mod model;
pub mod parser;
pub mod storage;
pub mod tui;

use anyhow::{anyhow, Result};
use clap::Parser;
use cli::{Cli, Commands, MapCommands, NodeCommands};
use formatter::{format_outliner_tree, render_canvas, CanvasOptions, TreeViewOptions};
use parser::{parse_mm, serialize_mm};
use storage::LadybugStorage;
use std::fs;
use std::path::Path;

fn main() -> Result<()> {
    let args = Cli::parse();

    let db_path = args.db.unwrap_or_else(|| "fmap.lbug".to_string());
    let storage = LadybugStorage::open(&db_path)?;

    match args.command {
        Commands::Map(MapCommands::List) => {
            let maps = storage.list_maps()?;
            if args.json {
                println!("{}", serde_json::to_string_pretty(&maps)?);
                return Ok(());
            }

            if maps.is_empty() {
                println!("\nBelum ada peta di database LadybugDB. Gunakan: fmap map import <file.mm>");
                return Ok(());
            }

            println!("\n📋 Daftar Peta ({} peta tersimpan di LadybugDB):", maps.len());
            println!("{}", "─".repeat(60));
            for m in maps {
                println!(
                    "• [{}] \x1b[1;36m{}\x1b[0m ({} nodes, {} edges) - Update: {}",
                    m.id, m.title, m.node_count, m.edge_count, m.updated_at
                );
            }
            println!();
        }

        Commands::Map(MapCommands::Create { title, root }) => {
            let root_text = root.as_deref().unwrap_or(&title);
            let (map_id, root_id) = storage.create_map(&title, root_text)?;

            if args.json {
                let out = serde_json::json!({
                    "success": true,
                    "mapId": map_id,
                    "rootId": root_id,
                    "title": title
                });
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }

            println!("\x1b[32m✔ Peta baru berhasil dibuat di LadybugDB!\x1b[0m");
            println!("  ID Peta   : \x1b[1;33m{}\x1b[0m", map_id);
            println!("  Judul     : \x1b[1;36m{}\x1b[0m", title);
            println!("  Root Node : [{}] \"{}\"", root_id, root_text);
            println!("\nLangkah selanjutnya:");
            println!("• Buka di TUI interaktif : \x1b[33mfmap ui {}\x1b[0m", map_id);
            println!("• Tambah cabang via CLI  : \x1b[33mfmap node add {} {} \"Cabang Pertama\"\x1b[0m", map_id, root_id);
            println!("• Tampilkan pohon        : \x1b[33mfmap view {}\x1b[0m\n", map_id);
        }

        Commands::Map(MapCommands::Import { file, title }) => {
            let p = Path::new(&file);
            if !p.exists() {
                return Err(anyhow!("File tidak ditemukan: {}", file));
            }

            let map_title = title.unwrap_or_else(|| {
                p.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string()
            });

            let xml = fs::read_to_string(&file)?;
            let tree = parse_mm(&xml)?;
            let ts = chrono::Utc::now().timestamp_millis();
            let map_id = format!("map_{:x}", ts);

            if !args.json {
                println!("Mengimpor '{}' ke database graf LadybugDB...", file);
            }
            storage.save_tree(&map_id, &map_title, &tree)?;
            let node_count = tree.count_nodes();

            if args.json {
                let out = serde_json::json!({
                    "success": true,
                    "mapId": map_id,
                    "title": map_title,
                    "nodeCount": node_count
                });
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }

            println!(
                "\x1b[32m✔ Peta berhasil diimpor ke LadybugDB!\x1b[0m ID: \x1b[1;33m{}\x1b[0m ({} nodes)",
                map_id, node_count
            );
        }

        Commands::Map(MapCommands::Export { map_id, output }) => {
            let tree = storage.load_tree(&map_id)?;

            if output.ends_with(".json") {
                let json = serde_json::to_string_pretty(&tree)?;
                fs::write(&output, json)?;
                println!("\x1b[32m✔ Berhasil diekspor ke JSON:\x1b[0m {}", output);
            } else {
                let xml = serialize_mm(&tree);
                fs::write(&output, xml)?;
                println!("\x1b[32m✔ Berhasil diekspor ke FreeMind XML (.mm):\x1b[0m {}", output);
            }
        }

        Commands::Map(MapCommands::Delete { map_id }) => {
            storage.delete_map(&map_id)?;
            if args.json {
                println!("{}", serde_json::json!({ "success": true, "mapId": map_id }));
                return Ok(());
            }
            println!("\x1b[32m✔ Peta {} berhasil dihapus dari LadybugDB.\x1b[0m", map_id);
        }

        Commands::View { map_id, depth } => {
            let tree = storage.load_tree(&map_id)?;
            let (outliner, total) = format_outliner_tree(
                &tree,
                &TreeViewOptions {
                    max_depth: depth,
                    show_ids: true,
                    use_colors: true,
                },
            );
            println!("\n{}\n\nTotal: {} nodes ditampilkan.\n", outliner, total);
        }

        Commands::Canvas { map_id, ascii } => {
            let tree = storage.load_tree(&map_id)?;
            let canvas = render_canvas(
                &tree,
                &CanvasOptions {
                    max_label: 36,
                    level_gap: 6,
                    row_gap: 2,
                    ascii,
                },
            );
            println!("\n🧠 Mindmap 2D Canvas [ID: {}]\n\n{}\n", map_id, canvas);
        }

        Commands::Ui { map_id, canvas } => {
            tui::run_interactive_tui(&storage, &map_id, canvas)?;
        }

        Commands::Search { query, map } => {
            let results = storage.search(&query, map.as_deref())?;
            if args.json {
                println!("{}", serde_json::to_string_pretty(&results)?);
                return Ok(());
            }

            println!("\n🔍 Hasil Pencarian untuk \"{}\" ({} ditemukan):", query, results.len());
            println!("{}", "─".repeat(60));
            for n in results {
                println!("• [{}] (Peta: {}) \x1b[1;36m{}\x1b[0m", n.id, n.map_id, n.text);
                if let Some(note) = n.note {
                    println!("    Catatan: {}", note);
                }
            }
            println!();
        }

        Commands::Path { node_a, node_b } => {
            let path_opt = storage.find_path(&node_a, &node_b)?;
            if args.json {
                let out = serde_json::json!({
                    "found": path_opt.is_some(),
                    "nodeA": node_a,
                    "nodeB": node_b,
                    "path": path_opt
                });
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }

            if let Some(path) = path_opt {
                println!("\n\x1b[32m✔ Jalur penalaran terpendek ditemukan ({} hops):\x1b[0m", path.len().saturating_sub(1));
                println!("  {}\n", path.join(" -> "));
            } else {
                println!("\n❌ Tidak ditemukan jalur antara {} dan {}.\n", node_a, node_b);
            }
        }

        Commands::Cypher { query } => {
            let res = storage.execute_cypher(&query)?;
            println!("\n📊 Hasil Kueri Cypher:\n{}\n", res);
        }

        Commands::Node(NodeCommands::Add { map_id, parent_id, text }) => {
            let new_id = storage.add_node(&map_id, &parent_id, &text)?;
            if args.json {
                let out = serde_json::json!({
                    "success": true,
                    "id": new_id,
                    "mapId": map_id,
                    "parentId": parent_id,
                    "text": text
                });
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }
            println!("\x1b[32m✔ Cabang baru berhasil dibuat!\x1b[0m ID: {}", new_id);
        }

        Commands::Node(NodeCommands::Edit { map_id, node_id, text }) => {
            storage.edit_node(&node_id, &text)?;
            if args.json {
                let out = serde_json::json!({
                    "success": true,
                    "id": node_id,
                    "mapId": map_id,
                    "text": text
                });
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }
            println!("\x1b[32m✔ Cabang {} diperbarui.\x1b[0m", node_id);
        }

        Commands::Node(NodeCommands::Rm { map_id, node_id }) => {
            storage.delete_node(&node_id)?;
            if args.json {
                let out = serde_json::json!({
                    "success": true,
                    "id": node_id,
                    "mapId": map_id
                });
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }
            println!("\x1b[32m✔ Cabang {} dihapus.\x1b[0m", node_id);
        }
    }

    Ok(())
}
