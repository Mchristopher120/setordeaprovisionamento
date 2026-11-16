"""Leitura da Nota de Empenho em PDF (impressão do SIAFI / Tesouro Gerencial) por regras fixas — sem IA.

Extrai: ano e número da NE, data de emissão, processo (NUP), valor, CNPJ e nome do
favorecido e a lista de itens (nº do item de compra, descrição, quantidade, valor unitário).
A NE não traz a unidade de medida: ela é completada na prévia, antes de gravar.

As expressões funcionam com o texto em "linhas embaralhadas" (pypdf) e em colunas
(pdftotext -layout), porque procuram padrões de conteúdo, não posições.
"""
import io
import re

RE_NE = re.compile(r"\b(20\d{2})\s+NE\s+(\d{1,6})\b")
RE_EMISSAO = re.compile(r"(\d{2}/\d{2}/\d{4})\s+\S+\s+(\d{5}\.\d{6}/\d{4}-\d{2})\s+[\d.,]+\s+(\d{1,3}(?:\.\d{3})*,\d{2})")
RE_NUP = re.compile(r"\b(\d{5}\.\d{6}/\d{4}-\d{2})\b")
RE_DOC = r"(?:\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})"
RE_FAVORECIDO = re.compile(rf"^\s*({RE_DOC})\s+(\S.*?)\s*$", re.M)
RE_CEP_FIM = re.compile(r"\d{5}-\d{3}\s*$")
RE_ITEM = re.compile(r"Item\s+compra:\s*(\d+)\s*-\s*(.*?)(?=Data\s+Opera)", re.S)
RE_OPERACAO = re.compile(
    r"(\d{2}/\d{2}/\d{4})\s+(Inclus[ãa]o|Refor[çc]o|Anula[çc][ãa]o|Cancelamento)\s+"
    r"(\d{1,3}(?:\.\d{3})*,\d+)\s+(\d{1,3}(?:\.\d{3})*,\d+)\s+(\d{1,3}(?:\.\d{3})*,\d{2})")
RE_VALOR_FIM = re.compile(r"\s+\d{1,3}(?:\.\d{3})*,\d{2}\s*$")


def _num(s):
    return float(str(s).replace(".", "").replace(",", "."))


def _data_iso(s):
    d, m, a = s.split("/")
    return f"{a}-{m}-{d}"


def texto_do_pdf(conteudo):
    """Texto de todas as páginas (pypdf, puro Python — funciona no Vercel)."""
    from pypdf import PdfReader
    leitor = PdfReader(io.BytesIO(conteudo))
    return "\n".join((p.extract_text() or "") for p in leitor.pages)


def _limpar_nome(nome):
    nome = re.sub(r"\s+", " ", nome).strip()
    # MEI aparece como "61.256.782 TAMER DE OLIVEIRA RAMOS": tira o número repetido na frente
    nome = re.sub(r"^\d{2}\.\d{3}\.\d{3}\s+", "", nome)
    return nome.upper()


def ler_nota_empenho(texto):
    """Devolve (dados, avisos). dados = None quando o texto não parece uma Nota de Empenho."""
    avisos = []
    if "Nota de Empenho" not in texto and not RE_NE.search(texto):
        return None, ["O arquivo não parece ser uma Nota de Empenho do SIAFI."]
    m = RE_NE.search(texto)
    if not m:
        return None, ["Não encontrei o ano e o número da NE no arquivo."]
    ano, numero = m.group(1), int(m.group(2))
    dados = {"ano": ano, "numero": numero, "ne": f"{ano}NE{numero:06d}", "data_emissao": None,
             "processo": "", "nup": "", "valor": None, "cnpj": "", "fornecedor": "", "itens": []}

    m = RE_EMISSAO.search(texto)
    if m:
        dados["data_emissao"], dados["nup"], dados["valor"] = _data_iso(m.group(1)), m.group(2), _num(m.group(3))
    else:
        n = RE_NUP.search(texto)
        if n:
            dados["nup"] = n.group(1)
        avisos.append("Não encontrei a data de emissão e o valor total da NE.")
    if dados["nup"]:
        # Padrão do setor: só o número do meio do NUP (64491.002824/2026-60 -> 2824)
        dados["processo"] = str(int(dados["nup"].split(".")[1].split("/")[0]))

    # Favorecido: linha "CNPJ NOME". A linha do CNPJ da própria UG traz endereço e termina em CEP.
    for f in RE_FAVORECIDO.finditer(texto):
        if RE_CEP_FIM.search(f.group(2)):
            continue
        dados["cnpj"], dados["fornecedor"] = f.group(1), _limpar_nome(f.group(2))
        break
    if not dados["fornecedor"]:
        avisos.append("Não encontrei o favorecido (fornecedor). Preencha o nome antes de gravar.")

    blocos = list(RE_ITEM.finditer(texto))
    for i, b in enumerate(blocos):
        linhas = [RE_VALOR_FIM.sub("", ln).strip() for ln in b.group(2).splitlines()]
        desc = re.sub(r"\s+", " ", " ".join(ln for ln in linhas if ln)).strip(" -")
        fim = blocos[i + 1].start() if i + 1 < len(blocos) else len(texto)
        qtde, vu, total = 0.0, 0.0, 0.0
        for op in RE_OPERACAO.finditer(texto, b.end(), fim):
            q, v, t = _num(op.group(3)), _num(op.group(4)), _num(op.group(5))
            sinal = -1 if re.match(r"Anula|Cancel", op.group(2)) else 1
            qtde += sinal * q
            total += sinal * t
            if sinal > 0 and v > 0:
                vu = v
        if qtde > 0 and total > 0 and (not vu or abs(qtde * vu - total) > 0.011):
            vu = round(total / qtde, 4)
        if qtde <= 0:
            avisos.append(f"Item {int(b.group(1))} ({desc[:30]}) ficou sem quantidade (anulado?) e foi deixado de fora.")
            continue
        dados["itens"].append({"numero_item": str(int(b.group(1))), "descricao": desc, "und": "",
                               "qtde": round(qtde, 5), "valor_unitario": vu, "valor_total": round(total, 2)})
    if not dados["itens"]:
        avisos.append("Não encontrei itens na NE.")
    soma = round(sum(i["valor_total"] for i in dados["itens"]), 2)
    dados["soma_itens"] = soma
    if dados["valor"] is not None and dados["itens"] and abs(soma - dados["valor"]) > 0.011:
        avisos.append(f"A soma dos itens (R$ {soma:,.2f}) não bate com o valor da NE (R$ {dados['valor']:,.2f}). Confira."
                      .replace(",", "X").replace(".", ",").replace("X", "."))
    return dados, avisos
