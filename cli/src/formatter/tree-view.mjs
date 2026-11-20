// ANSI terminal color codes
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m'
};

export function formatOutlinerTree(root, options = {}) {
  const {
    maxDepth = 99,
    showIds = true,
    showNotes = true,
    showArrows = true,
    useColors = true
  } = options;

  const lines = [];
  let totalCount = 0;
  let foldedCount = 0;

  function colorize(colorCode, text) {
    return useColors ? `${colorCode}${text}${C.reset}` : text;
  }

  function renderNode(node, prefix = '', isLast = true, depth = 0, isRoot = false) {
    totalCount++;
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isFolded = Boolean(node.folded) && hasChildren;
    if (isFolded) foldedCount += node.children.length;

    // Fold indicator badge
    let foldBadge = '';
    if (hasChildren) {
      foldBadge = isFolded
        ? colorize(C.yellow, `[+] `)
        : colorize(C.dim, `[-] `);
    } else {
      foldBadge = colorize(C.dim, `    `);
    }

    // Side badge (R / L)
    let sideBadge = '';
    if (node.position) {
      const s = node.position.toUpperCase()[0];
      sideBadge = colorize(C.magenta, `(${s}) `);
    }

    // ID badge
    let idBadge = '';
    if (showIds && node.id) {
      idBadge = colorize(C.gray, `[${node.id}] `);
    }

    // Node text
    let nodeText = node.text || '(empty node)';
    if (isRoot) {
      nodeText = colorize(C.bold + C.cyan, `🧠 ${nodeText}`);
    } else if (hasChildren) {
      nodeText = colorize(C.bold + C.blue, nodeText);
    } else {
      nodeText = colorize(C.reset, nodeText);
    }

    // Hidden count badge if folded
    let hiddenBadge = '';
    if (isFolded) {
      hiddenBadge = colorize(C.yellow + C.dim, ` (${node.children.length} sub-nodes folded)`);
    }

    // Note preview badge
    let noteBadge = '';
    if (showNotes && node.note) {
      const snippet = node.note.trim().split(/\r?\n/)[0].slice(0, 30);
      noteBadge = colorize(C.dim + C.gray, ` 📝 "${snippet}..."`);
    }

    // Arrowlinks badge
    let arrowBadge = '';
    if (showArrows && Array.isArray(node.arrowlinks) && node.arrowlinks.length > 0) {
      const targets = node.arrowlinks.map(a => a.target).join(', ');
      arrowBadge = colorize(C.magenta, ` 🔗->[${targets}]`);
    }

    // Assemble line
    if (isRoot) {
      lines.push(`${idBadge}${nodeText}${hiddenBadge}${noteBadge}${arrowBadge}`);
    } else {
      const branch = isLast ? '└── ' : '├── ';
      lines.push(`${colorize(C.gray, prefix + branch)}${sideBadge}${foldBadge}${idBadge}${nodeText}${hiddenBadge}${noteBadge}${arrowBadge}`);
    }

    // Render children if not folded and within depth limit
    if (hasChildren && !isFolded && depth < maxDepth) {
      const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
      for (let i = 0; i < node.children.length; i++) {
        const isChildLast = i === node.children.length - 1;
        renderNode(node.children[i], childPrefix, isChildLast, depth + 1, false);
      }
    }
  }

  renderNode(root, '', true, 0, true);

  const summary = colorize(
    C.gray + C.dim,
    `\nTotal: ${totalCount} nodes ditampilkan${foldedCount > 0 ? ` (${foldedCount} terlipat)` : ''}.`
  );
  lines.push(summary);

  return lines.join('\n');
}
