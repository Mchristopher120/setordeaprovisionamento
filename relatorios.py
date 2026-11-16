"""Relatórios em PDF (fpdf2): situação dos empenhos e relatório semanal/mensal.

Recebem dados já prontos (listas e dicionários) e devolvem um BytesIO; quem
consulta o banco é o app.py. Mesmo cabeçalho azul-marinho e dourado do pedido.
"""
import io
import os
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NAVY = (26, 51, 115)
GOLD = (201, 174, 96)
CLARO = (180, 196, 224)
TEXTO = (30, 34, 45)
MUDO = (105, 112, 128)
LINHA = (222, 226, 234)
TRILHO = (228, 232, 240)
AZUL = (59, 110, 220)
VERDE = (22, 150, 100)
VERMELHO = (200, 45, 45)
FUNDO = (245, 247, 251)


def brl(v):
    return "R$ " + f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(v):
    return f"{float(v or 0):.1f}%".replace(".", ",")


def _limpo(txt):
    return "" if txt is None else "".join(c if ord(c) >= 32 else " " for c in str(txt))


def _novo_pdf(titulo, subtitulo, orgao="3º CENTRO DE GEOINFORMAÇÃO"):
    from fpdf import FPDF

    def fonte(peso):
        return os.path.join(BASE_DIR, "static", "fonts", f"Inter-{peso}.ttf")

    class Rel(FPDF):
        def header(self):
            self.set_fill_color(*NAVY)
            self.rect(0, 0, 210, 22, "F")
            brasao = os.path.join(BASE_DIR, "static", "img", "3cgeo.png")
            if os.path.exists(brasao):
                self.image(brasao, x=13, y=2, h=18)
            folha = os.path.join(BASE_DIR, "static", "img", "logistica.png")
            if os.path.exists(folha):
                self.image(folha, x=210 - 13 - 24, y=(22 - 24 * 165 / 320) / 2, w=24)
            self.set_xy(15, 5)
            self.set_text_color(*CLARO)
            self.set_font("Inter", "B", 8)
            self.cell(180, 4, _limpo(f"EXÉRCITO BRASILEIRO  •  {orgao}  •  SETOR DE APROVISIONAMENTO"), align="C")
            self.set_xy(15, 10)
            self.set_text_color(255, 255, 255)
            self.set_font("InterTit", "", 13)
            self.cell(180, 7, _limpo(titulo), align="C")
            self.set_fill_color(*GOLD)
            self.rect(0, 22, 210, 1.6, "F")
            self.set_y(28)
            if self.page_no() == 1 and subtitulo:
                self.set_font("Inter", "", 9.5)
                self.set_text_color(*MUDO)
                self.cell(0, 5, _limpo(subtitulo), align="C", new_x="LMARGIN", new_y="NEXT")
                self.ln(3)

        def footer(self):
            self.set_y(-13)
            self.set_draw_color(*NAVY)
            self.set_line_width(0.3)
            self.line(15, self.get_y(), 195, self.get_y())
            self.set_y(-11)
            self.set_font("Inter", size=7.5)
            self.set_text_color(*MUDO)
            self.cell(0, 7, _limpo(f"{orgao}  •  Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}  •  Página {self.page_no()}/{{nb}}"), align="C")

    pdf = Rel("P", "mm", "A4")
    pdf.add_font("Inter", "", fonte("Regular"))
    pdf.add_font("Inter", "B", fonte("SemiBold"))
    pdf.add_font("InterTit", "", fonte("Bold"))
    pdf.add_font("InterTit", "B", fonte("ExtraBold"))
    pdf.alias_nb_pages()
    pdf.set_margins(15, 15, 15)
    pdf.set_auto_page_break(auto=True, margin=17)
    pdf.add_page()
    return pdf


def _cortar(pdf, txt, largura):
    """Corta o texto com reticências para caber em uma linha da largura dada."""
    txt = _limpo(txt)
    if pdf.get_string_width(txt) <= largura:
        return txt
    while txt and pdf.get_string_width(txt + "…") > largura:
        txt = txt[:-1]
    return txt.rstrip() + "…"


def _titulo_secao(pdf, txt, extra=""):
    if pdf.get_y() > 262:
        pdf.add_page()
    pdf.ln(2)
    pdf.set_font("InterTit", "", 11.5)
    pdf.set_text_color(*NAVY)
    pdf.cell(120, 7, _limpo(txt))
    if extra:
        pdf.set_font("Inter", "", 9)
        pdf.set_text_color(*MUDO)
        pdf.cell(60, 7, _limpo(extra), align="R")
    pdf.ln(7)
    pdf.set_draw_color(*GOLD)
    pdf.set_line_width(0.7)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(2.5)


def _caixas(pdf, itens):
    """Linha de números-resumo: [(rótulo, valor, cor opcional)]."""
    n = len(itens)
    gap = 3
    w = (180 - gap * (n - 1)) / n
    y = pdf.get_y()
    for i, it in enumerate(itens):
        rot, val = it[0], it[1]
        cor = it[2] if len(it) > 2 and it[2] else TEXTO
        x = 15 + i * (w + gap)
        pdf.set_fill_color(*FUNDO)
        pdf.set_draw_color(*LINHA)
        pdf.rect(x, y, w, 16, "DF", round_corners=True, corner_radius=1.6)
        pdf.set_xy(x + 3, y + 2.4)
        pdf.set_font("Inter", "B", 6.8)
        pdf.set_text_color(*MUDO)
        pdf.cell(w - 6, 3.5, _limpo(rot.upper()))
        pdf.set_xy(x + 3, y + 7)
        pdf.set_font("InterTit", "", 11 if n <= 4 else 9.6)
        pdf.set_text_color(*cor)
        pdf.cell(w - 6, 6, _cortar(pdf, val, w - 6))
    pdf.set_y(y + 16 + 4)


def _tabela(pdf, colunas, linhas, vazio="Nada no período."):
    """colunas: [(título, largura, 'L'|'R'|'C')]; linhas: listas de textos (ou (texto, cor))."""
    def cabecalho():
        pdf.set_font("Inter", "B", 7.6)
        pdf.set_text_color(*MUDO)
        pdf.set_fill_color(*FUNDO)
        for tit, w, al in colunas:
            pdf.cell(w, 6.2, _limpo(tit.upper()), align=al, fill=True)
        pdf.ln(6.2)

    if not linhas:
        pdf.set_font("Inter", "", 9)
        pdf.set_text_color(*MUDO)
        pdf.cell(0, 6, _limpo(vazio), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        return
    cabecalho()
    for ln in linhas:
        if pdf.get_y() > 275:
            pdf.add_page()
            cabecalho()
        pdf.set_font("Inter", "", 8.6)
        for (tit, w, al), cel in zip(colunas, ln):
            txt, cor = (cel if isinstance(cel, tuple) else (cel, TEXTO))
            pdf.set_text_color(*cor)
            pdf.cell(w, 5.8, _cortar(pdf, txt, w - 1.5), align=al)
        pdf.ln(5.8)
        pdf.set_draw_color(*LINHA)
        pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(2)


def _barra(pdf, x, y, w, h, empenhado, liquidado, pago):
    """Barra como a dos cartões: trilho = empenhado, azul = liquidado, verde = pago."""
    pdf.set_fill_color(*TRILHO)
    pdf.rect(x, y, w, h, "F", round_corners=True, corner_radius=h / 2)
    if empenhado <= 0:
        return
    wl = max(0.0, min(1.0, liquidado / empenhado)) * w
    wp = max(0.0, min(1.0, pago / empenhado)) * w
    if wl >= h:
        pdf.set_fill_color(*AZUL)
        pdf.rect(x, y, wl, h, "F", round_corners=True, corner_radius=h / 2)
    if wp >= h:
        pdf.set_fill_color(*VERDE)
        pdf.rect(x, y, wp, h, "F", round_corners=True, corner_radius=h / 2)


def _legenda_barra(pdf):
    y = pdf.get_y()
    x = 15
    pdf.set_font("Inter", "", 8)
    pdf.set_text_color(*MUDO)
    for cor, rot in ((TRILHO, "Empenhado (barra inteira)"), (AZUL, "Liquidado"), (VERDE, "Pago")):
        pdf.set_fill_color(*cor)
        pdf.rect(x, y + 1.2, 5, 2.4, "F", round_corners=True, corner_radius=1.2)
        pdf.set_xy(x + 6.5, y)
        w = pdf.get_string_width(rot) + 6
        pdf.cell(w, 5, _limpo(rot))
        x += 6.5 + w
    pdf.ln(7)


# --------------------------------------------------------------------------
# 1. SITUAÇÃO DOS EMPENHOS
# --------------------------------------------------------------------------
def pdf_situacao(empenhos, filtro_txt=""):
    """empenhos: dicts com ne, nome_credor, processo, itens_resumo (lista), valor_empenhado,
    valor_liquidado, valor_pago, a_liquidar. Agrupa por fornecedor."""
    hoje = datetime.now().strftime("%d/%m/%Y")
    pdf = _novo_pdf("SITUAÇÃO DOS EMPENHOS", f"Posição em {hoje}" + (f"  •  {filtro_txt}" if filtro_txt else ""))
    tot = {k: sum(float(e[k] or 0) for e in empenhos) for k in ("valor_empenhado", "valor_liquidado", "valor_pago", "a_liquidar")}
    _caixas(pdf, [
        ("Empenhos", str(len(empenhos))),
        ("Empenhado", brl(tot["valor_empenhado"])),
        ("Liquidado", brl(tot["valor_liquidado"]), AZUL),
        ("Pago", brl(tot["valor_pago"]), VERDE),
        ("A liquidar", brl(tot["a_liquidar"]), NAVY),
    ])
    _legenda_barra(pdf)
    if not empenhos:
        pdf.set_font("Inter", "", 10)
        pdf.set_text_color(*MUDO)
        pdf.cell(0, 8, "Nenhum empenho com esses filtros.", new_x="LMARGIN", new_y="NEXT")

    grupos = {}
    for e in empenhos:
        grupos.setdefault(e["nome_credor"] or "—", []).append(e)
    ordem = sorted(grupos.items(), key=lambda kv: -sum(float(e["a_liquidar"] or 0) for e in kv[1]))
    for forn, lista in ordem:
        if pdf.get_y() > 250:
            pdf.add_page()
        # Faixa do fornecedor
        y = pdf.get_y()
        pdf.set_fill_color(*NAVY)
        pdf.rect(15, y, 180, 8, "F", round_corners=True, corner_radius=1.6)
        pdf.set_xy(18, y + 1)
        pdf.set_font("InterTit", "", 10)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(112, 6, _cortar(pdf, forn, 110))
        pdf.set_font("Inter", "B", 8.5)
        pdf.set_text_color(*CLARO)
        fl = sum(float(e["a_liquidar"] or 0) for e in lista)
        pdf.cell(62, 6, _limpo(f"{len(lista)} empenho{'s' if len(lista) != 1 else ''}  •  a liquidar {brl(fl)}"), align="R")
        pdf.set_y(y + 8 + 2.5)
        for e in lista:
            if pdf.get_y() > 258:
                pdf.add_page()
            emp, liq, pago = float(e["valor_empenhado"] or 0), float(e["valor_liquidado"] or 0), float(e["valor_pago"] or 0)
            y = pdf.get_y()
            pdf.set_xy(15, y)
            pdf.set_font("InterTit", "", 10.5)
            pdf.set_text_color(*TEXTO)
            pdf.cell(42, 5.5, _limpo(e["ne"]))
            if e.get("processo"):
                pdf.set_font("Inter", "", 8)
                pdf.set_text_color(*MUDO)
                pdf.cell(40, 5.5, _limpo(f"Processo {e['processo']}"))
            pdf.set_xy(105, y)
            pdf.set_font("Inter", "B", 9)
            pdf.set_text_color(*NAVY)
            pdf.cell(90, 5.5, _limpo(f"{pct(liq / emp * 100 if emp else 0)} liquidado"), align="R")
            # resumo dos itens (até 2 linhas)
            resumo = ", ".join(e.get("itens_resumo") or [])
            if resumo:
                resumo = resumo[:1].upper() + resumo[1:]
                pdf.set_xy(15, y + 5.6)
                pdf.set_font("Inter", "", 8.4)
                pdf.set_text_color(*MUDO)
                linhas = pdf.multi_cell(180, 4.1, _limpo(resumo), dry_run=True, output="LINES")
                if len(linhas) > 2:
                    linhas = linhas[:2]
                    linhas[1] = _cortar(pdf, linhas[1] + " …………", 178)
                for ln in linhas:
                    pdf.set_x(15)
                    pdf.cell(180, 4.1, _limpo(ln), new_x="LMARGIN", new_y="NEXT")
                yb = pdf.get_y() + 1.4
            else:
                yb = y + 7
            _barra(pdf, 15, yb, 180, 3, emp, liq, pago)
            # valores
            yv = yb + 4.6
            w = 45
            for i, (rot, val, cor) in enumerate((("Empenhado", emp, TEXTO), ("Liquidado", liq, AZUL), ("Pago", pago, VERDE),
                                                 ("A liquidar", float(e["a_liquidar"] or 0), NAVY))):
                pdf.set_xy(15 + i * w, yv)
                pdf.set_font("Inter", "B", 6.6)
                pdf.set_text_color(*MUDO)
                pdf.cell(w, 3.2, rot.upper())
                pdf.set_xy(15 + i * w, yv + 3.2)
                pdf.set_font("Inter", "B", 9.4)
                pdf.set_text_color(*cor)
                pdf.cell(w, 4.6, brl(val))
            pdf.set_y(yv + 9.6)
            pdf.set_draw_color(*LINHA)
            pdf.line(15, pdf.get_y(), 195, pdf.get_y())
            pdf.ln(2.6)
        pdf.ln(1.5)
    buf = io.BytesIO(bytes(pdf.output()))
    buf.seek(0)
    return buf


# --------------------------------------------------------------------------
# 2. RELATÓRIO SEMANAL / MENSAL
# --------------------------------------------------------------------------
def pdf_periodo(d):
    """d: {titulo, periodo_txt, resumo{...}, nfs[], pagamentos[], pedidos[], abertos[], a_pagar[], fornecedores[]}"""
    pdf = _novo_pdf(d["titulo"], d["periodo_txt"])
    r = d["resumo"]
    _caixas(pdf, [
        ("Liquidado no período", brl(r["liquidado"]), AZUL),
        ("Pago no período", brl(r["pago"]), VERDE),
        ("NFs recebidas", str(r["nfs"])),
        ("Pedidos feitos", str(r["pedidos"])),
    ])
    _caixas(pdf, [
        ("A pagar hoje", brl(r["a_pagar"]), NAVY),
        ("NFs aguardando pagamento", str(r["nfs_a_pagar"])),
        ("Pedidos em aberto", str(r["abertos"])),
        ("Pedidos atrasados", str(r["atrasados"]), VERMELHO if r["atrasados"] else TEXTO),
    ])

    _titulo_secao(pdf, "Notas fiscais recebidas (liquidação)", f"{len(d['nfs'])} NF(s)  •  {brl(r['liquidado'])}")
    _tabela(pdf, [("Data", 20, "L"), ("NF", 22, "L"), ("Fornecedor", 62, "L"), ("Empenho", 30, "L"), ("Pedido", 20, "L"), ("Valor", 26, "R")],
            [[n["data"], n["nf"], n["fornecedor"], n["ne"], n["pedido"], brl(n["valor"])] for n in d["nfs"]],
            "Nenhuma NF recebida no período.")

    _titulo_secao(pdf, "Pagamentos", f"{len(d['pagamentos'])} NF(s)  •  {brl(r['pago'])}")
    _tabela(pdf, [("Pago em", 20, "L"), ("NF", 22, "L"), ("Fornecedor", 62, "L"), ("Empenho", 30, "L"), ("Por", 20, "L"), ("Valor", 26, "R")],
            [[n["data"], n["nf"], n["fornecedor"], n["ne"], n["por"], brl(n["valor"])] for n in d["pagamentos"]],
            "Nenhuma NF marcada como paga no período.")

    _titulo_secao(pdf, "Pedidos feitos", f"{len(d['pedidos'])} pedido(s)")
    _tabela(pdf, [("Data", 20, "L"), ("Pedido", 22, "L"), ("Fornecedor", 58, "L"), ("Empenho", 30, "L"), ("Situação", 24, "L"), ("Valor", 26, "R")],
            [[p["data"], p["numero"], p["fornecedor"], p["ne"], (p["situacao"], VERMELHO if p["atrasado"] else TEXTO), brl(p["valor"])]
             for p in d["pedidos"]], "Nenhum pedido feito no período.")

    _titulo_secao(pdf, "Pendências hoje: pedidos em aberto", f"{len(d['abertos'])} pedido(s)")
    _tabela(pdf, [("Pedido", 22, "L"), ("Fornecedor", 60, "L"), ("Empenho", 30, "L"), ("Feito em", 20, "L"), ("Entrega até", 22, "L"), ("Situação", 26, "L")],
            [[p["numero"], p["fornecedor"], p["ne"], p["data"], p["vencimento"] or "sem prazo",
              (p["situacao"], VERMELHO if p["atrasado"] else TEXTO)] for p in d["abertos"]],
            "Nenhum pedido em aberto.")

    _titulo_secao(pdf, "Pendências hoje: NFs aguardando pagamento", f"{r['nfs_a_pagar']} NF(s)  •  {brl(r['a_pagar'])}")
    _tabela(pdf, [("Recebida em", 22, "L"), ("NF", 22, "L"), ("Fornecedor", 66, "L"), ("Empenho", 30, "L"), ("Valor", 40, "R")],
            [[n["data"], n["nf"], n["fornecedor"], n["ne"], brl(n["valor"])] for n in d["a_pagar"]],
            "Nenhuma NF aguardando pagamento.")

    _titulo_secao(pdf, "Por fornecedor", "movimento no período e saldo hoje")
    _tabela(pdf, [("Fornecedor", 68, "L"), ("Liquidado no período", 38, "R"), ("Pago no período", 34, "R"), ("A liquidar hoje", 40, "R")],
            [[f["nome"], brl(f["liquidado"]), brl(f["pago"]), brl(f["a_liquidar"])] for f in d["fornecedores"]],
            "Sem movimento.")
    buf = io.BytesIO(bytes(pdf.output()))
    buf.seek(0)
    return buf
