# Contrato de execução retornado pelo agente

O agente deve consultar as tools de dados antes de responder e retornar, junto da mensagem ao cliente, um campo `execution`:

```json
{
  "steps": [
    {"label": "Cliente identificado", "status": "done", "time": "21:58:02"},
    {"label": "Dados consultados", "status": "done", "detail": "Pix / core bancário"},
    {"label": "Regra de elegibilidade", "status": "active", "detail": "em andamento"},
    {"label": "Resolução", "status": "pending"}
  ]
}
```

O front-end não interpreta o assunto nem consulta o banco para montar esse painel. Ele apenas renderiza `execution.steps` recebido na resposta do agente.
