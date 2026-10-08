use crate::{contracts::Command, model::*, ordering::between, sqlite::Context, validation};
use chrono::Duration;
use serde_json::{json, Value};

impl Context<'_> {
    pub fn command(&self, command: Command) -> Result<Value> {
        match command {
            Command::Initialize => {
                let roots: Vec<Board> = self.list("WHERE kind='root'", [])?;
                let root = if let Some(root) = roots.into_iter().next() {
                    root
                } else {
                    let root = Board {
                        meta: self.meta(),
                        kind: BoardKind::Root,
                        project_id: None,
                        name: "Dashboard".into(),
                    };
                    self.put(&root)?;
                    root
                };
                if self.get::<Settings>("app")?.is_none() {
                    self.put(&Settings::default())?;
                }
                Ok(json!(root))
            }
            Command::SaveColumn {
                board_id,
                input,
                id,
            } => Ok(json!(self.save_column(&board_id, input, id.as_deref())?)),
            Command::ReorderColumn { id, before_id } => {
                let mut col: Column = self.require(&id)?;
                let cols: Vec<Column> = self
                    .columns(&col.board_id)?
                    .into_iter()
                    .filter(|c| c.meta.id != id)
                    .collect();
                let i = position(&cols, before_id.as_deref(), |c| &c.meta.id)?;
                col.order_key = between(
                    i.checked_sub(1).map(|i| cols[i].order_key.as_str()),
                    cols.get(i).map(|c| c.order_key.as_str()),
                )?;
                self.touch(&mut col.meta);
                self.put(&col)?;
                Ok(Value::Null)
            }
            Command::DeleteColumn {
                id,
                destination_id,
                confirmed,
            } => {
                confirm(confirmed, "Confirm column deletion")?;
                let col: Column = self.require(&id)?;
                let cols = self.columns(&col.board_id)?;
                let items: Vec<Item> = self.list("WHERE column_id=?1 ORDER BY id", [&id])?;
                let destination = cols
                    .iter()
                    .find(|c| Some(&c.meta.id) == destination_id.as_ref() && c.meta.id != id);
                if (!items.is_empty() || cols.len() > 1) && destination.is_none() {
                    return Err(StorageError::invalid(
                        "Choose a destination and replacement default column",
                    ));
                }
                for item in items {
                    self.move_item(&item.meta.id, &destination.unwrap().meta.id, None, true)?;
                }
                self.remove::<Column>(&id)?;
                if col.input.is_default_new_item_column {
                    if let Some(destination) = destination {
                        let mut dest = destination.clone();
                        self.touch(&mut dest.meta);
                        dest.input.is_default_new_item_column = true;
                        self.put(&dest)?;
                    }
                }
                Ok(Value::Null)
            }
            Command::Create {
                board_id,
                title,
                kind,
                column_id,
            } => Ok(json!(self.create_item(
                &board_id,
                &title,
                kind,
                column_id.as_deref()
            )?)),
            Command::Update {
                id,
                patch,
                expected,
                generation,
            } => {
                self.generation(generation.as_deref())?;
                let mut item: Item = self.require(&id)?;
                if let Some(expected) = expected {
                    if expected.title.is_some_and(|v| v != item.title)
                        || expected.description.is_some_and(|v| v != item.description)
                    {
                        return Err(StorageError::conflict());
                    }
                }
                if let Some(v) = patch.title {
                    item.title = validation::title(&v)?;
                }
                if let Some(v) = patch.description {
                    item.description = v;
                }
                if let Some(v) = patch.priority {
                    item.priority = v;
                }
                if let Patch::Value(v) = patch.planned_start_date {
                    item.planned_start_date = v;
                }
                if let Patch::Value(v) = patch.due_date {
                    item.due_date = v;
                }
                if let Patch::Value(v) = patch.project_color_token {
                    item.project_color_token = v;
                }
                self.touch(&mut item.meta);
                self.put(&item)?;
                Ok(json!(item))
            }
            Command::Move {
                id,
                column_id,
                before_id,
                confirmed,
            } => Ok(json!(self.move_item(
                &id,
                &column_id,
                before_id.as_deref(),
                confirmed
            )?)),
            Command::Archive { id, confirmed } => {
                self.archive_item(&id, confirmed)?;
                Ok(Value::Null)
            }
            Command::Maintain => {
                let items:Vec<Item>=self.list("WHERE archive_after>?1 AND archive_after<=?2 AND archived_at IS NULL AND completed_at IS NOT NULL AND parent_id IS NULL ORDER BY archive_after,id",["",&self.now()])?;
                for item in items {
                    self.archive_item(&item.meta.id, false)?;
                }
                Ok(Value::Null)
            }
            Command::Restore { id } => {
                let old: Item = self.require(&id)?;
                if old.parent_project_id.is_some() {
                    return Err(StorageError::invalid(
                        "Only top-level items can be restored",
                    ));
                }
                let cols = self.columns(&old.board_id)?;
                let col = cols
                    .iter()
                    .find(|c| c.meta.id == old.column_id)
                    .or_else(|| cols.iter().find(|c| c.input.is_default_new_item_column))
                    .ok_or_else(|| {
                        StorageError::invalid("Create a dashboard column before restoring")
                    })?;
                let fallback = old.column_id != col.meta.id;
                let mut next = if fallback {
                    self.transition(&old, col)
                } else {
                    let mut n = old.clone();
                    self.touch(&mut n.meta);
                    n
                };
                next.column_id = col.meta.id.clone();
                if fallback {
                    let siblings: Vec<Item> =
                        self.list("WHERE column_id=?1 ORDER BY order_key", [&col.meta.id])?;
                    next.order_key = between(siblings.last().map(|i| i.order_key.as_str()), None)?;
                }
                next.archived_at = None;
                next.archive_after =
                    if col.input.completes_item_on_entry && old.completed_at.is_some() {
                        Some(self.archive_time())
                    } else {
                        None
                    };
                self.put(&next)?;
                self.event(&next, EventKind::Restored, Some(old.column_id))?;
                Ok(json!(fallback))
            }
            Command::DeleteItem { id, confirmed } => {
                confirm(confirmed, "Confirm permanent deletion")?;
                let item: Item = self.require(&id)?;
                let mut ids = vec![id.clone()];
                if item.kind == ItemKind::Project {
                    ids.extend(self.children(&id)?.into_iter().map(|i| i.meta.id));
                }
                for id in &ids {
                    self.db
                        .execute("DELETE FROM relations WHERE item_id=?1", [id])?;
                    self.db
                        .execute("DELETE FROM events WHERE item_id=?1", [id])?;
                    self.remove::<Item>(id)?;
                }
                if item.kind == ItemKind::Project {
                    let boards: Vec<Board> = self.list("WHERE project_id=?1", [&id])?;
                    for board in boards {
                        self.db
                            .execute("DELETE FROM columns WHERE board_id=?1", [&board.meta.id])?;
                        self.remove::<Board>(&board.meta.id)?;
                    }
                }
                Ok(Value::Null)
            }
            Command::SaveTag {
                name,
                color_token,
                id,
            } => {
                let name = validation::title(&name)?;
                let old = if let Some(id) = id {
                    self.get::<Tag>(&id)?
                } else {
                    None
                };
                let meta = if let Some(mut old) = old {
                    self.touch(&mut old.meta);
                    old.meta
                } else {
                    self.meta()
                };
                let tag = Tag {
                    meta,
                    name,
                    color_token,
                };
                self.put(&tag)?;
                Ok(json!(tag))
            }
            Command::DeleteTag { id } => {
                self.db
                    .execute("DELETE FROM relations WHERE tag_id=?1", [&id])?;
                self.remove::<Tag>(&id)?;
                Ok(Value::Null)
            }
            Command::SetTag {
                item_id,
                tag_id,
                selected,
            } => {
                let mut item: Item = self.require(&item_id)?;
                self.require::<Tag>(&tag_id)?;
                if selected {
                    self.db.execute(
                        "INSERT OR IGNORE INTO relations VALUES(?1,?2)",
                        [&item_id, &tag_id],
                    )?;
                } else {
                    self.db.execute(
                        "DELETE FROM relations WHERE item_id=?1 AND tag_id=?2",
                        [&item_id, &tag_id],
                    )?;
                }
                self.touch(&mut item.meta);
                self.put(&item)?;
                Ok(Value::Null)
            }
            Command::SaveScratch {
                content,
                expected,
                generation,
            } => {
                validation::text(&content)?;
                self.generation(generation.as_deref())?;
                let old = self.get::<Scratchpad>("global")?;
                if expected
                    .is_some_and(|v| v != old.as_ref().map(|s| s.content.as_str()).unwrap_or(""))
                {
                    return Err(StorageError::conflict());
                }
                let meta = if let Some(mut old) = old {
                    self.touch(&mut old.meta);
                    old.meta
                } else {
                    let now = self.now();
                    Meta {
                        id: "global".into(),
                        created_at: now.clone(),
                        updated_at: now,
                        revision: 1,
                    }
                };
                self.put(&Scratchpad { meta, content })?;
                Ok(Value::Null)
            }
            Command::SaveSettings { patch } => {
                let mut settings = self.get::<Settings>("app")?.unwrap_or_default();
                if let Some(v) = patch.calendar_show_projects {
                    settings.calendar_show_projects = v;
                }
                if let Some(v) = patch.calendar_show_top_level_tasks {
                    settings.calendar_show_top_level_tasks = v;
                }
                if let Some(v) = patch.calendar_show_project_tasks {
                    settings.calendar_show_project_tasks = v;
                }
                if let Some(v) = patch.calendar_mode {
                    settings.calendar_mode = v;
                }
                self.put(&settings)?;
                Ok(Value::Null)
            }
        }
    }
    fn save_column(
        &self,
        board_id: &str,
        mut input: ColumnInput,
        id: Option<&str>,
    ) -> Result<Column> {
        self.require::<Board>(board_id)?;
        input.name = validation::title(&input.name)?;
        let cols = self.columns(board_id)?;
        let old = id.and_then(|id| cols.iter().find(|c| c.meta.id == id));
        if id.is_some() && old.is_none() {
            return Err(StorageError::invalid("Column not found"));
        }
        if cols.iter().any(|c| {
            Some(c.meta.id.as_str()) != id
                && c.input.name.to_lowercase() == input.name.to_lowercase()
        }) {
            return Err(StorageError::invalid(
                "A column with this name already exists",
            ));
        }
        input.is_default_new_item_column = cols.is_empty() || input.is_default_new_item_column;
        if old.is_some_and(|c| c.input.is_default_new_item_column)
            && !input.is_default_new_item_column
            && !cols
                .iter()
                .any(|c| Some(c.meta.id.as_str()) != id && c.input.is_default_new_item_column)
        {
            return Err(StorageError::invalid("Choose another default column first"));
        }
        let meta = if let Some(old) = old {
            let mut meta = old.meta.clone();
            self.touch(&mut meta);
            meta
        } else {
            self.meta()
        };
        let order_key = if let Some(old) = old {
            old.order_key.clone()
        } else {
            between(cols.last().map(|c| c.order_key.as_str()), None)?
        };
        for mut col in cols {
            if Some(col.meta.id.as_str()) != id
                && ((input.is_default_new_item_column && col.input.is_default_new_item_column)
                    || (input.completes_item_on_entry && col.input.completes_item_on_entry))
            {
                self.touch(&mut col.meta);
                if input.is_default_new_item_column {
                    col.input.is_default_new_item_column = false;
                }
                if input.completes_item_on_entry {
                    col.input.completes_item_on_entry = false;
                }
                self.put(&col)?;
            }
        }
        let col = Column {
            meta,
            board_id: board_id.into(),
            input,
            order_key,
        };
        self.put(&col)?;
        Ok(col)
    }
    fn create_item(
        &self,
        board_id: &str,
        title: &str,
        kind: ItemKind,
        column_id: Option<&str>,
    ) -> Result<Item> {
        let board: Board = self.require(board_id)?;
        if kind == ItemKind::Project && board.kind != BoardKind::Root {
            return Err(StorageError::invalid(
                "Projects can only be created on Dashboard",
            ));
        }
        let cols = self.columns(board_id)?;
        let col = cols
            .iter()
            .find(|c| {
                if let Some(id) = column_id {
                    c.meta.id == id
                } else {
                    c.input.is_default_new_item_column
                }
            })
            .ok_or_else(|| StorageError::invalid("Create a column first"))?;
        let siblings: Vec<Item> =
            self.list("WHERE column_id=?1 ORDER BY order_key", [&col.meta.id])?;
        let color = if kind == ItemKind::Project {
            Some(Color::Violet)
        } else {
            None
        };
        let item = Item {
            meta: self.meta(),
            kind,
            board_id: board_id.into(),
            column_id: col.meta.id.clone(),
            parent_project_id: board.project_id,
            title: validation::title(title)?,
            description: String::new(),
            priority: Priority::Medium,
            planned_start_date: None,
            due_date: None,
            first_started_at: None,
            completed_at: None,
            archive_after: None,
            archived_at: None,
            order_key: between(siblings.last().map(|i| i.order_key.as_str()), None)?,
            project_color_token: color,
        };
        self.put(&item)?;
        self.event(&item, EventKind::Created, None)?;
        if item.kind == ItemKind::Project {
            let board = Board {
                meta: self.meta(),
                kind: BoardKind::Project,
                project_id: Some(item.meta.id.clone()),
                name: item.title.clone(),
            };
            self.put(&board)?;
            for name in ["todo", "in-progress", "completed"] {
                self.save_column(
                    &board.meta.id,
                    ColumnInput {
                        name: name.into(),
                        is_default_new_item_column: name == "todo",
                        starts_work_on_first_entry: name == "in-progress",
                        completes_item_on_entry: name == "completed",
                    },
                    None,
                )?;
            }
        }
        Ok(item)
    }
    fn move_item(
        &self,
        id: &str,
        column_id: &str,
        before_id: Option<&str>,
        confirmed: bool,
    ) -> Result<Item> {
        let old: Item = self.require(id)?;
        let col: Column = self.require(column_id)?;
        if old.board_id != col.board_id {
            return Err(StorageError::invalid("Invalid destination"));
        }
        if old.kind == ItemKind::Project
            && col.input.completes_item_on_entry
            && old.completed_at.is_none()
            && !confirmed
            && self.children(id)?.iter().any(|i| i.completed_at.is_none())
        {
            return Err(StorageError::invalid(
                "Confirm completion: child tasks remain incomplete",
            ));
        }
        let siblings: Vec<Item> = self.list(
            "WHERE column_id=?1 AND id<>?2 ORDER BY order_key",
            [column_id, id],
        )?;
        let i = position(&siblings, before_id, |i| &i.meta.id)?;
        let changed = old.column_id != column_id;
        let mut item = if changed {
            self.transition(&old, &col)
        } else {
            let mut next = old.clone();
            self.touch(&mut next.meta);
            next
        };
        item.order_key = between(
            i.checked_sub(1).map(|i| siblings[i].order_key.as_str()),
            siblings.get(i).map(|i| i.order_key.as_str()),
        )?;
        self.put(&item)?;
        if changed {
            self.event(&item, EventKind::Moved, Some(old.column_id.clone()))?;
            if old.completed_at.is_none() && item.completed_at.is_some() {
                self.event(&item, EventKind::Completed, Some(old.column_id.clone()))?;
            }
            if old.completed_at.is_some() && item.completed_at.is_none() {
                self.event(&item, EventKind::Reopened, Some(old.column_id))?;
            }
        }
        Ok(item)
    }
    fn transition(&self, old: &Item, col: &Column) -> Item {
        let mut item = old.clone();
        self.touch(&mut item.meta);
        item.column_id = col.meta.id.clone();
        if item.first_started_at.is_none() && col.input.starts_work_on_first_entry {
            item.first_started_at = Some(self.now());
        }
        item.completed_at = if col.input.completes_item_on_entry {
            old.completed_at.clone().or_else(|| Some(self.now()))
        } else {
            None
        };
        item.archive_after = if col.input.completes_item_on_entry && old.parent_project_id.is_none()
        {
            old.archive_after
                .clone()
                .or_else(|| Some(self.archive_time()))
        } else {
            None
        };
        item
    }
    fn archive_time(&self) -> String {
        (self.runtime.now() + Duration::days(14))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }
    fn archive_item(&self, id: &str, confirmed: bool) -> Result<()> {
        let mut item: Item = self.require(id)?;
        if item.parent_project_id.is_some() {
            return Err(StorageError::invalid(
                "Only top-level items can be archived",
            ));
        }
        if item.completed_at.is_none() {
            confirm(confirmed, "Confirm archiving this incomplete item")?;
        }
        if item.archived_at.is_some() {
            return Ok(());
        }
        self.touch(&mut item.meta);
        item.archived_at = Some(self.now());
        self.put(&item)?;
        self.event(&item, EventKind::Archived, Some(item.column_id.clone()))
    }
}
fn confirm(confirmed: bool, message: &str) -> Result<()> {
    if confirmed {
        Ok(())
    } else {
        Err(StorageError::invalid(message))
    }
}
fn position<T>(items: &[T], before: Option<&str>, id: impl Fn(&T) -> &str) -> Result<usize> {
    if let Some(before) = before {
        items
            .iter()
            .position(|i| id(i) == before)
            .ok_or_else(|| StorageError::invalid("Invalid ordering destination"))
    } else {
        Ok(items.len())
    }
}
