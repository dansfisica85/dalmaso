// ========================
// POPUP.JS - Controle da extensão
// ========================

const btnIniciar = document.getElementById('btnIniciar');
const btnParar = document.getElementById('btnParar');
const btnBaixarCSV = document.getElementById('btnBaixarCSV');
const btnLimpar = document.getElementById('btnLimpar');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const dadosInfo = document.getElementById('dadosInfo');
const infoExtraidos = document.getElementById('infoExtraidos');
const infoErros = document.getElementById('infoErros');
const logArea = document.getElementById('logArea');

// Cabeçalho do CSV (separador: ;)
const CSV_HEADER = [
  'série/ano', 'numero_linha', 'nome', 'ra_lista', 'serie', 'uf_lista',
  'data_nasc_lista', 'responsavel_lista', 'cabecalho', 'ra_cabecalho',
  'data_nascimento_cabecalho', 'Data de Alteração', 'Nome',
  'Informar Nome Social?', 'Informar Nome Afetivo?', 'Sexo', 'Raça/Cor',
  'Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem',
  'Idade Mínima Especial', 'Data de Nascimento', 'Falecimento', 'Refugiado',
  'Emancipado', 'Irmão(s)', 'E-Mail Google', 'E-Mail Microsoft', 'Filiação 1',
  'Filiação 2', 'Participa do Programa Bolsa Família', 'RA',
  'Identificação Única - Educacenso', 'Nacionalidade', 'Município de Nascimento',
  'Sigilo', 'Quilombola', 'Membro de Comunidade Circense e/ou Cigana',
  'Possui internet em casa', 'Possui smartphone, tablet ou notebook pessoal',
  'Carteira de Identidade Nacional (CIN)', 'CPF', 'Documento Civil RG',
  'Data Emissão RG/RNM', 'Data de emissão', 'Cert. Matr.',
  'Investigação de deficiência', 'Estudante com Deficiência',
  'Altas Habilidades/Superdotação', 'Laudo Médico', 'Nível de Apoio',
  'Necessita de Profissional de apoio Escolar?', 'Mobilidade Reduzida', 'CEP',
  'Localização/Zona de Residência', 'Localização Diferenciada', 'Endereço - Nº',
  'Complemento', 'Bairro', 'Cidade - UF', 'Latitude/Longitude',
  'Mostrar102550100registros', 'Idade', 'nrDigRa', 'sgUfRa', 'DigRgAluno',
  'EnderecoNR', 'Longitude', 'telefones_formatados',
  'Recursos Necessários para a Participação do Aluno em Avaliações',
  'NIS', 'Cartão Nacional de Saúde - SUS', 'Tipo Sanguíneo', 'UFNascimento',
  'Data Emissão do CIN', 'E-Mail'
];

function setStatus(text, type = '') {
  statusBar.className = `status-bar ${type}`;
  statusText.textContent = text;
}

function addLog(msg, type = '') {
  logArea.style.display = 'block';
  const entry = document.createElement('div');
  entry.className = `log-entry ${type ? 'log-' + type : ''}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logArea.appendChild(entry);
  logArea.scrollTop = logArea.scrollHeight;
}

function updateProgress(current, total) {
  progressContainer.style.display = 'block';
  const pct = total > 0 ? (current / total * 100) : 0;
  progressFill.style.width = pct + '%';
  progressText.textContent = `${current} / ${total} alunos`;
}

// Carregar estado salvo ao abrir popup
async function loadState() {
  const stored = await chrome.storage.local.get(['sed_alunos', 'sed_erros', 'sed_running']);
  const alunos = stored.sed_alunos || [];
  const erros = stored.sed_erros || 0;
  const running = stored.sed_running || false;

  infoExtraidos.textContent = alunos.length;
  infoErros.textContent = erros;

  if (alunos.length > 0) {
    dadosInfo.style.display = 'block';
    btnBaixarCSV.style.display = 'block';
  }

  if (running) {
    setStatus('Extração em andamento...', 'working');
    btnIniciar.style.display = 'none';
    btnParar.style.display = 'block';
  } else if (alunos.length > 0) {
    setStatus(`Extração concluída: ${alunos.length} alunos`, 'success');
  }
}

// Iniciar extração
btnIniciar.addEventListener('click', async () => {
  const serieAno = document.getElementById('serieAno').value.trim();
  const delayMs = parseInt(document.getElementById('delayMs').value) || 2000;

  if (!serieAno) {
    setStatus('Informe a série/ano!', 'error');
    return;
  }

  // Limpar dados anteriores
  await chrome.storage.local.set({ sed_alunos: [], sed_erros: 0, sed_running: true });

  setStatus('Iniciando extração...', 'working');
  btnIniciar.style.display = 'none';
  btnParar.style.display = 'block';
  addLog('Extração iniciada para turma: ' + serieAno, 'info');

  // Enviar mensagem para o content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url?.includes('sed.educacao.sp.gov.br')) {
    setStatus('Abra a página SED primeiro!', 'error');
    btnIniciar.style.display = 'block';
    btnParar.style.display = 'none';
    await chrome.storage.local.set({ sed_running: false });
    return;
  }

  chrome.tabs.sendMessage(tab.id, {
    action: 'INICIAR_EXTRACAO',
    serieAno,
    delayMs,
  });
});

// Parar extração
btnParar.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'PARAR_EXTRACAO' });
  }
  await chrome.storage.local.set({ sed_running: false });
  setStatus('Extração interrompida', 'error');
  btnIniciar.style.display = 'block';
  btnParar.style.display = 'none';
  addLog('Extração interrompida pelo usuário', 'error');
});

// Baixar CSV
btnBaixarCSV.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['sed_alunos']);
  const alunos = stored.sed_alunos || [];
  if (alunos.length === 0) {
    setStatus('Nenhum dado para exportar', 'error');
    return;
  }

  const serieAno = document.getElementById('serieAno').value.trim() || 'turma';
  let csv = CSV_HEADER.join(';') + '\n';

  alunos.forEach((aluno, idx) => {
    const row = CSV_HEADER.map(col => {
      let val = aluno[col] || '';
      // Escapar ; dentro dos valores
      if (typeof val === 'string' && val.includes(';')) {
        val = val.replace(/;/g, ',');
      }
      return val;
    });
    csv += row.join(';') + '\n';
  });

  // Download
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${serieAno}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  addLog(`CSV baixado: ${serieAno}.csv (${alunos.length} alunos)`, 'success');
});

// Limpar dados
btnLimpar.addEventListener('click', async () => {
  await chrome.storage.local.set({ sed_alunos: [], sed_erros: 0, sed_running: false });
  dadosInfo.style.display = 'none';
  btnBaixarCSV.style.display = 'none';
  infoExtraidos.textContent = '0';
  infoErros.textContent = '0';
  logArea.innerHTML = '';
  logArea.style.display = 'none';
  progressContainer.style.display = 'none';
  setStatus('Dados limpos', '');
  addLog('Dados limpos', 'info');
});

// Escutar mensagens do content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESSO') {
    updateProgress(msg.current, msg.total);
    infoExtraidos.textContent = msg.current;
    dadosInfo.style.display = 'block';
    setStatus(`Extraindo aluno ${msg.current} de ${msg.total}: ${msg.nome || ''}`, 'working');
    addLog(`✓ ${msg.nome}`, 'success');
  }

  if (msg.type === 'ERRO_ALUNO') {
    infoErros.textContent = parseInt(infoErros.textContent) + 1;
    addLog(`✗ Erro: ${msg.erro}`, 'error');
  }

  if (msg.type === 'CONCLUIDO') {
    setStatus(`Extração concluída: ${msg.total} alunos`, 'success');
    btnIniciar.style.display = 'block';
    btnParar.style.display = 'none';
    btnBaixarCSV.style.display = 'block';
    addLog(`Extração concluída! ${msg.total} alunos extraídos.`, 'success');
  }

  if (msg.type === 'LOG') {
    addLog(msg.texto, msg.nivel || '');
  }
});

// Inicializar
loadState();
