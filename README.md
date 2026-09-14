# Keystone

A small, static perspective viewer. Drag the four corners of the frame, open an image or PDF, then zoom and scroll within the warped viewport. Multi-page PDFs scroll continuously and have previous/next page controls.

[Open Keystone](https://peterefrancis.com/custom-keystone/)

## Run locally

From this directory:

```sh
python3 -m http.server 5173 --directory dist
```

Open http://localhost:5173. There is no build step. Serve `dist/` with any static host.

## Publishing

The GitHub Pages workflow publishes `dist/` whenever its files change on `main`. It can also be run manually from the repository's Actions tab. GitHub Pages uses **GitHub Actions** as its publishing source.

## Controls

- Click the empty frame or **Open file**, or drop an image/PDF anywhere.
- Drag a corner; focused corners also accept arrow keys (Shift moves farther).
- Scroll inside the frame; use Shift + scroll for horizontal movement.
- Use **+**, **−**, or Ctrl/Command + scroll to zoom from 25% to 400%.
- **Fit** returns the document to 100%. **Reset frame** restores a rectangle matching the image or first PDF page.
- Ctrl/Command + O opens another file. Ctrl/Command + plus/minus/0 changes zoom.

Opening a file resets the frame to the aspect ratio of the image or first PDF page, so it starts undistorted at 100%. Other PDF pages keep their proportions within that frame. Drag the corners to apply perspective distortion. Files stay in browser memory and are not uploaded to a server. Reloading clears the workspace.

PDF rendering uses locally vendored Mozilla PDF.js (Apache-2.0); its license and pinned version are in `dist/vendor/pdfjs/`. Nearby PDF pages are rendered on demand. Password-protected PDFs need an unlocked copy. Supported image formats depend on the browser.

The viewer optionally registers `read_perspective_view` and `set_perspective_view` tools when `document.modelContext` is available.
