//! Agent-independent records and ancestry. Native storage and UI stay outside this crate.
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub agent: String,
    pub native_id: Option<String>,
    pub parent_id: Option<String>,
    pub relation: Option<String>,
    pub title: String,
    #[serde(default)]
    pub workspace: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub subagent: bool,
    #[serde(default)]
    pub missing: bool,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub version: u32,
    pub generated_at: String,
    pub nodes: Vec<Node>,
    pub issues: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_id: Option<String>,
}

pub fn create_index(records: Vec<Node>, mut issues: Vec<Value>) -> Result<Index> {
    let mut nodes = BTreeMap::new();
    for mut node in records {
        if node.id.is_empty() || node.agent.is_empty() {
            bail!("Each session needs a non-empty id and an agent.");
        }
        if node.title.is_empty() {
            node.title = node.native_id.clone().unwrap_or_else(|| node.id.clone());
        }
        if node.parent_id.as_deref() == Some("") {
            node.parent_id = None;
        }
        if node.parent_id.is_some() && node.relation.is_none() {
            node.relation = Some("fork".into());
        }
        if node.parent_id.is_none() {
            node.relation = None;
        }
        node.missing = false;
        if nodes.insert(node.id.clone(), node).is_some() {
            bail!("Duplicate session.");
        }
    }
    for node in nodes.values().cloned().collect::<Vec<_>>() {
        if let Some(parent) = &node.parent_id
            && !nodes.contains_key(parent)
        {
            nodes.insert(
                parent.clone(),
                Node {
                    id: parent.clone(),
                    agent: node.agent,
                    title: "未找到的来源会话".into(),
                    missing: true,
                    ..Node::default()
                },
            );
            issues.push(json!({"kind":"missing-parent","id":node.id,"parentId":parent}));
        }
    }
    let mut visited = BTreeSet::new();
    for id in nodes.keys().cloned().collect::<Vec<_>>() {
        let mut trail = Vec::new();
        let mut positions = BTreeMap::new();
        let mut cursor = Some(id);
        while let Some(id) = cursor {
            if visited.contains(&id) {
                break;
            }
            if let Some(start) = positions.get(&id) {
                let cut = trail[*start..].iter().min().unwrap();
                let node = nodes.get_mut(cut).unwrap();
                issues.push(json!({"kind":"cycle","id":node.id,"parentId":node.parent_id}));
                node.parent_id = None;
                node.relation = None;
                break;
            }
            positions.insert(id.clone(), trail.len());
            trail.push(id.clone());
            cursor = nodes.get(&id).and_then(|node| node.parent_id.clone());
        }
        visited.extend(trail);
    }
    Ok(Index {
        version: 1,
        generated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        nodes: nodes.into_values().collect(),
        issues,
        root_id: None,
        current_id: None,
    })
}

pub fn family(index: &Index, current: &str) -> Index {
    let mut result = Index {
        version: index.version,
        generated_at: index.generated_at.clone(),
        nodes: vec![],
        issues: vec![],
        root_id: None,
        current_id: Some(current.into()),
    };
    let by_id: BTreeMap<_, _> = index
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let Some(mut root) = by_id.get(current).copied() else {
        result.nodes.clear();
        result.issues.clear();
        result.root_id = None;
        return result;
    };
    let mut seen = BTreeSet::new();
    while let Some(parent) = root.parent_id.as_deref().and_then(|id| by_id.get(id)) {
        if !seen.insert(root.id.as_str()) {
            break;
        }
        root = parent;
    }
    let mut children: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for node in &index.nodes {
        if let Some(parent) = node.parent_id.as_deref() {
            children.entry(parent).or_default().push(&node.id);
        }
    }
    let mut selected = BTreeSet::new();
    let mut pending = vec![root.id.as_str()];
    while let Some(id) = pending.pop() {
        if selected.insert(id)
            && let Some(children) = children.get(id)
        {
            pending.extend(children);
        }
    }
    result.root_id = Some(root.id.clone());
    result.nodes = index
        .nodes
        .iter()
        .filter(|node| selected.contains(node.id.as_str()))
        .cloned()
        .collect();
    result.issues = index
        .issues
        .iter()
        .filter(|issue| issue["id"].as_str().is_none_or(|id| selected.contains(id)))
        .cloned()
        .collect();
    result
}

pub fn conversation_index(index: &Index) -> Index {
    let mut result = index.clone();
    result.nodes.retain(|node| !node.subagent);
    let visible: BTreeSet<_> = result.nodes.iter().map(|node| node.id.as_str()).collect();
    result
        .issues
        .retain(|issue| issue["id"].as_str().is_none_or(|id| visible.contains(id)));
    result
}

pub fn matches(node: &Node, query: &str, archived: bool, subagents: bool) -> bool {
    !node.missing
        && (archived || !node.archived)
        && (subagents || !node.subagent)
        && format!(
            "{} {} {} {}",
            node.title,
            node.workspace,
            node.native_id.as_deref().unwrap_or(""),
            node.agent
        )
        .to_lowercase()
        .contains(&query.trim().to_lowercase())
}

pub fn summary(index: &Index) -> Value {
    json!({ "sessions": index.nodes.iter().filter(|node| !node.missing).count(),
        "forks": index.nodes.iter().filter(|node| node.relation.as_deref() == Some("fork")).count(),
        "roots": index.nodes.iter().filter(|node| node.parent_id.is_none()).count(),
        "issues":index.issues.len(),"generatedAt":index.generated_at })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn node(id: &str, parent: Option<&str>) -> Node {
        Node {
            id: id.into(),
            agent: "test".into(),
            parent_id: parent.map(String::from),
            ..Node::default()
        }
    }
    #[test]
    fn missing_ancestors_and_cycles_keep_all_nodes() {
        let index = create_index(
            vec![
                node("a", Some("b")),
                node("b", Some("a")),
                node("c", Some("missing")),
            ],
            vec![],
        )
        .unwrap();
        assert!(
            index
                .nodes
                .iter()
                .find(|node| node.id == "a")
                .unwrap()
                .parent_id
                .is_none()
        );
        assert!(
            index
                .nodes
                .iter()
                .find(|node| node.id == "missing")
                .unwrap()
                .missing
        );
        assert_eq!(family(&index, "c").nodes.len(), 2);
        assert_eq!(family(&index, "absent").nodes.len(), 0);
        assert_eq!(index.issues.len(), 2);
    }
}
