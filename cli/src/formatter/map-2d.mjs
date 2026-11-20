// TextCanvas for 2D ASCII / Unicode spatial mind map rendering
export class TextCanvas {
  constructor(width, height) {
    this.w = Math.max(20, width);
    this.h = Math.max(10, height);
    this.grid = Array.from({ length: this.h }, () => Array(this.w).fill(' '));
    this.colorGrid = Array.from({ length: this.h }, () => Array(this.w).fill(null));
  }

  set(x, y, ch, color = null) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
      this.grid[y][x] = ch;
      if (color) this.colorGrid[y][x] = color;
    }
  }

  drawHLine(x1, x2, y, color = null) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let x = minX; x <= maxX; x++) {
      this.set(x, y, '─', color);
    }
  }

  drawVLine(x, y1, y2, color = null) {
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let y = minY; y <= maxY; y++) {
      this.set(x, y, '│', color);
    }
  }

  drawBox(x, y, text, options = {}) {
    const { color = null, style = 'rounded' } = options;
    const cleanText = String(text || '(empty)').replace(/\r?\n.*/g, ''); // 1 baris
    const textLen = cleanText.length;
    const w = textLen + 4;
    const h = 3;

    const tl = style === 'rounded' ? '╭' : '┌';
    const tr = style === 'rounded' ? '╮' : '┐';
    const bl = style === 'rounded' ? '╰' : '└';
    const br = style === 'rounded' ? '╯' : '┘';

    // Top border
    this.set(x, y, tl, color);
    for (let i = 1; i < w - 1; i++) this.set(x + i, y, '─', color);
    this.set(x + w - 1, y, tr, color);

    // Middle text
    this.set(x, y + 1, '│', color);
    for (let i = 0; i < textLen; i++) {
      this.set(x + 2 + i, y + 1, cleanText[i], color);
    }
    this.set(x + w - 1, y + 1, '│', color);

    // Bottom border
    this.set(x, y + 2, bl, color);
    for (let i = 1; i < w - 1; i++) this.set(x + i, y + 2, '─', color);
    this.set(x + w - 1, y + 2, br, color);

    return {
      x, y, w, h,
      midX: Math.floor(x + w / 2),
      topY: y,
      bottomY: y + 2,
      midY: y + 1
    };
  }

  toString(useColors = true) {
    const reset = '\x1b[0m';
    const lines = [];

    for (let y = 0; y < this.h; y++) {
      let line = '';
      let activeColor = null;

      for (let x = 0; x < this.w; x++) {
        const ch = this.grid[y][x];
        const color = this.colorGrid[y][x];

        if (useColors && color !== activeColor) {
          if (activeColor && !color) line += reset;
          else if (color) line += `${reset}${color}`;
          activeColor = color;
        }
        line += ch;
      }
      if (useColors && activeColor) line += reset;
      lines.push(line.trimEnd());
    }

    // Trim leading/trailing blank lines
    while (lines.length > 0 && lines[0] === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    return lines.join('\n');
  }
}

/**
 * 2D Spatial Mind Map Renderer
 * Renders the mind map on a 2D text canvas with root in center,
 * branching UPWARDS and DOWNWARDS.
 */
export function render2DSpatialMap(rootNode, options = {}) {
  const {
    useColors = true,
    maxDepth = 2
  } = options;

  if (!rootNode) return '(Peta kosong)';

  const colors = {
    root: '\x1b[1;36m',       // Cyan bold
    topBranch: '\x1b[1;32m',  // Green bold
    botBranch: '\x1b[1;35m',  // Magenta bold
    connector: '\x1b[90m',    // Gray
    arrow: '\x1b[1;33m'       // Yellow
  };

  const children = (rootNode.children || []).filter(c => !c.folded);
  const rootBoxW = (rootNode.text || '').length + 6;

  // Split branches into TOP and BOTTOM groups
  let topGroup = [];
  let botGroup = [];

  const leftChildren = children.filter(c => c.position === 'left');
  const rightChildren = children.filter(c => c.position === 'right' || !c.position);

  if (leftChildren.length > 0 && rightChildren.length > 0) {
    topGroup = leftChildren;
    botGroup = rightChildren;
  } else {
    const half = Math.ceil(children.length / 2);
    topGroup = children.slice(0, half);
    botGroup = children.slice(half);
  }

  function measureTreeWidth(node, depth = 0) {
    const boxW = (node.text || '').length + 6;
    if (depth >= maxDepth || !node.children || node.children.length === 0 || node.folded) {
      return boxW + 4;
    }
    const childrenTotal = node.children.reduce((sum, c) => sum + measureTreeWidth(c, depth + 1), 0);
    return Math.max(boxW + 4, childrenTotal);
  }

  const topWidths = topGroup.map(c => measureTreeWidth(c, 1));
  const botWidths = botGroup.map(c => measureTreeWidth(c, 1));

  const totalTopWidth = topWidths.reduce((a, b) => a + b, 0);
  const totalBotWidth = botWidths.reduce((a, b) => a + b, 0);

  const canvasWidth = Math.max(rootBoxW + 20, totalTopWidth, totalBotWidth, 80);
  const canvasHeight = 36;

  const canvas = new TextCanvas(canvasWidth, canvasHeight);

  // Position Root in the Center
  const rootX = Math.floor((canvasWidth - rootBoxW) / 2);
  const rootY = 16;

  const rootBox = canvas.drawBox(rootX, rootY, `🧠 ${rootNode.text || 'Root'}`, {
    color: colors.root,
    style: 'rounded'
  });

  // --- RENDER TOP BRANCHES (BRANCHING UPWARDS) ---
  if (topGroup.length > 0) {
    const startX = Math.floor((canvasWidth - totalTopWidth) / 2);
    let curX = startX;
    const topChildBoxes = [];
    const topBranchY = rootY - 6;

    for (let i = 0; i < topGroup.length; i++) {
      const child = topGroup[i];
      const slotW = topWidths[i];
      const childBoxW = (child.text || '').length + 4;
      const bX = curX + Math.floor((slotW - childBoxW) / 2);

      const b = canvas.drawBox(bX, topBranchY, child.text, {
        color: colors.topBranch,
        style: 'rounded'
      });
      topChildBoxes.push(b);

      // Sub-children (Level 2 Upward)
      if (maxDepth >= 2 && child.children && child.children.length > 0 && !child.folded) {
        const subY = topBranchY - 5;
        const subCount = child.children.length;
        const subSlotW = Math.max(12, Math.floor(slotW / subCount));

        for (let j = 0; j < subCount; j++) {
          const sub = child.children[j];
          const subBoxW = (sub.text || '').length + 4;
          const sX = curX + j * subSlotW + Math.floor((subSlotW - subBoxW) / 2);
          const subBox = canvas.drawBox(sX, subY, sub.text, {
            color: colors.topBranch,
            style: 'rounded'
          });

          // Connect sub-child to child
          canvas.drawVLine(subBox.midX, subBox.bottomY + 1, b.topY - 1, colors.connector);
          canvas.set(subBox.midX, b.topY, '┴', colors.connector);
        }
      }

      curX += slotW;
    }

    // Connect Root to Top Children
    const busY = rootY - 3;
    const minMidX = Math.min(...topChildBoxes.map(b => b.midX));
    const maxMidX = Math.max(...topChildBoxes.map(b => b.midX));

    // Vertical line up from root
    canvas.drawVLine(rootBox.midX, busY + 1, rootBox.topY - 1, colors.connector);
    canvas.set(rootBox.midX, rootBox.topY - 1, '▲', colors.arrow);

    if (topChildBoxes.length === 1) {
      // Direct connection
      canvas.drawVLine(topChildBoxes[0].midX, topChildBoxes[0].bottomY + 1, rootBox.topY - 1, colors.connector);
      canvas.set(topChildBoxes[0].midX, topChildBoxes[0].bottomY, '┴', colors.connector);
      canvas.set(rootBox.midX, rootBox.topY - 1, '▲', colors.arrow);
    } else {
      // Horizontal bus
      const leftEnd = Math.min(minMidX, rootBox.midX);
      const rightEnd = Math.max(maxMidX, rootBox.midX);

      canvas.drawHLine(leftEnd, rightEnd, busY, colors.connector);
      canvas.set(leftEnd, busY, '└', colors.connector);
      canvas.set(rightEnd, busY, '┘', colors.connector);
      canvas.set(rootBox.midX, busY, '┴', colors.connector);

      // Feeders to top children
      for (const b of topChildBoxes) {
        canvas.drawVLine(b.midX, b.bottomY + 1, busY - 1, colors.connector);
        if (b.midX === leftEnd) canvas.set(b.midX, busY, '└', colors.connector);
        else if (b.midX === rightEnd) canvas.set(b.midX, busY, '┘', colors.connector);
        else canvas.set(b.midX, busY, '┴', colors.connector);
      }
    }
  }

  // --- RENDER BOTTOM BRANCHES (BRANCHING DOWNWARDS) ---
  if (botGroup.length > 0) {
    const startX = Math.floor((canvasWidth - totalBotWidth) / 2);
    let curX = startX;
    const botChildBoxes = [];
    const botBranchY = rootY + 6;

    for (let i = 0; i < botGroup.length; i++) {
      const child = botGroup[i];
      const slotW = botWidths[i];
      const childBoxW = (child.text || '').length + 4;
      const bX = curX + Math.floor((slotW - childBoxW) / 2);

      const b = canvas.drawBox(bX, botBranchY, child.text, {
        color: colors.botBranch,
        style: 'rounded'
      });
      botChildBoxes.push(b);

      // Sub-children (Level 2 Downward)
      if (maxDepth >= 2 && child.children && child.children.length > 0 && !child.folded) {
        const subY = botBranchY + 5;
        const subCount = child.children.length;
        const subSlotW = Math.max(12, Math.floor(slotW / subCount));

        for (let j = 0; j < subCount; j++) {
          const sub = child.children[j];
          const subBoxW = (sub.text || '').length + 4;
          const sX = curX + j * subSlotW + Math.floor((subSlotW - subBoxW) / 2);
          const subBox = canvas.drawBox(sX, subY, sub.text, {
            color: colors.botBranch,
            style: 'rounded'
          });

          // Connect sub-child to child
          canvas.drawVLine(subBox.midX, b.bottomY + 1, subBox.topY - 1, colors.connector);
          canvas.set(subBox.midX, b.bottomY, '┬', colors.connector);
        }
      }

      curX += slotW;
    }

    // Connect Root to Bottom Children
    const busY = rootY + 3;
    const minMidX = Math.min(...botChildBoxes.map(b => b.midX));
    const maxMidX = Math.max(...botChildBoxes.map(b => b.midX));

    // Vertical line down from root
    canvas.drawVLine(rootBox.midX, rootBox.bottomY + 1, busY - 1, colors.connector);
    canvas.set(rootBox.midX, rootBox.bottomY + 1, '▼', colors.arrow);

    if (botChildBoxes.length === 1) {
      canvas.drawVLine(botChildBoxes[0].midX, rootBox.bottomY + 1, botChildBoxes[0].topY - 1, colors.connector);
      canvas.set(rootBox.midX, rootBox.bottomY + 1, '▼', colors.arrow);
      canvas.set(botChildBoxes[0].midX, botChildBoxes[0].topY, '┬', colors.connector);
    } else {
      const leftEnd = Math.min(minMidX, rootBox.midX);
      const rightEnd = Math.max(maxMidX, rootBox.midX);

      canvas.drawHLine(leftEnd, rightEnd, busY, colors.connector);
      canvas.set(leftEnd, busY, '┌', colors.connector);
      canvas.set(rightEnd, busY, '┐', colors.connector);
      canvas.set(rootBox.midX, busY, '┬', colors.connector);

      // Feeders to bottom children
      for (const b of botChildBoxes) {
        canvas.drawVLine(b.midX, busY + 1, b.topY - 1, colors.connector);
        if (b.midX === leftEnd) canvas.set(b.midX, busY, '┌', colors.connector);
        else if (b.midX === rightEnd) canvas.set(b.midX, busY, '┐', colors.connector);
        else canvas.set(b.midX, busY, '┬', colors.connector);
      }
    }
  }

  return canvas.toString(useColors);
}
