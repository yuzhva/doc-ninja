import React from 'react';

// The glyph in the bottom-right corner, reporting what state the pane is in:
// 🔍 while a search is still possible or under way, ⚠️ once one has come back
// with nothing. Kept as a native emoji rather than another hand-drawn glyph —
// it's the one part of the drawing whose *meaning* changes with the pane
// state, and emoji render in full color regardless of the SVG's fill/stroke
// classes, so it doesn't need a light/dark variant of its own.
const ICON_BY_VARIANT = {
  search: '🔍',
  notFound: '⚠️',
} as const;

type IconVariant = keyof typeof ICON_BY_VARIANT;

// Empty-state art for the results pane: a scan line runs down a stack of
// documents and highlights the lines it matches, on a 4.8s loop.
//
// The reveal times are derived from the sweep rather than eyeballed — the
// line is animated `linear` precisely so its position is a known function of
// time, which is what lets a match light up exactly as the line crosses it
// (see the keyframe comment below for the formula).
//
// Everything is primitives on an exact grid: one corner radius per role, a
// constant 5-unit step across the paper stack. Shapes carry explicit
// light/dark fills instead of inheriting `currentColor`, because the sheets
// overlap — a translucent stack would show through itself.
const SearchPlaceholderIllustration = ({
  className = '',
  isAnimationInProgress = false,
  icon = 'search',
}: {
  className?: string;
  // Off by default: the sweep is a "something is happening right now" signal,
  // so it only runs when a caller can vouch that's actually true — never as an
  // idle loop nobody asked for. Gated with a class rather than toggling
  // `animation` inline so prefers-reduced-motion (below) keeps the final say
  // even when this is true.
  isAnimationInProgress?: boolean;
  icon?: IconVariant;
}) => {
  // Referenced by id, which has to stay unique even if this ever renders more
  // than once on a page.
  const sheetClipId = `${React.useId()}-sheet`;

  // Blue reads as "found something" — reserved for when the sweep is actually
  // running. At rest the three lines it would highlight are just grey, the
  // same as every other line on the page, so nothing looks found until a scan
  // says otherwise.
  const matchHighlightClass = isAnimationInProgress
    ? 'fill-blue-500/15 dark:fill-blue-400/15'
    : 'fill-transparent';
  const matchLineClass = isAnimationInProgress
    ? 'fill-blue-500 dark:fill-blue-400'
    : 'fill-gray-200 dark:fill-gray-700';

  return (
    // Tight around the drawing (documents + magnifier, x 15..110 / y 11..124)
    // plus a small margin for stroke bleed — so the rendered <svg> box is the
    // artwork, not a leftover frame sized for content that isn't drawn here
    // anymore.
    <svg
      viewBox="15 10 90 125"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`${isAnimationInProgress ? 'dn-placeholder-animate' : ''} ${className}`.trim()}
    >
      <style>{`
        /* The sweep crosses the three matched lines at 28%, 45% and 63% of the
           cycle: it runs linearly from y=22 to y=122 between 8% and 80%, so a
           line at y hits at 8 + 72*(y-22)/100. */
        @keyframes dn-placeholder-scan {
          0%       { transform: translateY(22px); opacity: 0; }
          8%       { opacity: 1; }
          80%      { transform: translateY(122px); opacity: 1; }
          88%,100% { transform: translateY(122px); opacity: 0; }
        }
        @keyframes dn-placeholder-match-1 {
          0%,28%  { opacity: 0; }
          33%,90% { opacity: 1; }
          100%    { opacity: 0; }
        }
        @keyframes dn-placeholder-match-2 {
          0%,45%  { opacity: 0; }
          50%,90% { opacity: 1; }
          100%    { opacity: 0; }
        }
        @keyframes dn-placeholder-match-3 {
          0%,63%  { opacity: 0; }
          68%,90% { opacity: 1; }
          100%    { opacity: 0; }
        }
        /* Resting look: what shows whenever isAnimationInProgress is false, and
           the shape prefers-reduced-motion always forces regardless of the prop
           — a finished picture (matches found, sweep gone), not a blank one. */
        .dn-placeholder-scan {
          opacity: 0;
        }
        .dn-placeholder-match-1,
        .dn-placeholder-match-2,
        .dn-placeholder-match-3 {
          opacity: 1;
        }

        /* Only the .dn-placeholder-animate wrapper (set from
           isAnimationInProgress) turns any of this into motion. */
        .dn-placeholder-animate .dn-placeholder-scan {
          animation: dn-placeholder-scan 4.8s linear infinite;
        }
        .dn-placeholder-animate .dn-placeholder-match-1 {
          animation: dn-placeholder-match-1 4.8s linear infinite;
        }
        .dn-placeholder-animate .dn-placeholder-match-2 {
          animation: dn-placeholder-match-2 4.8s linear infinite;
        }
        .dn-placeholder-animate .dn-placeholder-match-3 {
          animation: dn-placeholder-match-3 4.8s linear infinite;
        }

        /* Wins over the prop too — asking for less motion shouldn't stop
           mattering just because a search happens to be running. Repeats the
           .dn-placeholder-animate selectors at matching specificity so this
           block's later position in the file is what makes it win the tie. */
        @media (prefers-reduced-motion: reduce) {
          .dn-placeholder-animate .dn-placeholder-scan,
          .dn-placeholder-scan {
            animation: none;
            opacity: 0;
          }
          .dn-placeholder-animate .dn-placeholder-match-1,
          .dn-placeholder-animate .dn-placeholder-match-2,
          .dn-placeholder-animate .dn-placeholder-match-3,
          .dn-placeholder-match-1,
          .dn-placeholder-match-2,
          .dn-placeholder-match-3 {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>

      <defs>
        <clipPath id={sheetClipId}>
          <rect x="16" y="22" width="74" height="100" rx="5" />
        </clipPath>
      </defs>

      {/* Sheets behind, stepped by a constant 5 units so the stack reads as
          depth rather than as a mistake */}
      <g
        className="fill-gray-100 stroke-gray-200 dark:fill-gray-700 dark:stroke-gray-600"
        strokeWidth="1.5"
      >
        <rect x="26" y="12" width="74" height="100" rx="5" />
        <rect x="21" y="17" width="74" height="100" rx="5" />
      </g>

      <rect
        x="16"
        y="22"
        width="74"
        height="100"
        rx="5"
        className="fill-white stroke-gray-200 dark:fill-gray-800 dark:stroke-gray-600"
        strokeWidth="1.5"
      />

      <g className="fill-gray-200 dark:fill-gray-700">
        <rect x="26" y="38" width="52" height="4" rx="2" />
        <rect x="26" y="50" width="44" height="4" rx="2" />
        <rect x="26" y="62" width="34" height="4" rx="2" />
        <rect x="26" y="74" width="48" height="4" rx="2" />
        <rect x="26" y="86" width="28" height="4" rx="2" />
        <rect x="26" y="98" width="40" height="4" rx="2" />
      </g>

      {/* The three lines the sweep finds */}
      <g className="dn-placeholder-match-1">
        <rect
          x="22"
          y="47"
          width="52"
          height="10"
          rx="5"
          className={matchHighlightClass}
        />
        <rect
          x="26"
          y="50"
          width="44"
          height="4"
          rx="2"
          className={matchLineClass}
        />
      </g>
      <g className="dn-placeholder-match-2">
        <rect
          x="22"
          y="71"
          width="56"
          height="10"
          rx="5"
          className={matchHighlightClass}
        />
        <rect
          x="26"
          y="74"
          width="48"
          height="4"
          rx="2"
          className={matchLineClass}
        />
      </g>
      <g className="dn-placeholder-match-3">
        <rect
          x="22"
          y="95"
          width="48"
          height="10"
          rx="5"
          className={matchHighlightClass}
        />
        <rect
          x="26"
          y="98"
          width="40"
          height="4"
          rx="2"
          className={matchLineClass}
        />
      </g>

      {/* Scan line, clipped to the sheet so it never spills past the paper */}
      <g clipPath={`url(#${sheetClipId})`}>
        <g className="dn-placeholder-scan">
          <rect
            x="16"
            y="-9"
            width="74"
            height="18"
            className="fill-blue-500/10 dark:fill-blue-400/10"
          />
          <rect
            x="16"
            y="-0.75"
            width="74"
            height="1.5"
            className="fill-blue-500 dark:fill-blue-400"
          />
        </g>
      </g>

      {/* Bottom-right status glyph — see ICON_BY_VARIANT for what each state
          means. Centered on roughly the same spot the old hand-drawn
          magnifier occupied, so swapping icon doesn't shift the composition. */}
      <text
        x="85"
        y="115"
        fontSize="30"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {ICON_BY_VARIANT[icon]}
      </text>
    </svg>
  );
};

export { SearchPlaceholderIllustration };
