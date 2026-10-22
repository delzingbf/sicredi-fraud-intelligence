# Hello Moto — Setup do IBM watsonx.ai

Guia para os quatro integrantes configurarem o terminal e repetirem o teste da Chat API com tool-calling. Não há API keys nem tokens neste arquivo.

## Configuração de referência da equipe

O setup validado informado pela equipe é:

| Item | Valor |
| --- | --- |
| Projeto watsonx.ai | watsonx Hackathon Sandbox |
| Project ID | `e696fb51-b4b0-4e13-8478-c66e8e9002ed` |
| Região | Dallas / `us-south` |
| Modelo | IBM Granite 4 H Small |
| Model ID | `ibm/granite-4-h-small` |
| URL base | `https://us-south.ml.cloud.ibm.com` |
| Chat API | `POST /ml/v1/text/chat` |
| Autenticação | IBM Cloud API key → IAM access token → Bearer token |

O trial do **watsonx Orchestrate estava expirado no ambiente da equipe**. O caminho adotado como fallback é chamar a **watsonx.ai Chat API diretamente** e executar o ciclo de ferramentas no backend. A expiração do Orchestrate não determina, por si só, a disponibilidade do watsonx.ai: projeto, Runtime, permissões e cotas precisam continuar ativos.

Este documento registra a configuração informada pela equipe; não é um novo teste de acesso à conta IBM. O script `test-tool-calling.mjs` deve estar no repositório da equipe e não é criado por este guia.

## Início rápido — sessões futuras

Para executar novamente o teste do IBM Granite:

1. Abra o terminal do VS Code ou IBM Bob.
2. Entre na pasta do repositório.
3. Configure `IBM_PROJECT_ID` (seção 3).
4. Informe sua API Key de forma segura (seção 3).
5. Gere o token `IBM_ACCESS_TOKEN` (seção 4).
6. Execute `node test-tool-calling.mjs` (seção 5).

**Importante:** utilize o mesmo terminal durante o processo.
Ao abrir uma nova sessão, será necessário configurar as
variáveis novamente.

Nunca compartilhe sua API Key ou token de acesso.

## 1. Antes de começar

- Terminal com **zsh**, `curl`, `jq` e Node.js compatível com o projeto. Se o script usa `fetch` nativo, use Node.js 18 ou superior, preferindo a versão definida no repositório.
- Acesso à conta IBM Cloud correta e ao projeto acima, com permissões para usar a instância de watsonx.ai Runtime associada.
- Repositório Hello Moto clonado, com o arquivo `test-tool-calling.mjs` e as dependências previstas pelo projeto instaladas.

Confira as ferramentas:

```zsh
zsh --version
curl --version
jq --version
node --version
```

**Variável de terminal não é diretório.** `export IBM_PROJECT_ID=...` guarda um valor no ambiente da sessão; não cria pasta nem muda onde você está. `cd` muda o diretório, `pwd` mostra o diretório atual e `ls` lista os arquivos. O Node iniciado nesse terminal recebe as variáveis exportadas.

## 2. Gerar e guardar a IBM Cloud API key

1. Acesse o [console IBM Cloud](https://cloud.ibm.com/) e confirme a conta do laboratório.
2. Abra **Manage → Access (IAM) → API keys → Create an IBM Cloud API key**.
3. Dê um nome identificável, como `hello-moto-dev-seu-nome`, e uma descrição do uso.
4. Copie a chave na criação e guarde em um gerenciador de senhas autorizado. Não dependa de conseguir consultar seu valor novamente.
5. Cada integrante deve preferir sua própria identidade e chave, conforme as regras do laboratório. Todos precisam de acesso ao projeto; conhecer o Project ID não concede acesso.

A chave herda as permissões da identidade que a criou. Não conceda acesso administrativo apenas para fazer o teste. Para uma integração compartilhada ou implantação, use uma identidade de serviço com permissões mínimas e um gerenciador de segredos, conforme a política da equipe.

**Não envie a chave pelo chat do grupo, não faça captura de tela e não coloque em código, README, histórico de comandos, `.zshrc` ou arquivos versionados.** Se houver vazamento, revogue a chave no IAM e crie outra; apagar o arquivo ou a mensagem não basta.

## 3. Configurar a sessão zsh sem exibir a chave

Execute no terminal em que rodará o teste. Não execute com rastreamento de comandos ativo; `unsetopt XTRACE` desliga esse recurso no zsh.

```zsh
unsetopt XTRACE
export IBM_PROJECT_ID='e696fb51-b4b0-4e13-8478-c66e8e9002ed'

unset IBM_API_KEY
read -r -s 'IBM_API_KEY?Cole sua IBM Cloud API key e pressione Enter: '
printf '\n'
export IBM_API_KEY
```

Cole **somente o valor da chave**, sem aspas, espaços extras ou o texto `IBM_API_KEY=`. A entrada fica oculta: não aparecerem caracteres durante a colagem é esperado. Como o segredo é lido pelo prompt, ele não vira parte do comando salvo no histórico.

Verifique apenas a presença, nunca o conteúdo:

```zsh
[[ -n "$IBM_PROJECT_ID" ]] && printf 'Project ID definido\n' || printf 'Project ID ausente\n'
[[ -n "$IBM_API_KEY" ]] && printf 'API key definida\n' || printf 'API key ausente: repita a entrada secreta\n'
```

Não use `echo "$IBM_API_KEY"`, `echo "$IBM_ACCESS_TOKEN"`, `printenv` ou `env` para conferir credenciais. Variáveis de ambiente ficam acessíveis aos processos iniciados pela sessão; use apenas scripts e dependências confiáveis.

## 4. Trocar a API key por IBM_ACCESS_TOKEN via IAM

Execute o bloco completo após definir a chave. Ele limpa um token anterior, exige uma resposta válida e não imprime o token. O segredo vai para o `curl` pela entrada padrão, sem ser incluído nos argumentos desse comando.

```zsh
unset IBM_ACCESS_TOKEN IBM_TOKEN_EXPIRES_IN

if [[ -z "$IBM_API_KEY" ]]; then
  printf 'API key ausente. Faça a etapa 3.\n'
else
  if IBM_IAM_RESPONSE=$(
    printf '%s' "$IBM_API_KEY" |
      curl --silent --show-error --fail \
        --request POST 'https://iam.cloud.ibm.com/identity/token' \
        --header 'Content-Type: application/x-www-form-urlencoded' \
        --header 'Accept: application/json' \
        --data-urlencode 'grant_type=urn:ibm:params:oauth:grant-type:apikey' \
        --data-urlencode 'apikey@-'
  ); then
    if IBM_ACCESS_TOKEN=$(printf '%s' "$IBM_IAM_RESPONSE" |
      jq -er '.access_token | select(type == "string" and length > 0)'); then
      export IBM_ACCESS_TOKEN
      IBM_TOKEN_EXPIRES_IN=$(printf '%s' "$IBM_IAM_RESPONSE" | jq -r '.expires_in // "não informado"')
      printf 'Token obtido. Validade informada pelo IAM: %s segundos.\n' "$IBM_TOKEN_EXPIRES_IN"
    else
      unset IBM_ACCESS_TOKEN
      printf 'IAM não retornou um access_token válido. Não rode o teste ainda.\n'
    fi
  else
    printf 'Falha na chamada IAM. Confira conexão, chave e status HTTP.\n'
  fi
  unset IBM_IAM_RESPONSE
fi
```

O IAM costuma emitir tokens com validade de aproximadamente **uma hora**. Use `expires_in`/`expiration` da resposta como referência; a validade não é garantida por este README. Nunca imprima a resposta IAM completa: ela contém credenciais.

Depois de obter o token, remova a API key do ambiente se o teste só precisar do Bearer token:

```zsh
unset IBM_API_KEY
[[ -n "$IBM_ACCESS_TOKEN" ]] && printf 'Access token definido\n' || printf 'Access token ausente\n'
```

`unset` remove a variável desta sessão, mas não revoga a credencial e não apaga cópias já recebidas por outros processos. A chave permanece guardada no gerenciador de senhas para a próxima renovação.

## 5. Rodar o teste

No **mesmo terminal**, vá até a pasta que contém o script. Substitua o caminho abaixo pelo local real do clone; ele é apenas um exemplo:

```zsh
cd /caminho/para/sicredi-fraud-intelligence
pwd
ls test-tool-calling.mjs
```

Antes de rodar, confirme no script que ele lê `process.env.IBM_PROJECT_ID` e `process.env.IBM_ACCESS_TOKEN`, usa o modelo `ibm/granite-4-h-small`, a região `us-south` e não registra credenciais. Caso o script use outros nomes de variáveis, alinhe-os ao contrato deste guia. Um script que exige a API key para autenticação automática tem um fluxo diferente do Bearer token manual aqui descrito.

```zsh
if [[ -n "$IBM_PROJECT_ID" && -n "$IBM_ACCESS_TOKEN" ]]; then
  node test-tool-calling.mjs
else
  printf 'Falta Project ID ou access token. Conclua as etapas 3 e 4.\n'
fi
```

Na requisição REST, o token vai no cabeçalho `Authorization: Bearer ...`; `project_id` e `model_id` vão no corpo JSON. A rota é `https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=AAAA-MM-DD`: mantenha o parâmetro `version` compatível com a versão já utilizada pelo script e pela referência da API. Não envie a API key como Bearer token.

### O que esperar do tool-calling

1. O código envia mensagens e definições de ferramentas (`tools`), com nomes, descrições e esquemas de argumentos.
2. O modelo pode devolver chamadas estruturadas em `choices[0].message.tool_calls`. Uma mensagem com `content` vazio ou nulo pode ser normal quando há chamadas de ferramenta.
3. **O modelo solicita a chamada; não executa automaticamente a função do backend.** O script/backend valida o nome e os argumentos, executa somente ferramentas permitidas e coleta os resultados.
4. O código devolve o histórico com a mensagem do assistente que contém `tool_calls` e as respostas com `role: "tool"`, associadas ao respectivo `tool_call_id`.
5. Uma nova chamada ao modelo permite produzir a resposta final ou solicitar outras ferramentas. O backend deve limitar rodadas, tratar falhas e aplicar suas regras de autorização.

Com escolha automática de ferramenta, uma resposta só em texto **não prova falha**: o modelo pode entender que não precisa de ferramenta. Para uma prova controlada, use uma pergunta que dependa da ferramenta e, quando suportado pelo modelo/API, force a ferramenta conforme a referência oficial. Ver `tool_calls` valida a solicitação estruturada; validar o ciclo completo também exige execução local e resposta final baseada no resultado. Não confunda uma chamada solicitada com uma ação já concluída.

Os valores exatos retornados pelo script dependem da implementação e do prompt. Este guia não promete um nome de ferramenta, argumentos ou texto final específicos.

## 6. Nova sessão, token expirado e encerramento

- **Novo terminal/aba:** normalmente não recebe as variáveis exportadas interativamente em outro terminal. Repita o `export IBM_PROJECT_ID`, a entrada secreta da chave e a troca IAM nesse terminal.
- **Token expirado:** leia a chave novamente pela etapa 3 e execute a etapa 4. Não precisa criar uma API key nova a cada hora; precisa de um access token novo.
- **Chave revogada, expirada por política ou comprometida:** crie outra chave autorizada e repita o fluxo.
- **Script/servidor já aberto:** trocar uma variável no terminal não atualiza o ambiente de um processo que já está rodando. Reinicie o processo com o novo token.
- **Ao terminar:** limpe as variáveis e feche os processos que ainda usam as credenciais.

```zsh
unset IBM_API_KEY IBM_ACCESS_TOKEN IBM_IAM_RESPONSE IBM_TOKEN_EXPIRES_IN IBM_PROJECT_ID
```

## 7. Troubleshooting

| Sintoma | Causa provável e ação |
| --- | --- |
| Prompt `dquote>` | Uma aspa dupla ficou aberta. Pressione **Ctrl+C** para cancelar e cole novamente o comando completo, com aspas simples/duplas normais. Não cole a chave nesse prompt de continuação; use `read -r -s` da etapa 3. |
| IAM retorna 400/401 | Chave vazia, inválida, revogada ou colada com espaços/aspas. Leia novamente pelo prompt secreto e refaça a troca. Não exponha o corpo completo da resposta em chats. |
| Chat API retorna 401 | Bearer ausente, inválido ou expirado. Gere novo token, confira o nome `IBM_ACCESS_TOKEN` e reinicie o processo. |
| Chat API retorna 403 | A identidade pode estar autenticada, mas sem autorização. Confira conta, participação no projeto, permissões IAM e acesso ao Runtime associado. Renovar token não concede permissões. |
| Erro de projeto ausente ou inválido | Confirme `IBM_PROJECT_ID` na mesma sessão e `project_id` no JSON. Confira em **Manage → General** do projeto o ID, a conta e a associação ao Runtime. O nome do projeto e o diretório local não substituem o ID. |
| 404 ou modelo indisponível | Confira rota, versão da API, model ID e disponibilidade no projeto/região. Para este setup, mantenha `us-south`; não troque de região ao acaso. |
| Token “definido”, mas chamada falha | Presença não significa validade. Renove no IAM; confira se o processo usa o token novo. |
| `jq: command not found` | Instale `jq` pelo gerenciador de pacotes aprovado e repita a troca IAM. Não substitua por impressão manual da resposta secreta. |
| `MODULE_NOT_FOUND` ou arquivo não encontrado | Confira `pwd`, o nome e a localização de `test-tool-calling.mjs`; instale as dependências seguindo o README do repositório. `export` não muda de pasta. |
| Sem `tool_calls` | Confira `tools`, esquema, suporte do modelo e prompt. Em modo automático, texto direto pode ser válido. |
| Há `tool_calls`, mas não há resposta final | Implemente/confira execução local, respostas `role: "tool"`, IDs correspondentes e a chamada seguinte ao modelo. |
| 429, cota ou serviço indisponível | Confira limites, créditos e estado do sandbox; reduza chamadas e tente novamente conforme orientação do serviço. |

Ao pedir ajuda aos outros três integrantes, compartilhe somente status HTTP, mensagem sanitizada, região, model ID e etapa em que ocorreu o erro. Remova cabeçalhos de autorização, chaves, tokens e dados sensíveis dos logs.

## 8. Antes de commitar

- Versione este guia e o código sem credenciais. O Project ID identifica o projeto e não substitui uma credencial.
- Nunca commite API keys, access tokens, respostas IAM, arquivos `.env` com valores reais, logs sensíveis ou exports de terminal.
- Se usar arquivos locais de segredos em outro fluxo, ignore-os no Git e publique apenas exemplos sem valores reais. `.gitignore` não remove segredos já rastreados ou presentes no histórico.
- Revise o diff e os arquivos preparados para commit. Se um segredo já foi publicado, revogue-o imediatamente e trate a limpeza do histórico com a equipe.

## Referências oficiais

- [IBM Cloud — Gerenciar API keys de usuário](https://cloud.ibm.com/docs/iam?interface=ui&topic=iam-userapikey)
- [IBM Cloud — Autenticação IAM para serviços Watson](https://cloud.ibm.com/docs/watson?topic=watson-iam)
- [IBM watsonx.ai — Referência REST, regiões e Chat API](https://cloud.ibm.com/docs/apis/watsonx-ai)
- [IBM watsonx — Chat e ferramentas](https://www.ibm.com/watsonx/developer/capabilities/chat/)
- [IBM watsonx.ai — Modelos Granite disponíveis](https://www.ibm.com/docs/en/watsonx/saas?topic=models-foundation)

Documentação preparada em 22/10/2026. Disponibilidade, permissões e cotas dependem do ambiente IBM da equipe.
