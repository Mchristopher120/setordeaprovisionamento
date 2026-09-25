let estado = { empenhoId: null, itens: [], pedidos: [], empenhos: [] };

const $ = (id) => document.getElementById(id);
const fmtMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtNum = (v) => new Intl.NumberFormat('pt-BR').format(v ?? 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const hoje = () => new Date().toISOString().slice(0, 10);
const numBR = (s) => parseFloat(String(s ?? '').trim().replace(/\./g, '').replace(',', '.')) || 0;

let toastTimer;
function toast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 3000);
}

// ---------- Modais ----------
function abrirModal(id) { $(id).style.display = 'flex'; }
function fecharModal(id) { $(id).style.display = 'none'; }
document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
});
document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => b.closest('.modal').style.display = 'none');
});

// ---------- Carregar lista ----------
async function carregarLista() {
    const [empenhos, stats] = await Promise.all([
        fetch('/api/empenhos').then(r => r.json()),
        fetch('/api/stats_empenhos').then(r => r.json()),
    ]);
    estado.empenhos = empenhos;
    renderKpis(stats);
    renderLista(empenhos);
}

function renderKpis(s) {
    $('kpis').innerHTML = `
        <div class="kpi accent"><div class="kpi-label">Empenhos</div><div class="kpi-value">${fmtNum(s.empenhos)}</div><div class="kpi-sub">Cadastrados</div></div>
        <div class="kpi warning"><div class="kpi-label">Itens</div><div class="kpi-value">${fmtNum(s.itens)}</div><div class="kpi-sub">Empenhados</div></div>
        <div class="kpi green"><div class="kpi-label">Empenhado</div><div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div><div class="kpi-sub">${s.percentual_pago}% pago</div></div>
        <div class="kpi red"><div class="kpi-label">A Liquidar</div><div class="kpi-value">${fmtMoney(s.valor_a_liquidar)}</div><div class="kpi-sub">Saldo financeiro</div></div>
        <div class="kpi amber"><div class="kpi-label">Pedidos em Aberto</div><div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div><div class="kpi-sub">Aguardando receb.</div></div>`;
}

function renderLista(lista) {
    $('tbodyEmpenhos').innerHTML = lista.length ? lista.map(e => `
        <tr>
            <td><strong>${esc(e.ne)}</strong></td>
            <td>${esc(e.nome_credor)}</td>
            <td>${esc(e.processo)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money" style="color:var(--green)">${fmtMoney(e.valor_pago)}</td>
            <td class="num money" style="color:var(--red)">${fmtMoney(e.a_liquidar)}</td>
            <td class="num">${e.percentual_pago}%</td>
            <td>
                <button class="btn btn-sm" onclick="abrirDetalhe(${e.id})">Abrir</button>
                <button class="btn btn-sm btn-danger" title="Apagar empenho" onclick="apagarEmpenho(${e.id},'${esc(e.ne).replace(/'/g, "\\'")}')">🗑</button>
            </td>
        </tr>`).join('') : `<tr><td colspan="8" class="empty"><span class="empty-icon">📦</span>Nenhum empenho cadastrado ainda.<br>Clique em "＋ Novo Empenho" para começar.</td></tr>`;
    $('countBadge').textContent = `${fmtNum(lista.length)} empenhos`;
}

// ---------- Apagar empenho ----------
async function apagarEmpenho(id, ne) {
    if (!confirm(`Apagar o empenho ${ne}?\nTodos os itens, pedidos e recebimentos serão removidos.`)) return;
    const res = await fetch(`/api/empenhos/${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!d.ok) { toast(d.error, 'error'); return; }
    toast(`Empenho ${d.ne} apagado.`, 'success');
    voltarLista();
}

// ---------- Detalhe do empenho ----------
async function abrirDetalhe(id) {
    const data = await fetch(`/api/empenhos/${id}`).then(r => r.json());
    if (!data.empenho) { toast('Empenho não encontrado', 'error'); return; }
    estado.empenhoId = id;
    estado.itens = data.itens;
    estado.pedidos = data.pedidos;
    const e = data.empenho;
    const empenhado = data.itens.reduce((a, i) => a + (i.valor_total || 0), 0);
    const pago = data.itens.reduce((a, i) => a + (i.pago || 0), 0);
    $('detTitulo').innerHTML = `Empenho ${esc(e.ne)} — ${esc(e.nome_credor)} <span class="count-badge">Empenhado ${fmtMoney(empenhado)} • Pago ${fmtMoney(pago)}</span>`;
    $('secLista').style.display = 'none';
    $('secDetalhe').style.display = 'block';
    renderItens(data.itens);
    renderPedidos(data.pedidos);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function voltarLista() {
    estado.empenhoId = null;
    $('detTitulo').textContent = '';
    $('secDetalhe').style.display = 'none';
    $('secLista').style.display = 'block';
    carregarLista();
}

function renderItens(itens) {
    $('tbodyItens').innerHTML = itens.length ? itens.map(i => `
        <tr>
            <td>${esc(i.numero_item)}</td>
            <td><strong>${esc(i.descricao)}</strong></td>
            <td>${esc(i.und)}</td>
            <td class="num">${fmtNum(i.qtde_empenhada)}</td>
            <td class="num money">${fmtMoney(i.valor_unitario)}</td>
            <td class="num money">${fmtMoney(i.valor_total)}</td>
            <td class="num">${fmtNum(i.qtde_recebida)}</td>
            <td class="num" style="color:${i.saldo_fisico <= 0 ? 'var(--green)' : 'var(--amber)'}"><strong>${fmtNum(i.saldo_fisico)}</strong></td>
            <td class="num money" style="color:var(--green)">${fmtMoney(i.pago)}</td>
            <td class="num money" style="color:var(--red)">${fmtMoney(i.a_liquidar)}</td>
            <td class="num">${i.percentual_pago}%</td>
            <td>
                <button class="btn btn-sm" onclick="editarItem(${i.id})">✏️</button>
                <button class="btn btn-sm" onclick="excluirItem(${i.id})">🗑</button>
            </td>
        </tr>`).join('') : `<tr><td colspan="12" class="empty"><span class="empty-icon">📄</span>Nenhum item. Clique em "＋ Incluir Itens".</td></tr>`;
}

function renderPedidos(pedidos) {
    $('tbodyPedidos').innerHTML = pedidos.length ? pedidos.map(p => {
        const cls = p.status === 'RECEBIDO' ? 'ok' : p.status === 'PARCIAL' ? 'atencao' : 'info';
        return `<tr>
            <td><strong>${esc(p.numero_pedido)}</strong></td>
            <td>${esc(p.data_pedido)}</td>
            <td class="num">${fmtNum(p.qt_itens)}</td>
            <td class="num">${fmtNum(p.qtde_total_pedida)}</td>
            <td class="num">${fmtNum(p.qtde_total_recebida)}</td>
            <td><span class="badge ${cls}">${p.status}</span></td>
            <td>
                <button class="btn btn-sm" onclick="baixarPdf(${p.id})" title="Gerar PDF do pedido para o fornecedor">📄 PDF</button>
                ${p.qt_recebimentos > 0 ? `<button class="btn btn-sm" onclick="verNfs(${p.id})" title="Ver notas fiscais do pedido">🧾 NFs</button>` : ''}
                <button class="btn btn-sm" onclick="abrirRecebimento(${p.id},'${esc(p.numero_pedido).replace(/'/g, "\\'")}')">📥 Receber</button>
                <button class="btn btn-sm" onclick="excluirPedido(${p.id})">🗑</button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty"><span class="empty-icon">🧾</span>Nenhum pedido. Clique em "＋ Fazer Pedido".</td></tr>`;
}

// ---------- Ações ----------
async function criarEmpenho() {
    const ne = $('mNe').value.trim(), processo = $('mProcesso').value.trim(), credor = $('mCredor').value.trim();
    if (!ne || !credor) { toast('Preencha NE e Credor', 'error'); return; }
    const res = await fetch('/api/empenhos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ne, processo, nome_credor: credor }),
    });
    const d = await res.json();
    if (!d.ok) { toast(d.error, 'error'); return; }
    fecharModal('modalEmpenho');
    $('mNe').value = $('mProcesso').value = $('mCredor').value = '';
    toast(`Empenho criado! Agora inclua os itens.`, 'success');
    await abrirDetalhe(d.id);
    abrirTabelaItens();
}

// ================= TABELINHA DE ITENS (inclusão em lote) =================
let itemLinhas = [];

function criarLinha(id = null, numero_item = '', descricao = '', und = '', qtde = '', vunit = '') {
    const tr = document.createElement('tr');
    tr.dataset.linhaId = id ?? '';
    tr.innerHTML = `
        <td><input class="inp-item" data-f="numero_item" value="${esc(numero_item)}" placeholder="1"></td>
        <td><input class="inp-item" data-f="descricao" value="${esc(descricao)}" placeholder="LARANJA"></td>
        <td><input class="inp-item" data-f="und" value="${esc(und)}" placeholder="CX"></td>
        <td><input class="inp-item num-input" data-f="qtde_empenhada" value="${esc(qtde)}" inputmode="decimal"></td>
        <td><input class="inp-item num-input" data-f="valor_unitario" value="${esc(vunit)}" inputmode="decimal"></td>
        <td><button class="btn btn-sm btn-danger" type="button" onclick="removerLinha(this)">✕</button></td>`;
    tr.querySelectorAll('.num-input').forEach(inp => inp.addEventListener('input', recalcularTotalItens));
    $('tbodyItemEdit').appendChild(tr);
    recalcularTotalItens();
}

function removerLinha(btn) {
    btn.closest('tr').remove();
    recalcularTotalItens();
}

function recalcularTotalItens() {
    let total = 0;
    document.querySelectorAll('#tbodyItemEdit tr').forEach(tr => {
        const q = numBR(tr.querySelector('[data-f="qtde_empenhada"]').value);
        const v = numBR(tr.querySelector('[data-f="valor_unitario"]').value);
        total += q * v;
    });
    $('itemTotal').textContent = fmtMoney(total);
}

function lerLinhas() {
    const itens = [];
    document.querySelectorAll('#tbodyItemEdit tr').forEach(tr => {
        const get = (f) => tr.querySelector(`[data-f="${f}"]`).value.trim();
        const descricao = get('descricao');
        if (!descricao) return;
        itens.push({
            linha_id: tr.dataset.linhaId || null,
            numero_item: get('numero_item'),
            descricao,
            und: get('und'),
            qtde_empenhada: numBR(get('qtde_empenhada')),
            valor_unitario: numBR(get('valor_unitario')),
        });
    });
    return itens;
}

function abrirTabelaItens(editItem = null) {
    $('tbodyItemEdit').innerHTML = '';
    if (editItem) {
        // Modo edição: 1 linha com os dados do item, título de edição
        $('itemModalTitulo').textContent = `Editar Item #${editItem.numero_item} — ${editItem.descricao}`;
        $('btnSalvarItem').textContent = 'Salvar Alteração';
        criarLinha(editItem.id, editItem.numero_item, editItem.descricao, editItem.und,
                   editItem.qtde_empenhada, String(editItem.valor_unitario).replace('.', ','));
        $('itemEditHint').textContent = 'Altere os campos e clique em Salvar Alteração.';
    } else {
        $('itemModalTitulo').textContent = 'Incluir Itens';
        $('btnSalvarItem').textContent = 'Salvar Itens';
        $('itemEditHint').textContent = 'Preencha cada linha e clique em Salvar. Linhas em branco são ignoradas.';
        criarLinha();
        criarLinha();
    }
    abrirModal('modalItem');
}

function editarItem(id) {
    const item = estado.itens.find(i => i.id === id);
    if (!item) { toast('Item não encontrado', 'error'); return; }
    abrirTabelaItens(item);
}

async function salvarItem() {
    const linhas = lerLinhas();
    if (!linhas.length) { toast('Informe ao menos um item com descrição', 'error'); return; }

    const edicao = linhas.length === 1 && linhas[0].linha_id;
    if (edicao) {
        // Edição de item existente -> PUT
        const it = linhas[0];
        const res = await fetch(`/api/itens/${it.linha_id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                numero_item: it.numero_item, descricao: it.descricao, und: it.und,
                qtde_empenhada: it.qtde_empenhada, valor_unitario: it.valor_unitario,
            }),
        });
        const d = await res.json();
        if (!d.ok) { toast(d.error, 'error'); return; }
        fecharModal('modalItem');
        toast(`Item atualizado (total ${fmtMoney(d.valor_total)})`, 'success');
    } else {
        // Inclusão em lote -> POST /api/empenhos/<eid>/itens
        const res = await fetch(`/api/empenhos/${estado.empenhoId}/itens`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itens: linhas }),
        });
        const d = await res.json();
        if (!d.ok) { toast(d.error, 'error'); return; }
        fecharModal('modalItem');
        toast(`${d.quantidade} item(ns) incluído(s) — total ${fmtMoney(d.valor_total)}`, 'success');
    }
    abrirDetalhe(estado.empenhoId);
}

async function excluirItem(id) {
    if (!confirm('Excluir este item? Os pedidos/recebimentos ligados a ele também saem.')) return;
    const res = await fetch(`/api/itens/${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!d.ok) { toast(d.error, 'error'); return; }
    toast('Item excluído', 'success');
    abrirDetalhe(estado.empenhoId);
}

// ---------- Pedidos ----------
function montarPedItens() {
    const box = $('mPedItens');
    const itens = estado.itens.filter(i => (i.saldo_fisico || 0) > 0);
    box.innerHTML = itens.length ? itens.map(i => `
        <div class="ped-item">
            <label>${esc(i.numero_item)} • ${esc(i.descricao)} (saldo ${fmtNum(i.saldo_fisico)})</label>
            <input type="number" step="any" min="0" max="${i.saldo_fisico}" placeholder="Qtde pedida" data-item="${i.id}">
        </div>`).join('') : '<p class="muted">— Todos os itens estão com saldo zerado. —</p>';
}

async function salvarPedido() {
    const itens = [...document.querySelectorAll('#mPedItens input[data-item]')]
        .map(inp => ({ item_id: Number(inp.dataset.item), qtde_pedida: parseFloat(inp.value) || 0 }))
        .filter(i => i.qtde_pedida > 0);
    const res = await fetch('/api/pedidos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            empenho_id: estado.empenhoId,
            numero_pedido: $('mPedNum').value.trim(),
            data_pedido: $('mPedData').value || hoje(),
            observacoes: $('mPedObs').value.trim(),
            itens,
        }),
    });
    const d = await res.json();
    if (!d.ok) { toast(d.error, 'error'); return; }
    fecharModal('modalPedido');
    $('mPedNum').value = $('mPedData').value = $('mPedObs').value = '';
    toast('Pedido registrado', 'success');
    abrirDetalhe(estado.empenhoId);
}

async function excluirPedido(id) {
    if (!confirm('Excluir este pedido?')) return;
    const res = await fetch(`/api/pedidos/${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!d.ok) { toast(d.error, 'error'); return; }
    toast('Pedido excluído', 'success');
    abrirDetalhe(estado.empenhoId);
}

// ---------- PDF do pedido ----------
function baixarPdf(id) {
    window.open(`/api/pedidos/${id}/pdf`, '_blank');
}

// ---------- Ver NFs do pedido ----------
async function verNfs(id) {
    const res = await fetch(`/api/pedidos/${id}`);
    const d = await res.json();
    if (!d.ok) { toast(d.error, 'error'); return; }
    estado.pedidoAtual = id;

    const info = d.pedido;
    $('nfPedidoInfo').innerHTML = `
        <strong>Pedido ${esc(info.numero_pedido)}</strong> •
        Empenho ${esc(d.empenho ? d.empenho.ne : '—')} •
        ${esc(d.empenho ? d.empenho.nome_credor : '—')}`;

    const nfs = d.recebimentos;
    $('nfCorpo').innerHTML = nfs.length ? nfs.map(nf => `
        <div class="nf-card">
            <div class="nf-head">
                <span style="font-size:18px">🧾</span>
                <div>
                    <strong>NF ${esc(nf.nf)}</strong>
                    <span class="muted"> • ${esc(nf.data_recebimento || '—')}</span>
                </div>
            </div>
            ${nf.observacoes ? `<div class="muted" style="font-size:12px">Obs.: ${esc(nf.observacoes)}</div>` : ''}
            <table class="nf-table">
                <thead><tr><th>Item</th><th>Descrição</th><th>Und</th><th class="num">Qtde</th></tr></thead>
                <tbody>
                    ${nf.itens.map(i => `
                        <tr>
                            <td>${esc(i.numero_item)}</td>
                            <td>${esc(i.descricao)}</td>
                            <td>${esc(i.und)}</td>
                            <td class="num">${fmtNum(i.qtde_recebida)}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`).join('') : '<p class="muted">Nenhuma NF registrada para este pedido.</p>';

    abrirModal('modalNfs');
}

// ---------- Recebimento ----------
function montarRecebItens() {
    const box = $('rItens');
    box.innerHTML = estado.itens.map(i => `
        <div class="ped-item">
            <label>${esc(i.numero_item)} • ${esc(i.descricao)} (saldo ${fmtNum(i.saldo_fisico)})</label>
            <input type="number" step="any" min="0" max="${i.qtde_empenhada || 0}" placeholder="Qtde recebida" data-item="${i.id}">
        </div>`).join('');
}

function abrirRecebimento(pedidoId, num) {
    $('rPedInfo').innerHTML = `<strong>${esc(num)}</strong> — preencha a NF e as quantidades que chegaram.`;
    $('rNf').value = '';
    $('rData').value = hoje();
    estado.pedidoAtual = pedidoId;
    montarRecebItens();
    abrirModal('modalReceber');
}

async function salvarRecebimento() {
    const pedidoId = estado.pedidoAtual;
    const itens = [...document.querySelectorAll('#rItens input[data-item]')]
        .map(inp => ({ item_id: Number(inp.dataset.item), qtde_recebida: parseFloat(inp.value) || 0 }))
        .filter(i => i.qtde_recebida > 0);
    if (!itens.length) { toast('Preencha ao menos uma quantidade recebida', 'error'); return; }
    const res = await fetch(`/api/pedidos/${pedidoId}/receber`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nf: $('rNf').value.trim(), data_recebimento: $('rData').value, itens }),
    });
    const d = await res.json();
    if (!d.ok) { toast(d.error, 'error'); return; }
    fecharModal('modalReceber');
    toast(`NF ${d.nf} registrada. Saldo atualizado!`, 'success');
    abrirDetalhe(estado.empenhoId);
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
    $('btnNew').addEventListener('click', () => abrirModal('modalEmpenho'));
    $('btnSalvarEmpenho').addEventListener('click', criarEmpenho);
    $('btnAddItem').addEventListener('click', () => abrirTabelaItens());
    $('btnAddLinha').addEventListener('click', () => criarLinha());
    $('btnSalvarItem').addEventListener('click', salvarItem);
    $('btnNovoPedido').addEventListener('click', () => { montarPedItens(); abrirModal('modalPedido'); });
    $('btnSalvarPedido').addEventListener('click', salvarPedido);
    $('btnSalvarRecebimento').addEventListener('click', salvarRecebimento);
    $('btnVoltar').addEventListener('click', voltarLista);
    $('btnExcluirEmpenho').addEventListener('click', () => {
        const e = estado.empenhos.find(x => x.id === estado.empenhoId);
        apagarEmpenho(estado.empenhoId, e ? e.ne : '');
    });
    carregarLista().catch(() => toast('Erro ao carregar empenhos', 'error'));
});