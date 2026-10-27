"""Quebra os clipes do filme em quadros webp e gera o manifesto que o player lê.

Uso (a partir da raiz do projeto):
    python -I scripts/extract_frames.py [pasta_dos_clipes] [--gamma 0.78] [--mp4 saida.mp4]

Os clipes c1.mp4 … cN.mp4 são cenas encadeadas geradas com "primeiro quadro + último
quadro": o último quadro pedido de uma cena é o primeiro da seguinte. Na prática o Veo
só chega PERTO do último quadro (enquadramento, zoom e luz um pouco diferentes; às vezes
um objeto já saiu de quadro), e a cena seguinte começa na imagem exata e refaz um pedaço
do movimento — na emenda o filme pulava e "voltava no tempo" alguns quadros.

Por isso cada emenda é costurada assim:
1. procura-se, entre os últimos --junction quadros de uma cena e os primeiros --junction
   da seguinte, o par que mais se parece (menor diferença de pixels, com uma pequena
   penalidade por quadro descartado, para não cortar à toa);
2. o que vem depois desse quadro na primeira cena e antes dele na segunda é descartado;
3. os --dissolve quadros em volta do ponto de corte são uma fusão entre as duas cenas,
   que esconde a diferença de enquadramento que sobrou.
O índice do centro de cada emenda vira um "key" no manifesto, e é com eles que a página
amarra cada seção a um trecho do filme.

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

--mp4 grava também um vídeo (24 fps, H.264, sem áudio) com exatamente os mesmos quadros,
para quem quer o filme fora da página. --debug-dir salva uma tira de quadros de cada
emenda, para conferir o corte a olho.
"""

import argparse
import json
import subprocess
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLIPS = ROOT.parent / "scopes" / "divine-scroll-landing" / "clips"
OUT_DIR = ROOT / "public" / "frames"
MANIFEST = ROOT / "src" / "film-manifest.json"
QUALITY = 80
FPS = 24
TRIM_PENALTY = 0.05  # custo, em níveis de cinza, de cada quadro descartado na emenda


def decode(path: Path, curve) -> list[Image.Image]:
    with av.open(str(path)) as container:
        frames = [frame.to_image() for frame in container.decode(container.streams.video[0])]
    return [image.point(curve) for image in frames] if curve else frames


def thumb(image: Image.Image) -> np.ndarray:
    """Versão pequena em cinza, só para comparar quadros."""
    width = 160
    return np.asarray(image.convert("L").resize((width, max(1, round(width * image.height / image.width)))), dtype=np.float32)


def find_junction(tail: list[Image.Image], head: list[Image.Image]) -> tuple[int, int, float]:
    """(i, j, diferença): corta a primeira cena depois de tail[i] e a segunda antes de head[j]."""
    tails = [thumb(image) for image in tail]
    heads = [thumb(image) for image in head]
    best = None
    for i, a in enumerate(tails):
        dropped_tail = len(tails) - 1 - i
        for j, b in enumerate(heads):
            diff = float(np.abs(a - b).mean())
            cost = diff + TRIM_PENALTY * (dropped_tail + j)
            if best is None or cost < best[0]:
                best = (cost, i, j, diff)
    return best[1], best[2], best[3]


def blend(a: Image.Image, b: Image.Image, t: float) -> Image.Image:
    return Image.blend(a, b, t)


def save_strip(images: list[Image.Image], labels: list[str], path: Path) -> None:
    width = 180
    height = round(width * images[0].height / images[0].width)
    per_row = 12
    rows = -(-len(images) // per_row)
    sheet = Image.new("RGB", (width * per_row, height * rows), "black")
    for k, (image, label) in enumerate(zip(images, labels)):
        tile = image.resize((width, height))
        ImageDraw.Draw(tile).text((5, 5), label, fill="yellow")
        sheet.paste(tile, ((k % per_row) * width, (k // per_row) * height))
    sheet.save(path, quality=85)


class Mp4Writer:
    """Encoda os quadros num H.264 via o ffmpeg que vem com o imageio_ffmpeg."""

    def __init__(self, path: Path, size: tuple[int, int]):
        import imageio_ffmpeg

        path.parent.mkdir(parents=True, exist_ok=True)
        self.process = subprocess.Popen(
            [
                imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}", "-r", str(FPS), "-i", "-",
                "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(path),
            ],
            stdin=subprocess.PIPE,
        )

    def write(self, image: Image.Image) -> None:
        self.process.stdin.write(image.convert("RGB").tobytes())

    def close(self) -> None:
        self.process.stdin.close()
        if self.process.wait() != 0:
            raise SystemExit("ffmpeg falhou ao gravar o mp4")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clips_dir", nargs="?", type=Path, default=DEFAULT_CLIPS)
    parser.add_argument("--gamma", type=float, default=1.0)
    parser.add_argument("--first-clip-start", type=int, default=0)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--extra-key", type=int, action="append", default=[])
    parser.add_argument("--quality", type=int, default=QUALITY)
    parser.add_argument("--junction", type=int, default=48, help="quadros de cada lado onde procurar o corte")
    parser.add_argument("--dissolve", type=int, default=8, help="quadros de fusão em volta de cada corte")
    parser.add_argument("--mp4", type=Path)
    parser.add_argument("--debug-dir", type=Path)
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
    if args.debug_dir:
        args.debug_dir.mkdir(parents=True, exist_ok=True)

    index = 0
    keys = [0]
    size = None
    mp4 = None

    def emit(image: Image.Image) -> None:
        nonlocal index, size, mp4
        size = image.size
        if args.mp4 and mp4 is None:
            mp4 = Mp4Writer(args.mp4, size)
        image.save(out_dir / f"f_{index:04d}.webp", "WEBP", quality=args.quality, method=4)
        if mp4:
            mp4.write(image)
        index += 1

    # A cauda da cena anterior fica pendente até a emenda com a seguinte ser decidida.
    pending: list[Image.Image] = []
    hold = args.junction + args.dissolve
    for n, clip in enumerate(clips):
        frames = decode(clip, curve)
        if n == 0:
            frames = frames[args.first_clip_start :]
        else:
            i, j, diff = find_junction(pending[-args.junction :], frames[: args.junction])
            i += len(pending) - args.junction  # índice em pending
            # Fusão centrada no corte, mantendo o alinhamento pending[i+1] <-> frames[j]. Ela
            # só pode usar quadros descartados (depois de i e antes de j): se sobrou pouco,
            # encolhe; sem nada descartado, vira corte seco.
            dropped_tail = len(pending) - 1 - i
            k = min(args.dissolve, dropped_tail + j)
            offset = max(-j, min(-(k // 2), dropped_tail - k))
            a0, b0 = i + 1 + offset, j + offset
            junction_index = index + a0 + k // 2
            for image in pending[:a0]:
                emit(image)
            for t in range(k):
                emit(blend(pending[a0 + t], frames[b0 + t], (t + 1) / (k + 1)))
            print(
                f"{clips[n - 1].name} -> {clip.name}: corta {dropped_tail} quadros do fim e {j} do começo "
                f"(diferença {diff:.1f}), fusão de {k} quadros; key {junction_index}"
            )
            if args.debug_dir:
                before = pending[max(0, a0 - 8) : a0]
                after = frames[b0 + k : b0 + k + 8]
                fused = [blend(pending[a0 + t], frames[b0 + t], (t + 1) / (k + 1)) for t in range(k)]
                labels = [f"{clips[n - 1].stem}" for _ in before] + [f"fusão {t + 1}/{k}" for t in range(k)] + [f"{clip.stem}" for _ in after]
                save_strip(before + fused + after, labels, args.debug_dir / f"junction-{clips[n - 1].stem}-{clip.stem}.jpg")
            keys.append(junction_index)
            frames = frames[b0 + k :]
        for image in frames[:-hold]:
            emit(image)
        pending = frames[-hold:]
    for image in pending:
        emit(image)
    keys.append(index - 1)
    if mp4:
        mp4.close()

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
