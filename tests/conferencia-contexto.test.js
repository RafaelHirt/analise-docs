const { test } = require("node:test");
const assert = require("node:assert/strict");
const contexto = require("../public/conferencia-contexto.js");
const busca = require("../public/conferencia-indexacao.js");

function corpus(contents) {
  const raiz = { name: "Entidade" }, reads = { indice: 0, trechos: 0 };
  const docs = contents.map((content, i) => ({ nome: "arquivo-" + i + ".pdf", caminho: "Entidade/Subpasta/arquivo-" + i + ".pdf",
    handle: { getFile: async () => ({ name: "arquivo-" + i + ".pdf", size: content.texto.length,
      lastModified: content.modified || 1, partes: content.partes || [{ local: "Página " + (content.pagina || 1), texto: content.texto }] }) } }));
  const API = { indexar: async () => ({ docs, erros: [], limite: false }), ler: async (file, signal, options = {}) => {
    if (options.locais) reads.trechos++; else reads.indice++;
    if (signal?.aborted) throw Object.assign(new Error("Interrompida"), { name: "AbortError" });
    return { partes: file.partes, aviso: "" };
  } };
  return { raiz, docs, reads, API };
}
const request = { descricao: "Falta comprovar FGTS", providencia: "Apresentar comprovante de pagamento do FGTS de setembro de 2026", referencia: "09/2026", termosBusca: ["FGTS"] };

test("contextual search recognizes a domain synonym in anonymous files and prioritizes correct competence", async () => {
  const fixture = corpus([
    { texto: "Comprovante FGTS competência 08/2026. Pagamento efetuado. Valor pago R$ 100,00." },
    { texto: "Fundo de Garantia do Tempo de Serviço. Competência 09/2026. Recolhimento efetuado. Autenticação bancária 8990011.", pagina: 7 },
    { texto: "Relatório mensal de valores e informações. Setembro de 2026. Arquivo da entidade." },
  ]);
  const result = await busca.pesquisar(fixture.raiz, [request], fixture.API);
  assert.equal(result.candidatos[0][0].caminho, fixture.docs[1].caminho);
  assert.equal(result.candidatos[0][0].local, "Página 7");
  assert.match(result.candidatos[0][0].trecho, /Fundo de Garantia/);
  assert.ok(!result.candidatos[0].some(c=>c.caminho === fixture.docs[2].caminho));
  assert.ok(result.candidatos[0].find(c=>c.caminho === fixture.docs[0].caminho).alertas.some(s=>/outro período/.test(s)));
});

test("guides and reports mentioning a missing payment do not outrank an actual receipt", async () => {
  const fixture = corpus([
    { texto: "Guia FGTS competência 09/2026, recolhimento a efetuar, boleto emitido R$ 300,00." },
    { texto: "Relatório FGTS 09/2026. Não consta comprovante de pagamento. Apresentar documento." },
    { texto: "FGTS 09/2026. Pagamento efetuado. Autenticação bancária 111222333. Valor pago R$ 300,00." },
  ]);
  const result = await busca.pesquisar(fixture.raiz, [request], fixture.API);
  assert.equal(result.candidatos[0][0].caminho, fixture.docs[2].caminho);
  assert.ok(result.candidatos[0].find(c=>c.caminho === fixture.docs[0].caminho).alertas.some(s=>/não comprova/.test(s)));
  assert.ok(result.candidatos[0].find(c=>c.caminho === fixture.docs[1].caminho).alertas.some(s=>/pendência/.test(s)));
});

test("a request retains complementary invoice and payment evidence with exact distinct NF references", async () => {
  const fixture = corpus([
    { texto: "Nota fiscal 782. Prestação de serviços em setembro de 2026. R$ 5.000,00.", pagina: 3 },
    { texto: "Comprovante de pagamento referente à NF 782. Setembro de 2026. Transferência efetivada de R$ 5.000,00.", pagina: 8 },
    { texto: "Nota fiscal 7820. Setembro de 2026. Valor R$ 5.000,00." },
  ]);
  const result = await busca.pesquisar(fixture.raiz, [{ descricao: "Apresentar a nota fiscal 782 e o comprovante de pagamento correspondente", providencia: "Conferir nota fiscal e pagamento", referencia: "09/2026" }], fixture.API);
  assert.ok(result.candidatos[0].some(c=>c.caminho === fixture.docs[0].caminho));
  assert.ok(result.candidatos[0].some(c=>c.caminho === fixture.docs[1].caminho));
  const wrong = result.candidatos[0].find(c=>c.caminho === fixture.docs[2].caminho);
  assert.ok(wrong.alertas.some(s=>/NF.*diferente/.test(s)));
});

test("a new SES request reuses the sparse index; changed and deleted source files invalidate it", async () => {
  const content = [{ texto: "FGTS 09/2026. Pagamento efetuado e autenticado." }, { texto: "Guia previdenciária INSS competência 10/2026" }];
  const fixture = corpus(content);
  const first = await busca.pesquisar(fixture.raiz, [request], fixture.API);
  assert.equal(fixture.reads.indice, 2);
  assert.ok(!("texto" in first.cache.arquivos.get(fixture.docs[0].caminho).rows[0]));
  const second = await busca.pesquisar(fixture.raiz, [{ descricao: "INSS 10/2026", providencia: "Apresentar guia previdenciária INSS" }], fixture.API, { cache: first.cache });
  assert.equal(second.cobertura.reaproveitados, 2);
  assert.equal(fixture.reads.indice, 2, "unchanged PDFs are not parsed again for a new requirement");
  content[0].modified = 2; content[0].texto = "Outro documento sem relação com as solicitações";
  await busca.pesquisar(fixture.raiz, [request], fixture.API, { cache: first.cache });
  assert.equal(fixture.reads.indice, 3);
  fixture.docs.splice(1, 1);
  const third = await busca.pesquisar(fixture.raiz, [request], fixture.API, { cache: first.cache });
  assert.equal(third.candidatos[0].length, 0);
  assert.equal(third.cache.arquivos.size, 1);
});

test("identical folder names do not allow reuse of another directory's index", async () => {
  const a = corpus([{ texto: "FGTS 09/2026 pagamento efetuado" }]), b = corpus([{ texto: "FGTS 09/2026 pagamento efetuado" }]);
  const first = await busca.pesquisar(a.raiz, [request], a.API);
  const second = await busca.pesquisar(b.raiz, [request], b.API, { cache: first.cache });
  assert.equal(second.cobertura.reaproveitados, 0);
  assert.notEqual(second.cache, first.cache);
});

test("an edited source during quote recovery is reported instead of returning stale evidence", async () => {
  const fixture = corpus([{ texto: "FGTS 09/2026 pagamento efetuado" }]);
  let metadataReads = 0;
  fixture.docs[0].handle.getFile = async () => ({ name: "arquivo-0.pdf", size: 100,
    lastModified: ++metadataReads, partes: [{ local: "Página 1", texto: "FGTS 09/2026 pagamento efetuado" }] });
  const result = await busca.pesquisar(fixture.raiz, [request], fixture.API);
  assert.equal(result.candidatos[0].length, 0);
  assert.equal(result.cobertura.verificacaoParcial, true);
  assert.equal(result.cobertura.arquivosAlterados, 1);
});

test("competence extraction does not mistake a date of issue for MM/YYYY, and keeps formatted CNPJ and amounts", () => {
  const value = contexto.fatos("Emitido em 01/10/2026. Competência setembro de 2026. CNPJ 12.345.678/0001-90. NF 000782. R$ 55.451,79.");
  assert.deepEqual(value.periodos, ["2026-09"]);
  assert.ok(value.ids.includes("cnpj:12345678000190"));
  assert.ok(value.ids.includes("nf:782"));
  assert.deepEqual(value.valores, ["55451.79"]);
});

test("complementary pages can share document context without silently asserting their link", async()=>{
  const fixture=corpus([{texto:"Fictício",partes:[
    {local:"Página 1",texto:"Guia do Fundo de Garantia do Tempo de Serviço. Competência 09/2026. R$ 100,00."},
    {local:"Página 2",texto:"Comprovante de pagamento. Setembro de 2026. Pagamento efetuado. Valor pago R$ 100,00."},
  ]}]);
  const result=await busca.pesquisar(fixture.raiz,[request],fixture.API);
  const payment=result.candidatos[0].find(candidate=>candidate.local==="Página 2");
  assert.ok(payment);
  assert.ok(payment.alertas.some(warning=>/outra página.*vínculo/.test(warning)));
  assert.ok(result.candidatos[0].some(candidate=>candidate.local==="Página 1"));
});

test("literal evidence is revalidated even when the file size and modification time were preserved", async()=>{
  const fixture=corpus([{texto:"FGTS 09/2026 pagamento efetuado"}]);
  const read=fixture.API.ler;
  fixture.API.ler=async(file,signal,options)=>options.locais?
    {partes:[{local:"Página 1",texto:"INSS 09/2026 pagamento anulado"}],aviso:""}:read(file,signal,options);
  const result=await busca.pesquisar(fixture.raiz,[request],fixture.API);
  assert.equal(result.candidatos[0].length,0);
  assert.equal(result.cobertura.arquivosAlterados,1);
  assert.equal(result.cache.arquivos.size,0,"stale signatures must not be reused in a later query");
});
