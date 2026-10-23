import Lenis from "lenis";
import "lenis/dist/lenis.css";
import "./style.css";
import manifest from "./film-manifest.json";
import { Film } from "./film.js";

const canvas = document.getElementById("film");
const veil = document.getElementById("veil");
const veilBar = document.getElementById("veil-bar");
const progress = document.getElementById("progress");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let veilGone = false;

const film = new Film(canvas, manifest, {
  // Centro do produto em cada imagem-chave (K1…K6), medido nos quadros. No K6 fica entre o
  // pote (0,52) e a tampa (0,83).
  focus: [0.72, 0.71, 0.81, 0.65, 0.55, 0.64],
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

let resizeTimer;
window.addEventListener(
  "resize",
  () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      film.resize();
      measureAnchors();
      onScroll(scrollY);
    }, 150);
  },
  { passive: true },
);

measureAnchors();
document.fonts?.ready.then(() => {
  measureAnchors();
  onScroll(scrollY);
});
window.addEventListener("load", () => {
  measureAnchors();
  onScroll(scrollY);
});
onScroll(scrollY);
film.cursor = film.target;
requestAnimationFrame(loop);
