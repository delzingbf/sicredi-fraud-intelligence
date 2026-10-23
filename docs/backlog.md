# Backlog de Issues — Hello Moto Fraud Intelligence

**Referência:** `docs/implementation-plan.md`  
**Processo:** GitHub Projects — Colunas: Backlog → Ready → In Progress → In Review → Done  
**Formato do título:** Conventional Commits

---

## Como usar este documento

Antes de criar as issues no GitHub, a equipe deve revisar este backlog em conjunto.
Não criar issues com dependências pendentes ainda não iniciadas.
Cada issue deve ser pequena o suficiente para ser concluída em uma ou duas sessões de trabalho.

---

## Issue #1 — chore: initialize pnpm monorepo and move PoC file

**Responsável:** Dev B  
**Prioridade:** P0 — Bloqueante  
**Dependências:** nenhuma  
**Sub-Task do plano:** Sub-Task 1

### Objetivo
Criar a estrutura raiz do monorepo pnpm e organizar os arquivos existentes.

### Tarefas
- [ ] Criar `package.json` na raiz com `name: "sicredi-fraud-intelligence"` e `private: true`
- [ ] Criar `pnpm-workspace.yaml` com `packages: ["apps/*", "packages/*"]`
- [ ] Criar `packages/contracts/` com `package.json` e `src/index.ts` vazio por enquanto
- [ ] Criar `docs/poc/` e mover `test-tool-calling.mjs` da raiz para `docs/poc/`
- [ ] Criar `.env.example` na raiz com todas as variáveis documentadas (sem valores reais)
- [ ] Remover `apps/api/.gitkeep` e `apps/web/.gitkeep` (serão substituídos por código real)
- [ ] Verificar que `.gitignore` ainda cobre `node_modules/`, `.env`, `dist/`, `/data/*`

### Critérios de aceite
- `pnpm install` roda sem erro na raiz
- `docs/poc/test-tool-calling.mjs` existe e `test-tool-calling.mjs` não existe mais na raiz
- `.env.example` documenta `IBM_PROJECT_ID`, `IBM_ACCESS_TOKEN`, `PORT`, `MAX_INVESTIGATION_ROUNDS`, `IBM_CHAT_API_URL`, `IBM_MODEL_ID`
- Nenhum secret commitado

---

## Issue #2 — chore(contracts): define shared TypeScript types

**Responsável:** Dev C  
**Prioridade:** P0 — Bloqueante  
**Dependências:** Issue #1 (monorepo precisa existir)  
**Sub-Task do plano:** Sub-Task 1

### Objetivo
Criar o pacote `packages/contracts` com todos os tipos TypeScript compartilhados entre
o backend e o frontend.

### Tarefas
- [ ] Configurar `packages/contracts/package.json` com `name: "@fraud-intelligence/contracts"`
- [ ] Criar `packages/contracts/tsconfig.json`
- [ ] Implementar `src/index.ts` com os tipos: `InvestigationRequest`, `ToolResult<T>`, `ToolStatus`, `InvestigationReport`, `RiskLevel`, `RecommendedAction`, `Confidence`
- [ ] Verificar que os tipos compilam sem erro (`tsc --noEmit`)

### Critérios de aceite
- `packages/contracts` compila com TypeScript strict
- Todos os tipos documentados em `docs/implementation-plan.md` seção "Shared Contracts" estão presentes
- Pacote está listado no workspace pnpm

---

## Issue #3 — chore(api): scaffold NestJS application

**Responsável:** Dev B  
**Prioridade:** P0 — Bloqueante  
**Dependências:** Issues #1 e #2  
**Sub-Task do plano:** Sub-Task 1

### Objetivo
Inicializar o projeto NestJS em `apps/api/` com configuração mínima, health check
e validação de variáveis de ambiente.

### Tarefas
- [ ] Inicializar NestJS em `apps/api/` com TypeScript strict
- [ ] Adicionar `@fraud-intelligence/contracts` como dependência de workspace
- [ ] Configurar `@nestjs/config` com validação das variáveis de ambiente obrigatórias
- [ ] Criar `HealthModule` e `HealthController` com `GET /health` → `{ status: 'ok' }`
- [ ] Configurar `ValidationPipe` global com `whitelist: true`
- [ ] Adicionar `pnpm --filter @fraud-intelligence/api start:dev` no README
- [ ] Verificar que a aplicação inicia e responde ao health check

### Critérios de aceite
- `pnpm --filter @fraud-intelligence/api start:dev` inicia sem erro
- `curl http://localhost:3001/health` retorna `200 { "status": "ok" }`
- Aplicação falha com mensagem clara se `IBM_PROJECT_ID` não estiver definido
- TypeScript compila sem erros

---

## Issue #4 — docs(data): inspect CSV and data dictionary, write data contract

**Responsável:** Dev A  
**Prioridade:** P1 — Alta  
**Dependências:** Issue #1 (estrutura de docs precisa existir)  
**Sub-Task do plano:** Sub-Task 2

### Objetivo
Inspecionar o dataset real do Sicredi e documentar os campos disponíveis antes da
autorização, o nome exato da coluna de fraude, e a estratégia de carregamento.
Esta issue é um pré-requisito para toda a implementação de ferramentas.

### Tarefas
- [ ] Ler o cabeçalho do CSV (primeira linha apenas — sem carregar 900k registros)
- [ ] Ler o dicionário de dados XLSX completo
- [ ] Identificar campos pré-autorização vs. pós-autorização
- [ ] Confirmar nome exato da coluna de fraude (`feedback_label` esperado — verificar)
- [ ] Avaliar campos geográficos (lat/lon, cidade) — taxa de preenchimento
- [ ] Avaliar colunas de velocidade pré-computadas vs. computação dinâmica necessária
- [ ] Definir schema PostgreSQL: quais colunas vão para quais tabelas, índices necessários
- [ ] Escrever `docs/data-contract.md` com: lista de campos por ferramenta, campos proibidos, chaves de índice, estratégia escolhida

### Critérios de aceite
- `docs/data-contract.md` existe com no mínimo: lista de campos para `getTransactionDetails` e `getCustomerProfile`, nome confirmado da coluna de fraude, lista de campos proibidos, e schema PostgreSQL inicial
- Nenhum código implementado nesta issue — apenas documentação
- Revisado por pelo menos um outro membro da equipe antes de fechar

---

## Issue #5 — feat(agent): implement WatsonxClient

**Responsável:** Dev C  
**Prioridade:** P1 — Alta  
**Dependências:** Issues #2 e #3  
**Sub-Task do plano:** Sub-Task 4

### Objetivo
Implementar o cliente HTTP responsável pelas chamadas à IBM Chat API. Esta classe
não contém lógica de negócio — apenas a comunicação com a API.

### Tarefas
- [ ] Criar `apps/api/src/agent/watsonx.client.ts` como NestJS injectable service
- [ ] Configurar endpoint via `IBM_CHAT_API_URL` (env), fallback para valor padrão
- [ ] Configurar model_id via `IBM_MODEL_ID` (env), fallback para `ibm/granite-4-h-small`
- [ ] Implementar método `chat(messages, tools)` que chama a API e retorna a resposta
- [ ] Preservar `temperature: 0`, `tool_choice_option: "auto"`, `max_tokens: 1200` como defaults configuráveis
- [ ] Tratar erros HTTP (4xx, 5xx) com mensagens claras
- [ ] Escrever teste unitário com fetch mockado

### Critérios de aceite
- `WatsonxClient.chat()` aceita o histórico de mensagens e a lista de tools no formato da Chat API
- Erros da API são traduzidos para erros NestJS com contexto suficiente para debug
- Nenhuma lógica de loop ou de tool-calling — responsabilidade exclusiva de `AgentOrchestrator`
- Testes passam com fetch mockado

---

## Issue #6 — feat(agent): implement ToolRegistry with mock tools

**Responsável:** Dev C  
**Prioridade:** P1 — Alta  
**Dependências:** Issues #2 e #3  
**Sub-Task do plano:** Sub-Task 4

### Objetivo
Implementar o catálogo de ferramentas: definições JSON para o LLM, whitelist,
e despacho de execução. Usar as duas ferramentas simuladas do PoC para validar
o registro antes das ferramentas reais existirem.

### Tarefas
- [ ] Criar `apps/api/src/agent/tool.registry.ts`
- [ ] Implementar `register(name, definition, implementation)` para registrar ferramentas
- [ ] Implementar `getDefinitions()` → array de tool definitions para enviar ao LLM
- [ ] Implementar `execute(name, args)` → `ToolResult<unknown>` — valida whitelist, chama implementação
- [ ] Preservar a lógica de `parseArguments` do PoC (duplo parse para JSON de string)
- [ ] Registrar as duas ferramentas simuladas do PoC (`getCustomerProfile`, `analyzeTransactionVelocity`) como ferramentas de teste
- [ ] Escrever testes: ferramenta encontrada, ferramenta não encontrada (whitelist), argumento inválido

### Critérios de aceite
- `ToolRegistry.execute('ferramenta-desconhecida', {})` retorna `ToolResult` com `status: 'error'` e mensagem "ferramenta não autorizada"
- `ToolRegistry.getDefinitions()` retorna o array de tools no formato esperado pela Chat API
- Mock tools funcionam corretamente

---

## Issue #7 — feat(agent): implement AgentOrchestrator ReAct loop

**Responsável:** Dev C  
**Prioridade:** P1 — Alta  
**Dependências:** Issues #5 e #6  
**Sub-Task do plano:** Sub-Task 4

### Objetivo
Implementar o loop ReAct em TypeScript — uma migração direta e tipada do
`test-tool-calling.mjs`, sem redesenhar a lógica.

### Tarefas
- [ ] Criar `apps/api/src/agent/agent.orchestrator.ts`
- [ ] Implementar `investigate(request: InvestigationRequest): Promise<string>` — retorna o texto final do modelo
- [ ] Portar o loop de rodadas do PoC: build messages → call Granite → process tool_calls → push results → repeat
- [ ] Aplicar limite de rodadas via `MAX_INVESTIGATION_ROUNDS` (env)
- [ ] Criar `apps/api/src/agent/system-prompt.ts` com o prompt do investigador
- [ ] Escrever teste de integração: usar as mock tools e verificar que o loop retorna um texto não-vazio

### Critérios de aceite
- Loop termina quando o modelo não retorna `tool_calls` (conclusão normal)
- Loop termina quando atinge o limite de rodadas com mensagem `"Limite de investigação atingido"`
- Teste de integração com mock tools passa (requer `IBM_ACCESS_TOKEN` e `IBM_PROJECT_ID` — marcar como teste de integração, não unitário)
- Sistema prompt segue as diretrizes de `docs/implementation-plan.md` seção "System Prompt"

---

## Issue #8 — feat(data): implement DataService with foundational tools

**Responsável:** Dev A  
**Prioridade:** P1 — Alta  
**Dependências:** Issues #3 e #4 (data contract precisa existir)  
**Sub-Task do plano:** Sub-Task 3

### Objetivo
Implementar o `DataService` que carrega e indexa o CSV, e as duas primeiras
ferramentas reais: `getTransactionDetails` e `getCustomerProfile`.

### Tarefas
- [ ] Implementar `DataService` com a estratégia definida em `docs/data-contract.md`
- [ ] Aplicar allowlist de campos — `feedback_label` NUNCA exposto
- [ ] Implementar `getTransactionDetails` com `ToolResult<TransactionDetails>`
- [ ] Implementar `getCustomerProfile` com `ToolResult<CustomerProfile>`
- [ ] Registrar ambas em `ToolRegistry` com definições JSON ricas
- [ ] Escrever testes unitários: found, not_found, missing fields
- [ ] Verificar tempo de startup com o CSV real

### Critérios de aceite
- `getTransactionDetails('TX-real-id')` retorna dados reais do CSV
- `getTransactionDetails('TX-inexistente')` retorna `status: 'not_found'`
- `feedback_label` não aparece em nenhuma resposta (verificado por teste)
- Tempo de startup aceitável para desenvolvimento local

---

## Issue #9 — feat(api): implement PolicyService and InvestigationService

**Responsável:** Dev B  
**Prioridade:** P2 — Média  
**Dependências:** Issues #2, #3, #7 (AgentOrchestrator precisa existir)  
**Sub-Task do plano:** Sub-Task 5

### Objetivo
Implementar a camada de segurança determinística (PolicyService) e o serviço de
caso de uso (InvestigationService) que integra o orquestrador com as políticas.

### Tarefas
- [ ] Implementar schema Zod para `InvestigationReport`
- [ ] Implementar `PolicyService.validate(report)` — retorna relatório validado ou lança exceção
- [ ] Implementar `PolicyService.canRequestMemberVerification(report)` — regra determinística
- [ ] Implementar `InvestigationService.investigate(request)` — chama orchestrator, faz parse do JSON, valida, retorna
- [ ] Adicionar fallback: se o modelo não retornar JSON válido → retornar `INCONCLUSIVE + requiresHumanReview: true`
- [ ] Implementar `InvestigationController` com `POST /investigations`
- [ ] Adicionar filtro global de exceções
- [ ] Escrever testes unitários do `PolicyService` e teste de integração do controller

### Critérios de aceite
- `POST /investigations` com dados válidos retorna um `InvestigationReport` validado
- Relatório malformado do modelo gera `INCONCLUSIVE` seguro, não um erro HTTP 500
- `canRequestMemberVerification` rejeita `PROCEED` e `LOW_RISK` corretamente

---

## Issue #10 — feat(data): implement velocity and spending pattern tools

**Responsável:** Dev A  
**Prioridade:** P2 — Média  
**Dependências:** Issue #8 (DataService precisa estar funcionando)  
**Sub-Task do plano:** Sub-Task 6

### Objetivo
Implementar as três ferramentas analíticas de maior valor: velocidade transacional,
padrão de gastos e contexto da transação.

### Tarefas
- [ ] Implementar `analyzeTransactionVelocity` com dados reais
- [ ] Implementar `analyzeSpendingPattern` com estatísticas históricas do associado
- [ ] Implementar `analyzeTransactionContext` com análise de horário e canal
- [ ] Registrar todas em `ToolRegistry`
- [ ] Escrever testes unitários cobrindo caso normal, anomalia e dados insuficientes

### Critérios de aceite
- Todas retornam `ToolResult<T>` com envelope padrão
- Dados insuficientes retornam `status: 'unavailable'` com `message` explicativa
- Nenhum dado pós-autorização incluído nos cálculos

---

## Issue #11 — feat(data): implement remaining tools

**Responsável:** Dev A (merchant, risco, geografia) + Dev B (policy, verification)  
**Prioridade:** P3 — Baixa  
**Dependências:** Issues #8, #9  
**Sub-Task do plano:** Sub-Task 7

### Objetivo
Completar o catálogo com as ferramentas restantes e finalizar `requestMemberVerification`
com a gate do `PolicyService`.

### Tarefas
- [ ] Implementar `checkMerchantHistory`
- [ ] Implementar `checkCustomerRiskEvents`
- [ ] Implementar `getRiskPolicy` como resposta estática de config
- [ ] Implementar ou stub `checkGeographicConsistency` baseado no `docs/data-contract.md`
- [ ] Finalizar `requestMemberVerification` com gate do `PolicyService` dentro do `ToolRegistry`
- [ ] Rodar investigação end-to-end com todas as 10 ferramentas registradas

### Critérios de aceite
- Todas as 10 ferramentas registradas no `ToolRegistry`
- `requestMemberVerification` não executa sem aprovação do `PolicyService`
- Investigação end-to-end completa sem erros

---

## Issue #12 — chore(web): scaffold React frontend

**Responsável:** Dev D  
**Prioridade:** P2 — Média (paralela com Issues #9 e #10)  
**Dependências:** Issue #1 (monorepo), Issue #2 (contracts)  
**Sub-Task do plano:** Sub-Task 8

### Objetivo
Inicializar o frontend React e implementar a UI mínima para submeter uma transação
e visualizar o relatório de investigação.

### Tarefas
- [ ] Inicializar `apps/web/` com Vite + React + TypeScript
- [ ] Adicionar `@fraud-intelligence/contracts` como dependência de workspace
- [ ] Implementar `InvestigationForm`
- [ ] Implementar visualizador de `InvestigationReport`
- [ ] Implementar `ToolTrace` — lista de ferramentas chamadas em ordem
- [ ] Implementar `MemberVerificationDialog` (simulado)
- [ ] Conectar ao `POST /investigations`

### Critérios de aceite
- `pnpm --filter @fraud-intelligence/web start:dev` inicia sem erro
- Usuário pode enviar um transaction ID e ver o relatório completo
- `ToolTrace` mostra as ferramentas chamadas em ordem

---

## Issue #13 — test(agent): implement evaluation harness

**Responsável:** Dev C (arquitetura) + Dev D (implementação)  
**Prioridade:** P3 — Baixa  
**Dependências:** Issues #9, #10 (API funcionando end-to-end)  
**Sub-Task do plano:** Sub-Task 9

### Objetivo
Criar o script de avaliação offline que mede a qualidade das classificações do agente
usando os rótulos reais do dataset.

### Tarefas
- [ ] Criar `scripts/evaluate.mjs`
- [ ] Amostrar N transações estratificadas (fraude + legítima)
- [ ] Chamar `POST /investigations` para cada uma
- [ ] Mapear `riskLevel` para predição binária
- [ ] Calcular precision, recall, F1, AUPRC, matriz de confusão
- [ ] Salvar resultados em `data/processed/evaluation-YYYY-MM-DD.json`
- [ ] Documentar execução no README

### Critérios de aceite
- `node scripts/evaluate.mjs --n 100 --seed 42` roda contra API local
- Métricas calculadas: precision, recall, F1 macro e por classe, AUPRC
- `feedback_label` é lido apenas neste script — nunca enviado para a API

---

## Ordem de execução sugerida

```
Paralelo imediato:
  #1 (Dev B) → #2 (Dev C) → #3 (Dev B) + #4 (Dev A)

Após Issues #1, #2, #3:
  #5 (Dev C) + #6 (Dev C) + #8 (Dev A, após #4)

Após #5 + #6:
  #7 (Dev C)

Após #3 + #7:
  #9 (Dev B)

Após #8 (dados básicos):
  #10 (Dev A) + #12 (Dev D, paralelo)

Após #9 + #10:
  #11 (Dev A + Dev B)

Após tudo funcionando e2e:
  #13 (Dev C + Dev D)
```
