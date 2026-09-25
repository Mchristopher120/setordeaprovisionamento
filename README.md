# Dashboard de Aprovisionamento

Sistema local para gestão de **Notas de Empenho (NE)** por item, com acompanhamento de **pedidos**, **recebimentos (NF)** e **saldos** (físico e financeiro).

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

## Regras do sistema
- **Saldo físico** = qtde empenhada − Σ qtde recebida (baixa somente ao registrar recebimento com NF).
- **Pago** = Σ (qtde recebida × valor unitário) — vem dos recebimentos.
- **A liquidar** = valor total do item − pago.
- Status do pedido: `INCLUIDO` → `PARCIAL` → `RECEBIDO`.

## Funcionalidades
- **Cadastro de empenhos** por item, com múltiplos itens por empenho.
- **Pedidos** parciais por item e **recebimentos** com número de NF e data.
- **KPIs**: empenhos, itens, pedidos e pedidos em aberto.
- **Dashboard (linha antiga)**: ainda disponível em `/` para consulta de contratos via **Importar CSV** (formato abaixo).

## Estrutura
```
dashboard_aprov/
  app.py           # Backend Flask + SQLite (API + banco)
  templates/       # index.html e empenhos.html
  static/          # style.css + app.js + empenhos.js
  aprov.db         # Banco SQLite (criado automaticamente)
  exemplo.csv      # Modelo do formato CSV (dashboard antigo)
  INICIAR.bat      # Inicializador
```

## Colunas esperadas no CSV (dashboard antigo)
`NE | NOME CREDOR | DIAS | A LIQUIDAR | PAGO | OBSERVAÇÕES | SITUAÇÃO`

Valores em moeda podem vir em formato pt-BR (`1.234,56`), US (`1234.56`) ou com "R$".