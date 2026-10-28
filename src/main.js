import Lenis from "lenis";
import "lenis/dist/lenis.css";
import "./style.css";
import landscapeManifest from "./film-manifest.json";
import portraitManifest from "./film-manifest-portrait.json";
import { Film } from "./film.js";
import { checkoutUrl, MAX_QUANTITY } from "./checkout.js";

const canvas = document.getElementById("film");
const veil = document.getElementById("veil");
const veilBar = document.getElementById("veil-bar");
const progress = document.getElementById("progress");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let veilGone = false;

// A cor do scrim, quase igual ao fundo da página e já no formato "r, g, b". Lida de novo em
// relayout(): o Safari roda o módulo sem esperar o CSS (WebKit 261655) e aí a variável ainda
// não existe — sem o fallback a faixa embaixo do quadro sairia preta.
const FALLBACK_SCRIM = "247, 240, 229";
function scrimColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--scrim").trim() || FALLBACK_SCRIM;
}

// Tela em pé (celular) usa o filme vertical; o resto, o horizontal — mesmo corte do layout de
// celular no CSS. A escolha é feita ao abrir: trocar ao girar o aparelho baixaria o outro filme
// inteiro de novo.
const portrait = matchMedia("(max-aspect-ratio: 85/100)").matches;
const manifest = portrait ? portraitManifest : landscapeManifest;

const film = new Film(canvas, manifest, {
  // Centro do produto em cada imagem-chave, medido nos quadros. No horizontal, o K6 fica entre
  // o pote (0,52) e a tampa (0,83); no vertical o produto está no meio de todas.
  focus: portrait ? [0.5, 0.5, 0.5, 0.5, 0.5, 0.5] : [0.72, 0.71, 0.81, 0.65, 0.55, 0.64],
  // No vertical, o pote das três primeiras cenas fica atrás do título (texto embaixo, no
  // celular): o quadro sobe 14% da tela nelas. Nos closes e no fim, o texto cobrir a base é ok.
  lift: portrait ? [0.14, 0.14, 0.14, 0, 0, 0] : undefined,
  background: scrimColor(),
  onProgress: (loaded, total) => {
    if (!veilGone) veilBar.style.transform = `scaleX(${Math.min(1, loaded / Math.min(total, 90))})`;
  },
});
film.start();

// Cada elemento com data-key="k" chega à imagem-chave k do filme quando o topo dele encosta
// no topo da tela. Entre duas âncoras o quadro anda linear com o scroll: a altura de cada
// seção é o que dá o ritmo (seção mais alta = cena mais lenta).
let anchors = [];
function measureAnchors() {
  anchors = [...document.querySelectorAll("[data-key]")]
    .map((el) => ({
      scroll: el.getBoundingClientRect().top + window.scrollY,
      frame: manifest.keys[Number(el.dataset.key)],
    }))
    .sort((a, b) => a.scroll - b.scroll);
}

function frameAt(scroll) {
  if (!anchors.length) return 0;
  if (scroll <= anchors[0].scroll) return anchors[0].frame;
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k];
    const b = anchors[k + 1];
    if (scroll <= b.scroll) return a.frame + ((b.frame - a.frame) * (scroll - a.scroll)) / Math.max(1, b.scroll - a.scroll);
  }
  return anchors[anchors.length - 1].frame;
}

let scrollY = window.scrollY;
function onScroll(y) {
  scrollY = y;
  film.setTarget(frameAt(y));
  document.body.classList.toggle("scrolled", y > 24);
}

// Véu de carregamento: sai quando o esqueleto do filme chegou (ou depois de 10 s, para nunca
// prender o visitante).
function hideVeil() {
  if (veilGone) return;
  veilGone = true;
  veil.classList.add("gone");
  document.body.classList.add("ready");
}
setTimeout(hideVeil, 10000);

const lenis = reduced ? null : new Lenis({ lerp: 0.12, smoothWheel: true });
lenis?.on("scroll", ({ scroll }) => onScroll(scroll));
if (!lenis) window.addEventListener("scroll", () => onScroll(window.scrollY), { passive: true });

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { duration: 1.6 });
    else target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  });
});

let last = performance.now();
function step(now) {
  const dt = now - last;
  last = now;
  lenis?.raf(now);
  film.tick(dt);
  progress.style.transform = `scaleX(${(film.cursor / Math.max(1, film.count - 1)).toFixed(4)})`;
  if (!veilGone && film.isSkeletonReady()) hideVeil();
}
function loop(now) {
  step(now);
  requestAnimationFrame(loop);
}

// Só em dev: permite inspecionar e avançar o loop à mão (aba em segundo plano congela o rAF).
if (import.meta.env.DEV) window.__divine = { film, lenis, frameAt, onScroll, step };

// Links de compra: os do topo levam 1 unidade; o do cartão segue o seletor de quantidade.
// O href já vem pronto no HTML (1 unidade) para funcionar mesmo sem JS.
const buyLink = document.getElementById("buy-link");
const qtyOutput = document.getElementById("qty");
let quantity = 1;

function refreshCheckoutLinks() {
  document.querySelectorAll("[data-checkout]").forEach((link) => {
    link.href = checkoutUrl(link === buyLink ? quantity : 1);
  });
  qtyOutput.textContent = String(quantity);
  document.querySelectorAll("[data-qty-step]").forEach((button) => {
    const step = Number(button.dataset.qtyStep);
    button.disabled = (step < 0 && quantity <= 1) || (step > 0 && quantity >= MAX_QUANTITY);
  });
}

document.querySelectorAll("[data-qty-step]").forEach((button) => {
  button.addEventListener("click", () => {
    quantity = Math.min(MAX_QUANTITY, Math.max(1, quantity + Number(button.dataset.qtyStep)));
    refreshCheckoutLinks();
  });
});
refreshCheckoutLinks();

const reveal = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        reveal.unobserve(entry.target);
      }
    }),
  { threshold: 0.25, rootMargin: "0px 0px -10% 0px" },
);
document.querySelectorAll(".reveal").forEach((el) => reveal.observe(el));

// Remede o canvas e as âncoras sempre que a caixa do canvas muda: ao girar o aparelho, ao
// redimensionar a janela e — no Safari — quando o CSS chega depois do script (o WebKit não
// espera a folha de estilo para rodar type="module", bug 261655). Sem isso, no iPhone o canvas
// ficava com a caixa padrão de 300×150 e o filme aparecia esticado na tela inteira.
function relayout() {
  film.background = scrimColor();
  film.resize();
  measureAnchors();
  onScroll(scrollY);
}
new ResizeObserver(relayout).observe(canvas);

document.fonts?.ready.then(relayout);
window.addEventListener("load", relayout);
relayout();
film.cursor = film.target;
requestAnimationFrame(loop);
