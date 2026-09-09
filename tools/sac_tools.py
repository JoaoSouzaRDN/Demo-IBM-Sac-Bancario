import json
from pathlib import Path
from ibm_watsonx_orchestrate.agent_builder.tools import tool, ToolPermission
DATA = json.loads((Path(__file__).parent.parent / "mock-db" / "data.json").read_text(encoding="utf-8"))
def _find(collection, customer_id): return json.dumps([x for x in DATA[collection] if x.get("customerId")==customer_id], ensure_ascii=False)
@tool(name="consultar_cliente", description="Consulta dados básicos do cliente.", permission=ToolPermission.READ_ONLY)
def consultar_cliente(customer_id: str="cli-001")->str: return json.dumps(next((x for x in DATA["customers"] if x["id"]==customer_id),{}),ensure_ascii=False)
@tool(name="consultar_pix", description="Consulta transações Pix.", permission=ToolPermission.READ_ONLY)
def consultar_pix(customer_id: str="cli-001")->str: return _find("pix",customer_id)
@tool(name="consultar_cartao", description="Consulta cartões.", permission=ToolPermission.READ_ONLY)
def consultar_cartao(customer_id: str="cli-001")->str: return _find("cards",customer_id)
@tool(name="consultar_compra", description="Consulta compras contestadas.", permission=ToolPermission.READ_ONLY)
def consultar_compra(customer_id: str="cli-001")->str: return _find("purchases",customer_id)
@tool(name="consultar_parcela", description="Consulta parcelas de empréstimo.", permission=ToolPermission.READ_ONLY)
def consultar_parcela(customer_id: str="cli-001")->str: return _find("loans",customer_id)
@tool(name="consultar_perfil", description="Consulta perfil cadastral.", permission=ToolPermission.READ_ONLY)
def consultar_perfil(customer_id: str="cli-001")->str: return _find("profiles",customer_id)
@tool(name="registrar_atendimento", description="Registra uma ação autorizada.", permission=ToolPermission.ADMIN)
def registrar_atendimento(tipo: str, resumo: str)->str: return json.dumps({"status":"registered","protocol":"SAC-20260909-001","tipo":tipo,"resumo":resumo},ensure_ascii=False)
