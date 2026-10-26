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
`../scopes/divine-scroll-landing/clips-v2/`), drops the duplicated first frame of every clip after the
first, and writes the keyframe indices (`keys`). `--first-clip-start N` skips the first N frames of the
first clip (v2 starts at 150: its opening had a phantom-cap glitch); `--gamma` lifts the shadows of a dark film (the v1
film used 0.78). Needs Python with PyAV and Pillow.

## How the scroll maps to the film

- Every scene in `index.html` has `data-key="k"`: when its top reaches the top of the viewport, the film
  is at keyframe `k`. Between two scenes the frame advances linearly, so a scene's height sets the pace
  of the next stretch of film (`.scene` = 170svh, `.scene.tall` = 220svh).
- `.stage` is sticky, so a scene's text stays on screen while its part of the film plays.
- `focus` in `src/main.js` is the product's horizontal centre in each keyframe; when the screen crops the
  sides of the frame, the player keeps the product in view (right of the text on desktop, centred on
  phones).
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
