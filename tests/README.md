# Validation notes

## Automated checks

Run from the repository root with Node.js 24 or newer:

```sh
node --test tests/*.test.mjs
```

`pattern-layout.test.mjs` covers page selection, ordering, duplicates, exclusions, blank slots, trimming, overlap, explicit grid dimensions, visibility, and measurement-scale calculations. `projector-math.test.mjs` covers physical dimensions, orientation bounds, rotation/reflection, projection coordinates, and inverse mappings. `history.test.mjs` covers independent snapshots, grouped gestures, undo/redo branching, history limits, cancellation, no-op edits, rollback, and restoration failures.

`raster-resolution.test.mjs` covers zoom reversal, very small viewing scales, resolution hysteresis, pixel/axis/native-image limits, and stable capped dimensions across zoom buckets. The complete suite contains 53 checks.

## Browser checks recorded on 2026-09-14

The local development build was exercised interactively in a browser. The following outcomes were observed:

- Calibration preceded file opening, and the projection tools operated within a skewed calibration grid.
- Selecting an 80 mm test square and entering a 4 in intended side produced 127% pattern scale: `101.6 / 80 = 1.27`.
- A 40 mm test line corrected back to native 100% scale after calibration skew and a 90° pattern rotation.
- SVG layer visibility changes worked with the green-on-black projection filter.
- An eight-slot stitched layout was applied, and **Export stitched PDF** completed a download. Its single page measured 408.0933 × 564.4444 mm, matching the layout.
- Scrolling, mark alignment/reflection, and rotated overview preserved the calibrated corners. Page Down preserved stitching. A damaged replacement file left the current pattern intact.
- A 390 × 844 viewport triggered recalibration, rejected off-screen corners, and supported reset and confirmation.
- Optional WebMCP read/set controls were exercised for calibration corners and state inspection.

Separate document-renderer checks in Chrome covered a rotated PDF with a 2× PDF `UserUnit`, default and changed PDF layer visibility, source-byte access, and bounded page rendering.

Export-library checks used generated PDFs to verify all four page rotations, a nonzero crop-box origin, tile crops, repeated pages, blank slots, scale changes, and long-page physical dimensions. The resulting vector export was rendered and visually inspected. Raster-fallback checks covered selected layers, reuse of repeated-page resources, canvas release, bounded rendering, and cancellation. These were focused development checks; the scratch fixtures are not part of the automated test suite above.

## Live overlap checks recorded on 2026-09-15

- Editing overlap activated stitching without pressing Apply; subsequent horizontal and vertical edits immediately changed page positions.
- At 130% scale with rotation and mirroring, the pattern transform and mat calibration stayed fixed as overlap changed. Overview retained its current viewing scale too.
- Clearing an overlap field or entering excessive overlap preserved the last valid projected layout; correcting the value resumed live updates.

## Undo/redo checks recorded on 2026-09-15

- Calibration corner dragging, pattern panning, and rotation each restored their exact prior state with Undo; calibration Redo restored the dragged coordinates.
- Undo removed a newly drawn measurement line, and Ctrl/Command + Shift + Z restored it. Measurement drawing retained the crosshair and stayed in measurement mode after release.
- Hiding an SVG layer, undoing, and redoing restored visibility through false → true → false.
- Three successive overlap edits formed one undo step. Undo restored the earlier layout and its measurement marks; Redo restored the exact raw input value `0.123456`.
- Undoing an exit from Magnify restored both the magnified view and its tool, so the next click toggled the view correctly.
- History restored physical field values correctly when the current unit was centimeters.
- The header, including Undo/Redo, fit a 320 px-wide viewport. The measurement Previous/Next row has 12 px of space below it before the action buttons.

These are observed checks in the development browser session, not a claim that every control combination or browser has been tested. Keyboard handling preserves native text undo inside inputs; application history is available from the header buttons.

## Thin-line rendering checks recorded on 2026-09-15

- Reproduced missing line sections in the previous renderer after 1000% → 100% zoom: the retained PDF canvas stayed at 2828 × 2828 pixels.
- The updated renderer replaced it with an 846 × 846 canvas at the same calibrated size. The synthetic thin lines remained continuous in the same skewed frame.
- At 63% with fractional panning, four stitched tiles (including a repeated page) rendered at 503 × 503 each. White-on-black and green-on-black Overview were visually checked, without the previous missing sections.
- Calibration corners, native PDF page dimensions, and physical pattern scale remained unchanged by resolution updates.
- SVG zoom reversal changed its backing canvas from 3200 × 2400 to 800 × 600; layer changes and Undo still restored visibility. A PNG stayed at its native 1200 × 800 maximum, then downsampled to 317 × 211 at 25%. No browser warnings or errors were recorded.

For thin-line rendering regression checks, open `fixtures/thin-lines.pdf`: three
synthetic pages containing zero-width PDF hairlines, 0.01–0.25 pt colored strokes,
slightly slanted lines, and small text. Calibrate a skewed frame, zoom to 1000%,
then return to 100%, 63%, and Overview. Lines should remain continuous after each
replacement render. Repeat with fractional panning, stitched pages, and inverted
colors. The original renderer retained its largest bitmap after zooming out,
causing long sections of these lines to vanish.

## Remaining validation

These checks do not establish accuracy on a physical projector or cover every browser/device. With the intended projector, measure the grid and a known test square near the center and edges, then verify scale again after rotation, stitching, and display changes. Confirm the exported PDF's printed dimensions using actual-size printing.

Installed-app file launching and production offline/cache updates are not claimed as end-to-end browser checks in this record. Fullscreen behavior, touch input, and rendering on additional browsers/devices also need their own checks.
