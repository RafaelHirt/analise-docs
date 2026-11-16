(function (global) {
  "use strict";
  const Relatorio = typeof module !== "undefined" && module.exports ? require("./relatorio-conferencia.js") : global.GemodRelatorio;
  const LARGURA = 1200, ALTURA_MAXIMA = 2600, TOPO = 206, RODAPE = 142, MARGEM = 56, MAX_PARTES = 24;
  const tipos = {
    titulo: { fonte: "700 27px system-ui", altura: 39, cor: "#184b34", antes: 24 },
    rotulo: { fonte: "700 18px system-ui", altura: 29, cor: "#52705f", antes: 14 },
    texto: { fonte: "22px system-ui", altura: 34, cor: "#293f33", antes: 8 },
    pasta: { fonte: "20px system-ui", altura: 32, cor: "#476552", fundo: "#eff6f1", antes: 3 },
    arquivo: { fonte: "700 27px system-ui", altura: 40, cor: "#174e34", fundo: "#e3f1e9", antes: 12 },
    caminho: { fonte: "18px monospace", altura: 29, cor: "#4a6455", fundo: "#f1f6f3", antes: 8 },
    trecho: { fonte: "22px system-ui", altura: 35, cor: "#2c4435", fundo: "#f3f7f4", antes: 8 },
    aviso: { fonte: "20px system-ui", altura: 32, cor: "#8a4b1f", fundo: "#fff3e1", antes: 12 },
  };
  const raizesComCopia = new WeakSet();
  function instalarEstilos() {
    if (global.document.getElementById("gemod-compartilhar-estilos")) return;
    const style = global.document.createElement("style"); style.id = "gemod-compartilhar-estilos";
    style.textContent = (Relatorio?.estilosCaminho || "") + `
      .gemod-share-dialog{width:min(920px,calc(100vw - 24px));max-height:92vh;padding:0;border:1px solid #d1dfd6;border-radius:16px;color:#233b2c;background:#f6f9f7;font:15px/1.5 system-ui,sans-serif;overflow:auto;box-shadow:0 20px 70px #13362240}
      .gemod-share-dialog::backdrop{background:#102c2399}.gemod-share-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:22px 24px;background:white;border-bottom:1px solid #dae6df}.gemod-share-head h2{font:700 22px/1.3 system-ui;margin:4px 0}.gemod-share-head p{margin:6px 0;color:#526e5a;font-size:13px}.gemod-share-body{padding:22px 24px}.gemod-share-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.gemod-share-fields label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:650}.gemod-share-fields select{font:14px system-ui;color:#233b2c;padding:10px;border:1px solid #c6d9cc;background:white;border-radius:8px;max-width:100%;min-width:0;width:100%}
      .gemod-share-dialog button{padding:9px 14px;border:1px solid #b9cfc1;border-radius:8px;background:white;color:#1c5035;font:600 13px/1.4 system-ui;cursor:pointer}.gemod-share-dialog button:disabled{opacity:.55;cursor:wait}.gemod-share-status{padding:12px 14px;background:#e8f2ec;border-radius:8px;font-size:13px;overflow-wrap:anywhere;margin:16px 0}.gemod-share-pages{display:grid;gap:20px}.gemod-share-page{background:white;border:1px solid #ccded2;border-radius:12px;padding:14px}.gemod-share-page-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-weight:650}.gemod-share-page button{background:#0b754e;color:white;border-color:#0b754e}.gemod-share-page img{display:block;max-width:100%;height:auto;border-radius:7px;border:1px solid #e0e8e2;margin:auto}.gemod-share-note{font-size:12px;color:#526e5a;line-height:1.6;margin-top:16px}.gemod-share-dialog [hidden]{display:none!important}@media(max-width:640px){.gemod-share-fields{grid-template-columns:1fr}.gemod-share-body,.gemod-share-head{padding:16px}}
    `;
    global.document.head.append(style);
  }
  async function copiarCaminho(botao) {
    const texto = botao.dataset.copiarCaminho, original = botao.textContent;
    botao.disabled = true;
    try {
      try {
        if (!global.navigator.clipboard?.writeText) throw new Error("Sem área de transferência");
        await global.navigator.clipboard.writeText(texto);
      } catch (_) {
        const textarea = global.document.createElement("textarea"); textarea.value = texto;
        textarea.style.cssText = "position:fixed;left:-9999px;top:0"; global.document.body.append(textarea);
        let copiou = false;
        try { textarea.select(); copiou = !!global.document.execCommand?.("copy"); }
        finally { textarea.remove(); botao.focus(); }
        if (!copiou) throw new Error("Selecione o caminho completo para copiar");
      }
      botao.textContent = "Caminho copiado";
    } catch (_) {
      const detalhes = botao.closest(".gemod-file-location")?.querySelector(".gemod-full-path");
      if (detalhes) detalhes.open = true;
      botao.textContent = "Selecione o caminho abaixo para copiar";
    } finally {
      botao.disabled = false;
      global.setTimeout(() => { if (botao.isConnected) botao.textContent = original; }, 3500);
    }
  }
  function ativarCopia(raiz) {
    instalarEstilos();
    if (raizesComCopia.has(raiz)) return;
    raizesComCopia.add(raiz);
    raiz.addEventListener("click", evento => {
      const botao = evento.target.closest?.("[data-copiar-caminho]");
      if (botao && raiz.contains(botao) && !botao.disabled) copiarCaminho(botao);
    });
  }
  function quebrarTexto(ctx, texto, largura) {
    const linhas = [];
    const segmentador = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("pt-BR", { granularity: "grapheme" }) : null;
    for (const paragrafo of String(texto ?? "").split(/\r\n|\r|\n/)) {
      let linha = "";
      for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
        const tentativa = linha ? linha + " " + palavra : palavra;
        if (ctx.measureText(tentativa).width <= largura) { linha = tentativa; continue; }
        if (linha) { linhas.push(linha); linha = ""; }
        if (ctx.measureText(palavra).width <= largura) { linha = palavra; continue; }
        const letras = segmentador ? [...segmentador.segment(palavra)].map(s => s.segment) : Array.from(palavra);
        for (const letra of letras) {
          if (linha && ctx.measureText(linha + letra).width > largura) { linhas.push(linha); linha = ""; }
          linha += letra;
        }
      }
      linhas.push(linha);
    }
    return linhas;
  }
  function blocosPedido(dados, pedido, arquivo = null) {
    const row = dados.resultados?.[pedido];
    if (!row) throw new Error("Selecione um pedido válido.");
    if (arquivo !== null && !row.candidatos?.[arquivo]) throw new Error("Selecione um arquivo válido.");
    const blocos = [], add = (tipo, texto) => { if (String(texto ?? "").trim()) blocos.push({ tipo, texto: String(texto) }); };
    add("titulo", row.documentoSES || row.origem || "Documento SES sem identificação");
    const avaliacao=Relatorio.avaliacaoTexto(row);
    if(avaliacao){
      add("rotulo","RESULTADO DA IA");add("aviso",avaliacao);
      add("rotulo","JUSTIFICATIVA DA IA");add("texto",row.justificativa);
      if(row.pendencias?.length){add("rotulo","O QUE AINDA FALTA COMPROVAR");add("texto",row.pendencias.join("; "));}
      add("texto","Avaliação do conjunto de trechos deste pedido.");
    }
    add("rotulo", "O QUE A SES SOLICITA"); add("texto", row.providencia || "Providência não informada");
    add("rotulo", "PROBLEMA APONTADO"); add("texto", row.descricao);
    add("rotulo", "REFERÊNCIAS"); add("texto", row.referencia);
    add("rotulo", "ORIGEM NA SES"); add("texto", [row.origem,row.item?"Item "+row.item:"", row.local].filter(Boolean).join(" · "));
    const contexto = row.contextoSES || (row.fonteVerificada ? row.trecho : "");
    if (contexto) {
      add("rotulo", row.contextoMetodo === "pagina_selecionada" ? "CONTEXTO DA PÁGINA SELECIONADA" : "TRECHO ORIGINAL DA SES E CONTEXTO");
      add("trecho", contexto);
      if (row.contextoParcial) add("rotulo", "Recorte da página da SES");
    } else add("aviso", "Trecho original da SES não disponível neste resultado.");
    if (!row.paginaConfirmada && !row.fonteVerificada) add("aviso", "Origem do pedido a confirmar no documento da SES.");
    add("rotulo", "SELEÇÃO COMPARTILHADA");
    add("texto", arquivo === null ? "Todos os " + (row.candidatos || []).length + " arquivos candidatos deste pedido." : "Arquivo " + (arquivo + 1) + " de " + row.candidatos.length + " candidatos. A avaliação registrada refere-se ao pedido.");
    const candidatos = (row.candidatos || []).map((c, i) => ({ c, i })).filter(a => arquivo === null || a.i === arquivo);
    for (const { c, i } of candidatos) {
      const p = Relatorio.partesCaminho(c.caminho);
      add("titulo", "ONDE PROCURAR · ARQUIVO " + (i + 1));
      add("rotulo", "PASTAS · SIGA ESTA SEQUÊNCIA");
      p.pastas.forEach((nome, indice) => add("pasta", (indice + 1) + ". " + nome));
      add("arquivo", p.arquivo); add("rotulo", c.local || "Página ou local não informado");
      add("caminho", p.original);
      add("rotulo", "TRECHO ENCONTRADO NO DOCUMENTO");
      add(c.trecho ? "trecho" : "aviso", c.trecho || "Sem citação textual. O nome ou caminho sozinho não comprova o atendimento.");
      if (c.motivos?.length) { add("rotulo", "POR QUE APARECEU NA BUSCA"); add("texto", c.motivos.join("; ")); }
      if (c.alertas?.length) { add("rotulo", "O QUE CONFERIR"); add("aviso", c.alertas.join("; ")); }
    }
    if (!candidatos.length) add("aviso", "Nenhum candidato encontrado entre os arquivos pesquisáveis. Isso não comprova que o documento não existe.");
    if (!avaliacao&&row.pendencias?.length) { add("rotulo", "PENDÊNCIAS"); add("texto", row.pendencias.join("; ")); }
    const citacoes = (arquivo === null ? row.citacoesTexto : "") || (row.evidencias || []).filter(e => arquivo === null || e.candidatoId === "c" + arquivo).map(e => {
      const c = row.candidatos?.[Number(String(e.candidatoId).replace(/^c/, ""))];
      return (c ? c.caminho + " · " + c.local + ": " : "") + e.trecho;
    }).join("\n\n");
    if (citacoes) { add("rotulo", "CITAÇÕES REGISTRADAS NA AVALIAÇÃO"); add("trecho", citacoes); }
    if (blocos.reduce((total, b) => total + b.texto.length, 0) > 160000) throw new Error("Este pedido é extenso demais para imagem. Escolha um arquivo ou salve o relatório legível completo.");
    return blocos;
  }
  function planejarPaginas(ctx, blocos) {
    const paginas = []; let linhas = [], y = TOPO;
    const novaPagina = () => { paginas.push({ linhas, altura: y + RODAPE }); linhas = []; y = TOPO; if (paginas.length >= MAX_PARTES) throw new Error("O pedido excede 24 imagens. Escolha um arquivo ou salve o relatório legível completo."); };
    for (const bloco of blocos) {
      const tipo = tipos[bloco.tipo]; ctx.font = tipo.fonte;
      const texto = quebrarTexto(ctx, bloco.texto, LARGURA - 2 * MARGEM - 36);
      const reservar = bloco.tipo === "titulo" ? 120 : bloco.tipo === "rotulo" ? 64 : 0;
      if (reservar && linhas.length && y + (tipo.antes || 0) + texto.length * tipo.altura + reservar > ALTURA_MAXIMA - RODAPE) novaPagina();
      for (let i = 0; i < texto.length; i++) {
        let antes = i === 0 ? tipo.antes || 0 : 0;
        if (y + antes + tipo.altura > ALTURA_MAXIMA - RODAPE && linhas.length) { novaPagina(); antes = 0; }
        y += antes; linhas.push({ texto: texto[i], tipo: bloco.tipo, y }); y += tipo.altura;
      }
    }
    if (linhas.length) paginas.push({ linhas, altura: Math.max(620, y + RODAPE) });
    return paginas;
  }
  async function gerarImagens(dados, pedido = 0, arquivo = null, signal) {
    const abortar = () => { if (signal?.aborted) throw Object.assign(new Error("Geração interrompida"), { name: "AbortError" }); };
    abortar();
    const blocos = blocosPedido(dados, pedido, arquivo), canvas = global.document.createElement("canvas");
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Não foi possível iniciar a geração da imagem neste navegador.");
    const paginas = planejarPaginas(ctx, blocos), resultado = [];
    try {
      for (let i = 0; i < paginas.length; i++) {
        abortar(); const p = paginas[i]; canvas.width = LARGURA; canvas.height = p.altura;
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const gradient = ctx.createLinearGradient(0, 0, LARGURA, 160); gradient.addColorStop(0, "#07583c"); gradient.addColorStop(1, "#114f57");
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, LARGURA, 160);
        ctx.textBaseline = "top"; ctx.fillStyle = "#a7e4ca"; ctx.font = "700 18px system-ui"; ctx.fillText("Análise Docs · CONFERÊNCIA DOCUMENTAL", MARGEM, 30);
        ctx.fillStyle = "#ffffff"; ctx.font = "700 36px system-ui"; ctx.fillText("Pedido " + (pedido + 1), MARGEM, 67);
        ctx.font = "18px system-ui"; ctx.fillStyle = "#c6e4d8"; ctx.fillText("Parte " + (i + 1) + " de " + paginas.length, MARGEM, 119);
        for (const linha of p.linhas) {
          const tipo = tipos[linha.tipo];
          if (tipo.fundo) { ctx.fillStyle = tipo.fundo; ctx.fillRect(MARGEM, linha.y - 2, LARGURA - 2 * MARGEM, tipo.altura + 3); }
          ctx.fillStyle = tipo.cor; ctx.font = tipo.fonte; ctx.fillText(linha.texto, MARGEM + 18, linha.y + 2);
        }
        const fy = p.altura - RODAPE + 28;
        ctx.fillStyle = "#d8e5dc"; ctx.fillRect(MARGEM, fy - 12, LARGURA - 2 * MARGEM, 1);
        ctx.fillStyle = "#6e572c"; ctx.font = "600 18px system-ui";
        ctx.fillText(dados.cobertura?.verificacaoParcial ? "COBERTURA DA LEITURA · PARCIAL" : dados.cobertura ? "Cobertura conforme as contagens do relatório" : "Cobertura da leitura não informada", MARGEM, fy);
        ctx.fillStyle = "#577060"; ctx.font = "17px system-ui"; ctx.fillText("Parte " + (i + 1) + "/" + paginas.length, MARGEM, fy + 30);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("O navegador não conseguiu salvar a imagem.")), "image/png"));
        abortar(); resultado.push({ blob, largura: canvas.width, altura: canvas.height, nome: "gemod-pedido-" + (pedido + 1) + "-parte-" + (i + 1) + "-de-" + paginas.length + ".png" });
        await new Promise(resolve => global.setTimeout(resolve, 0));
      }
      return resultado;
    } finally { canvas.width = 1; canvas.height = 1; }
  }
  function abrir(dados, opcoes = {}) {
    if (!dados.resultados?.length) throw new Error("Pesquise a pasta ou abra um CSV salvo antes de gerar uma imagem.");
    instalarEstilos(); global.document.querySelector(".gemod-share-dialog")?.close();
    const dialog = global.document.createElement("dialog"); dialog.className = "gemod-share-dialog";
    dialog.setAttribute("aria-label", "Gerar imagem para compartilhar");
    dialog.innerHTML = '<div class="gemod-share-head"><div><h2>Imagem para compartilhar</h2><p>Confira a prévia e baixe o PNG para anexar em uma mensagem ou documento.</p></div><button type="button" data-fechar>Fechar</button></div><div class="gemod-share-body"><div class="gemod-share-fields"><label>Pedido da SES<select data-pedido></select></label><label>Arquivos na imagem<select data-arquivo></select></label></div><p class="gemod-share-status" role="status" aria-live="polite"></p><button type="button" data-tentar hidden>Tentar gerar novamente</button><div class="gemod-share-pages"></div><p class="gemod-share-note">Geração local, sem consumir créditos de IA. Pedidos extensos são divididos em imagens numeradas, mantendo os textos e caminhos. O download não envia a imagem a outras pessoas.</p></div>';
    const el = s => dialog.querySelector(s), urls = new Set(); let controle = null;
    for (const grupo of Relatorio.agruparDocumentos(dados.resultados)) {
      const optgroup = global.document.createElement("optgroup"); optgroup.label = grupo.titulo;
      grupo.pedidos.forEach(({ row, indice }) => { const option = global.document.createElement("option"); option.value = String(indice); option.textContent = "Pedido " + (indice + 1) + " · " + String(row.providencia || row.descricao || "").slice(0, 85); optgroup.append(option); });
      el("[data-pedido]").append(optgroup);
    }
    el("[data-pedido]").value = String(Number.isInteger(opcoes.pedido) && dados.resultados[opcoes.pedido] ? opcoes.pedido : 0);
    function arquivos() {
      el("[data-arquivo]").replaceChildren();
      const rows = dados.resultados[Number(el("[data-pedido]").value)].candidatos || [];
      for (const [value, label] of [["todos", "Todos os arquivos do pedido (" + rows.length + ")"], ...rows.map((row, i) => [String(i), "Arquivo " + (i + 1) + " · " + (row.nome || Relatorio.partesCaminho(row.caminho).arquivo)])]) {
        const option = global.document.createElement("option"); option.value = value; option.textContent = label; el("[data-arquivo]").append(option);
      }
    }
    function limpar() { for (const url of urls) global.URL.revokeObjectURL(url); urls.clear(); el(".gemod-share-pages").replaceChildren(); }
    async function gerar() {
      controle?.abort(); const atual = controle = new AbortController(); limpar();
      el(".gemod-share-status").textContent = "Preparando a imagem no seu computador…"; el("[data-tentar]").hidden = true;
      el("[data-pedido]").disabled = true; el("[data-arquivo]").disabled = true;
      try {
        const selecao = el("[data-arquivo]").value;
        const imagens = await gerarImagens(dados, Number(el("[data-pedido]").value), selecao === "todos" ? null : Number(selecao), atual.signal);
        if (atual.signal.aborted || !dialog.open) return;
        imagens.forEach((imagem, i) => {
          const url = global.URL.createObjectURL(imagem.blob); urls.add(url);
          const card = global.document.createElement("section"); card.className = "gemod-share-page";
          const head = global.document.createElement("div"); head.className = "gemod-share-page-head";
          const label = global.document.createElement("span"); label.textContent = "Imagem " + (i + 1) + " de " + imagens.length;
          const button = global.document.createElement("button"); button.type = "button"; button.textContent = "Baixar imagem (PNG)";
          button.addEventListener("click", () => { const a = global.document.createElement("a"); a.href = url; a.download = imagem.nome; a.click(); });
          const img = global.document.createElement("img"); img.src = url; img.alt = "Pedido selecionado, caminhos e trechos · parte " + (i + 1) + " de " + imagens.length; img.width = imagem.largura; img.height = imagem.altura; img.loading = "lazy";
          head.append(label, button); card.append(head, img); el(".gemod-share-pages").append(card);
        });
        el(".gemod-share-status").textContent = imagens.length + " imagem(ns) pronta(s). Confira os caminhos e os trechos antes de compartilhar. Baixe cada parte que deseja guardar.";
      } catch (erro) { if (!atual.signal.aborted && dialog.open) { el(".gemod-share-status").textContent = erro.message; el("[data-tentar]").hidden = false; } }
      finally { if (controle === atual) { el("[data-pedido]").disabled = false; el("[data-arquivo]").disabled = false; } }
    }
    arquivos(); el("[data-pedido]").addEventListener("change", () => { arquivos(); gerar(); });
    el("[data-arquivo]").addEventListener("change", gerar); el("[data-tentar]").addEventListener("click", gerar);
    el("[data-fechar]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { controle?.abort(); limpar(); dialog.remove(); });
    global.document.body.append(dialog); dialog.showModal(); gerar(); return dialog;
  }
  function fechar() { global.document.querySelectorAll(".gemod-share-dialog").forEach(dialog => dialog.close()); }
  const api = { abrir, fechar, ativarCopia, quebrarTexto, blocosPedido, planejarPaginas, gerarImagens, LARGURA, ALTURA_MAXIMA };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { global.GemodCompartilhar = api; instalarEstilos(); }
})(typeof window === "undefined" ? globalThis : window);
