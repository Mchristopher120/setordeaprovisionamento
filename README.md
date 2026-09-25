# Dashboard de Aprovisionamento

Sistema para gestão de **Notas de Empenho (NE)** por item, com acompanhamento de **pedidos**, **recebimentos (NF)** e **saldos** (físico e financeiro).

## Requisitos
- Python 3.10+

## Instalação (primeira vez)
```
pip install -r requirements.txt
```

## Como usar
1. Dê dois cliques em **`INICIAR.bat`** (abre o servidor e o navegador em `http://localhost:5000`).
2. Acesse **📦 Empenhos** no topo e cadastre:
   - **Empenho**: número da NE, processo e credor.
   - **Itens**: descrição, und, quantidade empenhada e valor unitário (o total e o saldo calculam automaticamente).
   - **Pedido**: escolha os itens e as quantidades solicitadas.
   - **Recebimento**: informe a NF e as quantidades recebidas — só aqui o **saldo físico** e o valor **pago** diminuem/aumentam.

## Banco de dados
- **Local (desenvolvimento)**: SQLite em `aprov.db` — usado automaticamente quando a variável `DATABASE_URL` **não** está definida.
- **Vercel (produção)**: **PostgreSQL** — usado automaticamente quando `DATABASE_URL` está definida (ex.: Vercel Postgres, Neon, Supabase). O schema é criado sozinho na inicialização.

## Deploy no Vercel
1. Suba o projeto para o GitHub (já está em `https://github.com/Mchristopher120/setordeaprovisionamento`).
2. Crie uma conta em vercel.com e **Import Project** a partir do repositório.
3. Na aba **Storage** do projeto, crie um banco **Vercel Postgres** (ou adicione um Postgres externo/Neon).
4. No projeto, adicione a variável de ambiente `DATABASE_URL` com a connection string do banco (o Vercel oferece esse valor ao criar o banco).
5. Clique em **Deploy**. As tabelas são criadas automaticamente no primeiro boot.

Obs.: o SQLite local (`aprov.db`) não é usado no Vercel — o preview/banco de produção usa sempre o PostgreSQL.

## Regras do sistema
- **Saldo físico** = qtde empenhada − Σ qtde recebida (baixa somente ao registrar recebimento com NF).
- **Pago** = Σ (qtde recebida × valor unitário) — vem dos recebimentos.
- **A liquidar** = valor total do item − pago.
- Status do pedido: `INCLUIDO` → `PARCIAL` → `RECEBIDO`.

## Funcionalidades
- **Cadastro de empenhos** por item, com múltiplos itens por empenho.
- **Pedidos** parciais por item e **recebimentos** com número de NF e data.
- **PDF do pedido** gerado automaticamente para envio ao fornecedor.
- **KPIs**: empenhos, itens, pedidos e pedidos em aberto.
- **Dashboard (linha antiga)**: ainda disponível em `/` para consulta de contratos via **Importar CSV** (formato abaixo).

## Estrutura
```
dashboard_aprov/
  app.py           # Backend Flask (API + banco: SQLite local / PostgreSQL no Vercel)
  templates/       # index.html e empenhos.html
  static/          # style.css + app.js + empenhos.js
  static/fonts/    # Fontes do PDF (DejaVu Sans — compatível com Vercel)
  aprov.db         # Banco SQLite local (criado automaticamente)
  exemplo.csv      # Modelo do formato CSV (dashboard antigo)
  INICIAR.bat      # Inicializador local
  vercel.json      # Configuração de deploy no Vercel
```

## Colunas esperadas no CSV (dashboard antigo)
`NE | NOME CREDOR | DIAS | A LIQUIDAR | PAGO | OBSERVAÇÕES | SITUAÇÃO`

Valores em moeda podem vir em formato pt-BR (`1.234,56`), US (`1234.56`) ou com "R$".