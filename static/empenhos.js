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
    marcarPendencias(stats);
    if (!estado.empenhoId) renderKpis(stats); // com um empenho aberto, os cartões mostram os números dele
    preencherAnos();
    renderLista();
}

function renderKpis(s) {
    marcarPendencias(s);
    $('kpis').classList.remove('kpis-empenho');
    $('kpis').innerHTML = `
        <div class="kpi accent"><div class="kpi-label">Empenhos</div><div class="kpi-value">${fmtNum(s.empenhos)}</div><div class="kpi-sub">${fmtNum(s.itens)} itens</div></div>
        <div class="kpi slate"><div class="kpi-label">Empenhado</div><div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div><div class="kpi-sub">A liquidar ${fmtMoneyCurto(s.valor_a_liquidar)}</div></div>
        <div class="kpi teal"><div class="kpi-label">Liquidado</div><div class="kpi-value">${fmtMoney(s.valor_liquidado)}</div><div class="kpi-sub">${pct(s.percentual_liquidado)} do empenhado</div></div>
        <div class="kpi green"><div class="kpi-label">Pago</div><div class="kpi-value">${fmtMoney(s.valor_pago)}</div><div class="kpi-sub">A pagar ${fmtMoneyCurto(s.valor_a_pagar)}</div></div>
        <div class="kpi amber"><div class="kpi-label">Pedidos em Aberto</div><div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div>
            <div class="kpi-sub">${s.pedidos_atrasados ? `<span class="text-red"><strong>${fmtNum(s.pedidos_atrasados)}</strong> atrasado(s)</span>` : 'nenhum atrasado'}</div></div>`;
    ajustarKpis();
}

function ajustarKpis() {
    // A fonte Inter pode demorar um instante; ajusta de novo quando ela terminar de carregar
    ajustarValores(document.getElementById('kpis'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ajustarValores(document.getElementById('kpis')));
}

/** Cartões de cima com os números do empenho aberto (substituem a linha de etiquetas). */
function renderKpisEmpenho(e, f) {
    const peds = estado.pedidos || [];
    const abertos = peds.filter(p => p.status === 'INCLUIDO' || p.status === 'PARCIAL');
    const atrasados = peds.filter(p => p.dias_atraso > 0).length;
    const nfsAPagar = peds.reduce((a, p) => a + (p.qt_nfs_a_pagar || 0), 0);
    const pctLiq = f.empenhado ? f.liquidado / f.empenhado * 100 : 0;
    const pctPago = f.empenhado ? f.pago / f.empenhado * 100 : 0;
    const nItens = (estado.itens || []).length;
    $('kpis').classList.add('kpis-empenho');
    $('kpis').innerHTML = `
        <div class="kpi accent"><div class="kpi-label">Empenho</div><div class="kpi-value">${esc(e.ne)}</div>
            <div class="kpi-sub">${fmtNum(nItens)} ${nItens === 1 ? 'item' : 'itens'}${e.processo ? ` · Processo ${esc(e.processo)}` : ''}</div></div>
        <div class="kpi slate"><div class="kpi-label">Empenhado</div><div class="kpi-value">${fmtMoney(f.empenhado)}</div>
            <div class="kpi-sub">A liquidar <strong class="text-red">${fmtMoney(f.a_liquidar)}</strong></div></div>
        <div class="kpi teal"><div class="kpi-label">Liquidado</div><div class="kpi-value">${fmtMoney(f.liquidado)}</div>
            <div class="kpi-sub">${pct(pctLiq)} do empenhado</div></div>
        <div class="kpi green"><div class="kpi-label">Pago</div><div class="kpi-value">${fmtMoney(f.pago)}</div>
            <div class="kpi-sub">${f.a_pagar > 0.005 ? `A pagar <strong class="text-amber">${fmtMoney(f.a_pagar)}</strong>${nfsAPagar ? ` · ${nfsAPagar} NF${nfsAPagar > 1 ? 's' : ''}` : ''}` : `${pct(pctPago)} do empenhado`}</div></div>
        <div class="kpi amber"><div class="kpi-label">Pedidos em Aberto</div><div class="kpi-value">${fmtNum(abertos.length)}</div>
            <div class="kpi-sub">${atrasados ? `<span class="text-red"><strong>${fmtNum(atrasados)}</strong> atrasado(s)</span>`
                : (peds.length ? `de ${fmtNum(peds.length)} pedido${peds.length > 1 ? 's' : ''}` : 'nenhum pedido ainda')}</div></div>`;
    ajustarKpis();
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
        if (busca && !normalizar(`${e.ne} ${e.nome_credor} ${e.processo} ${(e.itens_resumo || []).join(' ')}`).includes(busca)) return false;
        if (sit === 'ATRASO') { if (!e.pedidos_atrasados) return false; }
        else if (sit === 'VENCENDO') { if (!e.pedidos_vencendo) return false; }
        else if (sit === 'APAGAR') { if (!e.nfs_a_pagar) return false; }
        else if (sit === 'ABERTO') { if (!e.pedidos_em_aberto) return false; }
        else if (sit && e.situacao !== sit) return false;
        if (ano && e.ano !== ano) return false;
        if (forn && e.nome_credor !== forn) return false;
        if (saldo && !(e.a_liquidar > 0.005)) return false;
        return true;
    });
}

// Selo de situação: "Em andamento" não aparece mais; no lugar entra "Pedido em aberto" (quando houver)
const SITUACAO = { CONCLUIDO: ['Concluído', 'ok'], SEM_ITENS: ['Sem itens', 'neutro'] };

/** 'abóbora moranga, alface crespa' -> 'Abóbora moranga, alface crespa' */
function textoResumo(lista) {
    const t = (lista || []).join(', ');
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function linhaEmpenho(e) {
    const [rot, cls] = SITUACAO[e.situacao] || ['', ''];
    const resumo = textoResumo(e.itens_resumo);
    const qt = (e.itens_resumo || []).length;
    return `
        <tr>
            <td class="text-left"><div class="ne-linha"><strong>${esc(e.ne)}</strong>${resumo
                ? `<span class="ne-itens" title="${esc(`${qt} ${qt > 1 ? 'itens' : 'item'}: ${resumo}`)}">${esc(resumo)}</span>` : ''}</div>
                <div class="cell-badges">${rot ? `<span class="badge ${cls}">${rot}</span>` : ''}
                ${e.pedidos_em_aberto ? `<span class="badge info" title="Pedidos ainda não entregues por completo">${ico('hourglass')} ${e.pedidos_em_aberto > 1 ? `${e.pedidos_em_aberto} pedidos em aberto` : 'Pedido em aberto'}</span>` : ''}
                ${e.pedidos_atrasados ? `<span class="badge critico" title="Pedidos com entrega vencida">${ico('alarm')} ${e.pedidos_atrasados} atrasado${e.pedidos_atrasados > 1 ? 's' : ''}</span>` : ''}
                ${e.nfs_a_pagar ? `<span class="badge atencao" title="NFs recebidas aguardando pagamento">${ico('cash')} ${e.nfs_a_pagar} NF${e.nfs_a_pagar > 1 ? 's' : ''} a pagar</span>` : ''}</div></td>
            <td class="col-forn">${esc(e.nome_credor)}</td>
            <td>${esc(e.processo)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money text-teal">${fmtMoney(e.valor_liquidado)}</td>
            <td class="num money text-green">${fmtMoney(e.valor_pago)}</td>
            <td class="num money text-red">${fmtMoney(e.a_liquidar)}</td>
            <td>${pctCell(e.percentual_liquidado)}</td>
            <td class="acoes">
                <button class="btn btn-sm btn-secondary" onclick="abrirDetalhe(${e.id})">Abrir</button>
                <button class="btn btn-sm btn-danger" title="Apagar empenho" aria-label="Apagar empenho ${esc(e.ne)}" onclick="apagarEmpenho(${e.id})">${ico('trash')}</button>
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
                ${atrasos ? `<span class="badge critico">${ico('alarm')} ${fmtNum(atrasos)}</span>` : ''}
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
        $('tbodyEmpenhos').innerHTML = `<tr><td colspan="9" class="empty"><span class="empty-icon">${ico('inbox', 'ico ico-empty')}</span>Nenhum empenho cadastrado ainda.<br>Clique em "Novo Empenho" para começar.</td></tr>`;
        return;
    }
    if (!lista.length) {
        $('tbodyEmpenhos').innerHTML = `<tr><td colspan="9" class="empty"><span class="empty-icon">${ico('search', 'ico ico-empty')}</span>Nenhum empenho encontrado com esses filtros.</td></tr>`;
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
    $('mResumo').value = e ? (e.resumo || '') : '';
    carregarFornecedores().then(infoCredor);
    const auto = e ? (estado.resumoAuto || '') : '';
    $('mResumo').placeholder = auto ? `Automático: ${auto}` : 'Automático (gerado a partir dos itens)';
    abrirModal('modalEmpenho');
}

async function salvarEmpenho() {
    const corpo = { ne: $('mNe').value.trim(), processo: $('mProcesso').value.trim(), nome_credor: $('mCredor').value.trim(),
        resumo: $('mResumo').value.trim() };
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
        resumoAuto: data.resumo_auto || '',
    });
    const e = data.empenho, f = data.financeiro;
    document.title = `${e.ne} — Empenhos`;
    $('detTitulo').innerHTML = `Empenho ${esc(e.ne)} — ${esc(e.nome_credor)}`;
    renderKpisEmpenho(e, f);
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
                <button class="btn btn-sm btn-secondary" title="Editar item" aria-label="Editar item" onclick="editarItem(${i.id})">${ico('pencil')}</button>
                <button class="btn btn-sm btn-secondary" title="Reforço ou anulação de quantidade" aria-label="Reforço ou anulação" onclick="abrirMovimento(${i.id})">${ico('plus-minus')}</button>
                <button class="btn btn-sm btn-danger" title="Excluir item" aria-label="Excluir item" onclick="excluirItem(${i.id})">${ico('trash')}</button>
            </td>
        </tr>`).join('') : `<tr><td colspan="12" class="empty"><span class="empty-icon">${ico('file-text', 'ico ico-empty')}</span>Nenhum item. Clique em "Itens".</td></tr>`;
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
                        <td><span class="badge ${m.tipo === 'REFORCO' ? 'ok' : 'critico'}">${m.tipo === 'REFORCO' ? 'Reforço (+)' : 'Anulação (−)'}</span></td>
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
    INCLUIDO: ['Em aberto', 'info'], ENCERRADO: ['Encerrado', 'neutro'],
};

function renderPedidos() {
    const pedidos = ordenar(estado.pedidos, estado.sortPedidos.key, estado.sortPedidos.dir);
    $('tbodyPedidos').innerHTML = pedidos.length ? pedidos.map(p => {
        const [rot, cls] = STATUS[p.status] || [p.status, 'info'];
        const aberto = p.status === 'INCLUIDO' || p.status === 'PARCIAL';
        const venc = p.vencimento
            ? `${dataBR(p.vencimento)}${p.dias_atraso ? `<div><span class="badge critico">${ico('alarm')} ${p.dias_atraso} dia${p.dias_atraso > 1 ? 's' : ''} de atraso</span></div>` : ''}`
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
                ${aberto ? `<button class="btn btn-sm btn-primary" onclick="abrirRecebimento(${p.id})">${ico('package-import')} Receber</button>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="baixarPdf(${p.id})" title="PDF do pedido para o fornecedor" aria-label="PDF do pedido">${ico('file-type-pdf')}</button>
                <button class="btn btn-sm btn-secondary${p.enviado_em ? ' btn-enviado' : ''}" onclick="enviarPedido(${p.id})"
                    title="${p.enviado_em ? `E-mail aberto em ${dataBR(p.enviado_em)}${p.enviado_por ? ` por ${esc(p.enviado_por)}` : ''} — clique para enviar de novo` : 'Enviar o pedido por e-mail ao fornecedor'}"
                    aria-label="Enviar pedido por e-mail">${ico('send')}${p.enviado_em ? `<span class="pill ok">${ico('check', 'ico ico-xs')}</span>` : (aberto ? ' Enviar' : '')}</button>
                ${p.qt_nfs > 0 ? `<button class="btn btn-sm ${p.qt_nfs_a_pagar ? 'btn-attention' : 'btn-secondary'}" onclick="verNfs(${p.id})"
                    title="${p.qt_nfs_a_pagar ? `${p.qt_nfs_a_pagar} NF(s) aguardando pagamento — clique para marcar como paga` : 'Todas as NFs pagas'}"
                    aria-label="Notas fiscais">${ico('file-invoice')} NFs ${p.qt_nfs_a_pagar ? `<span class="pill">${p.qt_nfs_a_pagar} a pagar</span>` : `<span class="pill ok" title="Todas as NFs pagas">${ico('check', 'ico ico-xs')}</span>`}</button>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="editarPedido(${p.id})" title="Editar pedido" aria-label="Editar pedido">${ico('pencil')}</button>
                ${p.status === 'PARCIAL' || p.status === 'INCLUIDO' ? `<button class="btn btn-sm btn-secondary" onclick="encerrarPedido(${p.id}, false)" title="Encerrar: o que falta não virá e volta ao saldo a pedir" aria-label="Encerrar pedido">${ico('lock')}</button>` : ''}
                ${p.status === 'ENCERRADO' ? `<button class="btn btn-sm btn-secondary" onclick="encerrarPedido(${p.id}, true)" title="Reabrir pedido" aria-label="Reabrir pedido">${ico('lock-open')}</button>` : ''}
                <button class="btn btn-sm btn-danger" title="Excluir pedido" aria-label="Excluir pedido" onclick="excluirPedido(${p.id})">${ico('trash')}</button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="8" class="empty"><span class="empty-icon">${ico('file-invoice', 'ico ico-empty')}</span>Nenhum pedido. Clique em "Fazer Pedido".</td></tr>`;
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
                <button class="btn btn-sm btn-danger" onclick="excluirObAntiga(${o.id})" aria-label="Excluir OB ${esc(o.ob)}">${ico('trash')}</button></li>`).join('')}</ul>
        </div>`;
}

async function excluirObAntiga(id) {
    const o = estado.obsAntigas.find(x => x.id === id);
    if (!confirm(`Excluir o lançamento da OB ${o ? o.ob : ''}? (vai para a lixeira)`)) return;
    await acao(enviarJSON(`/api/pagamentos/${id}`, 'DELETE'), 'Lançamento antigo enviado para a lixeira');
}

// ---------- Histórico do empenho ----------
const ACOES = {
    CRIAR: 'plus', EDITAR: 'pencil', EXCLUIR: 'trash', RESTAURAR: 'restore', RECEBER: 'package-import', PAGAR: 'cash',
    DESFAZER: 'arrow-back-up', ENCERRAR: 'lock', REFORCO: 'plus', ANULACAO: 'plus-minus', LOGIN: 'key', EXPORTAR: 'download',
};
async function carregarHistorico() {
    $('listaHistorico').innerHTML = '<li class="muted">Carregando…</li>';
    try {
        const h = await fetchJSON(`/api/historico?empenho_id=${estado.empenhoId}&limite=100`);
        $('listaHistorico').innerHTML = h.length ? h.map(x => `
            <li><span class="tl-ico">${ico(ACOES[x.acao] || 'history')}</span>
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
        <td><button class="btn btn-sm btn-danger" type="button" aria-label="Remover linha" onclick="removerLinha(this)">${ico('x')}</button></td>`;
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
        ? `${r.ok} item(ns) adicionado(s) à lista${r.ignoradas ? `, ${r.ignoradas} linha(s) ignorada(s)` : ''}. Confira e salve.`
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
        : (d.recebimentos.length ? `<span class="badge ok">${ico('circle-check')} todas pagas</span>` : '')}`;
    $('nfCorpo').innerHTML = d.recebimentos.length ? d.recebimentos.map((nf, idx) => `
        <div class="nf-card ${nf.pago_em ? 'nf-paga' : ''}">
            <div class="nf-head">
                <span class="nf-ico">${ico('file-invoice', 'ico ico-lg')}</span>
                <div class="nf-title">
                    <strong>NF ${esc(nf.nf)}</strong>
                    <span class="muted"> • ${dataBR(nf.data_recebimento) || '—'} • ${fmtMoney(nf.valor)}</span>
                    <div class="nf-status">${nf.pago_em
                        ? `<span class="badge ok">${ico('circle-check')} Paga em ${dataBR(nf.pago_em).slice(0, 10)}</span> <span class="muted small">por ${esc(nf.pago_por || '—')}</span>`
                        : `<span class="badge atencao">${ico('hourglass')} Aguardando pagamento</span>`}</div>
                </div>
                <div class="nf-acoes">
                    ${nf.pago_em
                        ? `<button class="btn btn-sm btn-secondary" onclick="pagarNf(${idx}, false)" title="Desmarcar o pagamento desta NF">${ico('arrow-back-up')} Desfazer</button>`
                        : `<button class="btn btn-sm btn-success" onclick="pagarNf(${idx}, true)">${ico('check')} Marcar como paga</button>`}
                    <button class="btn btn-sm btn-secondary" onclick="abrirCorrecaoNf(${idx})" ${nf.pago_em ? 'disabled title="Desfaça o pagamento para corrigir"' : ''}>${ico('pencil')} Corrigir</button>
                    <button class="btn btn-sm btn-danger" onclick="excluirNf(${idx})" aria-label="Excluir NF" ${nf.pago_em ? 'disabled title="Desfaça o pagamento para excluir"' : ''}>${ico('trash')}</button>
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
        fetchJSON('/api/stats_empenhos').then(marcarPendencias).catch(() => { /* contador é opcional */ });
    } else {
        const sit = new URLSearchParams(location.search).get('situacao');
        if (sit && [...$('fSituacao').options].some(o => o.value === sit)) {
            $('fSituacao').value = sit;
            history.replaceState({}, '', '/empenhos'); // o filtro fica aplicado, a URL fica limpa
        }
        const forn = new URLSearchParams(location.search).get('fornecedor');
        if (forn) { $('fBusca').value = forn; history.replaceState({}, '', '/empenhos'); }
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


// =====================================================================
// FORNECEDORES no cadastro do empenho (lista para escolher + contato)
// =====================================================================
let fornecedoresCache = null;
async function carregarFornecedores(forcar = false) {
    if (fornecedoresCache && !forcar) return fornecedoresCache;
    try { fornecedoresCache = await fetchJSON('/api/fornecedores'); } catch { fornecedoresCache = []; }
    $('listaFornecedores').innerHTML = fornecedoresCache.map(f => `<option value="${esc(f.nome)}">${f.email ? esc(f.email) : ''}</option>`).join('');
    return fornecedoresCache;
}
const chaveNome = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
function infoCredor() {
    const nome = chaveNome($('mCredor').value);
    const f = nome && (fornecedoresCache || []).find(x => chaveNome(x.nome) === nome);
    const el = $('credorInfo');
    if (!nome) { el.innerHTML = ''; return; }
    if (!f) { el.innerHTML = `Fornecedor novo. Depois, cadastre o contato em <a href="/fornecedores">Fornecedores</a> para poder enviar pedidos por e-mail.`; return; }
    const partes = [f.email && `${ico('mail', 'ico ico-xs')} ${esc(f.email)}`, f.telefone && `${ico('phone', 'ico ico-xs')} ${esc(f.telefone)}`].filter(Boolean);
    el.innerHTML = partes.length ? `<span class="credor-contato">${partes.join(' · ')}</span>`
        : `Sem contato cadastrado. <a href="/fornecedores">Cadastrar em Fornecedores</a>.`;
}

// =====================================================================
// ENVIAR PEDIDO POR E-MAIL — modelo de texto fixo; o anexo vai pelo PDF
// =====================================================================
const envio = { pid: null, dados: null };

async function enviarPedido(pid) {
    let d;
    try { d = await fetchJSON(`/api/pedidos/${pid}/email`); } catch (err) { toast(err.message, 'error'); return; }
    if (!d.ok) { toast(d.error, 'error'); return; }
    envio.pid = pid; envio.dados = d;
    const p = estado.pedidos.find(x => x.id === pid);
    $('envTitulo').textContent = `Enviar Pedido ${p ? p.numero_pedido : ''} — ${d.fornecedor}`;
    $('envPara').value = d.para || '';
    $('envAssunto').value = d.assunto;
    $('envCorpo').value = d.corpo;
    const semEmail = !d.para;
    $('envAviso').hidden = !semEmail;
    $('envAviso').innerHTML = semEmail
        ? `${ico('alert-triangle')} <span>${esc(d.fornecedor)} está sem e-mail cadastrado. Digite o e-mail abaixo (ele pode ser salvo no cadastro) ou cadastre em <a href="/fornecedores">Fornecedores</a>.</span>` : '';
    $('envSalvarBox').hidden = true;
    $('envSalvar').checked = true;
    $('envEnviado').textContent = d.enviado_em ? `Último envio preparado em ${dataBR(d.enviado_em)}${d.enviado_por ? ` por ${d.enviado_por}` : ''}.` : '';
    abrirModal('modalEnviar');
    setTimeout(() => (semEmail ? $('envPara') : $('envCorpo')).focus(), 40);
}

function envioCampos() {
    return { para: $('envPara').value.trim().replace(/\s*[;,]\s*/g, ','), assunto: $('envAssunto').value.trim(), corpo: $('envCorpo').value };
}

function envioValido() {
    const { para } = envioCampos();
    if (!para) { toast('Informe o e-mail do fornecedor', 'error'); $('envPara').focus(); return false; }
    if (!para.split(',').every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) { toast('E-mail inválido', 'error'); $('envPara').focus(); return false; }
    return true;
}

async function aposAbrirEmail(meio) {
    const { para } = envioCampos();
    // Salva o e-mail digitado no cadastro do fornecedor (quando pedido)
    if (!$('envSalvarBox').hidden && $('envSalvar').checked && para) {
        try {
            const lista = await carregarFornecedores(true);
            const f = lista.find(x => chaveNome(x.nome) === chaveNome(envio.dados.fornecedor));
            const corpo = { ...(f || {}), nome: envio.dados.fornecedor, email: para };
            const r = f && f.id ? await enviarJSON(`/api/fornecedores/${f.id}`, 'PUT', corpo) : await enviarJSON('/api/fornecedores', 'POST', corpo);
            if (r && r.ok) { toast('E-mail salvo no cadastro do fornecedor', 'success'); envio.dados.para = para; $('envSalvarBox').hidden = true; $('envAviso').hidden = true; }
        } catch { /* segue sem salvar */ }
    }
    try { await enviarJSON(`/api/pedidos/${envio.pid}/email/registrar`, 'POST', { meio, para }); } catch { /* registro é opcional */ }
    if (estado.empenhoId) abrirDetalhe(estado.empenhoId, { pushUrl: false, rolar: false });
}

function baixarArquivo(url) {
    const a = document.createElement('a');
    a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
}

function abrirGmail() {
    if (!envioValido()) return;
    const { para, assunto, corpo } = envioCampos();
    const q = new URLSearchParams({ view: 'cm', fs: '1', to: para, su: assunto, body: corpo });
    window.open(`https://mail.google.com/mail/?${q.toString()}`, '_blank', 'noopener');
    baixarArquivo(`/api/pedidos/${envio.pid}/pdf`);
    toast('PDF baixado: arraste o arquivo para o e-mail no Gmail', 'success');
    aposAbrirEmail('gmail');
}

function abrirMailto() {
    if (!envioValido()) return;
    const { para, assunto, corpo } = envioCampos();
    baixarArquivo(`/api/pedidos/${envio.pid}/pdf`);
    location.href = `mailto:${para.split(',').map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo.replace(/\n/g, '\r\n'))}`;
    toast('PDF baixado: anexe o arquivo ao e-mail', 'success');
    aposAbrirEmail('mailto');
}

async function baixarEml() {
    if (!envioValido()) return;
    const b = $('envEml'); b.disabled = true;
    try {
        const res = await fetch(`/api/pedidos/${envio.pid}/email.eml`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envioCampos()),
        });
        if (!res.ok) throw new Error('Não foi possível gerar o e-mail');
        const blob = await res.blob();
        const nome = (/filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'pedido.eml';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('Arquivo de e-mail baixado: abra-o para enviar (o PDF já está anexado)', 'success');
        aposAbrirEmail('eml');
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
}

async function copiarTextoEmail() {
    const { para, assunto, corpo } = envioCampos();
    const txt = `Para: ${para}\nAssunto: ${assunto}\n\n${corpo}`;
    try { await navigator.clipboard.writeText(txt); toast('Texto copiado', 'success'); }
    catch { $('envCorpo').select(); document.execCommand('copy'); toast('Texto copiado', 'success'); }
}

document.addEventListener('DOMContentLoaded', () => {
    $('mCredor').addEventListener('input', infoCredor);
    $('envGmail').addEventListener('click', abrirGmail);
    $('envEml').addEventListener('click', baixarEml);
    $('envMailto').addEventListener('click', abrirMailto);
    $('envCopiar').addEventListener('click', copiarTextoEmail);
    $('envPara').addEventListener('input', () => {
        const mudou = $('envPara').value.trim() && $('envPara').value.trim() !== (envio.dados && envio.dados.para || '');
        $('envSalvarBox').hidden = !mudou;
    });
});
