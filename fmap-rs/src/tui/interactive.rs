use crate::formatter::{
    compute_canvas, find_canvas_neighbor, CanvasData, CanvasNodeInfo, CanvasOptions,
};
use crate::model::TreeNode;
use crate::storage::LadybugStorage;
use anyhow::Result;
use chrono::{Local, NaiveDateTime, TimeZone, Utc};
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
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
use std::io;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
struct FlatItem<'a> {
    node: &'a TreeNode,
    depth: usize,
    parent_id: Option<String>,
}

#[derive(Clone, Debug)]
enum ArrowPromptAction {
    Add { source_id: String },
    Remove { source_id: String },
}

pub fn run_interactive_tui(
    storage: &LadybugStorage,
    map_id: &str,
    start_canvas: bool,
) -> Result<()> {
    let mut tree = storage.load_tree(map_id)?;

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = tui_loop(&mut terminal, storage, &mut tree, map_id, start_canvas);

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

fn tui_loop<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    storage: &LadybugStorage,
    tree: &mut TreeNode,
    map_id: &str,
    start_canvas: bool,
) -> Result<()> {
    let mut is_canvas_mode = start_canvas;
    let mut selected_id = tree.id.clone();
    let mut info_scroll: u16 = 0;
    let mut link_prompt: Option<(ArrowPromptAction, String)> = None;
    let mut pan_x: usize = 0;
    let mut pan_y: usize = 0;

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
                .constraints([Constraint::Min(5), Constraint::Length(3)])
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
                format!(
                    " 🧠 Mindmap 2D Canvas [Peta: {}] (Posisi: x={}, y={}) ",
                    map_id, pan_x, pan_y
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
                let lines =
                    render_canvas_viewport(&canvas_data, Some(&selected_id), pan_x, pan_y, vw, vh);
                let p = Paragraph::new(lines).block(left_block);
                f.render_widget(p, left_chunk);
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
            let help_text = if is_canvas_mode {
                vec![
                    Span::styled(" [q] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Keluar  "),
                    Span::styled(" [v] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Mode Tree  "),
                    Span::styled(
                        " [←↑↓→ / WASD] ",
                        Style::default().fg(Color::Black).bg(Color::Yellow),
                    ),
                    Span::raw(" Sorot Node (Highlight)  "),
                    Span::styled(
                        " [Space] ",
                        Style::default().fg(Color::Black).bg(Color::Cyan),
                    ),
                    Span::raw(" Lipat  "),
                    Span::styled(
                        " [PgUp/PgDn] ",
                        Style::default().fg(Color::Black).bg(Color::Cyan),
                    ),
                    Span::raw(" Scroll Info  "),
                    Span::styled(" [0] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Reset Pan"),
                    Span::styled(" [r/x] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Tambah/Hapus Arrow"),
                ]
            } else {
                vec![
                    Span::styled(" [q] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Keluar  "),
                    Span::styled(" [v] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Mode 2D Canvas  "),
                    Span::styled(" [↑/↓] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Pilih Node  "),
                    Span::styled(" [←/→] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Induk/Anak  "),
                    Span::styled(
                        " [Space] ",
                        Style::default().fg(Color::Black).bg(Color::Cyan),
                    ),
                    Span::raw(" Lipat  "),
                    Span::styled(
                        " [PgUp/PgDn] ",
                        Style::default().fg(Color::Black).bg(Color::Cyan),
                    ),
                    Span::raw(" Scroll Info  "),
                    Span::styled(" [r/x] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                    Span::raw(" Tambah/Hapus Arrow"),
                ]
            };

            let help_block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray));
            let help_p = Paragraph::new(Line::from(help_text)).block(help_block);
            f.render_widget(help_p, chunks[1]);

            if let Some((action, input)) = &link_prompt {
                let area = centered_rect(60, 20, f.area());
                f.render_widget(Clear, area);
                let action_text = match action {
                    ArrowPromptAction::Add { source_id } => {
                        format!("Dari [{}], ID target arrow link baru:", source_id)
                    }
                    ArrowPromptAction::Remove { source_id } => {
                        format!("Dari [{}], ID target arrow link yang dihapus:", source_id)
                    }
                };
                let prompt = Paragraph::new(vec![
                    Line::from(action_text),
                    Line::from(input.as_str()),
                    Line::from("Enter: konfirmasi | Esc: batal"),
                ])
                .block(
                    Block::default()
                        .title(" Arrow Link ")
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(Color::Cyan)),
                );
                f.render_widget(prompt, area);
            }
        })?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                let mut prompt_handled = false;
                let mut submitted_target = None;
                if link_prompt.is_some() {
                    prompt_handled = true;
                    if let Some((_, input)) = link_prompt.as_mut() {
                        match key.code {
                            KeyCode::Esc => link_prompt = None,
                            KeyCode::Enter => submitted_target = Some(input.clone()),
                            KeyCode::Backspace => {
                                input.pop();
                            }
                            KeyCode::Char(ch) => input.push(ch),
                            _ => {}
                        }
                    }
                    if let Some(target_id) = submitted_target {
                        if let Some((action, _)) = link_prompt.take() {
                            if !target_id.trim().is_empty() {
                                match action {
                                    ArrowPromptAction::Add { source_id } => {
                                        storage.add_arrow_link(
                                            map_id,
                                            &source_id,
                                            target_id.trim(),
                                        )?;
                                    }
                                    ArrowPromptAction::Remove { source_id } => {
                                        storage.remove_arrow_link(
                                            map_id,
                                            &source_id,
                                            target_id.trim(),
                                        )?;
                                    }
                                }
                                *tree = storage.load_tree(map_id)?;
                                info_scroll = 0;
                            }
                        }
                    }
                }
                if prompt_handled {
                    continue;
                }
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break,
                    KeyCode::Char('v') => {
                        is_canvas_mode = !is_canvas_mode;
                    }
                    KeyCode::Char('0') => {
                        pan_x = 0;
                        pan_y = 0;
                    }
                    KeyCode::Char('r') => {
                        link_prompt = Some((
                            ArrowPromptAction::Add {
                                source_id: selected_id.clone(),
                            },
                            String::new(),
                        ));
                    }
                    KeyCode::Char('x') => {
                        link_prompt = Some((
                            ArrowPromptAction::Remove {
                                source_id: selected_id.clone(),
                            },
                            String::new(),
                        ));
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
                    KeyCode::Left | KeyCode::Char('a') | KeyCode::Char('h') => {
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
                    KeyCode::Right | KeyCode::Char('d') | KeyCode::Char('l') => {
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
                    KeyCode::Up | KeyCode::Char('w') | KeyCode::Char('k') => {
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
                    KeyCode::Down | KeyCode::Char('s') | KeyCode::Char('j') => {
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

fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1])[1]
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
}
