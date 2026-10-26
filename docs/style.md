# Visual theme

Orcaboros uses a theme-aware frosted-glass design. Semantic `--color-*` tokens in [app.css](../src/styles/app.css) define dark and light themes; component styles should use those tokens rather than hard-coded theme colors.

## Surfaces

Glass levels are shared through `--glass-*` tokens and reusable classes:

| Level | Use | Surface opacity | Backdrop blur |
| --- | --- | --: | --: |
| 1 | Section or workspace background | 40% | 4px |
| 2 | Pane nested inside a section | 58% | 6px |
| 3 | Dense nested surface or control track | 74% | 8px |

Use `.glass-background glass-background--level-1` when the surface should retain the theme's background image. Use `.glass-pane glass-pane--level-N` for nested panes; the stronger surface and blur at each level compound to keep content legible. `.glass-pane--compact` uses the tighter radius for dense layouts. Prefer one section surface with 1px dividers over separate cards and gaps when columns belong to the same workspace.

The shared `--glass-border`, `--glass-divider`, radius, and blur tokens keep surfaces consistent. Use semantic diff, status, and accent tokens for meaningful color; avoid using color alone to communicate state.

Style library-generated surfaces, such as MapLibre popups and attribution controls, with the same theme-aware glass and text tokens. Use Level 3 for dense floating content and keep its controls visibly focusable.

## Scrollbars

Apply `.glass-scrollbar` to independently scrollable surfaces. Its track uses a Level 3 high-frost background, with shared theme tokens for the thumb and hover state. Keep the width and rounded treatment consistent for vertical and horizontal scrolling.

## Buttons and toggles

Native buttons use the primary glass treatment by default. Add `.glass-button` with one modifier for an explicit variant:

- `.glass-button--primary` for primary actions
- `.glass-button--secondary` for supporting actions
- `.glass-button--accent` for emphasized alternate actions
- `.glass-button--warning` for high-attention warning acknowledgements
- `.glass-button--success` and `.glass-button--danger` for outcome actions
- `.glass-button--quiet` for low-emphasis controls

Use `.glass-toggle` for switch buttons, `.glass-toggle-track` for the nested track, and `.glass-toggle-thumb` for its indicator. Switches must retain `role="switch"` and an up-to-date `aria-checked` value; visible text or labels should explain what is being changed.

## Layout and accessibility

Keep comparison content in semantic tables. Set vertical row spacing to zero, keep the table content-driven and top-aligned, and style the table cells as the equal-height row boxes. Preserve visible keyboard focus, respect reduced-motion preferences, and check contrast against both themes and the underlying image: normal text must meet WCAG 2.2 AA's 4.5:1 contrast ratio (3:1 for large text). Glass transparency is decorative and must not be the only means of conveying information.

Keep Comparison read-only, with only the focused feature's heading, status, diff legend, GTFS/OSM tag table, and a separate location-and-match metadata table below it. Keep coordinates and calculated match distance out of the tag table. The diff must retain its natural height without flex shrinking. Let the containing review detail pane scroll when its content exceeds the available height.

Below 1100px, use a vertically scrolling, single-column workspace rather than clipping the desktop frame. Hide pane resize handles in this layout and stack review columns. Map camera transitions must respect the user's reduced-motion preference; do not mark decorative camera movement as essential.

Link switching is initiated from the OSM feature popup and completed by choosing another map element. Keep the map legend informational; do not add a duplicate link picker there. Hide editing controls when `onAction` is omitted (for example, during loading), and cancel any active pointer relink.

Report WebGL initialization and MapLibre display errors using an accessible, URL-free message with a retry button. Keep the review queue usable when map rendering is unavailable; never display or log the original error, which may contain a custom basemap URL.

When changing the theme, verify dark and light appearances and run `bun run check`.
