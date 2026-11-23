use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "fmap",
    author = "arifusr",
    version = "1.0.0",
    about = "🧠 Freeplane CLI & Graph Engine (LadybugDB Native Rust)"
)]
pub struct Cli {
    #[arg(long, global = true, help = "Lokasi file database LadybugDB")]
    pub db: Option<String>,

    #[arg(long, global = true, help = "Keluarkan output dalam format JSON")]
    pub json: bool,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    #[command(subcommand, about = "Kelola mindmap (list, create, import, export, delete)")]
    Map(MapCommands),

    #[command(about = "Tampilkan pohon hierarki (Outliner) di terminal")]
    View {
        map_id: String,
        #[arg(long, default_value_t = 99)]
        depth: usize,
    },

    #[command(about = "Tampilkan mindmap 2D di terminal (gaya DOS)")]
    Canvas {
        map_id: String,
        #[arg(long)]
        ascii: bool,
    },

    #[command(about = "Buka Interactive TUI (v = Canvas 2D)")]
    Ui {
        map_id: String,
    },

    #[command(about = "Pencarian teks & catatan di mindmap")]
    Search {
        query: String,
        #[arg(long)]
        map: Option<String>,
    },

    #[command(about = "Cari jalur koneksi terpendek antara dua node")]
    Path {
        node_a: String,
        node_b: String,
    },

    #[command(about = "Jalankan kueri graf Cypher")]
    Cypher {
        query: String,
    },

    #[command(subcommand, about = "Mutasi node (add, edit, rm)")]
    Node(NodeCommands),
}

#[derive(Subcommand, Debug)]
pub enum MapCommands {
    #[command(about = "Daftar seluruh peta yang tersimpan")]
    List,

    #[command(about = "Buat mindmap baru dengan root default")]
    Create {
        title: String,
        #[arg(long)]
        root: Option<String>,
    },

    #[command(about = "Impor file .mm ke database graf")]
    Import {
        file: String,
        #[arg(short = 't', long)]
        title: Option<String>,
    },

    #[command(about = "Ekspor peta ke format .mm atau .json")]
    Export {
        map_id: String,
        #[arg(short = 'o', long)]
        output: String,
    },

    #[command(about = "Hapus peta dari database")]
    Delete {
        map_id: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum NodeCommands {
    #[command(about = "Tambah cabang baru")]
    Add {
        map_id: String,
        parent_id: String,
        text: String,
    },

    #[command(about = "Ubah teks cabang")]
    Edit {
        map_id: String,
        node_id: String,
        text: String,
    },

    #[command(about = "Hapus cabang")]
    Rm {
        map_id: String,
        node_id: String,
    },
}

