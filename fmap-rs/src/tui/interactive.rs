use crate::cli::GraphicsMode;
use crate::formatter::{
    compute_canvas, find_canvas_neighbor, render_canvas_image, CanvasData, CanvasNodeInfo,
    CanvasOptions,
};
use crate::model::TreeNode;
use crate::storage::LadybugStorage;
use anyhow::Result;
use chrono::{Local, NaiveDateTime, TimeZone, Utc};
use crossterm::{
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind, KeyModifiers,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
    Terminal,
};
use ratatui_image::{
    picker::{Picker, ProtocolType},
    protocol::StatefulProtocol,
    FilterType, Resize, StatefulImage,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
struct FlatItem<'a> {
    node: &'a TreeNode,
    depth: usize,
    parent_id: Option<String>,
}

#[derive(Clone, Debug)]
enum PromptAction {
    AddLink { source_id: String },
    RemoveLink { source_id: String },
    AddChild { parent_id: String },
    AddSibling { sibling_id: String },
    EditText { node_id: String },
    EditNote { node_id: String },
}

/// Input teks satu baris dengan dukungan pergerakan kursor.
#[derive(Clone, Debug)]
struct TextInput {
    value: String,
    /// Posisi kursor dalam satuan karakter (bukan byte).
    cursor: usize,
}

impl TextInput {
    fn new(value: impl Into<String>) -> Self {
        let value = value.into();
        let cursor = value.chars().count();
        Self { value, cursor }
    }

    fn as_str(&self) -> &str {
        &self.value
    }

    fn len_chars(&self) -> usize {
        self.value.chars().count()
    }

    fn byte_index(&self, char_idx: usize) -> usize {
        self.value
            .char_indices()
            .nth(char_idx)
            .map(|(idx, _)| idx)
            .unwrap_or(self.value.len())
    }

    fn insert_char(&mut self, ch: char) {
        let idx = self.byte_index(self.cursor);
        self.value.insert(idx, ch);
        self.cursor += 1;
    }

    fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let start = self.byte_index(self.cursor - 1);
        let end = self.byte_index(self.cursor);
        self.value.replace_range(start..end, "");
        self.cursor -= 1;
    }

    fn delete(&mut self) {
        if self.cursor >= self.len_chars() {
            return;
        }
        let start = self.byte_index(self.cursor);
        let end = self.byte_index(self.cursor + 1);
        self.value.replace_range(start..end, "");
    }

    fn move_left(&mut self) {
        self.cursor = self.cursor.saturating_sub(1);
    }

    fn move_right(&mut self) {
        if self.cursor < self.len_chars() {
            self.cursor += 1;
        }
    }

    fn move_home(&mut self) {
        self.cursor = 0;
    }

    fn move_end(&mut self) {
        self.cursor = self.len_chars();
    }
}

#[derive(Clone, Debug)]
struct PromptState {
    action: PromptAction,
    input: TextInput,
    error: Option<String>,
}

#[derive(Clone, Debug)]
struct DeleteConfirm {
    node_id: String,
    text: String,
    descendant_count: usize,
}

#[derive(Clone, Debug)]
struct StatusMessage {
    text: String,
    at: Instant,
    is_error: bool,
}

fn status_ok(text: impl Into<String>) -> StatusMessage {
    StatusMessage {
        text: text.into(),
        at: Instant::now(),
        is_error: false,
    }
}

fn status_err(text: impl Into<String>) -> StatusMessage {
    StatusMessage {
        text: text.into(),
        at: Instant::now(),
        is_error: true,
    }
}

struct ApplyOutcome {
    selected_id: Option<String>,
    message: String,
}

enum PromptError {
    Validation(String),
    Storage(anyhow::Error),
}

const STATUS_TTL: Duration = Duration::from_secs(4);

pub fn run_interactive_tui(
    storage: &LadybugStorage,
    map_id: &str,
    start_canvas: bool,
    graphics_mode: GraphicsMode,
    cell_size: (u16, u16),
) -> Result<()> {
    let mut tree = storage.load_tree(map_id)?;

    // Resolve the graphics protocol without querying stdin. Terminal queries
    // can leak a reader thread that swallows the first keypress, so detection
    // is environment based and can be overridden with `--graphics`.
    let protocol = resolve_graphics_protocol(graphics_mode);
    let mut picker = Picker::from_fontsize((cell_size.0.max(1), cell_size.1.max(1)));
    picker.set_protocol_type(protocol);
    let start_graphics = match graphics_mode {
        GraphicsMode::Ascii => false,
        GraphicsMode::Auto => !matches!(protocol, ProtocolType::Halfblocks),
        _ => true,
    };
    let ascii_hint = start_canvas && graphics_mode == GraphicsMode::Auto && !start_graphics;

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = tui_loop(
        &mut terminal,
        storage,
        &mut tree,
        map_id,
        start_canvas,
        GraphicsSetup {
            picker,
            start_graphics,
            ascii_hint,
        },
    );

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    res
}

struct GraphicsSetup {
    picker: Picker,
    start_graphics: bool,
    ascii_hint: bool,
}

fn tui_loop<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    storage: &LadybugStorage,
    tree: &mut TreeNode,
    map_id: &str,
    start_canvas: bool,
    graphics: GraphicsSetup,
) -> Result<()> {
    let GraphicsSetup {
        picker,
        start_graphics,
        ascii_hint,
    } = graphics;
    let graphics_protocol = picker.protocol_type();
    let (cell_width, cell_height) = {
        let (w, h) = picker.font_size();
        (w.max(1), h.max(1))
    };

    let mut is_canvas_mode = start_canvas;
    let mut is_graphics_mode = start_graphics;
    let mut selected_id = tree.id.clone();
    let mut info_scroll: u16 = 0;
    let mut prompt: Option<PromptState> = None;
    let mut delete_confirm: Option<DeleteConfirm> = None;
    let mut status: Option<StatusMessage> = if ascii_hint {
        Some(status_ok(
            "Terminal tidak terdeteksi mendukung grafis; memakai canvas ASCII. Tekan g untuk halfblocks, atau jalankan dengan --graphics sixel/kitty.",
        ))
    } else {
        None
    };
    let mut pan_x: usize = 0;
    let mut pan_y: usize = 0;
    // Cached encoded image; invalidated when the tree, selection or viewport changes.
    let mut image_cache: Option<(u64, StatefulProtocol)> = None;

    let refresh_interval = Duration::from_millis(500);
    let mut last_refresh = Instant::now();

    let canvas_opts = CanvasOptions {
        max_label: 34,
        level_gap: 6,
        row_gap: 2,
        ascii: false,
    };

    loop {
        if last_refresh.elapsed() >= refresh_interval {
            last_refresh = Instant::now();
            if let Ok(fresh_tree) = storage.load_tree(map_id) {
                *tree = fresh_tree;
            }
        }

        if status
            .as_ref()
            .map(|message| message.at.elapsed() >= STATUS_TTL)
            .unwrap_or(false)
        {
            status = None;
        }

        let canvas_data = compute_canvas(tree, &canvas_opts);
        let visible_nodes = flatten_visible(tree, 0, None);

        // Pastikan selected_id selalu valid
        if !visible_nodes.iter().any(|it| it.node.id == selected_id)
            && !canvas_data.nodes.iter().any(|n| n.id == selected_id)
        {
            selected_id = tree.id.clone();
        }

        let selected_node = find_node_by_id(tree, &selected_id).unwrap_or(tree);

        terminal.draw(|f| {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(5), Constraint::Length(4)])
                .split(f.area());

            let main_chunks = Layout::default()
                .direction(Direction::Horizontal)
                // Rasio 65% Peta, 35% Info
                .constraints([Constraint::Percentage(65), Constraint::Percentage(35)])
                .split(chunks[0]);

            let left_chunk = main_chunks[0];
            let vw = left_chunk.width.saturating_sub(2) as usize;
            let vh = left_chunk.height.saturating_sub(2) as usize;

            // Auto-pan viewport jika dalam mode 2D Canvas agar node aktif selalu terlihat
            if is_canvas_mode {
                if let Some(sn) = canvas_data.nodes.iter().find(|n| n.id == selected_id) {
                    let sx = sn.x;
                    let sw = sn.width;
                    let sy = sn.y;

                    if sx < pan_x + 2 {
                        pan_x = sx.saturating_sub(2);
                    }
                    if sx + sw + 2 > pan_x + vw {
                        pan_x = (sx + sw + 2).saturating_sub(vw);
                    }
                    if sy < pan_y {
                        pan_y = sy.saturating_sub(1);
                    }
                    if sy + 2 > pan_y + vh {
                        pan_y = (sy + 2).saturating_sub(vh);
                    }
                }
            }

            // Panel Kiri: Peta (Outliner Tree atau Mindmap 2D Canvas)
            let left_title = if is_canvas_mode {
                let renderer = if is_graphics_mode {
                    protocol_label(graphics_protocol)
                } else {
                    "ASCII"
                };
                format!(
                    " 🧠 Mindmap 2D Canvas [{}] [Peta: {}] (x={}, y={}) ",
                    renderer, map_id, pan_x, pan_y
                )
            } else {
                format!(" 🌳 Outliner Tree View [Peta: {}] ", map_id)
            };

            let left_block = Block::default()
                .title(Span::styled(
                    left_title,
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray));

            if is_canvas_mode {
                if is_graphics_mode {
                    f.render_widget(left_block, left_chunk);

                    let inner = Rect {
                        x: left_chunk.x.saturating_add(1),
                        y: left_chunk.y.saturating_add(1),
                        width: left_chunk.width.saturating_sub(2),
                        height: left_chunk.height.saturating_sub(2),
                    };
                    if inner.width > 0 && inner.height > 0 {
                        let key = canvas_image_key(
                            &canvas_data,
                            Some(&selected_id),
                            pan_x,
                            pan_y,
                            inner.width as usize,
                            inner.height as usize,
                            cell_width,
                            cell_height,
                        );
                        if image_cache.as_ref().map(|(cached, _)| *cached) != Some(key) {
                            let img = render_canvas_image(
                                &canvas_data,
                                Some(&selected_id),
                                pan_x,
                                pan_y,
                                inner.width as usize,
                                inner.height as usize,
                                cell_width,
                                cell_height,
                            );
                            let protocol =
                                picker.new_resize_protocol(image::DynamicImage::ImageRgba8(img));
                            image_cache = Some((key, protocol));
                        }
                        if let Some((_, protocol)) = image_cache.as_mut() {
                            let widget = StatefulImage::default()
                                .resize(Resize::Fit(Some(FilterType::Triangle)));
                            f.render_stateful_widget(widget, inner, protocol);
                        }
                    }
                } else {
                    let lines = render_canvas_viewport(
                        &canvas_data,
                        Some(&selected_id),
                        pan_x,
                        pan_y,
                        vw,
                        vh,
                    );
                    let p = Paragraph::new(lines).block(left_block);
                    f.render_widget(p, left_chunk);
                }
            } else {
                let selected_idx = visible_nodes
                    .iter()
                    .position(|it| it.node.id == selected_id)
                    .unwrap_or(0);
                let scroll_offset = selected_idx.saturating_sub(vh / 2);

                let mut lines = Vec::new();
                for (i, it) in visible_nodes.iter().enumerate() {
                    let is_sel = i == selected_idx;
                    let indent = "  ".repeat(it.depth);
                    let fold_marker = if !it.node.children.is_empty() {
                        if it.node.folded {
                            "[+] "
                        } else {
                            "[-] "
                        }
                    } else {
                        "    "
                    };
                    let label = format!("{}{}{}", indent, fold_marker, it.node.text);

                    if is_sel {
                        lines.push(Line::from(vec![Span::styled(
                            format!(" ▶ {} ", label),
                            Style::default()
                                .fg(Color::Black)
                                .bg(Color::Cyan)
                                .add_modifier(Modifier::BOLD),
                        )]));
                    } else {
                        lines.push(Line::from(vec![
                            Span::styled(
                                format!("   {}{}", indent, fold_marker),
                                Style::default().fg(Color::DarkGray),
                            ),
                            Span::styled(
                                &it.node.text,
                                if it.depth == 0 {
                                    Style::default()
                                        .fg(Color::Yellow)
                                        .add_modifier(Modifier::BOLD)
                                } else {
                                    Style::default().fg(Color::White)
                                },
                            ),
                        ]));
                    }
                }

                let p = Paragraph::new(lines)
                    .block(left_block)
                    .scroll((scroll_offset as u16, 0));
                f.render_widget(p, left_chunk);
            }

            // Panel Kanan: Node Detail Inspector (dengan vertical scroll)
            let right_title = format!(" Detail Node: [{}] ", selected_node.id);
            let right_block = Block::default()
                .title(Span::styled(
                    right_title,
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray));

            let mut info_lines = vec![
                Line::from(vec![
                    Span::styled("ID       : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(&selected_node.id, Style::default().fg(Color::White)),
                ]),
                Line::from(vec![
                    Span::styled("Teks Utuh: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        &selected_node.text,
                        Style::default()
                            .fg(Color::Green)
                            .add_modifier(Modifier::BOLD),
                    ),
                ]),
                Line::from(vec![
                    Span::styled("Catatan  : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        selected_node
                            .note
                            .as_deref()
                            .unwrap_or("(tidak ada catatan)"),
                        Style::default().fg(Color::White),
                    ),
                ]),
                Line::from(vec![
                    Span::styled("Posisi   : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        selected_node.position.as_deref().unwrap_or("default"),
                        Style::default().fg(Color::White),
                    ),
                ]),
                Line::from(vec![
                    Span::styled("Dilipat  : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        if selected_node.folded { "Ya" } else { "Tidak" },
                        Style::default().fg(Color::White),
                    ),
                ]),
                Line::from(vec![
                    Span::styled("Sub-node : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        format!("{} cabang anak", selected_node.children.len()),
                        Style::default().fg(Color::White),
                    ),
                ]),
                Line::from(vec![
                    Span::styled("Dibuat lokal : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        format_local_timestamp(selected_node.created_at.as_deref()),
                        Style::default().fg(Color::White),
                    ),
                ]),
                Line::from(vec![
                    Span::styled("Update lokal : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        format_local_timestamp(selected_node.updated_at.as_deref()),
                        Style::default().fg(Color::White),
                    ),
                ]),
                Line::from(""),
                Line::from(Span::styled(
                    "─── Isi Lengkap ───",
                    Style::default().fg(Color::DarkGray),
                )),
                Line::from(Span::styled(
                    &selected_node.text,
                    Style::default().fg(Color::White),
                )),
            ];

            if let Some(ref note) = selected_node.note {
                info_lines.push(Line::from(""));
                info_lines.push(Line::from(Span::styled(
                    "─── Catatan Tambahan ───",
                    Style::default().fg(Color::DarkGray),
                )));
                for l in note.lines() {
                    info_lines.push(Line::from(Span::styled(
                        l,
                        Style::default().fg(Color::Gray),
                    )));
                }
            }

            info_lines.push(Line::from(""));
            info_lines.push(Line::from(Span::styled(
                format!("─── Arrow keluar ({}) ───", selected_node.arrow_links.len()),
                Style::default().fg(Color::DarkGray),
            )));
            if selected_node.arrow_links.is_empty() {
                info_lines.push(Line::from(Span::styled(
                    "(tidak ada)",
                    Style::default().fg(Color::Gray),
                )));
            } else {
                for target_id in &selected_node.arrow_links {
                    let target_text = find_node_by_id(tree, target_id)
                        .map(|node| node.text.as_str())
                        .unwrap_or("(node tidak ditemukan)");
                    info_lines.push(Line::from(vec![
                        Span::styled("→ ", Style::default().fg(Color::Cyan)),
                        Span::styled(target_id, Style::default().fg(Color::Yellow)),
                        Span::raw(format!("  {}", target_text)),
                    ]));
                }
            }

            let incoming_links = collect_incoming_arrow_links(tree, &selected_node.id);
            info_lines.push(Line::from(Span::styled(
                format!("─── Arrow masuk ({}) ───", incoming_links.len()),
                Style::default().fg(Color::DarkGray),
            )));
            if incoming_links.is_empty() {
                info_lines.push(Line::from(Span::styled(
                    "(tidak ada)",
                    Style::default().fg(Color::Gray),
                )));
            } else {
                for (source_id, source_text) in incoming_links {
                    info_lines.push(Line::from(vec![
                        Span::styled("← ", Style::default().fg(Color::Magenta)),
                        Span::styled(source_id, Style::default().fg(Color::Yellow)),
                        Span::raw(format!("  {}", source_text)),
                    ]));
                }
            }

            let right_p = Paragraph::new(info_lines)
                .block(right_block)
                .scroll((info_scroll, 0))
                .wrap(Wrap { trim: false });
            f.render_widget(right_p, main_chunks[1]);

            // Bottom Status & Help Bar
            let navigation_help = if is_canvas_mode {
                Line::from(vec![
                    key_hint("[q]"),
                    Span::raw(" Keluar  "),
                    key_hint("[v]"),
                    Span::raw(" Mode Tree  "),
                    key_hint("[←↑↓→]"),
                    Span::raw(" Sorot  "),
                    key_hint("[Space]"),
                    Span::raw(" Lipat  "),
                    key_hint("[PgUp/PgDn]"),
                    Span::raw(" Info  "),
                    key_hint("[g]"),
                    Span::raw(" Grafis/ASCII  "),
                    key_hint("[0]"),
                    Span::raw(" Reset Pan"),
                ])
            } else {
                Line::from(vec![
                    key_hint("[q]"),
                    Span::raw(" Keluar  "),
                    key_hint("[v]"),
                    Span::raw(" Mode 2D Canvas  "),
                    key_hint("[↑/↓]"),
                    Span::raw(" Pilih  "),
                    key_hint("[←/→]"),
                    Span::raw(" Induk/Anak  "),
                    key_hint("[Space]"),
                    Span::raw(" Lipat  "),
                    key_hint("[PgUp/PgDn]"),
                    Span::raw(" Scroll Info"),
                ])
            };
            let edit_help = Line::from(vec![
                key_hint("[c]"),
                Span::raw(" Child  "),
                key_hint("[s]"),
                Span::raw(" Sibling  "),
                key_hint("[⇧↑↓]"),
                Span::raw(" Urut  "),
                key_hint("[e]"),
                Span::raw(" Edit  "),
                key_hint("[n]"),
                Span::raw(" Catatan  "),
                key_hint("[Del]"),
                Span::raw(" Hapus  "),
                key_hint("[r/x]"),
                Span::raw(" Arrow"),
            ]);
            let status_line = status.as_ref().map(|message| {
                Line::from(Span::styled(
                    message.text.clone(),
                    Style::default()
                        .fg(Color::Black)
                        .bg(if message.is_error {
                            Color::Red
                        } else {
                            Color::Green
                        })
                        .add_modifier(Modifier::BOLD),
                ))
            });

            let help_block = Block::default()
                .borders(Borders::ALL)
                .title(Span::styled(
                    " Bantuan ",
                    Style::default().fg(Color::DarkGray),
                ))
                .border_style(Style::default().fg(Color::DarkGray));
            let help_p = Paragraph::new(vec![navigation_help, status_line.unwrap_or(edit_help)])
                .block(help_block);
            f.render_widget(help_p, chunks[1]);

            if let Some(prompt_state) = &prompt {
                let area = centered_rect_fixed(modal_width(f.area()), 10, f.area());
                f.render_widget(Clear, area);
                let (title, description) = prompt_header(&prompt_state.action, tree);
                let mut lines = vec![
                    Line::from(Span::styled(description, Style::default().fg(Color::White))),
                    Line::from(""),
                    input_line(&prompt_state.input),
                ];
                if let Some(ref error) = prompt_state.error {
                    lines.push(Line::from(Span::styled(
                        error.clone(),
                        Style::default().fg(Color::Red),
                    )));
                } else {
                    lines.push(Line::from(""));
                }
                lines.push(Line::from(Span::styled(
                    "Enter: simpan | Esc: batal | ←/→/Home/End: geser kursor",
                    Style::default().fg(Color::DarkGray),
                )));
                let dialog = Paragraph::new(lines)
                    .block(
                        Block::default()
                            .title(format!(" {} ", title))
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(Color::Cyan)),
                    )
                    .wrap(Wrap { trim: false });
                f.render_widget(dialog, area);
            }

            if let Some(confirm) = &delete_confirm {
                let area = centered_rect_fixed(modal_width(f.area()), 9, f.area());
                f.render_widget(Clear, area);
                let mut lines = vec![
                    Line::from(vec![
                        Span::styled("Hapus node ", Style::default().fg(Color::White)),
                        Span::styled(confirm.node_id.as_str(), Style::default().fg(Color::Yellow)),
                        Span::styled("?", Style::default().fg(Color::White)),
                    ]),
                    Line::from(Span::styled(
                        confirm.text.clone(),
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                ];
                if confirm.descendant_count > 0 {
                    lines.push(Line::from(Span::styled(
                        format!(
                            "⚠ Node ini punya {} turunan; seluruh subtree ikut terhapus.",
                            confirm.descendant_count
                        ),
                        Style::default().fg(Color::Red),
                    )));
                } else {
                    lines.push(Line::from(""));
                }
                lines.push(Line::from(Span::styled(
                    "y/Enter: hapus | n/Esc: batal",
                    Style::default().fg(Color::DarkGray),
                )));
                let dialog = Paragraph::new(lines)
                    .block(
                        Block::default()
                            .title(" Konfirmasi Hapus ")
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(Color::Red)),
                    )
                    .wrap(Wrap { trim: false });
                f.render_widget(dialog, area);
            }
        })?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Release {
                    continue;
                }

                if key.modifiers.contains(KeyModifiers::CONTROL) {
                    if matches!(key.code, KeyCode::Char('c') | KeyCode::Char('d')) {
                        break;
                    }
                    continue;
                }

                // Dialog konfirmasi hapus node
                if let Some(confirm) = delete_confirm.take() {
                    match key.code {
                        KeyCode::Enter | KeyCode::Char('y') | KeyCode::Char('Y') => {
                            let parent_id = flatten_visible(tree, 0, None)
                                .iter()
                                .find(|item| item.node.id == confirm.node_id)
                                .and_then(|item| item.parent_id.clone());

                            match storage.delete_node(&confirm.node_id) {
                                Ok(()) => match storage.load_tree(map_id) {
                                    Ok(fresh_tree) => {
                                        *tree = fresh_tree;
                                        selected_id = parent_id
                                            .filter(|pid| find_node_by_id(tree, pid).is_some())
                                            .unwrap_or_else(|| tree.id.clone());
                                        info_scroll = 0;
                                        status = Some(status_ok(format!(
                                            "Node [{}] beserta subtree-nya dihapus.",
                                            confirm.node_id
                                        )));
                                    }
                                    Err(err) => {
                                        status = Some(status_err(format!(
                                            "Gagal memuat ulang peta: {}",
                                            err
                                        )));
                                    }
                                },
                                Err(err) => {
                                    status =
                                        Some(status_err(format!("Gagal menghapus node: {}", err)));
                                }
                            }
                        }
                        KeyCode::Esc | KeyCode::Char('n') | KeyCode::Char('N') => {}
                        _ => {
                            // Tombol lain tidak menutup dialog konfirmasi
                            delete_confirm = Some(confirm);
                        }
                    }
                    continue;
                }

                // Input prompt teks (tambah child, edit teks/catatan, arrow link)
                if prompt.is_some() {
                    let mut close_prompt = false;
                    let mut submit = false;

                    if let Some(prompt_state) = prompt.as_mut() {
                        match key.code {
                            KeyCode::Esc => close_prompt = true,
                            KeyCode::Enter => submit = true,
                            KeyCode::Backspace => prompt_state.input.backspace(),
                            KeyCode::Delete => prompt_state.input.delete(),
                            KeyCode::Left => prompt_state.input.move_left(),
                            KeyCode::Right => prompt_state.input.move_right(),
                            KeyCode::Home => prompt_state.input.move_home(),
                            KeyCode::End => prompt_state.input.move_end(),
                            KeyCode::Char(ch) => prompt_state.input.insert_char(ch),
                            _ => {}
                        }
                    }

                    if close_prompt {
                        prompt = None;
                        continue;
                    }

                    if submit {
                        if let Some(mut prompt_state) = prompt.take() {
                            let applied = apply_prompt(
                                storage,
                                map_id,
                                tree,
                                &prompt_state.action,
                                prompt_state.input.as_str(),
                            );

                            match applied {
                                Ok(outcome) => match storage.load_tree(map_id) {
                                    Ok(fresh_tree) => {
                                        *tree = fresh_tree;
                                        if let Some(new_id) = outcome.selected_id {
                                            selected_id = new_id;
                                        }
                                        if find_node_by_id(tree, &selected_id).is_none() {
                                            selected_id = tree.id.clone();
                                        }
                                        info_scroll = 0;
                                        status = Some(status_ok(outcome.message));
                                    }
                                    Err(err) => {
                                        status = Some(status_err(format!(
                                            "Gagal memuat ulang peta: {}",
                                            err
                                        )));
                                    }
                                },
                                Err(PromptError::Validation(message)) => {
                                    prompt_state.error = Some(message);
                                    prompt = Some(prompt_state);
                                }
                                Err(PromptError::Storage(err)) => {
                                    prompt_state.error = Some(format!("Gagal menyimpan: {}", err));
                                    prompt = Some(prompt_state);
                                }
                            }
                        }
                    }
                    continue;
                }

                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break,
                    KeyCode::Char('c') => {
                        prompt = Some(PromptState {
                            action: PromptAction::AddChild {
                                parent_id: selected_id.clone(),
                            },
                            input: TextInput::new(""),
                            error: None,
                        });
                    }
                    KeyCode::Char('s') => {
                        if selected_id == tree.id {
                            status = Some(status_err("Root tidak punya sibling."));
                        } else {
                            prompt = Some(PromptState {
                                action: PromptAction::AddSibling {
                                    sibling_id: selected_id.clone(),
                                },
                                input: TextInput::new(""),
                                error: None,
                            });
                        }
                    }
                    KeyCode::Char('e') => {
                        if let Some(node) = find_node_by_id(tree, &selected_id) {
                            prompt = Some(PromptState {
                                action: PromptAction::EditText {
                                    node_id: node.id.clone(),
                                },
                                input: TextInput::new(node.text.clone()),
                                error: None,
                            });
                        }
                    }
                    KeyCode::Char('n') => {
                        if let Some(node) = find_node_by_id(tree, &selected_id) {
                            let note = node.note.clone().unwrap_or_default().replace('\n', " ");
                            prompt = Some(PromptState {
                                action: PromptAction::EditNote {
                                    node_id: node.id.clone(),
                                },
                                input: TextInput::new(note),
                                error: None,
                            });
                        }
                    }
                    KeyCode::Delete | KeyCode::Char('D') => {
                        if selected_id == tree.id {
                            status = Some(status_err("Root node tidak bisa dihapus."));
                        } else if let Some(node) = find_node_by_id(tree, &selected_id) {
                            let descendant_count = node.count_nodes().saturating_sub(1);
                            delete_confirm = Some(DeleteConfirm {
                                node_id: node.id.clone(),
                                text: node.text.clone(),
                                descendant_count,
                            });
                        }
                    }
                    KeyCode::Char('v') => {
                        is_canvas_mode = !is_canvas_mode;
                        // Force a full repaint so sixel/kitty image artifacts are cleared.
                        let _ = terminal.clear();
                    }
                    KeyCode::Char('g') => {
                        if is_canvas_mode {
                            is_graphics_mode = !is_graphics_mode;
                            let _ = terminal.clear();
                            status = Some(status_ok(if is_graphics_mode {
                                format!(
                                    "Canvas grafis aktif ({}). Tekan g untuk kembali ke ASCII.",
                                    protocol_label(graphics_protocol)
                                )
                            } else {
                                "Canvas ASCII aktif. Tekan g untuk mode grafis.".to_string()
                            }));
                        } else {
                            status = Some(status_ok(
                                "Tekan v untuk masuk Canvas 2D, lalu g untuk memilih renderer.",
                            ));
                        }
                    }
                    KeyCode::Char('0') => {
                        pan_x = 0;
                        pan_y = 0;
                    }
                    KeyCode::Char('r') => {
                        prompt = Some(PromptState {
                            action: PromptAction::AddLink {
                                source_id: selected_id.clone(),
                            },
                            input: TextInput::new(""),
                            error: None,
                        });
                    }
                    KeyCode::Char('x') => {
                        prompt = Some(PromptState {
                            action: PromptAction::RemoveLink {
                                source_id: selected_id.clone(),
                            },
                            input: TextInput::new(""),
                            error: None,
                        });
                    }
                    KeyCode::Char(' ') => {
                        if let Some(new_folded) = toggle_fold(tree, &selected_id) {
                            let _ = storage.update_node_folded(&selected_id, new_folded);
                        }
                    }
                    KeyCode::PageUp => {
                        info_scroll = info_scroll.saturating_sub(4);
                    }
                    KeyCode::PageDown => {
                        info_scroll = info_scroll.saturating_add(4);
                    }
                    KeyCode::Left => {
                        if is_canvas_mode {
                            let cdata = compute_canvas(tree, &canvas_opts);
                            if let Some(curr_idx) =
                                cdata.nodes.iter().position(|n| n.id == selected_id)
                            {
                                if let Some(next_idx) =
                                    find_canvas_neighbor(&cdata.nodes, curr_idx, -1, 0)
                                {
                                    selected_id = cdata.nodes[next_idx].id.clone();
                                    info_scroll = 0;
                                }
                            }
                        } else {
                            let vnodes = flatten_visible(tree, 0, None);
                            if let Some(curr) = vnodes.iter().find(|it| it.node.id == selected_id) {
                                if !curr.node.children.is_empty() && !curr.node.folded {
                                    if let Some(f) = toggle_fold(tree, &selected_id) {
                                        let _ = storage.update_node_folded(&selected_id, f);
                                    }
                                } else if let Some(ref pid) = curr.parent_id {
                                    selected_id = pid.clone();
                                    info_scroll = 0;
                                }
                            }
                        }
                    }
                    KeyCode::Right => {
                        if is_canvas_mode {
                            let cdata = compute_canvas(tree, &canvas_opts);
                            if let Some(curr_idx) =
                                cdata.nodes.iter().position(|n| n.id == selected_id)
                            {
                                if let Some(next_idx) =
                                    find_canvas_neighbor(&cdata.nodes, curr_idx, 1, 0)
                                {
                                    selected_id = cdata.nodes[next_idx].id.clone();
                                    info_scroll = 0;
                                }
                            }
                        } else {
                            let vnodes = flatten_visible(tree, 0, None);
                            if let Some(curr) = vnodes.iter().find(|it| it.node.id == selected_id) {
                                if !curr.node.children.is_empty() && curr.node.folded {
                                    if let Some(f) = toggle_fold(tree, &selected_id) {
                                        let _ = storage.update_node_folded(&selected_id, f);
                                    }
                                } else if !curr.node.children.is_empty() {
                                    selected_id = curr.node.children[0].id.clone();
                                    info_scroll = 0;
                                }
                            }
                        }
                    }
                    KeyCode::Up if key.modifiers.contains(KeyModifiers::SHIFT) => {
                        match apply_move(storage, map_id, tree, &selected_id, -1) {
                            Ok(true) => {
                                info_scroll = 0;
                                status = Some(status_ok("Urutan node dinaikkan."));
                            }
                            Ok(false) => {
                                status = Some(status_err(
                                    "Node sudah di urutan paling atas atau tidak punya sibling.",
                                ));
                            }
                            Err(err) => {
                                status =
                                    Some(status_err(format!("Gagal mengubah urutan: {}", err)));
                            }
                        }
                    }
                    KeyCode::Down if key.modifiers.contains(KeyModifiers::SHIFT) => {
                        match apply_move(storage, map_id, tree, &selected_id, 1) {
                            Ok(true) => {
                                info_scroll = 0;
                                status = Some(status_ok("Urutan node diturunkan."));
                            }
                            Ok(false) => {
                                status = Some(status_err(
                                    "Node sudah di urutan paling bawah atau tidak punya sibling.",
                                ));
                            }
                            Err(err) => {
                                status =
                                    Some(status_err(format!("Gagal mengubah urutan: {}", err)));
                            }
                        }
                    }
                    KeyCode::Up => {
                        if is_canvas_mode {
                            let cdata = compute_canvas(tree, &canvas_opts);
                            if let Some(curr_idx) =
                                cdata.nodes.iter().position(|n| n.id == selected_id)
                            {
                                if let Some(next_idx) =
                                    find_canvas_neighbor(&cdata.nodes, curr_idx, 0, -1)
                                {
                                    selected_id = cdata.nodes[next_idx].id.clone();
                                    info_scroll = 0;
                                }
                            }
                        } else {
                            let vnodes = flatten_visible(tree, 0, None);
                            if let Some(curr_idx) =
                                vnodes.iter().position(|it| it.node.id == selected_id)
                            {
                                if curr_idx > 0 {
                                    selected_id = vnodes[curr_idx - 1].node.id.clone();
                                    info_scroll = 0;
                                }
                            }
                        }
                    }
                    KeyCode::Down => {
                        if is_canvas_mode {
                            let cdata = compute_canvas(tree, &canvas_opts);
                            if let Some(curr_idx) =
                                cdata.nodes.iter().position(|n| n.id == selected_id)
                            {
                                if let Some(next_idx) =
                                    find_canvas_neighbor(&cdata.nodes, curr_idx, 0, 1)
                                {
                                    selected_id = cdata.nodes[next_idx].id.clone();
                                    info_scroll = 0;
                                }
                            }
                        } else {
                            let vnodes = flatten_visible(tree, 0, None);
                            if let Some(curr_idx) =
                                vnodes.iter().position(|it| it.node.id == selected_id)
                            {
                                if curr_idx + 1 < vnodes.len() {
                                    selected_id = vnodes[curr_idx + 1].node.id.clone();
                                    info_scroll = 0;
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

fn protocol_label(protocol: ProtocolType) -> &'static str {
    match protocol {
        ProtocolType::Halfblocks => "halfblocks",
        ProtocolType::Sixel => "sixel",
        ProtocolType::Kitty => "kitty",
        ProtocolType::Iterm2 => "iTerm2",
    }
}

fn resolve_graphics_protocol(mode: GraphicsMode) -> ProtocolType {
    match mode {
        GraphicsMode::Auto => detect_graphics_protocol_from_env(),
        GraphicsMode::Ascii | GraphicsMode::Halfblocks => ProtocolType::Halfblocks,
        GraphicsMode::Sixel => ProtocolType::Sixel,
        GraphicsMode::Kitty => ProtocolType::Kitty,
        GraphicsMode::Iterm2 => ProtocolType::Iterm2,
    }
}

/// Best-effort detection without writing/reading terminal queries.
fn detect_graphics_protocol_from_env() -> ProtocolType {
    let term = std::env::var("TERM")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let term_program = std::env::var("TERM_PROGRAM")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let lc_terminal = std::env::var("LC_TERMINAL")
        .unwrap_or_default()
        .to_ascii_lowercase();

    if std::env::var_os("KITTY_WINDOW_ID").is_some() || term.contains("kitty") {
        return ProtocolType::Kitty;
    }

    // Terminals that implement the iTerm2 inline-image protocol.
    if [
        "iterm", "wezterm", "mintty", "vscode", "tabby", "hyper", "rio",
    ]
    .iter()
    .any(|name| term_program.contains(name))
        || lc_terminal.contains("iterm")
    {
        return ProtocolType::Iterm2;
    }

    if term.contains("sixel")
        || term.contains("mlterm")
        || term.contains("foot")
        || term.contains("wezterm")
    {
        return ProtocolType::Sixel;
    }

    // Unknown terminal (including most tmux setups): halfblocks is safe.
    ProtocolType::Halfblocks
}

#[allow(clippy::too_many_arguments)]
fn canvas_image_key(
    canvas: &CanvasData,
    selected_id: Option<&str>,
    pan_x: usize,
    pan_y: usize,
    view_width: usize,
    view_height: usize,
    cell_width: u16,
    cell_height: u16,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    canvas.width.hash(&mut hasher);
    canvas.height.hash(&mut hasher);
    for node in &canvas.nodes {
        node.id.hash(&mut hasher);
        node.label.hash(&mut hasher);
        node.marker.hash(&mut hasher);
        node.x.hash(&mut hasher);
        node.y.hash(&mut hasher);
        node.width.hash(&mut hasher);
        node.folded.hash(&mut hasher);
        node.has_children.hash(&mut hasher);
        node.parent_idx.hash(&mut hasher);
        for link in &node.arrow_links {
            link.hash(&mut hasher);
        }
    }
    selected_id.hash(&mut hasher);
    pan_x.hash(&mut hasher);
    pan_y.hash(&mut hasher);
    view_width.hash(&mut hasher);
    view_height.hash(&mut hasher);
    cell_width.hash(&mut hasher);
    cell_height.hash(&mut hasher);
    hasher.finish()
}

fn centered_rect_fixed(width: u16, height: u16, area: Rect) -> Rect {
    let width = width.min(area.width);
    let height = height.min(area.height);
    Rect {
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
    }
}

fn modal_width(area: Rect) -> u16 {
    let preferred = (area.width as u32 * 3 / 5) as u16;
    preferred.max(40).min(area.width.saturating_sub(2).max(20))
}

fn key_hint(label: &str) -> Span<'static> {
    Span::styled(
        label.to_string(),
        Style::default().fg(Color::Black).bg(Color::Cyan),
    )
}

fn input_line(input: &TextInput) -> Line<'static> {
    let chars: Vec<char> = input.value.chars().collect();
    let cursor = input.cursor.min(chars.len());

    let mut spans = vec![Span::styled("> ", Style::default().fg(Color::DarkGray))];
    spans.push(Span::styled(
        chars[..cursor].iter().collect::<String>(),
        Style::default().fg(Color::White),
    ));
    if cursor < chars.len() {
        spans.push(Span::styled(
            chars[cursor].to_string(),
            Style::default()
                .fg(Color::Black)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(
            chars[cursor + 1..].iter().collect::<String>(),
            Style::default().fg(Color::White),
        ));
    } else {
        spans.push(Span::styled(" ", Style::default().bg(Color::Cyan)));
    }
    Line::from(spans)
}

fn prompt_header(action: &PromptAction, tree: &TreeNode) -> (String, String) {
    match action {
        PromptAction::AddLink { source_id } => (
            "Arrow Link".to_string(),
            format!("Dari [{}], masukkan ID target arrow link baru:", source_id),
        ),
        PromptAction::RemoveLink { source_id } => (
            "Hapus Arrow Link".to_string(),
            format!(
                "Dari [{}], masukkan ID target arrow link yang dihapus:",
                source_id
            ),
        ),
        PromptAction::AddChild { parent_id } => {
            let parent_text = find_node_by_id(tree, parent_id)
                .map(|node| node.text.as_str())
                .unwrap_or("(node tidak ditemukan)");
            (
                "Tambah Child".to_string(),
                format!(
                    "Induk [{}] \"{}\". Masukkan teks cabang baru:",
                    parent_id, parent_text
                ),
            )
        }
        PromptAction::AddSibling { sibling_id } => {
            let sibling_text = find_node_by_id(tree, sibling_id)
                .map(|node| node.text.as_str())
                .unwrap_or("(node tidak ditemukan)");
            (
                "Tambah Sibling".to_string(),
                format!(
                    "Saudara dari [{}] \"{}\". Masukkan teks saudara baru:",
                    sibling_id, sibling_text
                ),
            )
        }
        PromptAction::EditText { node_id } => (
            "Edit Teks Node".to_string(),
            format!("Node [{}]. Masukkan teks baru:", node_id),
        ),
        PromptAction::EditNote { node_id } => (
            "Edit Catatan Node".to_string(),
            format!(
                "Node [{}]. Masukkan catatan baru (kosongkan untuk menghapus):",
                node_id
            ),
        ),
    }
}

fn apply_prompt(
    storage: &LadybugStorage,
    map_id: &str,
    tree: &TreeNode,
    action: &PromptAction,
    raw_input: &str,
) -> Result<ApplyOutcome, PromptError> {
    match action {
        PromptAction::AddLink { source_id } => {
            let target_id = raw_input.trim();
            if target_id.is_empty() {
                return Err(PromptError::Validation(
                    "ID target tidak boleh kosong.".to_string(),
                ));
            }
            storage
                .add_arrow_link(map_id, source_id, target_id)
                .map_err(PromptError::Storage)?;
            Ok(ApplyOutcome {
                selected_id: None,
                message: format!("Arrow link {} → {} dibuat.", source_id, target_id),
            })
        }
        PromptAction::RemoveLink { source_id } => {
            let target_id = raw_input.trim();
            if target_id.is_empty() {
                return Err(PromptError::Validation(
                    "ID target tidak boleh kosong.".to_string(),
                ));
            }
            storage
                .remove_arrow_link(map_id, source_id, target_id)
                .map_err(PromptError::Storage)?;
            Ok(ApplyOutcome {
                selected_id: None,
                message: format!("Arrow link {} → {} dihapus.", source_id, target_id),
            })
        }
        PromptAction::AddChild { parent_id } => {
            let text = raw_input.trim();
            if text.is_empty() {
                return Err(PromptError::Validation(
                    "Teks cabang tidak boleh kosong.".to_string(),
                ));
            }
            let new_id = create_child(storage, map_id, tree, parent_id, text)?;
            Ok(ApplyOutcome {
                selected_id: Some(new_id),
                message: format!("Cabang \"{}\" ditambahkan.", text),
            })
        }
        PromptAction::AddSibling { sibling_id } => {
            let text = raw_input.trim();
            if text.is_empty() {
                return Err(PromptError::Validation(
                    "Teks saudara tidak boleh kosong.".to_string(),
                ));
            }
            let parent_id = find_parent_id(tree, sibling_id).ok_or_else(|| {
                PromptError::Validation("Node ini tidak punya induk (root).".to_string())
            })?;
            let new_id = create_child(storage, map_id, tree, &parent_id, text)?;
            Ok(ApplyOutcome {
                selected_id: Some(new_id),
                message: format!("Saudara \"{}\" ditambahkan.", text),
            })
        }
        PromptAction::EditText { node_id } => {
            let text = raw_input.trim();
            if text.is_empty() {
                return Err(PromptError::Validation(
                    "Teks node tidak boleh kosong.".to_string(),
                ));
            }
            storage
                .edit_node(node_id, text)
                .map_err(PromptError::Storage)?;
            Ok(ApplyOutcome {
                selected_id: None,
                message: "Teks node diperbarui.".to_string(),
            })
        }
        PromptAction::EditNote { node_id } => {
            storage
                .edit_node_note(node_id, raw_input.trim())
                .map_err(PromptError::Storage)?;
            Ok(ApplyOutcome {
                selected_id: None,
                message: "Catatan node diperbarui.".to_string(),
            })
        }
    }
}

fn apply_move(
    storage: &LadybugStorage,
    map_id: &str,
    tree: &mut TreeNode,
    selected_id: &str,
    delta: i64,
) -> Result<bool> {
    let moved = storage.move_node(map_id, selected_id, delta)?;
    if moved {
        *tree = storage.load_tree(map_id)?;
    }
    Ok(moved)
}

fn create_child(
    storage: &LadybugStorage,
    map_id: &str,
    tree: &TreeNode,
    parent_id: &str,
    text: &str,
) -> Result<String, PromptError> {
    if find_node_by_id(tree, parent_id)
        .map(|node| node.folded)
        .unwrap_or(false)
    {
        storage
            .update_node_folded(parent_id, false)
            .map_err(PromptError::Storage)?;
    }
    storage
        .add_node(map_id, parent_id, text)
        .map_err(PromptError::Storage)
}

fn collect_incoming_arrow_links<'a>(
    node: &'a TreeNode,
    target_id: &str,
) -> Vec<(&'a str, &'a str)> {
    let mut incoming = Vec::new();
    collect_incoming_arrow_links_into(node, target_id, &mut incoming);
    incoming
}

fn collect_incoming_arrow_links_into<'a>(
    node: &'a TreeNode,
    target_id: &str,
    incoming: &mut Vec<(&'a str, &'a str)>,
) {
    if node
        .arrow_links
        .iter()
        .any(|destination| destination == target_id)
    {
        incoming.push((&node.id, &node.text));
    }
    for child in &node.children {
        collect_incoming_arrow_links_into(child, target_id, incoming);
    }
}

fn format_local_timestamp(timestamp: Option<&str>) -> String {
    let Some(timestamp) = timestamp else {
        return "(tidak tersedia)".to_string();
    };
    let Ok(utc_time) = NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%d %H:%M:%S%.3f") else {
        return timestamp.to_string();
    };

    Utc.from_utc_datetime(&utc_time)
        .with_timezone(&Local)
        .format("%Y-%m-%d %H:%M:%S%.3f %:z")
        .to_string()
}

fn render_canvas_viewport(
    canvas: &CanvasData,
    selected_id: Option<&str>,
    pan_x: usize,
    pan_y: usize,
    vw: usize,
    vh: usize,
) -> Vec<Line<'static>> {
    let mut lines = Vec::with_capacity(vh);

    for y in pan_y..(pan_y + vh) {
        if y >= canvas.height {
            lines.push(Line::from(""));
            continue;
        }

        let row = &canvas.grid[y];
        let mut spans = Vec::new();

        // Cari semua node pada baris y
        let row_nodes: Vec<&CanvasNodeInfo> = canvas.nodes.iter().filter(|n| n.y == y).collect();

        let mut x = pan_x;
        let x_end = (pan_x + vw).min(canvas.width);

        while x < x_end {
            // Cek apakah koordinat x berada di dalam kotak suatu node
            if let Some(n) = row_nodes.iter().find(|n| x >= n.x && x < n.x + n.width) {
                let is_selected = selected_id.map(|sid| sid == n.id).unwrap_or(false);
                let node_end = (n.x + n.width).min(x_end);
                let text: String = row[x..node_end].iter().collect();

                let style = if is_selected {
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Yellow)
                        .add_modifier(Modifier::BOLD)
                } else if n.depth == 0 {
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD)
                } else if n.folded {
                    Style::default().fg(Color::DarkGray)
                } else {
                    Style::default().fg(Color::Cyan)
                };

                spans.push(Span::styled(text, style));
                x = node_end;
            } else {
                let start_x = x;
                let first_char = row.get(x).copied().unwrap_or(' ');
                let is_arrow = canvas
                    .arrow_mask
                    .get(y)
                    .and_then(|r| r.get(x))
                    .copied()
                    .unwrap_or(false);
                let is_edge = !is_arrow && is_box_drawing_char(first_char);

                while x < x_end {
                    if row_nodes.iter().any(|n| x >= n.x && x < n.x + n.width) {
                        break;
                    }
                    let ch = row.get(x).copied().unwrap_or(' ');
                    let ch_is_arrow = canvas
                        .arrow_mask
                        .get(y)
                        .and_then(|r| r.get(x))
                        .copied()
                        .unwrap_or(false);
                    if ch_is_arrow != is_arrow {
                        break;
                    }
                    if !is_arrow && is_box_drawing_char(ch) != is_edge {
                        break;
                    }
                    x += 1;
                }

                let text: String = row[start_x..x].iter().collect();
                let style = if is_arrow {
                    Style::default()
                        .fg(Color::Magenta)
                        .add_modifier(Modifier::BOLD)
                } else if is_edge {
                    Style::default().fg(Color::DarkGray)
                } else {
                    Style::default()
                };
                spans.push(Span::styled(text, style));
            }
        }

        lines.push(Line::from(spans));
    }

    lines
}

fn is_box_drawing_char(ch: char) -> bool {
    matches!(
        ch,
        '─' | '│'
            | '┌'
            | '┐'
            | '└'
            | '┘'
            | '├'
            | '┤'
            | '┬'
            | '┴'
            | '┼'
            | '+'
            | '|'
            | '-'
    )
}

fn flatten_visible<'a>(
    node: &'a TreeNode,
    depth: usize,
    parent_id: Option<String>,
) -> Vec<FlatItem<'a>> {
    let mut list = vec![FlatItem {
        node,
        depth,
        parent_id: parent_id.clone(),
    }];
    if !node.folded {
        for child in &node.children {
            list.extend(flatten_visible(child, depth + 1, Some(node.id.clone())));
        }
    }
    list
}

fn find_parent_id(node: &TreeNode, target_id: &str) -> Option<String> {
    for child in &node.children {
        if child.id == target_id {
            return Some(node.id.clone());
        }
        if let Some(parent_id) = find_parent_id(child, target_id) {
            return Some(parent_id);
        }
    }
    None
}

fn find_node_by_id<'a>(node: &'a TreeNode, target_id: &str) -> Option<&'a TreeNode> {
    if node.id == target_id {
        return Some(node);
    }
    for child in &node.children {
        if let Some(n) = find_node_by_id(child, target_id) {
            return Some(n);
        }
    }
    None
}

fn toggle_fold(node: &mut TreeNode, target_id: &str) -> Option<bool> {
    if node.id == target_id {
        if !node.children.is_empty() {
            node.folded = !node.folded;
            return Some(node.folded);
        }
        return None;
    }
    for child in &mut node.children {
        if let Some(f) = toggle_fold(child, target_id) {
            return Some(f);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incoming_arrow_links_include_nested_sources() {
        let mut root = TreeNode::new("root", "Root");
        let mut source = TreeNode::new("source", "Source");
        source.arrow_links.push("target".to_string());
        root.children.push(source);
        root.children.push(TreeNode::new("target", "Target"));

        assert_eq!(
            collect_incoming_arrow_links(&root, "target"),
            vec![("source", "Source")]
        );
    }

    #[test]
    fn find_parent_id_locates_nested_parent() {
        let mut root = TreeNode::new("root", "Root");
        let mut branch = TreeNode::new("branch", "Branch");
        branch.children.push(TreeNode::new("leaf", "Leaf"));
        root.children.push(branch);

        assert_eq!(find_parent_id(&root, "branch").as_deref(), Some("root"));
        assert_eq!(find_parent_id(&root, "leaf").as_deref(), Some("branch"));
        assert_eq!(find_parent_id(&root, "root"), None);
    }

    #[test]
    fn text_input_edits_at_cursor_position() {
        let mut input = TextInput::new("halo");
        assert_eq!(input.cursor, 4);

        input.insert_char('!');
        assert_eq!(input.as_str(), "halo!");

        input.move_left();
        input.move_left();
        input.insert_char('X');
        assert_eq!(input.as_str(), "halXo!");

        input.backspace();
        assert_eq!(input.as_str(), "halo!");

        input.move_home();
        input.delete();
        assert_eq!(input.as_str(), "alo!");

        input.move_end();
        input.delete();
        assert_eq!(input.as_str(), "alo!");
    }

    #[test]
    fn text_input_handles_multibyte_characters() {
        let mut input = TextInput::new("peta");
        input.insert_char('🗺');
        input.move_home();
        input.move_right();
        input.backspace();
        input.insert_char('é');

        assert_eq!(input.as_str(), "éeta🗺");
    }
}
