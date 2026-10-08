use super::BackupEntry;
use chrono::{DateTime, Datelike, Utc};
use std::collections::HashSet;

pub struct RetentionPolicy {
    rolling: usize,
    daily: usize,
    weekly: usize,
}
impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            rolling: 12,
            daily: 7,
            weekly: 4,
        }
    }
}
impl RetentionPolicy {
    /// A snapshot can satisfy multiple buckets. UTC dates make retention deterministic.
    pub fn keep(&self, entries: &[BackupEntry]) -> HashSet<String> {
        let mut ordered: Vec<_> = entries.iter().collect();
        ordered.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        let mut keep = HashSet::new();
        let mut days = HashSet::new();
        let mut weeks = HashSet::new();
        for (index, entry) in ordered.into_iter().enumerate() {
            let Ok(time) = entry.created_at.parse::<DateTime<Utc>>() else {
                continue;
            };
            let day = time.date_naive();
            let week = time.iso_week();
            let daily = days.len() < self.daily && days.insert(day);
            let weekly = weeks.len() < self.weekly && weeks.insert((week.year(), week.week()));
            if index < self.rolling || daily || weekly {
                keep.insert(entry.id.clone());
            }
        }
        keep
    }
}
