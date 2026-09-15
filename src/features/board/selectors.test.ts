import { describe, expect, it } from 'vitest';
import type { Item, Tag } from '../../domain/model';
import {
  filterBoardItems,
  indexItemTags,
  type BoardFilters,
} from './selectors';

const filters: BoardFilters = { priority: '', kind: '', due: '', tag: '' };
const task: Item = {
  id: 'task',
  boardId: 'board',
  columnId: 'column',
  kind: 'task',
  title: 'Task',
  description: '',
  priority: 'high',
  parentProjectId: null,
  plannedStartDate: null,
  dueDate: '2026-09-15',
  firstStartedAt: null,
  completedAt: null,
  archiveAfter: null,
  archivedAt: null,
  orderKey: 'a0',
  projectColorToken: null,
  createdAt: '',
  updatedAt: '',
  revision: 1,
};
const tag: Tag = {
  id: 'tag',
  name: 'Shared',
  colorToken: 'teal',
  createdAt: '',
  updatedAt: '',
  revision: 1,
};

describe('board filtering', () => {
  it('combines tag, kind, priority and date filters without changing source order', () => {
    const items = [
      task,
      { ...task, id: 'low', priority: 'low' as const },
      { ...task, id: 'other' },
    ];
    const tags = indexItemTags(
      [tag],
      [
        { itemId: task.id, tagId: tag.id },
        { itemId: 'low', tagId: tag.id },
      ],
    );
    expect(
      filterBoardItems(
        items,
        { priority: 'high', kind: 'task', due: 'soon', tag: tag.id },
        tags,
        '2026-09-15',
      ),
    ).toEqual([task]);
    expect(filterBoardItems(items, filters, tags, '2026-09-15')).toEqual(items);
  });

  it('includes today and two days ahead, excluding completed and undated tasks', () => {
    const items = [
      task,
      { ...task, id: 'last', dueDate: '2026-09-17' },
      { ...task, id: 'later', dueDate: '2026-09-18' },
      { ...task, id: 'done', completedAt: '2026-09-15T00:00:00Z' },
      { ...task, id: 'undated', dueDate: null },
    ];
    expect(
      filterBoardItems(
        items,
        { ...filters, due: 'soon' },
        {},
        '2026-09-15',
      ).map((item) => item.id),
    ).toEqual(['task', 'last']);
    expect(
      filterBoardItems(
        items,
        { ...filters, due: 'overdue' },
        {},
        '2026-09-16',
      ).map((item) => item.id),
    ).toEqual(['task']);
  });

  it('handles due-soon dates across year boundaries', () => {
    const item = { ...task, dueDate: '2027-01-01' };
    expect(
      filterBoardItems([item], { ...filters, due: 'soon' }, {}, '2026-12-30'),
    ).toEqual([item]);
  });

  it('reflects removed associations and ignores tags missing from the catalogue', () => {
    const relations = [{ itemId: task.id, tagId: tag.id }];
    expect(
      filterBoardItems(
        [task],
        { ...filters, tag: tag.id },
        indexItemTags([tag], relations),
        '2026-09-15',
      ),
    ).toEqual([task]);
    expect(
      filterBoardItems(
        [task],
        { ...filters, tag: tag.id },
        indexItemTags([tag], []),
        '2026-09-15',
      ),
    ).toEqual([]);
    expect(indexItemTags([], relations)).toEqual({});
  });
});
