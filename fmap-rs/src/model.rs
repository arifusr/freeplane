use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapMeta {
    pub id: String,
    pub title: String,
    pub root_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub node_count: usize,
    pub edge_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapNode {
    pub id: String,
    pub map_id: String,
    pub text: String,
    pub note: Option<String>,
    pub position: Option<String>, // "left", "right"
    pub folded: bool,
    pub color: Option<String>,
    pub background_color: Option<String>,
    pub style: Option<String>,
    pub link: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub id: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(default)]
    pub folded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arrow_links: Vec<String>,
    #[serde(skip)]
    pub created_at: Option<String>,
    #[serde(skip)]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<TreeNode>,
}

impl TreeNode {
    pub fn new(id: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
            note: None,
            position: None,
            folded: false,
            color: None,
            background_color: None,
            style: None,
            link: None,
            arrow_links: Vec::new(),
            created_at: None,
            updated_at: None,
            children: Vec::new(),
        }
    }

    pub fn count_nodes(&self) -> usize {
        1 + self.children.iter().map(|c| c.count_nodes()).sum::<usize>()
    }
}
