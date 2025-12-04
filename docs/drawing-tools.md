## Drawing Tools Architecture

This implementation mirrors TradingView’s UX by combining Pinia state, dedicated toolbar/manager components, and canvas overlays that sit on top of each lightweight-charts pane.

### Key Pieces

- **Store (`src/stores/drawingStore.ts`)**
  - Holds drawings keyed by `symbol__timeframe`, favorites, templates, visibility flags, undo history, and default style settings per tool.
  - Exposes `addDrawing`, `updateDrawing`, `removeDrawing`, `toggleFavorite`, `clearAll`, `undo/redo`, `exportCurrent`, `importFromJson`, and template helpers.
  - Persists to `localStorage` and restores automatically on boot.
  - Provides metadata (`activeToolDefinition`, `favoriteTools`, `visibleDrawings`, `getToolStyle`, `setContext`) consumed by the UI.

- **DrawingManager (`src/components/DrawingManager.vue`)**
  - Registers the active `symbol`/`timeframe` with the store.
  - Renders overlays for the main and indicator panes via `DrawingOverlay.vue`.
  - Hosts `DrawingToolbar` (left rail) and `DrawingPropertiesPanel` (floating inspector).
  - Wires global keyboard shortcuts (Esc, Delete/Backspace, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z).

- **DrawingToolbar (`src/components/DrawingToolbar.vue`)**
  - Provides a TradingView-style left rail with icons, favorites strip, magnet toggle, default style pickers, clear/hide, and import/export/template controls.
  - Default styles feed `getToolStyle` so every new drawing inherits customized stroke/fill/text settings.

- **DrawingOverlay (`src/components/DrawingOverlay.vue`)**
  - Canvas-based renderer per pane. Converts logical `{time, price}` coordinates into pixels and vice versa using the chart/series APIs.
  - Handles hit-testing, drafting, ghost previews, magnet snapping, selection, handle dragging, and moving shapes.
  - Supports multi-point (trend line, rectangle, parallel channel, triangle), freehand (brush), and single-point (horizontal/vertical lines, price labels, text, callouts, icons) tools.
  - Stores logical coordinates only; the overlay recomputes pixels on every pan/zoom/resize via lightweight-charts subscriptions.

- **DrawingPropertiesPanel (`src/components/DrawingPropertiesPanel.vue`)**
  - Floating inspector for the currently-selected drawing, exposing stroke/fill/text controls, lock/hide toggles, delete, and quick template capture.

### createShape vs. createMultipointShape Mapping

- **Single-point drawings** (`horizontal-line`, `vertical-line`, `price-label`, `callout`, `text`, `icon`) correspond to TradingView’s `createShape`. Each stores a single anchor (`point`, `price`, or `time`) plus styling metadata. Anchored shapes include `anchorMode`/`screenAnchor` so they can be pinned to either logical or screen coordinates later.
- **Multi-point drawings** (`trend-line`, `ray`, `rectangle`, `parallel-channel`, `triangle`, `brush`) mimic `createMultipointShape`. The store keeps logical points only; the overlay renders previews and final geometry by transforming logical points into pixels, similar to TradingView’s multi-point API.

### Adding a New Tool

1. **Declare the type**
   - Extend the union in `src/data/drawings.ts` with a new interface describing the geometry/styling metadata.
   - Update `DrawingToolId`/`DrawingToolDefinition` to include the tool’s defaults, icon, point count, and pane target.

2. **Provide defaults**
   - Add default styles in `DEFAULT_TOOL_STYLES` within the drawing store. This will automatically surface in the toolbar’s “Defaults” section.

3. **Update creation logic**
   - Extend the `switch` inside `finalizeDraft()` in `DrawingOverlay.vue` to create the new drawing object using the default styles and logical points collected during drafting.

4. **Render the shape**
   - Implement a renderer branch in `drawShape()` and, if necessary, `hitTestDrawing()` and `getDrawingPoints()` so selection/moving works.
   - If the tool requires a unique drafting experience (e.g., Fibonacci retracement), add preview logic to `drawDraft()`.

5. **Expose properties**
   - Add any new editable fields to the `DrawingPropertiesPanel` so users can adjust colors, ratios, or textual labels after creation.

6. **(Optional) Templates & Import/Export**
   - Because drawings persist by `symbol__timeframe`, importing or applying templates automatically clones the new type without extra work.

### Magnet Mode & Multi-pane Sync

- Magnet mode lives in the store and is applied inside `DrawingOverlay`. When enabled, logical points snap to the nearest OHLC values from the supplied dataset (weak mode requires proximity; strong mode always snaps).
- `DrawingManager` renders overlays for the main price pane and, when present, the indicator pane. Drawings record `pane: "main" | "indicator"` so they always render on the correct chart even when time ranges change, satisfying the “attach to indicator pane” requirement.

### Persistence & Templates

- Drawings, favorites, toolbar state, default styles, templates, and magnet visibility persist through `localStorage` (`bar-replay-pro:drawing-state:v2` and `bar-replay-pro:drawing-toolbar:v1`).
- Import/export buttons accept raw JSON (compatible with `exportCurrent()`) to enable backing up or sharing templates.
- Templates capture the current drawing set; applying a template clones the saved shapes with new IDs into the active symbol/timeframe context.

### Undo/Redo & Keyboard Shortcuts

- The store keeps a bounded undo stack (50 snapshots) and redo stack. `DrawingManager` binds:
  - `Cmd/Ctrl + Z` → undo
  - `Shift + Cmd/Ctrl + Z` → redo
  - `Delete/Backspace` → delete selected drawing
  - `Esc` → cancel drawing mode / deselect

### Extensibility Notes

- The overlay is pane-agnostic and decoupled from the toolbar, so you can integrate other plugins (e.g., lightweight-charts-line-tools) later by swapping the renderer inside `DrawingManager`.
- Logical-only storage means future shapes (Fib retracements, price ranges, icons) need only to define their logical points and renderer; no additional persistence work is required.
