"""Quebra os clipes do filme em quadros webp e gera o manifesto que o player lê.

Uso (a partir da raiz do projeto):
    python -I scripts/extract_frames.py [pasta_dos_clipes] [--gamma 0.78]

Os clipes c1.mp4 … cN.mp4 são cenas encadeadas: o último quadro de uma cena é o
primeiro da seguinte (mesma imagem-chave), então o quadro 0 de cada cena a partir
da segunda é descartado para não repetir. O índice de cada imagem-chave vira um
"key" no manifesto, e é com eles que a página amarra cada seção a um trecho do filme.

--gamma < 1 clareia sombras e meios-tons sem estourar os brilhos do dourado
(0.78 = "mais claro sem exagerar", escolhido comparando quadros-chave).

--first-clip-start N descarta os N primeiros quadros da primeira cena, para
quando o começo dela saiu com defeito (o filme passa a abrir no quadro N).

--out e --manifest geram um segundo filme sem mexer no primeiro (o vertical, para
celular): os quadros vão para outra pasta dentro de public/ e o manifesto aponta para ela.

--extra-key N acrescenta uma âncora no meio de uma cena, para um filme com menos cenas
do que a página tem seções (o vertical não tem a K1: a primeira cena dele cobre o hero
e "Detalhes premium").

--quality (padrão 80) é a qualidade do webp. O vertical usa 75: na tela do celular não
se nota, e o filme cai de ~41 para ~34 MB (o mesmo peso do horizontal).
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
    parser.add_argument("--first-clip-start", type=int, default=0)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--extra-key", type=int, action="append", default=[])
    parser.add_argument("--quality", type=int, default=QUALITY)
    args = parser.parse_args()

    clips = sorted(args.clips_dir.glob("c[0-9]*.mp4"), key=lambda p: int(p.stem[1:]))
    if not clips:
        parser.exit(1, f"nenhum clipe c*.mp4 em {args.clips_dir}\n")
    curve = None
    if args.gamma != 1.0:
        curve = [round(255 * (i / 255) ** args.gamma) for i in range(256)] * 3

    out_dir = args.out.resolve()
    public = (ROOT / "public").resolve()
    if not out_dir.is_relative_to(public):
        parser.exit(1, f"--out precisa ficar dentro de {public}\n")
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("f_*.webp"):
        old.unlink()

    index = 0
    keys = [0]
    size = None
    for n, clip in enumerate(clips):
        with av.open(str(clip)) as container:
            for k, frame in enumerate(container.decode(container.streams.video[0])):
                if k == 0 and n > 0:
                    continue  # repete o último quadro da cena anterior
                if n == 0 and k < args.first_clip_start:
                    continue
                image = frame.to_image()
                if curve:
                    image = image.point(curve)
                size = image.size
                image.save(out_dir / f"f_{index:04d}.webp", "WEBP", quality=args.quality, method=4)
                index += 1
        keys.append(index - 1)  # último quadro desta cena = imagem-chave seguinte
        print(f"{clip.name}: até o quadro {index - 1}")

    if any(not 0 < k < index - 1 for k in args.extra_key):
        parser.exit(1, f"--extra-key precisa ficar entre 1 e {index - 2}\n")
    keys = sorted(set(keys + args.extra_key))

    manifest = {
        "count": index,
        "width": size[0],
        "height": size[1],
        "keys": keys,
        "path": out_dir.relative_to(public).as_posix() + "/f_",
        "ext": ".webp",
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in out_dir.glob("f_*.webp"))
    print(f"{index} quadros, {total / 1048576:.1f} MB, keys {keys}")


if __name__ == "__main__":
    main()
