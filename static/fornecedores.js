// Cadastro de fornecedores (contato). A lista também traz os nomes que só
// aparecem nos empenhos, para cadastrar o contato com um clique.
const $ = (id) => document.getElementById(id);
const F = { lista: [], editando: null, sort: { key: 'nome', dir: 'asc' } };

function mascaraCnpj(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 14);
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
function mascaraTel(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

async function carregar() {
    $('tbodyForn').innerHTML = linhaCarregando(6);
    try { F.lista = await fetchJSON('/api/fornecedores'); }
    catch (err) { showToast(err.message, 'error'); $('tbodyForn').innerHTML = `<tr><td colspan="6" class="empty">${escapeHTML(err.message)}</td></tr>`; return; }
    render();
}

function render() {
    const busca = normalizar($('fBusca').value.trim()), filtro = $('fFiltro').value;
    let lista = F.lista.filter(f =>
        (!busca || normalizar(`${f.nome} ${f.cnpj} ${f.email} ${f.telefone} ${f.contato}`).includes(busca) ||
            String(f.cnpj || '').replace(/\D/g, '').includes(busca.replace(/\D/g, '') || '§')) &&
        (filtro !== 'SEM' || !f.email) && (filtro !== 'ABERTO' || f.pedidos_em_aberto > 0));
    lista = ordenar(lista, F.sort.key, F.sort.dir);
    const semEmail = F.lista.filter(f => !f.email).length;
    $('countBadge').textContent = `${F.lista.length}${semEmail ? ` · ${semEmail} sem e-mail` : ''}`;
    $('tbodyForn').innerHTML = lista.length ? lista.map((f, i) => {
        const idx = F.lista.indexOf(f);
        const tel = f.telefone ? f.telefone.replace(/\D/g, '') : '';
        const contato = [
            f.contato && `<div>${ico('user')}${escapeHTML(f.contato)}</div>`,
            f.email && `<div>${ico('mail')}${f.email.split(/\s*,\s*/).map(e => `<a href="mailto:${escapeHTML(e)}">${escapeHTML(e)}</a>`).join(', ')}</div>`,
            f.telefone && `<div>${ico('phone')}<a href="tel:${tel}">${escapeHTML(f.telefone)}</a></div>`,
        ].filter(Boolean).join('');
        return `<tr>
            <td class="text-left"><span class="forn-nome">${escapeHTML(f.nome)}</span>
                ${f.cnpj ? `<span class="forn-sub">CNPJ ${escapeHTML(f.cnpj)}</span>` : ''}
                ${f.observacoes ? `<span class="forn-sub">${escapeHTML(f.observacoes)}</span>` : ''}</td>
            <td class="text-left forn-contato">${contato || `<span class="sem-contato">${ico('alert-triangle')} Sem contato cadastrado</span>`}</td>
            <td>${f.empenhos ? `<a href="/empenhos?fornecedor=${encodeURIComponent(f.nome)}">${f.empenhos}</a>` : '<span class="muted">—</span>'}</td>
            <td class="nowrap ${f.a_liquidar > 0.005 ? 'text-red' : 'muted'}">${f.empenhos ? fmtMoney(f.a_liquidar) : '—'}</td>
            <td>${f.pedidos_em_aberto ? `<span class="badge info">${ico('hourglass')} ${f.pedidos_em_aberto}</span>` : '<span class="muted">—</span>'}</td>
            <td class="acoes">
                <button class="btn btn-sm ${f.cadastrado ? 'btn-secondary' : 'btn-primary'}" onclick="abrirForm(${idx})">${f.cadastrado ? `${ico('pencil')} Editar` : `${ico('plus')} Cadastrar contato`}</button>
                ${f.cadastrado ? `<button class="btn btn-sm btn-danger" title="Apagar cadastro" aria-label="Apagar cadastro de ${escapeHTML(f.nome)}" onclick="apagar(${idx})">${ico('trash')}</button>` : ''}
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty"><span class="empty-icon">${ico('truck', 'ico ico-empty')}</span>Nenhum fornecedor encontrado.</td></tr>`;
}

function abrirForm(idx) {
    const f = idx === undefined ? null : F.lista[idx];
    F.editando = f;
    $('fornTitulo').textContent = !f ? 'Novo fornecedor' : (f.cadastrado ? `Editar ${f.nome}` : `Cadastrar contato — ${f.nome}`);
    $('fNome').value = f ? f.nome : '';
    $('fCnpj').value = f ? (f.cnpj || '') : '';
    $('fTelefone').value = f ? (f.telefone || '') : '';
    $('fEmail').value = f ? (f.email || '') : '';
    $('fContato').value = f ? (f.contato || '') : '';
    $('fObs').value = f ? (f.observacoes || '') : '';
    $('fNomeAjuda').hidden = !(f && f.empenhos);
    $('modalForn').style.display = 'flex';
    setTimeout(() => (f ? $('fEmail') : $('fNome')).focus(), 30);
}
function fecharForm() { $('modalForn').style.display = 'none'; }

async function salvar() {
    const corpo = {
        nome: $('fNome').value.trim(), cnpj: $('fCnpj').value.trim(), telefone: $('fTelefone').value.trim(),
        email: $('fEmail').value.trim(), contato: $('fContato').value.trim(), observacoes: $('fObs').value.trim(),
    };
    if (!corpo.nome) { showToast('Informe o nome do fornecedor', 'error'); return; }
    const f = F.editando;
    if (f && f.id && f.empenhos && corpo.nome.toUpperCase() !== f.nome &&
        !confirm(`Mudar o nome de "${f.nome}" para "${corpo.nome.toUpperCase()}"?\n\nOs ${f.empenhos} empenho(s) com o nome antigo também serão atualizados.`)) return;
    const b = $('btnSalvar'); b.disabled = true;
    try {
        const d = f && f.id ? await enviarJSON(`/api/fornecedores/${f.id}`, 'PUT', corpo) : await enviarJSON('/api/fornecedores', 'POST', corpo);
        if (!d.ok) { showToast(d.error, 'error'); return; }
        showToast(d.empenhos_renomeados ? `Salvo. Nome atualizado em ${d.empenhos_renomeados} empenho(s).` : 'Fornecedor salvo!', 'success');
        fecharForm();
        await carregar();
    } catch (err) { showToast(err.message, 'error'); }
    finally { b.disabled = false; }
}

async function apagar(idx) {
    const f = F.lista[idx];
    if (!confirm(`Apagar o cadastro de ${f.nome}?\n\nOs empenhos continuam com o nome; só o contato sai (dá para restaurar na Lixeira).`)) return;
    try {
        const d = await enviarJSON(`/api/fornecedores/${f.id}`, 'DELETE');
        if (!d.ok) { showToast(d.error, 'error'); return; }
        showToast('Cadastro enviado para a lixeira', 'success');
        await carregar();
    } catch (err) { showToast(err.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
    ['fBusca', 'fFiltro'].forEach(id => $(id).addEventListener('input', render));
    $('btnNovo').addEventListener('click', () => abrirForm());
    $('btnSalvar').addEventListener('click', salvar);
    $('fCnpj').addEventListener('input', (e) => { e.target.value = mascaraCnpj(e.target.value); });
    $('fTelefone').addEventListener('input', (e) => { e.target.value = mascaraTel(e.target.value); });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', fecharForm));
    $('modalForn').addEventListener('mousedown', (e) => { if (e.target === $('modalForn')) fecharForm(); });
    $('modalForn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') salvar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modalForn').style.display === 'flex') fecharForm(); });
    ativarOrdenacao($('tblForn'), F.sort, render);
    carregar();
    fetchJSON('/api/stats_empenhos').then(marcarPendencias).catch(() => { /* contador é opcional */ });
});
