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

#[derive(Clone, Debug)]
pub struct CanvasNodeInfo {
    pub id: String,
    pub text: String,
    pub depth: usize,
    pub label: String,
    pub has_children: bool,
    pub folded: bool,
    pub marker: String,
    pub width: usize,
    pub x: usize,
    pub y: usize,
    pub parent_idx: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct CanvasData {
    pub nodes: Vec<CanvasNodeInfo>,
    pub width: usize,
    pub height: usize,
    pub grid: Vec<Vec<char>>,
    pub ascii: bool,
}

impl CanvasData {
    pub fn to_string(&self) -> String {
        self.grid
            .iter()
            .map(|row| row.iter().collect::<String>().trim_end().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

pub fn render_canvas(root: &TreeNode, options: &CanvasOptions) -> String {
    let data = compute_canvas(root, options);
    data.to_string()
}

pub fn compute_canvas(root: &TreeNode, options: &CanvasOptions) -> CanvasData {
    let mut layout_nodes: Vec<CanvasNodeInfo> = Vec::new();
    let mut max_depth = 0;

    fn collect(
        n: &TreeNode,
        depth: usize,
        parent_idx: Option<usize>,
        max_depth: &mut usize,
        options: &CanvasOptions,
        list: &mut Vec<CanvasNodeInfo>,
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

        list.push(CanvasNodeInfo {
            id: n.id.clone(),
            text: n.text.clone(),
            depth,
            label,
            has_children,
            folded: n.folded,
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
        return CanvasData {
            nodes: Vec::new(),
            width: 0,
            height: 0,
            grid: Vec::new(),
            ascii: options.ascii,
        };
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

    CanvasData {
        nodes: layout_nodes,
        width: total_width,
        height: total_height,
        grid,
        ascii: options.ascii,
    }
}

pub fn find_canvas_neighbor(
    nodes: &[CanvasNodeInfo],
    current_idx: usize,
    dx: isize,
    dy: isize,
) -> Option<usize> {
    if current_idx >= nodes.len() {
        return None;
    }
    let from = &nodes[current_idx];

    // 1. Horizontal Left
    if dx < 0 {
        if let Some(pidx) = from.parent_idx {
            return Some(pidx);
        }
        let mut best = None;
        let mut best_score = usize::MAX;
        for (i, n) in nodes.iter().enumerate() {
            if i == current_idx || n.x >= from.x {
                continue;
            }
            let dx_val = from.x - n.x;
            let dy_val = (from.y as isize - n.y as isize).unsigned_abs();
            let score = dx_val * 2 + dy_val;
            if score < best_score {
                best_score = score;
                best = Some(i);
            }
        }
        return best;
    }

    // 2. Horizontal Right
    if dx > 0 {
        let mut best_child = None;
        let mut best_child_dist = usize::MAX;
        for (i, n) in nodes.iter().enumerate() {
            if n.parent_idx == Some(current_idx) {
                let dist = (from.y as isize - n.y as isize).unsigned_abs();
                if dist < best_child_dist {
                    best_child_dist = dist;
                    best_child = Some(i);
                }
            }
        }
        if let Some(child_idx) = best_child {
            return Some(child_idx);
        }

        let mut best = None;
        let mut best_score = usize::MAX;
        for (i, n) in nodes.iter().enumerate() {
            if i == current_idx || n.x <= from.x {
                continue;
            }
            let dx_val = n.x - from.x;
            let dy_val = (from.y as isize - n.y as isize).unsigned_abs();
            let score = dx_val * 2 + dy_val;
            if score < best_score {
                best_score = score;
                best = Some(i);
            }
        }
        return best;
    }

    // 3. Vertical Up / Down
    if dy != 0 {
        let is_down = dy > 0;
        let mut same_col_best = None;
        let mut same_col_min_dy = usize::MAX;
        for (i, n) in nodes.iter().enumerate() {
            if i == current_idx || n.depth != from.depth {
                continue;
            }
            let diff_y = if is_down {
                n.y as isize - from.y as isize
            } else {
                from.y as isize - n.y as isize
            };
            if diff_y > 0 && (diff_y as usize) < same_col_min_dy {
                same_col_min_dy = diff_y as usize;
                same_col_best = Some(i);
            }
        }
        if let Some(sc) = same_col_best {
            return Some(sc);
        }

        let mut cross_best = None;
        let mut cross_best_score = usize::MAX;
        for (i, n) in nodes.iter().enumerate() {
            if i == current_idx {
                continue;
            }
            let diff_y = if is_down {
                n.y as isize - from.y as isize
            } else {
                from.y as isize - n.y as isize
            };
            if diff_y <= 0 {
                continue;
            }
            let col_diff = (from.depth as isize - n.depth as isize).unsigned_abs();
            let score = (diff_y as usize) + col_diff * 20;
            if score < cross_best_score {
                cross_best_score = score;
                cross_best = Some(i);
            }
        }
        return cross_best;
    }

    None
}

fn assign_y(idx: usize, nodes: &mut [CanvasNodeInfo], row_gap: usize, next_row: &mut usize) {
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
        for x in px..cx {
            if x < grid[py].len() {
                grid[py][x] = if ascii { '-' } else { '─' };
            }
        }
    } else {
        let mid_x = px + 2;
        if py < cy {
            put_char(grid, mid_x, py, if ascii { '+' } else { '┬' });
            for y in (py + 1)..cy {
                put_char(grid, mid_x, y, if ascii { '|' } else { '│' });
            }
            put_char(grid, mid_x, cy, if ascii { '+' } else { '└' });
            for x in (mid_x + 1)..cx {
                put_char(grid, x, cy, if ascii { '-' } else { '─' });
            }
        } else {
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
