// ============================================================
// DALMASO — Gestão Escolar — Frontend
// ============================================================
'use strict';

// ── Estado ──────────────────────────────────────────────────
let turmasCache = [];
let alunosCache = [];

// ── Utilidades ──────────────────────────────────────────────
function hoje() {
  return new Date().toISOString().split('T')[0];
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toast(msg, type = 'success') {
  const c = document.querySelector('.toast-container') || criarToastContainer();
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function criarToastContainer() {
  const c = document.createElement('div');
  c.className = 'toast-container';
  document.body.appendChild(c);
  return c;
}

async function api(endpoint, options = {}) {
  try {
    const res = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || data.error || 'Erro do servidor');
    return data;
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

async function apiUpload(endpoint, formData) {
  const res = await fetch(endpoint, { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erro || 'Erro ao enviar arquivo');
  return data;
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
const sidebarNav = document.querySelectorAll('.sidebar-nav li');
const allPages = document.querySelectorAll('.page');
const sidebar = document.getElementById('sidebar');
const btnToggle = document.getElementById('btnToggleSidebar');

function navigateTo(pageId) {
  sidebarNav.forEach(li => li.classList.remove('active'));
  allPages.forEach(p => p.classList.remove('active'));
  const navLi = document.querySelector(`.sidebar-nav li[data-page="${pageId}"]`);
  if (navLi) navLi.classList.add('active');
  const pageEl = document.getElementById(`page-${pageId}`);
  if (pageEl) pageEl.classList.add('active');
  sidebar.classList.remove('show');

  // Carregar dados da página
  switch (pageId) {
    case 'dashboard': loadDashboard(); break;
    case 'alunos': loadAlunos(); break;
    case 'frequencia': initFrequencia(); break;
    case 'relatorios': initRelatorios(); break;
    case 'turmas': loadTurmas(); break;
    case 'importar': break;
  }
}

sidebarNav.forEach(li => {
  li.addEventListener('click', () => navigateTo(li.dataset.page));
});

if (btnToggle) {
  btnToggle.addEventListener('click', () => sidebar.classList.toggle('show'));
}

// ============================================================
// TURMAS
// ============================================================
async function loadTurmas() {
  try {
    turmasCache = await api('/api/turmas');
    const grid = document.getElementById('grid-turmas');
    if (!turmasCache.length) {
      grid.innerHTML = '<div class="col-12 text-center text-muted py-5"><i class="bi bi-collection" style="font-size:3rem;"></i><p class="mt-2">Nenhuma turma cadastrada.</p></div>';
      return;
    }
    grid.innerHTML = turmasCache.map(t => `
      <div class="col-md-4 col-lg-3">
        <div class="turma-card">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h5 class="mb-0">${t.nome}</h5>
            <button class="btn btn-sm btn-outline-danger" onclick="deletarTurma(${t.id}, '${t.nome.replace(/'/g, "\\'")}')">
              <i class="bi bi-trash"></i>
            </button>
          </div>
          <span class="badge bg-primary">${t.total_alunos || 0} alunos</span>
          <p class="text-muted small mt-2 mb-0">${t.descricao || ''}</p>
        </div>
      </div>
    `).join('');
  } catch (err) { console.error(err); }
}

document.getElementById('btn-criar-turma')?.addEventListener('click', async () => {
  const input = document.getElementById('input-nova-turma');
  const nome = input.value.trim();
  if (!nome) return;
  try {
    await api('/api/turmas', { method: 'POST', body: JSON.stringify({ nome }) });
    toast('Turma criada!');
    input.value = '';
    turmasCache = [];
    loadTurmas();
    popularSelects();
  } catch (err) {}
});

async function deletarTurma(id, nome) {
  if (!confirm(`Excluir turma "${nome}" e todos seus alunos?`)) return;
  try {
    await api(`/api/turmas/${id}`, { method: 'DELETE' });
    toast('Turma excluída!');
    turmasCache = [];
    loadTurmas();
    popularSelects();
  } catch (err) {}
}

// ── Popular Selects de Turma ──
async function popularSelects() {
  if (!turmasCache.length) {
    try { turmasCache = await api('/api/turmas'); } catch (e) { return; }
  }
  const selects = ['filtro-turma-alunos', 'freq-turma', 'rel-turma', 'aluno-turma'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const first = sel.options[0]?.outerHTML || '<option value="">Selecione</option>';
    sel.innerHTML = first;
    turmasCache.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.nome;
      sel.appendChild(opt);
    });
  });
}

// ============================================================
// ALUNOS
// ============================================================
async function loadAlunos() {
  await popularSelects();
  const turmaId = document.getElementById('filtro-turma-alunos')?.value;
  const busca = document.getElementById('busca-alunos')?.value?.trim() || '';
  let url = '/api/alunos?';
  if (turmaId) url += `turma_id=${turmaId}&`;
  if (busca) url += `busca=${encodeURIComponent(busca)}&`;

  try {
    alunosCache = await api(url);
    const tbody = document.getElementById('corpo-tabela-alunos');
    const vazio = document.getElementById('alunos-vazio');

    if (!alunosCache.length) {
      tbody.innerHTML = '';
      vazio.style.display = 'block';
      return;
    }
    vazio.style.display = 'none';

    tbody.innerHTML = alunosCache.map((a, i) => {
      const turma = turmasCache.find(t => t.id === a.turma_id);
      return `<tr style="cursor:pointer;" onclick="verAluno(${a.id})">
        <td>${i + 1}</td>
        <td><strong>${a.nome}</strong></td>
        <td>${a.ra || '-'}</td>
        <td><span class="badge bg-primary">${turma ? turma.nome : '-'}</span></td>
        <td>${a.data_nascimento || '-'}</td>
        <td>${a.sexo || '-'}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary me-1" onclick="event.stopPropagation(); abrirModalAluno(${a.id})" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); deletarAluno(${a.id}, '${a.nome.replace(/'/g, "\\'")}')" title="Excluir"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) { console.error(err); }
}

// Filtros
document.getElementById('filtro-turma-alunos')?.addEventListener('change', loadAlunos);
let buscaTimeout;
document.getElementById('busca-alunos')?.addEventListener('input', () => {
  clearTimeout(buscaTimeout);
  buscaTimeout = setTimeout(loadAlunos, 400);
});

// Ver detalhe
async function verAluno(id) {
  try {
    const a = await api(`/api/alunos/${id}`);
    const div = document.getElementById('aluno-detalhe-conteudo');

    // Campos principais para exibir
    const campos = [
      ['Nome', a.nome], ['RA', a.ra], ['Dig. RA', a.dig_ra], ['UF RA', a.uf_ra],
      ['Data Nascimento', a.data_nascimento], ['Idade', a.idade ? `${a.idade} anos` : ''],
      ['Sexo', a.sexo], ['Raça/Cor', a.raca_cor], ['CPF', a.cpf], ['RG', a.rg],
      ['NIS', a.nis], ['SUS', a.sus], ['CIN', a.cin],
      ['Nacionalidade', a.nacionalidade], ['Mun. Nasc.', a.municipio_nascimento], ['UF Nasc.', a.uf_nascimento],
      ['Filiação 1', a.filiacao_1], ['Filiação 2', a.filiacao_2],
      ['E-Mail', a.email], ['E-Mail Google', a.email_google], ['E-Mail Microsoft', a.email_microsoft],
      ['Telefones', a.telefones],
      ['CEP', a.cep], ['Endereço', a.endereco], ['Nº', a.numero_endereco],
      ['Complemento', a.complemento], ['Bairro', a.bairro], ['Cidade/UF', a.cidade_uf],
      ['Bolsa Família', a.bolsa_familia], ['Deficiência', a.deficiencia],
      ['Laudo Médico', a.laudo_medico], ['Internet', a.internet_em_casa],
      ['Smartphone', a.smartphone], ['Quilombola', a.quilombola],
      ['Turma', a.turma_nome || ''],
    ];

    div.innerHTML = `
      <h2 class="page-title"><i class="bi bi-person-fill"></i> ${a.nome}</h2>
      <div class="d-flex gap-2 mb-3">
        <button class="btn btn-sm btn-primary" onclick="abrirModalAluno(${a.id})"><i class="bi bi-pencil"></i> Editar</button>
        <button class="btn btn-sm btn-outline-danger" onclick="deletarAluno(${a.id}, '${a.nome.replace(/'/g, "\\'")}')"><i class="bi bi-trash"></i> Excluir</button>
      </div>
      <div class="aluno-info-grid">
        ${campos.filter(([, v]) => v).map(([label, val]) => `
          <div class="aluno-info-item">
            <label>${label}</label>
            <span>${val}</span>
          </div>
        `).join('')}
      </div>
      ${a.dados_extras && Object.keys(a.dados_extras).length ? `
        <h5 class="mt-4 mb-3">Dados Extras</h5>
        <div class="aluno-info-grid">
          ${Object.entries(a.dados_extras).map(([k, v]) => `
            <div class="aluno-info-item"><label>${k}</label><span>${v}</span></div>
          `).join('')}
        </div>
      ` : ''}
    `;

    // Navegar para a página de detalhe
    allPages.forEach(p => p.classList.remove('active'));
    document.getElementById('page-aluno-detalhe').classList.add('active');
  } catch (err) { console.error(err); }
}

document.getElementById('btn-voltar-alunos')?.addEventListener('click', () => {
  allPages.forEach(p => p.classList.remove('active'));
  document.getElementById('page-alunos').classList.add('active');
});

// ── Modal Aluno (Criar / Editar) ──
const modalAluno = new bootstrap.Modal(document.getElementById('modalAluno'));

document.getElementById('btn-novo-aluno')?.addEventListener('click', () => {
  abrirModalAluno(null);
});

async function abrirModalAluno(id) {
  await popularSelects();
  document.getElementById('form-aluno').reset();
  document.getElementById('aluno-id').value = '';

  if (id) {
    document.getElementById('modalAlunoTitulo').textContent = 'Editar Aluno';
    try {
      const a = await api(`/api/alunos/${id}`);
      document.getElementById('aluno-id').value = a.id;
      document.getElementById('aluno-nome').value = a.nome || '';
      document.getElementById('aluno-turma').value = a.turma_id || '';
      document.getElementById('aluno-ra').value = a.ra || '';
      document.getElementById('aluno-nascimento').value = a.data_nascimento || '';
      document.getElementById('aluno-sexo').value = a.sexo || '';
      document.getElementById('aluno-raca').value = a.raca_cor || '';
      document.getElementById('aluno-cpf').value = a.cpf || '';
      document.getElementById('aluno-filiacao1').value = a.filiacao_1 || '';
      document.getElementById('aluno-filiacao2').value = a.filiacao_2 || '';
      document.getElementById('aluno-telefones').value = a.telefones || '';
      document.getElementById('aluno-email').value = a.email || '';
      document.getElementById('aluno-cep').value = a.cep || '';
      document.getElementById('aluno-endereco').value = a.endereco || '';
      document.getElementById('aluno-bairro').value = a.bairro || '';
    } catch (err) {}
  } else {
    document.getElementById('modalAlunoTitulo').textContent = 'Novo Aluno';
  }
  modalAluno.show();
}

document.getElementById('btn-salvar-aluno')?.addEventListener('click', async () => {
  const id = document.getElementById('aluno-id').value;
  const nome = document.getElementById('aluno-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório', 'error'); return; }

  const payload = {
    nome,
    turma_id: document.getElementById('aluno-turma').value || null,
    ra: document.getElementById('aluno-ra').value.trim(),
    data_nascimento: document.getElementById('aluno-nascimento').value.trim(),
    sexo: document.getElementById('aluno-sexo').value,
    raca_cor: document.getElementById('aluno-raca').value,
    cpf: document.getElementById('aluno-cpf').value.trim(),
    filiacao_1: document.getElementById('aluno-filiacao1').value.trim(),
    filiacao_2: document.getElementById('aluno-filiacao2').value.trim(),
    telefones: document.getElementById('aluno-telefones').value.trim(),
    email: document.getElementById('aluno-email').value.trim(),
    cep: document.getElementById('aluno-cep').value.trim(),
    endereco: document.getElementById('aluno-endereco').value.trim(),
    bairro: document.getElementById('aluno-bairro').value.trim(),
  };

  try {
    if (id) {
      await api(`/api/alunos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Aluno atualizado!');
    } else {
      await api('/api/alunos', { method: 'POST', body: JSON.stringify(payload) });
      toast('Aluno cadastrado!');
    }
    modalAluno.hide();
    loadAlunos();
  } catch (err) {}
});

async function deletarAluno(id, nome) {
  if (!confirm(`Excluir aluno "${nome}"?`)) return;
  try {
    await api(`/api/alunos/${id}`, { method: 'DELETE' });
    toast('Aluno excluído!');
    loadAlunos();
    navigateTo('alunos');
  } catch (err) {}
}

// ============================================================
// FREQUÊNCIA
// ============================================================
function initFrequencia() {
  popularSelects();
  document.getElementById('freq-data').value = hoje();
}

document.getElementById('btn-carregar-freq')?.addEventListener('click', async () => {
  const turmaId = document.getElementById('freq-turma').value;
  const data = document.getElementById('freq-data').value;
  if (!turmaId || !data) { toast('Selecione turma e data', 'error'); return; }

  try {
    const alunos = await api(`/api/alunos?turma_id=${turmaId}`);
    if (!alunos.length) { toast('Nenhum aluno nesta turma', 'error'); return; }

    // Buscar frequência existente
    let freqExist = [];
    try { freqExist = await api(`/api/frequencia?turma_id=${turmaId}&data=${data}`); } catch (e) {}
    const freqMap = {};
    freqExist.forEach(f => { freqMap[f.aluno_id] = f; });

    const tbody = document.getElementById('corpo-tabela-freq');
    tbody.innerHTML = alunos.map((a, i) => {
      const ex = freqMap[a.id];
      const checked = ex ? (ex.presente === 1) : true;
      const obs = ex ? (ex.observacao || '') : '';
      return `<tr>
        <td>${i + 1}</td>
        <td>${a.nome}</td>
        <td>${a.ra || '-'}</td>
        <td class="text-center">
          <input type="checkbox" class="freq-check" data-aluno-id="${a.id}" ${checked ? 'checked' : ''} />
        </td>
        <td><input type="text" class="form-control form-control-sm freq-obs" data-aluno-id="${a.id}" value="${obs}" placeholder="Obs..." /></td>
      </tr>`;
    }).join('');

    document.getElementById('tabela-freq').style.display = 'table';
    document.getElementById('freq-vazio').style.display = 'none';
    document.getElementById('btn-salvar-freq').disabled = false;
  } catch (err) { console.error(err); }
});

document.getElementById('btn-marcar-todos')?.addEventListener('click', () => {
  document.querySelectorAll('.freq-check').forEach(cb => { cb.checked = true; });
});

document.getElementById('btn-salvar-freq')?.addEventListener('click', async () => {
  const turmaId = document.getElementById('freq-turma').value;
  const data = document.getElementById('freq-data').value;
  const checks = document.querySelectorAll('.freq-check');

  const registros = Array.from(checks).map(cb => ({
    aluno_id: parseInt(cb.dataset.alunoId),
    presente: cb.checked,
    observacao: document.querySelector(`.freq-obs[data-aluno-id="${cb.dataset.alunoId}"]`)?.value || '',
  }));

  try {
    await api('/api/frequencia', {
      method: 'POST',
      body: JSON.stringify({ turma_id: parseInt(turmaId), data, registros }),
    });
    const p = registros.filter(r => r.presente).length;
    toast(`Frequência salva! ${p} presentes, ${registros.length - p} faltas.`);
  } catch (err) {}
});

// ============================================================
// RELATÓRIOS
// ============================================================
function initRelatorios() {
  popularSelects();
  document.getElementById('rel-mes').value = mesAtual();
}

document.getElementById('btn-gerar-relatorio')?.addEventListener('click', async () => {
  const turmaId = document.getElementById('rel-turma').value;
  const mes = document.getElementById('rel-mes').value;
  const tipo = document.getElementById('rel-tipo').value;
  const div = document.getElementById('relatorio-conteudo');

  if (!turmaId) { toast('Selecione uma turma', 'error'); return; }

  try {
    if (tipo === 'frequencia') {
      if (!mes) { toast('Selecione o mês', 'error'); return; }
      const data = await api(`/api/relatorios/frequencia-mensal?turma_id=${turmaId}&mes=${mes}`);
      renderRelFrequencia(div, data);
    } else {
      const data = await api(`/api/relatorios/perfil-turma?turma_id=${turmaId}`);
      renderRelPerfil(div, data);
    }
  } catch (err) { div.innerHTML = '<p class="text-danger">Erro ao gerar relatório.</p>'; }
});

function renderRelFrequencia(div, data) {
  if (!data.alunos || !data.alunos.length) {
    div.innerHTML = '<p class="text-muted">Nenhum dado de frequência para este período.</p>';
    return;
  }
  div.innerHTML = `
    <h5 class="mb-3">Frequência Mensal — ${data.turma} (${data.mes})</h5>
    <div class="table-responsive">
      <table class="table table-hover">
        <thead><tr>
          <th>Nº</th><th>Nome</th><th>RA</th><th>Presenças</th><th>Faltas</th><th>Total</th><th>%</th>
        </tr></thead>
        <tbody>
        ${data.alunos.map((a, i) => `
          <tr>
            <td>${a.numero_chamada || (i + 1)}</td>
            <td>${a.nome}</td>
            <td>${a.ra || '-'}</td>
            <td><span class="badge bg-success">${a.presencas}</span></td>
            <td><span class="badge bg-danger">${a.faltas}</span></td>
            <td>${a.total_dias}</td>
            <td>
              <div class="d-flex align-items-center gap-2">
                <div class="report-freq-bar flex-grow-1">
                  <div class="report-freq-bar-fill" style="width:${a.percentual}%;background:${a.percentual >= 75 ? '#22c55e' : a.percentual >= 50 ? '#f59e0b' : '#ef4444'};"></div>
                </div>
                <strong>${a.percentual}%</strong>
              </div>
            </td>
          </tr>
        `).join('')}
        </tbody>
      </table>
    </div>
    <div id="chart-rel-freq" class="mt-4"></div>
  `;

  // Gráfico de frequência
  Plotly.newPlot('chart-rel-freq', [{
    x: data.alunos.map(a => a.nome.split(' ').slice(0, 2).join(' ')),
    y: data.alunos.map(a => a.percentual),
    type: 'bar',
    marker: { color: data.alunos.map(a => a.percentual >= 75 ? '#22c55e' : a.percentual >= 50 ? '#f59e0b' : '#ef4444') },
  }], {
    title: 'Frequência por Aluno (%)',
    yaxis: { range: [0, 100], title: '%' },
    margin: { t: 40, b: 100 },
    height: 350,
  }, { responsive: true });
}

function renderRelPerfil(div, data) {
  div.innerHTML = `
    <h5 class="mb-3">Perfil — ${data.turma} (${data.total_alunos} alunos)</h5>
    <div class="row g-3">
      <div class="col-md-4"><div class="chart-card"><h6 class="chart-title">Sexo</h6><div id="chart-rel-sexo"></div></div></div>
      <div class="col-md-4"><div class="chart-card"><h6 class="chart-title">Raça/Cor</h6><div id="chart-rel-raca"></div></div></div>
      <div class="col-md-4"><div class="chart-card"><h6 class="chart-title">Indicadores</h6><div id="chart-rel-ind"></div></div></div>
    </div>
    ${data.idades.length ? '<div class="chart-card mt-3"><h6 class="chart-title">Distribuição de Idade</h6><div id="chart-rel-idade"></div></div>' : ''}
  `;

  const plotCfg = { responsive: true };
  const layoutBase = { margin: { t: 10, b: 30, l: 30, r: 10 }, height: 280, showlegend: true };

  // Sexo
  Plotly.newPlot('chart-rel-sexo', [{
    labels: data.por_sexo.map(d => d.categoria),
    values: data.por_sexo.map(d => d.total),
    type: 'pie', hole: 0.4,
    marker: { colors: ['#3b82f6', '#ec4899', '#9ca3af'] },
  }], { ...layoutBase }, plotCfg);

  // Raça
  Plotly.newPlot('chart-rel-raca', [{
    labels: data.por_raca.map(d => d.categoria),
    values: data.por_raca.map(d => d.total),
    type: 'pie',
  }], { ...layoutBase }, plotCfg);

  // Indicadores
  const ind = data.indicadores;
  Plotly.newPlot('chart-rel-ind', [{
    x: Object.keys(ind).map(k => k.replace(/_/g, ' ')),
    y: Object.values(ind),
    type: 'bar',
    marker: { color: '#4f46e5' },
  }], { ...layoutBase, height: 280, margin: { t: 10, b: 80, l: 40, r: 10 } }, plotCfg);

  // Idades
  if (data.idades.length) {
    Plotly.newPlot('chart-rel-idade', [{
      x: data.idades,
      type: 'histogram',
      marker: { color: '#8b5cf6' },
      xbins: { size: 1 },
    }], { ...layoutBase, height: 250, xaxis: { title: 'Idade' }, yaxis: { title: 'Nº Alunos' } }, plotCfg);
  }
}

// ============================================================
// IMPORTAR DADOS
// ============================================================
document.getElementById('btn-importar')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('input-arquivo');
  const progresso = document.getElementById('importar-progresso');
  const resultado = document.getElementById('importar-resultado');

  if (!fileInput.files[0]) { toast('Selecione um arquivo', 'error'); return; }

  const formData = new FormData();
  formData.append('arquivo', fileInput.files[0]);

  progresso.style.display = 'block';
  resultado.innerHTML = '';

  try {
    const data = await apiUpload('/api/importar', formData);
    progresso.style.display = 'none';
    resultado.innerHTML = `
      <div class="alert alert-success">
        <strong><i class="bi bi-check-circle"></i> Importação concluída!</strong><br>
        ${data.total_importados} aluno(s) importado(s) de ${data.total_linhas_arquivo} linha(s).<br>
        ${data.turmas_criadas ? `${data.turmas_criadas} turma(s) criada(s).` : ''}
      </div>
    `;
    toast(`${data.total_importados} alunos importados!`);
    fileInput.value = '';
    turmasCache = [];
  } catch (err) {
    progresso.style.display = 'none';
    resultado.innerHTML = `<div class="alert alert-danger"><strong>Erro:</strong> ${err.message}</div>`;
  }
});

// ============================================================
// DASHBOARD
// ============================================================
const PLOTLY_LAYOUT_BASE = {
  margin: { t: 10, b: 40, l: 40, r: 10 },
  height: 300,
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { family: 'Inter, sans-serif', size: 12 },
};
const PLOTLY_CFG = { responsive: true, displayModeBar: false };
const CORES = ['#4f46e5', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#14b8a6'];

async function loadDashboard() {
  try {
    const d = await api('/api/dashboard');

    // Stat cards
    document.getElementById('stat-alunos').textContent = d.totais.alunos;
    document.getElementById('stat-turmas').textContent = d.totais.turmas;
    document.getElementById('stat-freq').textContent = d.totais.frequencia_percentual + '%';
    document.getElementById('stat-registros').textContent = d.totais.total_registros_freq;

    // 1. Alunos por turma (bar)
    if (d.por_turma.length) {
      Plotly.newPlot('chart-por-turma', [{
        x: d.por_turma.map(t => t.turma),
        y: d.por_turma.map(t => t.total),
        type: 'bar',
        marker: { color: CORES,  cornerradius: 6 },
      }], { ...PLOTLY_LAYOUT_BASE, yaxis: { title: 'Alunos' } }, PLOTLY_CFG);
    }

    // 2. Distribuição por sexo (donut)
    if (d.por_sexo.length) {
      Plotly.newPlot('chart-por-sexo', [{
        labels: d.por_sexo.map(s => s.categoria),
        values: d.por_sexo.map(s => s.total),
        type: 'pie', hole: 0.45,
        marker: { colors: ['#3b82f6', '#ec4899', '#9ca3af', '#f59e0b'] },
        textinfo: 'label+percent',
      }], { ...PLOTLY_LAYOUT_BASE, showlegend: false }, PLOTLY_CFG);
    }

    // 3. Raça/Cor (pie)
    if (d.por_raca.length) {
      Plotly.newPlot('chart-por-raca', [{
        labels: d.por_raca.map(r => r.categoria),
        values: d.por_raca.map(r => r.total),
        type: 'pie',
        marker: { colors: CORES },
        textinfo: 'label+percent',
      }], { ...PLOTLY_LAYOUT_BASE, showlegend: false }, PLOTLY_CFG);
    }

    // 4. Faixa etária (histogram)
    if (d.por_idade.length) {
      Plotly.newPlot('chart-por-idade', [{
        x: d.por_idade.map(i => i.idade),
        y: d.por_idade.map(i => i.total),
        type: 'bar',
        marker: { color: '#8b5cf6' },
      }], { ...PLOTLY_LAYOUT_BASE, xaxis: { title: 'Idade' }, yaxis: { title: 'Nº Alunos' } }, PLOTLY_CFG);
    }

    // 5. Bolsa Família (donut)
    const bf = d.bolsa_familia || {};
    if (bf.sim || bf.nao) {
      Plotly.newPlot('chart-bolsa', [{
        labels: ['Sim', 'Não'],
        values: [bf.sim || 0, bf.nao || 0],
        type: 'pie', hole: 0.45,
        marker: { colors: ['#f59e0b', '#e2e8f0'] },
        textinfo: 'label+value',
      }], { ...PLOTLY_LAYOUT_BASE, showlegend: false }, PLOTLY_CFG);
    }

    // 6. Indicadores sociais (grouped bar)
    const defic = d.deficiencia || {};
    const inter = d.internet || {};
    const smart = d.smartphone || {};
    Plotly.newPlot('chart-indicadores', [
      { x: ['Deficiência', 'Internet', 'Smartphone'], y: [defic.sim || 0, inter.sim || 0, smart.sim || 0], name: 'Sim', type: 'bar', marker: { color: '#22c55e' } },
      { x: ['Deficiência', 'Internet', 'Smartphone'], y: [defic.nao || 0, inter.nao || 0, smart.nao || 0], name: 'Não', type: 'bar', marker: { color: '#e2e8f0' } },
    ], { ...PLOTLY_LAYOUT_BASE, barmode: 'group', yaxis: { title: 'Alunos' } }, PLOTLY_CFG);

    // 7. Frequência ao longo do tempo (line)
    if (d.freq_tempo.length) {
      Plotly.newPlot('chart-freq-tempo', [{
        x: d.freq_tempo.map(f => f.data),
        y: d.freq_tempo.map(f => f.percentual),
        type: 'scatter', mode: 'lines+markers',
        line: { color: '#4f46e5', width: 2 },
        marker: { size: 5 },
        fill: 'tozeroy',
        fillcolor: 'rgba(79,70,229,0.1)',
      }], { ...PLOTLY_LAYOUT_BASE, yaxis: { range: [0, 100], title: '% Presença' }, xaxis: { title: 'Data' } }, PLOTLY_CFG);
    }

    // 8. Frequência por turma (horizontal bar)
    if (d.freq_turma.length) {
      Plotly.newPlot('chart-freq-turma', [{
        y: d.freq_turma.map(f => f.turma),
        x: d.freq_turma.map(f => f.percentual),
        type: 'bar',
        orientation: 'h',
        marker: {
          color: d.freq_turma.map(f =>
            f.percentual >= 75 ? '#22c55e' : f.percentual >= 50 ? '#f59e0b' : '#ef4444'
          ),
        },
        text: d.freq_turma.map(f => f.percentual + '%'),
        textposition: 'auto',
      }], { ...PLOTLY_LAYOUT_BASE, xaxis: { range: [0, 100], title: '% Presença' }, height: Math.max(200, d.freq_turma.length * 40) }, PLOTLY_CFG);
    }

  } catch (err) { console.error('Dashboard error:', err); }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('dashboard');
});