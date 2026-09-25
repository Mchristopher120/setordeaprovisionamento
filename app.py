import os
import sqlite3
import re
from datetime import datetime
from flask import Flask, render_template, request, jsonify, g

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "aprov.db")

app = Flask(__name__)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript(
        """
        -- ===================== SISTEMA DE EMPENHOS (itens/pedidos/recebimentos) =====================
        CREATE TABLE IF NOT EXISTS empenhos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ne TEXT,
            processo TEXT,
            nome_credor TEXT,
            criado_em TEXT
        );

        CREATE TABLE IF NOT EXISTS itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
            numero_item TEXT,
            descricao TEXT,
            und TEXT,
            frn TEXT,
            qtde_empenhada REAL DEFAULT 0,
            valor_unitario REAL DEFAULT 0,
            valor_total REAL DEFAULT 0,
            criado_em TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_itens_empenho ON itens(empenho_id);

        CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
            numero_pedido TEXT,
            data_pedido TEXT,
            observacoes TEXT,
            criado_em TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pedidos_empenho ON pedidos(empenho_id);

        CREATE TABLE IF NOT EXISTS pedido_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
            item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
            qtde_pedida REAL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_pi_pedido ON pedido_itens(pedido_id);
        CREATE INDEX IF NOT EXISTS idx_pi_item ON pedido_itens(item_id);

        -- RECEBIMENTOS: baixa física (saldo do item) + financeiro (NF)
        CREATE TABLE IF NOT EXISTS recebimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
            pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
            item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
            nf TEXT,
            data_recebimento TEXT,
            qtde_recebida REAL DEFAULT 0,
            observacoes TEXT,
            criado_em TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rec_item ON recebimentos(item_id);
        CREATE INDEX IF NOT EXISTS idx_rec_pedido ON recebimentos(pedido_id);
        """
    )
    con.commit()
    con.close()


def parse_money(v):
    if v is None:
        return 0.0
    s = str(v).strip()
    if s == "":
        return 0.0
    s = s.replace("R$", "").replace("US$", "").strip()
    has_comma = "," in s
    has_dot = "." in s
    if has_comma:
        # pt-BR: "1.234,56" ou "1234,56"
        s = s.replace(".", "").replace(",", ".")
    elif has_dot:
        # Se só há um ponto e o final tem 1-2 dígitos => decimal (1234.56)
        # Senão vira separador de milhar (1.234)
        if re.search(r"\.\d{1,2}$", s):
            pass  # mantém como decimal
        else:
            s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


@app.route("/")
def index():
    return render_template("index.html")


# ============================================================================
# SISTEMA DE EMPENHOS (cadastro por item -> pedidos -> recebimentos -> saldo)
# ============================================================================
# Regras de negócio (confirmadas pelo usuário):
#   * SALDO FÍSICO de cada item = qtde_empenhada - Σ qtde_recebida
#     (só diminui quando o material É RECEBIDO, com NF)
#   * SALDO FINANCEIRO (PAGO / A LIQUIDAR / %):
#     PAGO       = Σ (qtde_recebida x valor_unitario)  [vem dos RECEBIMENTOS]
#     A LIQUIDAR = valor_total_do_item - PAGO
#   * Pedido "incluído" vira "recebido" quando se registra NF + qtde recebida


def empenho_para_dict(row):
    return dict(row)


def item_sumario(item):
    d = dict(item)
    db = get_db()
    r = db.execute(
        "SELECT COALESCE(SUM(r.qtde_recebida),0) as qtde_recebida,"
        " COALESCE(SUM(r.qtde_recebida * i.valor_unitario),0) as pago"
        " FROM recebimentos r LEFT JOIN itens i ON i.id = r.item_id"
        " WHERE r.item_id = ?",
        (item["id"],),
    ).fetchone()
    d["qtde_recebida"] = r["qtde_recebida"]
    d["pago"] = r["pago"]
    d["saldo_fisico"] = max(0, (d["qtde_empenhada"] or 0) - d["qtde_recebida"])
    d["a_liquidar"] = max(0, (d["valor_total"] or 0) - d["pago"])
    d["percentual_pago"] = round((d["pago"] / (d["valor_total"] or 1) * 100), 2)
    d["percentual_fisico"] = round(
        (d["qtde_recebida"] / (d["qtde_empenhada"] or 1) * 100), 2
    )
    return d


@app.route("/empenhos")
def pag_empenhos():
    return render_template("empenhos.html")


@app.route("/api/empenhos")
def api_lista_empenhos():
    db = get_db()
    rows = db.execute(
        "SELECT e.*,"
        " (SELECT COALESCE(SUM(i.valor_total),0) FROM itens i WHERE i.empenho_id = e.id) as valor_empenhado,"
        " (SELECT COALESCE(SUM(r.qtde_recebida * i2.valor_unitario),0)"
        "   FROM recebimentos r JOIN itens i2 ON i2.id = r.item_id"
        "   WHERE i2.empenho_id = e.id) as valor_pago"
        " FROM empenhos e ORDER BY e.id DESC"
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["valor_empenhado"] = d["valor_empenhado"] or 0
        d["valor_pago"] = d["valor_pago"] or 0
        d["a_liquidar"] = d["valor_empenhado"] - d["valor_pago"]
        d["percentual_pago"] = round(
            (d["valor_pago"] / (d["valor_empenhado"] or 1) * 100), 2
        )
        out.append(d)
    return jsonify(out)


@app.route("/api/empenhos", methods=["POST"])
def api_criar_empenho():
    data = request.json or {}
    ne = (data.get("ne") or "").strip()
    processo = (data.get("processo") or "").strip()
    nome_credor = (data.get("nome_credor") or "").strip().upper()
    if not ne:
        return jsonify({"ok": False, "error": "Informe o número do empenho (NE)"}), 400
    if not nome_credor:
        return jsonify({"ok": False, "error": "Informe o credor"}), 400

    db = get_db()
    cur = db.execute(
        "INSERT INTO empenhos (ne, processo, nome_credor, criado_em) VALUES (?,?,?,?)",
        (ne, processo, nome_credor, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
    )
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/empenhos/<int:eid>")
def api_detalhe_empenho(eid):
    db = get_db()
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (eid,)).fetchone()
    if not empenho:
        return jsonify({"ok": False, "error": "Empenho não encontrado"}), 404
    itens = [item_sumario(r) for r in db.execute(
        "SELECT * FROM itens WHERE empenho_id = ? ORDER BY id", (eid,)
    ).fetchall()]
    pedidos = db.execute(
        "SELECT p.*,"
        " (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.pedido_id = p.id) as qt_itens,"
        " (SELECT COALESCE(SUM(pi.qtde_pedida),0) FROM pedido_itens pi WHERE pi.pedido_id = p.id) as qtde_total_pedida,"
        " (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r WHERE r.pedido_id = p.id) as qtde_total_recebida,"
        " (SELECT COUNT(*) FROM recebimentos r WHERE r.pedido_id = p.id) as qt_recebimentos"
        " FROM pedidos p WHERE p.empenho_id = ? ORDER BY p.id DESC",
        (eid,),
    ).fetchall()

    pedido_lista = []
    for p in pedidos:
        pd = dict(p)
        pd["status"] = "RECEBIDO" if pd["qtde_total_recebida"] >= pd["qtde_total_pedida"] and pd["qtde_total_pedida"] > 0 else "INCLUIDO"
        if pd["qt_recebimentos"] and pd["qtde_total_recebida"] < pd["qtde_total_pedida"]:
            pd["status"] = "PARCIAL"
        pedido_lista.append(pd)

    return jsonify({
        "empenho": dict(empenho),
        "itens": itens,
        "pedidos": pedido_lista,
    })


@app.route("/api/empenhos/<int:eid>", methods=["DELETE"])
def api_excluir_empenho(eid):
    db = get_db()
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (eid,)).fetchone()
    if not empenho:
        return jsonify({"ok": False, "error": "Empenho não encontrado"}), 404
    db.execute("DELETE FROM empenhos WHERE id = ?", (eid,))
    db.commit()
    return jsonify({"ok": True, "ne": empenho["ne"]})


@app.route("/api/empenhos/<int:eid>/itens", methods=["POST"])
def api_incluir_varios_itens(eid):
    """Inclui vários itens de uma vez no empenho.

    Body: { itens: [{numero_item, descricao, und, qtde_empenhada, valor_unitario}] }
    Retorna a lista dos itens criados (com ids) e o total somado.
    """
    db = get_db()
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (eid,)).fetchone()
    if not empenho:
        return jsonify({"ok": False, "error": "Empenho não encontrado"}), 404

    data = request.json or {}
    itens = data.get("itens") or []
    valido = []
    for it in itens:
        descricao = (it.get("descricao") or "").strip()
        if not descricao:
            continue
        numero_item = (it.get("numero_item") or "").strip()
        und = (it.get("und") or "").strip()
        qtde = parse_money(it.get("qtde_empenhada"))
        valor_unitario = parse_money(it.get("valor_unitario"))
        valido.append((numero_item, descricao, und, qtde, valor_unitario))

    if not valido:
        return jsonify({"ok": False, "error": "Informe ao menos um item com descrição"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    criados = []
    total_geral = 0.0
    for numero_item, descricao, und, qtde, valor_unitario in valido:
        valor_total = qtde * valor_unitario
        cur = db.execute(
            "INSERT INTO itens (empenho_id, numero_item, descricao, und, qtde_empenhada, valor_unitario, valor_total, criado_em)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (eid, numero_item, descricao, und, qtde, valor_unitario, valor_total, now),
        )
        criados.append({
            "id": cur.lastrowid, "numero_item": numero_item, "descricao": descricao,
            "und": und, "qtde_empenhada": qtde, "valor_unitario": valor_unitario,
            "valor_total": valor_total,
        })
        total_geral += valor_total

    db.commit()
    return jsonify({"ok": True, "itens": criados, "quantidade": len(criados), "valor_total": total_geral})


@app.route("/api/itens", methods=["POST"])
def api_criar_item():
    data = request.json or {}
    empenho_id = data.get("empenho_id")
    numero_item = (data.get("numero_item") or "").strip()
    descricao = (data.get("descricao") or "").strip()
    und = (data.get("und") or "").strip()
    qtde = parse_money(data.get("qtde_empenhada"))
    valor_unitario = parse_money(data.get("valor_unitario"))
    valor_total = qtde * valor_unitario
    if not empenho_id:
        return jsonify({"ok": False, "error": "Faltou o identificador do empenho"}), 400
    if not descricao:
        return jsonify({"ok": False, "error": "Informe a descrição do item"}), 400

    db = get_db()
    cur = db.execute(
        "INSERT INTO itens (empenho_id, numero_item, descricao, und, qtde_empenhada, valor_unitario, valor_total, criado_em)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (
            empenho_id, numero_item, descricao, und,
            qtde, valor_unitario, valor_total,
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        ),
    )
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid, "valor_total": valor_total})


@app.route("/api/itens/<int:iid>", methods=["PUT"])
def api_editar_item(iid):
    data = request.json or {}
    db = get_db()
    item = db.execute("SELECT * FROM itens WHERE id = ?", (iid,)).fetchone()
    if not item:
        return jsonify({"ok": False, "error": "Item não encontrado"}), 404

    descricao = (data.get("descricao") or item["descricao"] or "").strip()
    numero_item = (data.get("numero_item") if data.get("numero_item") is not None else item["numero_item"] or "").strip()
    und = (data.get("und") if data.get("und") is not None else item["und"] or "").strip()
    qtde = parse_money(data.get("qtde_empenhada", item["qtde_empenhada"]))
    valor_unitario = parse_money(data.get("valor_unitario", item["valor_unitario"]))
    valor_total = qtde * valor_unitario

    db.execute(
        "UPDATE itens SET numero_item=?, descricao=?, und=?, qtde_empenhada=?, valor_unitario=?, valor_total=? WHERE id=?",
        (numero_item, descricao, und, qtde, valor_unitario, valor_total, iid),
    )
    db.commit()
    return jsonify({"ok": True, "valor_total": valor_total})


@app.route("/api/itens/<int:iid>", methods=["DELETE"])
def api_excluir_item(iid):
    db = get_db()
    db.execute("DELETE FROM itens WHERE id = ?", (iid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/pedidos", methods=["POST"])
def api_criar_pedido():
    data = request.json or {}
    empenho_id = data.get("empenho_id")
    numero_pedido = (data.get("numero_pedido") or "").strip()
    data_pedido = (data.get("data_pedido") or "").strip()
    observacoes = (data.get("observacoes") or "").strip()
    itens = data.get("itens") or []  # [{item_id, qtde_pedida}]

    if not empenho_id:
        return jsonify({"ok": False, "error": "Faltou o identificador do empenho"}), 400
    if not numero_pedido:
        return jsonify({"ok": False, "error": "Informe o número do pedido"}), 400
    if not itens or not any(float(i.get("qtde_pedida") or 0) > 0 for i in itens):
        return jsonify({"ok": False, "error": "Informe pelo menos um item com quantidade pedida"}), 400

    db = get_db()
    cur = db.execute(
        "INSERT INTO pedidos (empenho_id, numero_pedido, data_pedido, observacoes, criado_em)"
        " VALUES (?,?,?,?,?)",
        (empenho_id, numero_pedido, data_pedido, observacoes,
         datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
    )
    pedido_id = cur.lastrowid
    for it in itens:
        qtde = float(it.get("qtde_pedida") or 0)
        if qtde > 0:
            db.execute(
                "INSERT INTO pedido_itens (pedido_id, item_id, qtde_pedida) VALUES (?,?,?)",
                (pedido_id, it.get("item_id"), qtde),
            )
    db.commit()
    return jsonify({"ok": True, "id": pedido_id})


@app.route("/api/pedidos/<int:pid>", methods=["GET"])
def api_detalhe_pedido(pid):
    """Retorna os dados do pedido: itens solicitados e recebimentos (NFs)."""
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return jsonify({"ok": False, "error": "Pedido não encontrado"}), 404

    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (pedido["empenho_id"],)).fetchone()

    itens_pedido = db.execute(
        "SELECT pi.item_id, i.numero_item, i.descricao, i.und, i.valor_unitario, i.valor_total,"
        " pi.qtde_pedida,"
        " (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r WHERE r.item_id = pi.item_id AND r.pedido_id = ?) as qtde_recebida"
        " FROM pedido_itens pi JOIN itens i ON i.id = pi.item_id"
        " WHERE pi.pedido_id = ? ORDER BY i.id",
        (pid, pid),
    ).fetchall()

    recs = db.execute(
        "SELECT r.id, r.nf, r.data_recebimento, r.observacoes, r.item_id,"
        " i.numero_item, i.descricao, i.und, r.qtde_recebida"
        " FROM recebimentos r LEFT JOIN itens i ON i.id = r.item_id"
        " WHERE r.pedido_id = ? ORDER BY r.id",
        (pid,),
    ).fetchall()

    # Agrupa recebimentos por NF
    recebimentos = []
    for r in recs:
        existente = next((x for x in recebimentos if x["nf"] == r["nf"]), None)
        item = {
            "item_id": r["item_id"], "numero_item": r["numero_item"],
            "descricao": r["descricao"], "und": r["und"], "qtde_recebida": r["qtde_recebida"],
        }
        if existente is None:
            recebimentos.append({
                "id": r["id"], "nf": r["nf"] or "—", "data_recebimento": r["data_recebimento"],
                "observacoes": r["observacoes"], "itens": [item],
            })
        else:
            existente["itens"].append(item)

    qtde_total_pedida = sum(float(i["qtde_pedida"]) for i in itens_pedido)
    qtde_total_recebida = sum(float(i["qtde_recebida"]) for i in itens_pedido)

    status = "RECEBIDO" if qtde_total_recebida >= qtde_total_pedida and qtde_total_pedida > 0 else "INCLUIDO"
    if recebimentos and qtde_total_recebida < qtde_total_pedida:
        status = "PARCIAL"

    return jsonify({
        "ok": True,
        "pedido": dict(pedido),
        "empenho": dict(empenho) if empenho else None,
        "itens": [dict(i) for i in itens_pedido],
        "recebimentos": recebimentos,
        "qtde_total_pedida": qtde_total_pedida,
        "qtde_total_recebida": qtde_total_recebida,
        "status": status,
    })


@app.route("/api/pedidos/<int:pid>/pdf", methods=["GET"])
def api_pedido_pdf(pid):
    """Gera um PDF do pedido para envio ao fornecedor."""
    from fpdf import FPDF
    import os as _os

    def norm(txt):
        """Limpa apenas caracteres de controle; mantém acentos (fonte TTF)."""
        if txt is None:
            return ""
        return "".join(c if ord(c) >= 32 else " " for c in str(txt))

    def fmt_br(v):
        return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return jsonify({"ok": False, "error": "Pedido não encontrado"}), 404

    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (pedido["empenho_id"],)).fetchone()

    itens = db.execute(
        "SELECT pi.qtde_pedida, i.numero_item, i.descricao, i.und, i.valor_unitario, i.valor_total"
        " FROM pedido_itens pi JOIN itens i ON i.id = pi.item_id"
        " WHERE pi.pedido_id = ? ORDER BY i.id",
        (pid,),
    ).fetchall()

    valor_total = sum(float(i["valor_total"]) for i in itens)

    FONT = r"C:\Windows\Fonts\arial.ttf"
    if not _os.path.exists(FONT):
        FONT = r"C:\Windows\Fonts\Arial.ttf"
    FONT_BLACK = r"C:\Windows\Fonts\ariblk.ttf"

    class PedidoPDF(FPDF):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.add_font("ArialU", "", FONT)
            self.add_font("ArialU", "B", FONT)
            self.add_font("ArialBlk", "", FONT_BLACK)

        def footer(self):
            self.set_y(-14)
            self.set_draw_color(26, 51, 115)
            self.set_line_width(0.4)
            self.line(15, self.get_y(), 195, self.get_y())
            self.set_y(-11)
            self.set_font("ArialU", size=7.5)
            self.set_text_color(110, 110, 110)
            self.cell(0, 8, norm(f"3º CENTRO DE GEOINFORMAÇÃO  •  Doc. gerado automaticamente em {datetime.now().strftime('%d/%m/%Y %H:%M')}  •  Página {self.page_no()}/{{nb}}"), align="C")

    pdf = PedidoPDF("P", "mm", "A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_left_margin(15)
    pdf.set_right_margin(15)
    pdf.add_page()

    CONTENT_W = 210 - 30  # 15mm de cada lado

    # ---------- Cabeçalho institucional ----------
    NAVY = (26, 51, 115)
    GOLD = (201, 174, 96)
    LIGHT = (180, 196, 224)
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 30, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_y(4.5)
    pdf.set_font("ArialU", "B", 9)
    pdf.cell(0, 5.5, "MINISTÉRIO DA DEFESA  •  EXÉRCITO BRASILEIRO", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("ArialBlk", "", 17)
    pdf.cell(0, 9, "3º CENTRO DE GEOINFORMAÇÃO", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("ArialU", "B", 9.5)
    pdf.set_text_color(*LIGHT)
    pdf.cell(0, 5.5, "DIRETORIA DE SERVIÇO GEOGRÁFICO", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_fill_color(*GOLD)
    pdf.rect(0, 30, 210, 2.5, "F")

    # ---------- Título do documento ----------
    pdf.ln(8)
    pdf.set_font("ArialBlk", "", 15)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 8, "SOLICITAÇÃO DE MATERIAL", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("ArialU", "B", 10)
    pdf.set_text_color(70, 70, 80)
    pdf.cell(0, 6, "PEDIDO DE ENTREGA", align="C", new_x="LMARGIN", new_y="NEXT")

    # ---------- Bloco central (dados do pedido) ----------
    pdf.ln(3)
    pdf.set_text_color(*NAVY)
    pdf.set_font("ArialBlk", "", 26)
    pdf.cell(0, 11, f"PEDIDO {norm(pedido['numero_pedido'])}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("ArialBlk", "", 16)
    pdf.cell(0, 9, norm(empenho['ne'] if empenho else "-"), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("ArialU", "B", 12)
    pdf.set_text_color(60, 60, 70)
    pdf.cell(0, 7, f"DATA: {norm(pedido['data_pedido'] or '-')}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(30, 30, 30)

    pdf.ln(6)

    # ---------- Tabela de itens ----------
    pdf.set_font("ArialBlk", "", 13)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 8, "ITENS SOLICITADOS", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_draw_color(*GOLD)
    pdf.set_line_width(1)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(4)

    col_w = [14, 72, 14, 26, 27, 27]  # total 180mm
    headers = ["ITEM", "DESCRIÇÃO", "UND.", "QTDE", "VLR UNITÁRIO", "VLR TOTAL"]

    def cabeçalho_tabela(altura=8):
        pdf.set_fill_color(*NAVY)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("ArialU", "B", 8)
        for h, w in zip(headers, col_w):
            pdf.cell(w, altura, norm(h), border=1, fill=True, align="C")
        pdf.ln()

    cabeçalho_tabela()

    pdf.set_font("ArialU", "", 9)
    pdf.set_text_color(30, 30, 30)
    fill = False
    for i in itens:
        if pdf.get_y() > 255:
            pdf.add_page()
            cabeçalho_tabela(8)
            pdf.set_font("ArialU", "", 9)
            pdf.set_text_color(30, 30, 30)
        pdf.set_fill_color(246, 248, 252) if fill else pdf.set_fill_color(255, 255, 255)
        desc = norm(i["descricao"] or "")
        pdf.cell(col_w[0], 7, norm(i["numero_item"] or ""), border=1, fill=True, align="C")
        pdf.cell(col_w[1], 7, desc, border=1, fill=True, align="C")
        pdf.cell(col_w[2], 7, norm(i["und"] or ""), border=1, fill=True, align="C")
        pdf.cell(col_w[3], 7, f'{i["qtde_pedida"]:g}', border=1, fill=True, align="R")
        pdf.cell(col_w[4], 7, "R$" + fmt_br(i["valor_unitario"]), border=1, fill=True, align="R")
        pdf.cell(col_w[5], 7, "R$" + fmt_br(i["valor_total"]), border=1, fill=True, align="R")
        pdf.ln()
        fill = not fill

    # ---------- Valor total ----------
    if pdf.get_y() > 258:
        pdf.add_page()
    pdf.ln(4)
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("ArialBlk", "", 12)
    pdf.cell(CONTENT_W, 10, f"  VALOR TOTAL:  R$ {fmt_br(valor_total)}", border=0, fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(30, 30, 30)

    import io as _io
    buf = _io.BytesIO()
    pdf.output(buf)
    buf.seek(0)

    nome_arquivo = f"PEDIDO_{pedido['numero_pedido']}.pdf"
    return (
        buf.getvalue(),
        200,
        {
            "Content-Type": "application/pdf",
            "Content-Disposition": f"attachment; filename={nome_arquivo}",
        },
    )


@app.route("/api/pedidos/<int:pid>", methods=["DELETE"])
def api_excluir_pedido(pid):
    db = get_db()
    db.execute("DELETE FROM pedidos WHERE id = ?", (pid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/pedidos/<int:pid>/receber", methods=["POST"])
def api_receber_pedido(pid):
    """Registra o RECEBIMENTO do pedido (baixa de saldo físico + financeiro).

    Body: { nf, data_recebimento, itens: [{item_id, qtde_recebida}] }
    Cada item registrado vira um lançamento na tabela recebimentos.
    """
    data = request.json or {}
    nf = (data.get("nf") or "").strip()
    data_rec = (data.get("data_recebimento") or "").strip() or datetime.now().strftime("%Y-%m-%d")
    itens = data.get("itens") or []

    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return jsonify({"ok": False, "error": "Pedido não encontrado"}), 404
    if not itens or not any(float(i.get("qtde_recebida") or 0) > 0 for i in itens):
        return jsonify({"ok": False, "error": "Informe ao menos uma quantidade recebida"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    total_recebido = 0
    for it in itens:
        item_id = it.get("item_id")
        qtde = float(it.get("qtde_recebida") or 0)
        if qtde <= 0 or not item_id:
            continue
        db.execute(
            "INSERT INTO recebimentos (empenho_id, pedido_id, item_id, nf, data_recebimento, qtde_recebida, observacoes, criado_em)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (pedido["empenho_id"], pid, item_id, nf, data_rec, qtde, it.get("observacoes") or "", now),
        )
        total_recebido += qtde

    db.commit()
    return jsonify({"ok": True, "nf": nf, "qtde_total_recebida": total_recebido})


@app.route("/api/recebimentos/<int:rid>", methods=["DELETE"])
def api_excluir_recebimento(rid):
    db = get_db()
    db.execute("DELETE FROM recebimentos WHERE id = ?", (rid,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/stats_empenhos")
def api_stats_empenhos():
    db = get_db()
    tot = db.execute("SELECT COUNT(*) as qtd FROM empenhos").fetchone()["qtd"]
    itens = db.execute("SELECT COUNT(*) as qtd FROM itens").fetchone()["qtd"]
    pedidos = db.execute("SELECT COUNT(*) as qtd FROM pedidos").fetchone()["qtd"]

    empenhado = db.execute("SELECT COALESCE(SUM(valor_total),0) as v FROM itens").fetchone()["v"]
    pago = db.execute(
        "SELECT COALESCE(SUM(r.qtde_recebida * i.valor_unitario),0) as v"
        " FROM recebimentos r JOIN itens i ON i.id = r.item_id"
    ).fetchone()["v"]
    a_liquidar = empenhado - pago

    # Físico (quantidade)
    qtde_empenhada_total = db.execute("SELECT COALESCE(SUM(qtde_empenhada),0) as v FROM itens").fetchone()["v"]
    qtde_recebida_total = db.execute("SELECT COALESCE(SUM(qtde_recebida),0) as v FROM recebimentos").fetchone()["v"]

    # Itens com saldo físico zerado (todas as unidades recebidas)
    itens_zerados = db.execute(
        "SELECT COUNT(*) as qtd FROM itens i WHERE i.qtde_empenhada > 0"
        " AND (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r WHERE r.item_id = i.id)"
        "     >= i.qtde_empenhada"
    ).fetchone()["qtd"]

    # Empenhos concluídos (todos os itens com saldo físico zerado / sem itens pendentes)
    empenhos_concluidos = db.execute(
        "SELECT COUNT(*) as qtd FROM empenhos e WHERE"
        " NOT EXISTS (SELECT 1 FROM itens i WHERE i.empenho_id = e.id"
        "   AND i.qtde_empenhada > 0"
        "   AND (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r WHERE r.item_id = i.id)"
        "       < i.qtde_empenhada)"
    ).fetchone()["qtd"]

    aberto = db.execute(
        "SELECT COUNT(DISTINCT p.id) as qtd FROM pedidos p"
        " LEFT JOIN recebimentos r ON r.pedido_id = p.id"
        " WHERE (SELECT COALESCE(SUM(r2.qtde_recebida),0) FROM recebimentos r2 WHERE r2.pedido_id = p.id)"
        "      < (SELECT COALESCE(SUM(pi.qtde_pedida),0) FROM pedido_itens pi WHERE pi.pedido_id = p.id)"
    ).fetchone()["qtd"]

    status_pedidos = {"INCLUIDO": 0, "PARCIAL": 0, "RECEBIDO": 0}
    rows = db.execute(
        "SELECT p.id,"
        " (SELECT COALESCE(SUM(pi.qtde_pedida),0) FROM pedido_itens pi WHERE pi.pedido_id = p.id) as pedida,"
        " (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r WHERE r.pedido_id = p.id) as recebida"
        " FROM pedidos p"
    ).fetchall()
    for r in rows:
        if r["pedida"] <= 0:
            continue
        if r["recebida"] >= r["pedida"]:
            status_pedidos["RECEBIDO"] += 1
        elif r["recebida"] > 0:
            status_pedidos["PARCIAL"] += 1
        else:
            status_pedidos["INCLUIDO"] += 1

    return jsonify({
        "empenhos": tot, "itens": itens, "pedidos": pedidos,
        "pedidos_em_aberto": aberto,
        "valor_empenhado": empenhado,
        "valor_pago": pago,
        "valor_a_liquidar": max(0, a_liquidar),
        "percentual_pago": round((pago / empenhado * 100), 2) if empenhado else 0,
        "qtde_empenhada_total": qtde_empenhada_total,
        "qtde_recebida_total": qtde_recebida_total,
        "percentual_fisico": round((qtde_recebida_total / qtde_empenhada_total * 100), 2) if qtde_empenhada_total else 0,
        "itens_zerados": itens_zerados,
        "percentual_itens_zerados": round((itens_zerados / itens * 100), 2) if itens else 0,
        "empenhos_concluidos": empenhos_concluidos,
        "empenhos_andamento": max(0, tot - empenhos_concluidos),
        "percentual_concluidos": round((empenhos_concluidos / tot * 100), 2) if tot else 0,
        "status_pedidos": status_pedidos,
    })


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000, use_reloader=False)
