// Link do checkout da Naxe para o DIVINE.
//
// O checkout lê offers=CÓDIGO-QUANTIDADE (aceita várias ofertas separadas por vírgula; a
// quantidade é o número depois do último hífen) e cria o carrinho a partir disso. Os
// parâmetros de campanha e o token de afiliado que chegarem na landing seguem junto: o
// checkout grava as UTMs com o pedido/checkout abandonado e credita o afiliado — sem repassar,
// toda venda vinda da landing apareceria sem origem.
const CHECKOUT_URL = "https://checkout.naxe.com.br/checkout";
const OFFER_CODE = "BsUfPU";
const FORWARDED_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "affiliate",
];

export const MAX_QUANTITY = 5;

export function checkoutUrl(quantity = 1, search = window.location.search) {
  const url = new URL(CHECKOUT_URL);
  url.searchParams.set("offers", `${OFFER_CODE}-${quantity}`);

  const current = new URLSearchParams(search);
  for (const param of FORWARDED_PARAMS) {
    const value = current.get(param);
    if (value) url.searchParams.set(param, value);
  }

  return url.toString();
}
