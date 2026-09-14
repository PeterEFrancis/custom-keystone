# Keystone

A small, static perspective viewer. Drag the four corners of the frame, open an image or PDF, then zoom and scroll within the warped viewport. Multi-page PDFs scroll continuously and have previous/next page controls.

## Run locally

From this directory:

```sh
python3 -m http.server 5173 --directory dist
```

Open http://localhost:5173. There is no build step. Serve `dist/` with any static host.

## Controls

- Click the empty frame or **Open file**, or drop an image/PDF anywhere.
- Drag a corner; focused corners also accept arrow keys (Shift moves farther).
- Scroll inside the frame; use Shift + scroll for horizontal movement.
- Use **+**, **−**, or Ctrl/Command + scroll to zoom from 25% to 400%.
- **Fit** returns the document to 100%. **Reset frame** restores the rectangle.
- Ctrl/Command + O opens another file. Ctrl/Command + plus/minus/0 changes zoom.

At 100%, an image or each PDF page fills the box. The image/page is stretched to the four-corner perspective. Files stay in browser memory and are not uploaded to a server. Opening a new file preserves the frame corners. Reloading clears the workspace.

PDF rendering uses locally vendored Mozilla PDF.js (Apache-2.0); its license and pinned version are in `dist/vendor/pdfjs/`. Nearby PDF pages are rendered on demand. Password-protected PDFs need an unlocked copy. Supported image formats depend on the browser.

The viewer optionally registers `read_perspective_view` and `set_perspective_view` tools when `document.modelContext` is available.
