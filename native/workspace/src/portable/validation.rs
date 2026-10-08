use super::{PortableBackup, MAX_BACKUP_BYTES};
use crate::{model::*, validation::validate_record};
use std::collections::{HashMap, HashSet};

fn invalid(message: &str) -> StorageError {
    StorageError::invalid(message)
}
fn unique<'a>(values: impl Iterator<Item = &'a str>) -> Result<()> {
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(invalid("Duplicate record identity"));
        }
    }
    Ok(())
}

impl PortableBackup {
    pub fn validate(&self) -> Result<()> {
        if self.format != "kanban-calendar" || self.version != 1 {
            return Err(invalid("Unsupported portable backup version"));
        }
        if serde_json::to_vec(self)?.len() > MAX_BACKUP_BYTES {
            return Err(invalid("Backup exceeds 100 MB safety limit"));
        }
        chrono::DateTime::parse_from_rfc3339(&self.exported_at)
            .map_err(|_| invalid("Invalid export timestamp"))?;
        macro_rules! validate {
            ($records:expr) => {
                for record in $records {
                    validate_record(record)?;
                }
            };
        }
        validate!(&self.boards);
        validate!(&self.columns);
        validate!(&self.items);
        validate!(&self.events);
        validate!(&self.tags);
        validate!(&self.relations);
        validate!(&self.scratchpads);
        validate!(&self.settings);
        unique(
            self.boards
                .iter()
                .map(|v| v.meta.id.as_str())
                .chain(self.columns.iter().map(|v| v.meta.id.as_str()))
                .chain(self.items.iter().map(|v| v.meta.id.as_str()))
                .chain(self.events.iter().map(|v| v.id.as_str()))
                .chain(self.tags.iter().map(|v| v.meta.id.as_str())),
        )?;
        unique(self.scratchpads.iter().map(|v| v.meta.id.as_str()))?;
        unique(self.settings.iter().map(|v| v.id.as_str()))?;
        if self.scratchpads.iter().any(|v| v.meta.id != "global")
            || self.settings.iter().any(|v| v.id != "app")
        {
            return Err(invalid("Invalid singleton identity"));
        }
        // UUID-only canonical entities cannot use singleton IDs accepted by generic validation.
        for id in self
            .boards
            .iter()
            .map(|v| &v.meta.id)
            .chain(self.columns.iter().map(|v| &v.meta.id))
            .chain(self.items.iter().map(|v| &v.meta.id))
            .chain(self.events.iter().map(|v| &v.id))
            .chain(self.tags.iter().map(|v| &v.meta.id))
        {
            uuid::Uuid::parse_str(id).map_err(|_| invalid("Invalid entity UUID"))?;
        }
        let boards: HashMap<_, _> = self.boards.iter().map(|v| (&v.meta.id, v)).collect();
        let columns: HashMap<_, _> = self.columns.iter().map(|v| (&v.meta.id, v)).collect();
        let items: HashMap<_, _> = self.items.iter().map(|v| (&v.meta.id, v)).collect();
        let tags: HashSet<_> = self.tags.iter().map(|v| &v.meta.id).collect();
        if self
            .boards
            .iter()
            .filter(|b| b.kind == BoardKind::Root)
            .count()
            != 1
        {
            return Err(invalid("Backup must have exactly one root board"));
        }
        let mut column_orders = HashSet::new();
        let mut column_names = HashSet::new();
        let mut defaults: HashMap<&String, usize> = HashMap::new();
        let mut completions: HashMap<&String, usize> = HashMap::new();
        let mut populated = HashSet::new();
        for column in &self.columns {
            if !boards.contains_key(&column.board_id) {
                return Err(invalid("Column references missing board"));
            }
            if !column_orders.insert((&column.board_id, &column.order_key))
                || !column_names.insert((&column.board_id, column.input.name.to_lowercase()))
            {
                return Err(invalid("Duplicate column name or order"));
            }
            populated.insert(&column.board_id);
            *defaults.entry(&column.board_id).or_default() +=
                usize::from(column.input.is_default_new_item_column);
            *completions.entry(&column.board_id).or_default() +=
                usize::from(column.input.completes_item_on_entry);
        }
        let mut project_boards: HashMap<&String, usize> = HashMap::new();
        for board in &self.boards {
            if populated.contains(&board.meta.id)
                && (defaults[&board.meta.id] != 1 || completions[&board.meta.id] > 1)
            {
                return Err(invalid("Invalid default/completion columns"));
            }
            match (&board.kind, &board.project_id) {
                (BoardKind::Root, None) => {}
                (BoardKind::Project, Some(id))
                    if items.get(id).is_some_and(|i| i.kind == ItemKind::Project) =>
                {
                    *project_boards.entry(id).or_default() += 1;
                }
                _ => return Err(invalid("Invalid project board")),
            }
        }
        let mut item_orders = HashSet::new();
        for item in &self.items {
            let board = boards
                .get(&item.board_id)
                .ok_or_else(|| invalid("Item references missing board"))?;
            let column = columns.get(&item.column_id);
            if (column.is_none() && item.archived_at.is_none())
                || column.is_some_and(|c| c.board_id != item.board_id)
            {
                return Err(invalid("Invalid item column"));
            }
            if !item_orders.insert((&item.column_id, &item.order_key)) {
                return Err(invalid("Duplicate item order"));
            }
            if board.project_id != item.parent_project_id
                || item
                    .parent_project_id
                    .as_ref()
                    .is_some_and(|id| !items.get(id).is_some_and(|i| i.kind == ItemKind::Project))
            {
                return Err(invalid("Invalid item ownership"));
            }
            if item.kind == ItemKind::Project
                && (board.kind != BoardKind::Root
                    || item.parent_project_id.is_some()
                    || project_boards.get(&item.meta.id) != Some(&1))
            {
                return Err(invalid("Invalid project ownership"));
            }
            if item.parent_project_id.is_some()
                && (item.archived_at.is_some() || item.archive_after.is_some())
            {
                return Err(invalid("Child tasks cannot be archived separately"));
            }
            if item.archive_after.is_some() && item.completed_at.is_none() {
                return Err(invalid("Archive schedule requires completion"));
            }
        }
        for event in &self.events {
            if !items.contains_key(&event.item_id) {
                return Err(invalid("History references missing item"));
            }
        }
        let mut associations = HashSet::new();
        for relation in &self.relations {
            if !items.contains_key(&relation.item_id)
                || !tags.contains(&relation.tag_id)
                || !associations.insert((&relation.item_id, &relation.tag_id))
            {
                return Err(invalid("Invalid or duplicate tag association"));
            }
        }
        let mut names = HashSet::new();
        for tag in &self.tags {
            if !names.insert(tag.name.to_lowercase()) {
                return Err(invalid("Duplicate tag names"));
            }
        }
        Ok(())
    }
}
