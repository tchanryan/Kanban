use crate::{contracts::Query, model::*, sqlite::Context};
use serde_json::{json, Value};
use std::collections::HashSet;

impl Context<'_> {
    pub fn query(&self, query: Query) -> Result<Value> {
        Ok(match query {
            Query::Root => json!(self
                .list::<Board>("WHERE kind='root'", [])?
                .into_iter()
                .next()),
            Query::Board { id } => json!(self.get::<Board>(&id)?),
            Query::ProjectBoard { id } => json!(self
                .list::<Board>("WHERE project_id=?1", [id])?
                .into_iter()
                .next()),
            Query::Item { id } => json!(self.get::<Item>(&id)?),
            Query::EditorItem { id } => {
                json!({"item":self.get::<Item>(&id)?,"generation":self.version()?.generation})
            }
            Query::EditorScratch => {
                json!({"scratch":self.get::<Scratchpad>("global")?,"generation":self.version()?.generation})
            }
            Query::Columns { board_id } => json!(self.columns(&board_id)?),
            Query::Items { board_id } => json!(self.list::<Item>(
                "WHERE board_id=?1 AND archived_at IS NULL ORDER BY order_key",
                [board_id]
            )?),
            Query::Children { id } => json!(self.children(&id)?),
            Query::Tags => json!(self.list::<Tag>(
                "ORDER BY json_extract(data,'$.name') COLLATE JS_TEXT,id",
                []
            )?),
            Query::ItemTags { id } => {
                json!(self.relations("WHERE item_id=?1 ORDER BY tag_id", [id])?)
            }
            Query::BoardTagRelations { board_id } => json!(self.relations(
                "WHERE item_id IN(SELECT id FROM items WHERE board_id=?1) ORDER BY item_id,tag_id",
                [board_id]
            )?),
            Query::History { id } => {
                json!(self.list::<ItemEvent>("WHERE item_id=?1 ORDER BY occurred_at,id", [id])?)
            }
            Query::Scratch => json!(self.get::<Scratchpad>("global")?),
            Query::Settings => json!(self.get::<Settings>("app")?.unwrap_or_default()),
            Query::CalendarItems {
                include_standalone_tasks,
            } => {
                let items = if include_standalone_tasks {
                    self.list::<Item>("ORDER BY id", [])?
                } else {
                    let mut projects = self.list::<Item>("WHERE kind='project' ORDER BY id", [])?;
                    projects.extend(self.list::<Item>("WHERE parent_id IN(SELECT id FROM items WHERE kind='project') ORDER BY parent_id,id",[])?);
                    projects
                };
                json!(items)
            }
            Query::Search { query, archived } => json!(self.search(&query, archived)?),
            Query::ArchivePage {
                query,
                cursor,
                limit,
            } => json!(self.archive_page(&query, cursor, limit)?),
            Query::Counts => {
                let mut values = serde_json::Map::new();
                for table in ["items", "boards", "events", "tags"] {
                    let count: i64 =
                        self.db
                            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| {
                                r.get(0)
                            })?;
                    values.insert(table.into(), json!(count));
                }
                Value::Object(values)
            }
        })
    }
    fn relations(&self, clause: &str, params: impl rusqlite::Params) -> Result<Vec<Relation>> {
        let mut statement = self
            .db
            .prepare(&format!("SELECT item_id,tag_id FROM relations {clause}"))?;
        let rows = statement.query_map(params, |r| {
            Ok(Relation {
                item_id: r.get(0)?,
                tag_id: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    fn search(&self, query: &str, archived: bool) -> Result<Vec<Item>> {
        let query = crate::validation::trim(query).to_lowercase();
        if query.is_empty() {
            return Ok(vec![]);
        }
        let tags: HashSet<String> = self
            .list::<Tag>("", [])?
            .into_iter()
            .filter(|t| t.name.to_lowercase().contains(&query))
            .map(|t| t.meta.id)
            .collect();
        let related: HashSet<String> = self
            .relations("", [])?
            .into_iter()
            .filter(|r| tags.contains(&r.tag_id))
            .map(|r| r.item_id)
            .collect();
        let hidden: HashSet<String> = self
            .list::<Item>("WHERE kind='project' AND archived_at IS NOT NULL", [])?
            .into_iter()
            .map(|i| i.meta.id)
            .collect();
        let mut statement = self.db.prepare("SELECT data FROM items ORDER BY id")?;
        let rows = statement.query_map([], |r| r.get::<_, String>(0))?;
        let mut result = vec![];
        for row in rows {
            let item: Item = crate::sqlite::decode(&row?)?;
            if (archived
                || (item.archived_at.is_none()
                    && !item
                        .parent_project_id
                        .as_ref()
                        .is_some_and(|id| hidden.contains(id))))
                && (item.title.to_lowercase().contains(&query)
                    || item.description.to_lowercase().contains(&query)
                    || related.contains(&item.meta.id))
            {
                result.push(item);
                if result.len() == 100 {
                    break;
                }
            }
        }
        Ok(result)
    }
    fn archive_page(
        &self,
        query: &str,
        cursor: Option<ArchiveCursor>,
        limit: u32,
    ) -> Result<ArchivePage> {
        let limit = limit.clamp(1, 200) as usize;
        let query = crate::validation::trim(query).to_lowercase();
        let mut statement=self.db.prepare("SELECT data FROM items WHERE archived_at IS NOT NULL AND (?1 IS NULL OR (archive_sort,id)<(?1,?2)) ORDER BY archive_sort DESC,id DESC")?;
        let rows = statement.query_map(
            rusqlite::params![
                cursor.as_ref().map(|c| &c.date),
                cursor.as_ref().map(|c| &c.id)
            ],
            |r| r.get::<_, String>(0),
        )?;
        let mut items = vec![];
        for row in rows {
            let item: Item = crate::sqlite::decode(&row?)?;
            if item.title.to_lowercase().contains(&query) {
                items.push(item);
                if items.len() > limit {
                    break;
                }
            }
        }
        let more = items.len() > limit;
        items.truncate(limit);
        let next_cursor = if more {
            items.last().map(|i| ArchiveCursor {
                date: i
                    .completed_at
                    .clone()
                    .or_else(|| i.archived_at.clone())
                    .unwrap(),
                id: i.meta.id.clone(),
            })
        } else {
            None
        };
        Ok(ArchivePage { items, next_cursor })
    }
}
