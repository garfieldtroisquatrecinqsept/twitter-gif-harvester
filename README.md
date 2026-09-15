# Twitter GIF Harvest

Downloads GIFs from X / Twitter as real animated `.gif` files — X serves them as silent MP4s, and this
extension converts them back entirely inside your browser, with no external service involved.

Works on Firefox and on Chrome / Edge / Brave.

## Install — Firefox

1. Download [`release/twitter-gif-harvest-1.0.0-signed.xpi`](release/twitter-gif-harvest-1.0.0-signed.xpi)
2. Open `about:addons`
3. Click the gear icon → **Install Add-on From File…** and pick the file

This build is signed by Mozilla, so it installs permanently. Requires Firefox 140 or later.

## Install — Chrome / Edge / Brave

1. Download or clone this repository
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the repository folder

## Use it

Hover a GIF on X and click the **GIF** button at the bottom left of the player. The button shows the
conversion progress, then the file lands in your downloads. Right-clicking the GIF works too.

Click the extension icon to see your recent downloads and open the settings.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Max frames per second | 25 | Caps smoothness without halving it: a 30 fps source keeps 25 frames, each with its exact duration |
| Max width / height | 640 px | Resizes while keeping the aspect ratio |
| Floyd–Steinberg dithering | on | Smoother gradients, slightly larger file |
| Frame-to-frame tolerance | 8 | Higher means more pixels count as unchanged, so a smaller file |
| Infinite loop | on | Turn off to play the GIF once |
| Subfolder | `TwitterGifHarvest` | Subfolder inside your downloads directory; leave empty for the root |
| Filename pattern | `{screen_name}-{tweet_id}-{index}` | Available tokens: `{screen_name}` `{tweet_id}` `{index}` `{media_id}` `{date}` `{time}` |
| Ask where to save | off | Turn on to pick the location for every download |

## Notes

- Only GIFs are handled. Regular X videos are served over HLS and are out of scope.
- A GIF is limited to 256 colours per frame, so the result is coarser and heavier than the source
  MP4. Lower the maximum width or frame rate if file size matters.

## Development

Rebuild the Firefox package:

```bash
python tools/build-firefox.py
```

Run the test suites by serving the parent folder and opening `tests/harness.html` (encoder) and
`tests/content-harness.html` (content script) in a browser.
