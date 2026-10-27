# divine-landing

Scroll-driven product landing for **Vonshér DIVINE Elixir Body Balm**: an AI-generated film split into
frames and drawn on a fixed `<canvas>` according to the scroll position. Planning notes, keyframes, clips
and prompts live in `../scopes/divine-scroll-landing/`.

## Run

```bash
npm install
npm run dev
```

Opens on http://localhost:5173 (the harness preview config `divine-landing-dev` uses port 5180).

## Frames

`public/frames/f_0000.webp …` and `src/film-manifest.json` are generated from the clips:

```bash
npm run frames
```

It reads `c1.mp4 … cN.mp4` from the folder passed as argument (the npm script uses the v2 film in
`../scopes/divine-scroll-landing/clips-v2/`), stitches the clips and writes the index of every seam as a keyframe
(`keys`). `--first-clip-start N` skips the first N frames of the first clip (v2 starts at 150: its opening had a
phantom-cap glitch); `--gamma` lifts the shadows of a dark film (the v1 film used 0.78). `--mp4 path` also writes the
same frames as a silent 24 fps H.264 video (the npm scripts put them in `../scopes/divine-scroll-landing/export/`).
Needs Python with PyAV, Pillow, NumPy and imageio-ffmpeg.

**Seams.** The clips were generated with a first and a last frame, but Veo only lands *near* the requested last
frame (framing, zoom and light drift a little; in one clip the cap had already left the frame), and the next clip starts
on the exact image and replays part of the motion — a straight cut jumped and went back in time by 6–8 frames. So for
each seam the script searches the last/first `--junction` frames (48) for the most similar pair, drops what lies beyond
it on both sides (5–8 tail frames in practice) and dissolves the `--dissolve` frames (8) around the cut. `--debug-dir`
saves a strip of every seam to check by eye.

Phones get a separate vertical film (720×1280, clips in `../scopes/divine-scroll-landing/clips-v2-vertical/`):

```bash
npm run frames:portrait
```

It writes `public/frames-portrait/` and `src/film-manifest-portrait.json` (`--out`, `--manifest`). That film has no
K1 (its clips go K2 → K6), so `--extra-key 24` adds an anchor inside the first clip: the hero plays frames 0–24
(closed jar) and "Detalhes premium" the cap lifting. It is encoded at `--quality 75` to weigh about the same as the
horizontal film (~34 MB).

## How the scroll maps to the film

- Every scene in `index.html` has `data-key="k"`: when its top reaches the top of the viewport, the film
  is at keyframe `k`. Between two scenes the frame advances linearly, so a scene's height sets the pace
  of the next stretch of film (`.scene` = 170svh, `.scene.tall` = 220svh).
- `.stage` is sticky, so a scene's text stays on screen while its part of the film plays.
- `focus` in `src/main.js` is the product's horizontal centre in each keyframe; when the screen crops the
  sides of the frame, the player keeps the product in view (right of the text on desktop, centred on
  phones).
- Screens taller than wide (`max-aspect-ratio: 85/100`, the same cut as the phone layout in the CSS) load the
  vertical film; the rest load the horizontal one. The choice is made once, on load — switching on rotation would
  download the other film too.
- `lift` (vertical film only) moves the frame up by a fraction of the screen height in the first three keyframes, so
  the jar sits above the text, which is at the bottom on phones; the band left below fades into the page colour.
- `src/film.js` keeps all compressed frames in memory but only a small decoded window around the cursor.

## Deploy

GitHub Pages, via `.github/workflows/deploy.yml`: every push to `main` builds with Vite and publishes `dist/`
at https://guirms.github.io/divine-landing/. `base: "./"` in `vite.config.js` keeps every path relative, so
the same build works in a subfolder or at a domain root. The page carries `noindex` while the copy is
provisional.

## Checkout

Buy buttons go to the Naxe checkout (`src/checkout.js`): `https://checkout.naxe.com.br/checkout?offers=BsUfPU-N`,
where `N` is the quantity (the checkout reads `offers=CODE-QTY`, comma-separated for several offers). The hero
button takes 1 unit; the buy card has a 1–5 quantity selector. Campaign params (`utm_*`, `gclid`, `fbclid`) and
`affiliate` on the landing URL are forwarded, so the checkout records the sale's origin and credits affiliates.
Prices on the page are static copy (launch R$ 199,00, regular R$ 249,00) — the checkout/API is the source of
truth for what is charged; update the page when the offer price changes.

## Copy

All text is pt-BR and lives in `index.html` (catalog lines + launch price). Fragrance notes are still to be
provided; their block was removed until then.
