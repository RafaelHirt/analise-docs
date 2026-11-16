# Conferência contextual com consumo controlado

O fluxo mantém a leitura da pasta da entidade no navegador. A API de IA interpreta os ofícios SES e, separadamente, confere somente pedidos e trechos escolhidos pela pessoa usuária. Não existe chamada paga por PDF da entidade, upload da pasta ou vetorização paga do acervo.

## Uso

1. Selecione a pasta da entidade e anexe os ofícios SES.
2. Use **Preparar ofícios e estimar consultas (local)**. A tela extrai o texto sem envio à API e informa a quantidade de consultas. Com a autorização marcada, **Interpretar ofícios com IA** envia os blocos. Preparação parcial é avisada antes do envio. Também é possível digitar os pedidos sem usar IA.
3. Revise a identificação de cada documento SES, problema, providência, referências e contexto original. A identificação é extraída do cabeçalho localmente, com edição disponível; sem cabeçalho reconhecido, usa o nome do arquivo. A revisão mostra um PDF por vez, na ordem de seleção: confira o primeiro e use **Conferir próximo documento** ou os botões com os títulos para alternar. As edições dos documentos anteriores são mantidas. Pesquise a pasta, com leitura sequencial por página, interrupção e retomada. O andamento e a opção de interromper aparecem junto ao botão de pesquisa. Se a interpretação estiver incompleta, a tela explica o bloqueio e permite retomar somente os blocos pendentes. Até seis trechos por pedido preservam fontes ou páginas complementares.
4. Ao concluir a busca, a tela leva aos resultados. Abra **Ver caminhos e trechos** em cada apontamento para conferir caminho relativo, página, citação literal, motivos e alertas. **Abrir PDF na página** abre o arquivo local após verificar se mudou desde a pesquisa.
5. Selecione apenas os pedidos para conferência pela IA. O resumo informa pedidos, trechos e quantidade de consultas antes do envio. Lotes têm até quatro pedidos e seis trechos por pedido, com limite de caracteres. Nada é enviado automaticamente após a busca local.
   Depois da avaliação, a tela leva diretamente ao bloco **Resultado da IA**, no início do pedido, com situação, justificativa, pendências e links para os arquivos citados. A resposta **Não foi possível verificar com os trechos recebidos** também exibe sua justificativa; ela não equivale à ausência de avaliação. O texto completo do pedido e a fonte original ficam em **Ver pedido completo e origem na SES**.
   A contagem distingue pedidos selecionados, trechos, avaliações já disponíveis e novas consultas. Selecionar um pedido já avaliado mostra, por exemplo, **1 pedido selecionado · 6 trechos · 1 avaliação já disponível · 0 novas consultas à IA**. **Ver resultado da IA** abre a avaliação existente sem enviar dados nem exigir uma nova autorização de envio. O atalho também funciona após reabrir uma análise salva, mesmo sem pedidos marcados. Uma nova busca local reaproveita e exibe imediatamente avaliações cujos pedidos e trechos continuam idênticos.
6. Use **Salvar relatório legível** para baixar um HTML independente, separado por documento SES e seus pedidos. Cada pedido mostra sua página e o trecho/contexto original antes dos caminhos e citações dos arquivos da entidade. Instruções de uso, nome do CSV, data de criação, observação genérica da busca e situação “IA não executada” não entram no relatório. Contagens de cobertura ficam ao final. O arquivo abre depois sem internet e pode ser impresso como PDF. Os PDFs originais permanecem na pasta da entidade; os caminhos são relativos à pasta selecionada. O CSV continua disponível para uso em planilhas.
7. O caminho aparece como uma sequência de pastas, com o nome do arquivo e a página em destaque. Na tela de evidências, **Copiar caminho** copia o texto original, preservando nomes e separadores. **Ver caminho completo** permite selecionar o texto manualmente.

## Salvar e voltar à análise

Em **Minhas análises**, informe um nome e use **Salvar análise**. Aguarde a confirmação **Salvo** antes de fechar a tela. O botão **Salvar análise para continuar depois**, junto aos resultados, faz a mesma gravação. A lista mostra suas análises por data, etapa, quantidade de pedidos e trechos. Use **Reabrir análise** para recuperar os pedidos revisados, identificação e contexto SES, caminhos, páginas, citações, cobertura, filtro e avaliações concluídas. Reabrir não interpreta novamente os ofícios nem faz chamadas à IA.

As análises ficam no armazenamento da Análise Docs, vinculadas ao login que as criou. Outros usuários, inclusive administradores, não as acessam pelas rotas de análises. A listagem lê apenas resumos em metadados; os textos são recuperados ao abrir um item. Cada gravação valida o tamanho e os campos, e atualizações exigem a versão lida para evitar sobrescritas entre abas. Em conflito, o preenchimento permanece na tela: use **Salvar como nova** para preservar uma cópia ou reabra a versão salva. A gravação inicial usa um identificador estável para que repetir após uma falha de comunicação não crie duplicatas. As versões anteriores são retidas no armazenamento de histórico; esta tela ainda não oferece restauração de versões. Este aplicativo não inclui o backup administrativo do GEMOD. Exporte relatórios para guardar uma cópia dos resultados.

Os PDFs integrais, permissões de acesso, handles de arquivos e índice da pasta não são enviados ao salvamento. Para abrir um PDF original ou iniciar outra busca, use **Selecionar pasta desta análise**, escolhendo a mesma pasta principal. A Análise Docs resolve o caminho salvo e confere tamanho, data e assinatura do trecho na página ao abrir o arquivo; não enumera todo o acervo nessa vinculação. Se o arquivo mudou, é necessária uma nova pesquisa. Uma nova pesquisa após reabrir reconstrói o índice local, sem consumo de IA; os resultados salvos continuam consultáveis enquanto isso.

Também é possível salvar a interpretação SES preparada ou incompleta: os textos dos blocos ainda pendentes são armazenados para permitir a retomada, e os corpos dos blocos já concluídos são descartados. O progresso volta exatamente no bloco faltante; a autorização para envio à IA precisa ser marcada novamente. Falhas sem resposta confirmada podem exigir nova consulta ao bloco interrompido. Uma busca local interrompida pode ser salva com os pedidos e resultados anteriores, mas precisará reiniciar a leitura local ao reabrir.

O salvamento é manual. Alterações posteriores exigem novo clique; sair com mudanças não salvas exibe confirmação. Antes de atualizar uma aba para uma nova versão da Análise Docs, salve a análise e depois reabra-a em **Minhas análises**. Limites por análise: 3 MiB, 60 pedidos, 6 candidatos por pedido e 8 blocos SES. Exceder um limite gera mensagem explícita, preservando o trabalho atual; os relatórios HTML/CSV continuam disponíveis. **Nova análise** inicia outra conferência sem apagar os itens já salvos na conta.

## Conferir a leitura antes de pesquisar

Depois de preparar os ofícios, **Confira a leitura dos documentos SES** permite abrir o texto extraído de cada página, separado por arquivo. A preparação é local e pode ser feita mesmo quando a IA não está configurada. Os subitens numerados com verbos de exigência são destacados como pistas para revisão; essa detecção não promete identificar todo tipo de obrigação administrativa.

Um parágrafo introdutório como “não saneou os apontamentos, conforme assinalado abaixo” não substitui os pedidos dos itens 2.1, 2.2 e 2.3. A interpretação é orientada a devolver cada subitem separadamente, com sua numeração, fornecedor, competência, identificadores e valores. O sistema compara as respostas com os itens detectados no texto. Quando falta uma interpretação individual com citação associável ao item, preserva o texto original dele e marca **Texto original do item numerado**. Resumos sem vínculo confirmado ficam visíveis como observações gerais, inicialmente fora da seleção para busca. Essa complementação é local, sem repetir consultas à IA. No fim de cada documento, a conferência usa suas partes completas, incluindo itens que atravessam páginas ou blocos. Ao retomar uma análise salva, não reclassifica os resultados concluídos usando apenas o texto dos blocos ainda pendentes.

**Usar itens numerados do texto original (sem IA)** aproveita diretamente esses subitens. Confira o restante do PDF: exigências sem numeração, condições gerais, prazos e alternativas podem precisar de revisão ou inclusão manual. O método não interpreta por conta própria relações jurídicas, valores de tabelas ou requisitos implícitos. O número do item e o contexto literal acompanham o salvamento e as exportações HTML/CSV/PNG.

## Entender as falhas de leitura

O aviso de pastas inacessíveis ocorre na listagem dos diretórios, antes de abrir o conteúdo dos PDFs, sem uso da API de IA. A quantidade de pastas com erro não identifica sua causa. Na versão anterior, vários tipos de erro eram reduzidos à mesma mensagem genérica; não é possível recuperar seus códigos retroativamente. Uma nova contagem é necessária para registrar o diagnóstico detalhado.

Agora a tela **Por que estas pastas não foram lidas?** apresenta caminho, código recebido do navegador, mensagem original e orientação correspondente. O TXT e o CSV do inventário também preservam esses dados. `NotAllowedError` indica recusa de permissão; `NotFoundError` informa item não encontrado; `NotReadableError` indica falha de leitura, sem distinguir sozinho bloqueio, sincronização ou disco indisponível. Erros desconhecidos permanecem inconclusivos, sem atribuir automaticamente a causa a nomes longos, quantidade de documentos ou saldo de IA.

A busca de conteúdo preserva separadamente os erros das pastas e os erros dos arquivos, inclusive senha e estrutura de PDF inválida. Detalhes de arquivos continuam sujeitos ao limite de amostra da busca; os totais de falhas e a cobertura parcial permanecem no relatório. Nada que falhou é classificado como vazio ou como inexistência de uma resposta.

## Imagem para compartilhar

Use **Gerar imagem para compartilhar** dentro de um pedido ou na página de conversão de CSV. Escolha o pedido e todos os arquivos ou apenas um candidato. A prévia mostra PNGs numerados; **Baixar imagem (PNG)** salva cada parte para anexar em uma mensagem ou documento. O sistema não envia a imagem a outras pessoas.

A imagem mantém a identificação do documento SES, o pedido, sua página e contexto, os caminhos e os trechos selecionados na entidade. Avaliações específicas e cobertura parcial continuam identificadas; rótulos genéricos de IA e instruções de uso são omitidos. A imagem de um único arquivo inclui apenas suas citações estruturadas; citações agregadas de um CSV são mantidas na opção de todos os arquivos. Documentos continuam sendo candidatos, sujeitos a revisão técnica.

A geração usa Canvas no navegador, sem bibliotecas externas, API de IA ou releitura dos PDFs. Textos longos são paginados, sem reticências nos caminhos ou cortes silenciosos de trechos. Cada parte tem 1.200 pixels de largura e até 2.600 de altura. O limite de 24 partes e de 160.000 caracteres por seleção gera erro explícito quando excedido; nesse caso, escolha um arquivo ou use o relatório HTML. As prévias são descartadas ao fechar a janela; sair da análise também fecha a prévia ativa. Imagens já baixadas permanecem no computador.

## Aproveitar um CSV já salvo

Abra `/relatorio-conferencia.html` em outra aba e selecione o CSV original exportado pela Análise Docs ou pelo GEMOD. A página agrupa as linhas de cada pedido e apresenta uma prévia. Use **Salvar relatório legível** ou **Imprimir / salvar PDF**. A conversão não exige login, acesso à pasta, interpretação dos ofícios, upload do arquivo ou novas chamadas à IA. Os resultados ficam apenas na memória da página até o download.

O importador aceita o CSV UTF-8 com BOM e campos entre aspas, incluindo separadores e quebras de linha dentro dos campos. Ele preserva as contagens e os avisos de cobertura parcial e recusa arquivos sem o cabeçalho do quadro de evidências. Arquivos de inventário e planilhas `.xlsx` não são esse formato. Limites: 12 MiB e 5.000 linhas. Os relatórios gerados não carregam recursos externos nem executam scripts; textos e caminhos são escapados antes de entrar no HTML.

### Origem dos pedidos e recuperação de contexto

Novos CSVs levam a identificação, citação original, contexto, página e método de confirmação da fonte SES. Uma coluna JSON preserva exatamente quebras e sinais do texto original, além das colunas legíveis. Os arquivos antigos de 14 colunas continuam aceitos; suas evidências da entidade não são reaproveitadas como se fossem citações da SES. Quando falta a origem, o relatório indica a lacuna no pedido.
As colunas opcionais **Avaliação IA concluída** e **Modelo da avaliação IA** preservam a existência de avaliações inconclusivas. O HTML e a imagem mostram o resultado e sua justificativa antes do texto longo da SES. Um resultado local sem avaliação não recebe rótulo de análise pela IA. CSVs anteriores sem essas colunas ou sem os campos opcionais de numeração na fonte JSON continuam aceitos.

No organizador, selecione os PDFs originais da SES. A leitura ocorre no navegador e permite conferir os títulos e selecionar a página de cada pedido; **Confirmar páginas e atualizar relatório** acrescenta o contexto ao HTML/PDF/PNG, preservando os candidatos já encontrados. A página escolhida manualmente é identificada como tal, sem afirmar validação automática de uma citação. Limites dessa recuperação: 8 documentos, 25 MiB por arquivo, 500 páginas com texto por documento e 6.000 caracteres de contexto por página; recortes são indicados. PDFs sem texto exigem OCR e não recebem contexto inventado. Essa recuperação não pesquisa novamente os arquivos da entidade nem faz chamadas à IA.

Na interpretação, o servidor verifica a citação no texto recebido e devolve o trecho efetivo da página e um recorte ao redor. Pode corrigir uma página equivocada da IA quando há uma correspondência única; ocorrências ambíguas sem indicação válida não recebem fonte confirmada. A normalização de espaços, caixa e acentos mantém um mapa para os caracteres originais, inclusive Unicode. A validação é textual e não comprova a correção semântica do resumo; o contexto visível permite essa revisão.

## Busca e privacidade

Esta versão econômica combina conceitos documentais locais, sinônimos/consultas alternativas preparados pela IA ao interpretar os ofícios, termos específicos ponderados pela frequência no acervo e referências exatas. Não é um modelo neural local de embeddings nem uma análise semântica irrestrita de todos os PDFs. Não precisa baixar um modelo pesado ou criar outro serviço.

Competência, NF/SEI, CNPJ e valores ajudam na seleção. Indícios de pagamento efetuado são distinguidos de guia/boleto, nota fiscal e relatório que menciona uma pendência. Divergências diminuem a prioridade e aparecem como alertas para revisão, não como parecer. O nome do arquivo não basta para comprovar conteúdo.

O índice usa números de termos, conceitos e posições, sem guardar o corpo integral dos PDFs. Mudar os pedidos/ofícios reaproveita o índice nesta tela. Arquivos novos/alterados são reindexados e removidos saem do índice. Só os candidatos são reabertos para recuperar a citação. Outra pasta descarta o índice anterior. Respostas bem-sucedidas idênticas da IA são reaproveitadas; falhas não viram resultados válidos. Requisição interrompida antes da resposta pode exigir nova consulta.

O índice e o cache temporário de respostas ficam na memória desta tela e são descartados ao sair, encerrar a sessão ou recarregar. Caminhos, citações, pedidos e avaliações podem ser preservados pelo salvamento explícito em **Minhas análises**. Não há persistência do índice em IndexedDB ou servidor. O relatório HTML e o CSV baixados preservam outra cópia consultável dos resultados; não restauram o índice nem as permissões para abrir arquivos locais no aplicativo.

## Cobertura e custo

- Travas de 15.000 arquivos por pesquisa e 20.000 itens na listagem, com parcialidade explícita ao excedê-las. O índice tem orçamento estimado de 128 MiB mais estruturas auxiliares; atingir o limite é informado.
- A indexação PDF percorre todas as páginas, inclusive além das antigas 80 páginas e 200.000 caracteres totais. Proteções de 25 MiB por arquivo e 200.000 caracteres por página permanecem, com aviso de corte.
- PDFs ou páginas sem texto são sinalizados para OCR, sem contratação automática de serviço pago. Encontrar algum texto não comprova leitura das imagens da mesma página.
- A interpretação SES tem limites de blocos e pedidos e indica parcialidade quando excedidos. O confronto recebe os trechos selecionados, não o contexto completo dos documentos; evidências podem ficar fora desses limites.
- Autorização explícita e proteção diária existente de 35 tentativas por usuário permanecem. Nos modelos GPT-5, GPT-5 mini e GPT-5 nano compatíveis, o esforço de raciocínio é baixo. O valor depende de modelo/tokens, sem promessa de preço fixo.
- Citações da IA são verificadas contra o texto enviado. IDs inventados e citações não literais são recusados. A decisão de atendimento continua com a equipe técnica.

## Verificação

### Diagnóstico da configuração da IA

Sem `GEMOD_AI_MODEL`, o backend usa `gpt-5-mini`. A tela mostra esse nome, mas presença da chave não comprova autorização para o modelo. Verifique a chave aplicada ao contexto **Production / Functions** no Netlify e o projeto OpenAI ao qual ela pertence. Nunca compartilhe o valor da chave em mensagens ou capturas de tela.

O botão **Verificar acesso ao modelo (sem documentos)** funciona antes de escolher a pasta. Ele consulta apenas metadados do modelo, sem geração de tokens nem consumo da cota diária de análise. A leitura pode estar bloqueada para chaves restritas que ainda permitem Responses; por isso, esse teste é opcional e não impede a interpretação. Encontrar o modelo não comprova saldo, acesso de escrita a Responses ou suporte a todos os parâmetros.

Os erros distinguem `model_not_found` (nome incorreto ou acesso indisponível), autenticação, HTTP 403 sem diagnóstico conclusivo e HTTP 404 de outro recurso. Modelo, status, código conhecido e referência de requisição são os únicos metadados do provedor expostos ao administrador; o corpo bruto e a chave nunca são devolvidos. Corrija a configuração/permissão antes de repetir os blocos. Respostas concluídas continuam preservadas na tela.

`npm run validate` cobre sinônimos, contexto errado, fontes complementares, citações inventadas, cache, alterações/exclusões, interrupção, PDFs longos, isolamento das análises por conta, versões concorrentes e gravações com falha. `npm run test:browser` exercita PDFs e planilha reais fictícios no Chromium, dashboard, sessão, gravação e reabertura após recarregar, reuso das avaliações salvas e exportações, com provedor de IA e seletor de diretório simulados. A retomada de blocos SES pendentes é coberta pelos testes de unidade. A extração PDF/worker, o índice, as rotas da API e o emulador oficial de armazenamento são reais, sem cobrança de IA.

`npm run benchmark:busca` usa 7.000 documentos **simulados** e verifica reuso do índice e recuperação de citações. Não mede extração de 7.000 PDFs reais, qualidade do provedor, custo real ou desempenho no computador do usuário. Conferir amostras conhecidas do acervo autorizado antes de usar resultados como conclusão administrativa.

## Leitores neste aplicativo independente

Os leitores PDF, DOCX e XLSX/XLSM são servidos pelo próprio site. ExcelJS substitui o SheetJS externo. Planilhas binárias .xls/.xlsb e documentos .doc são contados no inventário, mas precisam de conversão para formatos compatíveis antes da pesquisa textual. Não há OCR automático.
