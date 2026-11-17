# Dashboard de Aprovisionamento

Sistema para gestão de **Notas de Empenho (NE)** por item, com acompanhamento de **pedidos**, **recebimentos (NF / liquidação)**, **pagamento por NF** e **saldos** físico e financeiro.

## Requisitos
- Python 3.10+

## Instalação (primeira vez)
```
pip install -r requirements.txt
```

## Senha de acesso
O sistema usa **uma senha única do setor**. Ao entrar, cada pessoa informa o próprio nome, que fica registrado no **histórico de alterações**.

| Variável | Obrigatória | Para quê |
|---|---|---|
| `APP_PASSWORD` | **Sim, em produção** | Senha do setor. Sem ela, o sistema no Vercel fica **bloqueado**. Localmente (SQLite) ele abre sem senha, com um aviso amarelo no topo. |
| `SECRET_KEY` | Recomendada | Chave das sessões. Use um texto longo e aleatório. Sem ela, a chave é derivada da senha, e trocar a senha desconecta todo mundo. |
| `DATABASE_URL` | Em produção | Conexão do PostgreSQL (Neon / Vercel Postgres). |

Para usar senha localmente, antes de rodar: `set APP_PASSWORD=sua_senha` (Windows) ou `export APP_PASSWORD=sua_senha` (Linux/Mac).

Após 5 senhas erradas em 15 minutos, o acesso daquele endereço fica bloqueado por 15 minutos.

## Como usar
1. Dê dois cliques em **`INICIAR.bat`** (abre o servidor e o navegador em `http://localhost:5000`).
2. Em **📦 Empenhos**, cadastre:
   - **Empenho**: número da NE, processo e fornecedor. A lista agrupa os empenhos por fornecedor, com subtotais (dá para desligar em "Agrupar por fornecedor").
   - **Itens**: digite na tabelinha ou **cole direto do Excel** (colunas: Item, Descrição, Und, Qtde, Valor unit.). Também aceita arquivo `.csv`. Valores com vírgula ou ponto (`22,50` ou `22.50`).
   - **Pedido**: itens, quantidades e **prazo de entrega** (padrão 30 dias). O PDF para o fornecedor sai pelo botão 📄.
   - **Recebimento**: NF + quantidades que chegaram. Isso dá baixa no saldo físico e **liquida** o valor.
   - **Pagamento**: no pedido, abra **🧾 NFs** e clique em **✓ Marcar como paga** na NF. O botão fica destacado enquanto houver NF a pagar. Dá para desfazer.
3. **🕘 Histórico** mostra quem fez cada alteração. A aba **Lixeira** permite restaurar exclusões.
4. **⬇ Excel** baixa uma planilha com empenhos, itens, pedidos e NFs (com a situação de pagamento de cada uma).
5. **Tema**: o botão 🖥️/🌙/☀️ no topo alterna entre automático (segue o sistema), escuro e claro. A escolha fica salva no navegador.
6. **Buscar** (ou `Ctrl+K`) no topo acha empenho, fornecedor, pedido, NF ou item de qualquer tela.
7. **Importar → Nota de Empenho (PDF)**: envie um ou vários PDFs da NE (SIAFI). O sistema lê número, processo, fornecedor e itens por regras fixas (sem IA), mostra a prévia e só grava quando você confirma. A NE não traz a unidade: preencha na prévia.
8. **Sugestão de pedido**: ao fazer um pedido, o sistema oferece repetir o último ou usar a média dos últimos, sempre limitado ao saldo.
9. **Relatórios em PDF** (menu do usuário): *Situação dos empenhos* (por fornecedor, com resumo dos itens e barra de liquidado/pago), *Semanal* e *Mensal*.
10. **Pontualidade do fornecedor**: nota de 0 a 10 (% de pedidos entregues no prazo) e prazo médio real de entrega.
11. **Backup** (menu do usuário): baixa um arquivo com tudo e permite restaurar (digitando `RESTAURAR`).

## Enviar o pedido direto pelo sistema (opcional)
Com as variáveis abaixo, o botão **Enviar agora pelo sistema** manda o e-mail com o PDF do pedido anexado. Sem elas, continuam valendo as opções Gmail / Outlook / copiar.

| Variável | Para quê |
|---|---|
| `SMTP_USER` | E-mail remetente (ex.: a conta Gmail do setor). |
| `SMTP_PASSWORD` | **Senha de app** da conta (no Google: Conta → Segurança → Verificação em duas etapas → Senhas de app). Não é a senha normal. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SEGURANCA` | Opcionais. Padrão: `smtp.gmail.com`, `465`, `ssl` (aceita `starttls` ou `nenhuma`). |
| `SMTP_NOME` | Opcional. Nome que aparece como remetente. |

## Atalho para o sistema de Estoque (entrada direta)
Na barra de cima aparece **Estoque**, que abre o outro sistema do setor já com o seu nome, sem digitar a senha de novo.

| Variável (Vercel) | Para quê |
|---|---|
| `ESTOQUE_URL` | Endereço do sistema de Estoque (ex.: `https://gestaoestoque.vercel.app`). Sem ela, o atalho não aparece. |
| `SSO_SECRET` | Chave secreta **igual nos dois sistemas** (no mínimo 16 caracteres, de preferência 40 ou mais, aleatória). Sem ela, o atalho só abre o outro sistema e ele pede a senha. |

O passe de entrada é assinado com essa chave, vale 60 segundos e só pode ser usado uma vez. Trocar a `SSO_SECRET` num sistema sem trocar no outro só desliga a entrada direta.

## Regras do sistema
- **Saldo físico** = qtde empenhada − recebido.
- **Saldo a pedir** = qtde empenhada − recebido − pedido em aberto. Um pedido novo não pode passar dele.
- **Liquidado** = Σ (qtde recebida × valor unitário), vindo das NFs.
- **Pago** = Σ valor das NFs marcadas como pagas.
- **A liquidar** = empenhado − liquidado · **A pagar** = liquidado − pago.
- **Reforço / anulação** (botão ±) altera a quantidade do item e guarda o documento. A anulação vai até o saldo a pedir.
- **Status do pedido**: `Aguardando` → `Parcial` → `Recebido`. **Encerrado** é o pedido fechado manualmente: o que faltava volta ao saldo a pedir.
- **Atrasado** = pedido aguardando ou parcial com a data de entrega (data + prazo) vencida.
- O recebimento aceita só os itens do pedido e até o que falta chegar.
- **Exclusões vão para a lixeira**, com tudo o que saiu junto. NF paga não pode ser corrigida nem excluída (nem o item ou pedido dela, nem o valor unitário do item alterado) até desfazer o pagamento.

## Banco de dados
- **Local (desenvolvimento)**: SQLite em `aprov.db`, usado automaticamente quando `DATABASE_URL` **não** está definida.
- **Vercel (produção)**: **PostgreSQL**, usado quando `DATABASE_URL` está definida (Neon, Vercel Postgres, Supabase).
- As tabelas e colunas novas são **criadas e migradas sozinhas** ao iniciar. Não é preciso rodar nada no banco.

## Deploy no Vercel
1. Importe o repositório em vercel.com (**Import Project**).
2. Em **Storage**, crie o banco (Vercel Postgres ou Neon) para gerar a `DATABASE_URL`.
3. Em **Settings → Environment Variables**, crie `APP_PASSWORD` e `SECRET_KEY`.
4. Clique em **Deploy**.

## Estrutura
```
app.py              # Backend Flask (API, login, histórico, lixeira, PDF, Excel)
nota_empenho.py     # leitura da Nota de Empenho em PDF (regras fixas, sem IA)
relatorios.py       # PDFs de situação dos empenhos e relatório semanal/mensal
static/global.js    # busca geral, relatórios e backup (todas as telas)
templates/          # index (dashboard), empenhos, historico, login, erro, _topbar
static/ui.js        # utilitários comuns (formatação, números pt-BR, ordenação)
static/charts.js    # gráficos em SVG/HTML puro (funcionam offline)
static/app.js       # dashboard
static/empenhos.js  # tela de empenhos
static/historico.js # histórico e lixeira
static/style.css
static/fonts/       # fonte Inter (telas: InterVariable.woff2; PDF: Inter-*.ttf) — licença OFL
static/img/         # folha de acanto (Logística) e brasão do 3º CGEO (PDF)
static/tema.js      # tema claro/escuro
INICIAR.bat         # inicializador local
vercel.json         # configuração de deploy
```
