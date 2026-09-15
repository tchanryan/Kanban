import {
  closestCorners,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';
export const boardCollision: CollisionDetection = (args) => {
  const columnDrag = args.active.data.current?.type === 'column';
  const droppableContainers = args.droppableContainers.filter(
    (container) =>
      container.id !== args.active.id &&
      (!columnDrag || container.data.current?.type === 'column'),
  );
  const candidates = { ...args, droppableContainers };
  if (columnDrag) return closestCorners(candidates);
  if (args.pointerCoordinates) {
    const hits = pointerWithin(candidates);
    const cardHits = hits.filter(
      (hit) =>
        droppableContainers.find((c) => c.id === hit.id)?.data.current?.type ===
        'item',
    );
    return cardHits.length ? cardHits : hits;
  }
  return closestCorners(candidates);
};
