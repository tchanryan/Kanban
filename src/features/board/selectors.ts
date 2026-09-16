import {
  addLocalDays,
  overdue,
  type Item,
  type Relation,
  type Tag,
} from '../../domain/model';

export interface BoardFilters {
  priority: string;
  kind: string;
  due: string;
  tag: string;
}

export function groupItemsByColumn(items: Item[]): Record<string, Item[]> {
  const columns: Record<string, Item[]> = {};
  for (const item of items) (columns[item.columnId] ||= []).push(item);
  return columns;
}

export function indexItemTags(
  tags: Tag[],
  relations: Relation[],
): Record<string, Tag[]> {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const itemTags: Record<string, Tag[]> = {};
  for (const relation of relations) {
    const tag = tagsById.get(relation.tagId);
    if (tag) (itemTags[relation.itemId] ||= []).push(tag);
  }
  return itemTags;
}

export function filterBoardItems(
  items: Item[],
  filters: BoardFilters,
  itemTags: Record<string, Tag[]>,
  today: string,
): Item[] {
  const dueSoonEnd = addLocalDays(today, 2);
  return items.filter((item) => {
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.kind && item.kind !== filters.kind) return false;
    if (
      filters.tag &&
      !itemTags[item.id]?.some((tag) => tag.id === filters.tag)
    )
      return false;
    if (filters.due === 'overdue') return overdue(item, today);
    if (filters.due === 'soon')
      return (
        !!item.dueDate &&
        !item.completedAt &&
        item.dueDate >= today &&
        item.dueDate <= dueSoonEnd
      );
    return true;
  });
}
