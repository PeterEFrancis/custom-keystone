# Keystone

A browser-based pattern projector: calibrate a measured area on your cutting mat, then open a pattern at its physical size. Stitch tiled PDFs, select layers, adjust projection colors, and check scale against a known measurement.

[Open Keystone](https://peterefrancis.com/custom-keystone/) · [GitHub repository](https://github.com/PeterEFrancis/custom-keystone)

## From grid to pattern

1. Enter the width and height of a measured rectangle on your mat, in inches or centimeters.
2. Enter fullscreen, then drag the four projected grid corners to match that rectangle. Use the corner selector and arrow buttons for fine adjustments; Shift + arrow keys moves farther.
3. Choose **Continue to pattern**, then open or drop a PDF, SVG, or image. Opening another file leaves the calibration fixed.
4. Drag or scroll to move the pattern. Use **Single page**, **Continuous**, or **Stitch** to arrange its pages.

Calibration is saved in this browser. Recheck the grid when returning to the app, moving the projector, changing browser zoom, or changing displays. A detected display or fullscreen change returns you to calibration instead of silently resizing the saved grid. The View panel includes grid, border, test line/square, A4, and Letter overlays for checking alignment and physical size.

PDFs use their native print dimensions, including page rotation. Ordinary images start with provisional dimensions based on 96 pixels per inch; embedded image DPI is not used. In **Scale**, set **Image width** or measure a known test feature before relying on the projected size. SVG files with explicit physical dimensions use those dimensions.

## Scale and measurements

In **Scale**, choose **Draw a line** or **Draw a square**, trace a known feature in the pattern, enter its intended length or side, and select **Apply measured scale**. The correction scales the pattern uniformly while keeping the mat calibration fixed. A visibly rectangular selection is rejected as a test square; use a known line or check calibration instead.

The percentage controls change the actual projected pattern size from 1% to 1000%. **Overview** and **Magnify** are temporary inspection views; return from them before cutting. Size-check overlays always follow mat calibration, independently of pattern scale.

Measurement marks also support centering, aligning a line horizontally, flipping along a line, moving by its length, and previous/next navigation. The crosshair stays visible during drawing, and the measurement tool remains active afterward; choose **Move** (P) or Escape to stop measuring. Changing the page layout clears marks so they cannot point to the wrong pattern pieces; Undo restores the previous layout and marks together.

## Stitching, layers, and viewing

- **Stitch:** enter pages in order, including ranges, repeats, `0` for a blank, or `!3` to exclude page 3. Set rows/columns, fill direction, four margin trims, and horizontal/vertical overlap. The applied grid keeps its exact rows × columns, padding unused slots with blanks. Check the preview, then apply. Horizontal and vertical overlap update the projection immediately as you type, preserving its position and scale; incomplete or invalid values leave the last valid layout visible.
- **Layers:** show or hide available PDF optional-content layers or SVG layers, with show-all/hide-all controls.
- **View:** original colors, white on black, green on black, line weight, grid/border, center fold lines, and wrong-side dots. Rotate, mirror, center, or reset orientation from the controls.
- **Export stitched PDF:** saves the stitched layout at the current corrected pattern scale. Print the result at actual size. Projection rotation, flips, colors, line weight, overlays, and measurement marks are viewing tools and are not included.

Ordinary PDF exports retain vector lines and text. Images, SVGs, and PDFs requiring layer or annotation rendering use separate raster tiles, preserving visible layers while flattening them. Large rendered pages may have reduced resolution to keep memory use bounded; export does not create one enormous bitmap.

## Controls

| Action | Shortcut |
| --- | --- |
| Undo | Ctrl/Command + Z |
| Redo | Ctrl/Command + Shift + Z, or Ctrl/Command + Y |
| Move / measure | P / L |
| Rotate / flip horizontally or vertically | R / H / V |
| Center / cycle colors | C / I |
| Overview / magnify | Z / M |
| Fullscreen | F |
| Hide/show controls | Tab while the workspace is focused |
| Open pattern | Ctrl/Command + O |
| Change scale / reset to 100% | Ctrl/Command + plus/minus / 0 |
| Previous/next page | Page Up / Page Down |

Scroll to pan; Shift + scroll pans horizontally. Ctrl/Command + scroll changes pattern scale around the pointer. Arrow keys nudge the selected calibration corner or pan the pattern; Shift moves farther. Escape restores controls and leaves the active drawing tool.

The header's Undo/Redo buttons work in both steps, with separate histories for calibration and the current pattern, each keeping up to 100 changes. A drag, scroll burst, held movement/scale key, or typing sequence in a stitch field is grouped into one step. While typing in an input, the keyboard shortcuts retain the browser's normal text undo; use the header buttons for an application-level undo. Opening another file clears pattern history, while a display change clears both histories. History lasts for the current session.

## Install and offline use

On supported browsers, install Keystone from the browser's app menu. Installed-app file opening queues the selected pattern until calibration is confirmed. These capabilities depend on the browser and operating system.

The hosted app caches its interface and document-rendering resources after a successful online visit, so they can work offline. Selected documents are not cached; reopen them from your device. To receive an app update, close its existing tabs/windows and reopen it online. Localhost development skips service-worker registration.

## Local use and development

Serve the static files from this directory:

```sh
python3 -m http.server 5173 --directory dist
```

Open [localhost:5173](http://localhost:5173). There is no build step or backend. Files are processed locally and are never uploaded; reloading clears the open document. Password-protected PDFs prompt for a password. Available raster formats depend on the browser.

Run the history, layout, and projection math checks with Node.js 24 or newer:

```sh
node --test tests/*.test.mjs
```

See [test notes](tests/README.md) for the recorded browser checks and remaining physical projector validation.

The GitHub Pages workflow publishes `dist/` when it changes on `main`, and can also be started manually from Actions. Configure Pages to use **GitHub Actions** as its publishing source. The app manifest and worker scope use relative paths for hosting under `/custom-keystone/`. Bump `CACHE_VERSION` in `dist/sw.js` whenever app code, styling, or vendored runtime files change, and keep its asset list current.

Where `document.modelContext.registerTool` is available, optional WebMCP tools expose `read_perspective_view` and `set_perspective_view`. They read view metadata or adjust calibration corners, pattern scale, pan, and colors through the same controls. Corner edits require calibration mode; these tools do not open or transmit files.

PDF rendering uses locally vendored Mozilla PDF.js (Apache-2.0), and PDF export uses pdf-lib (MIT). Licenses and pinned versions are under `dist/vendor/`. The calibration-first workflow is inspired by [Pattern Projector](https://www.patternprojector.com/en).
