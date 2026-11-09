import React from 'react';
import { createPortal } from 'react-dom';

import { visibleBoundsOf } from '../../../../../components';
import type { RichProcessedResultItem } from '../../../search-page.types';
import {
  DocmTemplateRemovalConfirm,
  DocmTemplatesPanel,
} from './DocmTemplatesPanel';
import type { DocmTemplatesPanelProps } from './DocmTemplatesPanel';
import type { DocmTemplate } from './docm-templates-store';

// Between the menu and the button it opened from
const GAP_PX = 8;
// The tallest the menu gets (Tailwind's max-h-96), scrolling past that
const MAX_HEIGHT_PX = 384;

interface MatchDocmMenuHandle {
  // Opens the menu at `anchor` for `match` — or closes it, when it's already
  // open there
  toggle: (anchor: HTMLElement, match: RichProcessedResultItem) => void;
}

interface MenuTarget {
  anchor: HTMLElement;
  match: RichProcessedResultItem;
}

// Right-aligned with the button, above it as a row's menu always opened —
// unless there's more room below. Measured against the part of the page the
// button can be seen in (its scrolling list), so the menu never opens
// towards a toolbar or the navigation bar when the other side has more room.
const placeMenu = (
  anchor: HTMLElement,
  menuHeight: number,
): React.CSSProperties => {
  const bounds = visibleBoundsOf(anchor);
  const anchorBox = anchor.getBoundingClientRect();
  const roomAbove = anchorBox.top - bounds.top - GAP_PX;
  const roomBelow = bounds.bottom - anchorBox.bottom - GAP_PX;
  const isAbove = menuHeight <= roomAbove || roomAbove >= roomBelow;
  const right = document.documentElement.clientWidth - anchorBox.right;

  return isAbove
    ? {
        right,
        bottom: window.innerHeight - anchorBox.top + GAP_PX,
        maxHeight: Math.min(MAX_HEIGHT_PX, Math.max(roomAbove, 0)),
      }
    : {
        right,
        top: anchorBox.bottom + GAP_PX,
        maxHeight: Math.min(MAX_HEIGHT_PX, Math.max(roomBelow, 0)),
      };
};

/**
 * The .docm menu for a single match — one for the whole page, opened by any
 * match's own button (see ProcessedResultRow), instead of a menu mounted
 * under every match. Which match it's open for is kept here, so opening and
 * closing it renders this menu alone, never the rows.
 *
 * It's laid over the page (portaled into <body>), so no table's scrolling
 * box cuts it off. It closes on a click elsewhere, Escape, a scroll of the
 * page under it or a resize — anything that would leave it pointing at the
 * wrong place.
 */
const MatchDocmMenu = ({
  ref,
  templateTagFieldIds,
  primaryFieldId,
  onGenerate,
  addToast,
}: Pick<
  DocmTemplatesPanelProps,
  'templateTagFieldIds' | 'primaryFieldId' | 'onGenerate' | 'addToast'
> & {
  ref: React.Ref<MatchDocmMenuHandle>;
}) => {
  const [target, setTarget] = React.useState<MenuTarget | null>(null);
  // Where it sits, once measured: hidden until then
  const [placement, setPlacement] = React.useState<React.CSSProperties | null>(
    null,
  );
  const [isGeneratingSeparateFiles, setIsGeneratingSeparateFiles] =
    React.useState(false);
  const [templatePendingRemoval, setTemplatePendingRemoval] =
    React.useState<DocmTemplate | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => {
    setTarget(null);
    setPlacement(null);
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      toggle: (anchor, match) => {
        setPlacement(null);
        setTarget((current) =>
          current?.anchor === anchor ? null : { anchor, match },
        );
      },
    }),
    [],
  );

  // Placed once it's rendered, before it's painted: where it goes depends on
  // its own height
  React.useLayoutEffect(() => {
    if (!target || !menuRef.current) return;
    setPlacement(
      placeMenu(target.anchor, menuRef.current.getBoundingClientRect().height),
    );
  }, [target]);

  React.useEffect(() => {
    if (!target) return;
    const { anchor } = target;
    const isInMenu = (node: EventTarget | null) =>
      node instanceof Node && !!menuRef.current?.contains(node);

    // The button that opened it toggles it itself
    const handleMouseDown = (event: MouseEvent) => {
      if (!isInMenu(event.target) && !anchor.contains(event.target as Node)) {
        close();
      }
    };
    // The menu's own list may scroll; anything else moving takes the button
    // away from under it
    const handleScroll = (event: Event) => {
      if (!isInMenu(event.target)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    // Tells assistive tech, and the row's hover-only buttons (which stay
    // shown while it's set), that this button's menu is open
    anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    return () => {
      anchor.removeAttribute('aria-expanded');
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [target, close]);

  return (
    <>
      {target &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            style={placement ?? { visibility: 'hidden' }}
            className="fixed z-30 w-80 p-3 rounded-lg border border-gray-200 shadow-lg max-h-96 overflow-y-auto overflow-x-hidden bg-white dark:border-gray-600 dark:bg-gray-800"
          >
            <DocmTemplatesPanel
              items={[target.match]}
              templateTagFieldIds={templateTagFieldIds}
              primaryFieldId={primaryFieldId}
              onGenerate={onGenerate}
              addToast={addToast}
              isGeneratingSeparateFiles={isGeneratingSeparateFiles}
              onGeneratingSeparateFilesChange={setIsGeneratingSeparateFiles}
              onTemplateRemovalRequest={setTemplatePendingRemoval}
            />
          </div>,
          document.body,
        )}

      {/* Outside the menu: clicking the modal closes the menu, and that must
          not take the modal down with it. */}
      <DocmTemplateRemovalConfirm
        template={templatePendingRemoval}
        onClose={() => setTemplatePendingRemoval(null)}
      />
    </>
  );
};

export { MatchDocmMenu };
export type { MatchDocmMenuHandle };
