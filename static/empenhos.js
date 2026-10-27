// Tela de Empenhos (depende de ui.js: fmtMoney, fmtNum, escapeHTML, pct, pctCell, fetchJSON, ordenar...)
let estado = {
    empenhoId: null, itens: [], pedidos: [], empenhos: [], pedidoAtual: null, recebItens: [],
    sortLista: { key: null, dir: 1 }, sortItens: { key: null, dir: 1 }, sortPedidos: { key: null, dir: 1 },
};

const $ = (id) => document.getElementById(id);
const esc = escapeHTML;
const toast = showToast;
const hoje = () => new Date().toISOString().slice(0, 10);
const numBR = (s) => parseFloat(String(s ?? '').trim().replace(/\./g, '').replace(',', '.')) || 0;
const EPS = 1e-9;

// ---------- Modais ----------
function abrirModal(id) {
    $(id).style.display = 'flex';
    const primeiro = $(id).querySelector('input:not([disabled]), select');
    if (primeiro) setTimeout(() => primeiro.focus(), 30);
}
function fecharModal(id) { $(id).style.display = 'none'; }
document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
});
document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => b.closest('.modal').style.display = 'none');
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
});

/** Desabilita o botão enquanto a requisição roda (evita cliques duplos). */
async function comBotao(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); }
    catch (err) { toast(err.message || 'Erro inesperado', 'error'); }
    finally { btn.disabled = false; }
}

// ---------- Carregar lista ----------
async function carregarLista() {
    if (!estado.empenhos.length) $('tbodyEmpenhos').innerHTML = linhaCarregando(8);
    const [empenhos, stats] = await Promise.all([
        fetchJSON('/api/empenhos'),
        fetchJSON('/api/stats_empenhos'),
    ]);
    estado.empenhos = empenhos;
    renderKpis(stats);
    renderLista();
}

function renderKpis(s) {
    $('kpis').innerHTML = `
        <div class="kpi accent"><div class="kpi-label">Empenhos</div><div class="kpi-value">${fmtNum(s.empenhos)}</div><div class="kpi-sub">Cadastrados</div></div>
        <div class="kpi warning"><div class="kpi-label">Itens</div><div class="kpi-value">${fmtNum(s.itens)}</div><div class="kpi-sub">Empenhados</div></div>
        <div class="kpi green"><div class="kpi-label">Empenhado</div><div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div><div class="kpi-sub">${pct(s.percentual_pago)} pago</div></div>
        <div class="kpi red"><div class="kpi-label">A Liquidar</div><div class="kpi-value">${fmtMoney(s.valor_a_liquidar)}</div><div class="kpi-sub">Saldo financeiro</div></div>
        <div class="kpi amber"><div class="kpi-label">Pedidos em Aberto</div><div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div><div class="kpi-sub">Aguardando receb.</div></div>`;
}

function renderLista() {
    const lista = ordenar(estado.empenhos, estado.sortLista.key, estado.sortLista.dir);
    $('tbodyEmpenhos').innerHTML = lista.length ? lista.map(e => `
        <tr>
            <td><strong>${esc(e.ne)}</strong></td>
            <td>${esc(e.nome_credor)}</td>
            <td>${esc(e.processo)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money text-green">${fmtMoney(e.valor_pago)}</td>
            <td class="num money text-red">${fmtMoney(e.a_liquidar)}</td>
            <td>${pctCell(e.percentual_pago)}</td>
            <td class="acoes">
                <button class="btn btn-sm btn-secondary" onclick="abrirDetalhe(${e.id})">Abrir</button>
                <button class="btn btn-sm btn-danger" title="Apagar empenho" aria-label="Apagar empenho ${esc(e.ne)}" onclick="apagarEmpenho(${e.id})">🗑</button>
            </td>
        </tr>`).join('') : `<tr><td colspan="8" class="empty"><span class="empty-icon">📦</span>Nenhum empenho cadastrado ainda.<br>Clique em "＋ Novo Empenho" para começar.</td></tr>`;
    $('countBadge').textContent = `${fmtNum(lista.length)} empenho${lista.length === 1 ? '' : 's'}`;
}

// ---------- Apagar empenho ----------
async function apagarEmpenho(id) {
    const e = estado.empenhos.find(x => x.id === id);
    const ne = e ? e.ne : (estado.empenhoNe || '');
    if (!confirm(`Apagar o empenho ${ne}?\nTodos os itens, pedidos e recebimentos serão removidos.`)) return;
    try {
        const d = await fetchJSON(`/api/empenhos/${id}`, { method: 'DELETE' });
        if (!d.ok) { toast(d.error, 'error'); return; }
        toast(`Empenho ${d.ne} apagado.`, 'success');
        voltarLista();
    } catch (err) { toast(err.message, 'error'); }
}

// ---------- Detalhe do empenho ----------
async function abrirDetalhe(id, { pushUrl = true } = {}) {
    let data;
    try { data = await fetchJSON(`/api/empenhos/${id}`); }
    catch (err) { toast(err.message, 'error'); return; }
    if (!data || !data.empenho) { toast('Empenho não encontrado', 'error'); return; }
    estado.empenhoId = id;
    estado.itens = data.itens;
    estado.pedidos = data.pedidos;
    const e = data.empenho;
    estado.empenhoNe = e.ne;
    const empenhado = data.itens.reduce((a, i) => a + (i.valor_total || 0), 0);
    const pago = data.itens.reduce((a, i) => a + (i.pago || 0), 0);
    $('detTitulo').innerHTML = `Empenho ${esc(e.ne)} — ${esc(e.nome_credor)}`;
    $('detResumo').innerHTML = `
        <span class="chip">Empenhado <strong>${fmtMoney(empenhado)}</strong></span>
        <span class="chip chip-green">Pago <strong>${fmtMoney(pago)}</strong></span>
        <span class="chip chip-red">A liquidar <strong>${fmtMoney(Math.max(0, empenhado - pago))}</strong></span>
        ${e.processo ? `<span class="chip">Processo <strong>${esc(e.processo)}</strong></span>` : ''}`;
    $('secLista').style.display = 'none';
    $('secDetalhe').style.display = 'block';
    renderItens();
    renderPedidos();
    if (pushUrl && new URLSearchParams(location.search).get('id') !== String(id)) {
        history.pushState({ id }, '', `/empenhos?id=${id}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function voltarLista({ pushUrl = true } = {}) {
    estado.empenhoId = null;
    $('detTitulo').textContent = '';
    $('secDetalhe').style.display = 'none';
    $('secLista').style.display = 'block';
    if (pushUrl && location.search) history.pushState({}, '', '/empenhos');
    carregarLista().catch(err => toast(err.message, 'error'));
}

function renderItens() {
    const itens = ordenar(estado.itens, estado.sortItens.key, estado.sortItens.dir);
    $('tbodyItens').innerHTML = itens.length ? itens.map(i => `
        <tr>
            <td>${esc(i.numero_item)}</td>
            <td class="text-left"><strong>${esc(i.descricao)}</strong></td>
            <td>${esc(i.und)}</td>
            <td class="num">${fmtNum(i.qtde_empenhada)}</td>
            <td class="num money">${fmtMoney(i.valor_unitario)}</td>
            <td class="num money">${fmtMoney(i.valor_total)}</td>
            <td class="num">${fmtNum(i.qtde_recebida)}</td>
            <td class="num ${i.saldo_fisico <= 0 ? 'text-green' : 'text-amber'}"><strong>${fmtNum(i.saldo_fisico)}</strong></td>
            <td class="num money text-green">${fmtMoney(i.pago)}</td>
            <td class="num money text-red">${fmtMoney(i.a_liquidar)}</td>
            <td>${pctCell(i.percentual_pago)}</td>
            <td class="acoes">
                <button class="btn btn-sm btn-secondary" title="Editar item" aria-label="Editar item" onclick="editarItem(${i.id})">✏️</button>
                <button class="btn btn-sm btn-danger" title="Excluir item" aria-label="Excluir item" onclick="excluirItem(${i.id})">🗑</button>
            </td>
        </tr>`).join('') : `<tr><td colspan="12" class="empty"><span class="empty-icon">📄</span>Nenhum item. Clique em "＋ Incluir Itens".</td></tr>`;
}

const STATUS_LABEL = { RECEBIDO: 'Recebido', PARCIAL: 'Parcial', INCLUIDO: 'Aguardando' };

function renderPedidos() {
    const pedidos = ordenar(estado.pedidos, estado.sortPedidos.key, estado.sortPedidos.dir);
    $('tbodyPedidos').innerHTML = pedidos.length ? pedidos.map(p => {
        const cls = p.status === 'RECEBIDO' ? 'ok' : p.status === 'PARCIAL' ? 'atencao' : 'info';
        const completo = p.status === 'RECEBIDO';
        return `<tr>
            <td><strong>${esc(p.numero_pedido)}</strong></td>
            <td>${esc(p.data_pedido)}</td>
            <td class="num">${fmtNum(p.qt_itens)}</td>
            <td class="num">${fmtNum(p.qtde_total_pedida)}</td>
            <td class="num">${fmtNum(p.qtde_total_recebida)}</td>
            <td><span class="badge ${cls}">${STATUS_LABEL[p.status] || p.status}</span></td>
            <td class="acoes">
                <button class="btn btn-sm btn-secondary" onclick="baixarPdf(${p.id})" title="Gerar PDF do pedido para o fornecedor">📄 PDF</button>
                ${p.qt_recebimentos > 0 ? `<button class="btn btn-sm btn-secondary" onclick="verNfs(${p.id})" title="Ver notas fiscais do pedido">🧾 NFs</button>` : ''}
                <button class="btn btn-sm ${completo ? 'btn-secondary' : 'btn-primary'}" ${completo ? 'disabled title="Pedido já recebido por completo"' : ''} onclick="abrirRecebimento(${p.id})">📥 Receber</button>
                <button class="btn btn-sm btn-danger" title="Excluir pedido" aria-label="Excluir pedido" onclick="excluirPedido(${p.id})">🗑</button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty"><span class="empty-icon">🧾</span>Nenhum pedido. Clique em "＋ Fazer Pedido".</td></tr>`;
}

// ---------- Ações ----------
async function criarEmpenho() {
    const ne = $('mNe').value.trim(), processo = $('mProcesso').value.trim(), credor = $('mCredor').value.trim();
    if (!ne || !credor) { toast('Preencha NE e Credor', 'error'); return; }
    const d = await fetchJSON('/api/empenhos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ne, processo, nome_credor: credor }),
    });
    if (!d.ok) { toast(d.error, 'error'); return; }
    fecharModal('modalEmpenho');
    $('mNe').value = $('mProcesso').value = $('mCredor').value = '';
    toast(`Empenho criado! Agora inclua os itens.`, 'success');
    await abrirDetalhe(d.id);
    abrirTabelaItens();
}

// ================= TABELINHA DE ITENS (inclusão em lote) =================
function criarLinha(id = null, numero_item = '', descricao = '', und = '', qtde = '', vunit = '') {
    const tr = document.createElement('tr');
    tr.dataset.linhaId = id ?? '';
    tr.innerHTML = `
        <td><input class="inp-item" data-f="numero_item" value="${esc(numero_item)}" placeholder="1" aria-label="Número do item"></td>
        <td><input class="inp-item" data-f="descricao" value="${esc(descricao)}" placeholder="LARANJA" aria-label="Descrição"></td>
        <td><input class="inp-item" data-f="und" value="${esc(und)}" placeholder="CX" aria-label="Unidade"></td>
        <td><input class="inp-item num-input" data-f="qtde_empenhada" value="${esc(qtde)}" inputmode="decimal" aria-label="Quantidade"></td>
        <td><input class="inp-item num-input" data-f="valor_unitario" value="${esc(vunit)}" inputmode="decimal" aria-label="Valor unitário"></td>
        <td><button class="btn btn-sm btn-danger" type="button" aria-label="Remover linha" onclick="removerLinha(this)">✕</button></td>`;
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
        $('itemModalTitulo').textContent = `Editar Item #${editItem.numero_item} — ${editItem.descricao}`;
        $('btnSalvarItem').textContent = 'Salvar Alteração';
        criarLinha(editItem.id, editItem.numero_item, editItem.descricao, editItem.und,
                   String(editItem.qtde_empenhada).replace('.', ','), String(editItem.valor_unitario).replace('.', ','));
        $('btnAddLinha').style.display = 'none';
        $('itemEditHint').textContent = 'Altere os campos e clique em Salvar Alteração.';
    } else {
        $('itemModalTitulo').textContent = 'Incluir Itens';
        $('btnSalvarItem').textContent = 'Salvar Itens';
        $('btnAddLinha').style.display = '';
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
        const it = linhas[0];
        const d = await fetchJSON(`/api/itens/${it.linha_id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                numero_item: it.numero_item, descricao: it.descricao, und: it.und,
                qtde_empenhada: it.qtde_empenhada, valor_unitario: it.valor_unitario,
            }),
        });
        if (!d.ok) { toast(d.error, 'error'); return; }
        fecharModal('modalItem');
        toast(`Item atualizado (total ${fmtMoney(d.valor_total)})`, 'success');
    } else {
        const d = await fetchJSON(`/api/empenhos/${estado.empenhoId}/itens`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itens: linhas }),
        });
        if (!d.ok) { toast(d.error, 'error'); return; }
        fecharModal('modalItem');
        toast(`${d.quantidade} item(ns) incluído(s) — total ${fmtMoney(d.valor_total)}`, 'success');
    }
    abrirDetalhe(estado.empenhoId, { pushUrl: false });
}

async function excluirItem(id) {
    if (!confirm('Excluir este item? Os pedidos/recebimentos ligados a ele também saem.')) return;
    try {
        const d = await fetchJSON(`/api/itens/${id}`, { method: 'DELETE' });
        if (!d.ok) { toast(d.error, 'error'); return; }
        toast('Item excluído', 'success');
        abrirDetalhe(estado.empenhoId, { pushUrl: false });
    } catch (err) { toast(err.message, 'error'); }
}

// ---------- Pedidos ----------
function montarPedItens() {
    const box = $('mPedItens');
    const itens = estado.itens.filter(i => (i.saldo_fisico || 0) > 0);
    box.innerHTML = itens.length ? itens.map(i => `
        <div class="ped-item">
            <label for="ped-${i.id}">${esc(i.numero_item)} • ${esc(i.descricao)} <span class="muted">(saldo ${fmtNum(i.saldo_fisico)} ${esc(i.und)})</span></label>
            <input id="ped-${i.id}" type="number" step="any" min="0" max="${i.saldo_fisico}" placeholder="Qtde pedida" data-item="${i.id}" data-max="${i.saldo_fisico}">
        </div>`).join('') : '<p class="muted">— Todos os itens estão com saldo zerado. —</p>';
    $('btnSalvarPedido').disabled = !itens.length;
}

async function salvarPedido() {
    const inputs = [...document.querySelectorAll('#mPedItens input[data-item]')];
    for (const inp of inputs) {
        const v = parseFloat(inp.value) || 0;
        if (v < 0 || v > parseFloat(inp.dataset.max) + EPS) {
            inp.focus();
            toast(`Quantidade acima do saldo (máx. ${fmtNum(+inp.dataset.max)})`, 'error');
            return;
        }
    }
    const itens = inputs
        .map(inp => ({ item_id: Number(inp.dataset.item), qtde_pedida: parseFloat(inp.value) || 0 }))
        .filter(i => i.qtde_pedida > 0);
    if (!$('mPedNum').value.trim()) { $('mPedNum').focus(); toast('Informe o número do pedido', 'error'); return; }
    if (!itens.length) { toast('Informe a quantidade de pelo menos um item', 'error'); return; }
    const d = await fetchJSON('/api/pedidos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            empenho_id: estado.empenhoId,
            numero_pedido: $('mPedNum').value.trim(),
            data_pedido: $('mPedData').value || hoje(),
            observacoes: $('mPedObs').value.trim(),
            itens,
        }),
    });
    if (!d.ok) { toast(d.error, 'error'); return; }
    fecharModal('modalPedido');
    $('mPedNum').value = $('mPedData').value = $('mPedObs').value = '';
    toast('Pedido registrado', 'success');
    abrirDetalhe(estado.empenhoId, { pushUrl: false });
}

async function excluirPedido(id) {
    if (!confirm('Excluir este pedido? Os recebimentos (NFs) dele também saem.')) return;
    try {
        const d = await fetchJSON(`/api/pedidos/${id}`, { method: 'DELETE' });
        if (!d.ok) { toast(d.error, 'error'); return; }
        toast('Pedido excluído', 'success');
        abrirDetalhe(estado.empenhoId, { pushUrl: false });
    } catch (err) { toast(err.message, 'error'); }
}

// ---------- PDF do pedido ----------
function baixarPdf(id) {
    window.open(`/api/pedidos/${id}/pdf`, '_blank');
}

// ---------- Ver NFs do pedido ----------
async function verNfs(id) {
    let d;
    try { d = await fetchJSON(`/api/pedidos/${id}`); }
    catch (err) { toast(err.message, 'error'); return; }
    if (!d.ok) { toast(d.error, 'error'); return; }

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
// Só lista os itens DO PEDIDO e limita cada um ao que ainda falta chegar
// (pedido − já recebido neste pedido, sem passar do saldo físico do item).
function montarRecebItens(itens) {
    const box = $('rItens');
    const pendentes = itens.filter(i => i.pendente > EPS);
    box.innerHTML = itens.map(i => {
        const fechado = i.pendente <= EPS;
        return `
        <div class="ped-item ${fechado ? 'is-done' : ''}">
            <label for="rec-${i.item_id}">
                ${esc(i.numero_item)} • ${esc(i.descricao)}
                <span class="muted">— pedido ${fmtNum(i.qtde_pedida)} ${esc(i.und)}, já recebido ${fmtNum(i.qtde_recebida)}</span>
            </label>
            ${fechado
                ? '<span class="badge ok">Recebido por completo</span>'
                : `<div class="input-hint">
                       <input id="rec-${i.item_id}" type="number" step="any" min="0" max="${i.pendente}"
                              placeholder="Qtde recebida" data-item="${i.item_id}" data-max="${i.pendente}">
                       <button type="button" class="btn btn-sm btn-secondary" onclick="this.previousElementSibling.value='${i.pendente}'">Tudo (${fmtNum(i.pendente)})</button>
                   </div>`}
        </div>`;
    }).join('');
    $('btnSalvarRecebimento').disabled = !pendentes.length;
    if (!pendentes.length) box.insertAdjacentHTML('afterbegin', '<p class="muted">Todos os itens deste pedido já foram recebidos.</p>');
}

async function abrirRecebimento(pedidoId) {
    let d;
    try { d = await fetchJSON(`/api/pedidos/${pedidoId}`); }
    catch (err) { toast(err.message, 'error'); return; }
    if (!d.ok) { toast(d.error, 'error'); return; }
    $('rPedInfo').innerHTML = `<strong>${esc(d.pedido.numero_pedido)}</strong> — preencha a NF e as quantidades que chegaram.`;
    $('rNf').value = '';
    $('rData').value = hoje();
    estado.pedidoAtual = pedidoId;
    estado.recebItens = d.itens;
    montarRecebItens(d.itens);
    abrirModal('modalReceber');
}

async function salvarRecebimento() {
    const pedidoId = estado.pedidoAtual;
    const nf = $('rNf').value.trim();
    if (!nf) { $('rNf').focus(); toast('Informe o número da NF', 'error'); return; }
    const inputs = [...document.querySelectorAll('#rItens input[data-item]')];
    for (const inp of inputs) {
        const v = parseFloat(inp.value) || 0;
        if (v < 0 || v > parseFloat(inp.dataset.max) + EPS) {
            inp.focus();
            toast(`Quantidade acima do que falta receber (máx. ${fmtNum(+inp.dataset.max)})`, 'error');
            return;
        }
    }
    const itens = inputs
        .map(inp => ({ item_id: Number(inp.dataset.item), qtde_recebida: parseFloat(inp.value) || 0 }))
        .filter(i => i.qtde_recebida > 0);
    if (!itens.length) { toast('Preencha ao menos uma quantidade recebida', 'error'); return; }
    const d = await fetchJSON(`/api/pedidos/${pedidoId}/receber`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nf, data_recebimento: $('rData').value, itens }),
    });
    if (!d.ok) { toast(d.error, 'error'); return; }
    fecharModal('modalReceber');
    toast(`NF ${d.nf} registrada. Saldo atualizado!`, 'success');
    abrirDetalhe(estado.empenhoId, { pushUrl: false });
}

// ---------- Init ----------
function rotaAtual() {
    const id = parseInt(new URLSearchParams(location.search).get('id'), 10);
    if (id) {
        abrirDetalhe(id, { pushUrl: false });
        // KPIs do topo também aparecem quando se abre um empenho direto pelo link
        fetchJSON('/api/stats_empenhos').then(renderKpis).catch(err => toast(err.message, 'error'));
    } else {
        voltarLista({ pushUrl: false });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    $('btnNew').addEventListener('click', () => abrirModal('modalEmpenho'));
    $('btnSalvarEmpenho').addEventListener('click', e => comBotao(e.currentTarget, criarEmpenho));
    $('btnAddItem').addEventListener('click', () => abrirTabelaItens());
    $('btnAddLinha').addEventListener('click', () => criarLinha());
    $('btnSalvarItem').addEventListener('click', e => comBotao(e.currentTarget, salvarItem));
    $('btnNovoPedido').addEventListener('click', () => { montarPedItens(); abrirModal('modalPedido'); });
    $('btnSalvarPedido').addEventListener('click', e => comBotao(e.currentTarget, salvarPedido));
    $('btnSalvarRecebimento').addEventListener('click', e => comBotao(e.currentTarget, salvarRecebimento));
    $('btnVoltar').addEventListener('click', () => voltarLista());
    $('btnExcluirEmpenho').addEventListener('click', () => apagarEmpenho(estado.empenhoId));

    ativarOrdenacao($('tblEmpenhos'), estado.sortLista, renderLista);
    ativarOrdenacao($('tblItens'), estado.sortItens, renderItens);
    ativarOrdenacao($('tblPedidos'), estado.sortPedidos, renderPedidos);

    window.addEventListener('popstate', rotaAtual);
    rotaAtual();
});
