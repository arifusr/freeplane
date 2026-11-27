//! High-resolution raster renderer for the 2D canvas.
//!
//! The character-grid renderer in [`super::map_canvas`] is kept as a fallback.
//! This module reuses the same layout (`CanvasData`) but paints it into an RGBA
//! image: rounded node cards, smooth bezier connectors, coloured arrow links
//! and a highlighted selection. The resulting image is displayed in the TUI
//! through `ratatui-image` (sixel / kitty / iTerm2 / halfblocks).

use super::map_canvas::{CanvasData, CanvasNodeInfo, CanvasOptions};
use crate::model::TreeNode;
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use image::{Rgba, RgbaImage};
use std::path::Path;

/// Embedded monospace font so the renderer does not depend on system fonts.
const FONT_DATA: &[u8] = include_bytes!("../../assets/DejaVuSansMono.ttf");

/// Advance width of DejaVu Sans Mono as a fraction of the font size.
const MONO_ADVANCE: f32 = 0.602;

pub const DEFAULT_CELL: (u16, u16) = (9, 18);
pub const EXPORT_CELL: (u16, u16) = (12, 24);

type Color = [u8; 4];

const BG: Color = [17, 17, 27, 255];
const EDGE: Color = [69, 71, 90, 255];
const EDGE_ACTIVE: Color = [116, 145, 200, 255];
const ARROW: Color = [245, 194, 231, 255];
const TEXT: Color = [205, 214, 244, 255];
const TEXT_ROOT: Color = [249, 226, 175, 255];
const MARKER: Color = [166, 227, 161, 255];
const SELECT_BORDER: Color = [245, 224, 220, 255];
const SELECT_GLOW: Color = [243, 139, 168, 110];
const NODE_FILL: Color = [30, 30, 46, 255];
const ROOT_FILL: Color = [49, 50, 68, 255];

/// Border colour per depth (cycled).
const DEPTH_BORDERS: [Color; 6] = [
    [249, 226, 175, 255], // root / yellow
    [137, 180, 250, 255], // blue
    [166, 227, 161, 255], // green
    [203, 166, 247, 255], // mauve
    [250, 179, 135, 255], // peach
    [148, 226, 213, 255], // teal
];

/// Render the currently visible part of a canvas into an RGBA image.
///
/// `pan_x`/`pan_y` and `view_width`/`view_height` are measured in character
/// cells. The returned image is exactly `view_width * cell_width` by
/// `view_height * cell_height` pixels so it can be blitted 1:1 into a terminal
/// area of `view_width` x `view_height` cells.
///
/// `zoom` scales the canvas content inside that fixed pixel area. Because the
/// canvas is re-rendered from its vector layout (instead of scaling a bitmap),
/// zooming in stays sharp. A zoom of `1.0` means one canvas cell maps to one
/// terminal cell.
#[allow(clippy::too_many_arguments)]
pub fn render_canvas_image(
    canvas: &CanvasData,
    selected_id: Option<&str>,
    pan_x: usize,
    pan_y: usize,
    view_width: usize,
    view_height: usize,
    cell_width: u16,
    cell_height: u16,
    zoom: f32,
) -> RgbaImage {
    let base_cw = cell_width.max(1) as usize;
    let base_ch = cell_height.max(1) as usize;
    let width = (view_width * base_cw).max(1) as u32;
    let height = (view_height * base_ch).max(1) as u32;

    // Clamp defensively: callers should already keep zoom in a sane range.
    let zoom = zoom.clamp(0.25, 8.0);
    let cw = base_cw as f32 * zoom;
    let ch = base_ch as f32 * zoom;

    let mut img = RgbaImage::from_pixel(width, height, Rgba(BG));

    // Small breathing room so the root card (at cell 0,0) and its selection
    // glow are not clipped by the edge of the image.
    let margin_x = (cw * 0.55).max(6.0);
    let margin_y = (ch * 0.22).max(4.0);
    let offset_x = pan_x as f32 * cw - margin_x;
    let offset_y = pan_y as f32 * ch - margin_y;

    // Edges first, nodes on top so the cards cover the connector endpoints.
    for (pidx, parent) in canvas.nodes.iter().enumerate() {
        for child in canvas.nodes.iter().filter(|n| n.parent_idx == Some(pidx)) {
            let active = selected_id
                .map(|id| id == parent.id || id == child.id)
                .unwrap_or(false);
            draw_tree_edge(
                &mut img,
                parent,
                child,
                offset_x,
                offset_y,
                cw,
                ch,
                if active { EDGE_ACTIVE } else { EDGE },
            );
        }
    }

    draw_arrow_links(&mut img, canvas, offset_x, offset_y, cw, ch);

    let font = FontRef::try_from_slice(FONT_DATA).expect("embedded font is valid");
    for node in &canvas.nodes {
        let selected = selected_id.map(|id| id == node.id).unwrap_or(false);
        draw_node(&mut img, node, selected, &font, offset_x, offset_y, cw, ch);
    }

    img
}

/// Render a whole canvas to a PNG file. Returns the pixel dimensions.
pub fn save_canvas_png(
    root: &TreeNode,
    options: &CanvasOptions,
    selected_id: Option<&str>,
    path: &Path,
    cell_width: u16,
    cell_height: u16,
) -> anyhow::Result<(u32, u32)> {
    let canvas = super::map_canvas::compute_canvas(root, options);
    // One extra cell compensates for the internal margin so nothing is cut off.
    let (vw, vh) = (canvas.width.max(1) + 1, canvas.height.max(1) + 1);
    let img = render_canvas_image(
        &canvas,
        selected_id,
        0,
        0,
        vw,
        vh,
        cell_width,
        cell_height,
        1.0,
    );
    img.save(path)?;
    Ok((img.width(), img.height()))
}

#[allow(clippy::too_many_arguments)]
fn draw_tree_edge(
    img: &mut RgbaImage,
    parent: &CanvasNodeInfo,
    child: &CanvasNodeInfo,
    offset_x: f32,
    offset_y: f32,
    cw: f32,
    ch: f32,
    color: Color,
) {
    let px = (parent.x + parent.width) as f32 * cw - offset_x;
    let py = parent.y as f32 * ch + ch / 2.0 - offset_y;
    let cx = child.x as f32 * cw - offset_x;
    let cy = child.y as f32 * ch + ch / 2.0 - offset_y;

    let gap = cx - px;
    let control = (gap * 0.45).max(2.0);
    let p0 = (px, py);
    let p1 = (px + control, py);
    let p2 = (cx - control, cy);
    let p3 = (cx, cy);

    let thickness = (ch * 0.07).max(1.0);
    draw_bezier(img, p0, p1, p2, p3, thickness, color, 255);
}

fn draw_arrow_links(
    img: &mut RgbaImage,
    canvas: &CanvasData,
    offset_x: f32,
    offset_y: f32,
    cw: f32,
    ch: f32,
) {
    let index: std::collections::HashMap<&str, usize> = canvas
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();

    let thickness = (ch * 0.075).max(1.2);
    let head_len = (ch * 0.45).max(4.0);
    let head_width = head_len * 0.55;

    for (src_idx, src) in canvas.nodes.iter().enumerate() {
        for target_id in &src.arrow_links {
            let Some(&dst_idx) = index.get(target_id.as_str()) else {
                continue;
            };
            if dst_idx == src_idx {
                continue;
            }
            let dst = &canvas.nodes[dst_idx];

            let src_right = (src.x + src.width) as f32 * cw - offset_x;
            let src_left = src.x as f32 * cw - offset_x;
            let dst_right = (dst.x + dst.width) as f32 * cw - offset_x;
            let dst_left = dst.x as f32 * cw - offset_x;
            let sy = src.y as f32 * ch + ch / 2.0 - offset_y;
            let ty = dst.y as f32 * ch + ch / 2.0 - offset_y;

            let (p0, p1, p2, p3, tip_dir) = if dst.x >= src.x + src.width {
                // Target on the right.
                let gap = (dst_left - src_right).max(2.0);
                (
                    (src_right, sy),
                    (src_right + gap * 0.5, sy),
                    (dst_left - gap * 0.5, ty),
                    (dst_left, ty),
                    (1.0, 0.0),
                )
            } else if dst.x + dst.width <= src.x {
                // Target on the left.
                let gap = (src_left - dst_right).max(2.0);
                (
                    (src_left, sy),
                    (src_left - gap * 0.5, sy),
                    (dst_right + gap * 0.5, ty),
                    (dst_right, ty),
                    (-1.0, 0.0),
                )
            } else if sy != ty {
                // Same column: loop out to the right and come back.
                let corridor = src_right.max(dst_right) + (cw * 2.0).max(6.0);
                (
                    (src_right, sy),
                    (corridor, sy),
                    (corridor, ty),
                    (dst_right, ty),
                    (-1.0, 0.0),
                )
            } else {
                continue;
            };

            draw_bezier(img, p0, p1, p2, p3, thickness, ARROW, 255);

            // Arrowhead pointing along the final tangent.
            let (dx, dy) = if p3.0 - p2.0 == 0.0 && p3.1 - p2.1 == 0.0 {
                tip_dir
            } else {
                let dx = p3.0 - p2.0;
                let dy = p3.1 - p2.1;
                let len = (dx * dx + dy * dy).sqrt().max(0.001);
                (dx / len, dy / len)
            };
            let tip = p3;
            let base = (tip.0 - dx * head_len, tip.1 - dy * head_len);
            let nx = -dy;
            let ny = dx;
            let a = (base.0 + nx * head_width, base.1 + ny * head_width);
            let b = (base.0 - nx * head_width, base.1 - ny * head_width);
            fill_triangle(img, tip, a, b, ARROW);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_node(
    img: &mut RgbaImage,
    node: &CanvasNodeInfo,
    selected: bool,
    font: &FontRef<'static>,
    offset_x: f32,
    offset_y: f32,
    cw: f32,
    ch: f32,
) {
    let left = node.x as f32 * cw - offset_x;
    let top = node.y as f32 * ch + ch * 0.11 - offset_y;
    let width = node.width as f32 * cw;
    let height = (ch * 0.78).max(6.0);

    if left + width < 0.0
        || top + height < 0.0
        || left > img.width() as f32
        || top > img.height() as f32
    {
        return;
    }

    let radius = (height * 0.32).min(cw * 0.9).max(2.0);
    let border_width = if selected {
        (ch * 0.11).max(2.0)
    } else {
        (ch * 0.06).max(1.0)
    };

    let border = if selected {
        SELECT_BORDER
    } else {
        DEPTH_BORDERS[node.depth % DEPTH_BORDERS.len()]
    };
    let fill = if selected {
        lighten(
            if node.depth == 0 {
                ROOT_FILL
            } else {
                NODE_FILL
            },
            0.10,
        )
    } else if node.depth == 0 {
        ROOT_FILL
    } else {
        NODE_FILL
    };

    // Soft glow behind the selected card.
    if selected {
        for i in 1..=3 {
            let extra = i as f32 * 1.4;
            stroke_rounded_rect(
                img,
                left - extra,
                top - extra,
                width + extra * 2.0,
                height + extra * 2.0,
                radius + extra,
                extra.max(1.0),
                SELECT_GLOW,
            );
        }
    }

    fill_rounded_card(
        img,
        left,
        top,
        width,
        height,
        radius,
        border_width,
        fill,
        border,
    );

    // Label text.
    let font_size = (cw / MONO_ADVANCE).min(height * 0.82).max(4.0);
    let text_color = if node.depth == 0 { TEXT_ROOT } else { TEXT };
    let padding = (cw * 0.55).max(3.0);
    let marker_space = if node.has_children {
        (cw * 1.7).max(8.0)
    } else {
        0.0
    };
    let max_text_width = (width - padding * 2.0 - marker_space).max(1.0);
    let label = fit_text(font, &node.label, font_size, max_text_width);
    let baseline = top
        + height / 2.0
        + (font.as_scaled(font_size).ascent() - font.as_scaled(font_size).descent()) / 2.0;

    draw_text(
        img,
        font,
        &label,
        left + padding,
        baseline,
        font_size,
        text_color,
        node.depth == 0 || selected,
    );

    // Fold marker as a crisp geometric triangle.
    if node.has_children {
        let size = (ch * 0.22).max(2.5);
        let mx = left + width - padding - size * 0.5;
        let my = top + height / 2.0;
        if node.folded {
            fill_triangle(
                img,
                (mx + size * 0.5, my),
                (mx - size * 0.5, my - size),
                (mx - size * 0.5, my + size),
                MARKER,
            );
        } else {
            fill_triangle(
                img,
                (mx, my + size * 0.6),
                (mx - size, my - size * 0.4),
                (mx + size, my - size * 0.4),
                MARKER,
            );
        }
    }
}

fn lighten(color: Color, amount: f32) -> Color {
    let mix = |c: u8| (c as f32 + (255.0 - c as f32) * amount).round() as u8;
    [mix(color[0]), mix(color[1]), mix(color[2]), color[3]]
}

#[allow(clippy::too_many_arguments)]
fn fill_rounded_card(
    img: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    radius: f32,
    border: f32,
    fill: Color,
    border_color: Color,
) {
    let x0 = (x - 2.0).floor() as i32;
    let y0 = (y - 2.0).floor() as i32;
    let x1 = (x + w + 2.0).ceil() as i32;
    let y1 = (y + h + 2.0).ceil() as i32;
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let hw = w / 2.0;
    let hh = h / 2.0;
    let inner_hw = (hw - border).max(0.0);
    let inner_hh = (hh - border).max(0.0);
    let inner_radius = (radius - border).max(0.0);

    for py in y0..=y1 {
        for px in x0..=x1 {
            let dx = px as f32 + 0.5 - cx;
            let dy = py as f32 + 0.5 - cy;
            let outer = rounded_box_coverage(dx, dy, hw, hh, radius);
            if outer <= 0.0 {
                continue;
            }
            let inner = rounded_box_coverage(dx, dy, inner_hw, inner_hh, inner_radius);
            let border_cov = (outer - inner).max(0.0);
            if inner > 0.0 {
                blend_pixel(img, px, py, fill, inner);
            }
            if border_cov > 0.0 {
                blend_pixel(img, px, py, border_color, border_cov);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn stroke_rounded_rect(
    img: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    radius: f32,
    thickness: f32,
    color: Color,
) {
    let x0 = (x - 2.0).floor() as i32;
    let y0 = (y - 2.0).floor() as i32;
    let x1 = (x + w + 2.0).ceil() as i32;
    let y1 = (y + h + 2.0).ceil() as i32;
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let hw = w / 2.0;
    let hh = h / 2.0;

    for py in y0..=y1 {
        for px in x0..=x1 {
            let dx = px as f32 + 0.5 - cx;
            let dy = py as f32 + 0.5 - cy;
            let outer = rounded_box_coverage(dx, dy, hw, hh, radius);
            let inner = rounded_box_coverage(
                dx,
                dy,
                (hw - thickness).max(0.0),
                (hh - thickness).max(0.0),
                (radius - thickness).max(0.0),
            );
            let cov = (outer - inner).max(0.0);
            if cov > 0.0 {
                blend_pixel(img, px, py, color, cov);
            }
        }
    }
}

fn rounded_box_coverage(dx: f32, dy: f32, hw: f32, hh: f32, radius: f32) -> f32 {
    let r = radius.min(hw).min(hh).max(0.0);
    let qx = dx.abs() - (hw - r);
    let qy = dy.abs() - (hh - r);
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    let inside = qx.max(qy).min(0.0);
    let dist = outside + inside - r;
    (0.5 - dist).clamp(0.0, 1.0)
}

#[allow(clippy::too_many_arguments)]
fn draw_bezier(
    img: &mut RgbaImage,
    p0: (f32, f32),
    p1: (f32, f32),
    p2: (f32, f32),
    p3: (f32, f32),
    thickness: f32,
    color: Color,
    alpha: u8,
) {
    let min_x = p0.0.min(p1.0).min(p2.0).min(p3.0) - thickness;
    let max_x = p0.0.max(p1.0).max(p2.0).max(p3.0) + thickness;
    let min_y = p0.1.min(p1.1).min(p2.1).min(p3.1) - thickness;
    let max_y = p0.1.max(p1.1).max(p2.1).max(p3.1) + thickness;
    if max_x < 0.0 || max_y < 0.0 || min_x > img.width() as f32 || min_y > img.height() as f32 {
        return;
    }

    let approx_len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
    let steps = ((approx_len / 0.7).ceil() as usize).clamp(8, 4000);
    let radius = (thickness / 2.0).max(0.6);
    let alpha = alpha as f32 / 255.0;

    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let (x, y) = cubic_bezier(p0, p1, p2, p3, t);
        draw_disc(img, x, y, radius, color, alpha);
    }
}

fn cubic_bezier(
    p0: (f32, f32),
    p1: (f32, f32),
    p2: (f32, f32),
    p3: (f32, f32),
    t: f32,
) -> (f32, f32) {
    let u = 1.0 - t;
    let a = u * u * u;
    let b = 3.0 * u * u * t;
    let c = 3.0 * u * t * t;
    let d = t * t * t;
    (
        a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
        a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
    )
}

fn dist(a: (f32, f32), b: (f32, f32)) -> f32 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

fn draw_disc(img: &mut RgbaImage, x: f32, y: f32, radius: f32, color: Color, alpha: f32) {
    let x0 = (x - radius - 1.0).floor() as i32;
    let y0 = (y - radius - 1.0).floor() as i32;
    let x1 = (x + radius + 1.0).ceil() as i32;
    let y1 = (y + radius + 1.0).ceil() as i32;

    for py in y0..=y1 {
        for px in x0..=x1 {
            let dx = px as f32 + 0.5 - x;
            let dy = py as f32 + 0.5 - y;
            let d = (dx * dx + dy * dy).sqrt() - radius;
            let cov = (0.5 - d).clamp(0.0, 1.0) * alpha;
            if cov > 0.0 {
                blend_pixel(img, px, py, color, cov);
            }
        }
    }
}

fn fill_triangle(img: &mut RgbaImage, a: (f32, f32), b: (f32, f32), c: (f32, f32), color: Color) {
    let min_x = a.0.min(b.0).min(c.0).floor() as i32 - 1;
    let max_x = a.0.max(b.0).max(c.0).ceil() as i32 + 1;
    let min_y = a.1.min(b.1).min(c.1).floor() as i32 - 1;
    let max_y = a.1.max(b.1).max(c.1).ceil() as i32 + 1;

    let edge = |p: (f32, f32), q: (f32, f32), x: f32, y: f32| {
        (q.0 - p.0) * (y - p.1) - (q.1 - p.1) * (x - p.0)
    };

    for py in min_y..=max_y {
        for px in min_x..=max_x {
            let mut hits = 0.0;
            for (sx, sy) in [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)] {
                let x = px as f32 + sx;
                let y = py as f32 + sy;
                let e0 = edge(a, b, x, y);
                let e1 = edge(b, c, x, y);
                let e2 = edge(c, a, x, y);
                if (e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0) || (e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0) {
                    hits += 1.0;
                }
            }
            if hits > 0.0 {
                blend_pixel(img, px, py, color, hits / 4.0);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_text(
    img: &mut RgbaImage,
    font: &FontRef<'static>,
    text: &str,
    x: f32,
    baseline: f32,
    size: f32,
    color: Color,
    bold: bool,
) {
    let scale = PxScale::from(size);
    let scaled = font.as_scaled(scale);
    let mut pen_x = x;
    let mut prev = None;

    for ch in text.chars() {
        let mut glyph_id = font.glyph_id(ch);
        if glyph_id.0 == 0 {
            glyph_id = font.glyph_id('?');
        }
        if let Some(prev_id) = prev {
            pen_x += scaled.kern(prev_id, glyph_id);
        }

        let glyph = glyph_id.with_scale_and_position(scale, ab_glyph::point(pen_x, baseline));
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                blend_pixel(img, px, py, color, coverage);
                if bold {
                    blend_pixel(img, px + 1, py, color, coverage * 0.65);
                }
            });
        }

        pen_x += scaled.h_advance(glyph_id);
        prev = Some(glyph_id);
    }
}

fn fit_text(font: &FontRef<'static>, text: &str, size: f32, max_width: f32) -> String {
    if text_width(font, text, size) <= max_width {
        return text.to_string();
    }

    let ellipsis = '…';
    let ellipsis_width = text_width(font, "…", size);
    let mut out = String::new();
    let mut width = 0.0;
    for ch in text.chars() {
        let ch_width = text_width(font, &ch.to_string(), size);
        if width + ch_width + ellipsis_width > max_width {
            break;
        }
        out.push(ch);
        width += ch_width;
    }
    out.push(ellipsis);
    out
}

fn text_width(font: &FontRef<'static>, text: &str, size: f32) -> f32 {
    let scale = PxScale::from(size);
    let scaled = font.as_scaled(scale);
    let mut width = 0.0;
    let mut prev = None;
    for ch in text.chars() {
        let mut glyph_id = font.glyph_id(ch);
        if glyph_id.0 == 0 {
            glyph_id = font.glyph_id('?');
        }
        if let Some(prev_id) = prev {
            width += scaled.kern(prev_id, glyph_id);
        }
        width += scaled.h_advance(glyph_id);
        prev = Some(glyph_id);
    }
    width
}

fn blend_pixel(img: &mut RgbaImage, x: i32, y: i32, color: Color, coverage: f32) {
    if x < 0 || y < 0 || x >= img.width() as i32 || y >= img.height() as i32 {
        return;
    }
    let a = (color[3] as f32 / 255.0) * coverage.clamp(0.0, 1.0);
    if a <= 0.0 {
        return;
    }

    let px = img.get_pixel_mut(x as u32, y as u32);
    for i in 0..3 {
        px[i] = (color[i] as f32 * a + px[i] as f32 * (1.0 - a)).round() as u8;
    }
    px[3] = ((a + (px[3] as f32 / 255.0) * (1.0 - a)) * 255.0)
        .round()
        .clamp(0.0, 255.0) as u8;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formatter::{compute_canvas, CanvasOptions};

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
        let mut a = TreeNode::new("a", "Alpha");
        a.arrow_links.push("b".to_string());
        root.children.push(a);
        root.children.push(TreeNode::new("b", "Beta"));
        root
    }

    fn non_bg_pixels(img: &RgbaImage) -> usize {
        img.pixels()
            .filter(|p| p.0[0..3] != BG[0..3] || p.0[3] != BG[3])
            .count()
    }

    #[test]
    fn image_has_expected_dimensions() {
        let canvas = compute_canvas(&sample_tree(), &opts());
        let img = render_canvas_image(
            &canvas,
            Some("root"),
            0,
            0,
            canvas.width.max(1),
            canvas.height.max(1),
            8,
            16,
            1.0,
        );
        assert_eq!(img.width(), canvas.width.max(1) as u32 * 8);
        assert_eq!(img.height(), canvas.height.max(1) as u32 * 16);
        assert!(non_bg_pixels(&img) > 0);
    }

    #[test]
    fn selection_changes_the_image() {
        let canvas = compute_canvas(&sample_tree(), &opts());
        let plain =
            render_canvas_image(&canvas, None, 0, 0, canvas.width, canvas.height, 8, 16, 1.0);
        let selected = render_canvas_image(
            &canvas,
            Some("a"),
            0,
            0,
            canvas.width,
            canvas.height,
            8,
            16,
            1.0,
        );
        assert_ne!(plain.as_raw(), selected.as_raw());
    }

    #[test]
    fn panning_changes_the_image() {
        let canvas = compute_canvas(&sample_tree(), &opts());
        let at_origin =
            render_canvas_image(&canvas, None, 0, 0, canvas.width, canvas.height, 8, 16, 1.0);
        let panned =
            render_canvas_image(&canvas, None, 2, 1, canvas.width, canvas.height, 8, 16, 1.0);
        assert_ne!(at_origin.as_raw(), panned.as_raw());
    }

    #[test]
    fn zoom_changes_content_but_not_image_size() {
        let canvas = compute_canvas(&sample_tree(), &opts());
        let normal =
            render_canvas_image(&canvas, None, 0, 0, canvas.width, canvas.height, 8, 16, 1.0);
        let zoomed =
            render_canvas_image(&canvas, None, 0, 0, canvas.width, canvas.height, 8, 16, 2.0);
        assert_ne!(normal.as_raw(), zoomed.as_raw());
        assert_eq!(normal.dimensions(), zoomed.dimensions());
    }

    #[test]
    fn empty_canvas_is_still_a_valid_image() {
        let canvas = CanvasData {
            nodes: Vec::new(),
            width: 0,
            height: 0,
            grid: Vec::new(),
            arrow_mask: Vec::new(),
            ascii: false,
        };
        let img = render_canvas_image(&canvas, None, 0, 0, 1, 1, 8, 16, 1.0);
        assert_eq!((img.width(), img.height()), (8, 16));
    }

    #[test]
    fn renders_through_ratatui_image() {
        use ratatui::buffer::Buffer;
        use ratatui::layout::Rect;
        use ratatui::widgets::StatefulWidget;
        use ratatui_image::picker::{Picker, ProtocolType};
        use ratatui_image::{protocol::StatefulProtocol, Resize, StatefulImage};

        let canvas = compute_canvas(&sample_tree(), &opts());
        let img = render_canvas_image(&canvas, Some("a"), 0, 0, 40, 12, 8, 16, 1.0);

        let mut picker = Picker::from_fontsize((8, 16));
        picker.set_protocol_type(ProtocolType::Halfblocks);
        let mut protocol: StatefulProtocol =
            picker.new_resize_protocol(image::DynamicImage::ImageRgba8(img));

        let area = Rect::new(0, 0, 40, 12);
        let mut buf = Buffer::empty(area);
        StatefulImage::<StatefulProtocol>::default()
            .resize(Resize::Fit(None))
            .render(area, &mut buf, &mut protocol);

        assert!(
            buf.content().iter().any(|cell| cell.symbol() != " "),
            "halfblocks fallback produced an empty buffer"
        );
    }

    #[test]
    fn saves_png_file() {
        let path = std::env::temp_dir().join(format!(
            "fmap-canvas-test-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let (w, h) = save_canvas_png(
            &sample_tree(),
            &opts(),
            Some("root"),
            &path,
            EXPORT_CELL.0,
            EXPORT_CELL.1,
        )
        .expect("png export works");
        let bytes = std::fs::read(&path).expect("file exists");
        let _ = std::fs::remove_file(&path);
        assert!(bytes.len() > 100);
        assert_eq!(bytes[..8], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert!(w > 0 && h > 0);
    }
}
