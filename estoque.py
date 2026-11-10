"""Controle de estoque: curva ABC, lote econômico, estoque de segurança e ponto de pedido.

Funções puras, sem banco, para poder conferir as contas à mão (e nos testes).

Fórmulas (todas por produto):
  d̄   = consumo médio diário  = saídas no período / dias do período
  σd  = desvio-padrão do consumo diário, medido por SEMANA e convertido: σd = σsemana / √7
        (assim funciona tanto com lançamento diário quanto semanal)
  D   = demanda anual = d̄ × 365
  C   = custo unitário (preço do item de empenho mais recente)
  L   = prazo de entrega em dias (média real pedido → NF do produto; senão o padrão)
  σL  = desvio-padrão do prazo (0 quando há só uma entrega)
  Z   = fator do nível de serviço (distribuição normal; 95% → 1,645)

  Curva ABC  : ordena por valor anual de consumo (D × C); A até 80% do acumulado, B até 95%, C o resto
  LEC        : √(2 × D × S / H), com S = custo de fazer um pedido e H = i × C (custo anual de manter 1 unidade)
               se o produto tem vida útil, o lote é limitado ao que se consome nesse prazo (d̄ × vida útil)
  ES         : Z × √(L × σd² + d̄² × σL²)
  PP         : d̄ × L + ES
"""
import math
from datetime import date, timedelta
from statistics import NormalDist, mean, pstdev

PADROES = {
    "custo_pedido": 50.0,        # S — R$ por pedido (tempo de cotação, e-mail, recebimento, conferência)
    "taxa_manutencao": 25.0,     # i — % ao ano sobre o valor do item (armazenagem, perdas, capital parado)
    "nivel_servico": 95.0,       # % de chance de não faltar durante o prazo de entrega
    "periodo_dias": 90,          # janela de consumo usada no cálculo
    "prazo_padrao_dias": 7,      # prazo quando o produto ainda não tem entregas registradas
    "limite_a": 80.0,            # % acumulado que fecha a classe A
    "limite_b": 95.0,            # % acumulado que fecha a classe B
}


def fator_z(nivel_servico):
    p = min(max(float(nivel_servico) / 100.0, 0.5), 0.9999)
    return NormalDist().inv_cdf(p)


def _d(s):
    if isinstance(s, date):
        return s
    return date.fromisoformat(str(s)[:10])


def estatistica_consumo(saidas, hoje, periodo_dias, inicio_dados=None):
    """saidas: lista de (data, qtd). Devolve d̄, σd, dias considerados, total e nº de semanas.

    O período começa no maior entre (hoje - periodo_dias) e o primeiro registro do produto,
    para um produto novo não parecer ter consumo menor do que tem.
    """
    hoje = _d(hoje)
    ini = hoje - timedelta(days=int(periodo_dias) - 1)
    if inicio_dados:
        ini = max(ini, _d(inicio_dados))
    dias = max(1, (hoje - ini).days + 1)
    no_periodo = [(_d(d), float(q)) for d, q in saidas if ini <= _d(d) <= hoje]
    total = sum(q for _, q in no_periodo)
    media = total / dias
    semanas = dias // 7
    sigma = None
    if semanas >= 2:
        # semanas completas contadas de hoje para trás
        tot_sem = [0.0] * semanas
        for d, q in no_periodo:
            k = (hoje - d).days // 7
            if k < semanas:
                tot_sem[k] += q
        sigma = pstdev(tot_sem) / math.sqrt(7)
    return {"media_diaria": media, "desvio_diario": sigma, "dias": dias, "total": total, "semanas": semanas,
            "inicio": ini.isoformat()}


def estatistica_prazo(prazos, padrao):
    """prazos: dias entre pedido e NF de cada entrega do produto."""
    vals = [float(p) for p in prazos if p is not None and p >= 0]
    if not vals:
        return {"prazo": float(padrao), "desvio_prazo": 0.0, "entregas": 0, "origem": "padrao"}
    return {"prazo": mean(vals), "desvio_prazo": pstdev(vals) if len(vals) > 1 else 0.0,
            "entregas": len(vals), "origem": "historico"}


def calcular_produto(p, cfg):
    """p: dict com media_diaria, desvio_diario, prazo, desvio_prazo, custo_unitario, saldo,
    vida_util_dias e overrides (nivel_servico, custo_pedido, taxa_manutencao). Devolve os indicadores."""
    S = float(p.get("custo_pedido") or cfg["custo_pedido"])
    i = float(p.get("taxa_manutencao") or cfg["taxa_manutencao"]) / 100.0
    ns = float(p.get("nivel_servico") or cfg["nivel_servico"])
    z = fator_z(ns)
    d = float(p["media_diaria"] or 0)
    sd = p["desvio_diario"]
    L = float(p["prazo"] or 0)
    sL = float(p["desvio_prazo"] or 0)
    C = float(p["custo_unitario"] or 0)
    D = d * 365
    H = i * C
    lec = math.sqrt(2 * D * S / H) if D > 0 and H > 0 else None
    limitado = False
    if lec and p.get("vida_util_dias"):
        teto = d * float(p["vida_util_dias"])
        if teto < lec:
            lec, limitado = teto, True
    es = z * math.sqrt(L * (sd or 0) ** 2 + d ** 2 * sL ** 2) if d > 0 else 0.0
    pp = d * L + es
    saldo = float(p.get("saldo") or 0)
    cobertura = saldo / d if d > 0 else None
    if d <= 0:
        situacao = "SEM_CONSUMO"
    elif saldo <= es + 1e-9:
        situacao = "CRITICO"
    elif saldo <= pp + 1e-9:
        situacao = "PEDIR"
    else:
        situacao = "OK"
    return {
        "nivel_servico": ns, "z": z, "custo_pedido": S, "taxa_manutencao": i * 100,
        "demanda_anual": D, "valor_anual": D * C, "custo_manter_unid": H,
        "lec": lec, "lec_limitado_validade": limitado,
        "pedidos_por_ano": (D / lec) if lec else None,
        "intervalo_dias": (lec / d) if lec and d else None,
        "estoque_seguranca": es, "ponto_pedido": pp, "cobertura_dias": cobertura,
        "situacao": situacao,
        "desvio_estimado": sd is None,
    }


def curva_abc(produtos, limite_a=80.0, limite_b=95.0):
    """produtos: lista de dicts com 'id' e 'valor_anual'. Devolve {id: (classe, % do total, % acumulado)}.

    Classe pelo percentual ACUMULADO do produto: A até limite_a, B até limite_b, C o resto.
    O primeiro produto é sempre A (mesmo que sozinho passe do limite). Sem consumo fica em C.
    """
    total = sum(max(0.0, p["valor_anual"]) for p in produtos)
    out, acum = {}, 0.0
    for n, p in enumerate(sorted(produtos, key=lambda x: -x["valor_anual"])):
        v = max(0.0, p["valor_anual"])
        part = v / total * 100 if total else 0.0
        acum += part
        if v <= 0:
            classe = "C"
        elif n == 0 or acum <= limite_a + 1e-9:
            classe = "A"
        elif acum <= limite_b + 1e-9:
            classe = "B"
        else:
            classe = "C"
        out[p["id"]] = (classe, part, acum if total else 0.0)
    return out
