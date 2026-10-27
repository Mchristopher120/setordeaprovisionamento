// Utilitários compartilhados pelo Dashboard e pela tela de Empenhos.

const fmtMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtMoneyCurto = (v) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
}).format(v || 0);
const fmtNum = (v) => new Intl.NumberFormat('pt-BR').format(v ?? 0);
const escapeHTML = (str) => String(str ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

/** Percentual no padrão brasileiro: 12,5% */
function pct(v) {
    return `${(parseFloat(v) || 0).toFixed(1).replace('.', ',')}%`;
}

/** Cor do percentual executado: verde (>=90), âmbar (>=50), vermelho. */
function corPct(v) {
    if (v >= 90) return 'var(--green)';
    if (v >= 50) return 'var(--amber)';
    return 'var(--red)';
}

/** Célula "% Pago" com mini barra de progresso. */
function pctCell(v) {
    const p = Math.min(100, Math.max(0, parseFloat(v) || 0));
    return `<div class="pct-cell" title="${pct(v)} pago">
        <span class="pct-num">${pct(v)}</span>
        <span class="progress"><span style="width:${p}%;background:${corPct(p)}"></span></span>
    </div>`;
}

/** fetch que lança erro legível quando a API responde com falha
 *  (ex.: banco Neon "dormindo" -> 500 com {mensagem}). */
async function fetchJSON(url, opts) {
    let res;
    try {
        res = await fetch(url, opts);
    } catch {
        throw new Error('Sem conexão com o servidor.');
    }
    let data = null;
    try { data = await res.json(); } catch { /* corpo não-JSON */ }
    if (!res.ok && !(data && 'ok' in data)) {
        throw new Error((data && (data.mensagem || data.error)) || `Erro ${res.status} ao carregar dados.`);
    }
    return data;
}

// ---------- Toast ----------
let toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 3500);
}

// ---------- Ordenação de tabelas ----------
// Cabeçalhos ordenáveis: <th data-key="campo" [data-default="desc"]>
function ordenar(rows, key, dir) {
    if (!key) return rows;
    return [...rows].sort((a, b) => {
        const x = a[key], y = b[key];
        if (typeof x === 'number' || typeof y === 'number') return ((+x || 0) - (+y || 0)) * dir;
        return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' }) * dir;
    });
}

function ativarOrdenacao(table, sortState, onChange) {
    table.querySelectorAll('th[data-key]').forEach(th => {
        th.tabIndex = 0;
        th.classList.add('sortable');
        const go = () => {
            if (sortState.key === th.dataset.key) sortState.dir *= -1;
            else { sortState.key = th.dataset.key; sortState.dir = th.dataset.default === 'desc' ? -1 : 1; }
            table.querySelectorAll('th[data-key]').forEach(t => t.removeAttribute('aria-sort'));
            th.setAttribute('aria-sort', sortState.dir > 0 ? 'ascending' : 'descending');
            onChange();
        };
        th.addEventListener('click', go);
        th.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
    });
}

/** Linha de "carregando" para tabelas. */
function linhaCarregando(colspan) {
    return `<tr><td colspan="${colspan}" class="loading-row"><span class="spinner"></span> Carregando…</td></tr>`;
}
