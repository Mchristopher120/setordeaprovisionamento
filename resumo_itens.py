"""Nome curto de um item a partir da descrição do catálogo (CATMAT), por regras fixas — sem IA.

Exemplos:
  'LEGUME IN NATURA, TIPO ABÓBORA MORANGA'            -> 'abóbora moranga'
  'FRIOS, VARIEDADE MORTADELA, TIPO PREPARAÇÃO COZIDO' -> 'mortadela'
  'FARINHA DE TRIGO, GRUPO INDUSTRIAL, TIPO TIPO 1'    -> 'farinha de trigo'
  'CARNE SALGADA TIPO CORTE: ORELHA, ORIGEM: SUÍNA'    -> 'carne salgada'
"""
import re

# Descrições que começam por uma categoria genérica: o nome está depois de TIPO/VARIEDADE
GENERICOS = {
    "LEGUME", "LEGUMES", "VERDURA", "VERDURAS", "FRUTA", "FRUTAS", "HORTALICA", "HORTALIÇA",
    "FRIOS", "TEMPERO", "CONDIMENTO", "ESPECIARIA", "CEREAL", "GRAO", "GRÃO", "BEBIDA", "DOCE",
    "CARNE", "CARNE BOVINA", "CARNE SUINA", "CARNE SUÍNA", "PESCADO", "PEIXE", "AVE",
    "LEGUME EM CONSERVA", "CONSERVA", "PRODUTO", "GENERO ALIMENTICIO", "GÊNERO ALIMENTÍCIO",
}
CHAVES = r"(?:VARIEDADE|TIPO|ESPECIE|ESPÉCIE|SABOR)"
# Palavras a partir das quais o resto é especificação, não nome
CORTES = r"\s+(?:TIPO|CLASSE|GRUPO|MATERIAL|APRESENTA[CÇ][AÃ]O|EMBALAGEM|COMPOSI[CÇ][AÃ]O|ORIGEM|CAPACIDADE|" \
         r"APLICA[CÇ][AÃ]O|CARACTER[IÍ]STICAS?|ESTADO|FORMATO|INGREDIENTES?|VALIDADE|PESO|COM|CONTENDO)\b.*$"


def _limpar(s):
    s = re.split(r"\s+[-–/]\s*|\s*/\s+|\(", s)[0]          # 'MANDIOCA - AIPIM', 'BANANA PRATA / BRANCA'
    s = re.sub(CORTES, "", s, flags=re.I)
    s = re.sub(r"\b\S*\d\S*\b", "", s)                     # medidas: 7,5mx30cm, 1KG, 2L
    s = re.sub(r"\b(IN NATURA|NATURAL|EXTRA|ESPECIAL)\b", "", s, flags=re.I)
    s = re.sub(r"[\s,.;:]+", " ", s).strip(" -")
    return s


def nome_curto(descricao):
    d = re.sub(r"\s+", " ", str(descricao or "")).strip()
    if not d:
        return ""
    primeiro = re.split(r"[,.;:]", d, maxsplit=1)[0]
    cabeca = re.sub(r"\s+" + CHAVES + r"\b.*$", "", primeiro, flags=re.I)
    cabeca_sem_natura = re.sub(r"\s+(IN NATURA|EM NATURA)$", "", cabeca, flags=re.I).strip()
    nome = ""
    if cabeca_sem_natura.upper() in GENERICOS or re.search(r"\bIN NATURA\b", cabeca, re.I):
        m = re.search(CHAVES + r"\s*:?\s*([^,;.]+)", d, flags=re.I)
        if m:
            valor = re.sub(r"^(?:(?:TIPO|VARIEDADE|CORTE)\s*:?\s*)+", "", m.group(1).strip(), flags=re.I)
            nome = _limpar(valor)
    if not nome:
        nome = _limpar(cabeca) or _limpar(primeiro)
    nome = nome.lower()
    return nome[:40].rsplit(" ", 1)[0] if len(nome) > 40 else nome


def resumo_de_itens(descricoes, maximo=None):
    """Lista sem repetição, na ordem dos itens: ['abóbora moranga', 'alface crespa', ...]."""
    vistos, out = set(), []
    for desc in descricoes:
        n = nome_curto(desc)
        if n and n not in vistos:
            vistos.add(n)
            out.append(n)
    return out[:maximo] if maximo else out
