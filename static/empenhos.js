// Tela de Empenhos (depende de ui.js)
const estado = {
    empenhoId: null, empenhoAtual: null, itens: [], pedidos: [], obsAntigas: [], movimentos: [], financeiro: {},
    gruposFechados: new Set(),
    empenhos: [], pedidoAtual: null, pedidoEditando: null, nfEditando: null, itemMov: null, empenhoEditando: null,
    sortLista: { key: null, dir: 1 }, sortItens: { key: null, dir: 1 }, sortPedidos: { key: null, dir: 1 },
};

const $ = (id) => document.getElementById(id);
const esc = escapeHTML;
const toast = showToast;
const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EPS = 1e-9;

// ---------- Modais ----------
function abrirModal(id) {
    $(id).style.display = 'flex';
    const primeiro = $(id).querySelector('input:not([disabled]):not([type=radio]):not([type=file]), textarea');
    if (primeiro) setTimeout(() => primeiro.focus(), 30);
}
function fecharModal(id) { $(id).style.display = 'none'; }
document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) m.style.display = 'none'; });
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

/** Executa uma ação da API, mostra o erro ou a mensagem de sucesso e recarrega o detalhe. */
async function acao(promessa, sucesso, { recarregar = true } = {}) {
    try {
        const d = await promessa;
        if (!d || !d.ok) { toast((d && d.error) || 'Não foi possível concluir', 'error'); return null; }
        if (sucesso) toast(sucesso, 'success');
        if (recarregar && estado.empenhoId) await abrirDetalhe(estado.empenhoId, { pushUrl: false, rolar: false });
        return d;
    } catch (err) { toast(err.message, 'error'); return null; }
}

// =====================================================================
// LISTA
// =====================================================================
async function carregarLista() {
    if (!estado.empenhos.length) $('tbodyEmpenhos').innerHTML = linhaCarregando(9);
    const [empenhos, stats] = await Promise.all([
        fetchJSON('/api/empenhos'),
        fetchJSON('/api/stats_empenhos'),
    ]);
    estado.empenhos = empenhos;
    renderKpis(stats);
    preencherAnos();
    renderLista();
}

function renderKpis(s) {
    $('kpis').innerHTML = `
        <div class="kpi accent"><div class="kpi-label">Empenhos</div><div class="kpi-value">${fmtNum(s.empenhos)}</div><div class="kpi-sub">${fmtNum(s.itens)} itens</div></div>
        <div class="kpi slate"><div class="kpi-label">Empenhado</div><div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div><div class="kpi-sub">A liquidar ${fmtMoneyCurto(s.valor_a_liquidar)}</div></div>
        <div class="kpi teal"><div class="kpi-label">Liquidado</div><div class="kpi-value">${fmtMoney(s.valor_liquidado)}</div><div class="kpi-sub">${pct(s.percentual_liquidado)} do empenhado</div></div>
        <div class="kpi green"><div class="kpi-label">Pago</div><div class="kpi-value">${fmtMoney(s.valor_pago)}</div><div class="kpi-sub">A pagar ${fmtMoneyCurto(s.valor_a_pagar)}</div></div>
        <div class="kpi amber"><div class="kpi-label">Pedidos em Aberto</div><div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div>
            <div class="kpi-sub">${s.pedidos_atrasados ? `<span class="text-red"><strong>${fmtNum(s.pedidos_atrasados)}</strong> atrasado(s)</span>` : 'nenhum atrasado'}</div></div>`;
    // A fonte Inter pode demorar um instante; ajusta de novo quando ela terminar de carregar
    ajustarValores(document.getElementById('kpis'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ajustarValores(document.getElementById('kpis')));
}

function preencherAnos() {
    const sel = $('fAno'), atual = sel.value;
    const anos = [...new Set(estado.empenhos.map(e => e.ano).filter(Boolean))].sort().reverse();
    sel.innerHTML = '<option value="">Todos os anos</option>' + anos.map(a => `<option ${a === atual ? 'selected' : ''}>${esc(a)}</option>`).join('');
    const sf = $('fFornecedor'), atualF = sf.value;
    const forn = [...new Set(estado.empenhos.map(e => e.nome_credor).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    sf.innerHTML = '<option value="">Todos os fornecedores</option>' +
        forn.map(f => `<option ${f === atualF ? 'selected' : ''}>${esc(f)}</option>`).join('');
}

function filtrar(lista) {
    const busca = normalizar($('fBusca').value.trim());
    const sit = $('fSituacao').value, ano = $('fAno').value, saldo = $('fSaldo').checked, forn = $('fFornecedor').value;
    $('btnLimparFiltros').hidden = !(busca || sit || ano || saldo || forn);
    return lista.filter(e => {
        if (busca && !normalizar(`${e.ne} ${e.nome_credor} ${e.processo}`).includes(busca)) return false;
        if (sit === 'ATRASO' ? !e.pedidos_atrasados : (sit && e.situacao !== sit)) return false;
        if (ano && e.ano !== ano) return false;
        if (forn && e.nome_credor !== forn) return false;
        if (saldo && !(e.a_liquidar > 0.005)) return false;
        return true;
    });
}

const SITUACAO = { ANDAMENTO: ['Em andamento', 'info'], CONCLUIDO: ['Concluído', 'ok'], SEM_ITENS: ['Sem itens', 'neutro'] };

function linhaEmpenho(e) {
    const [rot, cls] = SITUACAO[e.situacao] || ['', ''];
    return `
        <tr>
            <td class="text-left"><strong>${esc(e.ne)}</strong>
                <div class="cell-badges"><span class="badge ${cls}">${rot}</span>
                ${e.pedidos_atrasados ? `<span class="badge critico" title="Pedidos com entrega vencida">⏰ ${e.pedidos_atrasados} atrasado${e.pedidos_atrasados > 1 ? 's' : ''}</span>` : ''}</div></td>
            <td class="col-forn">${esc(e.nome_credor)}</td>
            <td>${esc(e.processo)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money text-teal">${fmtMoney(e.valor_liquidado)}</td>
            <td class="num money text-green">${fmtMoney(e.valor_pago)}</td>
            <td class="num money text-red">${fmtMoney(e.a_liquidar)}</td>
            <td>${pctCell(e.percentual_liquidado)}</td>
            <td class="acoes">
                <button class="btn btn-sm btn-secondary" onclick="abrirDetalhe(${e.id})">Abrir</button>
                <button class="btn btn-sm btn-danger" title="Apagar empenho" aria-label="Apagar empenho ${esc(e.ne)}" onclick="apagarEmpenho(${e.id})">🗑</button>
            </td>
        </tr>`;
}

/** Linha-título de um fornecedor, com os totais dos empenhos dele (clique para recolher). */
function linhaFornecedor(nome, lista, fechado) {
    const soma = (k) => lista.reduce((a, e) => a + (e[k] || 0), 0);
    const emp = soma('valor_empenhado'), liq = soma('valor_liquidado');
    const atrasos = soma('pedidos_atrasados');
    return `
        <tr class="grupo-row ${fechado ? 'fechado' : ''}" data-grupo="${esc(nome)}" tabindex="0" aria-expanded="${!fechado}"
            title="${fechado ? 'Mostrar' : 'Recolher'} os empenhos deste fornecedor">
            <td colspan="2" class="text-left">
                <span class="grupo-seta" aria-hidden="true">▾</span>
                <strong>${esc(nome)}</strong>
                <span class="grupo-qtd">${fmtNum(lista.length)} empenho${lista.length > 1 ? 's' : ''}</span>
                ${atrasos ? `<span class="badge critico">⏰ ${fmtNum(atrasos)}</span>` : ''}
            </td>
            <td class="num money">${fmtMoney(emp)}</td>
            <td class="num money text-teal">${fmtMoney(liq)}</td>
            <td class="num money text-green">${fmtMoney(soma('valor_pago'))}</td>
            <td class="num money text-red">${fmtMoney(soma('a_liquidar'))}</td>
            <td>${pctCell(emp ? liq / emp * 100 : 0)}</td>
            <td></td>
        </tr>`;
}

function renderLista() {
    const todos = estado.empenhos;
    const lista = ordenar(filtrar(todos), estado.sortLista.key, estado.sortLista.dir);
    const agrupar = $('fAgrupar').checked;
    $('tblEmpenhos').classList.toggle('agrupado', agrupar);
    const nForn = new Set(lista.map(e => e.nome_credor)).size;
    $('countBadge').textContent = (lista.length === todos.length
        ? `${fmtNum(todos.length)} empenho${todos.length === 1 ? '' : 's'}`
        : `${fmtNum(lista.length)} de ${fmtNum(todos.length)}`) + ` · ${fmtNum(nForn)} fornecedor${nForn === 1 ? '' : 'es'}`;
    if (!todos.length) {
        $('tbodyEmpenhos').innerHTML = `<tr><td colspan="9" class="empty"><span class="empty-icon">📦</span>Nenhum empenho cadastrado ainda.<br>Clique em "＋ Novo Empenho" para começar.</td></tr>`;
        return;
    }
    if (!lista.length) {
        $('tbodyEmpenhos').innerHTML = `<tr><td colspan="9" class="empty"><span class="empty-icon">🔎</span>Nenhum empenho encontrado com esses filtros.</td></tr>`;
        return;
    }
    if (!agrupar) { $('tbodyEmpenhos').innerHTML = lista.map(linhaEmpenho).join(''); return; }

    // Agrupa por fornecedor (ordem alfabética); dentro do grupo vale a ordenação escolhida
    const grupos = new Map();
    lista.forEach(e => {
        const k = e.nome_credor || '—';
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(e);
    });
    const nomes = [...grupos.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('tbodyEmpenhos').innerHTML = nomes.map(nome => {
        const fechado = estado.gruposFechados.has(nome);
        return linhaFornecedor(nome, grupos.get(nome), fechado) + (fechado ? '' : grupos.get(nome).map(linhaEmpenho).join(''));
    }).join('');
    $('tbodyEmpenhos').querySelectorAll('.grupo-row').forEach(tr => {
        const alternar = () => {
            const g = tr.dataset.grupo;
            if (estado.gruposFechados.has(g)) estado.gruposFechados.delete(g); else estado.gruposFechados.add(g);
            renderLista();
        };
        tr.addEventListener('click', alternar);
        tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); alternar(); } });
    });
}

function limparFiltros() {
    $('fBusca').value = ''; $('fSituacao').value = ''; $('fAno').value = ''; $('fFornecedor').value = ''; $('fSaldo').checked = false;
    renderLista();
}

// =====================================================================
// EMPENHO: criar / editar / apagar
// =====================================================================
function abrirModalEmpenho(editar = false) {
    estado.empenhoEditando = editar ? estado.empenhoAtual : null;
    const e = estado.empenhoEditando;
    $('empModalTitulo').textContent = e ? `Editar Empenho ${e.ne}` : 'Novo Empenho';
    $('mNe').value = e ? e.ne : '';
    $('mProcesso').value = e ? (e.processo || '') : '';
    $('mCredor').value = e ? e.nome_credor : '';
    abrirModal('modalEmpenho');
}

async function salvarEmpenho() {
    const corpo = { ne: $('mNe').value.trim(), processo: $('mProcesso').value.trim(), nome_credor: $('mCredor').value.trim() };
    if (!corpo.ne || !corpo.nome_credor) { toast('Preencha NE e Fornecedor', 'error'); return; }
    if (estado.empenhoEditando) {
        const d = await acao(enviarJSON(`/api/empenhos/${estado.empenhoEditando.id}`, 'PUT', corpo), 'Empenho atualizado');
        if (d) fecharModal('modalEmpenho');
        return;
    }
    const d = await enviarJSON('/api/empenhos', 'POST', corpo);
    if (!d.ok) { toast(d.error, 'error'); return; }
    fecharModal('modalEmpenho');
    toast('Empenho criado! Agora inclua os itens.', 'success');
    await abrirDetalhe(d.id);
    abrirTabelaItens();
}

async function apagarEmpenho(id) {
    const e = estado.empenhos.find(x => x.id === id) || estado.empenhoAtual;
    const ne = e ? e.ne : '';
    if (!confirm(`Apagar o empenho ${ne}?\n\nItens, pedidos, NFs e pagamentos vão juntos para a lixeira.\nÉ possível restaurar depois em Histórico → Lixeira.`)) return;
    try {
        const d = await enviarJSON(`/api/empenhos/${id}`, 'DELETE');
        if (!d.ok) { toast(d.error, 'error'); return; }
        toast(`Empenho ${d.ne} enviado para a lixeira.`, 'success');
        if (estado.empenhoId) voltarLista(); else carregarLista();
    } catch (err) { toast(err.message, 'error'); }
}

// =====================================================================
// DETALHE
// =====================================================================
async function abrirDetalhe(id, { pushUrl = true, rolar = true } = {}) {
    let data;
    try { data = await fetchJSON(`/api/empenhos/${id}`); }
    catch (err) { toast(err.message, 'error'); return; }
    if (!data || !data.empenho) { toast('Empenho não encontrado', 'error'); if (!estado.empenhoId) voltarLista(); return; }
    Object.assign(estado, {
        empenhoId: id, empenhoAtual: data.empenho, itens: data.itens, pedidos: data.pedidos,
        obsAntigas: data.pagamentos_antigos || [], movimentos: data.movimentos, financeiro: data.financeiro,
    });
    const e = data.empenho, f = data.financeiro;
    document.title = `${e.ne} — Empenhos`;
    $('detTitulo').innerHTML = `Empenho ${esc(e.ne)} — ${esc(e.nome_credor)}`;
    $('detResumo').innerHTML = `
        <span class="chip">Empenhado <strong>${fmtMoney(f.empenhado)}</strong></span>
        <span class="chip chip-teal">Liquidado <strong>${fmtMoney(f.liquidado)}</strong></span>
        <span class="chip chip-green">Pago <strong>${fmtMoney(f.pago)}</strong></span>
        <span class="chip chip-red">A liquidar <strong>${fmtMoney(f.a_liquidar)}</strong></span>
        <span class="chip chip-amber">A pagar <strong>${fmtMoney(f.a_pagar)}</strong></span>
        ${e.processo ? `<span class="chip">Processo <strong>${esc(e.processo)}</strong></span>` : ''}`;
    $('secLista').style.display = 'none';
    $('secDetalhe').style.display = 'block';
    renderItens();
    renderMovimentos();
    renderPedidos();
    renderObsAntigas();
    if ($('boxHistorico').open) carregarHistorico();
    if (pushUrl && new URLSearchParams(location.search).get('id') !== String(id)) {
        history.pushState({ id }, '', `/empenhos?id=${id}`);
    }
    if (rolar) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function voltarLista({ pushUrl = true } = {}) {
    estado.empenhoId = null;
    estado.empenhoAtual = null;
    document.title = 'Empenhos - Aprovisionamento';
    $('secDetalhe').style.display = 'none';
    $('secLista').style.display = 'block';
    $('boxHistorico').open = false;
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
            <td class="num ${i.saldo_fisico <= EPS ? 'text-green' : 'text-amber'}"><strong>${fmtNum(i.saldo_fisico)}</strong></td>
            <td class="num" title="${i.reservado > 0 ? `${fmtNum(i.reservado)} reservado(s) em pedidos abertos` : ''}">
                <strong>${fmtNum(i.saldo_a_pedir)}</strong>${i.reservado > 0 ? `<div class="muted small">${fmtNum(i.reservado)} em pedido</div>` : ''}</td>
            <td class="num money text-teal">${fmtMoney(i.liquidado)}</td>
            <td>${pctCell(i.percentual_liquidado)}</td>
            <td class="acoes">
                <button class="btn btn-sm btn-secondary" title="Editar item" aria-label="Editar item" onclick="editarItem(${i.id})">✏️</button>
                <button class="btn btn-sm btn-secondary" title="Reforço ou anulação de quantidade" aria-label="Reforço ou anulação" onclick="abrirMovimento(${i.id})">±</button>
                <button class="btn btn-sm btn-danger" title="Excluir item" aria-label="Excluir item" onclick="excluirItem(${i.id})">🗑</button>
            </td>
        </tr>`).join('') : `<tr><td colspan="12" class="empty"><span class="empty-icon">📄</span>Nenhum item. Clique em "＋ Itens".</td></tr>`;
    $('btnNovoPedido').disabled = !estado.itens.some(i => i.saldo_a_pedir > EPS);
    $('btnNovoPedido').title = $('btnNovoPedido').disabled ? 'Nenhum item com saldo a pedir' : '';
}

function renderMovimentos() {
    const movs = estado.movimentos;
    $('secMovimentos').innerHTML = movs.length ? `
        <details class="mov-box">
            <summary>Reforços e anulações (${movs.length})</summary>
            <table class="nf-table">
                <thead><tr><th>Data</th><th>Tipo</th><th>Item</th><th>Qtde</th><th>Documento</th><th>Obs.</th></tr></thead>
                <tbody>${movs.map(m => `
                    <tr>
                        <td>${dataBR(m.data)}</td>
                        <td><span class="badge ${m.tipo === 'REFORCO' ? 'ok' : 'critico'}">${m.tipo === 'REFORCO' ? '＋ Reforço' : '− Anulação'}</span></td>
                        <td>${esc(m.numero_item)} • ${esc(m.descricao)}</td>
                        <td class="num">${fmtNum(m.qtde)} ${esc(m.und)}</td>
                        <td>${esc(m.documento)}</td>
                        <td>${esc(m.observacoes)}</td>
                    </tr>`).join('')}</tbody>
            </table>
        </details>` : '';
}

const STATUS = {
    RECEBIDO: ['Recebido', 'ok'], PARCIAL: ['Parcial', 'atencao'],
    INCLUIDO: ['Aguardando', 'info'], ENCERRADO: ['Encerrado', 'neutro'],
};

function renderPedidos() {
    const pedidos = ordenar(estado.pedidos, estado.sortPedidos.key, estado.sortPedidos.dir);
    $('tbodyPedidos').innerHTML = pedidos.length ? pedidos.map(p => {
        const [rot, cls] = STATUS[p.status] || [p.status, 'info'];
        const aberto = p.status === 'INCLUIDO' || p.status === 'PARCIAL';
        const venc = p.vencimento
            ? `${dataBR(p.vencimento)}${p.dias_atraso ? `<div><span class="badge critico">⏰ ${p.dias_atraso} dia${p.dias_atraso > 1 ? 's' : ''} de atraso</span></div>` : ''}`
            : '<span class="muted">—</span>';
        return `<tr class="${p.dias_atraso ? 'row-alerta' : ''}">
            <td><strong>${esc(p.numero_pedido)}</strong>${p.observacoes ? `<div class="muted small">${esc(p.observacoes)}</div>` : ''}</td>
            <td>${dataBR(p.data_pedido)}</td>
            <td>${venc}</td>
            <td class="num">${fmtNum(p.qt_itens)}</td>
            <td class="num">${fmtNum(p.qtde_total_pedida)}</td>
            <td class="num">${fmtNum(p.qtde_total_recebida)}</td>
            <td><span class="badge ${cls}">${rot}</span></td>
            <td class="acoes">
                ${aberto ? `<button class="btn btn-sm btn-primary" onclick="abrirRecebimento(${p.id})">📥 Receber</button>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="baixarPdf(${p.id})" title="PDF do pedido para o fornecedor" aria-label="PDF do pedido">📄</button>
                ${p.qt_nfs > 0 ? `<button class="btn btn-sm ${p.qt_nfs_a_pagar ? 'btn-attention' : 'btn-secondary'}" onclick="verNfs(${p.id})"
                    title="${p.qt_nfs_a_pagar ? `${p.qt_nfs_a_pagar} NF(s) aguardando pagamento — clique para marcar como paga` : 'Todas as NFs pagas'}"
                    aria-label="Notas fiscais">🧾 NFs ${p.qt_nfs_a_pagar ? `<span class="pill">${p.qt_nfs_a_pagar} a pagar</span>` : '<span class="pill ok" title="Todas as NFs pagas">✓</span>'}</button>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="editarPedido(${p.id})" title="Editar pedido" aria-label="Editar pedido">✏️</button>
                ${p.status === 'PARCIAL' || p.status === 'INCLUIDO' ? `<button class="btn btn-sm btn-secondary" onclick="encerrarPedido(${p.id}, false)" title="Encerrar: o que falta não virá e volta ao saldo a pedir" aria-label="Encerrar pedido">🔒</button>` : ''}
                ${p.status === 'ENCERRADO' ? `<button class="btn btn-sm btn-secondary" onclick="encerrarPedido(${p.id}, true)" title="Reabrir pedido" aria-label="Reabrir pedido">🔓</button>` : ''}
                <button class="btn btn-sm btn-danger" title="Excluir pedido" aria-label="Excluir pedido" onclick="excluirPedido(${p.id})">🗑</button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="8" class="empty"><span class="empty-icon">🧾</span>Nenhum pedido. Clique em "＋ Fazer Pedido".</td></tr>`;
}

/** OBs lançadas antes de o pagamento passar a ser marcado na NF: só aviso + exclusão. */
function renderObsAntigas() {
    const obs = estado.obsAntigas;
    if (!obs.length) { $('secObsAntigas').innerHTML = ''; return; }
    const total = obs.reduce((a, o) => a + (o.valor || 0), 0);
    $('secObsAntigas').innerHTML = `
        <div class="aviso-legado">
            <div><strong>OBs lançadas no modo antigo (${fmtMoney(total)})</strong>
            <div class="muted small">Elas não entram mais no "Pago". Marque as NFs correspondentes como pagas e depois exclua estes lançamentos.</div></div>
            <ul>${obs.map(o => `<li><span>OB <strong>${esc(o.ob)}</strong> · ${dataBR(o.data_pagamento)} · ${fmtMoney(o.valor)}${o.nf ? ` · NF ${esc(o.nf)}` : ''}</span>
                <button class="btn btn-sm btn-danger" onclick="excluirObAntiga(${o.id})" aria-label="Excluir OB ${esc(o.ob)}">🗑</button></li>`).join('')}</ul>
        </div>`;
}

async function excluirObAntiga(id) {
    const o = estado.obsAntigas.find(x => x.id === id);
    if (!confirm(`Excluir o lançamento da OB ${o ? o.ob : ''}? (vai para a lixeira)`)) return;
    await acao(enviarJSON(`/api/pagamentos/${id}`, 'DELETE'), 'Lançamento antigo enviado para a lixeira');
}

// ---------- Histórico do empenho ----------
const ACOES = {
    CRIAR: '🆕', EDITAR: '✏️', EXCLUIR: '🗑', RESTAURAR: '♻️', RECEBER: '📥', PAGAR: '💰',
    ENCERRAR: '🔒', REFORCO: '➕', ANULACAO: '➖', LOGIN: '🔑', EXPORTAR: '⬇',
};
async function carregarHistorico() {
    $('listaHistorico').innerHTML = '<li class="muted">Carregando…</li>';
    try {
        const h = await fetchJSON(`/api/historico?empenho_id=${estado.empenhoId}&limite=100`);
        $('listaHistorico').innerHTML = h.length ? h.map(x => `
            <li><span class="tl-ico">${ACOES[x.acao] || '•'}</span>
                <div><div>${esc(x.descricao)}</div>
                <div class="muted small">${dataBR(x.quando)} · ${esc(x.usuario)}</div></div></li>`).join('')
            : '<li class="muted">Nenhum registro.</li>';
    } catch (err) { $('listaHistorico').innerHTML = `<li class="text-red">${esc(err.message)}</li>`; }
}

// =====================================================================
// ITENS (inclusão em lote, edição, importação, reforço/anulação)
// =====================================================================
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
    return tr;
}

function removerLinha(btn) {
    btn.closest('tr').remove();
    recalcularTotalItens();
}

function recalcularTotalItens() {
    let total = 0;
    document.querySelectorAll('#tbodyItemEdit tr').forEach(tr => {
        const q = parseNumBR(tr.querySelector('[data-f="qtde_empenhada"]').value);
        const v = parseNumBR(tr.querySelector('[data-f="valor_unitario"]').value);
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
            numero_item: get('numero_item'), descricao, und: get('und'),
            qtde_empenhada: parseNumBR(get('qtde_empenhada')),
            valor_unitario: parseNumBR(get('valor_unitario')),
        });
    });
    return itens;
}

const numParaCampo = (n) => String(n ?? '').replace('.', ',');

function abrirTabelaItens(editItem = null) {
    $('tbodyItemEdit').innerHTML = '';
    $('txtImportar').value = ''; $('importMsg').textContent = '';
    if (editItem) {
        $('itemModalTitulo').textContent = `Editar Item #${editItem.numero_item} — ${editItem.descricao}`;
        $('btnSalvarItem').textContent = 'Salvar Alteração';
        criarLinha(editItem.id, editItem.numero_item, editItem.descricao, editItem.und,
                   numParaCampo(editItem.qtde_empenhada), numParaCampo(editItem.valor_unitario));
        $('btnAddLinha').style.display = 'none';
        $('boxImportar').style.display = 'none';
        $('itemEditHint').textContent = 'Para aumentar ou reduzir a quantidade com registro do documento, prefira o botão ± (reforço/anulação).';
    } else {
        $('itemModalTitulo').textContent = 'Incluir Itens';
        $('btnSalvarItem').textContent = 'Salvar Itens';
        $('btnAddLinha').style.display = '';
        $('boxImportar').style.display = '';
        $('itemEditHint').textContent = 'Valores aceitam vírgula ou ponto (22,50 ou 22.50). Linhas sem descrição são ignoradas.';
        criarLinha();
        criarLinha();
    }
    abrirModal('modalItem');
}

/**
 * Importação: aceita linhas coladas do Excel (separadas por TAB) ou CSV (; ou ,).
 * Colunas: [Item], Descrição, Und, Qtde, Valor unit.  — o cabeçalho é ignorado.
 */
function importarTexto(texto) {
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!linhas.length) return { ok: 0, ignoradas: 0 };
    const sep = linhas[0].includes('\t') ? '\t' : (linhas[0].includes(';') ? ';' : ',');
    let ok = 0, ignoradas = 0;
    // remove linhas vazias da tabelinha antes de importar
    document.querySelectorAll('#tbodyItemEdit tr').forEach(tr => {
        if (![...tr.querySelectorAll('input')].some(i => i.value.trim())) tr.remove();
    });
    linhas.forEach(l => {
        const c = l.split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
        if (/descri/i.test(l) && /qt|quant/i.test(l)) return; // cabeçalho
        let num = '', desc, und, qtde, vu;
        if (c.length >= 5) [num, desc, und, qtde, vu] = c;
        else if (c.length === 4) [desc, und, qtde, vu] = c;
        else { ignoradas++; return; }
        if (!desc || !(parseNumBR(qtde) > 0)) { ignoradas++; return; }
        criarLinha(null, num, desc, und, qtde, vu);
        ok++;
    });
    if (!document.querySelector('#tbodyItemEdit tr')) criarLinha();
    return { ok, ignoradas };
}

function executarImportacao(texto) {
    const r = importarTexto(texto);
    $('importMsg').textContent = r.ok
        ? `✓ ${r.ok} item(ns) adicionado(s) à lista${r.ignoradas ? `, ${r.ignoradas} linha(s) ignorada(s)` : ''}. Confira e salve.`
        : 'Nenhuma linha reconhecida. Use as colunas: Item, Descrição, Und, Qtde, Valor unit.';
    if (r.ok) $('txtImportar').value = '';
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
        const d = await acao(enviarJSON(`/api/itens/${it.linha_id}`, 'PUT', it), null);
        if (d) { fecharModal('modalItem'); toast(`Item atualizado (total ${fmtMoney(d.valor_total)})`, 'success'); }
    } else {
        const d = await acao(enviarJSON(`/api/empenhos/${estado.empenhoId}/itens`, 'POST', { itens: linhas }), null);
        if (d) { fecharModal('modalItem'); toast(`${d.quantidade} item(ns) incluído(s) — total ${fmtMoney(d.valor_total)}`, 'success'); }
    }
}

async function excluirItem(id) {
    const item = estado.itens.find(i => i.id === id);
    if (!confirm(`Excluir o item ${item ? item.descricao : ''}?\nOs pedidos/NFs ligados a ele também saem (vão para a lixeira).`)) return;
    await acao(enviarJSON(`/api/itens/${id}`, 'DELETE'), 'Item enviado para a lixeira');
}

function abrirMovimento(id) {
    const i = estado.itens.find(x => x.id === id);
    if (!i) return;
    estado.itemMov = i;
    $('movTitulo').textContent = `Reforço / Anulação — ${i.descricao}`;
    $('movInfo').innerHTML = `Quantidade atual <strong>${fmtNum(i.qtde_empenhada)} ${esc(i.und)}</strong> · saldo a pedir <strong>${fmtNum(i.saldo_a_pedir)}</strong> · valor unit. ${fmtMoney(i.valor_unitario)}`;
    $('movQtde').value = ''; $('movDoc').value = ''; $('movObs').value = ''; $('movData').value = hoje();
    document.querySelector('input[name=movTipo][value=REFORCO]').checked = true;
    previewMovimento();
    abrirModal('modalMov');
}

function previewMovimento() {
    const i = estado.itemMov; if (!i) return;
    const tipo = document.querySelector('input[name=movTipo]:checked').value;
    const q = parseNumBR($('movQtde').value);
    if (!q) { $('movPreview').textContent = tipo === 'ANULACAO' ? `Máximo para anular: ${fmtNum(i.saldo_a_pedir)} ${i.und}` : ''; return; }
    const nova = i.qtde_empenhada + (tipo === 'REFORCO' ? q : -q);
    const excede = tipo === 'ANULACAO' && q > i.saldo_a_pedir + EPS;
    $('movPreview').innerHTML = excede
        ? `<span class="text-red">Acima do saldo a pedir (${fmtNum(i.saldo_a_pedir)})</span>`
        : `Nova quantidade: <strong>${fmtNum(nova)} ${esc(i.und)}</strong> · novo total ${fmtMoney(nova * i.valor_unitario)} (${tipo === 'REFORCO' ? '+' : '−'}${fmtMoney(q * i.valor_unitario)})`;
}

async function salvarMovimento() {
    const tipo = document.querySelector('input[name=movTipo]:checked').value;
    const d = await acao(enviarJSON(`/api/itens/${estado.itemMov.id}/movimentos`, 'POST', {
        tipo, qtde: parseNumBR($('movQtde').value), data: $('movData').value,
        documento: $('movDoc').value.trim(), observacoes: $('movObs').value.trim(),
    }), tipo === 'REFORCO' ? 'Reforço registrado' : 'Anulação registrada');
    if (d) fecharModal('modalMov');
}

// =====================================================================
// PEDIDOS
// =====================================================================
function atualizarVencimento() {
    const d = $('mPedData').value || hoje();
    const prazo = parseInt($('mPedPrazo').value, 10);
    if (!prazo && prazo !== 0) { $('mPedVenc').textContent = 'Sem prazo definido'; return; }
    const v = new Date(d + 'T12:00:00'); v.setDate(v.getDate() + prazo);
    $('mPedVenc').textContent = `Entrega até ${v.toLocaleDateString('pt-BR')}`;
}

/** Monta as linhas de itens do pedido. Na edição, o saldo considera o que o próprio pedido já reserva. */
function montarPedItens(pedidoInfo = null) {
    const box = $('mPedItens');
    const noPedido = {};
    if (pedidoInfo) pedidoInfo.itens.forEach(i => { noPedido[i.item_id] = i; });
    const encerrado = pedidoInfo && pedidoInfo.status === 'ENCERRADO';
    const linhas = estado.itens.map(i => {
        const p = noPedido[i.id];
        const recebido = p ? p.qtde_recebida : 0;
        const reservaPropria = p && !encerrado ? Math.max(0, p.qtde_pedida - p.qtde_recebida) : 0;
        const max = recebido + i.saldo_a_pedir + reservaPropria;
        return { i, p, recebido, max };
    }).filter(l => l.p || l.max > EPS);
    box.innerHTML = linhas.length ? linhas.map(({ i, p, recebido, max }) => `
        <div class="ped-item">
            <label for="ped-${i.id}">${esc(i.numero_item)} • ${esc(i.descricao)}
                <span class="muted">— máx. ${fmtNum(max)} ${esc(i.und)}${recebido ? ` (já recebido ${fmtNum(recebido)})` : ''} · ${fmtMoney(i.valor_unitario)}/${esc(i.und) || 'un'}</span></label>
            <input id="ped-${i.id}" type="text" inputmode="decimal" placeholder="Qtde pedida" data-item="${i.id}"
                   data-max="${max}" data-min="${recebido}" data-vu="${i.valor_unitario}" value="${p ? numParaCampo(p.qtde_pedida) : ''}">
        </div>`).join('') + `<div class="item-total">Valor do pedido: <strong id="pedTotal">R$ 0,00</strong></div>`
        : '<p class="muted">— Nenhum item com saldo a pedir. —</p>';
    box.querySelectorAll('input[data-item]').forEach(inp => inp.addEventListener('input', totalPedido));
    totalPedido();
    $('btnSalvarPedido').disabled = !linhas.length;
}

function totalPedido() {
    let t = 0;
    document.querySelectorAll('#mPedItens input[data-item]').forEach(inp => { t += parseNumBR(inp.value) * parseFloat(inp.dataset.vu || 0); });
    if ($('pedTotal')) $('pedTotal').textContent = fmtMoney(t);
}

function abrirNovoPedido() {
    estado.pedidoEditando = null;
    $('pedTitulo').textContent = 'Novo Pedido';
    $('btnSalvarPedido').textContent = 'Salvar Pedido';
    $('mPedNum').value = ''; $('mPedObs').value = ''; $('mPedData').value = hoje(); $('mPedPrazo').value = 30;
    atualizarVencimento();
    montarPedItens();
    abrirModal('modalPedido');
}

async function editarPedido(id) {
    let d;
    try { d = await fetchJSON(`/api/pedidos/${id}`); } catch (err) { toast(err.message, 'error'); return; }
    if (!d.ok) { toast(d.error, 'error'); return; }
    estado.pedidoEditando = d;
    $('pedTitulo').textContent = `Editar Pedido ${d.pedido.numero_pedido}`;
    $('btnSalvarPedido').textContent = 'Salvar Alterações';
    $('mPedNum').value = d.pedido.numero_pedido || '';
    $('mPedObs').value = d.pedido.observacoes || '';
    $('mPedData').value = (d.pedido.data_pedido || '').slice(0, 10);
    $('mPedPrazo').value = d.pedido.prazo_dias ?? '';
    atualizarVencimento();
    montarPedItens(d);
    abrirModal('modalPedido');
}

async function salvarPedido() {
    const inputs = [...document.querySelectorAll('#mPedItens input[data-item]')];
    for (const inp of inputs) {
        const v = parseNumBR(inp.value);
        if (v < 0 || v > parseFloat(inp.dataset.max) + EPS) {
            inp.focus(); toast(`Quantidade acima do saldo (máx. ${fmtNum(+inp.dataset.max)})`, 'error'); return;
        }
        if (v + EPS < parseFloat(inp.dataset.min)) {
            inp.focus(); toast(`Já foram recebidos ${fmtNum(+inp.dataset.min)} deste item neste pedido`, 'error'); return;
        }
    }
    const itens = inputs.map(inp => ({ item_id: Number(inp.dataset.item), qtde_pedida: parseNumBR(inp.value) }))
        .filter(i => i.qtde_pedida > 0);
    if (!$('mPedNum').value.trim()) { $('mPedNum').focus(); toast('Informe o número do pedido', 'error'); return; }
    if (!itens.length) { toast('Informe a quantidade de pelo menos um item', 'error'); return; }
    const corpo = {
        empenho_id: estado.empenhoId, numero_pedido: $('mPedNum').value.trim(),
        data_pedido: $('mPedData').value || hoje(), prazo_dias: $('mPedPrazo').value,
        observacoes: $('mPedObs').value.trim(), itens,
    };
    const ed = estado.pedidoEditando;
    const d = await acao(ed ? enviarJSON(`/api/pedidos/${ed.pedido.id}`, 'PUT', corpo) : enviarJSON('/api/pedidos', 'POST', corpo),
        ed ? 'Pedido atualizado' : 'Pedido registrado');
    if (d) fecharModal('modalPedido');
}

async function encerrarPedido(id, reabrir) {
    const msg = reabrir
        ? 'Reabrir este pedido? O que falta entregar volta a ser reservado.'
        : 'Encerrar este pedido?\n\nUse quando o fornecedor não vai entregar o restante. O que faltava volta ao "saldo a pedir" e o pedido deixa de contar como atrasado.';
    if (!confirm(msg)) return;
    await acao(enviarJSON(`/api/pedidos/${id}/encerrar`, 'POST', { reabrir }), reabrir ? 'Pedido reaberto' : 'Pedido encerrado');
}

async function excluirPedido(id) {
    if (!confirm('Excluir este pedido?\nAs NFs dele também saem (vão para a lixeira).')) return;
    await acao(enviarJSON(`/api/pedidos/${id}`, 'DELETE'), 'Pedido enviado para a lixeira');
}

function baixarPdf(id) {
    window.open(`/api/pedidos/${id}/pdf`, '_blank');
}

// =====================================================================
// NFs: ver, registrar, corrigir, excluir
// =====================================================================
async function verNfs(id) {
    let d;
    try { d = await fetchJSON(`/api/pedidos/${id}`); } catch (err) { toast(err.message, 'error'); return; }
    if (!d.ok) { toast(d.error, 'error'); return; }
    estado.pedidoAtual = d;
    $('nfPedidoInfo').innerHTML = `<strong>Pedido ${esc(d.pedido.numero_pedido)}</strong> • Empenho ${esc(d.empenho ? d.empenho.ne : '—')} • ${esc(d.empenho ? d.empenho.nome_credor : '—')}`;
    const aPagar = d.recebimentos.filter(n => !n.pago_em);
    $('nfsTitulo').innerHTML = `Notas Fiscais ${aPagar.length
        ? `<span class="badge atencao">${aPagar.length} a pagar · ${fmtMoney(aPagar.reduce((a, n) => a + n.valor, 0))}</span>`
        : (d.recebimentos.length ? '<span class="badge ok">✓ todas pagas</span>' : '')}`;
    $('nfCorpo').innerHTML = d.recebimentos.length ? d.recebimentos.map((nf, idx) => `
        <div class="nf-card ${nf.pago_em ? 'nf-paga' : ''}">
            <div class="nf-head">
                <span style="font-size:18px">🧾</span>
                <div class="nf-title">
                    <strong>NF ${esc(nf.nf)}</strong>
                    <span class="muted"> • ${dataBR(nf.data_recebimento) || '—'} • ${fmtMoney(nf.valor)}</span>
                    <div class="nf-status">${nf.pago_em
                        ? `<span class="badge ok">✓ Paga em ${dataBR(nf.pago_em).slice(0, 10)}</span> <span class="muted small">por ${esc(nf.pago_por || '—')}</span>`
                        : '<span class="badge atencao">⏳ Aguardando pagamento</span>'}</div>
                </div>
                <div class="nf-acoes">
                    ${nf.pago_em
                        ? `<button class="btn btn-sm btn-secondary" onclick="pagarNf(${idx}, false)" title="Desmarcar o pagamento desta NF">↩ Desfazer</button>`
                        : `<button class="btn btn-sm btn-success" onclick="pagarNf(${idx}, true)">✓ Marcar como paga</button>`}
                    <button class="btn btn-sm btn-secondary" onclick="abrirCorrecaoNf(${idx})" ${nf.pago_em ? 'disabled title="Desfaça o pagamento para corrigir"' : ''}>✏️ Corrigir</button>
                    <button class="btn btn-sm btn-danger" onclick="excluirNf(${idx})" aria-label="Excluir NF" ${nf.pago_em ? 'disabled title="Desfaça o pagamento para excluir"' : ''}>🗑</button>
                </div>
            </div>
            ${nf.observacoes ? `<div class="muted small">Obs.: ${esc(nf.observacoes)}</div>` : ''}
            <table class="nf-table">
                <thead><tr><th>Item</th><th>Descrição</th><th>Und</th><th class="num">Qtde</th><th class="num">Valor</th></tr></thead>
                <tbody>${nf.itens.map(i => `
                    <tr><td>${esc(i.numero_item)}</td><td>${esc(i.descricao)}</td><td>${esc(i.und)}</td>
                        <td class="num">${fmtNum(i.qtde_recebida)}</td><td class="num">${fmtMoney(i.qtde_recebida * i.valor_unitario)}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>`).join('') : '<p class="muted">Nenhuma NF registrada para este pedido.</p>';
    abrirModal('modalNfs');
}

/** Monta o formulário de recebimento. Na correção de NF, as quantidades dela voltam ao "pendente". */
function montarRecebItens(d, nf = null) {
    const naNf = {};
    if (nf) nf.itens.forEach(i => { naNf[i.item_id] = (naNf[i.item_id] || 0) + i.qtde_recebida; });
    const linhas = d.itens.map(i => {
        const devolve = naNf[i.item_id] || 0;
        const pendente = nf
            ? Math.max(0, Math.min(i.qtde_pedida - i.qtde_recebida + devolve, i.saldo_fisico + devolve))
            : i.pendente;
        return { i, pendente, atual: devolve };
    });
    const temPendente = linhas.some(l => l.pendente > EPS);
    $('rItens').innerHTML = (temPendente ? '' : '<p class="muted">Todos os itens deste pedido já foram recebidos.</p>') + linhas.map(({ i, pendente, atual }) => {
        const fechado = pendente <= EPS;
        return `
        <div class="ped-item ${fechado ? 'is-done' : ''}">
            <label for="rec-${i.item_id}">${esc(i.numero_item)} • ${esc(i.descricao)}
                <span class="muted">— pedido ${fmtNum(i.qtde_pedida)} ${esc(i.und)}, já recebido ${fmtNum(i.qtde_recebida - atual)}</span></label>
            ${fechado ? '<span class="badge ok">Recebido por completo</span>' : `
            <div class="input-hint">
                <input id="rec-${i.item_id}" type="text" inputmode="decimal" placeholder="Qtde recebida" data-item="${i.item_id}"
                       data-max="${pendente}" data-vu="${i.valor_unitario}" value="${atual ? numParaCampo(atual) : ''}">
                <button type="button" class="btn btn-sm btn-secondary" data-tudo="${pendente}">Tudo (${fmtNum(pendente)})</button>
            </div>`}
        </div>`;
    }).join('');
    $('rItens').querySelectorAll('[data-tudo]').forEach(b => b.addEventListener('click', () => {
        b.previousElementSibling.value = numParaCampo(b.dataset.tudo); totalRecebimento();
    }));
    $('rItens').querySelectorAll('input[data-item]').forEach(inp => inp.addEventListener('input', totalRecebimento));
    totalRecebimento();
    $('btnSalvarRecebimento').disabled = !temPendente;
}

function totalRecebimento() {
    let t = 0;
    document.querySelectorAll('#rItens input[data-item]').forEach(inp => { t += parseNumBR(inp.value) * parseFloat(inp.dataset.vu || 0); });
    $('rTotal').textContent = fmtMoney(t);
}

async function abrirRecebimento(pedidoId) {
    let d;
    try { d = await fetchJSON(`/api/pedidos/${pedidoId}`); } catch (err) { toast(err.message, 'error'); return; }
    if (!d.ok) { toast(d.error, 'error'); return; }
    estado.pedidoAtual = d;
    estado.nfEditando = null;
    $('recTitulo').textContent = 'Registrar Recebimento';
    $('btnSalvarRecebimento').textContent = 'Registrar Recebimento';
    $('rPedInfo').innerHTML = `<strong>Pedido ${esc(d.pedido.numero_pedido)}</strong> — informe a NF e as quantidades que chegaram.`;
    $('rNf').value = ''; $('rObs').value = ''; $('rData').value = hoje();
    montarRecebItens(d);
    abrirModal('modalReceber');
}

function abrirCorrecaoNf(idx) {
    const d = estado.pedidoAtual, nf = d.recebimentos[idx];
    estado.nfEditando = nf;
    fecharModal('modalNfs');
    $('recTitulo').textContent = `Corrigir NF ${nf.nf}`;
    $('btnSalvarRecebimento').textContent = 'Salvar Correção';
    $('rPedInfo').innerHTML = `<strong>Pedido ${esc(d.pedido.numero_pedido)}</strong> — ajuste número, data ou quantidades. Deixe em branco os itens que não vieram nesta NF.`;
    $('rNf').value = nf.nf === '—' ? '' : nf.nf;
    $('rData').value = (nf.data_recebimento || '').slice(0, 10);
    $('rObs').value = nf.observacoes || '';
    montarRecebItens(d, nf);
    $('btnSalvarRecebimento').disabled = false;
    abrirModal('modalReceber');
}

async function salvarRecebimento() {
    const d = estado.pedidoAtual;
    const nf = $('rNf').value.trim();
    if (!nf) { $('rNf').focus(); toast('Informe o número da NF', 'error'); return; }
    const inputs = [...document.querySelectorAll('#rItens input[data-item]')];
    for (const inp of inputs) {
        const v = parseNumBR(inp.value);
        if (v < 0 || v > parseFloat(inp.dataset.max) + EPS) {
            inp.focus(); toast(`Quantidade acima do que falta receber (máx. ${fmtNum(+inp.dataset.max)})`, 'error'); return;
        }
    }
    const itens = inputs.map(inp => ({ item_id: Number(inp.dataset.item), qtde_recebida: parseNumBR(inp.value) }))
        .filter(i => i.qtde_recebida > 0);
    if (!itens.length) { toast('Preencha ao menos uma quantidade recebida', 'error'); return; }
    const corpo = { nf, data_recebimento: $('rData').value, observacoes: $('rObs').value.trim(), itens };
    let r;
    if (estado.nfEditando) {
        r = await acao(enviarJSON(`/api/pedidos/${d.pedido.id}/nfs`, 'PUT', { ...corpo, ids: estado.nfEditando.ids }), 'NF corrigida');
    } else {
        r = await acao(enviarJSON(`/api/pedidos/${d.pedido.id}/receber`, 'POST', corpo), null);
        if (r) toast(`NF ${r.nf} registrada — ${fmtMoney(r.valor)} liquidado`, 'success');
    }
    if (r) fecharModal('modalReceber');
}

async function pagarNf(idx, pago) {
    const d = estado.pedidoAtual, nf = d.recebimentos[idx];
    if (!pago && !confirm(`Desfazer o pagamento da NF ${nf.nf} (${fmtMoney(nf.valor)})?`)) return;
    const r = await acao(enviarJSON(`/api/pedidos/${d.pedido.id}/nfs/pagar`, 'POST', { ids: nf.ids, pago }),
        pago ? `NF ${nf.nf} marcada como paga — ${fmtMoney(nf.valor)}` : `Pagamento da NF ${nf.nf} desfeito`);
    if (r) verNfs(d.pedido.id); // atualiza a janela aberta
}

async function excluirNf(idx) {
    const d = estado.pedidoAtual, nf = d.recebimentos[idx];
    if (!confirm(`Excluir a NF ${nf.nf} (${fmtMoney(nf.valor)})?\nO saldo dos itens volta e o valor deixa de constar como liquidado.`)) return;
    const r = await acao(enviarJSON(`/api/pedidos/${d.pedido.id}/nfs/excluir`, 'POST', { ids: nf.ids }), `NF ${nf.nf} enviada para a lixeira`);
    if (r) {
        fecharModal('modalNfs');
        const p = estado.pedidos.find(x => x.id === d.pedido.id);
        if (p && p.qt_recebimentos > 0) verNfs(d.pedido.id);
    }
}

// =====================================================================
// INIT
// =====================================================================
function rotaAtual() {
    const id = parseInt(new URLSearchParams(location.search).get('id'), 10);
    if (id) {
        abrirDetalhe(id, { pushUrl: false });
        fetchJSON('/api/stats_empenhos').then(renderKpis).catch(err => toast(err.message, 'error'));
    } else {
        voltarLista({ pushUrl: false });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    $('btnNew').addEventListener('click', () => abrirModalEmpenho(false));
    $('btnEditarEmpenho').addEventListener('click', () => abrirModalEmpenho(true));
    $('btnSalvarEmpenho').addEventListener('click', e => comBotao(e.currentTarget, salvarEmpenho));
    $('btnAddItem').addEventListener('click', () => abrirTabelaItens());
    $('btnAddLinha').addEventListener('click', () => criarLinha());
    $('btnSalvarItem').addEventListener('click', e => comBotao(e.currentTarget, salvarItem));
    $('btnImportar').addEventListener('click', () => executarImportacao($('txtImportar').value));
    $('txtImportar').addEventListener('paste', () => setTimeout(() => executarImportacao($('txtImportar').value), 0));
    $('fileImportar').addEventListener('change', async e => {
        const f = e.target.files[0]; if (!f) return;
        const buf = await f.arrayBuffer();
        let txt = new TextDecoder('utf-8').decode(buf);
        if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel
        executarImportacao(txt);
        e.target.value = '';
    });
    document.querySelectorAll('input[name=movTipo]').forEach(r => r.addEventListener('change', previewMovimento));
    $('movQtde').addEventListener('input', previewMovimento);
    $('btnSalvarMov').addEventListener('click', e => comBotao(e.currentTarget, salvarMovimento));
    $('btnNovoPedido').addEventListener('click', abrirNovoPedido);
    $('mPedData').addEventListener('input', atualizarVencimento);
    $('mPedPrazo').addEventListener('input', atualizarVencimento);
    $('btnSalvarPedido').addEventListener('click', e => comBotao(e.currentTarget, salvarPedido));
    $('btnSalvarRecebimento').addEventListener('click', e => comBotao(e.currentTarget, salvarRecebimento));
    $('btnVoltar').addEventListener('click', () => voltarLista());
    $('btnExcluirEmpenho').addEventListener('click', () => apagarEmpenho(estado.empenhoId));
    $('boxHistorico').addEventListener('toggle', () => { if ($('boxHistorico').open) carregarHistorico(); });

    ['fBusca', 'fSituacao', 'fAno', 'fFornecedor', 'fSaldo', 'fAgrupar'].forEach(id => $(id).addEventListener('input', renderLista));
    try { const ag = localStorage.getItem('aprov-agrupar'); if (ag !== null) $('fAgrupar').checked = ag === '1'; } catch (e) { /* sem storage */ }
    $('fAgrupar').addEventListener('change', () => { try { localStorage.setItem('aprov-agrupar', $('fAgrupar').checked ? '1' : '0'); } catch (e) { /* sem storage */ } });
    $('btnLimparFiltros').addEventListener('click', limparFiltros);

    ativarOrdenacao($('tblEmpenhos'), estado.sortLista, renderLista);
    ativarOrdenacao($('tblItens'), estado.sortItens, renderItens);
    ativarOrdenacao($('tblPedidos'), estado.sortPedidos, renderPedidos);

    window.addEventListener('popstate', rotaAtual);
    rotaAtual();
});
