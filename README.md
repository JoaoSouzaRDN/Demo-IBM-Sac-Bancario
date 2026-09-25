# Demo IBM — SAC bancário (RDN Bank)

Demo de atendimento bancário via chat, combinando um frontend React, um backend Node.js, agentes nativos do **IBM watsonx Orchestrate** e um agente externo hospedado no **Azure AI Foundry**. A demo existe para mostrar, na prática, a governança de agentes cross-platform do watsonx Orchestrate: um agente principal orquestrando um colaborador nativo e um colaborador externo de outra plataforma, com o Control Plane da IBM acompanhando as duas pontas.

## Jornadas

1. Pix não recebido
2. Cartão perdido ou roubado
3. Compra com cartão contestada (aciona análise de fraude)
4. Empréstimo com parcela em atraso
5. Atualização cadastral

## Arquitetura

- **Frontend** (`frontend/src/`): React, chat com painel de andamento em tempo real.
- **Backend** (`backend/server.js`): Node.js puro (`http`), sem framework. Fala com o watsonx Orchestrate via API de Runs, expõe um mock de banco de dados (`mock-db/`), e contém uma camada de confiabilidade determinística (ver abaixo).
- **Agentes nativos do Orchestrate** (`agents/sac-resposta/`, `agents/sac-consulta/`): definidos em YAML, importados via `orchestrate agents import -f <arquivo>`.
  - `sac_resposta`: agente principal, conversa com o cliente.
  - `sac_consulta`: colaborador interno, consulta os dados mockados (Pix, cartão, compra, parcela, cadastro).
- **Agente externo** (`agents/analise-fraude-reembolso/`): `analise_fraude_reembolso`, um *Prompt Agent* hospedado no **Azure AI Foundry**, registrado no Orchestrate como colaborador externo (`kind: external`). Recebe os fatos de uma contestação de compra e devolve um parecer estruturado de risco de fraude (nunca aprova/nega sozinho — é só um insumo pra decisão do agente principal).

### Duas camadas de protocolo — não confundir

Há dois protocolos diferentes envolvidos, em duas pontas distintas, e vale separar bem os dois:

1. **Backend → Foundry**: o backend sempre fala **A2A** com o Foundry de verdade (`foundryA2ACall`/`normalizeA2AMessage`/`foundryA2ASendAndWait` em `backend/server.js`), porque é assim que o `Prompt Agent` do Foundry está exposto (`.../endpoint/protocols/a2a`). Isso nunca muda, independente de como o colaborador está registrado no Orchestrate. É necessário um pequeno adaptador aqui porque o cliente A2A do Orchestrate e o endpoint A2A do Foundry não são 100% compatíveis entre si: o Orchestrate manda as partes da mensagem com o discriminador antigo `type` (pré-0.3) e sem `messageId`; o Foundry exige o discriminador `kind` da versão 0.3 do A2A com `messageId` obrigatório, e responde `message/send` de forma assíncrona (`submitted` → `completed`) sem fazer polling. `foundryA2ASendAndWait` normaliza o payload e faz o polling em `tasks/get` até completar, então quem chama essas funções recebe uma resposta síncrona.
2. **Orchestrate → backend**: como o `sac_resposta` chama o colaborador quando decide fazer isso nativamente. O provider registrado é `external_chat` puro (chat completions), apontando pra `POST /api/foundry-fraude/chat` (`handleFoundryFraudeChat`) — não A2A. Esse endpoint reaproveita as mesmas funções do item 1 por baixo dos panos, só devolve a resposta no formato chat completions da OpenAI em vez de JSON-RPC.

A chamada real ao Foundry, então, é **sempre** A2A — o que mudou ao longo do desenvolvimento foi só como o Orchestrate alcança o backend quando é ele (e não o override determinístico) quem decide fazer a chamada.

### Camada de confiabilidade determinística

Em testes extensivos, deixar o modelo do `sac_resposta` decidir sozinho *se* e *quando* chamar o colaborador `analise_fraude_reembolso` (ou registrar uma contestação, listar parcelas, confirmar atualização cadastral) se mostrou **não-determinístico** mesmo com prompts idênticos. Em vez de insistir em ajustes de prompt, três fluxos foram movidos para o backend, que agora decide essas transições de estado de forma determinística, chamando o Foundry diretamente quando necessário (`analyzeFraudDirectly` em `backend/server.js`):

- Confirmação de compra contestada → registro do caso + chamada real ao Foundry.
- Listagem de parcelas → montada direto dos dados mockados.
- Confirmação de atualização cadastral → registro do caso.

Essa camada garante que a resposta ao cliente é sempre correta, mas tem uma consequência importante pra observabilidade — ver a seção seguinte.

## Observabilidade: uso de token do agente externo (Foundry) no Control Plane

### O problema

Como a chamada real ao Foundry acontece **direto do backend** (bypassando o `sac_resposta`), ela nunca passa pelo runtime do Orchestrate — logo, nunca gera trace nenhum lá. Mesmo quando o `sac_resposta` chama o colaborador `analise_fraude_reembolso` nativamente (via A2A, testado no Agent Lab), o Orchestrate registra a interação (mensagem enviada/recebida) mas **nunca captura o uso de token** dessa chamada — testado também com o provider alternativo `external_chat` puro (chat completions, sem A2A), com uma resposta contendo um campo `usage` real e corretamente formatado; o Orchestrate simplesmente não lê esse campo. Isso não é uma falha de configuração: o Orchestrate não tem canal para receber telemetria de dentro de um agente externo através da chamada de colaborador.

### A solução: endpoint de ingestão OTLP dedicado

O watsonx Orchestrate expõe um endpoint de ingestão de traces via **OTLP/HTTP**, independente de como o agente está registrado como colaborador, documentado em [`developer.watson-orchestrate.ibm.com/traces/otel-export`](https://developer.watson-orchestrate.ibm.com/traces/otel-export). Qualquer processo (não precisa ser um agente rodando dentro do Orchestrate) pode instrumentar sua própria execução com o SDK do OpenTelemetry e enviar spans diretamente pra lá.

O backend faz isso em `sendFraudCallTelemetry` (`backend/server.js`), chamada de forma *fire-and-forget* logo após cada chamada real ao Foundry, sem nunca afetar a resposta ao cliente:

1. Cria um `TracerProvider` (`@opentelemetry/sdk-trace-node`) com um `Resource` contendo `service.name`, `tenant.id` e `deployment.environment`.
2. Configura um `OTLPTraceExporter` (`@opentelemetry/exporter-trace-otlp-http`) apontando pra `OTEL_EXPORT_URL`, autenticado com um bearer token IBM Cloud IAM (o mesmo mecanismo já usado pra falar com a API de Runs).
3. Cria um span cobrindo o intervalo real da chamada ao Foundry (`startTime`/`endTime`), com os atributos exigidos pela doc: `agent.id`, `langfuse.session.id` (UUID por chamada) e `langfuse.user.id` (`usr_` + hex).
4. Chama `provider.forceFlush()` pra garantir que o span seja enviado antes do processo seguir (o SDK usa um `BatchSpanProcessor` por padrão, que teria enviado de forma assíncrona/atrasada sem isso).

**O detalhe que faltava na documentação e que resolveu o problema:** por padrão, um span enviado assim chega ao Orchestrate com `usage: {input: 0, output: 0, total: 0}`, mesmo contendo os atributos `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` (convenção semântica padrão do OpenTelemetry GenAI). O backend do Orchestrate reaproveita o modelo de dados do [Langfuse](https://langfuse.com/) internamente, e o Langfuse só calcula/exibe `usage` para observações explicitamente marcadas como tipo `generation` — não para um `SPAN` genérico. A correção foi adicionar dois atributos extras ao span:

```js
"langfuse.observation.type": "generation",
"langfuse.observation.usage_details": JSON.stringify({
  input: inputTokens,
  output: outputTokens,
  total: inputTokens + outputTokens,
}),
```

Com isso, o span passa a chegar como `type: GENERATION` e `usage: {input, output, total}` com números reais — confirmado tanto localmente quanto em produção, exportando o trace via `orchestrate observability traces export --trace-id <id>` e inspecionando o JSON.

Como a resposta do Foundry via A2A não traz contagem de token nenhuma, o backend estima o uso com uma heurística simples (`Math.ceil(texto.length / 4)`, uma aproximação comum quando não há tokenizador real disponível) — não é uma contagem exata do modelo, é uma estimativa plausível pra fins de visualização de custo/volume.

### Variáveis de ambiente necessárias

| Variável | O que é |
| --- | --- |
| `OTEL_EXPORT_URL` | Endpoint de ingestão: `https://api.<região>.watson-orchestrate.cloud.ibm.com/instances/<instance-id>/v1/orchestrate/inject/traces` (mesmo host/instância do `WO_API_URL`) |
| `WO_TENANT_ID` | Formato `<account-id>_<instance-id>` — aparece como `wxo_tenant_id` no contexto de qualquer trace já exportado do ambiente |
| `OTEL_FRAUD_AGENT_ID` | UUID do agente `analise_fraude_reembolso` dentro do Orchestrate (não confundir com o `agent_id`/nome do lado do Foundry) — aparece como `current_agent_id` em traces onde esse colaborador foi chamado |

Sem essas variáveis configuradas, `sendFraudCallTelemetry` simplesmente não envia nada — não quebra a aplicação.

### Como verificar

1. Simule uma contestação de compra completa no chat (relatar uma compra + confirmar).
2. Pegue o `trace_id` mais recente: `orchestrate observability traces search --last 15m`.
3. Exporte: `orchestrate observability traces export --trace-id <id> -o trace.json`.
4. Confira a observação `analise_fraude_reembolso`: deve ter `"type": "GENERATION"` e `"usage": {"input": N, "output": N, "total": N}` com números reais.
5. No Control Plane: **Analyze → analise_fraude_reembolso → Overview/Conversations**, ou na aba **FinOps → Token usage → By model**, o agente aparece como entidade própria, separada do `gpt-5.4` nativo.

### Fontes usadas para configurar isso

- [Exporting traces (IBM Support)](https://www.ibm.com/support/pages/exporting-watsonx-orchestrate-agent-trace) — mecanismo de **exportação** de traces do Orchestrate (CLI/API), usado para inspecionar os resultados, não para ingestão.
- [`developer.watson-orchestrate.ibm.com/traces/otel-export`](https://developer.watson-orchestrate.ibm.com/traces/otel-export) — **fonte principal**: documenta o endpoint de ingestão OTLP para agentes externos, variáveis de ambiente obrigatórias, atributos de span exigidos e autenticação (IAM / MCSP v2 / `x-api-key` legado).
- [`developer.watson-orchestrate.ibm.com/llm/observability`](https://developer.watson-orchestrate.ibm.com/llm/observability) — confirma que a única configuração de observability nativa do Orchestrate é `kind: langfuse`, o que apontou pro backend reaproveitar o modelo de dados do Langfuse.
- [`developer.watson-orchestrate.ibm.com/traces/traces_with_python`](https://developer.watson-orchestrate.ibm.com/traces/traces_with_python) — cliente Python (`TracesController`) equivalente ao `orchestrate observability traces export`, usado só como referência/comparação.
- [Building a Bridge: Connecting watsonx Orchestrate LangFuse Observability to Instana (Tony Hickman, IBM)](https://medium.com/musings-of-a-software-architect/building-a-bridge-connecting-watsonx-orchestrate-langfuse-observability-to-instana-1460e0d99aae) — confirmou que o campo `url` da config `kind: langfuse` aceita qualquer endpoint compatível com OTLP, não só o Langfuse real; ajudou a entender que o Orchestrate fala OTLP "por baixo" mesmo fora do endpoint de ingestão de agentes externos.
- [`langfuse/langfuse#11135` (GitHub issue)](https://github.com/langfuse/langfuse/issues/11135) — relato de outro usuário com o mesmo sintoma (`gen_ai.usage.*` não populava o uso de token via OTLP); apontou a direção de investigar o campo de **tipo** da observação, o que levou à descoberta do `langfuse.observation.type: "generation"`.
- [Azure AI Foundry — Configurar o rastreamento de agentes de IA](https://learn.microsoft.com/pt-br/azure/foundry/observability/how-to/trace-agent-setup) e [Tracing and Data Handling](https://learn.microsoft.com/en-us/azure/foundry/observability/concepts/trace-data) — usadas para confirmar que o OpenTelemetry do lado do Foundry só exporta para o Azure Monitor Application Insights (ou um coletor local via VS Code), nunca para um destino externo como o watsonx Orchestrate — ou seja, essa direção (Foundry → Orchestrate) não tem caminho nativo; a solução implementada instrumenta o **backend**, não o Foundry.

## Estrutura

- `frontend/src/` componentes React e estilos do chat
- `frontend/assets/` arquivos compilados (gerados, fora do Git)
- `backend/server.js` servidor HTTP, integrações com Orchestrate/Foundry, camada de confiabilidade determinística, telemetria OTLP
- `backend/progress.js` traduz eventos de execução em etapas do painel de andamento, sem divulgar argumentos das ferramentas
- `mock-db/` dados e API mock local
- `agents/<slug>/` definição independente de cada agente para importar no ADK

Não commite API keys. Use `.env` local e mantenha-o fora do Git (`.env.example` documenta as variáveis esperadas).

## Build e Render

Mantenha o build do Render como `npm install` e o start como `node backend/server.js`.
O script `postinstall` compila automaticamente o React. Após editar `frontend/src/`, execute `npm run build` para gerar novamente os arquivos servidos pelo Node.

O chat via `/runs` seleciona explicitamente o ambiente **Live** do agente, consultando seu UUID na IBM e mantendo-o em cache durante o processo. Sem `environment_id`, a IBM executa em Draft, cujas métricas podem ficar fora das visualizações de produção. Publique o agente e seus colaboradores antes de usar a aplicação. Opcionalmente, configure `WO_ENVIRONMENT_ID` com o UUID do ambiente desejado; não use o texto `live` como identificador. Essa seleção não altera traces antigos nem controla o prazo de atualização do Control Plane.

Para testar o andamento: `node --test backend/progress.test.js`.
O teste de navegador `python tools/verify_chat.py` usa Playwright e python-dotenv e chama o agente real com as credenciais locais. `TEST_CHAT_URL` permite validar o site publicado.

## Pix e consultas salvas

O agente busca por valor e data, apresenta o candidato e só consulta o status após confirmação. Exemplo do banco de demonstração: R$ 850 em 08/09/2026, favorecido Humberto Palma. As tools consultam `/api/demo/records` no Render; esse endpoint somente expõe os registros fictícios do cliente fixo `cli-001` e não deve ser usado com dados bancários reais.

"Salvar consulta" mantém o identificador e o último status no localStorage deste navegador. Clicar no cartão pede uma nova consulta ao agente. Excluir remove somente a visualização local, após confirmação, sem cancelar o registro bancário. As etapas operacionais de cada resposta ficam recolhidas acima dela.
