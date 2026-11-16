(function (global) {
  "use strict";
  const pendentes = new Map();
  function script(url) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = url;
      el.onload = resolve;
      el.onerror = () => { el.remove(); reject(new Error("Não foi possível carregar o leitor de documentos. Verifique a conexão e tente novamente.")); };
      document.head.appendChild(el);
    });
  }
  async function carregar(extensao) {
    const tipo = String(extensao).toLowerCase();
    if (["xls", "xlsb"].includes(tipo)) throw new Error("Planilha Excel legada: converta uma cópia para .xlsx para pesquisar o conteúdo. O arquivo foi contado no inventário.");
    const key = tipo === "pdf" ? "pdf" : tipo === "docx" ? "word"
      : ["xlsx", "xls", "xlsm", "xlsb", "xltx", "xltm", "xlam"].includes(tipo) ? "excel" : null;
    if (!key || key === "pdf" && global.pdfjsLib || key === "word" && global.mammoth || key === "excel" && global.XLSX) return;
    if (!pendentes.has(key)) {
      const task = key === "pdf"
        ? import("/vendor/pdf.min.mjs").then((pdf) => {
          pdf.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
          global.pdfjsLib = pdf;
        })
        : script(key === "word" ? "/vendor/mammoth.browser.min.js"
          : "/vendor/exceljs.min.js").then(() => {
            if (key === "excel") global.XLSX = {
              async read(data) {
                const workbook = await new global.ExcelJS.Workbook().xlsx.load(data);
                return { SheetNames: workbook.worksheets.map(s => s.name), Sheets: Object.fromEntries(workbook.worksheets.map(s => [s.name, s])) };
              },
              utils: { sheet_to_csv(sheet, options) {
                const rows = [];
                sheet.eachRow(row => {
                  const cells = [];
                  for (let col = 1; col <= row.cellCount; col++) cells.push(row.getCell(col).text);
                  rows.push(cells.join(options.FS));
                });
                return rows.join(options.RS);
              } },
            };
          });
      pendentes.set(key, task.catch((error) => { pendentes.delete(key); throw error; }));
    }
    await pendentes.get(key);
  }
  global.GemodLeitores = { carregar };
})(window);
