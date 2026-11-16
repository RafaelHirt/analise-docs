import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const require = createRequire(import.meta.url);
const { pesquisar } = require("../public/conferencia-indexacao.js");
const raiz = { name: "Entidade fictícia" };
let indexados = 0, citacoes = 0;
const docs = Array.from({ length: 7000 }, (_, i) => ({ nome: `arquivo-${i}.pdf`, caminho: `Entidade/Subpasta/arquivo-${i}.pdf`,
  handle: { getFile: async () => ({ name: `arquivo-${i}.pdf`, size: 500, lastModified: 1, i }) } }));
const API = {
  indexar: async () => ({ docs, erros: [], limite: false }),
  ler: async (file, signal, options = {}) => {
    if (options.locais) citacoes++; else indexados++;
    const texto = file.i === 6999 ? "Fundo de Garantia do Tempo de Serviço. Competência 09/2026. Recolhimento efetuado. Autenticação bancária 887788."
      : file.i === 6890 ? "Guia INSS competência 10/2026. Contribuição previdenciária."
      : "Registro administrativo de rotina. Valores e informações do exercício. Setembro de 2026.";
    return { partes: [{ local: "Página 4", texto }], aviso: "" };
  },
};
const inicio = performance.now();
const primeiro = await pesquisar(raiz, [{ descricao: "Comprovar pagamento de FGTS de setembro de 2026", providencia: "Apresentar comprovante do FGTS", referencia: "09/2026" }], API);
const fimIndice = performance.now();
assert.equal(primeiro.candidatos[0][0].caminho, docs[6999].caminho);
const segundo = await pesquisar(raiz, [{ descricao: "Apresentar guia de contribuição previdenciária", providencia: "Conferir INSS", referencia: "10/2026" }], API, { cache: primeiro.cache });
assert.equal(segundo.candidatos[0][0].caminho, docs[6890].caminho);
assert.equal(indexados, 7000);
assert.equal(segundo.cobertura.reaproveitados, 7000);
console.log(JSON.stringify({ cenario: "7000 documentos simulados; não mede extração de PDFs reais nem desempenho no computador do usuário",
  primeiraBuscaMs: Math.round(fimIndice-inicio), segundaBuscaMs: Math.round(performance.now()-fimIndice),
  arquivosIndexados: indexados, indicesReaproveitados: segundo.cobertura.reaproveitados,
  arquivosReabertosParaCitacao: citacoes, consultasAPI: 0, indiceBytesEstimados: primeiro.cache.bytes }, null, 2));
