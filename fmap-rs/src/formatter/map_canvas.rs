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
    pub arrow_links: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct CanvasData {
    pub nodes: Vec<CanvasNodeInfo>,
    pub width: usize,
    pub height: usize,
    pub grid: Vec<Vec<char>>,
    /// Menandai sel grid yang ditempati garis arrow link (bukan edge pohon),
    /// supaya TUI bisa mewarnainya berbeda tanpa mengganggu label node.
    pub arrow_mask: Vec<Vec<bool>>,
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
                if options.ascii {
                    "+".into()
                } else {
                    "▸".into()
                }
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
            arrow_links: n.arrow_links.clone(),
        });

        if !n.folded {
            for child in &n.children {
                collect(
                    child,
                    depth + 1,
                    Some(current_idx),
                    max_depth,
                    options,
                    list,
                );
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
            arrow_mask: Vec::new(),
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
    let mut arrow_mask = vec![vec![false; total_width]; total_height];

    // Gambar edge garis konektor antar induk dan anak
    draw_tree_edges(&mut grid, &layout_nodes, options.ascii);

    // Gambar arrow link antar-node (bukan edge pohon). Digambar sebelum label
    // agar kotak/label node tetap utuh dan menutupi garis yang melewatinya.
    draw_arrow_links(&mut grid, &mut arrow_mask, &layout_nodes, options.ascii);

    // Gambar label node [ Text ▾ ]
    for ln in &layout_nodes {
        let box_text = if ln.marker.is_empty() {
            format!("[ {} ]", ln.label)
        } else {
            format!("[ {} ] {}", ln.label, ln.marker)
        };

        put_str(&mut grid, ln.x, ln.y, &box_text);

        // Label menimpa arrow, jadi bersihkan mask pada sel yang tertutup.
        for x in ln.x..(ln.x + box_text.chars().count()).min(total_width) {
            arrow_mask[ln.y][x] = false;
        }
    }

    CanvasData {
        nodes: layout_nodes,
        width: total_width,
        height: total_height,
        grid,
        arrow_mask,
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

/// Gambar seluruh garis penghubung pohon sekaligus untuk setiap induk.
///
/// Tiap induk dihubungkan ke "trunk" vertikal di `mid_x` lewat garis horizontal
/// pendek, lalu trunk bercabang ke masing-masing anak. Karakter persimpangan
/// dihitung dari arah yang benar-benar terpakai agar tidak ada garis yang
/// menggantung tanpa sambungan (mis. `┴` tanpa garis horizontal ke induk).
fn draw_tree_edges(grid: &mut [Vec<char>], nodes: &[CanvasNodeInfo], ascii: bool) {
    let h = if ascii { '-' } else { '─' };
    let v = if ascii { '|' } else { '│' };

    for (pidx, parent) in nodes.iter().enumerate() {
        let children: Vec<usize> = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.parent_idx == Some(pidx))
            .map(|(i, _)| i)
            .collect();
        if children.is_empty() {
            continue;
        }

        let px = parent.x + parent.width;
        let py = parent.y;

        // Semua anak sejajar dengan induk (umumnya anak tunggal): garis lurus.
        if children.iter().all(|&ci| nodes[ci].y == py) {
            for &ci in &children {
                let cx = nodes[ci].x;
                let limit = cx.min(grid[py].len());
                for x in px..limit {
                    set_char(grid, x, py, h);
                }
            }
            continue;
        }

        let mid_x = px + 2;
        let top = children.iter().map(|&ci| nodes[ci].y).min().unwrap_or(py);
        let bottom = children.iter().map(|&ci| nodes[ci].y).max().unwrap_or(py);

        // Garis horizontal dari kotak induk menuju trunk.
        let limit = mid_x.min(grid[py].len());
        for x in px..limit {
            set_char(grid, x, py, h);
        }

        // Trunk vertikal dari anak teratas sampai anak terbawah.
        for y in top..=bottom {
            set_char(grid, mid_x, y, v);
        }

        // Garis horizontal dari trunk menuju tiap anak.
        for &ci in &children {
            let cy = nodes[ci].y;
            let cx = nodes[ci].x;
            if cx > mid_x {
                let limit = cx.min(grid[cy].len());
                for x in (mid_x + 1)..limit {
                    set_char(grid, x, cy, h);
                }
            }
        }

        // Pasang karakter persimpangan setelah semua arah diketahui.
        let mut rows: Vec<usize> = children.iter().map(|&ci| nodes[ci].y).collect();
        rows.push(py);
        rows.sort_unstable();
        rows.dedup();
        for r in rows {
            let up = r > top;
            let down = r < bottom;
            let left = r == py;
            let right = children.iter().any(|&ci| nodes[ci].y == r);
            let ch = junction_char(up, down, left, right, ascii);
            set_char(grid, mid_x, r, ch);
        }
    }
}

/// Pilih karakter box-drawing sesuai arah garis yang aktif pada satu sel.
fn junction_char(up: bool, down: bool, left: bool, right: bool, ascii: bool) -> char {
    if ascii {
        return match (left || right, up || down) {
            (true, true) => '+',
            (true, false) => '-',
            (false, true) => '|',
            (false, false) => ' ',
        };
    }
    match (up, down, left, right) {
        (true, true, true, true) => '┼',
        (true, true, true, false) => '┤',
        (true, true, false, true) => '├',
        (true, true, false, false) => '│',
        (true, false, true, true) => '┴',
        (true, false, true, false) => '┘',
        (true, false, false, true) => '└',
        (true, false, false, false) => '│',
        (false, true, true, true) => '┬',
        (false, true, true, false) => '┐',
        (false, true, false, true) => '┌',
        (false, true, false, false) => '│',
        (false, false, true, true) => '─',
        (false, false, true, false) => '─',
        (false, false, false, true) => '─',
        (false, false, false, false) => ' ',
    }
}

fn set_char(grid: &mut [Vec<char>], x: usize, y: usize, ch: char) {
    if y < grid.len() && x < grid[y].len() {
        grid[y][x] = ch;
    }
}

fn draw_arrow_links(
    grid: &mut [Vec<char>],
    mask: &mut [Vec<bool>],
    nodes: &[CanvasNodeInfo],
    ascii: bool,
) {
    let index: std::collections::HashMap<&str, usize> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();

    for (src_idx, src) in nodes.iter().enumerate() {
        for target_id in &src.arrow_links {
            let Some(&dst_idx) = index.get(target_id.as_str()) else {
                continue;
            };
            if dst_idx == src_idx {
                continue;
            }
            draw_arrow(grid, mask, src, &nodes[dst_idx], ascii);
        }
    }
}

fn draw_arrow(
    grid: &mut [Vec<char>],
    mask: &mut [Vec<bool>],
    src: &CanvasNodeInfo,
    dst: &CanvasNodeInfo,
    ascii: bool,
) {
    let src_right = src.x + src.width;
    let src_left = src.x.saturating_sub(1);
    let dst_left = dst.x.saturating_sub(1);
    let dst_right = dst.x + dst.width;
    let bar = if ascii { '-' } else { '─' };

    if dst.x >= src_right {
        // Target di kanan sumber.
        let exit_x = src_right;
        let enter_x = dst_left;
        if src.y == dst.y {
            fill_h(grid, mask, src.y, exit_x, enter_x, bar);
            put_arrow(grid, mask, enter_x, dst.y, arrow_head(true, ascii));
        } else {
            let corridor = exit_x + (enter_x.saturating_sub(exit_x) / 2).max(1);
            draw_corridor(grid, mask, src.y, exit_x, corridor, dst.y, enter_x, ascii);
        }
    } else if dst_right <= src.x {
        // Target di kiri sumber.
        let exit_x = src_left;
        let enter_x = dst_right;
        if src.y == dst.y {
            fill_h(grid, mask, src.y, exit_x, enter_x, bar);
            put_arrow(grid, mask, enter_x, dst.y, arrow_head(false, ascii));
        } else {
            let corridor = enter_x + (exit_x.saturating_sub(enter_x) / 2).max(1);
            draw_corridor(grid, mask, src.y, exit_x, corridor, dst.y, enter_x, ascii);
        }
    } else if src.y != dst.y {
        // Kolom node bertumpuk (umumnya level yang sama): belok lewat kanan.
        let exit_x = src_right;
        let enter_x = dst_right;
        let corridor = exit_x.max(enter_x) + 2;
        draw_corridor(grid, mask, src.y, exit_x, corridor, dst.y, enter_x, ascii);
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_corridor(
    grid: &mut [Vec<char>],
    mask: &mut [Vec<bool>],
    sy: usize,
    exit_x: usize,
    corridor_x: usize,
    ty: usize,
    enter_x: usize,
    ascii: bool,
) {
    let bar = if ascii { '-' } else { '─' };
    let vbar = if ascii { '|' } else { '│' };
    let down = ty > sy;
    let first_right = corridor_x >= exit_x;
    let second_right = enter_x > corridor_x;

    fill_h(grid, mask, sy, exit_x, corridor_x, bar);
    fill_v(grid, mask, corridor_x, sy, ty, vbar);
    fill_h(grid, mask, ty, corridor_x, enter_x, bar);

    if corridor_x != exit_x {
        put_arrow(
            grid,
            mask,
            corridor_x,
            sy,
            corner_from_horizontal(first_right, down, ascii),
        );
    }
    if enter_x != corridor_x {
        put_arrow(
            grid,
            mask,
            corridor_x,
            ty,
            corner_from_vertical(down, second_right, ascii),
        );
    }

    let head = if enter_x == corridor_x {
        if down {
            arrow_head_down(ascii)
        } else {
            arrow_head_up(ascii)
        }
    } else {
        arrow_head(second_right, ascii)
    };
    put_arrow(grid, mask, enter_x, ty, head);
}

fn fill_h(grid: &mut [Vec<char>], mask: &mut [Vec<bool>], y: usize, a: usize, b: usize, ch: char) {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    for x in lo..=hi {
        put_arrow(grid, mask, x, y, ch);
    }
}

fn fill_v(grid: &mut [Vec<char>], mask: &mut [Vec<bool>], x: usize, a: usize, b: usize, ch: char) {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    for y in lo..=hi {
        put_arrow(grid, mask, x, y, ch);
    }
}

fn put_arrow(grid: &mut [Vec<char>], mask: &mut [Vec<bool>], x: usize, y: usize, ch: char) {
    if y < grid.len() && x < grid[y].len() {
        grid[y][x] = ch;
        mask[y][x] = true;
    }
}

fn corner_from_horizontal(horizontal_right: bool, vertical_down: bool, ascii: bool) -> char {
    if ascii {
        return '+';
    }
    match (horizontal_right, vertical_down) {
        (true, true) => '┐',
        (true, false) => '┘',
        (false, true) => '┌',
        (false, false) => '└',
    }
}

fn corner_from_vertical(vertical_from_up: bool, horizontal_right: bool, ascii: bool) -> char {
    if ascii {
        return '+';
    }
    match (vertical_from_up, horizontal_right) {
        (true, true) => '└',
        (true, false) => '┘',
        (false, true) => '┌',
        (false, false) => '┐',
    }
}

fn arrow_head(right: bool, ascii: bool) -> char {
    match (right, ascii) {
        (true, true) => '>',
        (false, true) => '<',
        (true, false) => '▶',
        (false, false) => '◀',
    }
}

fn arrow_head_down(ascii: bool) -> char {
    if ascii {
        'v'
    } else {
        '▼'
    }
}

fn arrow_head_up(ascii: bool) -> char {
    if ascii {
        '^'
    } else {
        '▲'
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

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> CanvasOptions {
        CanvasOptions {
            max_label: 36,
            level_gap: 6,
            row_gap: 2,
            ascii: false,
        }
    }

    fn sample_tree() -> TreeNode {
        let mut root = TreeNode::new("root", "Root");
        let mut a = TreeNode::new("a", "A");
        a.arrow_links.push("b".to_string());
        root.children.push(a);
        root.children.push(TreeNode::new("b", "B"));
        root
    }

    #[test]
    fn arrow_links_are_drawn_and_masked() {
        let canvas = compute_canvas(&sample_tree(), &opts());
        let text = canvas.to_string();

        assert!(text.contains('◀'), "arrowhead missing:\n{}", text);
        assert!(canvas.arrow_mask.iter().flatten().any(|v| *v));
        assert!(text.contains("[ A ]"));
        assert!(text.contains("[ B ]"));
    }

    #[test]
    fn node_labels_cover_arrow_mask() {
        let canvas = compute_canvas(&sample_tree(), &opts());

        for node in &canvas.nodes {
            for x in node.x..(node.x + node.width) {
                assert!(
                    !canvas.arrow_mask[node.y][x],
                    "arrow mask leaked into label of '{}' at ({}, {})",
                    node.id, x, node.y
                );
            }
        }
    }

    #[test]
    fn ascii_mode_uses_ascii_arrowhead() {
        let mut options = opts();
        options.ascii = true;
        let canvas = compute_canvas(&sample_tree(), &options);
        let text = canvas.to_string();

        assert!(
            text.contains('<') || text.contains('>'),
            "ascii arrow missing:\n{}",
            text
        );
    }

    #[test]
    fn arrow_to_hidden_folded_target_is_skipped() {
        let mut root = TreeNode::new("root", "Root");
        let mut a = TreeNode::new("a", "A");
        a.arrow_links.push("child".to_string());
        root.children.push(a);
        let mut folded = TreeNode::new("hidden", "Hidden");
        folded.folded = true;
        folded.children.push(TreeNode::new("child", "Child"));
        root.children.push(folded);

        let canvas = compute_canvas(&root, &opts());
        assert!(!canvas.arrow_mask.iter().flatten().any(|v| *v));
    }

    #[test]
    fn parent_is_connected_to_children_with_horizontal_line() {
        let mut root = TreeNode::new("root", "Root");
        root.children.push(TreeNode::new("a", "A"));
        root.children.push(TreeNode::new("b", "B"));

        let canvas = compute_canvas(&root, &opts());
        let parent = &canvas.nodes[0];
        let px = parent.x + parent.width;
        let mid_x = px + 2;
        let row = &canvas.grid[parent.y];

        // Dua anak -> induk berada di antara keduanya, jadi persimpangan `┤`.
        assert_eq!(row[mid_x], '┤', "junction missing:\n{}", canvas.to_string());
        for x in px..mid_x {
            assert_eq!(
                row[x],
                '─',
                "horizontal connector missing at x={}:\n{}",
                x,
                canvas.to_string()
            );
        }
    }

    #[test]
    fn middle_child_uses_cross_junction() {
        let mut root = TreeNode::new("root", "Root");
        for (id, text) in [("a", "A"), ("b", "B"), ("c", "C")] {
            root.children.push(TreeNode::new(id, text));
        }

        let canvas = compute_canvas(&root, &opts());
        let parent = &canvas.nodes[0];
        let mid_x = parent.x + parent.width + 2;
        assert_eq!(
            canvas.grid[parent.y][mid_x],
            '┼',
            "cross junction missing:\n{}",
            canvas.to_string()
        );
    }

    #[test]
    fn ascii_mode_connects_parent_with_plus() {
        let mut root = TreeNode::new("root", "Root");
        root.children.push(TreeNode::new("a", "A"));
        root.children.push(TreeNode::new("b", "B"));

        let mut options = opts();
        options.ascii = true;
        let canvas = compute_canvas(&root, &options);
        let parent = &canvas.nodes[0];
        let mid_x = parent.x + parent.width + 2;
        assert_eq!(
            canvas.grid[parent.y][mid_x],
            '+',
            "ascii junction missing:\n{}",
            canvas.to_string()
        );
    }
}
