# Demo IBM — SAC bancário

Demo com cinco jornadas de atendimento e dados mockados, frontend React e backend Node conectado ao watsonx Orchestrate. Configure `WO_API_URL`, `WO_AGENT_ID` e `WO_API_KEY` no servidor. O chat usa os eventos reais da execução para exibir o andamento; as consultas são realizadas pelo agente.

## Jornadas

1. Pix não recebido
2. Cartão perdido ou roubado
3. Compra com cartão contestada
4. Empréstimo com parcela em atraso
5. Atualização cadastral

## Estrutura

- `frontend/src/` componentes React e estilos do chat
- `frontend/assets/` arquivos compilados (gerados, fora do Git)
- `backend/progress.js` traduz eventos de execução em etapas, sem divulgar argumentos das ferramentas
- `mock-db/` dados e API mock local
- `agents/<slug>/` definição independente para importar no ADK

Não commite API keys. Use `.env` local e mantenha-o fora do Git.

## Build e Render

Mantenha o build do Render como `npm install` e o start como `node backend/server.js`.
O script `postinstall` compila automaticamente o React. Após editar `frontend/src/`, execute `npm run build` para gerar novamente os arquivos servidos pelo Node.

Para testar o andamento: `node --test backend/progress.test.js`.
O teste de navegador `python tools/verify_chat.py` usa Playwright e python-dotenv e chama o agente real com as credenciais locais. `TEST_CHAT_URL` permite validar o site publicado.
