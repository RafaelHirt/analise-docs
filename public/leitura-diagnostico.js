(function(global){
  "use strict";
  function diagnosticar(erro,caminho,etapa="listar pasta"){
    const codigo=String(erro?.name||"Error").slice(0,100),mensagem=String(erro?.message||"").slice(0,1000);
    const conhecidos={
      NotAllowedError:["O navegador recusou a permissão de leitura.","Selecione a pasta novamente e permita a leitura. Se o erro continuar, verifique a permissão dessa pasta no computador."],
      SecurityError:["O navegador bloqueou o acesso por uma restrição de segurança.","Abra o sistema por HTTPS no Chrome ou Edge e selecione novamente a pasta. Verifique também restrições impostas ao navegador."],
      NotFoundError:["O navegador informou que a pasta ou o arquivo não foi encontrado.","Confira se foi movido, renomeado ou excluído e se o disco ou a pasta de rede continua conectado."],
      NotReadableError:["O navegador encontrou o item, mas não conseguiu lê-lo.","Tente abrir o item no explorador de arquivos. Se estiver em nuvem ou rede, confirme que está disponível localmente; sincronização, bloqueio ou falha do disco são possibilidades a verificar."],
      InvalidStateError:["O acesso ao item não estava em um estado válido.","Feche alterações em andamento e selecione a pasta novamente. O código, sozinho, não identifica a causa no computador."],
      AbortError:["A leitura foi interrompida.","Tente novamente quando desejar continuar. Uma interrupção não significa que a pasta está vazia."],
      PasswordException:["O PDF exige senha para leitura.","Abra uma cópia autorizada sem proteção por senha para permitir a extração do texto."],
      InvalidPDFException:["O leitor rejeitou a estrutura do PDF.","Tente abrir o PDF no computador e obtenha uma cópia íntegra. A extensão .pdf não comprova que o arquivo é um PDF válido."],
      MissingPDFException:["O leitor não recebeu o conteúdo do PDF.","Confirme que o arquivo está disponível no computador e tente selecioná-lo novamente."]
    };
    const [causa,orientacao]=conhecidos[codigo]||["A leitura falhou; o navegador ou leitor não forneceu uma causa específica reconhecida.","Confira o código e a mensagem original abaixo. Não é possível concluir que seja nome longo, quantidade de PDFs ou falta de créditos apenas com este erro."];
    return {caminho:String(caminho||""),codigo,mensagem,etapa,motivo:codigo+": "+causa,orientacao};
  }
  const api={diagnosticar};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else global.GemodLeituraDiagnostico=api;
})(typeof window==="undefined"?globalThis:window);
