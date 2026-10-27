// Player do filme: um <canvas> fixo que mostra o quadro correspondente à posição do scroll.
//
// Os ~1.000 quadros comprimidos (webp) ficam todos em memória como Blob (dezenas de MB),
// mas decodificados só existe uma janela pequena ao redor do cursor — decodificar o filme
// inteiro passaria de 3 GB. A janela anda à frente na direção do scroll, na distância que o
// cursor percorre enquanto um decode acontece.

const DECODE_CONCURRENCY = 4;
const FETCH_CONCURRENCY = 8;
const EASE_MS = 40; // inércia do cursor do filme, por tempo (não por quadro de tela)
const MAX_CANVAS_SIDE = 2560;

export class Film {
  constructor(canvas, manifest, { onProgress, focus, lift, background } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.manifest = manifest;
    this.count = manifest.count;
    this.onProgress = onProgress;
    // Centro horizontal do produto (0–1) em cada imagem-chave; entre elas, interpolado.
    this.focus = focus ?? manifest.keys.map(() => 0.5);
    // Quanto o quadro sobe (fração da altura da tela) em cada imagem-chave: no celular, tira o
    // produto de trás do texto, que fica embaixo. A faixa que sobra embaixo vira um degradê até
    // background ("r, g, b", a cor de fundo da página).
    this.lift = lift ?? manifest.keys.map(() => 0);
    this.background = background;

    this.blobs = new Array(this.count).fill(null);
    this.fetchState = new Uint8Array(this.count); // 0 nada, 1 baixando, 2 ok, 3 falhou
    this.fetchQueue = this.buildFetchOrder();
    this.urgent = [];
    this.fetching = 0;
    this.loaded = 0;

    this.bitmaps = new Map(); // índice -> ImageBitmap decodificado
    this.decoding = new Set();
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.cacheSize = coarse ? 28 : 64;

    this.cursor = 0;
    this.target = 0;
    this.velocity = 0; // quadros por segundo
    this.direction = 1;
    this.lastDrawn = null;
    this.lastIndex = 0;
    this.productX = 0.62;

    this.resize();
  }

  // Primeiro um começo denso (o hero), depois o filme inteiro de grosso a fino: em poucos
  // segundos qualquer ponto do scroll já tem um quadro perto para mostrar.
  buildFetchOrder() {
    const seen = new Uint8Array(this.count);
    const order = [];
    const add = (i) => {
      if (i >= 0 && i < this.count && !seen[i]) {
        seen[i] = 1;
        order.push(i);
      }
    };
    for (let i = 0; i < Math.min(24, this.count); i++) add(i);
    for (const k of this.manifest.keys) add(k);
    for (let step = 32; step >= 1; step >>= 1) {
      for (let i = 0; i < this.count; i += step) add(i);
    }
    return order;
  }

  url(i) {
    return this.manifest.path + String(i).padStart(4, "0") + this.manifest.ext;
  }

  start() {
    this.pump();
  }

  pump() {
    while (this.fetching < FETCH_CONCURRENCY) {
      const i = this.nextToFetch();
      if (i < 0) return;
      this.fetchFrame(i);
    }
  }

  nextToFetch() {
    while (this.urgent.length) {
      const i = this.urgent.shift();
      if (!this.fetchState[i]) return i;
    }
    while (this.fetchQueue.length) {
      const i = this.fetchQueue.shift();
      if (!this.fetchState[i]) return i;
    }
    return -1;
  }

  fetchFrame(i) {
    this.fetchState[i] = 1;
    this.fetching++;
    fetch(this.url(i))
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        this.blobs[i] = blob;
        this.fetchState[i] = 2;
        this.loaded++;
        this.onProgress?.(this.loaded, this.count);
      })
      .catch(() => {
        this.fetchState[i] = 3;
      })
      .finally(() => {
        this.fetching--;
        this.pump();
      });
  }

  // Pronto para mostrar sem buracos: o começo, as imagens-chave e 1 a cada 16 quadros.
  isSkeletonReady() {
    for (let i = 0; i < Math.min(24, this.count); i++) if (this.fetchState[i] < 2) return false;
    for (let i = 0; i < this.count; i += 16) if (this.fetchState[i] < 2) return false;
    return this.bitmaps.size > 0;
  }

  setTarget(frame) {
    this.target = Math.max(0, Math.min(this.count - 1, frame));
  }

  tick(dt) {
    const before = this.cursor;
    const d = this.target - this.cursor;
    this.cursor = Math.abs(d) < 0.001 ? this.target : this.cursor + d * (1 - Math.exp(-Math.min(dt, 64) / EASE_MS));
    const v = ((this.cursor - before) * 1000) / Math.max(1, dt);
    this.velocity = this.velocity * 0.7 + v * 0.3;
    if (Math.abs(d) > 0.05) this.direction = d > 0 ? 1 : -1;

    this.schedule();
    this.draw();
  }

  schedule() {
    const i0 = Math.round(this.cursor);
    const speed = Math.abs(this.velocity);
    const ahead = Math.min(this.cacheSize - 8, Math.ceil(speed * 0.25) + 6);
    this.want(i0);
    // Quadro exato ainda não baixou (salto grande na primeira visita): decodifica o vizinho
    // já baixado mais próximo, em vez de deixar na tela um quadro de outro trecho do filme.
    if (this.fetchState[i0] !== 2) this.want(this.nearestLoaded(i0));
    for (let k = 1; k <= ahead; k++) this.want(i0 + this.direction * k);
    for (let k = 1; k <= 3; k++) this.want(i0 - this.direction * k);
  }

  nearestLoaded(i) {
    for (let d = 1; d <= 64; d++) {
      if (this.fetchState[i - d] === 2) return i - d;
      if (this.fetchState[i + d] === 2) return i + d;
    }
    return -1;
  }

  want(i) {
    if (i < 0 || i >= this.count || this.bitmaps.has(i) || this.decoding.has(i)) return;
    if (this.fetchState[i] !== 2) {
      if (!this.fetchState[i] && !this.urgent.includes(i)) {
        this.urgent.push(i);
        this.pump();
      }
      return;
    }
    if (this.decoding.size >= DECODE_CONCURRENCY) return;
    this.decoding.add(i);
    createImageBitmap(this.blobs[i])
      .then((bitmap) => {
        this.bitmaps.set(i, bitmap);
        this.evict();
      })
      .catch(() => {})
      .finally(() => this.decoding.delete(i));
  }

  // Descarta o mais distante do cursor; o que ficou para trás do sentido do scroll vale o dobro.
  evict() {
    while (this.bitmaps.size > this.cacheSize) {
      let worst = -1;
      let worstDistance = -1;
      for (const k of this.bitmaps.keys()) {
        let distance = Math.abs(k - this.cursor);
        if ((k - this.cursor) * this.direction < 0) distance *= 2;
        if (distance > worstDistance) {
          worstDistance = distance;
          worst = k;
        }
      }
      this.bitmaps.get(worst)?.close?.();
      this.bitmaps.delete(worst);
    }
  }

  // O quadro exato se já estiver decodificado; senão o vizinho decodificado mais próximo.
  // Nunca pinta vazio: sem nada por perto, fica o último quadro desenhado.
  pick() {
    const i = Math.round(this.cursor);
    const exact = this.bitmaps.get(i);
    if (exact) return [exact, i];
    let best = null;
    let bestIndex = i;
    let bestDistance = Infinity;
    for (const [k, bitmap] of this.bitmaps) {
      const distance = Math.abs(k - i);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bitmap;
        bestIndex = k;
      }
    }
    return [best, bestIndex];
  }

  draw() {
    const [bitmap, index] = this.pick();
    if (!bitmap || bitmap === this.lastDrawn) return;
    this.lastDrawn = bitmap;
    this.lastIndex = index;
    this.paint(bitmap, index);
  }

  // Valor de uma lista por imagem-chave (focus, lift) no quadro i, interpolado entre as chaves.
  atKeys(values, i) {
    const keys = this.manifest.keys;
    for (let k = 0; k < keys.length - 1; k++) {
      if (i <= keys[k + 1]) {
        const t = (i - keys[k]) / Math.max(1, keys[k + 1] - keys[k]);
        return values[k] + (values[k + 1] - values[k]) * t;
      }
    }
    return values[values.length - 1];
  }

  // Cover com enquadramento que segue o produto: quando a tela corta as laterais do quadro,
  // o produto vai para productX da largura da tela (à direita do texto no desktop, no meio
  // no celular), sem nunca deixar sobrar borda vazia nas laterais.
  paint(bitmap, index) {
    const { width: cw, height: ch } = this.canvas;
    const scale = Math.max(cw / bitmap.width, ch / bitmap.height);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const x = Math.min(0, Math.max(cw - w, this.productX * cw - this.atKeys(this.focus, index) * w));
    const y = Math.round((ch - h) / 2 - this.atKeys(this.lift, index) * ch);
    this.ctx.drawImage(bitmap, Math.round(x), y, w, h);
    if (y + h < ch) this.fadeBottom(y + h);
  }

  // Embaixo do quadro que subiu: degradê do fim do filme até a cor de fundo, e fundo liso no
  // resto. O degradê encolhe junto com a faixa, para não sumir de uma vez quando o lift zera.
  fadeBottom(edge) {
    const { width: cw, height: ch } = this.canvas;
    const fade = Math.min(ch * 0.12, (ch - edge) * 2);
    const gradient = this.ctx.createLinearGradient(0, edge - fade, 0, edge);
    gradient.addColorStop(0, `rgba(${this.background}, 0)`);
    gradient.addColorStop(1, `rgb(${this.background})`);
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, edge - fade, cw, fade);
    this.ctx.fillStyle = `rgb(${this.background})`;
    this.ctx.fillRect(0, edge, cw, ch - edge);
  }

  // Tamanho pela caixa CSS do próprio canvas (não innerWidth), para o blit não reamostrar.
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = Math.max(1, Math.round(rect.width * dpr));
    let h = Math.max(1, Math.round(rect.height * dpr));
    const k = Math.min(1, MAX_CANVAS_SIDE / Math.max(w, h));
    this.canvas.width = Math.round(w * k);
    this.canvas.height = Math.round(h * k);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.productX = rect.width / Math.max(1, rect.height) < 0.85 ? 0.5 : 0.62;
    if (this.lastDrawn) this.paint(this.lastDrawn, this.lastIndex);
  }
}
