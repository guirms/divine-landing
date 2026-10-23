"""Quebra os clipes do filme em quadros webp e gera o manifesto que o player lê.

Uso (a partir da raiz do projeto):
    python -I scripts/extract_frames.py [pasta_dos_clipes] [--gamma 0.78]

Os clipes c1.mp4 … cN.mp4 são cenas encadeadas: o último quadro de uma cena é o
primeiro da seguinte (mesma imagem-chave), então o quadro 0 de cada cena a partir
da segunda é descartado para não repetir. O índice de cada imagem-chave vira um
"key" no manifesto, e é com eles que a página amarra cada seção a um trecho do filme.

--gamma < 1 clareia sombras e meios-tons sem estourar os brilhos do dourado
(0.78 = "mais claro sem exagerar", escolhido comparando quadros-chave).
"""

import argparse
import json
from pathlib import Path

import av

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLIPS = ROOT.parent / "scopes" / "divine-scroll-landing" / "clips"
OUT_DIR = ROOT / "public" / "frames"
MANIFEST = ROOT / "src" / "film-manifest.json"
QUALITY = 80


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clips_dir", nargs="?", type=Path, default=DEFAULT_CLIPS)
    parser.add_argument("--gamma", type=float, default=1.0)
    args = parser.parse_args()

    clips = sorted(args.clips_dir.glob("c[0-9]*.mp4"), key=lambda p: int(p.stem[1:]))
    if not clips:
        parser.exit(1, f"nenhum clipe c*.mp4 em {args.clips_dir}\n")
    curve = None
    if args.gamma != 1.0:
        curve = [round(255 * (i / 255) ** args.gamma) for i in range(256)] * 3

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("f_*.webp"):
        old.unlink()

    index = 0
    keys = [0]
    size = None
    for n, clip in enumerate(clips):
        with av.open(str(clip)) as container:
            for k, frame in enumerate(container.decode(container.streams.video[0])):
                if k == 0 and n > 0:
                    continue  # repete o último quadro da cena anterior
                image = frame.to_image()
                if curve:
                    image = image.point(curve)
                size = image.size
                image.save(OUT_DIR / f"f_{index:04d}.webp", "WEBP", quality=QUALITY, method=4)
                index += 1
        keys.append(index - 1)  # último quadro desta cena = imagem-chave seguinte
        print(f"{clip.name}: até o quadro {index - 1}")

    manifest = {
        "count": index,
        "width": size[0],
        "height": size[1],
        "keys": keys,
        "path": "frames/f_",
        "ext": ".webp",
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT_DIR.glob("f_*.webp"))
    print(f"{index} quadros, {total / 1048576:.1f} MB, keys {keys}")


if __name__ == "__main__":
    main()
