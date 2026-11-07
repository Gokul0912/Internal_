# Product Log interface

An everyday internal workspace for reports and client relationships. Keep work visible and actions predictable.

## Tokens
- Ink #252C29; muted text #616963; workspace #F5F6F3; surface #FFFFFF; line #DFE4DD; action #315B46.
- Segoe UI Variable / Segoe UI for native, readable interface typography. Titles 32px, section headings 18px, body 15px (16px on small screens), supporting text 13px.
- Sidebar 248px; content max 1440px; desktop gutters 40px; mobile gutters 16px. Use 4/8px spacing increments.
- Radius: 8px controls, 12px panels, 16px dialogs. Shadows only for overlays.

## Structure
Left-aligned navigation rail with Reports, Clients, and project shortcuts. Quiet context bar above a compact page heading. Report status tabs sit beside list controls. Search and filters remain visible above results. Client directory shares the same layout and form system.

## Interaction
Use 44px minimum primary touch targets. Visible focus rings, native labels and dialogs, clear pressed states. Drawer movement 240ms; dialogs 180ms; feedback 120ms. Honor reduced motion. Never animate every row or introduce permanent moving decoration.

Motion tokens live on the workspace shell: fast 120ms, standard 180ms, drawer 240ms, ease-out cubic-bezier(.2,.8,.2,1). Native dialog display/overlay transitions preserve focus and dismissal behavior; unsupported browsers dismiss immediately. Result changes animate a single surface for 160ms without remounting filters or controls; interrupted animations cancel. Success notifications last six seconds and can be dismissed. Loading placeholders breathe only three times, then remain static. Reduced motion disables CSS and Web Animations effects, including when the preference changes during an animation.

## Review decisions
The skill's Swiss-style recommendation fits the internal workspace. Its marketing hero patterns and bright blue/orange palette do not fit this product or the user's preferences; omit them. Preserve the sage Log Stack logo. Avoid fake metrics, unrelated charts, oversized hero sections, and repeated card containers.
