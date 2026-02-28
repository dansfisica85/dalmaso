// ========================
// ESTADO E UTILIDADES
// ========================
const API = '';
let turmasCache = [];
let alunosCache = [];

// Dias da semana
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function getDiaSemana(dataStr) {
  const [y, m, d] = dataStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return DIAS[date.getDay()];
}

function hoje() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function toast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(endpoint, options = {}) {
  try {
    const res = await fetch(API + endpoint, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro do servidor');
    return data;
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

// ========================
// NAVEGAÇÃO
// ========================
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const pageTitle = document.getElementById('pageTitle');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');

const pageTitles = {
  dashboard: 'Início',
  turmas: 'Turmas',
  alunos: 'Alunos',
  chamada: 'Chamada',
  relatorios: 'Relatórios',
  upload: 'Importar CSV',
};

function navigateTo(pageId) {
  navItems.forEach(n => n.classList.remove('active'));
  pages.forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-page="${pageId}"]`)?.classList.add('active');
  document.getElementById(`page-${pageId}`)?.classList.add('active');
  pageTitle.textContent = pageTitles[pageId] || '';
  sidebar.classList.remove('open');

  // Carregar dados da página
  if (pageId === 'dashboard') loadDashboard();
  if (pageId === 'turmas') loadTurmas();
  if (pageId === 'alunos') loadAlunos();
  if (pageId === 'chamada') initChamada();
  if (pageId === 'relatorios') initRelatorios();
  if (pageId === 'upload') loadTurmasSelect('uploadTurma');
}

navItems.forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

menuToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// ========================
// TURMAS
// ========================
async function loadTurmas() {
  try {
    turmasCache = await api('/api/turmas');
    const tbody = document.querySelector('#tabelaTurmas tbody');
    tbody.innerHTML = turmasCache.map(t => `
      <tr>
        <td>${t.id}</td>
        <td><strong>${t.nome}</strong></td>
        <td>${t.descricao || '-'}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon btn-danger" onclick="deletarTurma(${t.id}, '${t.nome}')" title="Excluir">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

document.getElementById('formTurma').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('turmaNome').value.trim();
  const descricao = document.getElementById('turmaDescricao').value.trim();
  if (!nome) return;
  try {
    await api('/api/turmas', {
      method: 'POST',
      body: JSON.stringify({ nome, descricao }),
    });
    toast('Turma criada com sucesso!');
    document.getElementById('turmaNome').value = '';
    document.getElementById('turmaDescricao').value = '';
    loadTurmas();
  } catch (err) {}
});

async function deletarTurma(id, nome) {
  if (!confirm(`Excluir turma "${nome}" e todos seus alunos?`)) return;
  try {
    await api(`/api/turmas/${id}`, { method: 'DELETE' });
    toast('Turma excluída!');
    loadTurmas();
  } catch (err) {}
}

// ========================
// TURMAS SELECT (reutilizável)
// ========================
async function loadTurmasSelect(...selectIds) {
  if (turmasCache.length === 0) {
    turmasCache = await api('/api/turmas');
  }
  selectIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const currentVal = sel.value;
    // Manter a primeira opção (placeholder)
    const firstOption = sel.options[0]?.outerHTML || '';
    sel.innerHTML = firstOption;
    turmasCache.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.nome;
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  });
}

// ========================
// ALUNOS
// ========================
const formAlunoContainer = document.getElementById('formAlunoContainer');
const btnNovoAluno = document.getElementById('btnNovoAluno');
const btnCancelarAluno = document.getElementById('btnCancelarAluno');

async function loadAlunos() {
  await loadTurmasSelect('alunoTurma', 'filtroTurmaAluno');
  const turmaId = document.getElementById('filtroTurmaAluno').value;
  const query = turmaId ? `?turma_id=${turmaId}` : '';
  try {
    alunosCache = await api(`/api/alunos${query}`);
    renderAlunos();
  } catch (err) {}
}

function renderAlunos() {
  const tbody = document.querySelector('#tabelaAlunos tbody');
  if (alunosCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:2rem;">Nenhum aluno encontrado</td></tr>';
    return;
  }
  tbody.innerHTML = alunosCache.map(a => `
    <tr>
      <td><strong>${a.nome}</strong></td>
      <td>${a.matricula || '-'}</td>
      <td><span class="badge" style="background:var(--primary-light);color:var(--primary-dark);">${a.turma_nome}</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon btn-warning" onclick="editarAluno(${a.id})" title="Editar">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn-icon btn-danger" onclick="deletarAluno(${a.id}, '${a.nome.replace(/'/g, "\\'")}')" title="Excluir">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

btnNovoAluno.addEventListener('click', () => {
  document.getElementById('alunoId').value = '';
  document.getElementById('formAluno').reset();
  document.getElementById('formAlunoTitle').textContent = 'Cadastrar Aluno';
  formAlunoContainer.classList.add('show');
  btnNovoAluno.style.display = 'none';
});

btnCancelarAluno.addEventListener('click', () => {
  formAlunoContainer.classList.remove('show');
  btnNovoAluno.style.display = '';
});

document.getElementById('formAluno').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('alunoId').value;
  const nome = document.getElementById('alunoNome').value.trim();
  const matricula = document.getElementById('alunoMatricula').value.trim();
  const turma_id = document.getElementById('alunoTurma').value;
  if (!nome || !turma_id) return;

  try {
    if (id) {
      await api(`/api/alunos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ nome, matricula, turma_id }),
      });
      toast('Aluno atualizado!');
    } else {
      await api('/api/alunos', {
        method: 'POST',
        body: JSON.stringify({ nome, matricula, turma_id }),
      });
      toast('Aluno cadastrado!');
    }
    formAlunoContainer.classList.remove('show');
    btnNovoAluno.style.display = '';
    loadAlunos();
  } catch (err) {}
});

async function editarAluno(id) {
  try {
    const aluno = await api(`/api/alunos/${id}`);
    document.getElementById('alunoId').value = aluno.id;
    document.getElementById('alunoNome').value = aluno.nome;
    document.getElementById('alunoMatricula').value = aluno.matricula || '';
    document.getElementById('alunoTurma').value = aluno.turma_id;
    document.getElementById('formAlunoTitle').textContent = 'Editar Aluno';
    formAlunoContainer.classList.add('show');
    btnNovoAluno.style.display = 'none';
  } catch (err) {}
}

async function deletarAluno(id, nome) {
  if (!confirm(`Excluir aluno "${nome}"?`)) return;
  try {
    await api(`/api/alunos/${id}`, { method: 'DELETE' });
    toast('Aluno excluído!');
    loadAlunos();
  } catch (err) {}
}

document.getElementById('filtroTurmaAluno').addEventListener('change', loadAlunos);

document.getElementById('btnExportarAlunos').addEventListener('click', () => {
  const turmaId = document.getElementById('filtroTurmaAluno').value;
  const query = turmaId ? `?turma_id=${turmaId}` : '';
  window.open(`/api/exportar/alunos${query}`, '_blank');
});

// ========================
// CHAMADA
// ========================
let chamadaDiaSelecionado = '';

function initChamada() {
  loadTurmasSelect('chamadaTurma');
  document.getElementById('chamadaData').value = hoje();
  document.getElementById('chamadaListaContainer').style.display = 'none';
  
  // Auto-set dia da semana com base na data
  updateDiaSemana();
}

function updateDiaSemana() {
  const data = document.getElementById('chamadaData').value;
  if (!data) return;
  const dia = getDiaSemana(data);
  chamadaDiaSelecionado = dia;
  document.querySelectorAll('.dia-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dia === dia);
  });
}

document.getElementById('chamadaData').addEventListener('change', updateDiaSemana);

document.querySelectorAll('.dia-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dia-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chamadaDiaSelecionado = btn.dataset.dia;
  });
});

document.getElementById('btnCarregarChamada').addEventListener('click', async () => {
  const turmaId = document.getElementById('chamadaTurma').value;
  const data = document.getElementById('chamadaData').value;
  if (!turmaId || !data || !chamadaDiaSelecionado) {
    toast('Selecione turma, data e dia da semana', 'error');
    return;
  }

  try {
    const alunos = await api(`/api/alunos?turma_id=${turmaId}`);
    if (alunos.length === 0) {
      toast('Nenhum aluno nesta turma', 'error');
      return;
    }

    // Buscar chamada existente para a data
    let frequenciaExistente = [];
    try {
      frequenciaExistente = await api(`/api/frequencia?turma_id=${turmaId}&data=${data}`);
    } catch (e) {}

    const freqMap = {};
    frequenciaExistente.forEach(f => {
      freqMap[f.aluno_id] = f;
    });

    const container = document.getElementById('chamadaLista');
    container.innerHTML = alunos.map(a => {
      const existing = freqMap[a.id];
      const presente = existing ? existing.presente === 1 : true; // padrão: presente
      const obs = existing ? (existing.observacao || '') : '';
      return `
        <div class="chamada-item ${presente ? 'presente' : 'falta'}" data-aluno-id="${a.id}">
          <span class="aluno-nome">${a.nome}</span>
          <span class="aluno-matricula">${a.matricula || ''}</span>
          <div class="toggle-presenca">
            <button class="btn-presente ${presente ? 'active' : ''}" onclick="togglePresenca(this, true)">
              <i class="fas fa-check"></i> P
            </button>
            <button class="btn-falta ${!presente ? 'active' : ''}" onclick="togglePresenca(this, false)">
              <i class="fas fa-times"></i> F
            </button>
          </div>
          <input type="text" class="obs-input" placeholder="Obs..." value="${obs}">
        </div>
      `;
    }).join('');

    document.getElementById('chamadaListaContainer').style.display = 'block';
  } catch (err) {}
});

function togglePresenca(btn, isPresente) {
  const item = btn.closest('.chamada-item');
  const btns = item.querySelectorAll('.toggle-presenca button');
  btns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  item.classList.remove('presente', 'falta');
  item.classList.add(isPresente ? 'presente' : 'falta');
}

document.getElementById('btnTodosPresentes').addEventListener('click', () => {
  document.querySelectorAll('.chamada-item').forEach(item => {
    item.classList.remove('falta');
    item.classList.add('presente');
    item.querySelector('.btn-presente').classList.add('active');
    item.querySelector('.btn-falta').classList.remove('active');
  });
});

document.getElementById('btnTodosFaltaram').addEventListener('click', () => {
  document.querySelectorAll('.chamada-item').forEach(item => {
    item.classList.remove('presente');
    item.classList.add('falta');
    item.querySelector('.btn-falta').classList.add('active');
    item.querySelector('.btn-presente').classList.remove('active');
  });
});

document.getElementById('btnSalvarChamada').addEventListener('click', async () => {
  const turmaId = document.getElementById('chamadaTurma').value;
  const data = document.getElementById('chamadaData').value;
  const items = document.querySelectorAll('.chamada-item');

  const registros = Array.from(items).map(item => ({
    aluno_id: parseInt(item.dataset.alunoId),
    presente: item.classList.contains('presente'),
    observacao: item.querySelector('.obs-input').value.trim(),
  }));

  try {
    await api('/api/frequencia/chamada', {
      method: 'POST',
      body: JSON.stringify({
        turma_id: turmaId,
        data,
        dia_semana: chamadaDiaSelecionado,
        registros,
      }),
    });
    const presentes = registros.filter(r => r.presente).length;
    const faltas = registros.length - presentes;
    toast(`Chamada salva! ${presentes} presentes, ${faltas} faltas.`);
  } catch (err) {}
});

// ========================
// RELATÓRIOS
// ========================
function initRelatorios() {
  loadTurmasSelect('relatorioTurma');
}

document.getElementById('btnGerarRelatorio').addEventListener('click', async () => {
  const turmaId = document.getElementById('relatorioTurma').value;
  const mes = document.getElementById('relatorioMes').value;
  const ano = document.getElementById('relatorioAno').value;

  let query = '?';
  if (turmaId) query += `turma_id=${turmaId}&`;
  if (mes && ano) query += `mes=${mes}&ano=${ano}&`;

  try {
    const registros = await api(`/api/frequencia${query}`);
    const tbody = document.querySelector('#tabelaRelatorio tbody');
    if (registros.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:2rem;">Nenhum registro encontrado</td></tr>';
      return;
    }
    tbody.innerHTML = registros.map(r => `
      <tr>
        <td><strong>${r.aluno_nome}</strong></td>
        <td><span class="badge" style="background:var(--primary-light);color:var(--primary-dark);">${r.turma_nome}</span></td>
        <td>${formatDate(r.data)}</td>
        <td>${r.dia_semana}</td>
        <td><span class="badge ${r.presente === 1 ? 'badge-presente' : 'badge-falta'}">${r.presente === 1 ? 'Presente' : 'Falta'}</span></td>
        <td>${r.observacao || '-'}</td>
      </tr>
    `).join('');
  } catch (err) {}
});

document.getElementById('btnExportarFrequencia').addEventListener('click', () => {
  const turmaId = document.getElementById('relatorioTurma').value;
  const mes = document.getElementById('relatorioMes').value;
  const ano = document.getElementById('relatorioAno').value;
  let query = '?';
  if (turmaId) query += `turma_id=${turmaId}&`;
  if (mes && ano) query += `mes=${mes}&ano=${ano}&`;
  window.open(`/api/exportar/frequencia${query}`, '_blank');
});

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ========================
// UPLOAD CSV
// ========================
document.getElementById('formUpload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const turmaId = document.getElementById('uploadTurma').value;
  const fileInput = document.getElementById('uploadArquivo');
  if (!turmaId || !fileInput.files[0]) {
    toast('Selecione a turma e o arquivo', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('turma_id', turmaId);
  formData.append('arquivo', fileInput.files[0]);

  const resultDiv = document.getElementById('uploadResultado');
  resultDiv.style.display = 'none';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro no upload');

    resultDiv.className = 'upload-resultado success';
    resultDiv.innerHTML = `
      <strong>✓ Importação concluída!</strong><br>
      ${data.inseridos} aluno(s) importado(s).<br>
      <small>Colunas detectadas: ${data.colunas.join(', ')}</small>
    `;
    resultDiv.style.display = 'block';
    toast(`${data.inseridos} alunos importados!`);
    fileInput.value = '';
    turmasCache = []; // reset cache
  } catch (err) {
    resultDiv.className = 'upload-resultado error';
    resultDiv.innerHTML = `<strong>✗ Erro:</strong> ${err.message}`;
    resultDiv.style.display = 'block';
  }
});

// ========================
// DASHBOARD
// ========================
async function loadDashboard() {
  try {
    const [turmas, alunos] = await Promise.all([
      api('/api/turmas'),
      api('/api/alunos'),
    ]);
    turmasCache = turmas;

    document.getElementById('statTurmas').textContent = turmas.length;
    document.getElementById('statAlunos').textContent = alunos.length;

    // Chamadas de hoje
    try {
      const freqHoje = await api(`/api/frequencia?data=${hoje()}`);
      document.getElementById('statChamadasHoje').textContent = freqHoje.length;
      const presentes = freqHoje.filter(f => f.presente === 1).length;
      const pct = freqHoje.length > 0 ? ((presentes / freqHoje.length) * 100).toFixed(0) : '-';
      document.getElementById('statFrequencia').textContent = pct !== '-' ? pct + '%' : '-';
    } catch (e) {
      document.getElementById('statChamadasHoje').textContent = '0';
      document.getElementById('statFrequencia').textContent = '-';
    }
  } catch (err) {}
}

// ========================
// INICIALIZAÇÃO
// ========================
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('dashboard');
});
