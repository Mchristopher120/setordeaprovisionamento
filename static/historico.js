// Histórico de alterações e Lixeira
const H = { hist: [], lixo: [] };
const $ = (id) => document.getElementById(id);

const ACAO_ROTULO = {
    CRIAR: ['plus', 'Criou', 'info'], EDITAR: ['pencil', 'Editou', 'neutro'], EXCLUIR: ['trash', 'Excluiu', 'critico'],
    RESTAURAR: ['restore', 'Restaurou', 'ok'], RECEBER: ['package-import', 'Recebeu NF', 'ok'], PAGAR: ['cash', 'NF paga', 'ok'],
    ENCERRAR: ['lock', 'Encerrou', 'atencao'], REFORCO: ['plus', 'Reforço', 'ok'], ANULACAO: ['plus-minus', 'Anulação', 'atencao'],
    LOGIN: ['key', 'Entrou', 'neutro'], DESFAZER: ['arrow-back-up', 'Desfez pagamento', 'atencao'], EXPORTAR: ['download', 'Exportou', 'neutro'],
    IMPORTAR: ['file-upload', 'Importou', 'info'], ENVIAR: ['send', 'E-mail do pedido', 'info'],
};
const TIPO_ROTULO = { empenho: ['receipt', 'Empenho'], item: ['file-text', 'Item'], pedido: ['clipboard-list', 'Pedido'], nf: ['file-invoice', 'NF'], pagamento: ['cash', 'Pagamento'], fornecedor: ['truck', 'Fornecedor'] };

async function carregar() {
    $('listaHist').innerHTML = `<p class="loading-row"><span class="spinner"></span> Carregando…</p>`;
    $('tbodyLixo').innerHTML = linhaCarregando(5);
    try {
        [H.hist, H.lixo] = await Promise.all([fetchJSON('/api/historico?limite=1000'), fetchJSON('/api/lixeira')]);
    } catch (err) {
        showToast(err.message, 'error');
        $('listaHist').innerHTML = `<div class="empty">${escapeHTML(err.message)}</div>`;
        return;
    }
    const usuarios = [...new Set(H.hist.map(h => h.usuario).filter(Boolean))].sort();
    $('hUsuario').innerHTML = '<option value="">Todos os usuários</option>' + usuarios.map(u => `<option>${escapeHTML(u)}</option>`).join('');
    renderHist();
    renderLixo();
}

/** "Hoje", "Ontem" ou "quinta-feira, 12 de novembro de 2026". */
function rotuloDia(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    const dia = new Date(a, m - 1, d), hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const diff = Math.round((hoje - dia) / 86400000);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Ontem';
    const t = dia.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: a === hoje.getFullYear() ? undefined : 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Histórico como linha do tempo, agrupado por dia (lê-se como um diário, não como planilha). */
function renderHist() {
    const busca = normalizar($('hBusca').value.trim()), acao = $('hAcao').value, usuario = $('hUsuario').value;
    const lista = H.hist.filter(h =>
        (!acao || h.acao === acao) && (!usuario || h.usuario === usuario) &&
        (!busca || normalizar(`${h.descricao} ${h.ne || ''} ${h.usuario}`).includes(busca)));
    $('histNota').textContent = lista.length === H.hist.length
        ? `${fmtNum(lista.length)} registros${H.hist.length >= 1000 ? ' (os 1.000 mais recentes)' : ''}.`
        : `${fmtNum(lista.length)} de ${fmtNum(H.hist.length)} registros.`;
    if (!lista.length) {
        $('listaHist').innerHTML = `<div class="empty"><span class="empty-icon">${ico('history', 'ico ico-empty')}</span>Nenhum registro encontrado.</div>`;
        return;
    }
    const dias = new Map();
    lista.forEach(h => {
        const k = (h.quando || '').slice(0, 10);
        if (!dias.has(k)) dias.set(k, []);
        dias.get(k).push(h);
    });
    $('listaHist').innerHTML = [...dias.entries()].map(([dia, regs]) => `
        <section class="lt-dia">
            <h4 class="lt-data">${rotuloDia(dia)} <span class="count-badge">${regs.length}</span></h4>
            <ol class="lt-lista">${regs.map(h => {
                const [icone, rot, cls] = ACAO_ROTULO[h.acao] || ['history', h.acao, 'neutro'];
                return `<li class="lt-item">
                    <span class="lt-ico ${cls}" title="${rot}">${ico(icone)}</span>
                    <div class="lt-corpo">
                        <p class="lt-desc">${escapeHTML(h.descricao)}</p>
                        <p class="lt-meta"><span class="lt-acao">${rot}</span><span>${(h.quando || '').slice(11, 16)}</span><span>${escapeHTML(h.usuario)}</span>${h.ne
                            ? `<a href="/empenhos?id=${h.empenho_id}">${escapeHTML(h.ne)}</a>` : ''}</p>
                    </div>
                </li>`;
            }).join('')}</ol>
        </section>`).join('');
}

function renderLixo() {
    $('lixoCount').textContent = fmtNum(H.lixo.length);
    $('tbodyLixo').innerHTML = H.lixo.length ? H.lixo.map(l => `
        <tr>
            <td class="nowrap">${dataBR(l.quando)}</td>
            <td>${escapeHTML(l.usuario)}</td>
            <td>${TIPO_ROTULO[l.tipo] ? `<span class="com-ico">${ico(TIPO_ROTULO[l.tipo][0])} ${TIPO_ROTULO[l.tipo][1]}</span>` : escapeHTML(l.tipo)}</td>
            <td class="text-left">${escapeHTML(l.descricao)}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="restaurar(${l.id}, this)">${ico('restore')} Restaurar</button></td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty"><span class="empty-icon">${ico('trash', 'ico ico-empty')}</span>A lixeira está vazia.</td></tr>`;
}

async function restaurar(id, btn) {
    const l = H.lixo.find(x => x.id === id);
    if (!confirm(`Restaurar: ${l ? l.descricao : ''}?`)) return;
    btn.disabled = true;
    try {
        const d = await enviarJSON(`/api/lixeira/${id}/restaurar`, 'POST');
        if (!d.ok) { showToast(d.error, 'error'); btn.disabled = false; return; }
        showToast(d.puladas ? `Restaurado, mas ${d.puladas} registro(s) não puderam voltar.` : 'Restaurado com sucesso!', d.puladas ? '' : 'success');
        await carregar();
    } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
}

function trocarAba(nome) {
    document.querySelectorAll('.tab').forEach(t => {
        const ativo = t.dataset.tab === nome;
        t.classList.toggle('active', ativo);
        t.setAttribute('aria-selected', ativo);
    });
    $('tab-hist').hidden = nome !== 'hist';
    $('tab-lixo').hidden = nome !== 'lixo';
    history.replaceState(null, '', nome === 'lixo' ? '#lixeira' : location.pathname);
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => trocarAba(t.dataset.tab)));
    ['hBusca', 'hAcao', 'hUsuario'].forEach(id => $(id).addEventListener('input', renderHist));
    if (location.hash === '#lixeira') trocarAba('lixo');
    carregar();
    fetchJSON('/api/stats_empenhos').then(marcarPendencias).catch(() => { /* contador é opcional */ });
});
