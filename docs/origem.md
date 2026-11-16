# Origem e separação do GEMOD

Fonte: `RafaelHirt/gemod`, commit `2d2c5c50550c082b0203bdddafe26a1fc2b94fa0`.

Foram reaproveitados os módulos de inventário, diagnóstico, leitura documental, busca contextual, indexação, fontes SES, itens numerados, conferência por IA, snapshot, salvamento, relatórios e compartilhamento, junto aos seus testes pertinentes. A biblioteca de IA usa a Responses API da OpenAI e mantém os nomes de variáveis do GEMOD. A biblioteca de armazenamento mantém condições por ETag e histórico das análises.

O novo dashboard e sua API de autenticação foram criados neste repositório. O backend registra apenas setup, sessão, usuários, análises e IA. Não contém os endpoints ou os dados gerenciais do GEMOD. As contas, sessões, análises e a configuração de IA pertencem ao novo site Netlify; o GEMOD original não foi alterado.

Mudanças nesta extração:

- Dashboard dedicado, indicadores de resumos reais, trabalhos recentes e filtros por nome, pasta e etapa.
- Navegação mantém o trabalho em memória; sair sem salvar pede confirmação. Sessão expirada oculta a aplicação e permite autenticar novamente sem perder o rascunho. Entrar em outra conta descarta os documentos da conta anterior.
- Primeiro administrador protegido por código de configuração no site publicado; criação inicial atômica, senha com mínimo de 10 caracteres e limite de tentativas de login.
- CSS próprio, fonte local e política de conteúdo restrita, também aplicada nos testes locais.
- PDF e Word locais preservados. SheetJS externo substituído por ExcelJS local para `.xlsx` e `.xlsm`; Excel binário antigo requer conversão. Nenhum leitor depende de CDN.
- Abertura de análise exposta ao dashboard por método e eventos, preservando os guardas de edição existentes.
- Testes da navegação monolítica substituídos por testes do novo shell e integração real de sessão/armazenamento. Os cenários da busca, fontes e citações foram conservados.

Os nomes internos `Gemod*`, o esquema de snapshot e os nomes de arquivo dos exports foram preservados para compatibilidade com o motor e com CSVs existentes. Não representam dependência do site ou do banco do GEMOD.
