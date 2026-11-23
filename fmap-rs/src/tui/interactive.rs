use crate::formatter::{format_outliner_tree, render_canvas, CanvasOptions, TreeViewOptions};
use crate::model::TreeNode;
use crate::storage::LadybugStorage;
use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Terminal,
};
use std::io;

pub fn run_interactive_tui(storage: &LadybugStorage, map_id: &str) -> Result<()> {
    let tree = storage.load_tree(map_id)?;

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = tui_loop(&mut terminal, &tree, map_id);

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
    root: &TreeNode,
    map_id: &str,
) -> Result<()> {
    let mut is_canvas_mode = false;
    let mut selected_idx = 0;
    let mut info_scroll = 0;

    let flattened = flatten_tree(root, 0);

    loop {
        let (tree_text, _) = format_outliner_tree(
            root,
            &TreeViewOptions {
                max_depth: 99,
                show_ids: true,
                use_colors: false,
            },
        );

        let canvas_text = render_canvas(
            root,
            &CanvasOptions {
                max_label: 32,
                level_gap: 4,
                row_gap: 2,
                ascii: false,
            },
        );

        let selected_node = flattened.get(selected_idx).map(|(n, _)| *n).unwrap_or(root);

        terminal.draw(|f| {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(5), Constraint::Length(3)])
                .split(f.area());

            let main_chunks = Layout::default()
                .direction(Direction::Horizontal)
                // Rasio 65% Peta, 35% Info (sesuai penyesuaian UX yang disepakati)
                .constraints([Constraint::Percentage(65), Constraint::Percentage(35)])
                .split(chunks[0]);

            // Panel Kiri: Peta / Canvas
            let left_title = if is_canvas_mode {
                format!(" Mindmap 2D Canvas [Peta: {}] ", map_id)
            } else {
                format!(" Outliner Tree View [Peta: {}] ", map_id)
            };

            let left_content = if is_canvas_mode {
                canvas_text.as_str()
            } else {
                tree_text.as_str()
            };

            let left_block = Block::default()
                .title(Span::styled(left_title, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray));

            let left_p = Paragraph::new(left_content)
                .block(left_block)
                .wrap(Wrap { trim: false });
            f.render_widget(left_p, main_chunks[0]);

            // Panel Kanan: Node Detail Inspector (dengan vertical scroll)
            let right_title = format!(" Detail Node: [{}] ", selected_node.id);
            let right_block = Block::default()
                .title(Span::styled(right_title, Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray));

            let mut info_lines = vec![
                Line::from(vec![
                    Span::styled("ID       : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(&selected_node.id, Style::default().fg(Color::White)),
                ]),
                Line::from(vec![
                    Span::styled("Teks Utuh: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(&selected_node.text, Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
                ]),
                Line::from(vec![
                    Span::styled("Catatan  : ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        selected_node.note.as_deref().unwrap_or("(tidak ada catatan)"),
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
                    Span::styled(format!("{} anak", selected_node.children.len()), Style::default().fg(Color::White)),
                ]),
                Line::from(""),
                Line::from(Span::styled("─── Isi Lengkap ───", Style::default().fg(Color::DarkGray))),
                Line::from(Span::styled(&selected_node.text, Style::default().fg(Color::White))),
            ];

            if let Some(ref note) = selected_node.note {
                info_lines.push(Line::from(""));
                info_lines.push(Line::from(Span::styled("─── Catatan Tambahan ───", Style::default().fg(Color::DarkGray))));
                for l in note.lines() {
                    info_lines.push(Line::from(Span::styled(l, Style::default().fg(Color::Gray))));
                }
            }

            let right_p = Paragraph::new(info_lines)
                .block(right_block)
                .scroll((info_scroll, 0))
                .wrap(Wrap { trim: false });
            f.render_widget(right_p, main_chunks[1]);

            // Bottom Status & Help Bar
            let help_text = vec![
                Span::styled(" [q] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                Span::raw(" Keluar  "),
                Span::styled(" [v] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                Span::raw(if is_canvas_mode { " Mode Tree  " } else { " Mode 2D Canvas  " }),
                Span::styled(" [↑/↓] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                Span::raw(" Pilih Node  "),
                Span::styled(" [j/k] ", Style::default().fg(Color::Black).bg(Color::Cyan)),
                Span::raw(" Scroll Info"),
            ];

            let help_block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray));
            let help_p = Paragraph::new(Line::from(help_text)).block(help_block);
            f.render_widget(help_p, chunks[1]);
        })?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break,
                    KeyCode::Char('v') => is_canvas_mode = !is_canvas_mode,
                    KeyCode::Down => {
                        if selected_idx + 1 < flattened.len() {
                            selected_idx += 1;
                            info_scroll = 0;
                        }
                    }
                    KeyCode::Up => {
                        if selected_idx > 0 {
                            selected_idx -= 1;
                            info_scroll = 0;
                        }
                    }
                    KeyCode::Char('j') => {
                        info_scroll = info_scroll.saturating_add(1);
                    }
                    KeyCode::Char('k') => {
                        info_scroll = info_scroll.saturating_sub(1);
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

fn flatten_tree<'a>(node: &'a TreeNode, depth: usize) -> Vec<(&'a TreeNode, usize)> {
    let mut list = vec![(node, depth)];
    for child in &node.children {
        list.extend(flatten_tree(child, depth + 1));
    }
    list
}

