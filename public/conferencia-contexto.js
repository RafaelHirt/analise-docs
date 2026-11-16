(function (global) {
  "use strict";
  // Query expansion, document concepts and exact references run locally. This
  // is not a neural embedding model or a finding of documentary compliance.
  const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const stop = new Set(norm("a o as os de da do das dos em no na nos nas um uma uns umas e ou para por com sem que se ao aos " +
    "apresentar apresentado apresentada apresentar comprovar comprovação documento documentos arquivo arquivos ses entidade " +
    "solicitamos solicitar solicitado solicita ausencia ausente necessario necessaria referente referentes conforme " +
    "valor valores informacao informacoes relatorio relatorios mensal mes meses exercicio ano competencia periodo " +
    "nao consta constam item itens numero anexo anexos forma todos todas sobre deve devera analise observacao observacoes").split(/\s+/));
  const groups = [
    ["fgts", /\bfgts\b|fundo de garantia/],
    ["previdencia", /\binss\b|previdenciari|\bgps\b|\bdctfweb\b/],
    ["fiscal", /\btribut|\bimpost|regularidade fiscal/],
    ["trabalho", /\bfolha de pagamento|\bsalario|\bremuneracao|\bcontracheque|\bholerite/],
    ["escala", /\bescala|\bplantao|\bplantoes|jornada de trabalho/],
    ["producao", /\bsigtap\b|producao assistencial|procedimentos realizados|atendimentos realizados/],
    ["leitos", /\bleitos?\b|taxa de ocupacao|paciente dia/],
    ["nota_fiscal", /\bnotas? fisca(?:l|is)\b|\bnf(?:e|se)?\b|\bdanfe\b|documento fiscal/],
    ["pagamento", /\bpagamentos?\b|\bquitacao\b|\brecolhimento\b|\btransferencia\b|\brecolhid[oa]\b|\bpago\b|\bpag[oa]s\b/],
    ["guia", /\bguias?\b|\bboletos?\b|documento de arrecadacao/],
    ["certidao", /\bcertid(?:ao|oes)\b|\bcrf\b|\bcnd\b|regularidade do empregador/],
    ["extrato", /\bextratos?\b|movimentacao bancaria/],
    ["contrato", /\bcontratos?\b|termo aditivo|instrumento contratual/],
  ];
  const labels = { fgts: "FGTS", previdencia: "contribuição previdenciária", fiscal: "tributos",
    trabalho: "folha/remuneração", escala: "escala de trabalho", producao: "produção assistencial", leitos: "leitos",
    nota_fiscal: "nota fiscal", pagamento: "pagamento/recolhimento", guia: "guia/boleto", certidao: "certidão",
    extrato: "extrato bancário", contrato: "contrato" };
  const proofKinds = new Set(["nota_fiscal", "pagamento", "guia", "certidao", "extrato", "contrato"]);
  const months = "janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro".split(" ");
  const unique = values => [...new Set(values)];
  async function assinatura(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await global.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), value=>value.toString(16).padStart(2,"0")).join("");
  }
  const concepts = text => groups.filter(([, pattern]) => pattern.test(norm(text))).map(([id]) => id);
  const terms = text => unique(norm(text).split(/\s+/).filter(t => t.length >= 3 && !stop.has(t)));
  function facts(text) {
    const clean = norm(text), periods = [], ids = [], amounts = [];
    const original = String(text || "");
    // A date of issue is not automatically the document's competence.
    const noDates = original.replace(/\b\d{1,2}[/.]\d{1,2}[/.]20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/g, " ");
    for (const match of noDates.matchAll(/\b(0?[1-9]|1[0-2])[/-](20\d{2})\b/g)) periods.push(match[2] + "-" + match[1].padStart(2, "0"));
    months.forEach((month, index) => {
      for (const match of clean.matchAll(new RegExp("\\b(?:" + month + "|" + month.slice(0,3) + ")(?: de)? (20\\d{2})\\b", "g")))
        periods.push(match[1] + "-" + String(index + 1).padStart(2, "0"));
    });
    for (const match of original.matchAll(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/g)) ids.push("cnpj:" + match[1].replace(/\D/g, ""));
    for (const match of clean.matchAll(/\b(?:nf(?:e|se| e| se)?|nota fiscal(?: eletronica)?|documento fiscal)(?: numero| n| no)? (\d{1,12})\b/g)) ids.push("nf:" + match[1].replace(/^0+(?=\d)/, ""));
    for (const match of original.matchAll(/\bSEI\s*(?:n[ºo°.]?\s*)?([\d./-]{6,30})/gi)) ids.push("sei:" + match[1].replace(/\D/g, ""));
    for (const match of original.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)) amounts.push(match[1].replace(/\./g, "").replace(",", "."));
    return { periodos: unique(periods), ids: unique(ids), valores: unique(amounts) };
  }
  function plano(item) {
    const base = [item.descricao, item.providencia, item.referencia].filter(Boolean).join(" ");
    const expansion = [...(item.termosBusca || []), ...(item.consultasAlternativas || [])].join(" ");
    return { termos: terms(base + " " + expansion).slice(0, 90), conceitos: concepts(base + " " + expansion),
      ...facts(base), texto: base };
  }
  function descrever(texto, local, inicio, fim, vocabulary) {
    const tokens = terms(texto).slice(0, 300).map(term => {
      if (!vocabulary.has(term) && vocabulary.size < 250000) vocabulary.set(term, vocabulary.size + 1);
      return vocabulary.get(term);
    });
    const normal = norm(texto);
    return { tokens: new Uint32Array(tokens), local, inicio, fim, conceitos: concepts(texto), ...facts(texto),
      mencao: /\b(?:ausencia|ausente|pendente|solicita|apresentar|nao apresentou|nao consta|nao foi apresentado)\b/.test(normal),
      quitado: /\b(?:autenticacao bancaria|autenticacao eletronica|pagamento efetuado|pagamento realizado|pagamento concluido|transferencia efetivada|transferencia concluida|valor pago|quitad[oa]|recolhimento efetuado)\b/.test(normal) };
  }
  function fragmentar(parte, vocabulary) {
    const text = String(parte.texto || ""), result = [];
    for (let start = 0; start < text.length; start += 1300) {
      const end = Math.min(start + 1600, text.length);
      if (text.slice(start, end).trim()) result.push(descrever(text.slice(start, end), parte.local, start, end, vocabulary));
      if (end === text.length) break;
    }
    return result;
  }
  function pontuar(plan, row, vocabulary, postings, count, fileContext = { conceitos: [] }) {
    const matches = plan.termos.filter(term => row.tokens.includes(vocabulary.get(term)));
    const shared = plan.conceitos.filter(concept => row.conceitos.includes(concept));
    const subjects = shared.filter(id => !proofKinds.has(id));
    const sameIds = plan.ids.filter(id => row.ids.includes(id));
    const samePeriods = plan.periodos.filter(period => row.periodos.includes(period));
    const sameAmounts = plan.valores.filter(amount => row.valores.includes(amount));
    const significant = matches.filter(term => !/^20\d{2}$/.test(term) && !months.includes(term));
    const related = plan.conceitos.filter(id => !proofKinds.has(id) && fileContext.conceitos.includes(id));
    const pageContext = !subjects.length && related.length && (sameIds.length || samePeriods.length) && row.conceitos.some(id=>proofKinds.has(id));
    if (plan.conceitos.some(id => !proofKinds.has(id)) && !subjects.length && !sameIds.length && significant.length < 2 && !pageContext) return null;
    // A common word, year or monetary value by itself is not a useful match.
    if (!shared.length && !sameIds.length && significant.length < 2) return null;
    let lexical = 0;
    for (const term of significant) lexical += Math.log(1 + count / (1 + (postings.get(vocabulary.get(term))?.length || 0)));
    if (!shared.length && !sameIds.length && lexical < 2) return null;
    let points = lexical + shared.length * 9 + subjects.length * 9 + sameIds.length * 45 + samePeriods.length * 25 + sameAmounts.length * 12;
    const reasons = [], warnings = [];
    if (pageContext) { points += 8; warnings.push("O assunto aparece em outra página do arquivo; confirmar o vínculo entre as evidências"); }
    if (shared.length) reasons.push("Contexto: " + shared.map(id => labels[id]).join(", "));
    if (sameIds.length) reasons.push("Referência exata: " + sameIds.join(", "));
    if (samePeriods.length) reasons.push("Período citado: " + samePeriods.join(", "));
    if (sameAmounts.length) reasons.push("Valor citado coincide");
    if (plan.periodos.length && row.periodos.length && !samePeriods.length) {
      points -= 42; warnings.push("O trecho cita outro período: " + row.periodos.join(", "));
    }
    const idTypes = unique(plan.ids.map(id => id.split(":")[0]));
    for (const type of idTypes) {
      if (row.ids.some(id => id.startsWith(type + ":")) && !sameIds.some(id => id.startsWith(type + ":"))) {
        points -= 30; warnings.push("Referência de " + type.toUpperCase() + " diferente no trecho");
      }
    }
    if (row.quitado && plan.conceitos.includes("pagamento")) { points += 20; reasons.push("Há indicação textual de pagamento realizado"); }
    if (row.conceitos.includes("guia") && plan.conceitos.includes("pagamento") && !row.quitado) {
      points -= 12; warnings.push("Guia ou boleto não comprova, por si só, o pagamento");
    }
    if (row.mencao) { points -= 18; warnings.push("Pode ser menção a uma pendência ou solicitação; conferir o documento"); }
    if (plan.conceitos.includes("pagamento") && !row.conceitos.includes("pagamento") && row.conceitos.includes("nota_fiscal"))
      warnings.push("Nota fiscal, isoladamente, não comprova pagamento");
    if (!reasons.length && significant.length) reasons.push("Termos específicos: " + significant.slice(0, 6).join(", "));
    return { pontos: points, achados: unique([...matches, ...shared.map(id => labels[id])]).slice(0, 12), motivos: reasons, alertas: warnings };
  }
  function selecionar(scored, plan, max = 6) {
    const selected = [], covered = new Set(), counts = new Map();
    const remaining = scored.slice().sort((a, b) => b.pontos - a.pontos || a.arquivo.caminho.localeCompare(b.arquivo.caminho));
    while (selected.length < max && remaining.length) {
      let position = -1, best = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i], path = candidate.arquivo.caminho;
        if ((counts.get(path) || 0) >= 3) continue;
        if (selected.some(s => s.arquivo === candidate.arquivo && s.row.local === candidate.row.local
          && Math.abs(s.row.inicio - candidate.row.inicio) < 1000)) continue;
        const bonus = plan.conceitos.filter(id => proofKinds.has(id) && candidate.row.conceitos.includes(id) && !covered.has(id)).length * 16;
        const score = candidate.pontos + bonus;
        if (score > best) { position = i; best = score; }
      }
      if (position < 0) break;
      const [candidate] = remaining.splice(position, 1);
      selected.push(candidate);
      counts.set(candidate.arquivo.caminho, (counts.get(candidate.arquivo.caminho) || 0) + 1);
      candidate.row.conceitos.forEach(id => covered.add(id));
    }
    return selected;
  }
  const api = { norm, termos: terms, fatos: facts, plano, fragmentar, pontuar, selecionar, assinatura };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GemodContexto = api;
})(typeof window === "undefined" ? globalThis : window);
