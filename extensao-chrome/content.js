// =============================================================
// EXTENSÃO CHROME - EXTRATOR SED - DADOS DE ALUNOS
// Funciona com botão na tela, sem precisar do console
// Suporta pausa, retomada e salvamento automático
// =============================================================

(function() {
  'use strict';

  // Evitar duplicação
  if (document.getElementById('sed-extrator-painel')) return;

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
    delays: {
      entreAcoes: 2000,
      carregamento: 3000,
      fecharModal: 1500
    }
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

        <button class="sed-btn sed-btn-iniciar" id="sed-btn-iniciar">
          ▶ INICIAR EXTRAÇÃO
        </button>

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

        <div class="sed-status" id="sed-status">
          Pronto. Clique em "Iniciar" na página com a lista de alunos.
        </div>

        <div class="sed-log" id="sed-log"></div>

        <div id="sed-btns-resultado" style="display:none;">
          <hr class="sed-separador">
          <button class="sed-btn sed-btn-baixar" id="sed-btn-csv">
            📥 Baixar CSV (Excel)
          </button>
          <button class="sed-btn sed-btn-baixar" id="sed-btn-json" style="background:#6f42c1;">
            📥 Baixar JSON
          </button>
          <button class="sed-btn sed-btn-limpar" id="sed-btn-limpar">
            🗑 Limpar dados
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(painel);

    // Eventos
    document.getElementById('sed-btn-iniciar').addEventListener('click', iniciarExtracao);
    document.getElementById('sed-btn-pausar').addEventListener('click', pausarRetomar);
    document.getElementById('sed-btn-parar').addEventListener('click', pararExtracao);
    document.getElementById('sed-btn-csv').addEventListener('click', baixarCSV);
    document.getElementById('sed-btn-json').addEventListener('click', baixarJSON);
    document.getElementById('sed-btn-limpar').addEventListener('click', limparDados);
    document.getElementById('sed-btn-min').addEventListener('click', () => {
      painel.classList.toggle('minimizado');
    });
    document.getElementById('sed-btn-fechar').addEventListener('click', () => {
      if (estado.rodando) {
        if (!confirm('A extração está em andamento. Deseja realmente fechar?')) return;
        estado.parar = true;
      }
      painel.remove();
    });

    // Config delays
    document.getElementById('sed-delay-acoes').addEventListener('change', (e) => {
      estado.delays.entreAcoes = parseInt(e.target.value) || 2000;
    });
    document.getElementById('sed-delay-modal').addEventListener('change', (e) => {
      estado.delays.carregamento = parseInt(e.target.value) || 3000;
    });

    // Arrastar painel
    tornarArrastavel(painel, document.getElementById('sed-drag-handle'));

    // Carregar dados salvos
    carregarDadosSalvos();
  }

  // ===================== ARRASTAR =====================
  function tornarArrastavel(el, handle) {
    let offsetX, offsetY, arrastando = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      arrastando = true;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!arrastando) return;
      el.style.left = (e.clientX - offsetX) + 'px';
      el.style.top = (e.clientY - offsetY) + 'px';
      el.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => arrastando = false);
  }

  // ===================== LOG =====================
  function log(msg, tipo = 'info') {
    const logEl = document.getElementById('sed-log');
    if (!logEl) return;
    const item = document.createElement('div');
    item.className = `sed-log-item sed-log-${tipo}`;
    const hora = new Date().toLocaleTimeString('pt-BR');
    item.textContent = `[${hora}] ${msg}`;
    logEl.appendChild(item);
    logEl.scrollTop = logEl.scrollHeight;

    // Manter máximo 100 linhas
    while (logEl.children.length > 100) {
      logEl.removeChild(logEl.firstChild);
    }
  }

  function setStatus(msg, tipo = '') {
    const el = document.getElementById('sed-status');
    if (!el) return;
    el.className = 'sed-status' + (tipo ? ' sed-status-' + tipo : '');
    el.textContent = msg;
  }

  // ===================== PROGRESSO =====================
  function atualizarProgresso() {
    const pct = estado.totalLinhas > 0 ? Math.round((estado.totalProcessados / estado.totalLinhas) * 100) : 0;
    const barraEl = document.getElementById('sed-progresso-barra');
    const pctEl = document.getElementById('sed-progresso-pct');
    const atualEl = document.getElementById('sed-progresso-atual');
    const tempoEl = document.getElementById('sed-progresso-tempo');

    if (barraEl) barraEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (atualEl) atualEl.textContent = `${estado.totalProcessados} / ${estado.totalLinhas}`;

    // Tempo decorrido
    if (tempoEl && estado.inicio) {
      const seg = Math.floor((Date.now() - estado.inicio) / 1000);
      const min = Math.floor(seg / 60);
      const s = seg % 60;
      tempoEl.textContent = `${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    // Stats
    const el1 = document.getElementById('sed-stat-extraidos');
    const el2 = document.getElementById('sed-stat-erros');
    const el3 = document.getElementById('sed-stat-pagina');
    const el4 = document.getElementById('sed-stat-telefones');
    if (el1) el1.textContent = estado.alunos.length;
    if (el2) el2.textContent = estado.erros;
    if (el3) el3.textContent = estado.paginaAtual;
    if (el4) {
      const totalTel = estado.alunos.reduce((acc, a) => acc + (a.telefones ? a.telefones.length : 0), 0);
      el4.textContent = totalTel;
    }
  }

  // ===================== UTILITÁRIOS =====================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clica em um elemento de forma segura, evitando violações de CSP.
   * Se o elemento for um <a> com href="javascript:...", extrai o código
   * e o executa diretamente no contexto da página, em vez de navegar pela URL.
   */
  function clicarSeguro(el) {
    if (!el) return;
    const tagName = el.tagName ? el.tagName.toUpperCase() : '';
    const href = el.getAttribute ? el.getAttribute('href') : null;

    if (tagName === 'A' && href && href.trim().toLowerCase().startsWith('javascript:')) {
      // Extrair o código JS do href (remover "javascript:")
      const codigo = href.trim().substring('javascript:'.length);
      if (codigo && codigo !== 'void(0)' && codigo !== 'void(0);' && codigo !== ';') {
        try {
          // Disparar o evento click primeiro (para onclick handlers)
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          // Executar o código JS diretamente (funciona porque estamos no world MAIN)
          new Function(codigo)();
        } catch (e) {
          console.warn('[Extrator SED] Erro ao executar JS do href:', e);
          // Fallback: tentar click normal
          el.click();
        }
      } else {
        // href é javascript:void(0) - só disparar o evento click
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    } else {
      // Elemento normal - click padrão
      el.click();
    }
  }

  async function aguardarComPausa(ms) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (estado.parar) throw new Error('PARADO');
      while (estado.pausado) {
        await sleep(200);
        if (estado.parar) throw new Error('PARADO');
      }
      await sleep(Math.min(100, fim - Date.now()));
    }
  }

  // ===================== SALVAR/CARREGAR =====================
  function salvarDados() {
    try {
      localStorage.setItem('sed_extrator_dados', JSON.stringify(estado.alunos));
      localStorage.setItem('sed_extrator_total', estado.totalProcessados.toString());
    } catch(e) {
      // Storage cheio, ignorar
    }
  }

  function carregarDadosSalvos() {
    try {
      const dados = localStorage.getItem('sed_extrator_dados');
      if (dados) {
        const parsed = JSON.parse(dados);
        if (parsed.length > 0) {
          estado.alunos = parsed;
          estado.totalProcessados = parseInt(localStorage.getItem('sed_extrator_total') || '0');
          log(`Dados anteriores encontrados: ${parsed.length} alunos`, 'info');
          setStatus(`${parsed.length} alunos já extraídos anteriormente. Inicie para continuar ou limpe.`);
          document.getElementById('sed-btns-resultado').style.display = 'block';
          document.getElementById('sed-stats').style.display = 'grid';
          atualizarProgresso();
        }
      }
    } catch(e) { }
  }

  function limparDados() {
    if (!confirm('Tem certeza que deseja apagar todos os dados extraídos?')) return;
    estado.alunos = [];
    estado.totalProcessados = 0;
    estado.erros = 0;
    localStorage.removeItem('sed_extrator_dados');
    localStorage.removeItem('sed_extrator_total');
    document.getElementById('sed-btns-resultado').style.display = 'none';
    document.getElementById('sed-log').innerHTML = '';
    setStatus('Dados limpos. Pronto para nova extração.');
    atualizarProgresso();
    log('Dados limpos', 'info');
  }

  // ===================== EXTRAIR DADOS =====================
  function extrairDadosPessoais() {
    const dados = {};
    const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], .modal');
    if (!modal) return dados;

    // Cabeçalho do modal
    const header = modal.querySelector('.modal-header, .panel-heading');
    if (header) {
      const headerText = header.textContent.trim();
      dados['cabecalho'] = headerText;

      // Tentar extrair RA e data do cabeçalho
      const raMatch = headerText.match(/RA[:\s]*(\d+[-/\d]*\w*)/i);
      if (raMatch) dados['ra_cabecalho'] = raMatch[1];
      const dataMatch = headerText.match(/Data\s*(?:de\s*)?Nascimento[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
      if (dataMatch) dados['data_nascimento_cabecalho'] = dataMatch[1];
    }

    // Labels + valores dentro do modal
    const formGroups = modal.querySelectorAll('.form-group, .row > div[class*="col"], div[class*="col-"]');
    formGroups.forEach(group => {
      const label = group.querySelector('label, .control-label, strong');
      if (!label) return;
      const labelText = label.textContent.trim().replace(/:$/, '').trim();
      if (!labelText || labelText.length < 2 || labelText.length > 80) return;

      const input = group.querySelector('input, select, textarea');
      let value = '';
      if (input) {
        if (input.type === 'checkbox') {
          value = input.checked ? 'Sim' : 'Não';
        } else {
          value = input.value.trim();
        }
      }

      if (!value) {
        const span = group.querySelector('span, p, .form-control-static');
        if (span && span !== label) value = span.textContent.trim();
      }

      if (value && value !== labelText) {
        dados[labelText] = value;
      }
    });

    // Fallback: todos os inputs dentro do modal
    const allInputs = modal.querySelectorAll('input[type="text"], input[type="email"], select');
    allInputs.forEach(input => {
      const val = input.value.trim();
      if (!val) return;
      let name = '';

      // Tentar encontrar label associada
      if (input.id) {
        const labelFor = modal.querySelector(`label[for="${input.id}"]`);
        if (labelFor) name = labelFor.textContent.trim().replace(/:$/, '');
      }
      if (!name) {
        name = input.getAttribute('placeholder') || input.getAttribute('name') || input.id || '';
      }

      if (name && val && !Object.values(dados).includes(val)) {
        dados[name] = val;
      }
    });

    return dados;
  }

  function extrairTelefones() {
    const telefones = [];
    const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], .modal');
    if (!modal) return telefones;

    const tabelas = modal.querySelectorAll('table');
    for (const tabela of tabelas) {
      const headers = tabela.querySelectorAll('th');
      let ehTabelaTelefone = false;
      headers.forEach(th => {
        const t = th.textContent.trim().toLowerCase();
        if (t.includes('telefone') || t.includes('ddd') || t.includes('número')) {
          ehTabelaTelefone = true;
        }
      });

      if (ehTabelaTelefone) {
        const linhas = tabela.querySelectorAll('tbody tr');
        linhas.forEach(linha => {
          const celulas = linha.querySelectorAll('td');
          if (celulas.length >= 3) {
            telefones.push({
              tipo: celulas[0] ? celulas[0].textContent.trim() : '',
              ddd: celulas[1] ? celulas[1].textContent.trim() : '',
              numero: celulas[2] ? celulas[2].textContent.trim() : '',
              complemento: celulas[3] ? celulas[3].textContent.trim() : ''
            });
          }
        });
        break; // Apenas primeira tabela de telefones
      }
    }
    return telefones;
  }

  function fecharModal() {
    // Tentar vários seletores
    const seletores = [
      '.modal .close',
      '.modal [data-dismiss="modal"]',
      '.modal button.close',
      '.modal-header .close',
      '.modal-header button.close',
      '.modal .btn-default[data-dismiss="modal"]',
      'button.close[aria-label="Close"]'
    ];

    for (const sel of seletores) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        clicarSeguro(btn);
        return true;
      }
    }

    // Tentar ESC
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    return true;
  }

  async function clicarAba(textoAba) {
    const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], .modal');
    if (!modal) return false;

    const abas = modal.querySelectorAll('a, button, li a, .nav a, .nav-tabs a, .nav-pills a');
    for (const aba of abas) {
      const texto = aba.textContent.trim().toLowerCase();
      if (texto.includes(textoAba.toLowerCase())) {
        clicarSeguro(aba);
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
        const primeiraRow = rows[0];
        const temAcoes = primeiraRow.querySelector(
          'a i.fa-search, a i.fa-eye, a .glyphicon-search, ' +
          'a[title], button[title], a.btn i, td:last-child a'
        );
        if (temAcoes) {
          return Array.from(rows);
        }
      }
    }

    // Fallback: maior tabela
    let maiorTabela = null, maxRows = 0;
    tabelas.forEach(t => {
      const r = t.querySelectorAll('tbody tr');
      if (r.length > maxRows) { maxRows = r.length; maiorTabela = t; }
    });
    return maiorTabela ? Array.from(maiorTabela.querySelectorAll('tbody tr')) : null;
  }

  function encontrarLupa(row) {
    const seletores = [
      'a i.fa-search', 'a i.fa-eye', 'a .glyphicon-search',
      'a .glyphicon-eye-open', 'button i.fa-search', 'button i.fa-eye',
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
    const dados = {};
    if (cells.length >= 1) dados['numero_linha'] = cells[0]?.textContent.trim();
    if (cells.length >= 2) dados['nome'] = cells[1]?.textContent.trim();
    if (cells.length >= 3) dados['ra_lista'] = cells[2]?.textContent.trim();
    if (cells.length >= 4) dados['serie'] = cells[3]?.textContent.trim();
    if (cells.length >= 5) dados['uf_lista'] = cells[4]?.textContent.trim();
    if (cells.length >= 6) dados['data_nasc_lista'] = cells[5]?.textContent.trim();
    if (cells.length >= 7) dados['responsavel_lista'] = cells[6]?.textContent.trim();
    return dados;
  }

  function temProximaPagina() {
    const allLinks = document.querySelectorAll('a, button');
    for (const link of allLinks) {
      const text = link.textContent.trim().toLowerCase();
      if ((text === 'seguinte' || text === 'next' || text === 'próximo' || text === '›' || text === '»') &&
          !link.closest('li')?.classList.contains('disabled') &&
          !link.classList.contains('disabled') &&
          !link.parentElement?.classList.contains('disabled')) {
        return link;
      }
    }

    const nextBtns = document.querySelectorAll('.pagination .next:not(.disabled) a, .dataTables_paginate .next:not(.disabled) a, .paginate_button.next:not(.disabled)');
    for (const btn of nextBtns) return btn;

    return null;
  }

  // ===================== PROCESSO PRINCIPAL =====================
  async function iniciarExtracao() {
    if (estado.rodando) return;

    estado.rodando = true;
    estado.pausado = false;
    estado.parar = false;
    estado.inicio = Date.now();

    // Atualizar delays da config
    estado.delays.entreAcoes = parseInt(document.getElementById('sed-delay-acoes').value) || 2000;
    estado.delays.carregamento = parseInt(document.getElementById('sed-delay-modal').value) || 3000;
    estado.delays.fecharModal = Math.round(estado.delays.entreAcoes * 0.75);

    // UI
    document.getElementById('sed-btn-iniciar').style.display = 'none';
    document.getElementById('sed-controles-exec').style.display = 'block';
    document.getElementById('sed-progresso').style.display = 'block';
    document.getElementById('sed-stats').style.display = 'grid';
    document.querySelector('.sed-config').style.display = 'none';

    log('Extração iniciada!', 'ok');
    setStatus('Processando...');

    // Timer de progresso
    const timerProgresso = setInterval(atualizarProgresso, 1000);

    try {
      await processarTodasPaginas();
    } catch(e) {
      if (e.message !== 'PARADO') {
        log(`ERRO: ${e.message}`, 'erro');
        setStatus(`Erro: ${e.message}`, 'erro');
      }
    }

    clearInterval(timerProgresso);
    estado.rodando = false;

    // UI final
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
      if (!rows || rows.length === 0) {
        log('Nenhuma tabela encontrada!', 'erro');
        setStatus('Nenhuma tabela de alunos encontrada na página!', 'erro');
        break;
      }

      // Estimar total (se primeira página)
      if (estado.paginaAtual === 1 && estado.totalLinhas === 0) {
        // Tentar ler total do texto "Registros X a Y de Z"
        const textoInfo = document.body.innerText.match(/(?:de|of)\s+(\d+)\s+(?:registros|entries|itens)/i);
        if (textoInfo) {
          estado.totalLinhas = parseInt(textoInfo[1]);
        } else {
          estado.totalLinhas = rows.length; // Será atualizado conforme avança
        }
      }

      log(`${rows.length} alunos nesta página`, 'info');

      for (let i = 0; i < rows.length; i++) {
        if (estado.parar) throw new Error('PARADO');
        while (estado.pausado) {
          setStatus('PAUSADO - Clique em Continuar');
          await sleep(300);
          if (estado.parar) throw new Error('PARADO');
        }

        const row = rows[i];
        const nome = extrairNomeDaLinha(row);
        const dadosLinha = extrairDadosDaLinha(row);

        setStatus(`Processando: ${nome} (${estado.totalProcessados + 1}/${estado.totalLinhas})`);
        log(`${nome}`, 'info');

        try {
          // 1. Clicar na lupa
          const lupa = encontrarLupa(row);
          if (!lupa) {
            log(`Lupa não encontrada: ${nome}`, 'erro');
            estado.erros++;
            continue;
          }

          clicarSeguro(lupa);
          await aguardarComPausa(estado.delays.carregamento);

          // 2. Aba Dados Pessoais
          await clicarAba('dados pessoais');
          await aguardarComPausa(estado.delays.entreAcoes);

          // 3. Extrair dados pessoais
          const dadosPessoais = extrairDadosPessoais();

          // 4. Aba Telefones
          let telefones = [];
          const achouAba = await clicarAba('telefone');
          if (achouAba) {
            await aguardarComPausa(estado.delays.entreAcoes);
          }
          // Tenta também clicar apenas no ícone/texto que parece ser telefone
          if (!achouAba) {
            await clicarAba('contato');
            await aguardarComPausa(estado.delays.entreAcoes);
          }
          telefones = extrairTelefones();

          // 5. Montar aluno
          const aluno = {
            ...dadosLinha,
            ...dadosPessoais,
            telefones: telefones,
            telefones_formatados: telefones.map(t =>
              `${t.tipo}: (${t.ddd}) ${t.numero}${t.complemento ? ' - ' + t.complemento : ''}`
            ).join(' | ')
          };

          estado.alunos.push(aluno);
          estado.totalProcessados++;

          log(`OK: ${nome} | ${Object.keys(dadosPessoais).length} dados | ${telefones.length} tel`, 'ok');

          // 6. Fechar modal
          fecharModal();
          await aguardarComPausa(estado.delays.fecharModal);

          // Garantir que fechou
          let tentativas = 0;
          while (document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"]') && tentativas < 5) {
            fecharModal();
            await sleep(500);
            tentativas++;
          }
          await sleep(300);

          // Salvar a cada 10 alunos
          if (estado.totalProcessados % 10 === 0) {
            salvarDados();
            log(`Salvamento automático: ${estado.alunos.length} alunos`, 'info');
          }

        } catch (e) {
          if (e.message === 'PARADO') throw e;
          log(`ERRO em ${nome}: ${e.message}`, 'erro');
          estado.erros++;
          // Tentar fechar modal em caso de erro
          fecharModal();
          await sleep(1000);
        }

        atualizarProgresso();
      }

      // Próxima página
      const btnProximo = temProximaPagina();
      if (btnProximo) {
        estado.paginaAtual++;
        log(`Indo para página ${estado.paginaAtual}...`, 'info');
        clicarSeguro(btnProximo);
        await aguardarComPausa(estado.delays.carregamento);
      } else {
        log('Todas as páginas processadas!', 'ok');
        break;
      }

    } while (true);
  }

  function pausarRetomar() {
    estado.pausado = !estado.pausado;
    const btn = document.getElementById('sed-btn-pausar');
    if (estado.pausado) {
      btn.textContent = '▶ Continuar';
      btn.className = 'sed-btn sed-btn-continuar';
      setStatus('PAUSADO');
      log('Pausado pelo usuário', 'info');
    } else {
      btn.textContent = '⏸ Pausar';
      btn.className = 'sed-btn sed-btn-pausar';
      setStatus('Retomando...');
      log('Retomado', 'ok');
    }
  }

  function pararExtracao() {
    if (confirm('Deseja parar a extração? Os dados já extraídos serão mantidos.')) {
      estado.parar = true;
      estado.pausado = false;
      log('Parado pelo usuário', 'erro');
    }
  }

  // ===================== EXPORTAR =====================
  function baixarCSV() {
    if (estado.alunos.length === 0) {
      alert('Nenhum dado para exportar!');
      return;
    }

    // Coletar todas as chaves únicas
    const chaves = new Set();
    estado.alunos.forEach(a => {
      Object.keys(a).forEach(k => {
        if (k !== 'telefones') chaves.add(k);
      });
    });
    const colunas = Array.from(chaves);

    const escapar = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes(',')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    let csv = '\uFEFF'; // BOM UTF-8
    csv += colunas.map(escapar).join(';') + '\n';
    estado.alunos.forEach(aluno => {
      csv += colunas.map(col => escapar(aluno[col] || '')).join(';') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dados_alunos_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    log(`CSV baixado: ${estado.alunos.length} alunos`, 'ok');
    setStatus('CSV baixado com sucesso!', 'ok');
  }

  function baixarJSON() {
    if (estado.alunos.length === 0) {
      alert('Nenhum dado para exportar!');
      return;
    }

    const blob = new Blob([JSON.stringify(estado.alunos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dados_alunos_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    log(`JSON baixado: ${estado.alunos.length} alunos`, 'ok');
  }

  // ===================== INICIAR =====================
  criarPainel();
  log('Extensão carregada com sucesso!', 'ok');

})();
