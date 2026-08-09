import React from 'react';
import { useTranslation } from 'react-i18next';

const I18N_NS = 'component.sortableList';

interface SortableItemRenderArgs {
  // The grip the user presses to start a drag. Place it wherever the row's
  // own layout wants it — the list owns its behaviour and appearance, the
  // caller only decides where it sits.
  dragHandle: React.ReactNode;
  isDragging: boolean;
}

interface SortableListProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => React.Key;
  // Receives the whole reordered array, so callers can hand it straight to
  // whatever already commits their list (state + storage + JSON mirror).
  onReorder: (nextItems: T[]) => void;
  renderItem: (item: T, args: SortableItemRenderArgs) => React.ReactNode;
  // On the container that holds the rows.
  className?: string;
  // On each row's wrapper — this replaces the element the caller used to
  // render itself, so there's no extra nesting level.
  itemClassName?: string;
}

const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

// Reordering built on the native HTML5 drag-and-drop API rather than a
// library: it needs no dependency and works in every desktop browser. Its one
// gap is touch, where those events are never fired at all — hence the arrow-key
// support on the handle, which doubles as keyboard accessibility.
//
// Dragging is armed from the handle only (`draggable` is switched on for the
// row the handle belongs to) so that text selection inside the row's inputs
// keeps working normally.
const SortableList = <T,>({
  items,
  getItemKey,
  onReorder,
  renderItem,
  className = '',
  itemClassName = '',
}: SortableListProps<T>) => {
  const { t } = useTranslation();
  const [grabbedIndex, setGrabbedIndex] = React.useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);

  // A mouseup that lands anywhere other than the handle never reaches its own
  // handler, which would leave the row draggable by any of its parts.
  React.useEffect(() => {
    if (grabbedIndex === null) return;

    const release = () => setGrabbedIndex(null);
    document.addEventListener('mouseup', release);
    return () => document.removeEventListener('mouseup', release);
  }, [grabbedIndex]);

  const resetDragState = () => {
    setGrabbedIndex(null);
    setDraggingIndex(null);
    setDropIndex(null);
  };

  const moveTo = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= items.length || toIndex === fromIndex) return;
    onReorder(moveItem(items, fromIndex, toIndex));
  };

  const renderDragHandle = (index: number) => (
    <span
      role="button"
      tabIndex={0}
      aria-label={t(`${I18N_NS}.dragHandleTitle`)}
      title={t(`${I18N_NS}.dragHandleTitle`)}
      onMouseDown={() => setGrabbedIndex(index)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        // The row keeps its React key, so the browser moves the focused
        // handle along with it and further arrow presses keep working.
        event.preventDefault();
        moveTo(index, index + (event.key === 'ArrowUp' ? -1 : 1));
      }}
      className="flex shrink-0 items-center justify-center w-5 h-9 rounded text-gray-400 cursor-grab active:cursor-grabbing hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <svg
        className="w-4 h-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7-12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
      </svg>
    </span>
  );

  return (
    <div className={className}>
      {items.map((item, index) => {
        const isDragging = draggingIndex === index;
        const isDropTarget =
          draggingIndex !== null && dropIndex === index && !isDragging;

        return (
          <div
            key={getItemKey(item, index)}
            draggable={grabbedIndex === index}
            onDragStart={(event) => {
              setDraggingIndex(index);
              event.dataTransfer.effectAllowed = 'move';
              // Firefox refuses to start a drag at all unless the transfer
              // carries some data.
              event.dataTransfer.setData('text/plain', String(index));
            }}
            onDragEnd={resetDragState}
            onDragOver={(event) => {
              if (draggingIndex === null) return;
              // Without preventDefault the browser treats this row as an
              // invalid drop target and never fires onDrop.
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (dropIndex !== index) setDropIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (draggingIndex !== null) moveTo(draggingIndex, index);
              resetDragState();
            }}
            className={`${itemClassName} transition-opacity ${
              isDragging ? 'opacity-40' : ''
            } ${isDropTarget ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''}`}
          >
            {renderItem(item, {
              dragHandle: renderDragHandle(index),
              isDragging,
            })}
          </div>
        );
      })}
    </div>
  );
};

export { SortableList };
export type { SortableItemRenderArgs };
