// ==UserScript==
// @name         Extrator SED - Dados de Alunos
// @namespace    https://sed.educacao.sp.gov.br
// @version      1.0
// @description  Extrai dados pessoais e telefones dos alunos do SED
// @author       Dalmaso
// @match        *://sed.educacao.sp.gov.br/*
// @match        *://*.educacao.sp.gov.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // Evitar duplicação
  if (document.getElementById('sed-extrator-painel')) return;

  // ===================== CSS =====================
  const css = document.createElement('style');
  css.textContent = `
    #sed-extrator-painel {
      position: fixed; top: 10px; right: 10px; width: 380px;
      background: #fff; border: 2px solid #007bff; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25); z-index: 2147483647;
      font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #333;
      overflow: hidden; transition: all 0.3s ease;
    }
    #sed-extrator-painel.minimizado { width: 200px; }
    #sed-extrator-painel.minimizado .sed-corpo { display: none; }
    .sed-cabecalho {
      background: linear-gradient(135deg, #007bff, #0056b3); color: white;
      padding: 12px 16px; display: flex; justify-content: space-between;
      align-items: center; cursor: move; user-select: none;
    }
    .sed-cabecalho h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .sed-cabecalho-btns { display: flex; gap: 6px; }
    .sed-cabecalho-btns button {
      background: rgba(255,255,255,0.2); border: none; color: white;
      width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 14px;
    }
    .sed-cabecalho-btns button:hover { background: rgba(255,255,255,0.4); }
    .sed-corpo { padding: 16px; max-height: 70vh; overflow-y: auto; }
    .sed-btn {
      width: 100%; padding: 10px 16px; border: none; border-radius: 8px;
      cursor: pointer; font-size: 14px; font-weight: 600; color: white;
      transition: all 0.2s; margin-bottom: 8px;
    }
    .sed-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .sed-btn-iniciar { background: linear-gradient(135deg, #28a745, #218838); }
    .sed-btn-pausar { background: linear-gradient(135deg, #ffc107, #e0a800); color: #333; }
    .sed-btn-continuar { background: linear-gradient(135deg, #17a2b8, #138496); }
    .sed-btn-parar { background: linear-gradient(135deg, #dc3545, #c82333); }
    .sed-btn-baixar { background: linear-gradient(135deg, #007bff, #0056b3); }
    .sed-btn-limpar { background: #6c757d; }
    .sed-btn-grupo { display: flex; gap: 8px; margin-bottom: 8px; }
    .sed-btn-grupo .sed-btn { margin-bottom: 0; }
    .sed-progresso-container { margin-bottom: 12px; }
    .sed-progresso-info {
      display: flex; justify-content: space-between; margin-bottom: 4px;
      font-size: 12px; color: #666;
    }
    .sed-progresso-barra-bg {
      background: #e9ecef; border-radius: 10px; height: 22px;
      position: relative; overflow: hidden;
    }
    .sed-progresso-barra {
      background: linear-gradient(90deg, #28a745, #20c997);
      height: 100%; border-radius: 10px; transition: width 0.5s ease;
    }
    .sed-progresso-texto {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%); font-size: 11px; font-weight: 700;
    }
    .sed-stats {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;
    }
    .sed-stat-box {
      background: #f8f9fa; border-radius: 8px; padding: 8px; text-align: center;
    }
    .sed-stat-numero { font-size: 20px; font-weight: 700; color: #007bff; }
    .sed-stat-label { font-size: 11px; color: #666; }
    .sed-status {
      padding: 8px 12px; border-radius: 6px; margin-bottom: 10px;
      font-size: 13px; background: #e7f3ff; border-left: 4px solid #007bff;
    }
    .sed-status-ok { background: #d4edda; border-left-color: #28a745; }
    .sed-status-erro { background: #f8d7da; border-left-color: #dc3545; }
    .sed-log {
      background: #1e1e2e; color: #cdd6f4; border-radius: 8px;
      padding: 10px; max-height: 200px; overflow-y: auto; font-family: monospace;
      font-size: 11px; margin-bottom: 10px;
    }
    .sed-log-item { margin-bottom: 3px; border-bottom: 1px solid #313244; padding-bottom: 3px; }
    .sed-log-ok { color: #a6e3a1; }
    .sed-log-erro { color: #f38ba8; }
    .sed-log-info { color: #89b4fa; }
    .sed-config { margin-bottom: 12px; }
    .sed-config-row { display: flex; gap: 10px; }
    .sed-config-row > div { flex: 1; }
    .sed-config-row label { display: block; font-size: 11px; color: #666; margin-bottom: 2px; }
    .sed-config-row input {
      width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 6px;
      font-size: 13px; box-sizing: border-box;
    }
    .sed-separador { border: none; border-top: 1px solid #dee2e6; margin: 12px 0; }
  `;
  document.head.appendChild(css);

  // ===================== ESTADO =====================
  const estado = {
    rodando: false,
    pausado: false,
    parar: false,
    alunos: [],
    totalProcessados: 0,
    totalLinhas: 0,
    paginaAtual: 1,
    erros: 0,
    inicio: null,
    delays: { entreAcoes: 2000, carregamento: 3000, fecharModal: 1500 }
  };

  // ===================== INTERFACE =====================
  function criarPainel() {
    const painel = document.createElement('div');
    painel.id = 'sed-extrator-painel';
    painel.innerHTML = `
      <div class="sed-cabecalho" id="sed-drag-handle">
        <h3>📋 Extrator SED</h3>
        <div class="sed-cabecalho-btns">
          <button id="sed-btn-min" title="Minimizar">_</button>
          <button id="sed-btn-fechar" title="Fechar">✕</button>
        </div>
      </div>
      <div class="sed-corpo">
        <div class="sed-config">
          <div class="sed-config-row">
            <div>
              <label>Delay ações (ms):</label>
              <input type="number" id="sed-delay-acoes" value="2000" min="500" max="10000" step="500">
            </div>
            <div>
              <label>Delay modal (ms):</label>
              <input type="number" id="sed-delay-modal" value="3000" min="1000" max="15000" step="500">
            </div>
          </div>
        </div>
        <button class="sed-btn sed-btn-iniciar" id="sed-btn-iniciar">▶ INICIAR EXTRAÇÃO</button>
        <div id="sed-controles-exec" style="display:none;">
          <div class="sed-btn-grupo">
            <button class="sed-btn sed-btn-pausar" id="sed-btn-pausar">⏸ Pausar</button>
            <button class="sed-btn sed-btn-parar" id="sed-btn-parar">⏹ Parar</button>
          </div>
        </div>
        <div class="sed-progresso-container" id="sed-progresso" style="display:none;">
          <div class="sed-progresso-info">
            <span id="sed-progresso-atual">0 / 0</span>
            <span id="sed-progresso-tempo">00:00</span>
          </div>
          <div class="sed-progresso-barra-bg">
            <div class="sed-progresso-barra" id="sed-progresso-barra" style="width:0%"></div>
            <div class="sed-progresso-texto" id="sed-progresso-pct">0%</div>
          </div>
        </div>
        <div class="sed-stats" id="sed-stats" style="display:none;">
          <div class="sed-stat-box">
            <div class="sed-stat-numero" id="sed-stat-extraidos">0</div>
            <div class="sed-stat-label">Extraídos</div>
          </div>
          <div class="sed-stat-box">
            <div class="sed-stat-numero" id="sed-stat-erros">0</div>
            <div class="sed-stat-label">Erros</div>
          </div>
          <div class="sed-stat-box">
            <div class="sed-stat-numero" id="sed-stat-pagina">1</div>
            <div class="sed-stat-label">Página</div>
          </div>
          <div class="sed-stat-box">
            <div class="sed-stat-numero" id="sed-stat-telefones">0</div>
            <div class="sed-stat-label">Telefones</div>
          </div>
        </div>
        <div class="sed-status" id="sed-status">Pronto. Clique em "Iniciar" na página com a lista de alunos.</div>
        <div class="sed-log" id="sed-log"></div>
        <div id="sed-btns-resultado" style="display:none;">
          <hr class="sed-separador">
          <button class="sed-btn sed-btn-baixar" id="sed-btn-csv">📥 Baixar CSV (Excel)</button>
          <button class="sed-btn sed-btn-baixar" id="sed-btn-json" style="background:linear-gradient(135deg,#6f42c1,#5a2d91);">📥 Baixar JSON</button>
          <button class="sed-btn sed-btn-limpar" id="sed-btn-limpar">🗑 Limpar dados</button>
        </div>
      </div>
    `;
    document.body.appendChild(painel);

    document.getElementById('sed-btn-iniciar').addEventListener('click', iniciarExtracao);
    document.getElementById('sed-btn-pausar').addEventListener('click', pausarRetomar);
    document.getElementById('sed-btn-parar').addEventListener('click', pararExtracao);
    document.getElementById('sed-btn-csv').addEventListener('click', baixarCSV);
    document.getElementById('sed-btn-json').addEventListener('click', baixarJSON);
    document.getElementById('sed-btn-limpar').addEventListener('click', limparDados);
    document.getElementById('sed-btn-min').addEventListener('click', () => painel.classList.toggle('minimizado'));
    document.getElementById('sed-btn-fechar').addEventListener('click', () => {
      if (estado.rodando && !confirm('A extração está em andamento. Fechar?')) return;
      estado.parar = true;
      painel.remove();
    });
    document.getElementById('sed-delay-acoes').addEventListener('change', (e) => {
      estado.delays.entreAcoes = parseInt(e.target.value) || 2000;
    });
    document.getElementById('sed-delay-modal').addEventListener('change', (e) => {
      estado.delays.carregamento = parseInt(e.target.value) || 3000;
    });

    tornarArrastavel(painel, document.getElementById('sed-drag-handle'));
    carregarDadosSalvos();
  }

  function tornarArrastavel(el, handle) {
    let ox, oy, drag = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      drag = true;
      ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      el.style.left = (e.clientX - ox) + 'px';
      el.style.top = (e.clientY - oy) + 'px';
      el.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => drag = false);
  }

  // ===================== LOG / STATUS =====================
  function log(msg, tipo = 'info') {
    const logEl = document.getElementById('sed-log');
    if (!logEl) return;
    const item = document.createElement('div');
    item.className = `sed-log-item sed-log-${tipo}`;
    item.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
    logEl.appendChild(item);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
  }

  function setStatus(msg, tipo = '') {
    const el = document.getElementById('sed-status');
    if (el) { el.className = 'sed-status' + (tipo ? ' sed-status-' + tipo : ''); el.textContent = msg; }
  }

  function atualizarProgresso() {
    const pct = estado.totalLinhas > 0 ? Math.round((estado.totalProcessados / estado.totalLinhas) * 100) : 0;
    const barraEl = document.getElementById('sed-progresso-barra');
    const pctEl = document.getElementById('sed-progresso-pct');
    const atualEl = document.getElementById('sed-progresso-atual');
    const tempoEl = document.getElementById('sed-progresso-tempo');
    if (barraEl) barraEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (atualEl) atualEl.textContent = `${estado.totalProcessados} / ${estado.totalLinhas}`;
    if (tempoEl && estado.inicio) {
      const seg = Math.floor((Date.now() - estado.inicio) / 1000);
      tempoEl.textContent = `${String(Math.floor(seg/60)).padStart(2,'0')}:${String(seg%60).padStart(2,'0')}`;
    }
    const el1 = document.getElementById('sed-stat-extraidos');
    const el2 = document.getElementById('sed-stat-erros');
    const el3 = document.getElementById('sed-stat-pagina');
    const el4 = document.getElementById('sed-stat-telefones');
    if (el1) el1.textContent = estado.alunos.length;
    if (el2) el2.textContent = estado.erros;
    if (el3) el3.textContent = estado.paginaAtual;
    if (el4) el4.textContent = estado.alunos.reduce((a, b) => a + (b.telefones ? b.telefones.length : 0), 0);
  }

  // ===================== UTILITÁRIOS =====================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function aguardarComPausa(ms) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (estado.parar) throw new Error('PARADO');
      while (estado.pausado) { await sleep(200); if (estado.parar) throw new Error('PARADO'); }
      await sleep(Math.min(100, fim - Date.now()));
    }
  }

  function salvarDados() {
    try {
      localStorage.setItem('sed_extrator_dados', JSON.stringify(estado.alunos));
      localStorage.setItem('sed_extrator_total', estado.totalProcessados.toString());
    } catch(e) {}
  }

  function carregarDadosSalvos() {
    try {
      const dados = localStorage.getItem('sed_extrator_dados');
      if (dados) {
        const parsed = JSON.parse(dados);
        if (parsed.length > 0) {
          estado.alunos = parsed;
          estado.totalProcessados = parseInt(localStorage.getItem('sed_extrator_total') || '0');
          log(`Dados anteriores: ${parsed.length} alunos`, 'info');
          setStatus(`${parsed.length} alunos já extraídos. Inicie para continuar ou limpe.`);
          document.getElementById('sed-btns-resultado').style.display = 'block';
          document.getElementById('sed-stats').style.display = 'grid';
          atualizarProgresso();
        }
      }
    } catch(e) {}
  }

  function limparDados() {
    if (!confirm('Apagar todos os dados extraídos?')) return;
    estado.alunos = []; estado.totalProcessados = 0; estado.erros = 0;
    localStorage.removeItem('sed_extrator_dados');
    localStorage.removeItem('sed_extrator_total');
    document.getElementById('sed-btns-resultado').style.display = 'none';
    document.getElementById('sed-log').innerHTML = '';
    setStatus('Dados limpos.');
    atualizarProgresso();
    log('Dados limpos', 'info');
  }

  // ===================== EXTRAÇÃO =====================
  function extrairDadosPessoais() {
    const dados = {};
    const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], .modal');
    if (!modal) return dados;

    const header = modal.querySelector('.modal-header, .panel-heading');
    if (header) {
      dados['cabecalho'] = header.textContent.trim();
      const raMatch = header.textContent.match(/RA[:\s]*(\d+[-/\d]*\w*)/i);
      if (raMatch) dados['ra_cabecalho'] = raMatch[1];
      const dataMatch = header.textContent.match(/Data\s*(?:de\s*)?Nascimento[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
      if (dataMatch) dados['data_nascimento_cabecalho'] = dataMatch[1];
    }

    const formGroups = modal.querySelectorAll('.form-group, .row > div[class*="col"], div[class*="col-"]');
    formGroups.forEach(group => {
      const label = group.querySelector('label, .control-label, strong');
      if (!label) return;
      const labelText = label.textContent.trim().replace(/:$/, '').trim();
      if (!labelText || labelText.length < 2 || labelText.length > 80) return;
      const input = group.querySelector('input, select, textarea');
      let value = '';
      if (input) {
        value = input.type === 'checkbox' ? (input.checked ? 'Sim' : 'Não') : input.value.trim();
      }
      if (!value) {
        const span = group.querySelector('span, p, .form-control-static');
        if (span && span !== label) value = span.textContent.trim();
      }
      if (value && value !== labelText) dados[labelText] = value;
    });

    const allInputs = modal.querySelectorAll('input[type="text"], input[type="email"], select');
    allInputs.forEach(input => {
      const val = input.value.trim();
      if (!val) return;
      let name = '';
      if (input.id) {
        const labelFor = modal.querySelector(`label[for="${input.id}"]`);
        if (labelFor) name = labelFor.textContent.trim().replace(/:$/, '');
      }
      if (!name) name = input.getAttribute('placeholder') || input.getAttribute('name') || input.id || '';
      if (name && val && !Object.values(dados).includes(val)) dados[name] = val;
    });
    return dados;
  }

  function extrairTelefones() {
    const telefones = [];
    const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], .modal');
    if (!modal) return telefones;
    const tabelas = modal.querySelectorAll('table');
    for (const tabela of tabelas) {
      let ehTel = false;
      tabela.querySelectorAll('th').forEach(th => {
        const t = th.textContent.trim().toLowerCase();
        if (t.includes('telefone') || t.includes('ddd') || t.includes('número')) ehTel = true;
      });
      if (ehTel) {
        tabela.querySelectorAll('tbody tr').forEach(linha => {
          const c = linha.querySelectorAll('td');
          if (c.length >= 3) telefones.push({
            tipo: c[0]?.textContent.trim() || '',
            ddd: c[1]?.textContent.trim() || '',
            numero: c[2]?.textContent.trim() || '',
            complemento: c[3]?.textContent.trim() || ''
          });
        });
        break;
      }
    }
    return telefones;
  }

  function fecharModal() {
    const seletores = [
      '.modal .close', '.modal [data-dismiss="modal"]', '.modal button.close',
      '.modal-header .close', '.modal .btn-default[data-dismiss="modal"]',
      'button.close[aria-label="Close"]'
    ];
    for (const sel of seletores) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) { btn.click(); return true; }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    return true;
  }

  async function clicarAba(textoAba) {
    const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], .modal');
    if (!modal) return false;
    const abas = modal.querySelectorAll('a, button, li a, .nav a, .nav-tabs a, .nav-pills a');
    for (const aba of abas) {
      if (aba.textContent.trim().toLowerCase().includes(textoAba.toLowerCase())) {
        aba.click();
        await aguardarComPausa(estado.delays.entreAcoes);
        return true;
      }
    }
    return false;
  }

  function obterLinhasTabela() {
    const tabelas = document.querySelectorAll('table');
    for (const tabela of tabelas) {
      const rows = tabela.querySelectorAll('tbody tr');
      if (rows.length > 0) {
        const temAcoes = rows[0].querySelector(
          'a i.fa-search, a i.fa-eye, a .glyphicon-search, a[title], button[title], a.btn i, td:last-child a'
        );
        if (temAcoes) return Array.from(rows);
      }
    }
    let maiorTabela = null, maxRows = 0;
    tabelas.forEach(t => { const r = t.querySelectorAll('tbody tr'); if (r.length > maxRows) { maxRows = r.length; maiorTabela = t; } });
    return maiorTabela ? Array.from(maiorTabela.querySelectorAll('tbody tr')) : null;
  }

  function encontrarLupa(row) {
    const seletores = [
      'a i.fa-search', 'a i.fa-eye', 'a .glyphicon-search', 'a .glyphicon-eye-open',
      'button i.fa-search', 'button i.fa-eye',
      'a[title*="isualizar"]', 'a[title*="etalhe"]', 'a[title*="onsultar"]'
    ];
    for (const sel of seletores) {
      const el = row.querySelector(sel);
      if (el) return el.closest('a') || el.closest('button') || el;
    }
    const links = row.querySelectorAll('td:last-child a, td a');
    return links.length > 0 ? links[0] : null;
  }

  function extrairNomeDaLinha(row) {
    const cells = row.querySelectorAll('td');
    return cells.length >= 2 ? cells[1].textContent.trim() : 'Desconhecido';
  }

  function extrairDadosDaLinha(row) {
    const cells = row.querySelectorAll('td');
    const d = {};
    if (cells.length >= 1) d['numero_linha'] = cells[0]?.textContent.trim();
    if (cells.length >= 2) d['nome'] = cells[1]?.textContent.trim();
    if (cells.length >= 3) d['ra_lista'] = cells[2]?.textContent.trim();
    if (cells.length >= 4) d['serie'] = cells[3]?.textContent.trim();
    if (cells.length >= 5) d['uf_lista'] = cells[4]?.textContent.trim();
    if (cells.length >= 6) d['data_nasc_lista'] = cells[5]?.textContent.trim();
    if (cells.length >= 7) d['responsavel_lista'] = cells[6]?.textContent.trim();
    return d;
  }

  function temProximaPagina() {
    for (const link of document.querySelectorAll('a, button')) {
      const t = link.textContent.trim().toLowerCase();
      if ((t === 'seguinte' || t === 'next' || t === 'próximo' || t === '›' || t === '»') &&
          !link.closest('li')?.classList.contains('disabled') &&
          !link.classList.contains('disabled') &&
          !link.parentElement?.classList.contains('disabled')) return link;
    }
    for (const btn of document.querySelectorAll('.pagination .next:not(.disabled) a, .dataTables_paginate .next:not(.disabled) a, .paginate_button.next:not(.disabled)'))
      return btn;
    return null;
  }

  // ===================== PROCESSO =====================
  async function iniciarExtracao() {
    if (estado.rodando) return;
    estado.rodando = true; estado.pausado = false; estado.parar = false;
    estado.inicio = Date.now();
    estado.delays.entreAcoes = parseInt(document.getElementById('sed-delay-acoes').value) || 2000;
    estado.delays.carregamento = parseInt(document.getElementById('sed-delay-modal').value) || 3000;
    estado.delays.fecharModal = Math.round(estado.delays.entreAcoes * 0.75);

    document.getElementById('sed-btn-iniciar').style.display = 'none';
    document.getElementById('sed-controles-exec').style.display = 'block';
    document.getElementById('sed-progresso').style.display = 'block';
    document.getElementById('sed-stats').style.display = 'grid';
    document.querySelector('.sed-config').style.display = 'none';

    log('Extração iniciada!', 'ok');
    setStatus('Processando...');
    const timer = setInterval(atualizarProgresso, 1000);

    try { await processarTodasPaginas(); } catch(e) {
      if (e.message !== 'PARADO') { log(`ERRO: ${e.message}`, 'erro'); setStatus(`Erro: ${e.message}`, 'erro'); }
    }

    clearInterval(timer);
    estado.rodando = false;
    document.getElementById('sed-btn-iniciar').style.display = 'block';
    document.getElementById('sed-btn-iniciar').textContent = '▶ REINICIAR EXTRAÇÃO';
    document.getElementById('sed-controles-exec').style.display = 'none';
    document.querySelector('.sed-config').style.display = 'block';

    if (estado.alunos.length > 0) {
      document.getElementById('sed-btns-resultado').style.display = 'block';
      salvarDados();
      setStatus(`Concluído! ${estado.alunos.length} alunos extraídos.`, 'ok');
      log(`FINALIZADO: ${estado.alunos.length} alunos`, 'ok');
    }
    atualizarProgresso();
  }

  async function processarTodasPaginas() {
    do {
      if (estado.parar) throw new Error('PARADO');
      log(`Página ${estado.paginaAtual}...`, 'info');
      const rows = obterLinhasTabela();
      if (!rows || rows.length === 0) { log('Nenhuma tabela encontrada!', 'erro'); break; }

      if (estado.paginaAtual === 1 && estado.totalLinhas === 0) {
        const m = document.body.innerText.match(/(?:de|of)\s+(\d+)\s+(?:registros|entries|itens)/i);
        estado.totalLinhas = m ? parseInt(m[1]) : rows.length;
      }
      log(`${rows.length} alunos nesta página`, 'info');

      for (let i = 0; i < rows.length; i++) {
        if (estado.parar) throw new Error('PARADO');
        while (estado.pausado) { setStatus('PAUSADO'); await sleep(300); if (estado.parar) throw new Error('PARADO'); }

        const row = rows[i];
        const nome = extrairNomeDaLinha(row);
        const dadosLinha = extrairDadosDaLinha(row);
        setStatus(`Processando: ${nome} (${estado.totalProcessados + 1}/${estado.totalLinhas})`);
        log(`${nome}`, 'info');

        try {
          const lupa = encontrarLupa(row);
          if (!lupa) { log(`Lupa não encontrada: ${nome}`, 'erro'); estado.erros++; continue; }
          lupa.click();
          await aguardarComPausa(estado.delays.carregamento);

          await clicarAba('dados pessoais');
          await aguardarComPausa(estado.delays.entreAcoes);
          const dadosPessoais = extrairDadosPessoais();

          let telefones = [];
          let achouAba = await clicarAba('telefone');
          if (achouAba) await aguardarComPausa(estado.delays.entreAcoes);
          if (!achouAba) { await clicarAba('contato'); await aguardarComPausa(estado.delays.entreAcoes); }
          telefones = extrairTelefones();

          estado.alunos.push({
            ...dadosLinha, ...dadosPessoais, telefones,
            telefones_formatados: telefones.map(t =>
              `${t.tipo}: (${t.ddd}) ${t.numero}${t.complemento ? ' - ' + t.complemento : ''}`
            ).join(' | ')
          });
          estado.totalProcessados++;
          log(`OK: ${nome} | ${Object.keys(dadosPessoais).length} dados | ${telefones.length} tel`, 'ok');

          fecharModal();
          await aguardarComPausa(estado.delays.fecharModal);
          let tent = 0;
          while (document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"]') && tent < 5) {
            fecharModal(); await sleep(500); tent++;
          }
          await sleep(300);

          if (estado.totalProcessados % 10 === 0) { salvarDados(); log(`Auto-save: ${estado.alunos.length}`, 'info'); }
        } catch (e) {
          if (e.message === 'PARADO') throw e;
          log(`ERRO em ${nome}: ${e.message}`, 'erro');
          estado.erros++;
          fecharModal(); await sleep(1000);
        }
        atualizarProgresso();
      }

      const btnProx = temProximaPagina();
      if (btnProx) { estado.paginaAtual++; log(`Página ${estado.paginaAtual}...`, 'info'); btnProx.click(); await aguardarComPausa(estado.delays.carregamento); }
      else { log('Todas as páginas processadas!', 'ok'); break; }
    } while (true);
  }

  function pausarRetomar() {
    estado.pausado = !estado.pausado;
    const btn = document.getElementById('sed-btn-pausar');
    if (estado.pausado) {
      btn.textContent = '▶ Continuar'; btn.className = 'sed-btn sed-btn-continuar';
      setStatus('PAUSADO'); log('Pausado', 'info');
    } else {
      btn.textContent = '⏸ Pausar'; btn.className = 'sed-btn sed-btn-pausar';
      setStatus('Retomando...'); log('Retomado', 'ok');
    }
  }

  function pararExtracao() {
    if (confirm('Parar? Os dados já extraídos serão mantidos.')) {
      estado.parar = true; estado.pausado = false; log('Parado', 'erro');
    }
  }

  // ===================== EXPORTAR =====================
  function baixarCSV() {
    if (estado.alunos.length === 0) { alert('Nenhum dado!'); return; }
    const chaves = new Set();
    estado.alunos.forEach(a => Object.keys(a).forEach(k => { if (k !== 'telefones') chaves.add(k); }));
    const cols = Array.from(chaves);
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return (s.includes(';') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    let csv = '\uFEFF' + cols.map(esc).join(';') + '\n';
    estado.alunos.forEach(a => { csv += cols.map(c => esc(a[c] || '')).join(';') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dados_alunos_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    log(`CSV baixado: ${estado.alunos.length} alunos`, 'ok');
    setStatus('CSV baixado!', 'ok');
  }

  function baixarJSON() {
    if (estado.alunos.length === 0) { alert('Nenhum dado!'); return; }
    const blob = new Blob([JSON.stringify(estado.alunos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dados_alunos_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    log(`JSON baixado`, 'ok');
  }

  // ===================== INICIAR =====================
  criarPainel();
  log('Extrator carregado!', 'ok');
})();
