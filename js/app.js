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
let nivelAcesso = null; // 'admin' | 'frequencia'
let monitorInterval = null;
let monitorPeriodoAtual = 'diario';
let monitorAnimating = false;

// ── Configuração de períodos e níveis ───────────────────────
const PERIODOS_CONFIG = {
  manha: ['1A','1B','1C','1D','1E','1F','2A','2B','2C','2D','2E','3A','3B','3C'],
  tarde: ['6A','6B','6C','7A','7B','7C','8A','8B','8C','8D','9A','9B','9C','9D'],
  noite: ['1G','2F','2G','3D','3E'],
};

const NIVEIS_CONFIG = {
  ensino_medio: ['1A','1B','1C','1D','1E','1F','2B','2C','2D','2E','3B','3C','1G','2F','2G','3D','3E'],
  ensino_medio_iftp: ['2A','3A'],
  fundamental_final: ['6A','6B','6C','7A','7B','7C','8A','8B','8C','8D','9A','9B','9C','9D'],
};

// ── Utilidades ──────────────────────────────────────────────
function hoje() {
  return new Date().toISOString().split('T')[0];
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function agora() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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

// Animated counter
function animateCounter(el, target, suffix = '') {
  const start = parseInt(el.textContent) || 0;
  const diff = target - start;
  if (diff === 0) { el.textContent = target + suffix; return; }
  const duration = 800;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    const current = Math.round(start + diff * eased);
    el.textContent = current + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else {
      el.textContent = target + suffix;
      el.classList.add('value-updated');
      setTimeout(() => el.classList.remove('value-updated'), 600);
    }
  }
  requestAnimationFrame(step);
}

function freqColorClass(perc) {
  if (perc >= 90) return 'freq-otima';
  if (perc >= 80) return 'freq-boa';
  if (perc >= 70) return 'freq-media';
  if (perc >= 60) return 'freq-baixa';
  return 'freq-critica';
}

function freqColor(perc) {
  if (perc >= 90) return '#16a34a';
  if (perc >= 80) return '#65a30d';
  if (perc >= 70) return '#ca8a04';
  if (perc >= 60) return '#ea580c';
  return '#dc2626';
}

function periodoLabel(p) {
  return { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' }[p] || p;
}
function nivelLabel(n) {
  return {
    ensino_medio: 'Ensino Médio',
    ensino_medio_iftp: 'EM IFTP',
    fundamental_final: 'Fund. Final',
  }[n] || n;
}

// ============================================================
// AUTENTICAÇÃO — Login Dual
// ============================================================
function initLogin() {
  const loginScreen = document.getElementById('login-screen');
  const wrapper = document.getElementById('wrapper');
  const loginForm = document.getElementById('login-form');
  const loginSenha = document.getElementById('login-senha');
  const toggleSenha = document.getElementById('toggle-senha');
  const loginErro = document.getElementById('login-erro');
  const loginErroMsg = document.getElementById('login-erro-msg');

  // Verificar sessão existente
  const savedNivel = sessionStorage.getItem('dalmaso_nivel');
  if (savedNivel) {
    nivelAcesso = savedNivel;
    loginScreen.style.display = 'none';
    wrapper.style.display = '' ;
    wrapper.style.cssText = '';
    aplicarNivelAcesso();
    onLoginSuccess();
    return;
  }

  // Toggle visibilidade da senha
  if (toggleSenha) {
    toggleSenha.addEventListener('click', () => {
      const isPass = loginSenha.type === 'password';
      loginSenha.type = isPass ? 'text' : 'password';
      toggleSenha.querySelector('i').className = isPass ? 'bi bi-eye-slash' : 'bi bi-eye';
    });
  }

  // Submit login
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const senha = loginSenha.value.trim();
      if (!senha) return;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ senha }),
        });
        const data = await res.json();

        if (data.ok) {
          nivelAcesso = data.nivel;
          sessionStorage.setItem('dalmaso_nivel', nivelAcesso);

          loginScreen.style.display = 'none';
          wrapper.style.display = '';
          wrapper.style.cssText = '';
          aplicarNivelAcesso();
          onLoginSuccess();
          toast(data.mensagem, 'success');
        } else {
          loginErroMsg.textContent = data.erro || 'Senha incorreta';
          loginErro.style.display = 'block';
          loginSenha.value = '';
          loginSenha.focus();
          // Shake animation
          loginForm.style.animation = 'none';
          loginForm.offsetHeight; // reflow
          loginForm.style.animation = 'loginShake .4s ease';
        }
      } catch (err) {
        loginErroMsg.textContent = 'Erro de conexão';
        loginErro.style.display = 'block';
      }
    });
  }
}

function aplicarNivelAcesso() {
  const labelNivel = document.getElementById('label-nivel-acesso');
  if (labelNivel) {
    labelNivel.textContent = nivelAcesso === 'admin' ? 'Admin' : 'Frequência';
  }

  // Esconder itens que requerem admin
  document.querySelectorAll('[data-require="admin"]').forEach(el => {
    el.style.display = nivelAcesso === 'admin' ? '' : 'none';
  });
}

function onLoginSuccess() {
  // Ambos os níveis veem o monitoramento e podem registrar frequência
  navigateTo('monitoramento');
  initMonitor();
}

// Logout
document.getElementById('btn-logout')?.addEventListener('click', () => {
  sessionStorage.removeItem('dalmaso_nivel');
  nivelAcesso = null;
  if (monitorInterval) clearInterval(monitorInterval);
  document.getElementById('login-screen').style.display = '';
  document.getElementById('wrapper').style.display = 'none';
  document.getElementById('wrapper').style.cssText = 'display:none !important;';
  document.getElementById('login-senha').value = '';
  document.getElementById('login-erro').style.display = 'none';
});

// ============================================================
// NAVEGAÇÃO
// ============================================================
const sidebarNav = document.querySelectorAll('.sidebar-nav li');
const allPages = document.querySelectorAll('.page');
const sidebar = document.getElementById('sidebar');
const btnToggle = document.getElementById('btnToggleSidebar');

function navigateTo(pageId) {
  // Verificar acesso
  const navItem = document.querySelector(`.sidebar-nav li[data-page="${pageId}"]`);
  if (navItem && navItem.dataset.require === 'admin' && nivelAcesso !== 'admin') {
    toast('Sem permissão para acessar esta página', 'error');
    return;
  }

  sidebarNav.forEach(li => li.classList.remove('active'));
  allPages.forEach(p => p.classList.remove('active'));
  if (navItem) navItem.classList.add('active');
  const pageEl = document.getElementById(`page-${pageId}`);
  if (pageEl) pageEl.classList.add('active');
  sidebar.classList.remove('show');

  // Carregar dados da página
  switch (pageId) {
    case 'monitoramento': loadMonitorData(); break;
    case 'inicio': loadInicio(); break;
    case 'alunos': loadAlunos(); break;
    case 'relatorios': initRelatorios(); break;
    case 'turmas': loadTurmas(); break;
    case 'calendario-pedagogico': loadCalendarioPedagogico(); break;
    case 'alertas-whatsapp': loadAlertasWhatsapp(); break;
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
// PAINEL DE MONITORAMENTO — 24h
// ============================================================

function initMonitor() {
  // Data de referência padrão = hoje
  const dataRef = document.getElementById('filtro-data-ref');
  if (dataRef && !dataRef.value) dataRef.value = hoje();

  // Tabs de período
  document.querySelectorAll('.monitor-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.monitor-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      monitorPeriodoAtual = tab.dataset.periodo;
      loadMonitorData();
    });
  });

  // Filtros de turno/nível/data
  document.getElementById('filtro-turno')?.addEventListener('change', loadMonitorData);
  document.getElementById('filtro-nivel')?.addEventListener('change', loadMonitorData);
  document.getElementById('filtro-data-ref')?.addEventListener('change', loadMonitorData);

  // Botão atualizar
  document.getElementById('btn-atualizar-monitor')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-atualizar-monitor');
    btn.querySelector('i').classList.add('spin');
    loadMonitorData().finally(() => {
      setTimeout(() => btn.querySelector('i').classList.remove('spin'), 500);
    });
  });

  // View toggle (table/grid)
  document.querySelectorAll('.monitor-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.monitor-view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.getElementById('monitor-view-table').style.display = view === 'table' ? '' : 'none';
      document.getElementById('monitor-view-grid').style.display = view === 'grid' ? '' : 'none';
    });
  });

  // Auto-refresh a cada 15 segundos (monitor 24h alive)
  if (monitorInterval) clearInterval(monitorInterval);
  monitorInterval = setInterval(() => {
    const monPage = document.getElementById('page-monitoramento');
    if (monPage && monPage.classList.contains('active')) {
      loadMonitorData(true); // silent refresh
    }
  }, 15000);

  // Fullscreen toggle
  const btnFS = document.getElementById('btn-fullscreen');
  if (btnFS) {
    btnFS.addEventListener('click', toggleFullscreen);
  }

  // Primeira carga
  loadMonitorData();
}

// ── Tela Inteira ──
function toggleFullscreen() {
  const wrapper = document.getElementById('wrapper');
  const btn = document.getElementById('btn-fullscreen');
  if (!document.fullscreenElement) {
    (wrapper || document.documentElement).requestFullscreen().then(() => {
      document.body.classList.add('fullscreen-mode');
      if (btn) btn.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
    }).catch(() => {});
  } else {
    document.exitFullscreen().then(() => {
      document.body.classList.remove('fullscreen-mode');
      if (btn) btn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
    }).catch(() => {});
  }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    document.body.classList.remove('fullscreen-mode');
    const btn = document.getElementById('btn-fullscreen');
    if (btn) btn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
  }
});

// ── Plotly dark layout base ──
const PLOTLY_DARK_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: '#e2e8f0' },
  xaxis: { gridcolor: 'rgba(255,255,255,0.06)', tickfont: { color: '#94a3b8' } },
  yaxis: { gridcolor: 'rgba(255,255,255,0.06)', tickfont: { color: '#94a3b8' } },
  legend: { font: { color: '#cbd5e1' } },
};

async function loadMonitorData(silent = false) {
  const turno = document.getElementById('filtro-turno')?.value || 'todos';
  const nivel = document.getElementById('filtro-nivel')?.value || 'todos';
  const dataRef = document.getElementById('filtro-data-ref')?.value || '';

  const params = new URLSearchParams({
    periodo: monitorPeriodoAtual,
    turno,
    nivel,
    data_ref: dataRef,
  });

  try {
    // Carregar dados do monitoramento principal E CSV em paralelo
    const [data, csvData] = await Promise.all([
      fetch(`/api/monitoramento?${params}`).then(r => r.json()).catch(() => null),
      fetch(`/api/frequencia-csv?turno=${turno}&nivel=${nivel}`).then(r => r.json()).catch(() => null),
    ]);

    // Decidir fonte de dados: CSV tem prioridade se monitoramento não tem dados
    const usarCSV = csvData && !csvData.erro && csvData.turmas && csvData.turmas.length > 0;
    const monOk = data && !data.erro && data.turmas && data.turmas.length > 0;

    // Atualizar badge de fonte
    const fonteLabel = document.getElementById('monitor-fonte-label');
    const badgeFev = document.getElementById('badge-fev');
    
    if (usarCSV) {
      if (fonteLabel) fonteLabel.textContent = csvData.fonte || 'CSV SED';
      if (badgeFev && csvData.fevereiro_completo) badgeFev.style.display = '';
      
      const csvResumo = csvData.resumo || {};
      // Usar dados CSV para os cards e períodos
      renderMonitorCards({
        total_turmas: csvResumo.total_turmas || 0,
        total_alunos: csvResumo.total_alunos || 0,
        media_frequencia: Math.round(csvResumo.media_frequencia || 0),
        total_presencas: csvResumo.total_presencas || 0,
        total_faltas: csvResumo.total_faltas || 0,
      }, csvData.turmas_criticas?.length || 0);

      // Renderizar períodos do CSV
      if (csvData.freq_por_periodo) {
        const fp = csvData.freq_por_periodo;
        renderMonitorPeriodos({
          manha: fp.manha ? {
            percentual: Math.round(fp.manha.percentual || 0),
            total_turmas: fp.manha.total_turmas || 0,
          } : {},
          tarde: fp.tarde ? {
            percentual: Math.round(fp.tarde.percentual || 0),
            total_turmas: fp.tarde.total_turmas || 0,
          } : {},
          noite: fp.noite ? {
            percentual: Math.round(fp.noite.percentual || 0),
            total_turmas: fp.noite.total_turmas || 0,
          } : {},
        });
      }

      // Renderizar tabela e grid com dados CSV
      const turmasFormatadas = csvData.turmas.map(t => ({
        nome: t.nome || t.display || t.nome_completo,
        periodo: t.periodo || 'manha',
        nivel: t.nivel || 'ensino_medio',
        total_alunos: t.matriculas || 0,
        presencas: t.presencas || 0,
        faltas: t.faltas || 0,
        dias_registrados: t.aulas_dadas || 0,
        percentual: Math.round(t.presenca_pct || 0),
      }));
      renderMonitorTurmasTable(turmasFormatadas);
      renderMonitorTurmasGrid(turmasFormatadas);
      renderMonitorCriticos(csvData.turmas_criticas?.map(t => ({
        nome: t.nome || t.display || t.nome_completo,
        ra: '-',
        turma: t.nome || t.display,
        presencas: t.presencas || 0,
        faltas: t.faltas || 0,
        total_dias: t.aulas_dadas || 0,
        percentual: Math.round(t.presenca_pct || 0),
      })) || []);

      // Gráficos com dados CSV
      renderMonitorCharts({
        turmas: turmasFormatadas,
        resumo: {
          total_presencas: csvResumo.total_presencas || 0,
          total_faltas: csvResumo.total_faltas || 0,
          media_frequencia: Math.round(csvResumo.media_frequencia || 0),
        },
        freq_diaria: [],
      });

    } else if (monOk) {
      if (fonteLabel) fonteLabel.textContent = 'Banco de Dados';
      if (badgeFev) badgeFev.style.display = 'none';

      renderMonitorCards(data.resumo, data.alunos_criticos?.length || 0);
      renderMonitorPeriodos(data.freq_por_periodo);
      renderMonitorTurmasTable(data.turmas);
      renderMonitorTurmasGrid(data.turmas);
      renderMonitorCriticos(data.alunos_criticos || []);
      renderMonitorCharts(data);
    } else {
      if (fonteLabel) fonteLabel.textContent = 'Sem dados';
    }

    // Atualizar subtítulo e hora
    const subtitulo = document.getElementById('monitor-subtitulo');
    if (subtitulo) {
      const labels = {
        diario: 'Diário',
        semanal: 'Semanal',
        mensal: 'Mensal',
        bimestral: 'Bimestral',
        anual: 'Anual',
      };
      const periodo = usarCSV ? `Dados SED até ${csvData.referencia || '28/02/2026'}` : `${labels[monitorPeriodoAtual]} — ${data?.data_inicio || ''} a ${data?.data_fim || ''}`;
      subtitulo.textContent = periodo;
    }
    const ultimaAtt = document.getElementById('monitor-ultima-atualizacao');
    if (ultimaAtt) ultimaAtt.textContent = `Atualizado: ${agora()}`;

  } catch (err) {
    if (!silent) console.error('Monitor error:', err);
  }
}

function renderMonitorCards(resumo, criticos) {
  animateCounter(document.getElementById('mc-turmas'), resumo.total_turmas);
  animateCounter(document.getElementById('mc-alunos'), resumo.total_alunos);
  animateCounter(document.getElementById('mc-frequencia'), resumo.media_frequencia, '%');
  animateCounter(document.getElementById('mc-criticos'), criticos);
}

function renderMonitorPeriodos(freqPeriodo) {
  ['manha', 'tarde', 'noite'].forEach(p => {
    const data = freqPeriodo?.[p] || {};
    const perc = data.percentual || 0;
    const turmas = data.total_turmas || 0;

    const percEl = document.getElementById(`mp-${p}-perc`);
    const turmasEl = document.getElementById(`mp-${p}-turmas`);
    const barEl = document.getElementById(`mp-${p}-bar`);

    if (percEl) animateCounter(percEl, perc, '%');
    if (turmasEl) turmasEl.textContent = `${turmas} turmas`;
    if (barEl) setTimeout(() => { barEl.style.width = perc + '%'; }, 100);
  });
}

function renderMonitorTurmasTable(turmas) {
  const tbody = document.getElementById('corpo-tabela-monitor');
  if (!tbody) return;

  if (!turmas || !turmas.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Nenhum dado de frequência encontrado para o período selecionado.</td></tr>';
    return;
  }

  tbody.innerHTML = turmas.map(t => {
    const colorCls = freqColorClass(t.percentual);
    const color = freqColor(t.percentual);
    return `<tr>
      <td><strong>${t.nome}</strong></td>
      <td><span class="badge bg-${t.periodo === 'manha' ? 'warning' : t.periodo === 'tarde' ? 'info' : 'dark'} text-${t.periodo === 'manha' ? 'dark' : 'white'}">${periodoLabel(t.periodo)}</span></td>
      <td><small>${nivelLabel(t.nivel)}</small></td>
      <td class="text-center">${t.total_alunos}</td>
      <td class="text-center"><span class="badge bg-success">${t.presencas}</span></td>
      <td class="text-center"><span class="badge bg-danger">${t.faltas}</span></td>
      <td class="text-center">${t.dias_registrados}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="monitor-freq-bar">
            <div class="monitor-freq-fill" style="width:${t.percentual}%;background:${color};"></div>
          </div>
          <strong class="${colorCls}" style="min-width:45px;">${t.percentual}%</strong>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderMonitorTurmasGrid(turmas) {
  const grid = document.getElementById('monitor-view-grid');
  if (!grid) return;

  if (!turmas || !turmas.length) {
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Sem dados.</div>';
    return;
  }

  grid.innerHTML = turmas.map(t => {
    const colorCls = freqColorClass(t.percentual);
    const color = freqColor(t.percentual);
    const periodoBg = t.periodo === 'manha' ? 'warning' : t.periodo === 'tarde' ? 'info' : 'dark';
    return `<div class="col-6 col-md-3 col-lg-2">
      <div class="monitor-turma-mini">
        <div class="nome">${t.nome}</div>
        <span class="badge bg-${periodoBg} badge-periodo text-${t.periodo === 'manha' ? 'dark' : 'white'} mb-1">${periodoLabel(t.periodo)}</span>
        <div class="perc ${colorCls}">${t.percentual}%</div>
        <div class="monitor-progress mt-1">
          <div class="monitor-progress-bar" style="width:${t.percentual}%;background:${color};"></div>
        </div>
        <small class="text-muted">${t.total_alunos} alunos</small>
      </div>
    </div>`;
  }).join('');
}

function renderMonitorCriticos(criticos) {
  const tbody = document.getElementById('corpo-tabela-criticos');
  const semCrit = document.getElementById('monitor-sem-criticos');
  if (!tbody) return;

  if (!criticos.length) {
    tbody.innerHTML = '';
    if (semCrit) semCrit.style.display = '';
    return;
  }
  if (semCrit) semCrit.style.display = 'none';

  tbody.innerHTML = criticos.map(c => {
    const color = freqColor(c.percentual);
    return `<tr>
      <td><strong>${c.nome}</strong></td>
      <td>${c.ra || '-'}</td>
      <td><span class="badge bg-primary">${c.turma}</span></td>
      <td class="text-center"><span class="badge bg-success">${c.presencas}</span></td>
      <td class="text-center"><span class="badge bg-danger">${c.faltas}</span></td>
      <td class="text-center">${c.total_dias}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="monitor-freq-bar">
            <div class="monitor-freq-fill" style="width:${c.percentual}%;background:${color};"></div>
          </div>
          <strong style="color:${color};min-width:45px;">${c.percentual}%</strong>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ============================================================
// GRÁFICOS DO MONITOR — Com Animações
// ============================================================
function renderMonitorCharts(data) {
  const plotCfg = { responsive: true, displayModeBar: false };

  // 1. Gráfico de barras por turma (animated histogram style)
  renderChartTurmas(data.turmas, plotCfg);

  // 2. Gráfico de pizza (presença vs ausência)
  renderChartPizza(data.resumo, plotCfg);

  // 3. Gráfico temporal (animated line plot / oscilloscope style)
  renderChartTemporal(data.freq_diaria || [], plotCfg);
}

function renderChartTurmas(turmas, plotCfg) {
  const el = document.getElementById('chart-monitor-turmas');
  if (!el || !turmas?.length) return;

  const nomes = turmas.map(t => t.nome);
  const percentuais = turmas.map(t => t.percentual);
  const cores = turmas.map(t => freqColor(t.percentual));

  // Animated bar chart (como animated_histogram do matplotlib)
  Plotly.newPlot(el, [{
    x: nomes,
    y: percentuais,
    type: 'bar',
    marker: {
      color: cores,
      line: { color: cores.map(c => c), width: 1 },
    },
    text: percentuais.map(p => p + '%'),
    textposition: 'outside',
    textfont: { size: 10, color: '#94a3b8' },
    hovertemplate: '<b>%{x}</b><br>Frequência: %{y}%<extra></extra>',
  }], {
    ...PLOTLY_DARK_LAYOUT,
    title: { text: '', font: { size: 14 } },
    yaxis: {
      ...PLOTLY_DARK_LAYOUT.yaxis,
      range: [0, 105],
      title: { text: 'Frequência (%)', font: { color: '#94a3b8' } },
    },
    xaxis: {
      ...PLOTLY_DARK_LAYOUT.xaxis,
      tickangle: -45,
      tickfont: { size: 10, color: '#94a3b8' },
    },
    margin: { t: 20, b: 80, l: 50, r: 20 },
    height: 320,
    shapes: [{
      type: 'line',
      x0: -0.5, x1: nomes.length - 0.5,
      y0: 75, y1: 75,
      line: { color: '#ef4444', width: 2, dash: 'dash' },
    }],
    annotations: [{
      x: nomes.length - 1,
      y: 75,
      text: 'Mínimo 75%',
      showarrow: false,
      font: { color: '#ef4444', size: 10 },
      yshift: 12,
    }],
  }, plotCfg);

  // Animate bars growing (similar to matplotlib barGrow)
  animatePlotlyBars(el, percentuais);
}

function animatePlotlyBars(el, targetValues) {
  // Start with zero heights and animate to target
  Plotly.animate(el, {
    data: [{ y: targetValues }],
  }, {
    transition: { duration: 1200, easing: 'cubic-in-out' },
    frame: { duration: 1200 },
  }).catch(() => {}); // ignore if element removed
}

function renderChartPizza(resumo, plotCfg) {
  const el = document.getElementById('chart-monitor-pizza');
  if (!el) return;

  const presencas = resumo.total_presencas || 0;
  const faltas = resumo.total_faltas || 0;

  if (presencas === 0 && faltas === 0) {
    el.innerHTML = '<div class="text-center text-muted py-5"><i class="bi bi-pie-chart" style="font-size:2rem;"></i><p class="mt-2">Sem dados no período</p></div>';
    return;
  }

  Plotly.newPlot(el, [{
    labels: ['Presenças', 'Faltas'],
    values: [presencas, faltas],
    type: 'pie',
    hole: 0.55,
    marker: {
      colors: ['#22c55e', '#ef4444'],
      line: { color: '#162231', width: 2 },
    },
    textinfo: 'percent+label',
    textfont: { size: 12, color: '#e2e8f0' },
    hovertemplate: '<b>%{label}</b><br>%{value} registros<br>%{percent}<extra></extra>',
    pull: [0.02, 0.05],
    rotation: 90,
  }], {
    ...PLOTLY_DARK_LAYOUT,
    margin: { t: 10, b: 10, l: 10, r: 10 },
    height: 320,
    showlegend: true,
    legend: { orientation: 'h', y: -0.1, font: { color: '#cbd5e1' } },
    annotations: [{
      text: `<b>${resumo.media_frequencia}%</b>`,
      showarrow: false,
      font: { size: 22, color: '#00d4aa' },
    }],
  }, plotCfg);
}

function renderChartTemporal(freqDiaria, plotCfg) {
  const el = document.getElementById('chart-monitor-temporal');
  if (!el) return;

  if (!freqDiaria?.length) {
    el.innerHTML = '<div class="text-center text-muted py-5"><i class="bi bi-graph-up" style="font-size:2rem;"></i><p class="mt-2">Sem dados temporais para o período</p></div>';
    return;
  }

  const datas = freqDiaria.map(f => f.data);
  const percentuais = freqDiaria.map(f => f.percentual);
  const totais = freqDiaria.map(f => f.total);

  // Animated line plot (like simple_anim / oscilloscope from matplotlib)
  const traces = [
    {
      x: datas,
      y: percentuais,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Frequência %',
      line: {
        color: '#6366f1',
        width: 3,
        shape: 'spline',
        smoothing: 0.8,
      },
      marker: {
        size: 8,
        color: percentuais.map(p => freqColor(p)),
        line: { color: '#fff', width: 2 },
      },
      fill: 'tozeroy',
      fillcolor: 'rgba(99,102,241,.08)',
      hovertemplate: '<b>%{x}</b><br>Frequência: %{y}%<br>Total registros: %{customdata}<extra></extra>',
      customdata: totais,
    },
  ];

  const layout = {
    ...PLOTLY_DARK_LAYOUT,
    margin: { t: 10, b: 40, l: 50, r: 20 },
    height: 280,
    xaxis: {
      ...PLOTLY_DARK_LAYOUT.xaxis,
      tickangle: -30,
      tickfont: { size: 10, color: '#94a3b8' },
    },
    yaxis: {
      ...PLOTLY_DARK_LAYOUT.yaxis,
      range: [0, 105],
      title: { text: '%', font: { color: '#94a3b8' } },
    },
    shapes: [{
      type: 'line',
      x0: datas[0], x1: datas[datas.length - 1],
      y0: 75, y1: 75,
      line: { color: '#ef4444', width: 1.5, dash: 'dot' },
    }],
    showlegend: false,
  };

  Plotly.newPlot(el, traces, layout, plotCfg);

  // Animate the line drawing effect (decay/simple_anim style)
  animatePlotlyLine(el, datas, percentuais, totais);
}

function animatePlotlyLine(el, datas, values, totais) {
  // Progressive reveal animation - points appear one by one
  if (values.length <= 1) return;
  const frames = [];
  for (let i = 1; i <= values.length; i++) {
    frames.push({
      name: 'f' + i,
      data: [{
        x: datas.slice(0, i),
        y: values.slice(0, i),
        customdata: totais.slice(0, i),
      }],
    });
  }

  Plotly.addFrames(el, frames).then(() => {
    Plotly.animate(el, frames.map(f => f.name), {
      transition: { duration: 60, easing: 'cubic-in-out' },
      frame: { duration: 80, redraw: true },
      mode: 'afterall',
    });
  }).catch(() => {});
}

// ============================================================
// CALENDÁRIO PEDAGÓGICO 2026
// ============================================================
let calPedData = null;

async function loadCalendarioPedagogico() {
  if (calPedData) {
    renderCalendarioPedagogico(calPedData);
    return;
  }
  try {
    calPedData = await api('/api/calendario-pedagogico');
    renderCalendarioPedagogico(calPedData);
  } catch (err) {
    console.error('Erro ao carregar calendário pedagógico:', err);
  }
}

function renderCalendarioPedagogico(cal) {
  // Cards de resumo
  animateCounter(document.getElementById('cp-dias-letivos'), cal.total_dias_letivos || 200);
  animateCounter(document.getElementById('cp-feriados'), cal.feriados?.length || 0);
  animateCounter(document.getElementById('cp-avaliacoes'), cal.avaliacoes?.length || 0);
  animateCounter(document.getElementById('cp-olimpiadas'), cal.olimpiadas?.length || 0);

  // Bimestres
  const bimDiv = document.getElementById('cal-ped-bimestres');
  if (bimDiv && cal.bimestres) {
    bimDiv.innerHTML = cal.bimestres.map((b, i) => `
      <div class="col-md-3">
        <div class="cal-ped-bimestre bim-${i + 1}">
          <h6>${b.nome}</h6>
          <p class="mb-1"><i class="bi bi-calendar3"></i> ${b.inicio} a ${b.fim}</p>
          <p class="mb-0"><strong>${b.dias_letivos}</strong> dias letivos</p>
        </div>
      </div>
    `).join('');
  }

  // Grid de 12 meses
  const gridDiv = document.getElementById('cal-ped-grid');
  if (gridDiv) {
    gridDiv.innerHTML = _gerarCalPedGrid(cal);
  }

  // Lista de eventos
  const eventosDiv = document.getElementById('cal-ped-lista-eventos');
  if (eventosDiv) {
    eventosDiv.innerHTML = _gerarListaEventos(cal);
  }
}

function _gerarCalPedGrid(cal) {
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const hojeStr = new Date().toISOString().split('T')[0];

  // Build lookup maps for special dates
  const feriadosSet = new Set((cal.feriados || []).map(f => f.data));
  const recessosSet = new Set();
  (cal.recessos || []).forEach(r => {
    const start = new Date(r.inicio);
    const end = new Date(r.fim);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      recessosSet.add(d.toISOString().split('T')[0]);
    }
  });
  const avaliacoesSet = new Set();
  (cal.avaliacoes || []).forEach(a => {
    const start = new Date(a.inicio);
    const end = new Date(a.fim);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      avaliacoesSet.add(d.toISOString().split('T')[0]);
    }
  });
  const conselhosSet = new Set((cal.conselhos || []).map(c => c.data));
  const reunioesSet = new Set((cal.reunioes_pais || []).map(r => r.data));
  const replanejSet = new Set((cal.replanejamentos || []).map(r => r.data));
  const olimpiadasSet = new Set();
  (cal.olimpiadas || []).forEach(o => {
    if (o.data) olimpiadasSet.add(o.data);
    if (o.inicio && o.fim) {
      const start = new Date(o.inicio);
      const end = new Date(o.fim);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        olimpiadasSet.add(d.toISOString().split('T')[0]);
      }
    }
  });

  // February dates (complete)
  const fevCompleto = new Set();
  const inicioAulas = cal.inicio_aulas || '2026-02-03';
  const fimFev = '2026-02-28';
  for (let d = new Date(inicioAulas); d <= new Date(fimFev); d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().split('T')[0];
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !feriadosSet.has(ds)) {
      fevCompleto.add(ds);
    }
  }

  const ano = cal.ano || 2026;
  let html = '';
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(ano, m, 1).getDay();
    const daysInMonth = new Date(ano, m + 1, 0).getDate();
    html += `<div class="col-md-4 col-lg-3"><div class="monitor-chart-card p-2">`;
    html += `<h6 class="text-center mb-2" style="color:var(--accent);">${MESES[m]}</h6>`;
    html += '<table class="calendario-mes-table" style="width:100%;font-size:0.75rem;"><thead><tr>';
    html += '<th>D</th><th>S</th><th>T</th><th>Q</th><th>Q</th><th>S</th><th>S</th></tr></thead><tbody><tr>';
    for (let i = 0; i < firstDay; i++) html += '<td></td>';
    let dow = firstDay;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${ano}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isWeekend = dow === 0 || dow === 6;
      let cls = isWeekend ? 'dia-fds' : 'dia-util';
      let title = '';

      if (feriadosSet.has(dateStr)) { cls += ' dia-feriado'; title = 'Feriado'; }
      else if (recessosSet.has(dateStr)) { cls += ' dia-recesso'; title = 'Recesso'; }
      else if (avaliacoesSet.has(dateStr)) { cls += ' dia-avaliacao'; title = 'Avaliação AAP'; }
      else if (conselhosSet.has(dateStr)) { cls += ' dia-conselho'; title = 'Conselho de Classe'; }
      else if (reunioesSet.has(dateStr)) { cls += ' dia-reuniao'; title = 'Reunião de Pais'; }
      else if (replanejSet.has(dateStr)) { cls += ' dia-replanejamento'; title = 'Replanejamento'; }
      else if (olimpiadasSet.has(dateStr)) { cls += ' dia-olimpiada'; title = 'Olimpíada'; }
      
      if (fevCompleto.has(dateStr)) { cls += ' dia-fevereiro-completo'; title = title || 'Fevereiro - Completo'; }
      if (dateStr === hojeStr) cls += ' dia-hoje';

      html += `<td class="${cls}" title="${title}" style="text-align:center;padding:3px;cursor:default;">${d}</td>`;
      dow++;
      if (dow > 6) { if (d < daysInMonth) html += '</tr><tr>'; dow = 0; }
    }
    while (dow > 0 && dow <= 6) { html += '<td></td>'; dow++; }
    html += '</tr></tbody></table></div></div>';
  }
  return html;
}

function _gerarListaEventos(cal) {
  const eventos = [];
  
  (cal.feriados || []).forEach(f => eventos.push({ data: f.data, tipo: 'Feriado', nome: f.nome, cor: '#ef4444' }));
  (cal.recessos || []).forEach(r => eventos.push({ data: r.inicio, tipo: 'Recesso', nome: `${r.nome} (${r.inicio} a ${r.fim})`, cor: '#a855f7' }));
  (cal.avaliacoes || []).forEach(a => eventos.push({ data: a.inicio, tipo: 'Avaliação', nome: `${a.nome} (${a.inicio} a ${a.fim})`, cor: '#22d3ee' }));
  (cal.conselhos || []).forEach(c => eventos.push({ data: c.data, tipo: 'Conselho', nome: c.nome, cor: '#facc15' }));
  (cal.reunioes_pais || []).forEach(r => eventos.push({ data: r.data, tipo: 'Reunião Pais', nome: r.nome, cor: '#fb923c' }));
  (cal.replanejamentos || []).forEach(r => eventos.push({ data: r.data, tipo: 'Replanejamento', nome: r.nome, cor: '#6366f1' }));
  (cal.olimpiadas || []).forEach(o => eventos.push({ data: o.data || o.inicio, tipo: 'Olimpíada', nome: o.nome, cor: '#f472b6' }));
  if (cal.provao_paulista) {
    cal.provao_paulista.forEach(p => eventos.push({ data: p.inicio, tipo: 'Provão Paulista', nome: `${p.nome} (${p.inicio} a ${p.fim})`, cor: '#00d4aa' }));
  }

  eventos.sort((a, b) => (a.data || '').localeCompare(b.data || ''));

  return `<div class="table-responsive"><table class="table table-sm">
    <thead><tr><th>Data</th><th>Tipo</th><th>Evento</th></tr></thead>
    <tbody>${eventos.map(e => `
      <tr>
        <td><small>${e.data || '-'}</small></td>
        <td><span class="badge" style="background:${e.cor};color:#fff;">${e.tipo}</span></td>
        <td>${e.nome}</td>
      </tr>
    `).join('')}</tbody></table></div>`;
}

// ============================================================
// INÍCIO (Grid de turmas → clique abre Calendário)
// ============================================================
async function loadInicio() {
  try {
    turmasCache = await api('/api/turmas');
    const grid = document.getElementById('grid-inicio');
    const vazio = document.getElementById('inicio-vazio');

    // Se DB está vazio, carregar turmas do CSV
    if (!turmasCache.length) {
      try {
        const csvData = await fetch('/api/frequencia-csv').then(r => r.json());
        if (csvData && csvData.turmas && csvData.turmas.length) {
          turmasCache = csvData.turmas.map((t, i) => ({
            id: -(i + 1), // IDs negativos para turmas CSV
            nome: t.nome || t.display,
            display: t.display || t.nome,
            total_alunos: t.matriculas || 0,
            periodo: t.periodo || 'manha',
            nivel: t.nivel || 'ensino_medio',
            _csv: true,
          }));
        }
      } catch (e) { /* CSV indisponível */ }
    }

    if (!turmasCache.length) {
      grid.innerHTML = '';
      if (vazio) vazio.style.display = 'block';
      return;
    }
    if (vazio) vazio.style.display = 'none';

    // Get current turno filter
    const turnoAtivo = document.querySelector('.inicio-turno-btn.active')?.dataset?.turno || 'todos';

    const filtrado = turmasCache.filter(t => {
      if (turnoAtivo === 'todos') return true;
      // Suportar turmas do banco (por nome no PERIODOS_CONFIG) e do CSV (por campo periodo)
      if (t._csv) return t.periodo === turnoAtivo;
      const periodo = PERIODOS_CONFIG[turnoAtivo] || [];
      return periodo.includes(t.nome);
    });

    if (!filtrado.length) {
      grid.innerHTML = '<div class="col-12 text-center text-muted py-4">Nenhuma turma neste turno.</div>';
      return;
    }

    grid.innerHTML = filtrado.map(t => {
      // Detect period
      let periodo = t.periodo || 'manha';
      if (!t._csv) {
        for (const [p, lista] of Object.entries(PERIODOS_CONFIG)) {
          if (lista.includes(t.nome)) { periodo = p; break; }
        }
      }
      const bgColor = periodo === 'manha' ? '#f59e0b' : periodo === 'tarde' ? '#3b82f6' : '#6366f1';
      const displayName = t.display || t.nome;
      const onclickAction = t._csv
        ? `toast('Turma ${displayName.replace(/'/g, "\\'")} — dados somente leitura do CSV SED', 'info')`
        : `abrirCalendario(${t.id}, '${t.nome.replace(/'/g, "\\'")}')`;
      return `
      <div class="col-md-4 col-lg-3">
        <div class="turma-card-inicio" onclick="${onclickAction}">
          <div class="turma-icon" style="background:${bgColor};">
            <i class="bi bi-${periodo === 'manha' ? 'sunrise' : periodo === 'tarde' ? 'sun' : 'moon-stars'}"></i>
          </div>
          <h4>${displayName}</h4>
          <span class="alunos-count">${t.total_alunos || 0} alunos</span>
          ${t._csv ? '<span class="badge badge-fonte mt-1" style="font-size:0.65rem;"><i class="bi bi-database"></i> CSV SED</span>' : ''}
        </div>
      </div>`;
    }).join('');
  } catch (err) { console.error(err); }
}

// Turno filter buttons on inicio page
document.querySelectorAll('.inicio-turno-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.inicio-turno-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadInicio();
  });
});

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
  // Fevereiro 2026 marcado como completo (a partir de 03/02)
  const fevCompletoInicio = `${ano}-02-03`;
  const fevCompletoFim = `${ano}-02-28`;
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
      // Marcar fevereiro como completo
      if (m === 1 && ano === 2026 && !isWeekend && dateStr >= fevCompletoInicio && dateStr <= fevCompletoFim) {
        cls += ' dia-fevereiro-completo';
      }
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
    ...PLOTLY_DARK_LAYOUT,
    title: { text: 'Frequência por Aluno (%)', font: { color: '#e2e8f0' } },
    yaxis: { ...PLOTLY_DARK_LAYOUT.yaxis, range: [0, 100], title: '%' },
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
  const layoutBase = { ...PLOTLY_DARK_LAYOUT, margin: { t: 10, b: 30, l: 30, r: 10 }, height: 280, showlegend: true };

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
  initLogin();
  initIA();
});

// ============================================================
// ADMIN: Verificar e Corrigir Duplicados
// ============================================================
document.getElementById('btn-verificar-duplicados')?.addEventListener('click', async () => {
  const resultado = document.getElementById('duplicados-resultado');
  resultado.innerHTML = '<div class="text-muted"><i class="bi bi-hourglass-split spin"></i> Verificando...</div>';

  try {
    // Verificar todas as turmas, foco na 1A
    const data = await api('/api/duplicados');

    if (!data.duplicados || !data.duplicados.length) {
      resultado.innerHTML = '<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> Nenhum aluno duplicado encontrado.</div>';
      document.getElementById('btn-corrigir-duplicados').style.display = 'none';
      return;
    }

    let html = `<div class="alert alert-warning"><i class="bi bi-exclamation-triangle"></i> <strong>${data.total_grupos}</strong> grupo(s) de duplicados encontrado(s):</div>`;
    html += '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Turma</th><th>Nome</th><th>Registros</th><th>IDs</th></tr></thead><tbody>';
    for (const d of data.duplicados) {
      const ids = d.registros.map(r => '#' + r.id).join(', ');
      html += `<tr><td><span class="badge bg-primary">${d.turma}</span></td><td>${d.nome}</td><td>${d.total}</td><td><small class="text-muted">${ids}</small></td></tr>`;
    }
    html += '</tbody></table></div>';
    resultado.innerHTML = html;
    document.getElementById('btn-corrigir-duplicados').style.display = '';
  } catch (err) {
    resultado.innerHTML = `<div class="alert alert-danger mb-0">Erro: ${err.message}</div>`;
  }
});

document.getElementById('btn-corrigir-duplicados')?.addEventListener('click', async () => {
  if (!confirm('Remover alunos duplicados? O registro mais recente será mantido e os anteriores serão removidos.')) return;

  const resultado = document.getElementById('duplicados-resultado');
  try {
    const data = await api('/api/duplicados/corrigir', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    resultado.innerHTML = `<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> <strong>${data.removidos}</strong> registro(s) duplicado(s) removido(s) com sucesso.</div>`;
    document.getElementById('btn-corrigir-duplicados').style.display = 'none';
    toast(`${data.removidos} duplicados removidos!`);
    // Recarregar monitor
    loadMonitorData();
  } catch (err) {
    resultado.innerHTML = `<div class="alert alert-danger mb-0">Erro: ${err.message}</div>`;
  }
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

// ============================================================
// ALERTAS WHATSAPP
// ============================================================

let _wppCache = null;
let _wppFiltroTurno = 'todos';
let _wppFiltroTipo = 'todos';
let _wppPagina = 1;
const WPP_POR_PAGINA = 50;

async function loadAlertasWhatsapp() {
  try {
    const params = new URLSearchParams({ turno: _wppFiltroTurno, tipo: _wppFiltroTipo });
    const data = await fetch(`/api/alertas-frequencia?${params}`).then(r => r.json());
    _wppCache = data;

    // Cards de resumo
    const r = data.resumo;
    _wppSetText('wpp-total-alunos', r.total_alunos);
    _wppSetText('wpp-total-criticos', r.total_criticos);
    _wppSetText('wpp-com-telefone', r.total_com_whatsapp);
    _wppSetText('wpp-sem-telefone', r.total_sem_whatsapp);
    _wppSetText('wpp-total-atencao', r.total_atencao);
    _wppSetText('wpp-turmas-criticas', r.total_turmas_criticas);

    // Gráfico
    _wppRenderChart(data.turmas);

    // Tabela
    _wppPagina = 1;
    _wppRenderTabela(data.alunos);

    // Listeners (só na primeira vez)
    _wppInitListeners();

  } catch (err) {
    console.error('Erro ao carregar alertas WhatsApp:', err);
  }
}

function _wppSetText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '--';
}

let _wppListenersInit = false;
function _wppInitListeners() {
  if (_wppListenersInit) return;
  _wppListenersInit = true;

  // Turno buttons
  document.querySelectorAll('#wpp-turno-btns .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#wpp-turno-btns .btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _wppFiltroTurno = btn.dataset.turno;
      loadAlertasWhatsapp();
    });
  });

  // Tipo buttons
  document.querySelectorAll('#wpp-tipo-btns .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#wpp-tipo-btns .btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _wppFiltroTipo = btn.dataset.tipo;
      loadAlertasWhatsapp();
    });
  });

  // Busca
  const buscaInput = document.getElementById('wpp-busca-aluno');
  if (buscaInput) {
    let timer;
    buscaInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        _wppPagina = 1;
        _wppRenderTabela(_wppFilterBySearch(_wppCache?.alunos || []));
      }, 300);
    });
  }

  // Exportar
  const btnExportar = document.getElementById('wpp-btn-exportar');
  if (btnExportar) btnExportar.addEventListener('click', _wppExportarCSV);

  // Config modal
  const btnConfig = document.getElementById('wpp-btn-config');
  if (btnConfig) {
    btnConfig.addEventListener('click', (e) => {
      e.preventDefault();
      const modal = new bootstrap.Modal(document.getElementById('modalConfigWhatsapp'));
      // Carregar valores salvos
      const cfg = JSON.parse(localStorage.getItem('wpp_config') || '{}');
      document.getElementById('wpp-api-url').value = cfg.url || '';
      document.getElementById('wpp-api-token').value = cfg.token || '';
      document.getElementById('wpp-instancia').value = cfg.instancia || '';
      modal.show();
    });
  }

  // Salvar config
  const btnSalvar = document.getElementById('wpp-btn-salvar-config');
  if (btnSalvar) {
    btnSalvar.addEventListener('click', () => {
      const cfg = {
        url: document.getElementById('wpp-api-url').value.trim(),
        token: document.getElementById('wpp-api-token').value.trim(),
        instancia: document.getElementById('wpp-instancia').value.trim(),
      };
      localStorage.setItem('wpp_config', JSON.stringify(cfg));
      bootstrap.Modal.getInstance(document.getElementById('modalConfigWhatsapp'))?.hide();
      toast('Configuração salva no navegador!', 'success');
    });
  }
}

function _wppFilterBySearch(alunos) {
  const busca = (document.getElementById('wpp-busca-aluno')?.value || '').toLowerCase().trim();
  if (!busca) return alunos;
  return alunos.filter(a =>
    a.nome.toLowerCase().includes(busca) ||
    a.turma.toLowerCase().includes(busca) ||
    (a.responsavel || '').toLowerCase().includes(busca) ||
    (a.ra || '').includes(busca)
  );
}

function _wppRenderChart(turmas) {
  const container = document.getElementById('wpp-chart-turmas');
  if (!container || !turmas?.length) return;

  const nomes = turmas.map(t => t.display || t.turma);
  const valores = turmas.map(t => t.presenca_pct);
  const cores = valores.map(v => v < 75 ? '#ef4444' : v < 80 ? '#f59e0b' : '#00d4aa');

  const trace = {
    x: nomes, y: valores, type: 'bar',
    marker: { color: cores, line: { color: cores.map(c => c), width: 1 } },
    text: valores.map(v => v.toFixed(1) + '%'),
    textposition: 'outside',
    textfont: { size: 10, color: '#94a3b8' },
  };

  const layout = {
    ...PLOTLY_DARK_LAYOUT,
    margin: { t: 10, b: 80, l: 50, r: 20 },
    xaxis: { ...PLOTLY_DARK_LAYOUT.xaxis, tickangle: -45, tickfont: { size: 9, color: '#94a3b8' } },
    yaxis: { ...PLOTLY_DARK_LAYOUT.yaxis, title: 'Presença (%)', range: [0, 105] },
    shapes: [{
      type: 'line', x0: -0.5, x1: nomes.length - 0.5, y0: 75, y1: 75,
      line: { color: '#ef4444', width: 2, dash: 'dash' },
    }],
    annotations: [{
      x: nomes.length - 1, y: 75, text: '75% mínimo', showarrow: false,
      font: { color: '#ef4444', size: 10 }, yshift: 12,
    }],
  };

  Plotly.newPlot(container, [trace], layout, { responsive: true, displayModeBar: false });
}

function _wppRenderTabela(alunos) {
  const body = document.getElementById('wpp-tabela-body');
  const info = document.getElementById('wpp-tabela-info');
  if (!body) return;

  const filtrados = _wppFilterBySearch(alunos || []);
  const total = filtrados.length;
  const totalPaginas = Math.ceil(total / WPP_POR_PAGINA);
  const inicio = (_wppPagina - 1) * WPP_POR_PAGINA;
  const pagina = filtrados.slice(inicio, inicio + WPP_POR_PAGINA);

  if (!pagina.length) {
    body.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Nenhum aluno encontrado.</td></tr>';
    if (info) info.textContent = '0 alunos';
    return;
  }

  const periodoLabel = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', desconhecido: '—' };

  body.innerHTML = pagina.map(a => {
    const statusBadge = a.status === 'critico'
      ? '<span class="wpp-badge-critico">Crítico</span>'
      : a.status === 'atencao'
        ? '<span class="wpp-badge-atencao">Atenção</span>'
        : '<span class="wpp-badge-regular">Regular</span>';

    const freqColor = a.presenca_pct_turma < 75 ? '#ef4444' : a.presenca_pct_turma < 80 ? '#f59e0b' : '#00d4aa';
    const freqBar = `<div class="wpp-freq-bar">
      <div class="wpp-freq-bar-bg"><div class="wpp-freq-bar-fill" style="width:${Math.min(a.presenca_pct_turma, 100)}%;background:${freqColor};"></div></div>
      <span class="wpp-freq-bar-label" style="color:${freqColor};">${a.presenca_pct_turma.toFixed(1)}%</span>
    </div>`;

    const phoneCel = a.celulares?.length
      ? a.celulares.map(c => `<span class="wpp-phone-display">${_wppFormatPhone(c)}</span>`).join('<br>')
      : '<span class="wpp-phone-none">Sem telefone</span>';

    const wppLink = a.celulares?.length
      ? `<button class="btn-wpp-enviar" onclick="_wppEnviarMsg('${a.celulares[0]}', '${a.nome.replace(/'/g, "\\\\'")}')"
          title="Enviar mensagem WhatsApp"><i class="bi bi-whatsapp"></i> Enviar</button>`
      : '<button class="btn-wpp-enviar" disabled><i class="bi bi-telephone-x"></i></button>';

    return `<tr>
      <td>${statusBadge}</td>
      <td class="aluno-nome" title="${a.nome}">${a.nome}</td>
      <td><strong>${a.turma}</strong></td>
      <td>${periodoLabel[a.periodo] || a.periodo}</td>
      <td style="font-size:0.78rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${a.responsavel || ''}">${a.responsavel || '—'}</td>
      <td>${phoneCel}</td>
      <td>${freqBar}</td>
      <td>${wppLink}</td>
    </tr>`;
  }).join('');

  if (info) info.textContent = `Exibindo ${inicio + 1}-${Math.min(inicio + WPP_POR_PAGINA, total)} de ${total} alunos`;

  // Paginação
  _wppRenderPaginacao(totalPaginas, filtrados);
}

function _wppRenderPaginacao(totalPaginas, alunos) {
  const pag = document.getElementById('wpp-paginacao');
  if (!pag || totalPaginas <= 1) { if (pag) pag.innerHTML = ''; return; }

  let html = '';
  const maxBtns = 7;
  let start = Math.max(1, _wppPagina - 3);
  let end = Math.min(totalPaginas, start + maxBtns - 1);
  if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

  if (_wppPagina > 1) html += `<li class="page-item"><a class="page-link" href="#" data-pg="${_wppPagina - 1}">&laquo;</a></li>`;
  for (let i = start; i <= end; i++) {
    html += `<li class="page-item ${i === _wppPagina ? 'active' : ''}""><a class="page-link" href="#" data-pg="${i}">${i}</a></li>`;
  }
  if (_wppPagina < totalPaginas) html += `<li class="page-item"><a class="page-link" href="#" data-pg="${_wppPagina + 1}">&raquo;</a></li>`;

  pag.innerHTML = html;
  pag.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      _wppPagina = parseInt(a.dataset.pg);
      _wppRenderTabela(alunos);
    });
  });
}

function _wppFormatPhone(num) {
  // 5516994352785 → (16) 99435-2785
  if (!num || num.length < 12) return num;
  const ddd = num.substring(2, 4);
  const rest = num.substring(4);
  if (rest.length === 9) return `(${ddd}) ${rest.substring(0,5)}-${rest.substring(5)}`;
  return `(${ddd}) ${rest}`;
}

function _wppEnviarMsg(numero, nomeAluno) {
  const cfg = JSON.parse(localStorage.getItem('wpp_config') || '{}');

  if (cfg.url && cfg.token && cfg.instancia) {
    // Envio via Evolution API
    const msg = _wppCache?.mensagem_modelo_critico
      ?.replace('{nome}', nomeAluno)
      ?.replace('{presenca}', '--')
      ?.replace('{turma}', '--')
      ?.replace('{periodo}', '--') || `Aviso sobre frequência de ${nomeAluno}`;

    fetch(`${cfg.url}/message/sendText/${cfg.instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.token },
      body: JSON.stringify({ number: numero, text: msg }),
    })
    .then(r => r.json())
    .then(d => {
      if (d.key || d.status === 'PENDING') toast(`Mensagem enviada para ${nomeAluno}!`, 'success');
      else toast('Erro ao enviar. Verifique a configuração.', 'error');
    })
    .catch(() => toast('Falha na conexão com Evolution API.', 'error'));
  } else {
    // Fallback: abrir WhatsApp Web
    const texto = encodeURIComponent(`Prezado(a) responsável, informamos sobre a frequência do(a) aluno(a) ${nomeAluno}. Em caso de dúvidas, procure a secretaria da escola EE Prof. Dalmaso.`);
    window.open(`https://wa.me/${numero}?text=${texto}`, '_blank');
  }
}

function _wppExportarCSV() {
  if (!_wppCache?.alunos?.length) { toast('Sem dados para exportar', 'error'); return; }

  const filtrados = _wppFilterBySearch(_wppCache.alunos);
  const linhas = [
    ['Status', 'Aluno', 'Turma', 'Período', 'RA', 'Responsável', 'WhatsApp', 'Freq Turma (%)'].join(';'),
    ...filtrados.map(a => [
      a.status,
      `"${a.nome}"`,
      a.turma,
      a.periodo,
      a.ra,
      `"${a.responsavel || ''}"`,
      a.celulares?.join(' / ') || 'SEM TELEFONE',
      a.presenca_pct_turma?.toFixed(1),
    ].join(';'))
  ];

  const blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alertas_whatsapp_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${filtrados.length} alunos exportados!`, 'success');
}