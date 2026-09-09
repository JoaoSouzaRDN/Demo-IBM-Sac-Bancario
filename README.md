# Demo IBM — SAC bancário

Demo local com cinco jornadas de atendimento e dados mockados. O front usa um adaptador local por padrão; para conectar ao watsonx Orchestrate, configure `WO_CHAT_URL` no backend (a API key fica somente no servidor).

## Jornadas

1. Pix não recebido
2. Cartão perdido ou roubado
3. Compra com cartão contestada
4. Empréstimo com parcela em atraso
5. Atualização cadastral

## Estrutura

- `frontend/` interface de chat inspirada no Arena GPT
- `mock-db/` dados e API mock local
- `agents/<slug>/` definição independente para importar no ADK

Não commite API keys. Use `.env` local e mantenha-o fora do Git.
