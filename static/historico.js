// Histórico de alterações e Lixeira
const H = { hist: [], lixo: [] };
const $ = (id) => document.getElementById(id);

const ACAO_ROTULO = {
    CRIAR: ['plus', 'Criou', 'info'], EDITAR: ['pencil', 'Editou', 'neutro'], EXCLUIR: ['trash', 'Excluiu', 'critico'],
    RESTAURAR: ['restore', 'Restaurou', 'ok'], RECEBER: ['package-import', 'Recebeu NF', 'ok'], PAGAR: ['cash', 'NF paga', 'ok'],
    ENCERRAR: ['lock', 'Encerrou', 'atencao'], REFORCO: ['plus', 'Reforço', 'ok'], ANULACAO: ['plus-minus', 'Anulação', 'atencao'],
    LOGIN: ['key', 'Entrou', 'neutro'], DESFAZER: ['arrow-back-up', 'Desfez pagamento', 'atencao'], EXPORTAR: ['download', 'Exportou', 'neutro'],
};
const TIPO_ROTULO = { empenho: ['receipt', 'Empenho'], item: ['file-text', 'Item'], pedido: ['clipboard-list', 'Pedido'], nf: ['file-invoice', 'NF'], pagamento: ['cash', 'Pagamento'] };

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
        const [icone, rot, cls] = ACAO_ROTULO[h.acao] || ['history', h.acao, 'neutro'];
        return `<tr>
            <td class="nowrap">${dataBR(h.quando)}</td>
            <td>${escapeHTML(h.usuario)}</td>
            <td><span class="badge ${cls}">${ico(icone)} ${rot}</span></td>
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
});
