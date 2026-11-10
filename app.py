import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sys
import time
from datetime import date, datetime, timedelta
from functools import wraps

from resumo_itens import resumo_de_itens

from flask import (Flask, g, jsonify, redirect, render_template, request,
                   send_file, session, url_for)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "aprov.db")

DATABASE_URL = (
    os.environ.get("DATABASE_URL", "")
    or os.environ.get("POSTGRES_URL", "")
    or os.environ.get("DATABASE_POSTGRES_URL", "")
    or os.environ.get("NEON_URL", "")
).strip()
USE_POSTGRES = DATABASE_URL.startswith("postgres") or DATABASE_URL.startswith("postgresql")

# Senha única do setor (variável de ambiente APP_PASSWORD no Vercel / no PC)
APP_PASSWORD = (os.environ.get("APP_PASSWORD") or os.environ.get("SENHA_SETOR") or "").strip()

app = Flask(__name__)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=USE_POSTGRES,  # produção (Vercel) é sempre HTTPS
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)
# A chave da sessão precisa ser a MESMA em todas as instâncias do Vercel.
# Use SECRET_KEY; na falta dela, deriva-se uma chave estável da senha.
app.secret_key = (
    os.environ.get("SECRET_KEY")
    or (hashlib.sha256(("aprov|" + APP_PASSWORD + "|" + DATABASE_URL).encode()).hexdigest() if APP_PASSWORD else secrets.token_hex(32))
)

EPS = 1e-9  # tolerância para comparar quantidades em ponto flutuante

# Dados que saem no PDF do pedido. Para mudar quem assina, endereço etc., edite aqui.
UNIDADE_PDF = {
    "nome": "3º Centro de Geoinformação",
    "setor": "Setor de Aprovisionamento",
    "endereco": "Av. Dr. Joaquim Nabuco, 1687 - Ouro Preto, Olinda - PE, 53370-285",
    "horario": "das 09h30 às 16h00",
    "email": "aprov3dl@gmail.com",
}

def valor_por_extenso(valor):
    """1234.5 -> 'mil, duzentos e trinta e quatro reais e cinquenta centavos'."""
    UN = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
          "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
    DZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
    CT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
          "oitocentos", "novecentos"]

    def ate_999(n):
        if n == 100:
            return "cem"
        c, r = divmod(n, 100)
        partes = [CT[c]] if c else []
        if r < 20:
            if r:
                partes.append(UN[r])
        else:
            d, u = divmod(r, 10)
            partes.append(DZ[d] + (" e " + UN[u] if u else ""))
        return " e ".join(partes)

    def inteiro(n):
        if n == 0:
            return "zero"
        grupos = []
        for nome_s, nome_p, base in (("bilhão", "bilhões", 10**9), ("milhão", "milhões", 10**6), ("mil", "mil", 1000), ("", "", 1)):
            q, n = divmod(n, base)
            if q:
                if base == 1000 and q == 1:
                    grupos.append(("mil", q))
                else:
                    nome = nome_s if q == 1 else nome_p
                    grupos.append(((ate_999(q) + (" " + nome if nome else "")), q))
        texto = grupos[0][0]
        for txt, q in grupos[1:]:
            # "e" antes do último grupo quando ele é < 100 ou centena redonda ("mil e cem")
            ultimo = (txt, q) == grupos[-1]
            texto += (" e " if ultimo and (q < 100 or q % 100 == 0) else " ") + txt
        return texto

    centavos_total = int(round(float(valor or 0) * 100))
    reais, centavos = divmod(centavos_total, 100)
    partes = []
    if reais:
        t = inteiro(reais)
        de = " de" if reais % 1_000_000 == 0 else ""  # "um milhão de reais"
        partes.append(f"{t}{de} {'real' if reais == 1 else 'reais'}")
    if centavos:
        partes.append(f"{ate_999(centavos)} {'centavo' if centavos == 1 else 'centavos'}")
    return " e ".join(partes) if partes else "zero real"


# ============================================================================
# Camada de banco de dados:
#   * LOCAL   -> SQLite (aprov.db)  [sem DATABASE_URL]
#   * VERCEL  -> PostgreSQL         [com DATABASE_URL, ex.: vercel-postgres/neon]
# Mantém a mesma interface usada nas rotas (execute/commit/close, lastrowid,
# linhas acessíveis por nome de coluna).
# ============================================================================
if USE_POSTGRES:
    import psycopg
    from psycopg.rows import dict_row

    def _pg_connect():
        url = DATABASE_URL
        if "sslmode" not in url:
            url += ("&" if "?" in url else "?") + "sslmode=require"
        if "connect_timeout" not in url:
            url += ("&" if "?" in url else "?") + "connect_timeout=5"
        # Neon grátis "dorme" após ~5 min ocioso; o primeiro acesso acorda o
        # banco (cold start). Tenta de novo até 4x para absorver o wake-up.
        for tentativa in range(4):
            try:
                return psycopg.connect(url, row_factory=dict_row)
            except Exception:
                if tentativa == 3:
                    raise
                time.sleep(1 + tentativa)
        return None

    class PgCursor:
        def __init__(self, cur, lastrowid=None):
            self._cur = cur
            self.lastrowid = lastrowid
        def fetchone(self):
            return self._cur.fetchone()
        def fetchall(self):
            return self._cur.fetchall()

    class PgDb:
        def __init__(self, conn):
            self.conn = conn
        def execute(self, sql, params=()):
            psql = sql.replace("?", "%s")
            cur = self.conn.cursor()
            lastrowid = None
            if psql.lstrip().upper().startswith("INSERT"):
                psql += " RETURNING id"
                cur.execute(psql, tuple(params))
                row = cur.fetchone()
                lastrowid = row["id"] if row else None
            else:
                cur.execute(psql, tuple(params))
            return PgCursor(cur, lastrowid)
        def commit(self):
            self.conn.commit()
        def rollback(self):
            self.conn.rollback()
        def close(self):
            self.conn.close()

    def get_db():
        if "db" not in g:
            g.db = PgDb(_pg_connect())
        return g.db

    def _conexao_init():
        return _pg_connect()

    PK = "SERIAL PRIMARY KEY"
    REAL = "DOUBLE PRECISION"
else:
    import sqlite3

    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(DB_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    def _conexao_init():
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        return con

    PK = "INTEGER PRIMARY KEY AUTOINCREMENT"
    REAL = "REAL"


# Schema único (SQLite e PostgreSQL). Tabelas novas entram aqui e colunas
# novas em COLUNAS_NOVAS — a migração roda sozinha ao iniciar.
SCHEMA = [
    f"""CREATE TABLE IF NOT EXISTS empenhos (
        id {PK}, ne TEXT, processo TEXT, nome_credor TEXT, criado_em TEXT)""",
    f"""CREATE TABLE IF NOT EXISTS itens (
        id {PK},
        empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
        numero_item TEXT, descricao TEXT, und TEXT, frn TEXT,
        qtde_empenhada {REAL} DEFAULT 0, valor_unitario {REAL} DEFAULT 0,
        valor_total {REAL} DEFAULT 0, criado_em TEXT)""",
    "CREATE INDEX IF NOT EXISTS idx_itens_empenho ON itens(empenho_id)",
    f"""CREATE TABLE IF NOT EXISTS pedidos (
        id {PK},
        empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
        numero_pedido TEXT, data_pedido TEXT, observacoes TEXT, criado_em TEXT)""",
    "CREATE INDEX IF NOT EXISTS idx_pedidos_empenho ON pedidos(empenho_id)",
    f"""CREATE TABLE IF NOT EXISTS pedido_itens (
        id {PK},
        pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
        qtde_pedida {REAL} DEFAULT 0)""",
    "CREATE INDEX IF NOT EXISTS idx_pi_pedido ON pedido_itens(pedido_id)",
    "CREATE INDEX IF NOT EXISTS idx_pi_item ON pedido_itens(item_id)",
    # RECEBIMENTOS (NF): baixa do saldo físico e LIQUIDAÇÃO do valor
    f"""CREATE TABLE IF NOT EXISTS recebimentos (
        id {PK},
        empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
        pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
        nf TEXT, data_recebimento TEXT, qtde_recebida {REAL} DEFAULT 0,
        observacoes TEXT, criado_em TEXT)""",
    "CREATE INDEX IF NOT EXISTS idx_rec_item ON recebimentos(item_id)",
    "CREATE INDEX IF NOT EXISTS idx_rec_pedido ON recebimentos(pedido_id)",
    # PAGAMENTOS (Ordem Bancária) — etapa seguinte à liquidação
    f"""CREATE TABLE IF NOT EXISTS pagamentos (
        id {PK},
        empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
        ob TEXT, data_pagamento TEXT, valor {REAL} DEFAULT 0,
        nf TEXT, observacoes TEXT, criado_em TEXT)""",
    "CREATE INDEX IF NOT EXISTS idx_pag_empenho ON pagamentos(empenho_id)",
    # REFORÇO / ANULAÇÃO de quantidade do item (histórico do valor empenhado)
    f"""CREATE TABLE IF NOT EXISTS movimentos_item (
        id {PK},
        item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
        empenho_id INTEGER NOT NULL REFERENCES empenhos(id) ON DELETE CASCADE,
        tipo TEXT, qtde {REAL} DEFAULT 0, data TEXT, documento TEXT,
        observacoes TEXT, criado_em TEXT)""",
    "CREATE INDEX IF NOT EXISTS idx_mov_item ON movimentos_item(item_id)",
    # HISTÓRICO (auditoria) — sem FK de propósito: sobrevive às exclusões
    f"""CREATE TABLE IF NOT EXISTS auditoria (
        id {PK}, quando TEXT, usuario TEXT, acao TEXT, entidade TEXT,
        entidade_id INTEGER, empenho_id INTEGER, descricao TEXT)""",
    "CREATE INDEX IF NOT EXISTS idx_aud_empenho ON auditoria(empenho_id)",
    # LIXEIRA — guarda uma cópia completa do que foi excluído
    f"""CREATE TABLE IF NOT EXISTS lixeira (
        id {PK}, quando TEXT, usuario TEXT, tipo TEXT, descricao TEXT,
        empenho_id INTEGER, dados TEXT, restaurado INTEGER DEFAULT 0)""",
    # FORNECEDORES: contato para enviar pedidos. O empenho guarda o nome
    # (nome_credor); o vínculo é pelo nome, sem FK, como já era.
    f"""CREATE TABLE IF NOT EXISTS fornecedores (
        id {PK}, nome TEXT, cnpj TEXT, email TEXT, telefone TEXT, contato TEXT,
        observacoes TEXT, criado_em TEXT)""",
    f"""CREATE TABLE IF NOT EXISTS login_falhas (
        id {PK}, ip TEXT, quando TEXT)""",
]

COLUNAS_NOVAS = [
    ("pedidos", "prazo_dias", "INTEGER"),
    ("pedidos", "encerrado", "INTEGER DEFAULT 0"),
    ("pedidos", "encerrado_em", "TEXT"),
    # Pagamento marcado direto na NF (substitui o lançamento separado de OB)
    ("recebimentos", "pago_em", "TEXT"),
    ("recebimentos", "pago_por", "TEXT"),
    # Resumo dos itens escrito à mão (vazio = gerado das descrições)
    ("empenhos", "resumo", "TEXT"),
    # Quando o e-mail do pedido foi preparado pelo botão "Enviar pedido"
    ("pedidos", "enviado_em", "TEXT"),
    ("pedidos", "enviado_por", "TEXT"),
]


def init_db():
    con = _conexao_init()
    try:
        for s in SCHEMA:
            con.execute(s)
        for tabela, coluna, tipo in COLUNAS_NOVAS:
            if USE_POSTGRES:
                con.execute(f"ALTER TABLE {tabela} ADD COLUMN IF NOT EXISTS {coluna} {tipo}")
            else:
                existentes = [r[1] for r in con.execute(f"PRAGMA table_info({tabela})").fetchall()]
                if coluna not in existentes:
                    con.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}")
        con.commit()
    finally:
        con.close()


@app.errorhandler(500)
def erro_500(e):
    """Separa 'banco indisponível' (Neon dormindo) de erros de programa."""
    original = getattr(e, "original_exception", None) or e
    print("ERRO 500:", repr(original), file=sys.stderr)
    nome = type(original).__name__
    banco_off = "Operational" in nome or "Connection" in nome or "Timeout" in nome
    if request.path.startswith("/api/"):
        if banco_off:
            return jsonify({"erro": "banco_indisponivel",
                            "mensagem": "O banco de dados estava dormindo e está acordando. Tente de novo em alguns segundos."}), 503
        return jsonify({"erro": "erro_interno",
                        "mensagem": "Ocorreu um erro inesperado no servidor. Se persistir, avise o responsável pelo sistema."}), 500
    return render_template("erro.html", banco_off=banco_off), 503 if banco_off else 500


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def agora():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def parse_money(v):
    """Aceita '1.234,56', '1234,56', '1234.56', '22.5', 'R$ 10' e números."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s == "":
        return 0.0
    s = s.replace("R$", "").replace("US$", "").replace(" ", "").strip()
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif "." in s:
        # Um ponto seguido de 1-2 dígitos no final => decimal (22.5 / 1234.56).
        # Senão é separador de milhar (1.234 / 1.234.567).
        if not (s.count(".") == 1 and re.search(r"\.\d{1,2}$", s)):
            s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def nome_item(item):
    """'Item 3 (LARANJA)' ou só 'LARANJA' quando o item não tem número."""
    num = (item["numero_item"] or "").strip()
    return f"Item {num} ({item['descricao']})" if num else str(item["descricao"])


def fmt_qtd(v):
    return f"{float(v):g}".replace(".", ",")


def fmt_brl(v):
    return "R$ " + f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def parse_data(s):
    try:
        return datetime.strptime((s or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def data_br(s):
    d = parse_data(s)
    return d.strftime("%d/%m/%Y") if d else (s or "")


def erro(msg, status=400):
    return jsonify({"ok": False, "error": msg}), status


# ============================================================================
# LOGIN (senha única do setor + nome de quem está usando, para o histórico)
# ============================================================================
def auth_ativa():
    return bool(APP_PASSWORD)


def usuario_atual():
    return session.get("nome") or ("local" if not auth_ativa() else "?")


ROTAS_LIVRES = {"login", "logout", "static", "favicon"}


@app.before_request
def exigir_login():
    if request.endpoint in ROTAS_LIVRES:
        return None
    if not auth_ativa():
        # Sem senha configurada: liberado só no modo local (SQLite).
        # Em produção (PostgreSQL / Vercel) o sistema fica bloqueado.
        if USE_POSTGRES:
            if request.path.startswith("/api/"):
                return jsonify({"erro": "sem_senha", "mensagem": "Sistema sem senha configurada (APP_PASSWORD)."}), 503
            return render_template("login.html", sem_senha=True), 503
        return None
    if session.get("ok"):
        return None
    if request.path.startswith("/api/"):
        return jsonify({"erro": "nao_autenticado", "mensagem": "Sua sessão expirou. Entre novamente."}), 401
    return redirect(url_for("login", next=request.full_path if request.query_string else request.path))


@app.context_processor
def contexto_templates():
    return {"usuario": session.get("nome"), "auth_ativa": auth_ativa(), "iniciais": iniciais(session.get("nome"))}


def iniciais(nome):
    """'Sgt Silva' -> 'SS'; '1º Tenente Christopher' -> 'TC' (ignora números como 1º, 3º)."""
    partes = [p for p in re.split(r"\s+", (nome or "").strip()) if p and p[0].isalpha()]
    if not partes:
        return "•"
    return (partes[0][0] + (partes[-1][0] if len(partes) > 1 else "")).upper()


def _ip():
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "?").split(",")[0].strip()


@app.route("/login", methods=["GET", "POST"])
def login():
    if not auth_ativa():
        if USE_POSTGRES:
            return render_template("login.html", sem_senha=True), 503
        return redirect("/")
    erro_msg = None
    nome = ""
    if request.method == "POST":
        db = get_db()
        nome = (request.form.get("nome") or "").strip()[:60]
        senha = request.form.get("senha") or ""
        limite = (datetime.now() - timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")
        falhas = db.execute(
            "SELECT COUNT(*) as n FROM login_falhas WHERE ip = ? AND quando > ?", (_ip(), limite)
        ).fetchone()["n"]
        if falhas >= 5:
            erro_msg = "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo."
        elif not nome:
            erro_msg = "Informe seu nome (ele aparece no histórico de alterações)."
        elif not hmac.compare_digest(senha.encode(), APP_PASSWORD.encode()):
            db.execute("INSERT INTO login_falhas (ip, quando) VALUES (?, ?)", (_ip(), agora()))
            db.commit()
            time.sleep(0.5)
            erro_msg = "Senha incorreta."
        else:
            session.clear()
            session.permanent = True
            session["ok"] = True
            session["nome"] = nome
            db.execute("DELETE FROM login_falhas WHERE ip = ?", (_ip(),))
            registrar(db, "LOGIN", "sessao", None, None, f"{nome} entrou no sistema")
            db.commit()
            destino = request.args.get("next") or "/"
            if not destino.startswith("/") or destino.startswith("//"):
                destino = "/"
            return redirect(destino)
    return render_template("login.html", erro=erro_msg, nome=nome)


@app.route("/favicon.ico")
def favicon():
    """Ícone da aba (folha de acanto da Intendência) — o navegador pede na raiz."""
    return send_file(os.path.join(BASE_DIR, "static", "img", "favicon.ico"), mimetype="image/vnd.microsoft.icon", max_age=86400)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login") if auth_ativa() else "/")


# ============================================================================
# HISTÓRICO (auditoria)
# ============================================================================
def registrar(db, acao, entidade, entidade_id, empenho_id, descricao):
    db.execute(
        "INSERT INTO auditoria (quando, usuario, acao, entidade, entidade_id, empenho_id, descricao)"
        " VALUES (?,?,?,?,?,?,?)",
        (agora(), usuario_atual(), acao, entidade, entidade_id, empenho_id, descricao),
    )


# ============================================================================
# LIXEIRA: antes de excluir, guarda uma cópia de tudo que vai sumir
# (inclusive o que sai em cascata) para poder restaurar depois.
# ============================================================================
# Ordem de restauração e chaves estrangeiras de cada tabela
TABELAS_LIXEIRA = [
    ("empenhos", {}),
    ("itens", {"empenho_id": "empenhos"}),
    ("movimentos_item", {"item_id": "itens", "empenho_id": "empenhos"}),
    ("pedidos", {"empenho_id": "empenhos"}),
    ("pedido_itens", {"pedido_id": "pedidos", "item_id": "itens"}),
    ("recebimentos", {"empenho_id": "empenhos", "pedido_id": "pedidos", "item_id": "itens"}),
    ("pagamentos", {"empenho_id": "empenhos"}),
    ("fornecedores", {}),
]


def _linhas(db, sql, params):
    return [dict(r) for r in db.execute(sql, params).fetchall()]


def _in(ids):
    return ",".join("?" for _ in ids)


def snapshot(db, empenho_id=None, item_id=None, pedido_id=None, recebimento_ids=None, pagamento_id=None,
             fornecedor_id=None):
    s = {t: [] for t, _ in TABELAS_LIXEIRA}
    if fornecedor_id is not None:
        s["fornecedores"] = _linhas(db, "SELECT * FROM fornecedores WHERE id = ?", (fornecedor_id,))
    elif empenho_id is not None:
        s["empenhos"] = _linhas(db, "SELECT * FROM empenhos WHERE id = ?", (empenho_id,))
        for t in ("itens", "movimentos_item", "pedidos", "recebimentos", "pagamentos"):
            s[t] = _linhas(db, f"SELECT * FROM {t} WHERE empenho_id = ?", (empenho_id,))
        s["pedido_itens"] = _linhas(
            db, "SELECT pi.* FROM pedido_itens pi JOIN pedidos p ON p.id = pi.pedido_id WHERE p.empenho_id = ?",
            (empenho_id,))
    elif item_id is not None:
        s["itens"] = _linhas(db, "SELECT * FROM itens WHERE id = ?", (item_id,))
        s["movimentos_item"] = _linhas(db, "SELECT * FROM movimentos_item WHERE item_id = ?", (item_id,))
        s["pedido_itens"] = _linhas(db, "SELECT * FROM pedido_itens WHERE item_id = ?", (item_id,))
        s["recebimentos"] = _linhas(db, "SELECT * FROM recebimentos WHERE item_id = ?", (item_id,))
    elif pedido_id is not None:
        s["pedidos"] = _linhas(db, "SELECT * FROM pedidos WHERE id = ?", (pedido_id,))
        s["pedido_itens"] = _linhas(db, "SELECT * FROM pedido_itens WHERE pedido_id = ?", (pedido_id,))
        s["recebimentos"] = _linhas(db, "SELECT * FROM recebimentos WHERE pedido_id = ?", (pedido_id,))
    elif recebimento_ids:
        s["recebimentos"] = _linhas(db, f"SELECT * FROM recebimentos WHERE id IN ({_in(recebimento_ids)})",
                                    tuple(recebimento_ids))
    elif pagamento_id is not None:
        s["pagamentos"] = _linhas(db, "SELECT * FROM pagamentos WHERE id = ?", (pagamento_id,))
    return s


def mandar_para_lixeira(db, tipo, descricao, empenho_id, dados):
    db.execute(
        "INSERT INTO lixeira (quando, usuario, tipo, descricao, empenho_id, dados, restaurado) VALUES (?,?,?,?,?,?,0)",
        (agora(), usuario_atual(), tipo, descricao, empenho_id, json.dumps(dados, default=str)),
    )


def restaurar_snapshot(db, dados):
    """Reinsere as linhas guardadas (com novos ids), religando as referências.
    Linhas cujo 'pai' não existe mais são puladas. Retorna (restauradas, puladas)."""
    mapa = {t: {} for t, _ in TABELAS_LIXEIRA}
    restauradas = puladas = 0

    def existe(tabela, rid):
        return db.execute(f"SELECT 1 as x FROM {tabela} WHERE id = ?", (rid,)).fetchone() is not None

    for tabela, fks in TABELAS_LIXEIRA:
        for linha in dados.get(tabela, []):
            nova = {k: v for k, v in linha.items() if k != "id" and re.fullmatch(r"[a-z_]+", k)}
            ok = True
            for col, pai in fks.items():
                antigo = nova.get(col)
                if antigo in mapa[pai]:
                    nova[col] = mapa[pai][antigo]
                elif antigo is None or not existe(pai, antigo):
                    ok = False
                    break
            if not ok:
                puladas += 1
                continue
            cols = list(nova.keys())
            cur = db.execute(
                f"INSERT INTO {tabela} ({','.join(cols)}) VALUES ({_in(cols)})",
                tuple(nova[c] for c in cols),
            )
            mapa[tabela][linha["id"]] = cur.lastrowid
            restauradas += 1
    return restauradas, puladas, mapa


# ============================================================================
# CÁLCULOS (saldos, status, financeiro)
# ============================================================================
# Regras de negócio:
#   * SALDO FÍSICO   = qtde_empenhada − Σ recebido (baixa só com NF)
#   * RESERVADO      = o que está pedido em pedidos ABERTOS e ainda não chegou
#   * SALDO A PEDIR  = qtde_empenhada − recebido − reservado
#   * LIQUIDADO      = Σ (qtde recebida × valor unitário)   [vem das NFs]
#   * PAGO           = Σ valor das NFs marcadas como pagas
#   * A LIQUIDAR     = valor empenhado − liquidado
#   * A PAGAR        = liquidado − pago
#   * qtde_empenhada já reflete reforços/anulações (histórico em movimentos_item)

SQL_ITENS = (
    "SELECT i.*,"
    " (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r WHERE r.item_id = i.id) as qtde_recebida,"
    " (SELECT COALESCE(SUM(pi.qtde_pedida),0) FROM pedido_itens pi JOIN pedidos p ON p.id = pi.pedido_id"
    "   WHERE pi.item_id = i.id AND COALESCE(p.encerrado,0) = 0) as pedida_aberta,"
    " (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r JOIN pedidos p ON p.id = r.pedido_id"
    "   WHERE r.item_id = i.id AND COALESCE(p.encerrado,0) = 0) as recebida_aberta"
    " FROM itens i"
)


def completar_item(r):
    d = dict(r)
    q = float(d["qtde_empenhada"] or 0)
    vu = float(d["valor_unitario"] or 0)
    total = float(d["valor_total"] or 0)
    rec = float(d.pop("qtde_recebida") or 0)
    reservado = max(0.0, float(d.pop("pedida_aberta") or 0) - float(d.pop("recebida_aberta") or 0))
    d["qtde_recebida"] = rec
    d["reservado"] = reservado
    d["saldo_fisico"] = max(0.0, q - rec)
    d["saldo_a_pedir"] = max(0.0, q - rec - reservado)
    d["liquidado"] = rec * vu
    d["a_liquidar"] = max(0.0, total - d["liquidado"])
    d["percentual_liquidado"] = round(d["liquidado"] / total * 100, 2) if total else 0
    d["percentual_fisico"] = round(min(rec, q) / q * 100, 2) if q else 0
    return d


def itens_do_empenho(db, eid):
    return [completar_item(r) for r in db.execute(SQL_ITENS + " WHERE i.empenho_id = ? ORDER BY i.id", (eid,)).fetchall()]


def item_completo(db, iid):
    r = db.execute(SQL_ITENS + " WHERE i.id = ?", (iid,)).fetchone()
    return completar_item(r) if r else None


def resumo_pedidos(db, empenho_id=None, pedido_id=None):
    """Por pedido: qtde pedida/recebida, STATUS, vencimento e atraso.

    Regra única usada em todas as telas:
      * Só contam recebimentos de itens que fazem parte do pedido.
      * RECEBIDO  -> todos os itens chegaram por completo.
      * ENCERRADO -> pedido fechado manualmente (o que faltava foi liberado).
      * PARCIAL   -> algum item chegou, mas não todos.
      * INCLUIDO  -> nada recebido ainda.
      * Atrasado  -> INCLUIDO/PARCIAL com vencimento (data + prazo) já passado.
    """
    filtro, params = "", []
    if pedido_id is not None:
        filtro, params = " WHERE p.id = ?", [pedido_id]
    elif empenho_id is not None:
        filtro, params = " WHERE p.empenho_id = ?", [empenho_id]
    pedidos = db.execute(
        "SELECT p.id, p.data_pedido, p.prazo_dias, p.encerrado FROM pedidos p" + filtro, tuple(params)
    ).fetchall()
    rows = db.execute(
        "SELECT pi.pedido_id, pi.item_id, SUM(pi.qtde_pedida) as pedida,"
        " (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r"
        "   WHERE r.pedido_id = pi.pedido_id AND r.item_id = pi.item_id) as recebida"
        " FROM pedido_itens pi JOIN pedidos p ON p.id = pi.pedido_id" + filtro +
        " GROUP BY pi.pedido_id, pi.item_id",
        tuple(params),
    ).fetchall()

    out = {p["id"]: {"pedida": 0.0, "recebida": 0.0, "itens": {}, "_p": p} for p in pedidos}
    for r in rows:
        p = out.setdefault(r["pedido_id"], {"pedida": 0.0, "recebida": 0.0, "itens": {}, "_p": None})
        pedida = float(r["pedida"] or 0)
        recebida = float(r["recebida"] or 0)
        p["itens"][r["item_id"]] = {"pedida": pedida, "recebida": recebida}
        p["pedida"] += pedida
        p["recebida"] += min(recebida, pedida)

    hoje = date.today()
    for pid, p in out.items():
        meta = p.pop("_p")
        itens = [i for i in p["itens"].values() if i["pedida"] > 0]
        completo = bool(itens) and all(i["recebida"] + EPS >= i["pedida"] for i in itens)
        if completo:
            p["status"] = "RECEBIDO"
        elif meta is not None and meta["encerrado"]:
            p["status"] = "ENCERRADO"
        elif any(i["recebida"] > 0 for i in itens):
            p["status"] = "PARCIAL"
        else:
            p["status"] = "INCLUIDO"
        venc = None
        if meta is not None and meta["prazo_dias"] and parse_data(meta["data_pedido"]):
            venc = parse_data(meta["data_pedido"]) + timedelta(days=int(meta["prazo_dias"]))
        p["vencimento"] = venc.isoformat() if venc else None
        aberto = p["status"] in ("INCLUIDO", "PARCIAL")
        p["dias_atraso"] = (hoje - venc).days if (venc and aberto and hoje > venc) else 0
        p["atrasado"] = p["dias_atraso"] > 0
        # Vence nos próximos 7 dias (ainda no prazo) — aparece em "precisa de atenção"
        p["vencendo"] = bool(venc and aberto and 0 <= (venc - hoje).days <= 7)
    return out


def nfs_a_pagar_por_empenho(db):
    """{empenho_id: (qtde de NFs a pagar, valor)} — NF = grupo pedido + nº + data."""
    out = {}
    for r in db.execute(
        "SELECT r.empenho_id, r.pedido_id, r.nf, r.data_recebimento,"
        " SUM(r.qtde_recebida * i.valor_unitario) as v"
        " FROM recebimentos r JOIN itens i ON i.id = r.item_id WHERE r.pago_em IS NULL"
        " GROUP BY r.empenho_id, r.pedido_id, r.nf, r.data_recebimento"
    ).fetchall():
        qtd, val = out.get(r["empenho_id"], (0, 0.0))
        out[r["empenho_id"]] = (qtd + 1, val + float(r["v"] or 0))
    return out


def financeiro_empenhos(db):
    """Empenhado, liquidado e pago por empenho (uma consulta só)."""
    rows = db.execute(
        "SELECT e.*,"
        " (SELECT COALESCE(SUM(i.valor_total),0) FROM itens i WHERE i.empenho_id = e.id) as valor_empenhado,"
        " (SELECT COALESCE(SUM(r.qtde_recebida * i2.valor_unitario),0)"
        "   FROM recebimentos r JOIN itens i2 ON i2.id = r.item_id WHERE i2.empenho_id = e.id) as valor_liquidado,"
        " (SELECT COALESCE(SUM(rp.qtde_recebida * ip.valor_unitario),0) FROM recebimentos rp"
        "   JOIN itens ip ON ip.id = rp.item_id WHERE ip.empenho_id = e.id AND rp.pago_em IS NOT NULL) as valor_pago,"
        " (SELECT COUNT(*) FROM itens i3 WHERE i3.empenho_id = e.id AND i3.qtde_empenhada > 0) as qt_itens,"
        " (SELECT COUNT(*) FROM itens i4 WHERE i4.empenho_id = e.id AND i4.qtde_empenhada > 0"
        "   AND (SELECT COALESCE(SUM(r2.qtde_recebida),0) FROM recebimentos r2 WHERE r2.item_id = i4.id)"
        "       + 1e-9 < i4.qtde_empenhada) as qt_itens_pendentes"
        " FROM empenhos e ORDER BY e.id DESC"
    ).fetchall()
    descricoes = {}
    for it in db.execute("SELECT empenho_id, descricao FROM itens ORDER BY id").fetchall():
        descricoes.setdefault(it["empenho_id"], []).append(it["descricao"])
    out = []
    for r in rows:
        d = dict(r)
        d["itens_resumo"] = resumo_do_empenho(d.get("resumo"), descricoes.get(d["id"], []))
        emp = float(d["valor_empenhado"] or 0)
        liq = float(d["valor_liquidado"] or 0)
        pago = float(d["valor_pago"] or 0)
        d.update(valor_empenhado=emp, valor_liquidado=liq, valor_pago=pago)
        d["a_liquidar"] = max(0.0, emp - liq)
        d["a_pagar"] = max(0.0, liq - pago)
        d["percentual_liquidado"] = round(liq / emp * 100, 2) if emp else 0
        d["percentual_pago"] = round(pago / emp * 100, 2) if emp else 0
        if not d["qt_itens"]:
            d["situacao"] = "SEM_ITENS"
        elif d["qt_itens_pendentes"]:
            d["situacao"] = "ANDAMENTO"
        else:
            d["situacao"] = "CONCLUIDO"
        m = re.match(r"\s*(\d{4})", d.get("ne") or "")
        d["ano"] = m.group(1) if m else (d.get("criado_em") or "")[:4]
        out.append(d)
    return out


def resumo_do_empenho(manual, descricoes):
    """Lista de nomes curtos: o resumo digitado (separado por vírgula) ou o gerado das descrições."""
    if (manual or "").strip():
        return [p.strip() for p in manual.split(",") if p.strip()]
    return resumo_de_itens(descricoes)


def liquidado_e_pago(db, eid):
    liq = db.execute(
        "SELECT COALESCE(SUM(r.qtde_recebida * i.valor_unitario),0) as v"
        " FROM recebimentos r JOIN itens i ON i.id = r.item_id WHERE i.empenho_id = ?", (eid,)
    ).fetchone()["v"]
    pago = db.execute(
        "SELECT COALESCE(SUM(r.qtde_recebida * i.valor_unitario),0) as v FROM recebimentos r"
        " JOIN itens i ON i.id = r.item_id WHERE i.empenho_id = ? AND r.pago_em IS NOT NULL", (eid,)
    ).fetchone()["v"]
    return float(liq or 0), float(pago or 0)


# ============================================================================
# PÁGINAS
# ============================================================================
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/empenhos")
def pag_empenhos():
    return render_template("empenhos.html")


@app.route("/historico")
def pag_historico():
    return render_template("historico.html")


# ============================================================================
# EMPENHOS
# ============================================================================
@app.route("/api/empenhos")
def api_lista_empenhos():
    db = get_db()
    lista = financeiro_empenhos(db)
    resumo = resumo_pedidos(db)
    atrasos, vencendo, abertos = {}, {}, {}
    pid_emp = {r["id"]: r["empenho_id"] for r in db.execute("SELECT id, empenho_id FROM pedidos").fetchall()}
    for pid, p in resumo.items():
        if p["status"] in ("INCLUIDO", "PARCIAL"):
            abertos[pid_emp.get(pid)] = abertos.get(pid_emp.get(pid), 0) + 1
        if p["atrasado"]:
            atrasos[pid_emp.get(pid)] = atrasos.get(pid_emp.get(pid), 0) + 1
        if p["vencendo"]:
            vencendo[pid_emp.get(pid)] = vencendo.get(pid_emp.get(pid), 0) + 1
    a_pagar = nfs_a_pagar_por_empenho(db)
    for d in lista:
        d["pedidos_atrasados"] = atrasos.get(d["id"], 0)
        d["pedidos_vencendo"] = vencendo.get(d["id"], 0)
        d["pedidos_em_aberto"] = abertos.get(d["id"], 0)
        d["nfs_a_pagar"] = a_pagar.get(d["id"], (0, 0.0))[0]
    return jsonify(lista)


@app.route("/api/empenhos", methods=["POST"])
def api_criar_empenho():
    data = request.json or {}
    ne = (data.get("ne") or "").strip()
    processo = (data.get("processo") or "").strip()
    nome_credor = (data.get("nome_credor") or "").strip().upper()
    resumo = _limpar_resumo(data.get("resumo"))
    if not ne:
        return erro("Informe o número do empenho (NE)")
    if not nome_credor:
        return erro("Informe o fornecedor")
    db = get_db()
    cur = db.execute(
        "INSERT INTO empenhos (ne, processo, nome_credor, criado_em, resumo) VALUES (?,?,?,?,?)",
        (ne, processo, nome_credor, agora(), resumo),
    )
    registrar(db, "CRIAR", "empenho", cur.lastrowid, cur.lastrowid, f"Empenho {ne} criado ({nome_credor})")
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


def _limpar_resumo(v):
    partes = [re.sub(r"\s+", " ", p).strip() for p in str(v or "").split(",")]
    return ", ".join(p for p in partes if p)[:300] or None


@app.route("/api/empenhos/<int:eid>", methods=["PUT"])
def api_editar_empenho(eid):
    data = request.json or {}
    db = get_db()
    e = db.execute("SELECT * FROM empenhos WHERE id = ?", (eid,)).fetchone()
    if not e:
        return erro("Empenho não encontrado", 404)
    ne = (data.get("ne") or "").strip()
    credor = (data.get("nome_credor") or "").strip().upper()
    processo = (data.get("processo") or "").strip()
    resumo = _limpar_resumo(data.get("resumo"))
    if not ne or not credor:
        return erro("NE e fornecedor são obrigatórios")
    db.execute("UPDATE empenhos SET ne=?, processo=?, nome_credor=?, resumo=? WHERE id=?", (ne, processo, credor, resumo, eid))
    mud = [f"{c}: {e[k] or '—'} → {v or '—'}" for c, k, v in
           (("NE", "ne", ne), ("Fornecedor", "nome_credor", credor), ("Processo", "processo", processo),
            ("Resumo dos itens", "resumo", resumo or "")) if (e[k] or "") != (v or "")]
    registrar(db, "EDITAR", "empenho", eid, eid, f"Empenho {ne} editado" + (": " + "; ".join(mud) if mud else ""))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/empenhos/<int:eid>")
def api_detalhe_empenho(eid):
    db = get_db()
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (eid,)).fetchone()
    if not empenho:
        return erro("Empenho não encontrado", 404)
    itens = itens_do_empenho(db, eid)
    resumo = resumo_pedidos(db, empenho_id=eid)
    pedidos = []
    for p in db.execute(
        "SELECT p.*,"
        " (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.pedido_id = p.id) as qt_itens,"
        " (SELECT COUNT(*) FROM recebimentos r WHERE r.pedido_id = p.id) as qt_recebimentos,"
        " (SELECT COUNT(*) FROM recebimentos r2 WHERE r2.pedido_id = p.id AND r2.pago_em IS NULL) as qt_linhas_a_pagar"
        " FROM pedidos p WHERE p.empenho_id = ? ORDER BY p.id DESC", (eid,)
    ).fetchall():
        pd = dict(p)
        rs = resumo.get(pd["id"], {})
        pd["qtde_total_pedida"] = rs.get("pedida", 0)
        pd["qtde_total_recebida"] = rs.get("recebida", 0)
        pd["status"] = rs.get("status", "INCLUIDO")
        pd["vencimento"] = rs.get("vencimento")
        pd["dias_atraso"] = rs.get("dias_atraso", 0)
        pedidos.append(pd)
    nfs = _grupos_nf(db.execute(
        "SELECT r.id, r.pedido_id, r.nf, r.data_recebimento, r.observacoes, r.item_id, r.qtde_recebida, r.pago_em, r.pago_por,"
        " i.numero_item, i.descricao, i.und, i.valor_unitario"
        " FROM recebimentos r JOIN itens i ON i.id = r.item_id JOIN pedidos p ON p.id = r.pedido_id"
        " WHERE p.empenho_id = ? ORDER BY r.id", (eid,)).fetchall(), por_pedido=True)
    for pd in pedidos:
        das_nfs = [n for n in nfs if n["pedido_id"] == pd["id"]]
        pd["qt_nfs"] = len(das_nfs)
        pd["qt_nfs_a_pagar"] = sum(1 for n in das_nfs if not n["pago_em"])
    # Pagamentos (OB) lançados no modo antigo, antes do "marcar NF como paga"
    pagamentos = _linhas(db, "SELECT * FROM pagamentos WHERE empenho_id = ? ORDER BY data_pagamento DESC, id DESC", (eid,))
    movimentos = _linhas(
        db, "SELECT m.*, i.numero_item, i.descricao, i.und FROM movimentos_item m JOIN itens i ON i.id = m.item_id"
            " WHERE m.empenho_id = ? ORDER BY m.id DESC", (eid,))
    liq, pago = liquidado_e_pago(db, eid)
    empenhado = sum(i["valor_total"] or 0 for i in itens)
    return jsonify({
        "empenho": dict(empenho),
        "resumo_auto": ", ".join(resumo_de_itens([i["descricao"] for i in itens])),
        "itens": itens,
        "pedidos": pedidos,
        "pagamentos_antigos": pagamentos,
        "movimentos": movimentos,
        "financeiro": {
            "empenhado": empenhado, "liquidado": liq, "pago": pago,
            "a_liquidar": max(0.0, empenhado - liq), "a_pagar": max(0.0, liq - pago),
        },
    })


@app.route("/api/empenhos/<int:eid>", methods=["DELETE"])
def api_excluir_empenho(eid):
    db = get_db()
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (eid,)).fetchone()
    if not empenho:
        return erro("Empenho não encontrado", 404)
    desc = f"Empenho {empenho['ne']} ({empenho['nome_credor']}) com itens, pedidos, NFs e pagamentos"
    mandar_para_lixeira(db, "empenho", desc, eid, snapshot(db, empenho_id=eid))
    db.execute("DELETE FROM empenhos WHERE id = ?", (eid,))
    registrar(db, "EXCLUIR", "empenho", eid, eid, f"Empenho {empenho['ne']} enviado para a lixeira")
    db.commit()
    return jsonify({"ok": True, "ne": empenho["ne"]})


# ============================================================================
# ITENS
# ============================================================================
def _inserir_item(db, eid, numero_item, descricao, und, qtde, vu):
    cur = db.execute(
        "INSERT INTO itens (empenho_id, numero_item, descricao, und, qtde_empenhada, valor_unitario, valor_total, criado_em)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (eid, numero_item, descricao, und, qtde, vu, qtde * vu, agora()),
    )
    return cur.lastrowid


@app.route("/api/empenhos/<int:eid>/itens", methods=["POST"])
def api_incluir_varios_itens(eid):
    """Body: { itens: [{numero_item, descricao, und, qtde_empenhada, valor_unitario}] }"""
    db = get_db()
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (eid,)).fetchone()
    if not empenho:
        return erro("Empenho não encontrado", 404)
    valido = []
    for it in (request.json or {}).get("itens") or []:
        descricao = (it.get("descricao") or "").strip()
        if not descricao:
            continue
        qtde = parse_money(it.get("qtde_empenhada"))
        vu = parse_money(it.get("valor_unitario"))
        if qtde < 0 or vu < 0:
            return erro(f"{descricao}: quantidade e valor não podem ser negativos")
        valido.append(((it.get("numero_item") or "").strip(), descricao, (it.get("und") or "").strip(), qtde, vu))
    if not valido:
        return erro("Informe ao menos um item com descrição")
    criados, total = [], 0.0
    for numero_item, descricao, und, qtde, vu in valido:
        iid = _inserir_item(db, eid, numero_item, descricao, und, qtde, vu)
        criados.append({"id": iid, "numero_item": numero_item, "descricao": descricao, "und": und,
                        "qtde_empenhada": qtde, "valor_unitario": vu, "valor_total": qtde * vu})
        total += qtde * vu
    registrar(db, "CRIAR", "item", None, eid,
              f"{len(criados)} item(ns) incluído(s) no empenho {empenho['ne']} — total {fmt_brl(total)}")
    db.commit()
    return jsonify({"ok": True, "itens": criados, "quantidade": len(criados), "valor_total": total})


@app.route("/api/itens", methods=["POST"])
def api_criar_item():
    data = request.json or {}
    eid = data.get("empenho_id")
    descricao = (data.get("descricao") or "").strip()
    if not eid:
        return erro("Faltou o identificador do empenho")
    if not descricao:
        return erro("Informe a descrição do item")
    db = get_db()
    if not db.execute("SELECT 1 as x FROM empenhos WHERE id = ?", (eid,)).fetchone():
        return erro("Empenho não encontrado", 404)
    qtde = parse_money(data.get("qtde_empenhada"))
    vu = parse_money(data.get("valor_unitario"))
    iid = _inserir_item(db, eid, (data.get("numero_item") or "").strip(), descricao, (data.get("und") or "").strip(), qtde, vu)
    registrar(db, "CRIAR", "item", iid, eid, f"Item {descricao} incluído")
    db.commit()
    return jsonify({"ok": True, "id": iid, "valor_total": qtde * vu})


@app.route("/api/itens/<int:iid>", methods=["PUT"])
def api_editar_item(iid):
    data = request.json or {}
    db = get_db()
    item = item_completo(db, iid)
    if not item:
        return erro("Item não encontrado", 404)
    descricao = (data.get("descricao") or item["descricao"] or "").strip()
    numero_item = (data.get("numero_item") if data.get("numero_item") is not None else item["numero_item"] or "").strip()
    und = (data.get("und") if data.get("und") is not None else item["und"] or "").strip()
    qtde = parse_money(data.get("qtde_empenhada", item["qtde_empenhada"]))
    vu = parse_money(data.get("valor_unitario", item["valor_unitario"]))
    # Não deixa a quantidade ficar abaixo do que já foi recebido + o que está pedido
    comprometido = item["qtde_recebida"] + item["reservado"]
    if qtde + EPS < comprometido:
        return erro(f"A quantidade não pode ficar abaixo de {fmt_qtd(comprometido)} "
                    f"(já recebido {fmt_qtd(item['qtde_recebida'])} + pedido em aberto {fmt_qtd(item['reservado'])})")
    if vu < 0:
        return erro("Valor unitário não pode ser negativo")
    # Mudar o valor unitário mudaria o valor de NFs já pagas
    if abs(vu - float(item["valor_unitario"] or 0)) > EPS and _tem_nf_paga(db, "item_id", iid):
        return erro("Este item tem NF marcada como paga. Desmarque o pagamento da NF antes de mudar o valor unitário.")
    db.execute(
        "UPDATE itens SET numero_item=?, descricao=?, und=?, qtde_empenhada=?, valor_unitario=?, valor_total=? WHERE id=?",
        (numero_item, descricao, und, qtde, vu, qtde * vu, iid),
    )
    mud = []
    if abs(qtde - float(item["qtde_empenhada"] or 0)) > EPS:
        mud.append(f"qtde {fmt_qtd(item['qtde_empenhada'])} → {fmt_qtd(qtde)}")
    if abs(vu - float(item["valor_unitario"] or 0)) > EPS:
        mud.append(f"valor unit. {fmt_brl(item['valor_unitario'])} → {fmt_brl(vu)}")
    if descricao != item["descricao"]:
        mud.append(f"descrição '{item['descricao']}' → '{descricao}'")
    registrar(db, "EDITAR", "item", iid, item["empenho_id"],
              f"Item {descricao} editado" + (": " + "; ".join(mud) if mud else ""))
    db.commit()
    return jsonify({"ok": True, "valor_total": qtde * vu})


@app.route("/api/itens/<int:iid>/movimentos", methods=["POST"])
def api_movimento_item(iid):
    """Reforço (aumenta) ou anulação (reduz) a quantidade empenhada do item."""
    data = request.json or {}
    db = get_db()
    item = item_completo(db, iid)
    if not item:
        return erro("Item não encontrado", 404)
    tipo = (data.get("tipo") or "").upper()
    if tipo not in ("REFORCO", "ANULACAO"):
        return erro("Tipo deve ser reforço ou anulação")
    qtde = parse_money(data.get("qtde"))
    if qtde <= 0:
        return erro("Informe uma quantidade maior que zero")
    if tipo == "ANULACAO" and qtde > item["saldo_a_pedir"] + EPS:
        return erro(f"Só é possível anular até o saldo a pedir ({fmt_qtd(item['saldo_a_pedir'])} {item['und'] or ''})".strip())
    nova = float(item["qtde_empenhada"] or 0) + (qtde if tipo == "REFORCO" else -qtde)
    vu = float(item["valor_unitario"] or 0)
    db.execute("UPDATE itens SET qtde_empenhada=?, valor_total=? WHERE id=?", (nova, nova * vu, iid))
    db.execute(
        "INSERT INTO movimentos_item (item_id, empenho_id, tipo, qtde, data, documento, observacoes, criado_em)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (iid, item["empenho_id"], tipo, qtde, (data.get("data") or date.today().isoformat())[:10],
         (data.get("documento") or "").strip(), (data.get("observacoes") or "").strip(), agora()),
    )
    rotulo = "Reforço" if tipo == "REFORCO" else "Anulação"
    registrar(db, tipo, "item", iid, item["empenho_id"],
              f"{rotulo} de {fmt_qtd(qtde)} {item['und'] or ''} em {nome_item(item)} ({fmt_brl(qtde * vu)})"
              + (f" — doc. {data.get('documento')}" if data.get("documento") else ""))
    db.commit()
    return jsonify({"ok": True, "qtde_empenhada": nova})


@app.route("/api/itens/<int:iid>", methods=["DELETE"])
def api_excluir_item(iid):
    db = get_db()
    item = db.execute("SELECT * FROM itens WHERE id = ?", (iid,)).fetchone()
    if not item:
        return erro("Item não encontrado", 404)
    eid = item["empenho_id"]
    # Excluir o item apaga as NFs dele
    if _tem_nf_paga(db, "item_id", iid):
        return erro("Este item tem NF marcada como paga. Desmarque o pagamento da NF antes de excluir o item.")
    mandar_para_lixeira(db, "item", f"{nome_item(item)} com pedidos/NFs ligados a ele", eid, snapshot(db, item_id=iid))
    db.execute("DELETE FROM itens WHERE id = ?", (iid,))
    registrar(db, "EXCLUIR", "item", iid, eid, f"{nome_item(item)} enviado para a lixeira")
    db.commit()
    return jsonify({"ok": True})


# ============================================================================
# PEDIDOS
# ============================================================================
def _validar_itens_pedido(db, empenho_id, itens, pedido_id=None):
    """Confere quantidades contra o SALDO A PEDIR (que já desconta outros pedidos
    abertos). Na edição, o próprio pedido não conta como reserva e cada item não
    pode ficar abaixo do que já foi recebido nele."""
    atuais, encerrado = {}, False
    if pedido_id is not None:
        rs = resumo_pedidos(db, pedido_id=pedido_id).get(pedido_id, {"itens": {}})
        atuais = rs["itens"]
        encerrado = rs.get("status") == "ENCERRADO"
    validos, vistos = [], set()
    for it in itens:
        qtde = parse_money(it.get("qtde_pedida"))
        try:
            item_id = int(it.get("item_id"))
        except (TypeError, ValueError):
            return None, "Item inválido"
        no_ped = atuais.get(item_id, {"pedida": 0.0, "recebida": 0.0})
        if qtde <= 0 and no_ped["recebida"] <= 0:
            continue
        item = item_completo(db, item_id)
        if not item or item["empenho_id"] != int(empenho_id):
            return None, "Item não pertence a este empenho"
        if qtde + EPS < no_ped["recebida"]:
            return None, f"{nome_item(item)}: já foram recebidos {fmt_qtd(no_ped['recebida'])} neste pedido"
        # O que este pedido já reservava volta ao saldo durante a edição
        reserva_propria = 0.0 if encerrado else max(0.0, no_ped["pedida"] - no_ped["recebida"])
        maximo = no_ped["recebida"] + item["saldo_a_pedir"] + reserva_propria
        if qtde > maximo + EPS:
            return None, (f"{nome_item(item)}: pedido de {fmt_qtd(qtde)} maior que o saldo a pedir "
                          f"(máximo {fmt_qtd(maximo)} {item['und'] or ''})".rstrip())
        validos.append((item_id, qtde))
        vistos.add(item_id)
    # Na edição, item que já teve entrega não pode sair do pedido
    for item_id, q in atuais.items():
        if q["recebida"] > 0 and item_id not in vistos:
            item = item_completo(db, item_id)
            return None, f"{nome_item(item)} já teve entrega neste pedido e não pode ser removido"
    return validos, None


@app.route("/api/pedidos", methods=["POST"])
def api_criar_pedido():
    data = request.json or {}
    empenho_id = data.get("empenho_id")
    numero_pedido = (data.get("numero_pedido") or "").strip()
    if not empenho_id:
        return erro("Faltou o identificador do empenho")
    if not numero_pedido:
        return erro("Informe o número do pedido")
    db = get_db()
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (empenho_id,)).fetchone()
    if not empenho:
        return erro("Empenho não encontrado", 404)
    validos, msg = _validar_itens_pedido(db, empenho_id, data.get("itens") or [])
    if msg:
        return erro(msg)
    if not validos:
        return erro("Informe pelo menos um item com quantidade pedida")
    prazo = data.get("prazo_dias")
    prazo = int(prazo) if str(prazo or "").strip().isdigit() else None
    cur = db.execute(
        "INSERT INTO pedidos (empenho_id, numero_pedido, data_pedido, observacoes, criado_em, prazo_dias, encerrado)"
        " VALUES (?,?,?,?,?,?,0)",
        (empenho_id, numero_pedido, (data.get("data_pedido") or date.today().isoformat())[:10],
         (data.get("observacoes") or "").strip(), agora(), prazo),
    )
    pedido_id = cur.lastrowid
    for item_id, qtde in validos:
        db.execute("INSERT INTO pedido_itens (pedido_id, item_id, qtde_pedida) VALUES (?,?,?)", (pedido_id, item_id, qtde))
    registrar(db, "CRIAR", "pedido", pedido_id, empenho_id,
              f"Pedido {numero_pedido} criado com {len(validos)} item(ns)" + (f", prazo {prazo} dias" if prazo else ""))
    db.commit()
    return jsonify({"ok": True, "id": pedido_id})


@app.route("/api/pedidos/<int:pid>", methods=["PUT"])
def api_editar_pedido(pid):
    data = request.json or {}
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    numero = (data.get("numero_pedido") or "").strip()
    if not numero:
        return erro("Informe o número do pedido")
    validos, msg = _validar_itens_pedido(db, pedido["empenho_id"], data.get("itens") or [], pedido_id=pid)
    if msg:
        return erro(msg)
    if not validos or not any(q > 0 for _, q in validos):
        return erro("O pedido precisa ter ao menos um item")
    prazo = data.get("prazo_dias")
    prazo = int(prazo) if str(prazo or "").strip().isdigit() else None
    db.execute(
        "UPDATE pedidos SET numero_pedido=?, data_pedido=?, observacoes=?, prazo_dias=? WHERE id=?",
        (numero, (data.get("data_pedido") or pedido["data_pedido"] or "")[:10],
         (data.get("observacoes") or "").strip(), prazo, pid),
    )
    db.execute("DELETE FROM pedido_itens WHERE pedido_id = ?", (pid,))
    for item_id, qtde in validos:
        if qtde > 0:
            db.execute("INSERT INTO pedido_itens (pedido_id, item_id, qtde_pedida) VALUES (?,?,?)", (pid, item_id, qtde))
    registrar(db, "EDITAR", "pedido", pid, pedido["empenho_id"], f"Pedido {numero} editado")
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/pedidos/<int:pid>/encerrar", methods=["POST"])
def api_encerrar_pedido(pid):
    """Encerra (ou reabre) um pedido parcial: o que faltava chegar volta ao saldo a pedir."""
    data = request.json or {}
    reabrir = bool(data.get("reabrir"))
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    if reabrir:
        # Reabrir volta a reservar o que falta: confere se ainda há saldo
        rs = resumo_pedidos(db, pedido_id=pid)[pid]
        for item_id, q in rs["itens"].items():
            falta = max(0.0, q["pedida"] - q["recebida"])
            item = item_completo(db, item_id)
            if falta > item["saldo_a_pedir"] + EPS:
                return erro(f"Não há saldo para reabrir: {nome_item(item)} precisa de {fmt_qtd(falta)}, "
                            f"saldo a pedir {fmt_qtd(item['saldo_a_pedir'])}")
        db.execute("UPDATE pedidos SET encerrado = 0, encerrado_em = NULL WHERE id = ?", (pid,))
        registrar(db, "EDITAR", "pedido", pid, pedido["empenho_id"], f"Pedido {pedido['numero_pedido']} reaberto")
    else:
        db.execute("UPDATE pedidos SET encerrado = 1, encerrado_em = ? WHERE id = ?", (agora(), pid))
        registrar(db, "ENCERRAR", "pedido", pid, pedido["empenho_id"],
                  f"Pedido {pedido['numero_pedido']} encerrado — o que faltava voltou ao saldo a pedir")
    db.commit()
    return jsonify({"ok": True})


def _grupos_nf(recs, por_pedido=False):
    """Agrupa as linhas de recebimento por NF + data (uma 'nota').
    A NF conta como paga quando todas as suas linhas estão marcadas."""
    grupos = []
    for r in recs:
        chave = ((r["pedido_id"] if por_pedido else None), (r["nf"] or "").strip(), r["data_recebimento"] or "")
        gr = next((x for x in grupos if x["_k"] == chave), None)
        item = {"item_id": r["item_id"], "numero_item": r["numero_item"], "descricao": r["descricao"],
                "und": r["und"], "qtde_recebida": r["qtde_recebida"], "valor_unitario": r["valor_unitario"]}
        if gr is None:
            gr = {"_k": chave, "ids": [], "nf": r["nf"] or "—", "data_recebimento": r["data_recebimento"],
                  "observacoes": r["observacoes"], "itens": [], "_pagos": []}
            if por_pedido:
                gr["pedido_id"] = r["pedido_id"]
            grupos.append(gr)
        gr["ids"].append(r["id"])
        gr["itens"].append(item)
        gr["_pagos"].append((r["pago_em"], r["pago_por"]))
    for gr in grupos:
        gr.pop("_k")
        pagos = gr.pop("_pagos")
        todos = all(pg[0] for pg in pagos)
        gr["pago_em"] = pagos[0][0] if todos else None
        gr["pago_por"] = pagos[0][1] if todos else None
        gr["valor"] = sum(float(i["qtde_recebida"] or 0) * float(i["valor_unitario"] or 0) for i in gr["itens"])
    return grupos


def _tem_nf_paga(db, coluna, valor):
    """Há alguma linha de NF paga para este item/pedido? (coluna é fixa no código)"""
    assert coluna in ("item_id", "pedido_id")
    return db.execute(
        f"SELECT 1 as x FROM recebimentos WHERE {coluna} = ? AND pago_em IS NOT NULL LIMIT 1", (valor,)
    ).fetchone() is not None


@app.route("/api/pedidos/<int:pid>", methods=["GET"])
def api_detalhe_pedido(pid):
    """Itens do pedido (com o que falta receber) e as NFs registradas."""
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (pedido["empenho_id"],)).fetchone()
    rs = resumo_pedidos(db, pedido_id=pid)[pid]

    itens = []
    for i in db.execute(
        "SELECT pi.item_id, i.numero_item, i.descricao, i.und, i.valor_unitario, pi.qtde_pedida"
        " FROM pedido_itens pi JOIN itens i ON i.id = pi.item_id WHERE pi.pedido_id = ? ORDER BY i.id", (pid,)
    ).fetchall():
        d = dict(i)
        comp = item_completo(db, d["item_id"])
        rec = rs["itens"].get(d["item_id"], {}).get("recebida", 0.0)
        d["qtde_recebida"] = rec
        d["saldo_fisico"] = comp["saldo_fisico"]
        d["saldo_a_pedir"] = comp["saldo_a_pedir"]
        d["pendente"] = 0.0 if pedido["encerrado"] else max(0.0, min(float(d["qtde_pedida"]) - rec, comp["saldo_fisico"]))
        d["valor_pedido"] = float(d["qtde_pedida"]) * float(d["valor_unitario"] or 0)
        itens.append(d)

    recs = db.execute(
        "SELECT r.id, r.pedido_id, r.nf, r.data_recebimento, r.observacoes, r.item_id, r.qtde_recebida, r.pago_em, r.pago_por,"
        " i.numero_item, i.descricao, i.und, i.valor_unitario"
        " FROM recebimentos r LEFT JOIN itens i ON i.id = r.item_id WHERE r.pedido_id = ? ORDER BY r.id", (pid,)
    ).fetchall()

    return jsonify({
        "ok": True,
        "pedido": dict(pedido),
        "empenho": dict(empenho) if empenho else None,
        "itens": itens,
        "recebimentos": _grupos_nf(recs),
        "qtde_total_pedida": rs["pedida"],
        "qtde_total_recebida": rs["recebida"],
        "status": rs["status"],
        "vencimento": rs["vencimento"],
        "dias_atraso": rs["dias_atraso"],
        "valor_total": sum(i["valor_pedido"] for i in itens),
    })


def gerar_pdf_pedido(pid):
    """PDF do pedido para envio ao fornecedor -> (BytesIO, nome do arquivo) ou None."""
    from fpdf import FPDF

    def norm(txt):
        if txt is None:
            return ""
        return "".join(c if ord(c) >= 32 else " " for c in str(txt))

    def fmt_br(v):
        return f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return None
    empenho = db.execute("SELECT * FROM empenhos WHERE id = ?", (pedido["empenho_id"],)).fetchone()
    itens = db.execute(
        "SELECT pi.qtde_pedida, i.numero_item, i.descricao, i.und, i.valor_unitario"
        " FROM pedido_itens pi JOIN itens i ON i.id = pi.item_id WHERE pi.pedido_id = ? ORDER BY i.id", (pid,)
    ).fetchall()
    # Valor do PEDIDO = qtde pedida × valor unitário (antes saía o total do item no empenho)
    linhas = [(i, float(i["qtde_pedida"] or 0) * float(i["valor_unitario"] or 0)) for i in itens]
    valor_total = sum(v for _, v in linhas)

    def fonte(peso):
        return os.path.join(BASE_DIR, "static", "fonts", f"Inter-{peso}.ttf")

    class PedidoPDF(FPDF):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            # Inter: texto normal, negrito (SemiBold) e títulos (Bold/ExtraBold)
            self.add_font("Inter", "", fonte("Regular"))
            self.add_font("Inter", "B", fonte("SemiBold"))
            self.add_font("InterTit", "", fonte("Bold"))
            self.add_font("InterTit", "B", fonte("ExtraBold"))

        def footer(self):
            self.set_y(-14)
            self.set_draw_color(26, 51, 115)
            self.set_line_width(0.4)
            self.line(15, self.get_y(), 195, self.get_y())
            self.set_y(-11)
            self.set_font("Inter", size=7.5)
            self.set_text_color(110, 110, 110)
            self.cell(0, 8, norm(f"3º CENTRO DE GEOINFORMAÇÃO  •  Doc. gerado automaticamente em {datetime.now().strftime('%d/%m/%Y %H:%M')}  •  Página {self.page_no()}/{{nb}}"), align="C")

    pdf = PedidoPDF("P", "mm", "A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=False)
    pdf.set_left_margin(15)
    pdf.set_right_margin(15)
    pdf.add_page()
    CONTENT_W = 210 - 30
    LIMITE_Y = 297 - 17  # o rodapé começa em 283 mm

    NAVY = (26, 51, 115)
    GOLD = (201, 174, 96)
    LIGHT = (180, 196, 224)
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 30, "F")
    # Brasão do 3º CGEO à esquerda e símbolo da Logística (folha de acanto) à direita
    brasao = os.path.join(BASE_DIR, "static", "img", "3cgeo.png")
    if os.path.exists(brasao):
        pdf.image(brasao, x=14, y=2.5, h=25)
    folha = os.path.join(BASE_DIR, "static", "img", "logistica.png")
    if os.path.exists(folha):
        pdf.image(folha, x=210 - 12 - 30, y=(30 - 30 * 165 / 320) / 2, w=30)
    pdf.set_text_color(*LIGHT)
    pdf.set_y(7.5)
    pdf.set_font("Inter", "B", 10)
    pdf.cell(0, 5.5, "EXÉRCITO BRASILEIRO", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("InterTit", "", 17)
    pdf.cell(0, 9, "3º CENTRO DE GEOINFORMAÇÃO", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_fill_color(*GOLD)
    pdf.rect(0, 30, 210, 2.5, "F")

    pdf.set_y(32.5 + 6)  # abaixo da faixa dourada
    pdf.set_font("InterTit", "", 15)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 8, "SOLICITAÇÃO DE MATERIAL", align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)
    pdf.set_text_color(*NAVY)
    pdf.set_font("InterTit", "", 26)
    pdf.cell(0, 11, f"PEDIDO {norm(pedido['numero_pedido'])}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("InterTit", "", 16)
    pdf.cell(0, 9, norm(empenho['ne'] if empenho else "-"), align="C", new_x="LMARGIN", new_y="NEXT")
    if empenho and empenho["nome_credor"]:
        pdf.ln(1)
        pdf.set_font("InterTit", "", 15)
        pdf.multi_cell(0, 7.5, norm(empenho["nome_credor"]), align="C", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
    pdf.set_font("Inter", "B", 12)
    pdf.set_text_color(60, 60, 70)
    linha_data = f"DATA: {data_br(pedido['data_pedido']) or '-'}"
    if pedido["prazo_dias"] and parse_data(pedido["data_pedido"]):
        venc = parse_data(pedido["data_pedido"]) + timedelta(days=int(pedido["prazo_dias"]))
        linha_data += f"     •     ENTREGA ATÉ: {venc.strftime('%d/%m/%Y')} ({pedido['prazo_dias']} dias)"
    pdf.cell(0, 7, norm(linha_data), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(30, 30, 30)
    pdf.ln(4)

    pdf.set_font("InterTit", "", 13)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 8, "ITENS SOLICITADOS", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_draw_color(*GOLD)
    pdf.set_line_width(1)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.set_draw_color(0, 0, 0)
    pdf.ln(4)

    # Quantidade já sai com a unidade ("10 PCT"), o que libera espaço para a descrição
    col_w = [12, 92, 26, 25, 25]  # total 180mm
    headers = ["ITEM", "DESCRIÇÃO", "QTDE", "VLR UNITÁRIO", "VLR TOTAL"]

    def cabecalho_tabela():
        pdf.set_fill_color(*NAVY)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Inter", "B", 8)
        for h, w in zip(headers, col_w):
            pdf.cell(w, 8, norm(h), border=1, fill=True, align="C")
        pdf.ln()
        pdf.set_font("Inter", "", 9)
        pdf.set_text_color(30, 30, 30)

    cabecalho_tabela()
    LH = 5  # altura de cada linha de texto
    fill = False
    for i, valor in linhas:
        desc = norm(i["descricao"] or "")
        n = max(1, len(pdf.multi_cell(col_w[1] - 2, LH, desc, dry_run=True, output="LINES")))
        h = max(7, n * LH + 2)
        if pdf.get_y() + h > LIMITE_Y:
            pdf.add_page()
            cabecalho_tabela()
        pdf.set_fill_color(246, 248, 252) if fill else pdf.set_fill_color(255, 255, 255)
        x, y = pdf.get_x(), pdf.get_y()
        pdf.cell(col_w[0], h, norm(i["numero_item"] or ""), border=1, fill=True, align="C")
        pdf.rect(x + col_w[0], y, col_w[1], h, "DF")
        pdf.set_xy(x + col_w[0] + 1, y + (h - n * LH) / 2)
        pdf.multi_cell(col_w[1] - 2, LH, desc, border=0, align="L")
        pdf.set_xy(x + col_w[0] + col_w[1], y)
        qtd = fmt_qtd(i["qtde_pedida"]) + (f" {norm(i['und'])}" if i["und"] else "")
        pdf.cell(col_w[2], h, qtd, border=1, fill=True, align="C")
        pdf.cell(col_w[3], h, "R$ " + fmt_br(i["valor_unitario"] or 0), border=1, fill=True, align="R")
        pdf.cell(col_w[4], h, "R$ " + fmt_br(valor), border=1, fill=True, align="R")
        pdf.set_xy(x, y + h)
        fill = not fill

    # Linha de totais da tabela
    if pdf.get_y() + 8 > LIMITE_Y:
        pdf.add_page()
        cabecalho_tabela()
    pdf.set_fill_color(232, 237, 247)
    pdf.set_font("Inter", "B", 9)
    n_itens = len(linhas)
    pdf.cell(sum(col_w[:4]), 8, f"TOTAL  •  {n_itens} {'item' if n_itens == 1 else 'itens'}  ", border=1, fill=True, align="R")
    pdf.cell(col_w[4], 8, "R$ " + fmt_br(valor_total), border=1, fill=True, align="R", new_x="LMARGIN", new_y="NEXT")

    # Valor total em destaque, com o valor por extenso
    extenso = f"({valor_por_extenso(valor_total)})"
    pdf.set_font("Inter", "", 9)
    n_ext = max(1, len(pdf.multi_cell(CONTENT_W - 8, 4.5, extenso, dry_run=True, output="LINES")))
    h_total = 11 + n_ext * 4.5 + 3
    if pdf.get_y() + 4 + h_total > LIMITE_Y:
        pdf.add_page()
    pdf.ln(4)
    y0 = pdf.get_y()
    pdf.set_fill_color(*NAVY)
    pdf.rect(15, y0, CONTENT_W, h_total, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(19, y0 + 2)
    pdf.set_font("InterTit", "", 12)
    pdf.cell(CONTENT_W - 8, 8, f"VALOR TOTAL DO PEDIDO:  R$ {fmt_br(valor_total)}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(19)
    pdf.set_font("Inter", "", 9)
    pdf.set_text_color(*LIGHT)
    pdf.multi_cell(CONTENT_W - 8, 4.5, extenso, align="L")
    pdf.set_y(y0 + h_total)
    pdf.set_text_color(30, 30, 30)

    # Instruções ao fornecedor
    U = UNIDADE_PDF
    ne_txt = norm(empenho["ne"]) if empenho else "-"
    instrucoes = [
        f"A Nota Fiscal deve conter o número da Nota de Empenho ({ne_txt}) e o número deste pedido ({norm(pedido['numero_pedido'])}).",
    ]
    if pedido["prazo_dias"] and parse_data(pedido["data_pedido"]):
        venc = parse_data(pedido["data_pedido"]) + timedelta(days=int(pedido["prazo_dias"]))
        instrucoes.append(f"Prazo de entrega: até {venc.strftime('%d/%m/%Y')} ({pedido['prazo_dias']} dias a contar de {data_br(pedido['data_pedido'])}).")
    instrucoes += [
        f"Local de entrega: {U['nome']} — {U['endereco']}.",
        f"Horário de recebimento: {U['horario']}.",
        f"Contato do {U['setor']}: {U['email']}",
    ]
    if pedido["observacoes"]:
        instrucoes.append(f"Observações: {norm(pedido['observacoes'])}")

    pdf.set_font("Inter", "", 9)
    BW = CONTENT_W - 12  # largura do texto dentro da caixa
    alturas = [max(1, len(pdf.multi_cell(BW, 4.8, t, dry_run=True, output="LINES"))) * 4.8 for t in instrucoes]
    h_instr = 8 + sum(alturas) + 1.2 * len(instrucoes) + 4
    if pdf.get_y() + 8 + h_instr > LIMITE_Y:
        pdf.add_page()
    pdf.ln(5)
    pdf.set_font("InterTit", "", 11)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 6, "INSTRUÇÕES AO FORNECEDOR", new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*GOLD)
    pdf.set_line_width(0.8)
    pdf.line(15, pdf.get_y() + 0.5, 195, pdf.get_y() + 0.5)
    pdf.set_line_width(0.2)
    pdf.ln(3)
    y0 = pdf.get_y()
    caixa_h = sum(alturas) + 1.2 * len(instrucoes) + 3
    pdf.set_fill_color(246, 248, 252)
    pdf.set_draw_color(220, 226, 238)
    pdf.rect(15, y0, CONTENT_W, caixa_h, "DF")
    pdf.set_y(y0 + 2)
    pdf.set_text_color(40, 40, 50)
    for t in instrucoes:
        pdf.set_x(18)
        pdf.set_font("Inter", "B", 9)
        pdf.set_text_color(*GOLD)
        pdf.cell(4, 4.8, "•")
        pdf.set_text_color(40, 40, 50)
        pdf.set_font("Inter", "", 9)
        pdf.multi_cell(BW, 4.8, t, align="L", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1.2)
    pdf.set_y(y0 + caixa_h)
    pdf.set_draw_color(0, 0, 0)

    # Propriedades do arquivo
    pdf.set_title(f"Pedido {norm(pedido['numero_pedido'])} - {ne_txt}")
    pdf.set_author(f"{U['nome']} - {U['setor']}")
    pdf.set_subject("Solicitação de material - pedido de entrega")
    pdf.set_creator("Sistema de Aprovisionamento")

    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    nome = re.sub(r"[^A-Za-z0-9._-]+", "_", f"PEDIDO_{pedido['numero_pedido']}_{ne_txt}").strip("_") + ".pdf"
    return buf, nome


@app.route("/api/pedidos/<int:pid>/pdf", methods=["GET"])
def api_pedido_pdf(pid):
    r = gerar_pdf_pedido(pid)
    if r is None:
        return erro("Pedido não encontrado", 404)
    buf, nome = r
    return send_file(buf, mimetype="application/pdf", as_attachment=True, download_name=nome)


@app.route("/api/pedidos/<int:pid>", methods=["DELETE"])
def api_excluir_pedido(pid):
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    eid = pedido["empenho_id"]
    if _tem_nf_paga(db, "pedido_id", pid):
        return erro("Este pedido tem NF marcada como paga. Desmarque o pagamento da NF antes de excluir o pedido.")
    mandar_para_lixeira(db, "pedido", f"Pedido {pedido['numero_pedido']} com itens e NFs", eid, snapshot(db, pedido_id=pid))
    db.execute("DELETE FROM pedidos WHERE id = ?", (pid,))
    registrar(db, "EXCLUIR", "pedido", pid, eid, f"Pedido {pedido['numero_pedido']} enviado para a lixeira")
    db.commit()
    return jsonify({"ok": True})


# ============================================================================
# RECEBIMENTOS (NFs) — liquidação
# ============================================================================
def _validar_recebimento(db, pid, itens, ignorar_ids=()):
    """Só itens do pedido e até o que falta chegar. Na edição de uma NF, as linhas
    dela (ignorar_ids) não contam como já recebidas."""
    resumo = resumo_pedidos(db, pedido_id=pid).get(pid, {"itens": {}})
    ignorar = {}
    if ignorar_ids:
        for r in db.execute(f"SELECT item_id, qtde_recebida FROM recebimentos WHERE id IN ({_in(ignorar_ids)})",
                            tuple(ignorar_ids)).fetchall():
            ignorar[r["item_id"]] = ignorar.get(r["item_id"], 0.0) + float(r["qtde_recebida"] or 0)
    validos = []
    for it in itens:
        qtde = parse_money(it.get("qtde_recebida"))
        if qtde <= 0 or not it.get("item_id"):
            continue
        item_id = int(it.get("item_id"))
        no_pedido = resumo["itens"].get(item_id)
        item = item_completo(db, item_id)
        nome = nome_item(item) if item else "Item"
        if not item or not no_pedido:
            return None, f"{nome} não faz parte deste pedido"
        devolve = ignorar.get(item_id, 0.0)
        saldo = item["saldo_fisico"] + devolve
        pendente = max(0.0, min(no_pedido["pedida"] - no_pedido["recebida"] + devolve, saldo))
        if qtde > pendente + EPS:
            return None, f"{nome}: recebendo {fmt_qtd(qtde)}, mas só faltam {fmt_qtd(pendente)} neste pedido"
        validos.append((item_id, qtde, float(item["valor_unitario"] or 0)))
    if not validos:
        return None, "Informe ao menos uma quantidade recebida"
    return validos, None


@app.route("/api/pedidos/<int:pid>/receber", methods=["POST"])
def api_receber_pedido(pid):
    """Body: { nf, data_recebimento, observacoes, itens: [{item_id, qtde_recebida}] }"""
    data = request.json or {}
    nf = (data.get("nf") or "").strip()
    data_rec = (data.get("data_recebimento") or "").strip()[:10] or date.today().isoformat()
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    if pedido["encerrado"]:
        return erro("Pedido encerrado. Reabra o pedido para registrar novas entregas.")
    if not nf:
        return erro("Informe o número da NF")
    validos, msg = _validar_recebimento(db, pid, data.get("itens") or [])
    if msg:
        return erro(msg)
    now = agora()
    obs = (data.get("observacoes") or "").strip()
    total_qtd = total_valor = 0.0
    for item_id, qtde, vu in validos:
        db.execute(
            "INSERT INTO recebimentos (empenho_id, pedido_id, item_id, nf, data_recebimento, qtde_recebida, observacoes, criado_em)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (pedido["empenho_id"], pid, item_id, nf, data_rec, qtde, obs, now),
        )
        total_qtd += qtde
        total_valor += qtde * vu
    registrar(db, "RECEBER", "pedido", pid, pedido["empenho_id"],
              f"NF {nf} registrada no pedido {pedido['numero_pedido']} — liquidado {fmt_brl(total_valor)}")
    db.commit()
    return jsonify({"ok": True, "nf": nf, "qtde_total_recebida": total_qtd, "valor": total_valor})


def _ids_da_nf(db, pid, ids):
    ids = [int(x) for x in (ids or []) if str(x).isdigit()]
    if not ids:
        return []
    ok = db.execute(f"SELECT id FROM recebimentos WHERE pedido_id = ? AND id IN ({_in(ids)})", (pid, *ids)).fetchall()
    return [r["id"] for r in ok] if len(ok) == len(ids) else []


@app.route("/api/pedidos/<int:pid>/nfs", methods=["PUT"])
def api_editar_nf(pid):
    """Corrige uma NF já lançada: número, data, observação e quantidades.
    Body: { ids: [...linhas da NF], nf, data_recebimento, observacoes, itens: [...] }"""
    data = request.json or {}
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    ids = _ids_da_nf(db, pid, data.get("ids"))
    if not ids:
        return erro("NF não encontrada neste pedido", 404)
    if db.execute(f"SELECT 1 as x FROM recebimentos WHERE id IN ({_in(ids)}) AND pago_em IS NOT NULL LIMIT 1",
                  tuple(ids)).fetchone():
        return erro("Esta NF está marcada como paga. Desfaça o pagamento antes de corrigi-la.")
    nf = (data.get("nf") or "").strip()
    if not nf:
        return erro("Informe o número da NF")
    validos, msg = _validar_recebimento(db, pid, data.get("itens") or [], ignorar_ids=ids)
    if msg:
        return erro(msg)
    antes = db.execute(
        f"SELECT COALESCE(SUM(r.qtde_recebida * i.valor_unitario),0) as v FROM recebimentos r JOIN itens i ON i.id = r.item_id"
        f" WHERE r.id IN ({_in(ids)})", tuple(ids)).fetchone()["v"]
    depois = sum(q * vu for _, q, vu in validos)
    antiga = db.execute(f"SELECT nf, criado_em FROM recebimentos WHERE id IN ({_in(ids)})", tuple(ids)).fetchone()
    db.execute(f"DELETE FROM recebimentos WHERE id IN ({_in(ids)})", tuple(ids))
    data_rec = (data.get("data_recebimento") or "").strip()[:10] or date.today().isoformat()
    for item_id, qtde, _ in validos:
        db.execute(
            "INSERT INTO recebimentos (empenho_id, pedido_id, item_id, nf, data_recebimento, qtde_recebida, observacoes, criado_em)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (pedido["empenho_id"], pid, item_id, nf, data_rec, qtde, (data.get("observacoes") or "").strip(),
             antiga["criado_em"] or agora()),
        )
    registrar(db, "EDITAR", "nf", pid, pedido["empenho_id"],
              f"NF {antiga['nf']} do pedido {pedido['numero_pedido']} corrigida"
              + (f" (agora NF {nf})" if nf != antiga["nf"] else "")
              + f": liquidado {fmt_brl(antes)} → {fmt_brl(depois)}")
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/pedidos/<int:pid>/nfs/excluir", methods=["POST"])
def api_excluir_nf(pid):
    data = request.json or {}
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    ids = _ids_da_nf(db, pid, data.get("ids"))
    if not ids:
        return erro("NF não encontrada neste pedido", 404)
    if db.execute(f"SELECT 1 as x FROM recebimentos WHERE id IN ({_in(ids)}) AND pago_em IS NOT NULL LIMIT 1",
                  tuple(ids)).fetchone():
        return erro("Esta NF está marcada como paga. Desfaça o pagamento antes de excluí-la.")
    valor = db.execute(
        f"SELECT COALESCE(SUM(r.qtde_recebida * i.valor_unitario),0) as v FROM recebimentos r JOIN itens i ON i.id = r.item_id"
        f" WHERE r.id IN ({_in(ids)})", tuple(ids)).fetchone()["v"]
    nf = db.execute(f"SELECT nf FROM recebimentos WHERE id IN ({_in(ids)})", tuple(ids)).fetchone()["nf"]
    mandar_para_lixeira(db, "nf", f"NF {nf} do pedido {pedido['numero_pedido']} ({fmt_brl(valor)})",
                        pedido["empenho_id"], snapshot(db, recebimento_ids=ids))
    db.execute(f"DELETE FROM recebimentos WHERE id IN ({_in(ids)})", tuple(ids))
    registrar(db, "EXCLUIR", "nf", pid, pedido["empenho_id"],
              f"NF {nf} do pedido {pedido['numero_pedido']} enviada para a lixeira ({fmt_brl(valor)})")
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/pedidos/<int:pid>/nfs/pagar", methods=["POST"])
def api_pagar_nf(pid):
    """Marca (ou desmarca) uma NF como paga. Body: { ids: [...linhas da NF], pago: true|false }"""
    data = request.json or {}
    db = get_db()
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    ids = _ids_da_nf(db, pid, data.get("ids"))
    if not ids:
        return erro("NF não encontrada neste pedido", 404)
    pagar = data.get("pago", True) is not False
    info = db.execute(
        f"SELECT MIN(r.nf) as nf, COALESCE(SUM(r.qtde_recebida * i.valor_unitario),0) as v"
        f" FROM recebimentos r JOIN itens i ON i.id = r.item_id WHERE r.id IN ({_in(ids)})", tuple(ids)).fetchone()
    if pagar:
        db.execute(f"UPDATE recebimentos SET pago_em = ?, pago_por = ? WHERE id IN ({_in(ids)})",
                   (agora(), usuario_atual(), *ids))
        registrar(db, "PAGAR", "nf", pid, pedido["empenho_id"],
                  f"NF {info['nf']} do pedido {pedido['numero_pedido']} marcada como paga ({fmt_brl(info['v'])})")
    else:
        db.execute(f"UPDATE recebimentos SET pago_em = NULL, pago_por = NULL WHERE id IN ({_in(ids)})", tuple(ids))
        registrar(db, "DESFAZER", "nf", pid, pedido["empenho_id"],
                  f"Pagamento da NF {info['nf']} do pedido {pedido['numero_pedido']} desfeito ({fmt_brl(info['v'])})")
    db.commit()
    return jsonify({"ok": True, "nf": info["nf"], "valor": float(info["v"] or 0), "pago": pagar})


# ============================================================================
# PAGAMENTOS (OB) — modo antigo. Mantido só para consultar/excluir o que já
# foi lançado antes de o pagamento passar a ser marcado direto na NF.
# ============================================================================
@app.route("/api/pagamentos/<int:pgid>", methods=["DELETE"])
def api_excluir_pagamento(pgid):
    db = get_db()
    p = db.execute("SELECT * FROM pagamentos WHERE id = ?", (pgid,)).fetchone()
    if not p:
        return erro("Pagamento não encontrado", 404)
    mandar_para_lixeira(db, "pagamento", f"OB {p['ob']} ({fmt_brl(p['valor'])})", p["empenho_id"],
                        snapshot(db, pagamento_id=pgid))
    db.execute("DELETE FROM pagamentos WHERE id = ?", (pgid,))
    registrar(db, "EXCLUIR", "pagamento", pgid, p["empenho_id"], f"OB {p['ob']} enviada para a lixeira")
    db.commit()
    return jsonify({"ok": True})


# ============================================================================
# HISTÓRICO E LIXEIRA
# ============================================================================
@app.route("/api/historico")
def api_historico():
    db = get_db()
    eid = request.args.get("empenho_id", type=int)
    limite = min(request.args.get("limite", default=200, type=int), 1000)
    if eid:
        rows = _linhas(db, "SELECT * FROM auditoria WHERE empenho_id = ? ORDER BY id DESC LIMIT ?", (eid, limite))
    else:
        rows = _linhas(db, "SELECT a.*, e.ne FROM auditoria a LEFT JOIN empenhos e ON e.id = a.empenho_id"
                           " ORDER BY a.id DESC LIMIT ?", (limite,))
    return jsonify(rows)


@app.route("/api/lixeira")
def api_lixeira():
    db = get_db()
    return jsonify(_linhas(db, "SELECT id, quando, usuario, tipo, descricao, empenho_id FROM lixeira"
                               " WHERE restaurado = 0 ORDER BY id DESC LIMIT 300", ()))


@app.route("/api/lixeira/<int:lid>/restaurar", methods=["POST"])
def api_restaurar(lid):
    db = get_db()
    reg = db.execute("SELECT * FROM lixeira WHERE id = ? AND restaurado = 0", (lid,)).fetchone()
    if not reg:
        return erro("Registro não encontrado na lixeira", 404)
    dados = json.loads(reg["dados"])
    restauradas, puladas, mapa = restaurar_snapshot(db, dados)
    if not restauradas:
        db.rollback()
        return erro("Nada pôde ser restaurado: o empenho/pedido ao qual isso pertencia não existe mais. "
                    "Restaure-o primeiro.")
    db.execute("UPDATE lixeira SET restaurado = 1 WHERE id = ?", (lid,))
    novo_eid = mapa["empenhos"].get(reg["empenho_id"], reg["empenho_id"])
    if novo_eid != reg["empenho_id"]:
        # o histórico do empenho acompanha o registro restaurado
        db.execute("UPDATE auditoria SET empenho_id = ? WHERE empenho_id = ?", (novo_eid, reg["empenho_id"]))
        db.execute("UPDATE lixeira SET empenho_id = ? WHERE empenho_id = ? AND restaurado = 0", (novo_eid, reg["empenho_id"]))
    registrar(db, "RESTAURAR", reg["tipo"], None, novo_eid, f"Restaurado da lixeira: {reg['descricao']}"
              + (f" ({puladas} registro(s) não puderam voltar)" if puladas else ""))
    db.commit()
    return jsonify({"ok": True, "restauradas": restauradas, "puladas": puladas, "empenho_id": novo_eid})


# ============================================================================
# INDICADORES, EVOLUÇÃO E EXPORTAÇÃO
# ============================================================================
@app.route("/api/stats_empenhos")
def api_stats_empenhos():
    db = get_db()
    lista = financeiro_empenhos(db)
    tot = len(lista)
    empenhado = sum(e["valor_empenhado"] for e in lista)
    liquidado = sum(e["valor_liquidado"] for e in lista)
    pago = sum(e["valor_pago"] for e in lista)
    itens = db.execute("SELECT COUNT(*) as qtd FROM itens").fetchone()["qtd"]
    pedidos = db.execute("SELECT COUNT(*) as qtd FROM pedidos").fetchone()["qtd"]

    fis = db.execute(
        "SELECT i.qtde_empenhada as emp,"
        " (SELECT COALESCE(SUM(r.qtde_recebida),0) FROM recebimentos r WHERE r.item_id = i.id) as rec"
        " FROM itens i WHERE i.qtde_empenhada > 0"
    ).fetchall()
    itens_com_qtde = len(fis)
    itens_zerados = sum(1 for f in fis if float(f["rec"]) + EPS >= float(f["emp"]))
    percentual_fisico = (
        round(sum(min(1.0, float(f["rec"]) / float(f["emp"])) for f in fis) / itens_com_qtde * 100, 2)
        if itens_com_qtde else 0
    )
    concluidos = sum(1 for e in lista if e["situacao"] == "CONCLUIDO")

    status_pedidos = {"INCLUIDO": 0, "PARCIAL": 0, "RECEBIDO": 0, "ENCERRADO": 0}
    resumo = resumo_pedidos(db)
    for p in resumo.values():
        if p["pedida"] > 0:
            status_pedidos[p["status"]] += 1
    aberto = status_pedidos["INCLUIDO"] + status_pedidos["PARCIAL"]

    atrasados = []
    ids_atraso = [pid for pid, p in resumo.items() if p["atrasado"]]
    if ids_atraso:
        meta = {r["id"]: r for r in db.execute(
            f"SELECT p.id, p.numero_pedido, p.empenho_id, e.ne, e.nome_credor FROM pedidos p"
            f" JOIN empenhos e ON e.id = p.empenho_id WHERE p.id IN ({_in(ids_atraso)})", tuple(ids_atraso)).fetchall()}
        for pid in ids_atraso:
            m = meta.get(pid)
            if m:
                atrasados.append({"pedido_id": pid, "numero_pedido": m["numero_pedido"], "empenho_id": m["empenho_id"],
                                  "ne": m["ne"], "nome_credor": m["nome_credor"],
                                  "vencimento": resumo[pid]["vencimento"], "dias_atraso": resumo[pid]["dias_atraso"],
                                  "status": resumo[pid]["status"]})
        atrasados.sort(key=lambda x: -x["dias_atraso"])

    def pc(a, b):
        return round(a / b * 100, 2) if b else 0

    return jsonify({
        "empenhos": tot, "itens": itens, "pedidos": pedidos,
        "pedidos_em_aberto": aberto,
        "pedidos_atrasados": len(atrasados),
        "pedidos_vencendo": sum(1 for p in resumo.values() if p["vencendo"]),
        "nfs_a_pagar": sum(q for q, _ in nfs_a_pagar_por_empenho(db).values()),
        "lista_atrasados": atrasados[:10],
        "valor_empenhado": empenhado,
        "valor_liquidado": liquidado,
        "valor_pago": pago,
        "valor_a_liquidar": max(0.0, empenhado - liquidado),
        "valor_a_pagar": max(0.0, liquidado - pago),
        "percentual_liquidado": pc(liquidado, empenhado),
        "percentual_pago": pc(pago, empenhado),
        "percentual_fisico": percentual_fisico,
        "itens_com_qtde": itens_com_qtde,
        "itens_zerados": itens_zerados,
        "percentual_itens_zerados": pc(itens_zerados, itens),
        "empenhos_concluidos": concluidos,
        "empenhos_andamento": sum(1 for e in lista if e["situacao"] == "ANDAMENTO"),
        "percentual_concluidos": pc(concluidos, tot),
        "status_pedidos": status_pedidos,
    })


@app.route("/api/evolucao")
def api_evolucao():
    """Liquidado (NFs recebidas) e pago (NFs marcadas como pagas) por mês, nos últimos 12 meses."""
    db = get_db()
    hoje = date.today()
    meses = []
    a, m = hoje.year, hoje.month
    for _ in range(12):
        meses.append(f"{a:04d}-{m:02d}")
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    meses.reverse()
    liq = {k: 0.0 for k in meses}
    pag = {k: 0.0 for k in meses}
    for r in db.execute(
        "SELECT r.data_recebimento as d, r.qtde_recebida * i.valor_unitario as v"
        " FROM recebimentos r JOIN itens i ON i.id = r.item_id WHERE r.data_recebimento >= ?", (meses[0] + "-01",)
    ).fetchall():
        k = (r["d"] or "")[:7]
        if k in liq:
            liq[k] += float(r["v"] or 0)
    for r in db.execute(
        "SELECT r.pago_em as d, r.qtde_recebida * i.valor_unitario as v FROM recebimentos r"
        " JOIN itens i ON i.id = r.item_id WHERE r.pago_em >= ?", (meses[0] + "-01",)
    ).fetchall():
        k = (r["d"] or "")[:7]
        if k in pag:
            pag[k] += float(r["v"] or 0)
    return jsonify([{"mes": k, "liquidado": liq[k], "pago": pag[k]} for k in meses])


@app.route("/api/exportar.xlsx")
def api_exportar():
    """Planilha Excel com a posição completa (empenhos, itens, pedidos, NFs, pagamentos)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    db = get_db()
    MOEDA = '"R$" #,##0.00'
    QTD = "#,##0.###"
    PCT = '0.0"%"'
    wb = Workbook()

    def aba(titulo, cabecalho, linhas, formatos):
        ws = wb.active if wb.active.title == "Sheet" else wb.create_sheet()
        ws.title = titulo
        ws.append(cabecalho)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="1A3373")
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        for ln in linhas:
            ws.append(ln)
        for col, fmt in formatos.items():
            for cell in ws[get_column_letter(col)][1:]:
                cell.number_format = fmt
        for i, h in enumerate(cabecalho, 1):
            larg = max([len(str(h))] + [len(str(ln[i - 1])) for ln in linhas[:300] if ln[i - 1] is not None])
            ws.column_dimensions[get_column_letter(i)].width = min(48, max(10, larg + 2))
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        return ws

    lista = financeiro_empenhos(db)
    sit = {"SEM_ITENS": "Sem itens", "ANDAMENTO": "Em andamento", "CONCLUIDO": "Concluído"}
    aba("Empenhos",
        ["NE", "Fornecedor", "Processo", "Itens (resumo)", "Situação", "Empenhado", "Liquidado", "Pago", "A liquidar", "A pagar", "% Liquidado", "% Pago"],
        [[e["ne"], e["nome_credor"], e["processo"], ", ".join(e["itens_resumo"]), sit[e["situacao"]], e["valor_empenhado"], e["valor_liquidado"],
          e["valor_pago"], e["a_liquidar"], e["a_pagar"], e["percentual_liquidado"], e["percentual_pago"]] for e in lista],
        {6: MOEDA, 7: MOEDA, 8: MOEDA, 9: MOEDA, 10: MOEDA, 11: PCT, 12: PCT})

    nes = {e["id"]: e for e in lista}
    itens = [completar_item(r) for r in db.execute(SQL_ITENS + " ORDER BY i.empenho_id, i.id").fetchall()]
    aba("Itens",
        ["NE", "Fornecedor", "Item", "Descrição", "Und", "Qtde empenhada", "Valor unit.", "Valor total", "Recebido",
         "Saldo físico", "Pedido em aberto", "Saldo a pedir", "Liquidado", "A liquidar"],
        [[nes.get(i["empenho_id"], {}).get("ne"), nes.get(i["empenho_id"], {}).get("nome_credor"), i["numero_item"],
          i["descricao"], i["und"], i["qtde_empenhada"], i["valor_unitario"], i["valor_total"], i["qtde_recebida"],
          i["saldo_fisico"], i["reservado"], i["saldo_a_pedir"], i["liquidado"], i["a_liquidar"]] for i in itens],
        {6: QTD, 7: MOEDA, 8: MOEDA, 9: QTD, 10: QTD, 11: QTD, 12: QTD, 13: MOEDA, 14: MOEDA})

    resumo = resumo_pedidos(db)
    st = {"INCLUIDO": "Em aberto", "PARCIAL": "Parcial", "RECEBIDO": "Recebido", "ENCERRADO": "Encerrado"}
    peds = db.execute("SELECT * FROM pedidos ORDER BY empenho_id, id").fetchall()
    aba("Pedidos",
        ["NE", "Fornecedor", "Pedido", "Data", "Prazo (dias)", "Vencimento", "Status", "Dias de atraso", "Qtde pedida", "Qtde recebida"],
        [[nes.get(p["empenho_id"], {}).get("ne"), nes.get(p["empenho_id"], {}).get("nome_credor"), p["numero_pedido"],
          data_br(p["data_pedido"]), p["prazo_dias"], data_br(resumo[p["id"]]["vencimento"]),
          st[resumo[p["id"]]["status"]], resumo[p["id"]]["dias_atraso"] or None,
          resumo[p["id"]]["pedida"], resumo[p["id"]]["recebida"]] for p in peds],
        {9: QTD, 10: QTD})

    recs = db.execute(
        "SELECT r.*, i.numero_item, i.descricao, i.und, i.valor_unitario, p.numero_pedido FROM recebimentos r"
        " JOIN itens i ON i.id = r.item_id JOIN pedidos p ON p.id = r.pedido_id ORDER BY r.empenho_id, r.data_recebimento, r.id"
    ).fetchall()
    aba("NFs",
        ["NE", "Fornecedor", "Pedido", "NF", "Data", "Item", "Descrição", "Und", "Qtde", "Valor unit.", "Valor",
         "Pagamento", "Paga em", "Marcada por"],
        [[nes.get(r["empenho_id"], {}).get("ne"), nes.get(r["empenho_id"], {}).get("nome_credor"), r["numero_pedido"],
          r["nf"], data_br(r["data_recebimento"]), r["numero_item"], r["descricao"], r["und"], r["qtde_recebida"],
          r["valor_unitario"], float(r["qtde_recebida"] or 0) * float(r["valor_unitario"] or 0),
          "Paga" if r["pago_em"] else "A pagar", data_br(r["pago_em"]) if r["pago_em"] else None, r["pago_por"]]
         for r in recs],
        {9: QTD, 10: MOEDA, 11: MOEDA})

    pags = db.execute("SELECT * FROM pagamentos ORDER BY empenho_id, data_pagamento, id").fetchall()
    if pags:  # só aparece se houver OBs lançadas no modo antigo
        aba("OBs (modo antigo)",
            ["NE", "Fornecedor", "OB", "Data", "Valor", "NF", "Observações"],
            [[nes.get(p["empenho_id"], {}).get("ne"), nes.get(p["empenho_id"], {}).get("nome_credor"), p["ob"],
              data_br(p["data_pagamento"]), p["valor"], p["nf"], p["observacoes"]] for p in pags],
            {5: MOEDA})

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    registrar(db, "EXPORTAR", "planilha", None, None, "Planilha Excel exportada")
    db.commit()
    return send_file(buf, as_attachment=True,
                     download_name=f"aprovisionamento_{date.today().strftime('%Y-%m-%d')}.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")



# ============================================================================
# FORNECEDORES (contato) e ENVIO DO PEDIDO POR E-MAIL
# O texto do e-mail é um modelo fixo preenchido com os dados do pedido.
# ============================================================================
def chave_nome(nome):
    return re.sub(r"\s+", " ", str(nome or "")).strip().upper()


def fornecedor_por_nome(db, nome):
    alvo = chave_nome(nome)
    if not alvo:
        return None
    for f in db.execute("SELECT * FROM fornecedores ORDER BY id").fetchall():
        if chave_nome(f["nome"]) == alvo:
            return dict(f)
    return None


def _so_digitos(v):
    return re.sub(r"\D", "", str(v or ""))


def _dados_fornecedor(data):
    nome = chave_nome(data.get("nome"))
    email = re.sub(r"\s+", "", str(data.get("email") or "")).lower()
    cnpj = (data.get("cnpj") or "").strip()
    if not nome:
        return None, "Informe o nome do fornecedor"
    for e in [x for x in re.split(r"[;,]", email) if x]:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e):
            return None, f"E-mail inválido: {e}"
    if cnpj and len(_so_digitos(cnpj)) not in (11, 14):
        return None, "CNPJ/CPF deve ter 14 (ou 11) dígitos"
    return {
        "nome": nome, "cnpj": cnpj, "email": ", ".join(x for x in re.split(r"[;,]", email) if x),
        "telefone": (data.get("telefone") or "").strip(), "contato": (data.get("contato") or "").strip(),
        "observacoes": (data.get("observacoes") or "").strip(),
    }, None


@app.route("/fornecedores")
def pag_fornecedores():
    return render_template("fornecedores.html")


@app.route("/api/fornecedores")
def api_fornecedores():
    """Fornecedores cadastrados + nomes que só aparecem nos empenhos (ainda sem contato)."""
    db = get_db()
    por_nome = {}
    for f in db.execute("SELECT * FROM fornecedores ORDER BY nome").fetchall():
        d = dict(f)
        d.update(cadastrado=True, empenhos=0, empenhado=0.0, a_liquidar=0.0, pedidos_em_aberto=0)
        por_nome[chave_nome(f["nome"])] = d
    abertos = {}
    resumo = resumo_pedidos(db)
    for p in db.execute("SELECT id, empenho_id FROM pedidos").fetchall():
        if resumo.get(p["id"], {}).get("status") in ("INCLUIDO", "PARCIAL"):
            abertos[p["empenho_id"]] = abertos.get(p["empenho_id"], 0) + 1
    for e in financeiro_empenhos(db):
        k = chave_nome(e["nome_credor"])
        d = por_nome.setdefault(k, {"id": None, "nome": k, "cnpj": "", "email": "", "telefone": "", "contato": "",
                                    "observacoes": "", "cadastrado": False, "empenhos": 0, "empenhado": 0.0,
                                    "a_liquidar": 0.0, "pedidos_em_aberto": 0})
        d["empenhos"] += 1
        d["empenhado"] += e["valor_empenhado"]
        d["a_liquidar"] += e["a_liquidar"]
        d["pedidos_em_aberto"] += abertos.get(e["id"], 0)
    return jsonify(sorted(por_nome.values(), key=lambda d: d["nome"]))


@app.route("/api/fornecedores", methods=["POST"])
def api_criar_fornecedor():
    dados, msg = _dados_fornecedor(request.json or {})
    if msg:
        return erro(msg)
    db = get_db()
    if fornecedor_por_nome(db, dados["nome"]):
        return erro(f"{dados['nome']} já está cadastrado")
    cur = db.execute(
        "INSERT INTO fornecedores (nome, cnpj, email, telefone, contato, observacoes, criado_em) VALUES (?,?,?,?,?,?,?)",
        (dados["nome"], dados["cnpj"], dados["email"], dados["telefone"], dados["contato"], dados["observacoes"], agora()))
    registrar(db, "CRIAR", "fornecedor", cur.lastrowid, None, f"Fornecedor {dados['nome']} cadastrado")
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/fornecedores/<int:fid>", methods=["PUT"])
def api_editar_fornecedor(fid):
    dados, msg = _dados_fornecedor(request.json or {})
    if msg:
        return erro(msg)
    db = get_db()
    f = db.execute("SELECT * FROM fornecedores WHERE id = ?", (fid,)).fetchone()
    if not f:
        return erro("Fornecedor não encontrado", 404)
    outro = fornecedor_por_nome(db, dados["nome"])
    if outro and outro["id"] != fid:
        return erro(f"Já existe outro cadastro com o nome {dados['nome']}")
    db.execute("UPDATE fornecedores SET nome=?, cnpj=?, email=?, telefone=?, contato=?, observacoes=? WHERE id=?",
               (dados["nome"], dados["cnpj"], dados["email"], dados["telefone"], dados["contato"], dados["observacoes"], fid))
    renomeados = 0
    if chave_nome(f["nome"]) != dados["nome"]:
        # Nome corrigido: leva junto os empenhos que usavam o nome antigo
        for e in db.execute("SELECT id, nome_credor FROM empenhos").fetchall():
            if chave_nome(e["nome_credor"]) == chave_nome(f["nome"]):
                db.execute("UPDATE empenhos SET nome_credor = ? WHERE id = ?", (dados["nome"], e["id"]))
                renomeados += 1
    mud = [c for c, k in (("nome", "nome"), ("CNPJ", "cnpj"), ("e-mail", "email"), ("telefone", "telefone"),
                          ("contato", "contato"), ("observações", "observacoes")) if (f[k] or "") != (dados[k] or "")]
    registrar(db, "EDITAR", "fornecedor", fid, None,
              f"Fornecedor {dados['nome']} editado" + (f" ({', '.join(mud)})" if mud else "")
              + (f"; nome atualizado em {renomeados} empenho(s)" if renomeados else ""))
    db.commit()
    return jsonify({"ok": True, "empenhos_renomeados": renomeados})


@app.route("/api/fornecedores/<int:fid>", methods=["DELETE"])
def api_excluir_fornecedor(fid):
    """Apaga só o cadastro (contato). Os empenhos continuam com o nome."""
    db = get_db()
    f = db.execute("SELECT * FROM fornecedores WHERE id = ?", (fid,)).fetchone()
    if not f:
        return erro("Fornecedor não encontrado", 404)
    mandar_para_lixeira(db, "fornecedor", f"Cadastro do fornecedor {f['nome']}", None, snapshot(db, fornecedor_id=fid))
    db.execute("DELETE FROM fornecedores WHERE id = ?", (fid,))
    registrar(db, "EXCLUIR", "fornecedor", fid, None, f"Cadastro do fornecedor {f['nome']} enviado para a lixeira")
    db.commit()
    return jsonify({"ok": True})


def _qtd_txt(v):
    return f"{float(v):,.3f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")


def montar_email_pedido(db, pid):
    """Destinatário, assunto e texto do e-mail do pedido (modelo fixo, sem IA)."""
    pedido = db.execute("SELECT * FROM pedidos WHERE id = ?", (pid,)).fetchone()
    if not pedido:
        return None
    emp = db.execute("SELECT * FROM empenhos WHERE id = ?", (pedido["empenho_id"],)).fetchone()
    forn = fornecedor_por_nome(db, emp["nome_credor"]) or {}
    U = UNIDADE_PDF
    itens = db.execute(
        "SELECT i.numero_item, i.descricao, i.und, pi.qtde_pedida FROM pedido_itens pi JOIN itens i ON i.id = pi.item_id"
        " WHERE pi.pedido_id = ? ORDER BY i.id", (pid,)).fetchall()
    linhas = []
    for i in itens:
        nome = resumo_de_itens([i["descricao"]]) or [i["descricao"]]
        nome = nome[0][:1].upper() + nome[0][1:]
        num = f"Item {i['numero_item']} – " if (i["numero_item"] or "").strip() else ""
        linhas.append(f"  • {num}{nome}: {_qtd_txt(i['qtde_pedida'])} {i['und'] or ''}".rstrip())
    venc = None
    if pedido["prazo_dias"] and parse_data(pedido["data_pedido"]):
        venc = parse_data(pedido["data_pedido"]) + timedelta(days=int(pedido["prazo_dias"]))
    saudacao = f"Prezado(a) {forn['contato']}," if forn.get("contato") else "Prezados(as),"
    proc = f" (Processo {emp['processo']})" if (emp["processo"] or "").strip() else ""
    partes = [
        f"À {emp['nome_credor']}",
        "",
        saudacao,
        "",
        f"Encaminhamos em anexo o Pedido {pedido['numero_pedido']}, referente à Nota de Empenho {emp['ne']}{proc}, "
        f"do {U['nome']}.",
        "",
        "Itens solicitados:",
        *linhas,
        "",
    ]
    if venc:
        partes.append(f"Prazo de entrega: até {venc.strftime('%d/%m/%Y')} ({pedido['prazo_dias']} dias).")
    partes += [
        f"Local de entrega: {U['endereco']}.",
        f"Horário de recebimento: {U['horario']}.",
        "Na entrega, apresentar a nota fiscal com o número da Nota de Empenho e do pedido.",
        "",
        "Pedimos, por gentileza, confirmar o recebimento deste e-mail.",
        "",
        "Atenciosamente,",
        "",
    ]
    nome_usuario = session.get("nome")
    if nome_usuario:
        partes.append(nome_usuario)
    partes += [f"{U['setor']} – {U['nome']}", U["email"]]
    return {
        "para": forn.get("email") or "",
        "fornecedor": emp["nome_credor"],
        "fornecedor_id": forn.get("id"),
        "assunto": f"Pedido {pedido['numero_pedido']} – Nota de Empenho {emp['ne']} – {U['nome']}",
        "corpo": "\n".join(partes),
        "enviado_em": pedido["enviado_em"],
        "enviado_por": pedido["enviado_por"],
    }


@app.route("/api/pedidos/<int:pid>/email")
def api_email_pedido(pid):
    d = montar_email_pedido(get_db(), pid)
    if d is None:
        return erro("Pedido não encontrado", 404)
    return jsonify({"ok": True, **d})


@app.route("/api/pedidos/<int:pid>/email/registrar", methods=["POST"])
def api_registrar_envio(pid):
    """Marca que o e-mail do pedido foi aberto para envio (o envio em si acontece no e-mail)."""
    db = get_db()
    pedido = db.execute("SELECT p.*, e.ne FROM pedidos p JOIN empenhos e ON e.id = p.empenho_id WHERE p.id = ?",
                        (pid,)).fetchone()
    if not pedido:
        return erro("Pedido não encontrado", 404)
    data = request.json or {}
    para = re.sub(r"\s+", "", str(data.get("para") or ""))[:200]
    meio = {"gmail": "Gmail", "eml": "programa de e-mail (com anexo)", "mailto": "programa de e-mail"}.get(data.get("meio"), "e-mail")
    db.execute("UPDATE pedidos SET enviado_em = ?, enviado_por = ? WHERE id = ?", (agora(), usuario_atual(), pid))
    registrar(db, "ENVIAR", "pedido", pid, pedido["empenho_id"],
              f"E-mail do pedido {pedido['numero_pedido']} ({pedido['ne']}) aberto no {meio}" + (f" para {para}" if para else ""))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/pedidos/<int:pid>/email.eml", methods=["POST"])
def api_email_eml(pid):
    """Rascunho .eml com o PDF anexado. Outlook/Thunderbird/Mail abrem pronto para enviar."""
    from email.message import EmailMessage
    from email.utils import formatdate

    db = get_db()
    base = montar_email_pedido(db, pid)
    if base is None:
        return erro("Pedido não encontrado", 404)
    data = request.json or {}
    para = re.sub(r"[\r\n]+", " ", str(data.get("para") if data.get("para") is not None else base["para"])).strip()
    assunto = re.sub(r"[\r\n]+", " ", str(data.get("assunto") or base["assunto"])).strip()
    corpo = str(data.get("corpo") or base["corpo"])
    msg = EmailMessage()
    msg["X-Unsent"] = "1"  # Outlook abre como rascunho, com o botão Enviar
    if para:
        msg["To"] = para
    msg["Subject"] = assunto
    msg["Date"] = formatdate(localtime=True)
    msg.set_content(corpo)
    buf, nome = gerar_pdf_pedido(pid)
    msg.add_attachment(buf.getvalue(), maintype="application", subtype="pdf", filename=nome)
    pedido = db.execute("SELECT numero_pedido FROM pedidos WHERE id = ?", (pid,)).fetchone()
    arquivo = re.sub(r"[^A-Za-z0-9._-]+", "_", f"Email_Pedido_{pedido['numero_pedido']}").strip("_") + ".eml"
    return send_file(io.BytesIO(msg.as_bytes()), mimetype="message/rfc822", as_attachment=True, download_name=arquivo)

# ============================================================================
# IMPORTAÇÃO EM LOTE (planilha Excel) — verifica, mostra a prévia e só grava
# quando confirmado. Tudo ou nada: se algo falhar, nada fica pela metade.
# ============================================================================
@app.route("/importar")
def pag_importar():
    return render_template("importar.html")


@app.route("/api/importar/modelo.xlsx")
def api_modelo_importacao():
    from importacao import montar_planilha
    return send_file(montar_planilha(), as_attachment=True, download_name="modelo_importacao_aprovisionamento.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _resumo_importacao(empenhos):
    out = []
    for e in empenhos:
        vu = {it["numero"]: it["vu"] for it in e["itens"]}
        empenhado = sum(it["qtde"] * it["vu"] for it in e["itens"])
        liquidado = sum(q * vu[k] for p in e["pedidos"] for n in p["nfs"] for k, q in n["itens"].items())
        pedido = sum(q * vu[k] for p in e["pedidos"] for k, q in p["itens"].items())
        out.append({
            "ne": e["ne"], "fornecedor": e["fornecedor"], "processo": e["processo"],
            "itens": len(e["itens"]), "pedidos": len(e["pedidos"]),
            "nfs": sum(len(p["nfs"]) for p in e["pedidos"]),
            "em_aberto": sum(1 for p in e["pedidos"] if not p["nfs"]),
            "empenhado": round(empenhado, 2), "liquidado": round(liquidado, 2),
            "saldo_a_pedir": round(empenhado - pedido, 2),
        })
    return out


@app.route("/api/importar", methods=["POST"])
def api_importar():
    """multipart: arquivo=.xlsx, confirmar=1 para gravar (sem ele, só verifica)."""
    from importacao import ler_planilha

    arq = request.files.get("arquivo")
    if not arq or not arq.filename:
        return erro("Escolha a planilha (.xlsx)")
    conteudo = arq.read()
    if len(conteudo) > 4 * 1024 * 1024:
        return erro("Planilha grande demais (máximo 4 MB)")
    empenhos, erros, avisos = ler_planilha(conteudo, parse_money)
    db = get_db()
    existentes = {normalizar_ne_db(r["ne"]): r["ne"] for r in db.execute("SELECT ne FROM empenhos").fetchall()}
    for e in empenhos:
        if e["ne"] in existentes:
            erros.append(f"Empenho {e['ne']} já está cadastrado no sistema. Tire da planilha ou apague o existente antes.")
    resumo = _resumo_importacao(empenhos)
    if not empenhos and not erros:
        erros.append("A planilha não tem nenhum empenho preenchido.")
    if erros or request.form.get("confirmar") != "1":
        return jsonify({"ok": not erros, "gravado": False, "erros": erros, "avisos": avisos, "empenhos": resumo})

    try:
        for e in empenhos:
            eid = db.execute("INSERT INTO empenhos (ne, processo, nome_credor, criado_em) VALUES (?,?,?,?)",
                             (e["ne"], e["processo"], e["fornecedor"], agora())).lastrowid
            ids = {it["numero"]: _inserir_item(db, eid, it["numero"], it["descricao"], it["und"], it["qtde"], it["vu"])
                   for it in e["itens"]}
            for p in e["pedidos"]:
                pid = db.execute(
                    "INSERT INTO pedidos (empenho_id, numero_pedido, data_pedido, observacoes, criado_em, prazo_dias, encerrado)"
                    " VALUES (?,?,?,?,?,?,0)", (eid, p["numero"], p["data"], p["obs"], agora(), p["prazo"])).lastrowid
                for num, q in p["itens"].items():
                    db.execute("INSERT INTO pedido_itens (pedido_id, item_id, qtde_pedida) VALUES (?,?,?)", (pid, ids[num], q))
                for n in p["nfs"]:
                    for num, q in n["itens"].items():
                        db.execute(
                            "INSERT INTO recebimentos (empenho_id, pedido_id, item_id, nf, data_recebimento, qtde_recebida, observacoes, criado_em)"
                            " VALUES (?,?,?,?,?,?,?,?)", (eid, pid, ids[num], n["nf"], n["data"], q, "", agora()))
            r = next(x for x in resumo if x["ne"] == e["ne"])
            registrar(db, "IMPORTAR", "empenho", eid, eid,
                      f"Empenho {e['ne']} ({e['fornecedor']}) importado da planilha: {r['itens']} item(ns), "
                      f"{r['pedidos']} pedido(s), {r['nfs']} NF(s) — empenhado {fmt_brl(r['empenhado'])}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify({"ok": True, "gravado": True, "erros": [], "avisos": avisos, "empenhos": resumo})


def normalizar_ne_db(ne):
    return re.sub(r"\s+", "", str(ne or "")).upper()


# Cria/atualiza o schema automaticamente (no Vercel o __main__ não roda;
# o app é importado pelo runtime).
try:
    init_db()
except Exception as e:  # banco dormindo no cold start: tenta de novo na próxima
    print("init_db falhou:", e, file=sys.stderr)


if __name__ == "__main__":
    if not APP_PASSWORD:
        print("AVISO: APP_PASSWORD não definida — sistema aberto sem senha (modo local).")
    app.run(debug=True, port=5000, use_reloader=False)
