use crate::model::TreeNode;

pub struct TreeViewOptions {
    pub max_depth: usize,
    pub show_ids: bool,
    pub use_colors: bool,
}

impl Default for TreeViewOptions {
    fn default() -> Self {
        Self {
            max_depth: 99,
            show_ids: true,
            use_colors: true,
        }
    }
}

pub fn format_outliner_tree(root: &TreeNode, options: &TreeViewOptions) -> (String, usize) {
    let mut lines = Vec::new();
    let mut total_count = 0;

    render_node(root, "", true, 0, true, options, &mut lines, &mut total_count);

    (lines.join("\n"), total_count)
}

fn render_node(
    node: &TreeNode,
    prefix: &str,
    is_last: bool,
    depth: usize,
    is_root: bool,
    options: &TreeViewOptions,
    lines: &mut Vec<String>,
    total_count: &mut usize,
) {
    *total_count += 1;
    let has_children = !node.children.is_empty();
    let is_folded = node.folded && has_children;

    let branch = if is_root {
        ""
    } else if is_last {
        "└── "
    } else {
        "├── "
    };

    let fold_badge = if is_root {
        ""
    } else if has_children {
        if is_folded { "[+] " } else { "[-] " }
    } else {
        "    "
    };

    let id_badge = if options.show_ids && !node.id.is_empty() {
        format!("[{}] ", node.id)
    } else {
        String::new()
    };

    let node_title = if is_root {
        format!("🧠 {}", node.text)
    } else {
        node.text.clone()
    };

    let folded_badge = if is_folded {
        format!(" ({} sub-nodes folded)", node.children.len())
    } else {
        String::new()
    };

    let line = if options.use_colors {
        if is_root {
            format!("{}{}{}\x1b[1;36m{}\x1b[0m", prefix, branch, id_badge, node_title)
        } else if has_children {
            format!(
                "{}{}\x1b[33m{}\x1b[0m\x1b[90m{}\x1b[0m\x1b[1;34m{}\x1b[0m\x1b[90m{}\x1b[0m",
                prefix, branch, fold_badge, id_badge, node_title, folded_badge
            )
        } else {
            format!(
                "{}{}\x1b[2m{}\x1b[0m\x1b[90m{}\x1b[0m{}",
                prefix, branch, fold_badge, id_badge, node_title
            )
        }
    } else {
        format!("{}{}{}{}{}{}", prefix, branch, fold_badge, id_badge, node_title, folded_badge)
    };

    lines.push(line);

    if !is_folded && depth < options.max_depth && has_children {
        let next_prefix = if is_root {
            ""
        } else if is_last {
            &format!("{}    ", prefix)
        } else {
            &format!("{}│   ", prefix)
        };

        let child_count = node.children.len();
        for (i, child) in node.children.iter().enumerate() {
            let child_is_last = i == child_count - 1;
            render_node(
                child,
                next_prefix,
                child_is_last,
                depth + 1,
                false,
                options,
                lines,
                total_count,
            );
        }
    }
}

