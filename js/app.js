// ============================================================
// DALMASO — Gestão Escolar — Frontend
// ============================================================
'use strict';

// ── Estado ──────────────────────────────────────────────────
let turmasCache = [];
let turmaAtual = null;
let anoCalendario = new Date().getFullYear();
let freqCalendario = {};
let dataChamadaAtual = '';

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
    case 'inicio': loadInicio(); break;
    case 'alunos': loadAlunos(); break;
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
// INÍCIO (Grid de turmas → clique abre Calendário)
// ============================================================
async function loadInicio() {
  try {
    turmasCache = await api('/api/turmas');
    const grid = document.getElementById('grid-inicio');
    const vazio = document.getElementById('inicio-vazio');

    if (!turmasCache.length) {
      grid.innerHTML = '';
      if (vazio) vazio.style.display = 'block';
      return;
    }
    if (vazio) vazio.style.display = 'none';

    grid.innerHTML = turmasCache.map(t => `
      <div class="col-md-4 col-lg-3">
        <div class="turma-card" style="cursor:pointer;" onclick="abrirCalendario(${t.id}, '${t.nome.replace(/'/g, "\\'")}')">
          <h5 class="mb-2">${t.nome}</h5>
          <span class="badge bg-primary">${t.total_alunos || 0} alunos</span>
          <p class="text-muted small mt-2 mb-0">${t.descricao || ''}</p>
        </div>
      </div>
    `).join('');
  } catch (err) { console.error(err); }
}

// ============================================================
// CALENDÁRIO
// ============================================================
window.abrirCalendario = async function(turmaId, turmaNome) {
  turmaAtual = { id: turmaId, nome: turmaNome };
  anoCalendario = new Date().getFullYear();
  document.getElementById('titulo-calendario').textContent = turmaNome;
  document.getElementById('label-ano').textContent = anoCalendario;

  allPages.forEach(p => p.classList.remove('active'));
  sidebarNav.forEach(li => li.classList.remove('active'));
  document.getElementById('page-calendario').classList.add('active');

  await carregarFreqCalendario();
  renderCalendario();
};

async function carregarFreqCalendario() {
  try {
    const data = await api(`/api/frequencia/calendario?turma_id=${turmaAtual.id}&ano=${anoCalendario}`);
    freqCalendario = data.datas || {};
  } catch (err) {
    freqCalendario = {};
  }
}

function renderCalendario() {
  const container = document.getElementById('container-calendario');
  container.innerHTML = gerarCalendarioHTML(anoCalendario, freqCalendario);
}

function gerarCalendarioHTML(ano, dadosFreq) {
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const hojeStr = new Date().toISOString().split('T')[0];
  let html = '<div class="calendario-grid">';
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(ano, m, 1).getDay();
    const daysInMonth = new Date(ano, m + 1, 0).getDate();
    html += '<div class="calendario-mes">';
    html += `<div class="calendario-mes-header">${MESES[m]}</div>`;
    html += '<table><thead><tr><th>Dom</th><th>Seg</th><th>Ter</th><th>Qua</th><th>Qui</th><th>Sex</th><th>Sáb</th></tr></thead><tbody><tr>';
    for (let i = 0; i < firstDay; i++) html += '<td></td>';
    let dow = firstDay;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${ano}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isWeekend = dow === 0 || dow === 6;
      const hasData = dadosFreq[dateStr];
      let cls = isWeekend ? 'dia-fds' : 'dia-util';
      if (hasData) cls += ' dia-registrado';
      if (dateStr === hojeStr) cls += ' dia-hoje';
      if (!isWeekend) {
        html += `<td class="${cls}" onclick="abrirChamada('${dateStr}')">${d}</td>`;
      } else {
        html += `<td class="${cls}">${d}</td>`;
      }
      dow++;
      if (dow > 6) {
        if (d < daysInMonth) html += '</tr><tr>';
        dow = 0;
      }
    }
    while (dow > 0 && dow <= 6) { html += '<td></td>'; dow++; }
    html += '</tr></tbody></table></div>';
  }
  html += '</div>';
  return html;
}

document.getElementById('btn-ano-anterior')?.addEventListener('click', async () => {
  anoCalendario--;
  document.getElementById('label-ano').textContent = anoCalendario;
  await carregarFreqCalendario();
  renderCalendario();
});

document.getElementById('btn-ano-proximo')?.addEventListener('click', async () => {
  anoCalendario++;
  document.getElementById('label-ano').textContent = anoCalendario;
  await carregarFreqCalendario();
  renderCalendario();
});

document.getElementById('btn-voltar-inicio')?.addEventListener('click', () => {
  navigateTo('inicio');
});

// ============================================================
// CHAMADA
// ============================================================
window.abrirChamada = async function(dateStr) {
  dataChamadaAtual = dateStr;
  if (!turmaAtual) return;

  document.getElementById('badge-turma-chamada').textContent = turmaAtual.nome;
  document.getElementById('badge-data-chamada').textContent = dateStr;

  allPages.forEach(p => p.classList.remove('active'));
  sidebarNav.forEach(li => li.classList.remove('active'));
  document.getElementById('page-chamada').classList.add('active');

  try {
    const alunos = await api(`/api/alunos?turma_id=${turmaAtual.id}`);
    if (!alunos.length) {
      document.getElementById('corpo-tabela-chamada').innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-4">Nenhum aluno nesta turma.</td></tr>';
      return;
    }

    let freqExist = [];
    try { freqExist = await api(`/api/frequencia?turma_id=${turmaAtual.id}&data=${dateStr}`); } catch (e) {}
    const freqMap = {};
    freqExist.forEach(f => { freqMap[f.aluno_id] = f; });

    const tbody = document.getElementById('corpo-tabela-chamada');
    tbody.innerHTML = alunos.map((a, i) => {
      const ex = freqMap[a.id];
      const checked = ex ? (ex.presente === 1) : true;
      const rowClass = checked ? '' : ' chamada-row-ausente';
      const obs = ex ? (ex.observacao || '') : '';
      return `<tr class="${rowClass}">
        <td>${i + 1}</td>
        <td>${a.nome}</td>
        <td>${a.ra || '-'}</td>
        <td class="text-center">
          <input type="checkbox" class="chamada-check" data-aluno-id="${a.id}" ${checked ? 'checked' : ''} />
        </td>
        <td><input type="text" class="form-control form-control-sm chamada-obs" data-aluno-id="${a.id}" value="${obs}" placeholder="" /></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.chamada-check').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('tr').classList.toggle('chamada-row-ausente', !cb.checked);
      });
    });
  } catch (err) { console.error(err); }
};

document.getElementById('btn-marcar-todos')?.addEventListener('click', () => {
  document.querySelectorAll('.chamada-check').forEach(cb => {
    cb.checked = true;
    cb.closest('tr').classList.remove('chamada-row-ausente');
  });
});

document.getElementById('btn-desmarcar-todos')?.addEventListener('click', () => {
  document.querySelectorAll('.chamada-check').forEach(cb => {
    cb.checked = false;
    cb.closest('tr').classList.add('chamada-row-ausente');
  });
});

document.getElementById('btn-salvar-chamada')?.addEventListener('click', async () => {
  if (!turmaAtual || !dataChamadaAtual) return;
  const checks = document.querySelectorAll('.chamada-check');
  const registros = Array.from(checks).map(cb => {
    const obsInput = document.querySelector(`.chamada-obs[data-aluno-id="${cb.dataset.alunoId}"]`);
    return {
      aluno_id: parseInt(cb.dataset.alunoId),
      presente: cb.checked,
      observacao: obsInput ? obsInput.value.trim() : '',
    };
  });

  try {
    await api('/api/frequencia', {
      method: 'POST',
      body: JSON.stringify({ turma_id: turmaAtual.id, data: dataChamadaAtual, registros }),
    });
    const p = registros.filter(r => r.presente).length;
    toast(`Frequência salva! ${p} presentes, ${registros.length - p} faltas.`);
    await carregarFreqCalendario();
  } catch (err) {}
});

document.getElementById('btn-voltar-calendario')?.addEventListener('click', () => {
  allPages.forEach(p => p.classList.remove('active'));
  document.getElementById('page-calendario').classList.add('active');
  renderCalendario();
});

// ============================================================
// TURMAS (CRUD)
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

window.deletarTurma = async function(id, nome) {
  if (!confirm(`Excluir turma "${nome}" e todos seus alunos?`)) return;
  try {
    await api(`/api/turmas/${id}`, { method: 'DELETE' });
    toast('Turma excluída!');
    turmasCache = [];
    loadTurmas();
    popularSelects();
  } catch (err) {}
};

// ── Popular Selects de Turma ──
async function popularSelects() {
  if (!turmasCache.length) {
    try { turmasCache = await api('/api/turmas'); } catch (e) { return; }
  }
  const selects = ['filtro-turma-alunos', 'rel-turma', 'aluno-turma'];
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
    const alunos = await api(url);
    const tbody = document.getElementById('corpo-tabela-alunos');
    const vazio = document.getElementById('alunos-vazio');

    if (!alunos.length) {
      tbody.innerHTML = '';
      if (vazio) vazio.style.display = 'block';
      return;
    }
    if (vazio) vazio.style.display = 'none';

    tbody.innerHTML = alunos.map((a, i) => {
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
window.verAluno = async function(id) {
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
};

document.getElementById('btn-voltar-alunos')?.addEventListener('click', () => {
  allPages.forEach(p => p.classList.remove('active'));
  document.getElementById('page-alunos').classList.add('active');
});

// ── Modal Aluno (Criar / Editar) ──
let modalAluno;

document.getElementById('btn-novo-aluno')?.addEventListener('click', () => {
  abrirModalAluno(null);
});

window.abrirModalAluno = async function(id) {
  await popularSelects();
  if (!modalAluno) modalAluno = new bootstrap.Modal(document.getElementById('modalAluno'));
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
};

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
    if (modalAluno) modalAluno.hide();
    loadAlunos();
  } catch (err) {}
});

window.deletarAluno = async function(id, nome) {
  if (!confirm(`Excluir aluno "${nome}"?`)) return;
  try {
    await api(`/api/alunos/${id}`, { method: 'DELETE' });
    toast('Aluno excluído!');
    loadAlunos();
    navigateTo('alunos');
  } catch (err) {}
};

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
  }, { responsive: true, displayModeBar: false });
}

function renderRelPerfil(div, data) {
  div.innerHTML = `
    <h5 class="mb-3">Perfil — ${data.turma} (${data.total_alunos} alunos)</h5>
    <div class="row g-3">
      <div class="col-md-4"><div class="chart-card"><h6 class="chart-title">Sexo</h6><div id="chart-rel-sexo"></div></div></div>
      <div class="col-md-4"><div class="chart-card"><h6 class="chart-title">Raça/Cor</h6><div id="chart-rel-raca"></div></div></div>
      <div class="col-md-4"><div class="chart-card"><h6 class="chart-title">Indicadores</h6><div id="chart-rel-ind"></div></div></div>
    </div>
    ${data.idades && data.idades.length ? '<div class="chart-card mt-3"><h6 class="chart-title">Distribuição de Idade</h6><div id="chart-rel-idade"></div></div>' : ''}
  `;

  const plotCfg = { responsive: true, displayModeBar: false };
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
  if (data.idades && data.idades.length) {
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
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('inicio');
  initIA();
});

// ============================================================
// ASSISTENTE IA (Chat Flutuante)
// ============================================================
let iaHistorico = [];
let iaCarregando = false;

function initIA() {
  const fab = document.getElementById('ia-fab');
  const panel = document.getElementById('ia-panel');
  const closeBtn = document.getElementById('ia-close');
  const input = document.getElementById('ia-input');
  const enviarBtn = document.getElementById('ia-enviar');

  if (!fab || !panel) return;

  fab.addEventListener('click', () => {
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'flex';
    fab.classList.toggle('ia-fab-active', !isOpen);
    if (!isOpen) input.focus();
  });

  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    fab.classList.remove('ia-fab-active');
  });

  enviarBtn.addEventListener('click', () => iaEnviarMensagem());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      iaEnviarMensagem();
    }
  });

  // Botões de ação rápida
  document.querySelectorAll('.ia-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'analisar') {
        iaAnalisarFrequencia();
      } else if (action === 'criticos') {
        iaEnviarTexto('Quais alunos estão em situação crítica de frequência? Liste todos com menos de 75% de presença.');
      }
    });
  });
}

function iaAdicionarMsg(conteudo, tipo) {
  const container = document.getElementById('ia-mensagens');
  const div = document.createElement('div');
  div.className = `ia-msg ia-msg-${tipo}`;

  if (tipo === 'bot' && typeof marked !== 'undefined') {
    div.innerHTML = marked.parse(conteudo);
  } else {
    div.textContent = conteudo;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function iaAdicionarCarregando() {
  const container = document.getElementById('ia-mensagens');
  const div = document.createElement('div');
  div.className = 'ia-msg ia-msg-bot ia-loading';
  div.innerHTML = '<span class="ia-dots"><span>.</span><span>.</span><span>.</span></span> Pensando...';
  div.id = 'ia-loading-msg';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function iaRemoverCarregando() {
  const el = document.getElementById('ia-loading-msg');
  if (el) el.remove();
}

async function iaEnviarMensagem() {
  const input = document.getElementById('ia-input');
  const msg = input.value.trim();
  if (!msg || iaCarregando) return;
  input.value = '';
  iaEnviarTexto(msg);
}

async function iaEnviarTexto(msg) {
  if (iaCarregando) return;

  iaAdicionarMsg(msg, 'user');
  iaHistorico.push({ role: 'user', content: msg });

  iaCarregando = true;
  iaAdicionarCarregando();

  try {
    const data = await fetch('/api/ia/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensagem: msg,
        historico: iaHistorico.slice(-10),
      }),
    }).then(r => r.json());

    iaRemoverCarregando();

    if (data.erro) {
      iaAdicionarMsg('Erro: ' + data.erro, 'bot');
    } else {
      iaAdicionarMsg(data.resposta, 'bot');
      iaHistorico.push({ role: 'assistant', content: data.resposta });
    }
  } catch (err) {
    iaRemoverCarregando();
    iaAdicionarMsg('Erro de conexão. Tente novamente.', 'bot');
  } finally {
    iaCarregando = false;
  }
}

async function iaAnalisarFrequencia() {
  if (!turmaAtual) {
    iaAdicionarMsg('Selecione uma turma primeiro (clique em uma turma na tela Início).', 'bot');
    return;
  }

  iaAdicionarMsg(`Analisar frequência da turma ${turmaAtual.nome}`, 'user');
  iaCarregando = true;
  iaAdicionarCarregando();

  try {
    const data = await fetch('/api/ia/analisar-frequencia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turma_id: turmaAtual.id,
        mes: mesAtual(),
      }),
    }).then(r => r.json());

    iaRemoverCarregando();

    if (data.erro) {
      iaAdicionarMsg('Erro: ' + data.erro, 'bot');
    } else {
      iaAdicionarMsg(data.analise, 'bot');
      iaHistorico.push({ role: 'assistant', content: data.analise });
    }
  } catch (err) {
    iaRemoverCarregando();
    iaAdicionarMsg('Erro de conexão. Tente novamente.', 'bot');
  } finally {
    iaCarregando = false;
  }
}