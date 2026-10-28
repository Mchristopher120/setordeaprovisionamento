// Histórico de alterações e Lixeira
const H = { hist: [], lixo: [] };
const $ = (id) => document.getElementById(id);

const ACAO_ROTULO = {
    CRIAR: ['🆕 Criou', 'info'], EDITAR: ['✏️ Editou', 'neutro'], EXCLUIR: ['🗑 Excluiu', 'critico'],
    RESTAURAR: ['♻️ Restaurou', 'ok'], RECEBER: ['📥 Recebeu NF', 'ok'], PAGAR: ['💰 NF paga', 'ok'],
    ENCERRAR: ['🔒 Encerrou', 'atencao'], REFORCO: ['➕ Reforço', 'ok'], ANULACAO: ['➖ Anulação', 'atencao'],
    LOGIN: ['🔑 Entrou', 'neutro'], DESFAZER: ['↩ Desfez pagamento', 'atencao'], EXPORTAR: ['⬇ Exportou', 'neutro'],
};
const TIPO_ROTULO = { empenho: '📦 Empenho', item: '📄 Item', pedido: '🧾 Pedido', nf: '🧾 NF', pagamento: '💰 Pagamento' };

async function carregar() {
    $('tbodyHist').innerHTML = linhaCarregando(5);
    $('tbodyLixo').innerHTML = linhaCarregando(5);
    try {
        [H.hist, H.lixo] = await Promise.all([fetchJSON('/api/historico?limite=1000'), fetchJSON('/api/lixeira')]);
    } catch (err) {
        showToast(err.message, 'error');
        $('tbodyHist').innerHTML = `<tr><td colspan="5" class="empty">${escapeHTML(err.message)}</td></tr>`;
        return;
    }
    const usuarios = [...new Set(H.hist.map(h => h.usuario).filter(Boolean))].sort();
    $('hUsuario').innerHTML = '<option value="">Todos os usuários</option>' + usuarios.map(u => `<option>${escapeHTML(u)}</option>`).join('');
    renderHist();
    renderLixo();
}

function renderHist() {
    const busca = normalizar($('hBusca').value.trim()), acao = $('hAcao').value, usuario = $('hUsuario').value;
    const lista = H.hist.filter(h =>
        (!acao || h.acao === acao) && (!usuario || h.usuario === usuario) &&
        (!busca || normalizar(`${h.descricao} ${h.ne || ''} ${h.usuario}`).includes(busca)));
    $('tbodyHist').innerHTML = lista.length ? lista.map(h => {
        const [rot, cls] = ACAO_ROTULO[h.acao] || [h.acao, 'neutro'];
        return `<tr>
            <td class="nowrap">${dataBR(h.quando)}</td>
            <td>${escapeHTML(h.usuario)}</td>
            <td><span class="badge ${cls}">${rot}</span></td>
            <td>${h.ne ? `<a href="/empenhos?id=${h.empenho_id}">${escapeHTML(h.ne)}</a>` : '<span class="muted">—</span>'}</td>
            <td class="text-left">${escapeHTML(h.descricao)}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="5" class="empty">Nenhum registro encontrado.</td></tr>`;
}

function renderLixo() {
    $('lixoCount').textContent = fmtNum(H.lixo.length);
    $('tbodyLixo').innerHTML = H.lixo.length ? H.lixo.map(l => `
        <tr>
            <td class="nowrap">${dataBR(l.quando)}</td>
            <td>${escapeHTML(l.usuario)}</td>
            <td>${TIPO_ROTULO[l.tipo] || escapeHTML(l.tipo)}</td>
            <td class="text-left">${escapeHTML(l.descricao)}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="restaurar(${l.id}, this)">♻️ Restaurar</button></td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty"><span class="empty-icon">🗑</span>A lixeira está vazia.</td></tr>`;
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
});
