use crate::model::TreeNode;

pub struct CanvasOptions {
    pub max_label: usize,
    pub level_gap: usize,
    pub row_gap: usize,
    pub ascii: bool,
}

impl Default for CanvasOptions {
    fn default() -> Self {
        Self {
            max_label: 36,
            level_gap: 6,
            row_gap: 2,
            ascii: false,
        }
    }
}

#[allow(dead_code)]
struct LayoutNode<'a> {
    node: &'a TreeNode,
    depth: usize,
    label: String,
    has_children: bool,
    marker: String,
    width: usize,
    x: usize,
    y: usize,
    parent_idx: Option<usize>,
}

pub fn render_canvas(root: &TreeNode, options: &CanvasOptions) -> String {
    let mut layout_nodes: Vec<LayoutNode> = Vec::new();
    let mut max_depth = 0;

    fn collect<'a>(
        n: &'a TreeNode,
        depth: usize,
        parent_idx: Option<usize>,
        max_depth: &mut usize,
        options: &CanvasOptions,
        list: &mut Vec<LayoutNode<'a>>,
    ) {
        if depth > *max_depth {
            *max_depth = depth;
        }

        let label = truncate_label(&n.text, options.max_label);
        let has_children = !n.children.is_empty();
        let marker = if has_children {
            if n.folded {
                if options.ascii { "+".into() } else { "▸".into() }
            } else if options.ascii {
                "-".into()
            } else {
                "▾".into()
            }
        } else {
            String::new()
        };

        let width = display_width(&label) + 4 + if has_children { 2 } else { 0 };
        let current_idx = list.len();

        list.push(LayoutNode {
            node: n,
            depth,
            label,
            has_children,
            marker,
            width,
            x: 0,
            y: 0,
            parent_idx,
        });

        if !n.folded {
            for child in &n.children {
                collect(child, depth + 1, Some(current_idx), max_depth, options, list);
            }
        }
    }

    collect(root, 0, None, &mut max_depth, options, &mut layout_nodes);

    if layout_nodes.is_empty() {
        return String::new();
    }

    // Hitung lebar maksimal per level
    let mut max_width = vec![0; max_depth + 1];
    for ln in &layout_nodes {
        if ln.width > max_width[ln.depth] {
            max_width[ln.depth] = ln.width;
        }
    }

    let mut x_at = vec![0; max_depth + 1];
    for d in 1..=max_depth {
        x_at[d] = x_at[d - 1] + max_width[d - 1] + options.level_gap;
    }

    for ln in &mut layout_nodes {
        ln.x = x_at[ln.depth];
    }

    // Hitung posisi Y daun dan pusatkan induk
    let mut next_row = 0;
    assign_y(0, &mut layout_nodes, options.row_gap, &mut next_row);

    let min_y = layout_nodes.iter().map(|n| n.y).min().unwrap_or(0);
    for ln in &mut layout_nodes {
        ln.y -= min_y;
    }

    let total_width = x_at[max_depth] + max_width[max_depth] + 4;
    let total_height = layout_nodes.iter().map(|n| n.y).max().unwrap_or(0) + 1;

    // Render ke grid karakter 2D
    let mut grid = vec![vec![' '; total_width]; total_height];

    // Gambar edge garis konektor antar induk dan anak
    for i in 0..layout_nodes.len() {
        if let Some(pidx) = layout_nodes[i].parent_idx {
            let px = layout_nodes[pidx].x + layout_nodes[pidx].width;
            let py = layout_nodes[pidx].y;
            let cx = layout_nodes[i].x;
            let cy = layout_nodes[i].y;

            draw_edge(&mut grid, px, py, cx, cy, options.ascii);
        }
    }

    // Gambar label node [ Text ▾ ]
    for ln in &layout_nodes {
        let box_text = if ln.marker.is_empty() {
            format!("[ {} ]", ln.label)
        } else {
            format!("[ {} ] {}", ln.label, ln.marker)
        };

        put_str(&mut grid, ln.x, ln.y, &box_text);
    }

    // Gabungkan baris ke String
    grid.into_iter()
        .map(|row| row.into_iter().collect::<String>().trim_end().to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn assign_y(idx: usize, nodes: &mut [LayoutNode], row_gap: usize, next_row: &mut usize) {
    let child_indices: Vec<usize> = nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.parent_idx == Some(idx))
        .map(|(i, _)| i)
        .collect();

    if child_indices.is_empty() {
        nodes[idx].y = *next_row;
        *next_row += row_gap;
    } else {
        for &cidx in &child_indices {
            assign_y(cidx, nodes, row_gap, next_row);
        }
        let k = child_indices.len();
        nodes[idx].y = if k % 2 == 1 {
            nodes[child_indices[(k - 1) / 2]].y
        } else {
            (nodes[child_indices[k / 2 - 1]].y + nodes[child_indices[k / 2]].y) / 2
        };
    }
}

fn draw_edge(grid: &mut [Vec<char>], px: usize, py: usize, cx: usize, cy: usize, ascii: bool) {
    if py == cy {
        // Garis lurus horizontal
        for x in px..cx {
            if x < grid[py].len() {
                grid[py][x] = if ascii { '-' } else { '─' };
            }
        }
    } else {
        // Belokan
        let mid_x = px + 2;
        if py < cy {
            // Anak di bawah
            put_char(grid, mid_x, py, if ascii { '+' } else { '┬' });
            for y in (py + 1)..cy {
                put_char(grid, mid_x, y, if ascii { '|' } else { '│' });
            }
            put_char(grid, mid_x, cy, if ascii { '+' } else { '└' });
            for x in (mid_x + 1)..cx {
                put_char(grid, x, cy, if ascii { '-' } else { '─' });
            }
        } else {
            // Anak di atas
            put_char(grid, mid_x, py, if ascii { '+' } else { '┴' });
            for y in (cy + 1)..py {
                put_char(grid, mid_x, y, if ascii { '|' } else { '│' });
            }
            put_char(grid, mid_x, cy, if ascii { '+' } else { '┌' });
            for x in (mid_x + 1)..cx {
                put_char(grid, x, cy, if ascii { '-' } else { '─' });
            }
        }
    }
}

fn put_char(grid: &mut [Vec<char>], x: usize, y: usize, ch: char) {
    if y < grid.len() && x < grid[y].len() && grid[y][x] == ' ' {
        grid[y][x] = ch;
    }
}

fn put_str(grid: &mut [Vec<char>], x: usize, y: usize, s: &str) {
    if y >= grid.len() {
        return;
    }
    let mut curr_x = x;
    for ch in s.chars() {
        if curr_x >= grid[y].len() {
            break;
        }
        grid[y][curr_x] = ch;
        curr_x += 1;
    }
}

fn truncate_label(s: &str, max_len: usize) -> String {
    let t = s.trim().replace('\n', " ");
    if max_len > 0 && t.chars().count() > max_len {
        let truncated: String = t.chars().take(max_len.saturating_sub(1)).collect();
        format!("{}…", truncated)
    } else {
        t
    }
}

fn display_width(s: &str) -> usize {
    s.chars().count()
}
