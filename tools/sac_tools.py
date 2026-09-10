"""Read-only queries made by Orchestrate against the demo backend."""
import json
from urllib.parse import urlencode
from urllib.request import urlopen

from ibm_watsonx_orchestrate.agent_builder.tools import tool, ToolPermission

BASE_URL = 'https://demo-ibm-sac-bancario.onrender.com/api/demo/records'


def _query(category, **filters):
    params = {'category': category, **{key: value for key, value in filters.items() if value is not None and value != ''}}
    with urlopen(BASE_URL + '?' + urlencode(params), timeout=30) as response:
        return response.read().decode('utf-8')


@tool(name='consultar_cliente', description='Consulta o cliente já identificado na sessão de demonstração.', permission=ToolPermission.READ_ONLY)
def consultar_cliente() -> str:
    return _query('cliente')


@tool(name='consultar_pix', description='Busca Pix do cliente da sessão por valor e data. Retorna candidatos para confirmação. Com pix_id confirmado, consulta o status bancário e o motivo atual.', permission=ToolPermission.READ_ONLY)
def consultar_pix(amount: float = 0, date: str = '', pix_id: str = '') -> str:
    """Use amount em reais e date YYYY-MM-DD. Use pix_id somente após confirmação do candidato pelo cliente, ou para atualizar consulta salva."""
    return _query('pix', amount=amount, date=date, id=pix_id)


@tool(name='consultar_cartao', description='Consulta status do cartão do cliente da sessão.', permission=ToolPermission.READ_ONLY)
def consultar_cartao() -> str:
    return _query('cartao')


@tool(name='consultar_compra', description='Consulta compras contestadas do cliente da sessão.', permission=ToolPermission.READ_ONLY)
def consultar_compra() -> str:
    return _query('compra')


@tool(name='consultar_parcela', description='Consulta parcelas do cliente da sessão.', permission=ToolPermission.READ_ONLY)
def consultar_parcela() -> str:
    return _query('parcela')


@tool(name='consultar_perfil', description='Consulta status cadastral do cliente da sessão.', permission=ToolPermission.READ_ONLY)
def consultar_perfil() -> str:
    return _query('perfil')
