// =============================================================
// SCRIPT DE EXTRAÇÃO DE DADOS DE ALUNOS
// Cole este script no Console do Chrome (F12 > Console)
// =============================================================

(async function extrairDadosAlunos() {
  'use strict';

  // ---- CONFIGURAÇÕES ----
  const DELAY_ENTRE_ACOES = 1500;   // ms entre cada ação (ajuste se a internet for lenta)
  const DELAY_CARREGAMENTO = 2500;  // ms para aguardar carregamento do modal
  const DELAY_FECHAR_MODAL = 1000;  // ms após fechar o modal

  // ---- UTILITÁRIOS ----
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Elemento "${selector}" não encontrado em ${timeout}ms`));
      }, timeout);
    });
  }

  function waitForElementWithText(tag, text, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const find = () => {
        const elements = document.querySelectorAll(tag);
        for (const el of elements) {
          if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
            return el;
          }
        }
        return null;
      };
      const el = find();
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = find();
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Elemento <${tag}> com texto "${text}" não encontrado em ${timeout}ms`));
      }, timeout);
    });
  }

  // ---- ARMAZENAMENTO DE DADOS ----
  const todosAlunos = [];

  // ---- EXTRAIR DADOS PESSOAIS DO MODAL ----
  function extrairDadosPessoais() {
    const dados = {};

    // Extrair do cabeçalho do modal (nome, RA, data nascimento)
    const headerModal = document.querySelector('.modal-header, [class*="modal"] h4, [class*="modal"] .panel-heading, [class*="dialog"] h4');
    if (headerModal) {
      dados['Cabeçalho'] = headerModal.textContent.trim();
    }

    // Tentar extrair de labels + inputs/spans (formulário)
    const labels = document.querySelectorAll('label, .control-label, dt, th');
    labels.forEach(label => {
      const labelText = label.textContent.trim().replace(/:$/, '');
      if (!labelText) return;

      // Procurar o valor associado
      let value = '';

      // Método 1: input/select/textarea associado via "for"
      const forId = label.getAttribute('for');
      if (forId) {
        const input = document.getElementById(forId);
        if (input) value = input.value || input.textContent.trim();
      }

      // Método 2: input dentro do mesmo container pai
      if (!value) {
        const parent = label.closest('.form-group, .row, tr, dd, .col-md-12, .col-sm-12, .col-lg-12, div');
        if (parent) {
          const input = parent.querySelector('input, select, textarea, span.form-control-static, p, .value');
          if (input && input !== label) {
            value = input.value || input.textContent.trim();
          }
        }
      }

      // Método 3: próximo sibling
      if (!value) {
        let next = label.nextElementSibling;
        if (next) {
          const input = next.querySelector('input, select, textarea') || next;
          value = input.value || input.textContent.trim();
        }
      }

      if (value && labelText.length > 1 && labelText.length < 100) {
        dados[labelText] = value;
      }
    });

    // Extrair campos input com placeholder ou name
    const inputs = document.querySelectorAll('.modal input, .modal select, .modal textarea, [class*="dialog"] input');
    inputs.forEach(input => {
      const name = input.getAttribute('name') || input.getAttribute('placeholder') || input.id || '';
      const value = input.value;
      if (name && value && !Object.values(dados).includes(value)) {
        dados[name] = value;
      }
    });

    return dados;
  }

  // ---- EXTRAIR TELEFONES ----
  function extrairTelefones() {
    const telefones = [];

    // Procurar tabela de telefones
    const tabelas = document.querySelectorAll('table');
    for (const tabela of tabelas) {
      const headers = tabela.querySelectorAll('th');
      let isPhoneTable = false;
      const headerTexts = [];

      headers.forEach(th => {
        const text = th.textContent.trim();
        headerTexts.push(text);
        if (text.toLowerCase().includes('telefone') ||
            text.toLowerCase().includes('ddd') ||
            text.toLowerCase().includes('número')) {
          isPhoneTable = true;
        }
      });

      if (isPhoneTable) {
        const rows = tabela.querySelectorAll('tbody tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            const tel = {
              'Tipo Telefone': cells[0] ? cells[0].textContent.trim() : '',
              'DDD': cells[1] ? cells[1].textContent.trim() : '',
              'Número': cells[2] ? cells[2].textContent.trim() : '',
              'Complemento': cells[3] ? cells[3].textContent.trim() : ''
            };
            telefones.push(tel);
          }
        });
      }
    }

    return telefones;
  }

  // ---- FECHAR MODAL ----
  function fecharModal() {
    // Tentar vários seletores para fechar
    const closeBtn = document.querySelector('.modal .close, .modal [data-dismiss="modal"], .modal button.close, [class*="dialog"] .close, .modal-header .close, .modal-header button');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }

    // Tentar tecla ESC
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
    return true;
  }

  // ---- CLICAR NA ABA DADOS PESSOAIS ----
  async function clicarAbaDadosPessoais() {
    try {
      const tabs = document.querySelectorAll('.modal a, .modal button, .modal li a, .nav-tabs a, .nav-pills a');
      for (const tab of tabs) {
        if (tab.textContent.trim().toLowerCase().includes('dados pessoais')) {
          tab.click();
          await sleep(DELAY_ENTRE_ACOES);
          return true;
        }
      }
    } catch (e) {
      console.warn('Aba Dados Pessoais não encontrada:', e);
    }
    return false;
  }

  // ---- CLICAR NA ABA TELEFONES OU VERIFICAR SE JÁ TEM TELEFONES ----
  async function navegarParaTelefones() {
    // Primeiro verificar se os telefones já estão visíveis
    const telefonesVisiveis = extrairTelefones();
    if (telefonesVisiveis.length > 0) {
      return telefonesVisiveis;
    }

    // Tentar clicar na aba de telefones
    const tabs = document.querySelectorAll('.modal a, .modal button, .modal li a, .nav-tabs a, .nav-pills a');
    for (const tab of tabs) {
      const texto = tab.textContent.trim().toLowerCase();
      if (texto.includes('telefone') || texto.includes('contato')) {
        tab.click();
        await sleep(DELAY_ENTRE_ACOES);
        return extrairTelefones();
      }
    }

    return [];
  }

  // ---- OBTER LINHAS DA TABELA PRINCIPAL ----
  function obterLinhasTabela() {
    const tabelas = document.querySelectorAll('table');
    for (const tabela of tabelas) {
      const rows = tabela.querySelectorAll('tbody tr');
      if (rows.length > 0) {
        // Verificar se tem o ícone de lupa (visualizar)
        const primeiraRow = rows[0];
        const lupas = primeiraRow.querySelectorAll('a i.fa-search, a .glyphicon-search, button i.fa-search, a[title*="isualizar"], a[title*="etalhe"], a i.fa-eye, a.btn i');
        if (lupas.length > 0 || primeiraRow.querySelector('a[title], button[title]')) {
          return { tabela, rows: Array.from(rows) };
        }
      }
    }

    // Fallback: pegar a maior tabela
    let maiorTabela = null;
    let maxRows = 0;
    tabelas.forEach(t => {
      const r = t.querySelectorAll('tbody tr');
      if (r.length > maxRows) {
        maxRows = r.length;
        maiorTabela = t;
      }
    });

    if (maiorTabela) {
      return { tabela: maiorTabela, rows: Array.from(maiorTabela.querySelectorAll('tbody tr')) };
    }

    return null;
  }

  // ---- ENCONTRAR BOTÃO DA LUPA ----
  function encontrarLupa(row) {
    // Tentar vários seletores para o ícone de lupa/visualizar
    const seletores = [
      'a i.fa-search',
      'a i.fa-eye',
      'a .glyphicon-search',
      'a .glyphicon-eye-open',
      'button i.fa-search',
      'button i.fa-eye',
      'a[title*="isualizar"]',
      'a[title*="etalhe"]',
      'a[title*="onsultar"]',
      'a[title*="er"]',
    ];

    for (const sel of seletores) {
      const el = row.querySelector(sel);
      if (el) {
        // Retornar o link/botão pai
        return el.closest('a') || el.closest('button') || el;
      }
    }

    // Fallback: primeiro link/botão com ícone
    const links = row.querySelectorAll('td:last-child a, td a, td button');
    if (links.length > 0) {
      return links[0]; // Primeiro botão de ação (geralmente é a lupa)
    }

    return null;
  }

  // ---- EXTRAIR NOME DA LINHA ----
  function extrairNomeDaLinha(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      return cells[1].textContent.trim(); // Geralmente o nome está na segunda coluna
    }
    return 'Desconhecido';
  }

  // ---- VERIFICAR PAGINAÇÃO ----
  function temProximaPagina() {
    const nextBtns = document.querySelectorAll('.pagination .next a, .dataTables_paginate .next a, a:contains("Seguinte"), .paginate_button.next:not(.disabled)');
    for (const btn of nextBtns) {
      if (!btn.closest('li')?.classList.contains('disabled') && !btn.classList.contains('disabled')) {
        return btn;
      }
    }

    // Tentar encontrar botão "Seguinte" ou "Next"
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

    return null;
  }

  // ---- PROCESSO PRINCIPAL ----
  console.log('%c========================================', 'color: blue; font-weight: bold');
  console.log('%c EXTRAÇÃO DE DADOS DE ALUNOS INICIADA', 'color: blue; font-weight: bold; font-size: 14px');
  console.log('%c========================================', 'color: blue; font-weight: bold');

  let paginaAtual = 1;
  let totalProcessados = 0;

  do {
    console.log(`%c📄 Processando página ${paginaAtual}...`, 'color: green; font-weight: bold');

    const resultado = obterLinhasTabela();
    if (!resultado) {
      console.error('❌ Nenhuma tabela de alunos encontrada na página!');
      break;
    }

    const { rows } = resultado;
    console.log(`   Encontradas ${rows.length} linhas nesta página.`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nomeAluno = extrairNomeDaLinha(row);
      console.log(`%c👤 [${totalProcessados + 1}] Processando: ${nomeAluno}`, 'color: #333; font-weight: bold');

      // 1. Clicar na lupa
      const lupa = encontrarLupa(row);
      if (!lupa) {
        console.warn(`   ⚠️ Lupa não encontrada para: ${nomeAluno}`);
        continue;
      }

      lupa.click();
      await sleep(DELAY_CARREGAMENTO);

      // 2. Clicar na aba "Dados Pessoais" (caso não esteja selecionada)
      await clicarAbaDadosPessoais();
      await sleep(DELAY_ENTRE_ACOES);

      // 3. Extrair dados pessoais
      const dadosPessoais = extrairDadosPessoais();
      console.log(`   ✅ Dados pessoais extraídos:`, Object.keys(dadosPessoais).length, 'campos');

      // 4. Navegar para telefones e extrair
      const telefones = await navegarParaTelefones();
      console.log(`   📞 Telefones extraídos:`, telefones.length);

      // 5. Montar registro do aluno
      const aluno = {
        '#': totalProcessados + 1,
        'Nome': nomeAluno,
        ...dadosPessoais,
        'Telefones': telefones,
        'Telefones_Formatados': telefones.map(t =>
          `${t['Tipo Telefone']}: (${t['DDD']}) ${t['Número']}${t['Complemento'] ? ' - ' + t['Complemento'] : ''}`
        ).join(' | ')
      };

      todosAlunos.push(aluno);
      totalProcessados++;

      // 6. Fechar o modal
      fecharModal();
      await sleep(DELAY_FECHAR_MODAL);

      // Verificar se o modal fechou
      let tentativas = 0;
      while (document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"]') && tentativas < 5) {
        fecharModal();
        await sleep(500);
        tentativas++;
      }

      await sleep(500);
    }

    // Verificar próxima página
    const btnProximo = temProximaPagina();
    if (btnProximo) {
      console.log(`%c📄 Indo para página ${paginaAtual + 1}...`, 'color: green');
      btnProximo.click();
      await sleep(DELAY_CARREGAMENTO);
      paginaAtual++;
    } else {
      console.log('%c✅ Todas as páginas foram processadas!', 'color: green; font-weight: bold');
      break;
    }

  } while (true);

  // ---- GERAR RESULTADO ----
  console.log('%c========================================', 'color: blue; font-weight: bold');
  console.log(`%c EXTRAÇÃO CONCLUÍDA! Total: ${todosAlunos.length} alunos`, 'color: blue; font-weight: bold; font-size: 14px');
  console.log('%c========================================', 'color: blue; font-weight: bold');

  // Coletar todas as chaves únicas (exceto Telefones objeto)
  const todasChaves = new Set();
  todosAlunos.forEach(aluno => {
    Object.keys(aluno).forEach(key => {
      if (key !== 'Telefones') todasChaves.add(key);
    });
  });
  const chavesOrdenadas = Array.from(todasChaves);

  // ---- GERAR CSV ----
  function gerarCSV(dados, colunas) {
    const escapar = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    let csv = '\uFEFF'; // BOM para UTF-8
    csv += colunas.map(escapar).join(';') + '\n';

    dados.forEach(row => {
      csv += colunas.map(col => escapar(row[col] || '')).join(';') + '\n';
    });

    return csv;
  }

  const csv = gerarCSV(todosAlunos, chavesOrdenadas);

  // ---- DOWNLOAD DO CSV ----
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `dados_alunos_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  console.log('%c📥 Arquivo CSV baixado automaticamente!', 'color: green; font-weight: bold');

  // ---- EXIBIR TABELA NO CONSOLE ----
  console.log('%c📊 Dados extraídos:', 'color: blue; font-weight: bold; font-size: 12px');
  console.table(todosAlunos.map(a => {
    const resumo = {
      '#': a['#'],
      'Nome': a['Nome'],
      'Filiação 1': a['Filiação 1'] || a['Filiacao 1'] || '',
      'Filiação 2': a['Filiação 2'] || a['Filiacao 2'] || '',
      'RA': a['RA'] || '',
      'Nacionalidade': a['Nacionalidade'] || '',
      'Município': a['Município de Nascimento'] || a['Municipio de Nascimento'] || '',
      'E-Mail': a['E-Mail'] || a['Email'] || '',
      'E-Mail Google': a['E-Mail Google'] || '',
      'Telefones': a['Telefones_Formatados'] || ''
    };
    return resumo;
  }));

  // ---- GERAR TABELA HTML (exibir na página) ----
  function gerarTabelaHTML() {
    const container = document.createElement('div');
    container.id = 'resultado-extracao';
    container.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: white; z-index: 999999; overflow: auto; padding: 20px;
      font-family: Arial, sans-serif;
    `;

    let html = `
      <div style="max-width: 100%; margin: 0 auto;">
        <h2 style="color: #333;">📋 Dados Extraídos - ${todosAlunos.length} Alunos</h2>
        <p>
          <button onclick="document.getElementById('resultado-extracao').remove()" 
                  style="padding: 8px 16px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
            ✕ Fechar
          </button>
          <button onclick="
            var csv = document.getElementById('csv-data').value;
            var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = 'dados_alunos.csv';
            a.click(); URL.revokeObjectURL(url);
          " style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
            📥 Baixar CSV Novamente
          </button>
        </p>
        <textarea id="csv-data" style="display:none">${csv.replace(/</g, '&lt;')}</textarea>
        <div style="overflow-x: auto;">
          <table style="border-collapse: collapse; width: 100%; font-size: 12px;">
            <thead>
              <tr style="background: #007bff; color: white;">
    `;

    chavesOrdenadas.forEach(key => {
      html += `<th style="padding: 8px; border: 1px solid #ddd; white-space: nowrap;">${key}</th>`;
    });
    html += '</tr></thead><tbody>';

    todosAlunos.forEach((aluno, idx) => {
      const bg = idx % 2 === 0 ? '#f8f9fa' : '#ffffff';
      html += `<tr style="background: ${bg};">`;
      chavesOrdenadas.forEach(key => {
        const val = aluno[key] || '';
        html += `<td style="padding: 6px 8px; border: 1px solid #ddd; white-space: nowrap;">${String(val).replace(/</g, '&lt;')}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div></div>';
    container.innerHTML = html;
    document.body.appendChild(container);
  }

  gerarTabelaHTML();

  // Salvar no window para acesso posterior
  window.__dadosAlunos = todosAlunos;
  console.log('%c💾 Dados salvos em window.__dadosAlunos', 'color: purple');
  console.log('%cPara acessar: window.__dadosAlunos', 'color: gray');

  return todosAlunos;
})();
