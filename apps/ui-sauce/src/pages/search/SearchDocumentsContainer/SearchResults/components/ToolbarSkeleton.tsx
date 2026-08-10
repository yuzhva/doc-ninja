import React from 'react';

// Placeholder chrome for the results pane, in two tempos:
//
//   loading — pulsing. Used while a search is actually in flight, where the
//             motion is a promise that real content is seconds away.
//   ghost   — still and dimmed. Used before anything has been searched for: it
//             shows the shape the pane will take without promising anything is
//             on its way, because what it's waiting for is the user. A pulse
//             here would have people sitting and waiting for themselves.
//
// Both tempos share one component so that distinction stays a single line and
// the geometry can't drift between the two states.
type SkeletonVariant = 'loading' | 'ghost';

const VARIANT_TEMPO: Record<SkeletonVariant, string> = {
  loading: 'motion-safe:animate-pulse',
  ghost: 'opacity-60',
};

// `onTint` is for bars sitting on the group header or the table head, which are
// themselves gray-700 in dark mode — the default bar would be the same colour
// as its own background there and vanish.
const Bar = ({
  className,
  tone = 'default',
}: {
  className: string;
  tone?: 'default' | 'onTint';
}) => (
  <div
    className={`rounded ${
      tone === 'onTint'
        ? 'bg-gray-300 dark:bg-gray-600'
        : 'bg-gray-200 dark:bg-gray-700'
    } ${className}`}
  />
);

// The real controls are `text-sm` with `py-2` inside a 1px border, which lands
// on 38px. Matching it is what keeps the toolbars from changing height when the
// real ones take over.
const CONTROL_HEIGHT = 'h-[38px]';

// Mirrors the two toolbar rows: filter field and row-cap stepper on the left,
// export actions pushed right, then the filter row on its tinted strip.
const ToolbarSkeleton = ({ tempo }: { tempo: SkeletonVariant }) => (
  <div aria-hidden="true" className={VARIANT_TEMPO[tempo || 'ghost']}>
    <div className="flex flex-wrap items-center gap-2 p-4 h-18">
      <Bar className={`w-full sm:w-64 md:w-72 ${CONTROL_HEIGHT}`} />
      <Bar className={`w-32 ${CONTROL_HEIGHT}`} />
      <div className="flex-grow" />
      <Bar className={`w-44 ${CONTROL_HEIGHT}`} />
      <Bar className={`w-38 ${CONTROL_HEIGHT}`} />
    </div>

    <hr className="h-px bg-gray-200 border-0 dark:bg-gray-700" />

    <div className="flex flex-wrap items-center gap-2 p-2 px-4 bg-gray-50/50 dark:bg-gray-700/20">
      {/*
      <Bar className={`w-28 ${CONTROL_HEIGHT}`} />
      <Bar className={`w-24 ${CONTROL_HEIGHT}`} />
      */}
      <div className="flex-grow" />
      <Bar className={`w-26 ${CONTROL_HEIGHT}`} />
    </div>
  </div>
);

export { ToolbarSkeleton };
