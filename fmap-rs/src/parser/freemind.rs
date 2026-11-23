use crate::model::TreeNode;
use anyhow::{anyhow, Result};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

pub fn parse_mm(xml: &str) -> Result<TreeNode> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut node_stack: Vec<TreeNode> = Vec::new();
    let mut root_node: Option<TreeNode> = None;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"node" => {
                let node = parse_node_attributes(e)?;
                node_stack.push(node);
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"node" => {
                let node = parse_node_attributes(e)?;
                if let Some(parent) = node_stack.last_mut() {
                    parent.children.push(node);
                } else if root_node.is_none() {
                    root_node = Some(node);
                }
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"node" => {
                if let Some(finished_node) = node_stack.pop() {
                    if let Some(parent) = node_stack.last_mut() {
                        parent.children.push(finished_node);
                    } else if root_node.is_none() {
                        root_node = Some(finished_node);
                    }
                }
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"richcontent" => {
                // Ignore or handle
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(anyhow!("Gagal parsing XML FreeMind: {:?}", e)),
            _ => {}
        }
        buf.clear();
    }

    root_node.ok_or_else(|| anyhow!("Tidak ditemukan elemen <node> dalam XML FreeMind"))
}

fn parse_node_attributes(e: &BytesStart) -> Result<TreeNode> {
    let mut id = String::new();
    let mut text = String::new();
    let mut position = None;
    let mut folded = false;
    let mut color = None;
    let mut bg_color = None;
    let mut style = None;
    let mut link = None;

    for attr in e.attributes() {
        let a = attr?;
        let key = std::str::from_utf8(a.key.as_ref())?;
        let val = a.unescape_value()?.to_string();

        match key {
            "ID" => id = val,
            "TEXT" => text = val,
            "POSITION" => position = Some(val),
            "FOLDED" => folded = val == "true",
            "COLOR" => color = Some(val),
            "BACKGROUND_COLOR" => bg_color = Some(val),
            "STYLE" => style = Some(val),
            "LINK" => link = Some(val),
            _ => {}
        }
    }

    if id.is_empty() {
        id = format!("ID_{}_{}", chrono::Utc::now().timestamp_millis(), fastrand());
    }

    Ok(TreeNode {
        id,
        text,
        note: None,
        position,
        folded,
        color,
        background_color: bg_color,
        style,
        link,
        created_at: None,
        updated_at: None,
        children: Vec::new(),
    })
}

fn fastrand() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    (SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() % 10000) as u32
}

pub fn serialize_mm(root: &TreeNode) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<map version=\"freeplane 1.9.0\">\n");
    serialize_node_xml(root, 1, &mut out);
    out.push_str("</map>\n");
    out
}

fn serialize_node_xml(node: &TreeNode, depth: usize, out: &mut String) {
    let indent = "\t".repeat(depth);
    out.push_str(&indent);
    out.push_str("<node");

    out.push_str(&format!(" ID=\"{}\"", escape_xml(&node.id)));
    out.push_str(&format!(" TEXT=\"{}\"", escape_xml(&node.text)));

    if let Some(ref pos) = node.position {
        out.push_str(&format!(" POSITION=\"{}\"", escape_xml(pos)));
    }
    if node.folded {
        out.push_str(" FOLDED=\"true\"");
    }
    if let Some(ref c) = node.color {
        out.push_str(&format!(" COLOR=\"{}\"", escape_xml(c)));
    }
    if let Some(ref bg) = node.background_color {
        out.push_str(&format!(" BACKGROUND_COLOR=\"{}\"", escape_xml(bg)));
    }
    if let Some(ref s) = node.style {
        out.push_str(&format!(" STYLE=\"{}\"", escape_xml(s)));
    }
    if let Some(ref l) = node.link {
        out.push_str(&format!(" LINK=\"{}\"", escape_xml(l)));
    }

    if node.children.is_empty() {
        out.push_str("/>\n");
    } else {
        out.push_str(">\n");
        for child in &node.children {
            serialize_node_xml(child, depth + 1, out);
        }
        out.push_str(&indent);
        out.push_str("</node>\n");
    }
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\n', "&#10;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let mut root = TreeNode::new("ID_root", "Root Map");
        let child1 = TreeNode::new("ID_c1", "Child One");
        root.children.push(child1);

        let xml = serialize_mm(&root);
        assert!(xml.contains("Root Map"));
        assert!(xml.contains("Child One"));

        let parsed = parse_mm(&xml).unwrap();
        assert_eq!(parsed.id, "ID_root");
        assert_eq!(parsed.text, "Root Map");
        assert_eq!(parsed.children.len(), 1);
        assert_eq!(parsed.children[0].text, "Child One");
    }
}

