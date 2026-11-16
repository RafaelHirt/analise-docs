# Análise Docs

Dashboard independente para relacionar as exigências dos ofícios da SES às evidências nos documentos de uma entidade. Extraído do motor de análise de pasta do [GEMOD](https://github.com/RafaelHirt/gemod), sem os módulos de contratos, aditivos ou processos.

## O que está disponível

- Visão geral com indicadores reais dos trabalhos salvos e acesso às análises recentes.
- Inventário de pastas, subpastas e arquivos, inclusive pastas vazias e diagnóstico de falhas de acesso.
- Extração local de PDFs, Word `.docx`, Excel `.xlsx`/`.xlsm` e texto; leitores distribuídos pelo próprio site.
- Interpretação de ofícios SES com OpenAI, revisão por documento e alternativa manual/itens numerados sem IA.
- Busca local com índice reutilizável, referências, competência, caminhos, páginas e trechos literais.
- Confronto opcional dos candidatos pela IA, com validação textual das citações e limites de consultas.
- Salvamento por usuário, reabertura sem repetir consultas e proteção contra gravações concorrentes.
- Relatórios HTML/CSV, imagens PNG e impressão como PDF. O organizador aceita CSVs exportados pelo GEMOD.
- Login próprio, criação de contas pela administração e troca de senha com revogação das outras sessões.

A pasta e os PDFs integrais não são enviados ao servidor. Os textos SES e trechos enviados à IA exigem autorização na tela. Ao **salvar uma análise**, pedidos, citações, caminhos, avaliações e textos SES ainda pendentes ficam no armazenamento do novo site, ligados à conta. O índice local e os PDFs não são salvos.

## Desenvolvimento

Node.js 24 e npm, com versões resolvidas no lockfile:

```sh
cd /workspace/analise-docs
npm ci --ignore-scripts
npm run dev:local
```

O servidor escuta na porta 8888, usa a função real e o emulador oficial de Netlify Blobs. O primeiro acesso permite criar um administrador **local**. Seus dados ficam em `.netlify/local-blobs/`, sem vínculo com o site publicado. Pode usar `PORT` para outra porta.

Use o checkout existente. Cada tarefa na nuvem já é isolada; não é necessário criar um worktree. Os processos precisam ser iniciados novamente em uma nova tarefa.

## Validação

```sh
npm run validate       # testes de unidade, integração HTTP e lint
npm run build          # copia os leitores e a fonte para public/vendor
npm run test:browser   # fluxo completo em Chromium
npm run benchmark:busca
```

O teste de navegador requer Chromium em `/usr/bin/chromium`, ou `ANALISE_CHROMIUM` com o caminho instalado. Usa dados temporários, PDFs e planilha reais fictícios, seletor de pasta simulado e respostas de IA simuladas. Valida leitura com worker PDF, busca, autorização, ranking, sessão, dashboard, salvamento, reabertura, exports, CSP e layout móvel. Não envia documentos reais nem consome tokens. Capturas ficam em `artifacts/`, fora do Git. O benchmark usa 7.000 documentos simulados; não mede a extração de um acervo real.

## Publicar no site Netlify já criado

1. Envie o projeto ao repositório `RafaelHirt/analise-docs` e conecte esse repositório ao site `analise-docs`. O painel exibido na captura ainda estava na etapa de conexão.
2. Use a branch que receber o código. O `netlify.toml` define build `npm run validate && npm run build`, publicação `public`, funções `netlify/functions` e Node 24.
3. Cadastre **apenas no contexto Functions** do novo site, inclusive no contexto de deploy usado:

| Variável | Finalidade |
| --- | --- |
| `ANALISE_SETUP_TOKEN` | Código secreto aleatório de pelo menos 16 caracteres para criar o primeiro administrador no site publicado. Necessário no primeiro acesso. |
| `GEMOD_AI_ENABLED` | `true` para habilitar interpretação e confronto por IA. Sem ela, o fluxo manual/local continua disponível. |
| `GEMOD_OPENAI_API_KEY` | Chave do projeto OpenAI, usada somente no backend. Necessária para a IA. |
| `GEMOD_AI_MODEL` | Opcional. Padrão `gpt-5-mini`; precisa estar disponível ao projeto da chave. |

Os nomes `GEMOD_*` foram mantidos para compatibilidade com o motor extraído. **As variáveis, usuários e dados do site GEMOD não são importados automaticamente.** Não copie valores para o código, para o chat ou para variáveis do frontend.

4. Faça o deploy. Netlify Blobs usa o contexto nativo das Functions, sem credencial manual de armazenamento. No primeiro acesso, use o código de configuração e crie o administrador. Depois, o login passa a usar e-mail e senha. Pode retirar o código das variáveis após concluir o cadastro.
5. Em Configurações, confira o status da IA e use **Verificar acesso ao modelo**, que consulta metadados sem documentos. O diagnóstico não comprova saldo nem permissão para gerar respostas. Para validar o provedor real, faça uma análise pequena com documentos autorizados e revise suas fontes.

O teste local não comprova publicação, configuração das variáveis ou acesso ao modelo no Netlify. O site publicado tem armazenamento separado do GEMOD e do emulador local.

## Limites e compatibilidade

A seleção de pastas exige Chrome ou Edge no computador, HTTPS e permissão de leitura. O dashboard é responsivo, mas a contagem completa de pastas não está disponível no navegador móvel. Não há leitura direta de ZIP ou OCR automático. PDFs digitalizados, páginas sem texto, formatos não suportados, arquivos grandes e falhas de acesso são identificados como cobertura parcial.

Excel antigo `.xls`/`.xlsb` é contado, mas requer converter uma cópia para `.xlsx` para pesquisar o conteúdo. Macros e fórmulas de planilhas não são executadas. Documentos `.doc` antigos também precisam de conversão para `.docx`.

A busca combina conceitos, referências e termos ponderados; não é embedding neural de todo o acervo. Resultados são candidatos, e ausência de correspondência não comprova inexistência. A revisão técnica continua necessária. Consulte [fluxo, privacidade e limites](docs/busca-contextual.md) e [origem da extração](docs/origem.md).
