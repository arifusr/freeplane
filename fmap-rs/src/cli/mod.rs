use clap::{Parser, Subcommand, ValueEnum};

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphicsMode {
    /// Deteksi otomatis dari environment (fallback: ASCII).
    Auto,
    /// Paksa canvas ASCII.
    Ascii,
    /// Render grafis memakai blok setengah (didukung hampir semua terminal).
    Halfblocks,
    /// Render grafis memakai protokol sixel.
    Sixel,
    /// Render grafis memakai protokol kitty.
    Kitty,
    /// Render grafis memakai protokol iTerm2.
    Iterm2,
}

#[derive(Parser, Debug)]
#[command(
    name = "fmap",
    author = "arifusr",
    version,
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
    #[command(
        subcommand,
        about = "Kelola mindmap (list, create, import, export, delete)"
    )]
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
        #[arg(
            long,
            value_name = "FILE",
            help = "Simpan render grafis high-resolution ke file PNG (mengabaikan --ascii)"
        )]
        image: Option<String>,
    },

    #[command(about = "Buka Interactive TUI (v = Canvas 2D)")]
    Ui {
        map_id: String,
        #[arg(long, help = "Buka langsung dalam mode 2D Canvas")]
        canvas: bool,
        #[arg(
            long,
            value_enum,
            default_value = "auto",
            help = "Mode render canvas grafis (auto mendeteksi dari environment)"
        )]
        graphics: GraphicsMode,
        #[arg(
            long,
            value_name = "WxH",
            help = "Ukuran sel font WxH untuk mode grafis (default: deteksi otomatis, fallback 9x18)"
        )]
        cell_size: Option<String>,
        #[arg(
            long,
            default_value_t = 1.0,
            help = "Zoom awal canvas grafis (0.5–4.0; 1.0 = normal)"
        )]
        zoom: f32,
    },

    #[command(about = "Pencarian teks & catatan di mindmap")]
    Search {
        query: String,
        #[arg(long)]
        map: Option<String>,
    },

    #[command(about = "Cari jalur koneksi terpendek antara dua node")]
    Path { node_a: String, node_b: String },

    #[command(about = "Jalankan kueri graf Cypher")]
    Cypher { query: String },

    #[command(subcommand, about = "Mutasi node (add, edit, rm)")]
    Node(NodeCommands),

    #[command(subcommand, about = "Kelola arrow link antar-node")]
    Link(LinkCommands),
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
    Delete { map_id: String },
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
    Rm { map_id: String, node_id: String },

    #[command(about = "Naikkan urutan node di antara saudaranya")]
    Up { map_id: String, node_id: String },

    #[command(about = "Turunkan urutan node di antara saudaranya")]
    Down { map_id: String, node_id: String },
}

#[derive(Subcommand, Debug)]
pub enum LinkCommands {
    #[command(about = "Buat arrow link dari node sumber ke target")]
    Add {
        map_id: String,
        source_id: String,
        target_id: String,
    },

    #[command(about = "Hapus arrow link dari node sumber ke target")]
    Rm {
        map_id: String,
        source_id: String,
        target_id: String,
    },
}
