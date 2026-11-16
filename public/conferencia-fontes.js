(function (global) {
  "use strict";
  const preparados = new WeakMap();
  function identificarDocumento(nome, paginas = []) {
    const padrao = /\b(?:OF[IÍ]CIO|RELAT[OÓ]RIO|NOTA\s+T[ÉE]CNICA|DESPACHO)\s*(?:N[\s.º°o]*\s*)?\d{1,10}\s*\/\s*\d{4}(?:(?:\s*\/\s*|\s+)SES(?:\s*\/\s*[A-Z0-9.-]+)*)?/giu;
    for (const pagina of paginas.slice(0, 3)) {
      const texto = String(pagina.texto || "").slice(0, 6000), encontrados = [...texto.matchAll(padrao)];
      if (encontrados.length) {
        const destaque = encontrados.find(m => /^(OFÍCIO|OFICIO|RELATÓRIO|RELATORIO|NOTA TÉCNICA|NOTA TECNICA|DESPACHO)\b/u.test(m[0]));
        return (destaque || encontrados[0])[0].replace(/\s+/g, " ").trim();
      }
    }
    return String(nome || "Documento SES sem identificação");
  }
  function mapear(texto) {
    let normalizado = "", offset = 0; const inicios = [], fins = [];
    for (const letra of String(texto || "")) {
      const normal = letra.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      for (let c of normal) {
        if (/\s/u.test(c)) c = " ";
        if (c === " " && normalizado.endsWith(" ")) { fins[fins.length - 1] = offset + letra.length; continue; }
        normalizado += c;
        for (let j = 0; j < c.length; j++) { inicios.push(offset); fins.push(offset + letra.length); }
      }
      if (!normal && fins.length) fins[fins.length - 1] = offset + letra.length;
      offset += letra.length;
    }
    return { normalizado, inicios, fins };
  }
  function procurar(pagina, trecho) {
    let mapa = preparados.get(pagina);
    if (!mapa || mapa.texto !== pagina.texto) { mapa = { ...mapear(pagina.texto), texto: pagina.texto }; preparados.set(pagina, mapa); }
    const alvo = mapear(trecho).normalizado.trim();
    if (alvo.length < 12) return null;
    const indice = mapa.normalizado.indexOf(alvo);
    if (indice < 0) return null;
    const inicio = mapa.inicios[indice], fim = mapa.fins[indice + alvo.length - 1];
    return { inicio, fim, trecho: pagina.texto.slice(inicio, fim) };
  }
  const numeroPagina = local => /p[aá]gina\s*(\d+)/iu.exec(String(local || ""))?.[1] || null;
  function verificarFonte(paginas, trecho, local) {
    const encontrados = paginas.map(pagina => ({ pagina, achado: procurar(pagina, trecho) })).filter(p => p.achado);
    let indicados = encontrados.filter(p => p.pagina.local === local);
    if (!indicados.length && numeroPagina(local)) indicados = encontrados.filter(p => numeroPagina(p.pagina.local) === numeroPagina(local));
    const fonte = indicados.length === 1 ? indicados[0] : encontrados.length === 1 ? encontrados[0] : null;
    if (!fonte) return { trecho: "", contextoSES: "", contextoMetodo: "", fonteVerificada: false, paginaConfirmada: false,
      contextoParcial: false, local: paginas.find(p => p.local === local)?.local || "Página não confirmada" };
    const { pagina, achado } = fonte;
    const inicio = Math.max(0, achado.inicio - 450), fim = Math.min(pagina.texto.length, achado.fim + 650);
    return { trecho: achado.trecho, contextoSES: pagina.texto.slice(inicio, fim), contextoMetodo: "trecho_validado", fonteVerificada: true,
      paginaConfirmada: true, contextoParcial: inicio > 0 || fim < pagina.texto.length, local: pagina.local };
  }
  function aplicarPagina(row, documento, pagina) {
    if (!documento.paginas.includes(pagina)) throw new Error("A página selecionada não pertence ao documento SES.");
    const fonte = verificarFonte([pagina], row.trecho || "", pagina.local);
    if (!fonte.fonteVerificada) Object.assign(fonte, { contextoSES: pagina.texto.slice(0, 6000), contextoMetodo: "pagina_selecionada",
      contextoParcial: pagina.texto.length > 6000, paginaConfirmada: true, local: pagina.local });
    return { ...row, ...fonte, origem: documento.nome, documentoSES: documento.titulo, documentoId: documento.id };
  }
  const api = { identificarDocumento, verificarFonte, aplicarPagina, numeroPagina };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GemodFontesSES = api;
})(typeof window === "undefined" ? globalThis : window);
