(function () {
  "use strict";
  const el = id => document.getElementById(id);
  const Relatorio = window.GemodRelatorio, Fontes = window.GemodFontesSES;
  let dados = null, versao = 0, render = 0, pronta = false, documentos = [], lendo = null;
  const botoes = () => {
    for (const id of ["relatorio-salvar", "relatorio-imprimir", "relatorio-imagem"]) el(id).disabled = !dados || !pronta || !!lendo;
    el("relatorio-aplicar-fontes").disabled = !dados || !!lendo || !el("relatorio-paginas-ses").querySelector('[data-pagina]:not([data-vazia])');
  };
  function exibir() {
    const atual = ++render; pronta = false; botoes();
    el("relatorio-previa").onload = () => {
      if (atual !== render || el("relatorio-previa").contentDocument?.title !== "Análise Docs · Caminhos das evidências") return;
      pronta = true; botoes();
    };
    el("relatorio-previa").srcdoc = Relatorio.gerarHTML(dados);
    el("relatorio-visualizacao").hidden = false;
  }
  function option(valor, texto) { const o = document.createElement("option"); o.value = valor; o.textContent = texto; return o; }
  function campo(titulo, controle) { const label = document.createElement("label"); label.append(document.createTextNode(titulo), controle); return label; }
  function selecoes() {
    const titulos = el("relatorio-documentos-ses"), pedidos = el("relatorio-paginas-ses");
    titulos.replaceChildren(); pedidos.replaceChildren();
    documentos.forEach((doc, i) => {
      const input = document.createElement("input"); input.value = doc.titulo; input.dataset.tituloSes = String(i); input.maxLength = 300;
      titulos.append(campo("Identificação · " + doc.nome, input));
    });
    dados.resultados.forEach((row, i) => {
      const card = document.createElement("section"); card.className = "fonte-pedido"; card.dataset.fontePedido = String(i);
      const h = document.createElement("h3"); h.textContent = "Pedido " + (i + 1) + " · " + row.origem;
      const pedido = document.createElement("p"); pedido.textContent = row.providencia;
      const documento = document.createElement("select"), pagina = document.createElement("select");
      documento.dataset.documento = String(i); pagina.dataset.pagina = String(i); pagina.dataset.vazia = "true";
      documento.append(option("", "Selecione o documento da SES"));
      documentos.forEach((doc, j) => documento.append(option(String(j), doc.titulo + " · " + doc.nome)));
      const preview = document.createElement("pre"); preview.className = "fonte-contexto"; preview.hidden = true;
      function atualizarPreview() {
        const doc = documentos[Number(documento.value)], p = pagina.value === "" ? null : doc?.paginas[Number(pagina.value)];
        if (p) { delete pagina.dataset.vazia; preview.textContent = p.texto; preview.hidden = false; }
        else { pagina.dataset.vazia = "true"; preview.textContent = ""; preview.hidden = true; }
        botoes();
      }
      function paginas() {
        pagina.replaceChildren(option("", "Selecione a página de origem do pedido"));
        const doc = documento.value === "" ? null : documentos[Number(documento.value)];
        pagina.disabled = !doc;
        if (doc) doc.paginas.forEach((p, j) => pagina.append(option(String(j), p.local + (p.parcial ? " · recorte" : ""))));
        atualizarPreview();
      }
      const correspondentes = documentos.map((doc, j) => ({ doc, j })).filter(p => p.doc.nome === row.origem);
      if (correspondentes.length === 1) documento.value = String(correspondentes[0].j);
      paginas();
      if (documento.value !== "") {
        const doc = documentos[Number(documento.value)], numero = Fontes.numeroPagina(row.local);
        const j = doc.paginas.findIndex(p => numero && Fontes.numeroPagina(p.local) === numero);
        if (j >= 0) { pagina.value = String(j); atualizarPreview(); }
      }
      documento.addEventListener("change", paginas); pagina.addEventListener("change", atualizarPreview);
      card.append(h, pedido, campo("Documento da SES", documento), campo("Página", pagina), preview); pedidos.append(card);
    });
    botoes();
  }
  el("relatorio-csv").addEventListener("change", async () => {
    const atual = ++versao, arquivo = el("relatorio-csv").files?.[0];
    lendo?.abort(); lendo = null; documentos = []; dados = null; pronta = false; ++render;
    el("relatorio-documentos-ses").replaceChildren(); el("relatorio-paginas-ses").replaceChildren(); el("relatorio-ses").value = "";
    el("relatorio-fontes").hidden = true; el("relatorio-visualizacao").hidden = true; el("relatorio-previa").srcdoc = ""; botoes();
    if (!arquivo) { el("relatorio-status").textContent = "Selecione o CSV para visualizar o relatório."; return; }
    el("relatorio-status").textContent = "Organizando os resultados salvos… Nenhuma chamada à IA será feita.";
    try {
      if (!Relatorio) throw new Error("Não foi possível carregar o organizador de relatórios. Reabra esta página.");
      if (arquivo.size > Relatorio.MAX_CSV) throw new Error("CSV acima do limite de 12 MiB.");
      const texto = await arquivo.text(); if (atual !== versao) return;
      dados = Relatorio.importarCSV(texto, arquivo.name); exibir(); el("relatorio-fontes").hidden = false;
      const ausentes = dados.resultados.filter(row => !row.contextoSES && !row.fonteVerificada).length;
      el("relatorio-fontes-status").textContent = ausentes ? ausentes + " pedido(s) sem contexto da SES no CSV. Selecione os PDFs originais e confira a página de cada pedido. A leitura será local, sem cobrança de IA." : "O CSV já contém as fontes dos pedidos. Os PDFs originais podem ser selecionados para revisar as páginas, sem chamada à IA.";
      el("relatorio-status").textContent = dados.resultados.length + " pedido(s) organizado(s) por documento da SES.";
    } catch (erro) { if (atual === versao) { dados = null; pronta = false; botoes(); el("relatorio-status").textContent = erro.message; } }
  });
  el("relatorio-ses").addEventListener("change", async () => {
    lendo?.abort(); const atual = lendo = new AbortController(), csv = versao;
    documentos = []; el("relatorio-documentos-ses").replaceChildren(); el("relatorio-paginas-ses").replaceChildren(); botoes();
    try {
      const arquivos = [...el("relatorio-ses").files];
      if (arquivos.length > 8) throw new Error("Selecione até 8 documentos da SES por vez.");
      for (let i = 0; i < arquivos.length; i++) {
        const arquivo = arquivos[i], paginas = [];
        if (!/\.pdf$/i.test(arquivo.name)) throw new Error("Selecione os PDFs originais da SES.");
        el("relatorio-fontes-status").textContent = "Lendo localmente: " + arquivo.name;
        const lido = await window.GemodConferencia.ler(arquivo, atual.signal, { indiceCompleto: true, onParte: parte => {
          if (paginas.length >= 500) throw new Error("O documento SES excede 500 páginas com texto.");
          paginas.push({ local: parte.local, texto: parte.texto.slice(0, 6000), parcial: parte.texto.length > 6000 });
        } });
        if (atual.signal.aborted || csv !== versao) return;
        if (!paginas.length) throw new Error(arquivo.name + ": " + (lido.aviso || "PDF sem texto selecionável; é necessário OCR."));
        documentos.push({ id: "anexo-" + (i + 1), nome: arquivo.name, titulo: Fontes.identificarDocumento(arquivo.name, paginas), paginas });
      }
      el("relatorio-fontes-status").textContent = "Confira a identificação dos documentos, selecione as páginas e confirme para atualizar o relatório. Nenhuma chamada à IA foi feita.";
    } catch (erro) { if (!atual.signal.aborted && csv === versao) { documentos = []; el("relatorio-fontes-status").textContent = erro.message; } }
    finally { if (lendo === atual) { lendo = null; if (dados && csv === versao) selecoes(); botoes(); } }
  });
  el("relatorio-aplicar-fontes").addEventListener("click", () => {
    if (!dados || lendo) return;
    documentos.forEach((doc, i) => { doc.titulo = el("relatorio-documentos-ses").querySelector('[data-titulo-ses="' + i + '"]').value.trim() || doc.nome; });
    let alterados = 0;
    dados.resultados = dados.resultados.map((row, i) => {
      const card = el("relatorio-paginas-ses").querySelector('[data-fonte-pedido="' + i + '"]');
      const d = card?.querySelector("[data-documento]").value, p = card?.querySelector("[data-pagina]").value;
      if (d === undefined || d === "" || p === "") return row;
      const documento = documentos[Number(d)], pagina = documento.paginas[Number(p)]; alterados++;
      const atualizado = Fontes.aplicarPagina(row, documento, pagina);
      atualizado.contextoParcial ||= pagina.parcial;
      return atualizado;
    });
    exibir(); el("relatorio-fontes-status").textContent = alterados + " pedido(s) atualizado(s) com o contexto das páginas selecionadas. Os resultados da pasta foram preservados.";
  });
  el("relatorio-salvar").addEventListener("click", () => {
    if (!dados || !pronta || lendo) return;
    Relatorio.baixarHTML(dados);
    el("relatorio-status").textContent = "Download solicitado. Abra o arquivo .html salvo para consultar os documentos da SES, pedidos e evidências.";
  });
  el("relatorio-imprimir").addEventListener("click", () => {
    if (!dados || !pronta || lendo) return;
    const frame = el("relatorio-previa"); frame.contentDocument.querySelectorAll("details").forEach(detalhes => { detalhes.open = true; });
    frame.contentWindow.focus(); frame.contentWindow.print();
  });
  el("relatorio-imagem").addEventListener("click", () => {
    if (!dados || !pronta || lendo) return;
    try { if (!window.GemodCompartilhar) throw new Error("Gerador de imagens indisponível. Reabra esta página."); window.GemodCompartilhar.abrir(dados); }
    catch (erro) { el("relatorio-status").textContent = erro.message; }
  });
})();
