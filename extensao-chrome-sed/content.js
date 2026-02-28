// ========================
// CONTENT.JS - Extrator SED (Ficha do Aluno) v4
// ========================
// Abordagem SIMPLIFICADA: sem detecção de modal.
// Detecta MUDANÇA DE CONTEÚDO na página após clicar na lupa.
// Funciona independente de modal, iframe, navegação AJAX ou troca de view.
//
// Fluxo:
//   1. Guardar estado da página (tabela de alunos)
//   2. Clicar na lupa (Visualizar)
//   3. Esperar a página MUDAR (texto "Dados do Aluno" ou "Dados Pessoais" surgir)
//   4. Extrair TUDO que estiver visível na tela
//   5. Clicar aba Telefones → extrair
//   6. Clicar "Voltar" → esperar tabela de alunos reaparecer
//   7. Próximo aluno / próxima página

(function () {
  'use strict';

  let running = false;
  let shouldStop = false;

  // ========================
  // UTILIDADES
  // ========================

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function sendLog(texto, nivel = 'info') {
    console.log(`[SED][${nivel}] ${texto}`);
    try { chrome.runtime.sendMessage({ type: 'LOG', texto, nivel }); } catch (e) {}
  }

  function sendProgress(current, total, nome) {
    try { chrome.runtime.sendMessage({ type: 'PROGRESSO', current, total, nome }); } catch (e) {}
  }

  function sendError(erro) {
    try { chrome.runtime.sendMessage({ type: 'ERRO_ALUNO', erro }); } catch (e) {}
  }

  function sendComplete(total) {
    try { chrome.runtime.sendMessage({ type: 'CONCLUIDO', total }); } catch (e) {}
  }

  // ========================
  // DETECTAR ESTADO DA PÁGINA
  // ========================

  // Verifica se a FICHA DO ALUNO está visível na página
  // (procura texto característico OU abas características)
  function fichaEstaAberta() {
    const bodyText = document.body.innerText || '';
    // Textos que só aparecem na ficha do aluno
    if (bodyText.includes('Dados do Aluno:') || bodyText.includes('Dados do Aluno :')) return true;

    // Procurar abas características da ficha
    const abas = document.querySelectorAll('a, li, [role="tab"], button');
    let countAbas = 0;
    const abasEsperadas = ['Dados Pessoais', 'Documentos', 'Deficiência', 'Endereço Residencial', 'Telefones'];
    for (const el of abas) {
      const txt = el.textContent.trim();
      if (abasEsperadas.some(a => txt === a)) countAbas++;
    }
    // Se encontrou pelo menos 3 das abas esperadas, a ficha está aberta
    if (countAbas >= 3) return true;

    return false;
  }

  // Verifica se a TABELA DE ALUNOS (lista principal) está visível
  function tabelaEstaVisivel() {
    const tabelas = document.querySelectorAll('table');
    for (const t of tabelas) {
      const headers = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
      const temNome = headers.some(h => h.includes('nome do aluno') || h.includes('nome'));
      const temRA = headers.some(h => h === 'ra' || h.includes('ra'));
      if (temNome && temRA) return true;
    }
    return false;
  }

  // Esperar até que a ficha do aluno apareça na página
  function esperarFichaAbrir(timeout = 20000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (fichaEstaAberta()) {
          sendLog('  ✓ Ficha do aluno detectada na página!');
          return resolve(true);
        }
        if (Date.now() - start > timeout) {
          sendLog('  ⚠ Timeout esperando ficha abrir. Tentando extrair mesmo assim...', 'warn');
          return resolve(false);
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  // Esperar até que a tabela de alunos reapareça (após fechar ficha)
  function esperarTabelaVoltar(timeout = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (tabelaEstaVisivel() && !fichaEstaAberta()) {
          sendLog('  ✓ Tabela de alunos reapareceu!');
          return resolve(true);
        }
        if (Date.now() - start > timeout) {
          sendLog('  ⚠ Timeout esperando tabela voltar', 'warn');
          return resolve(false);
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  // ========================
  // LER CAMPOS DA PÁGINA (usa document inteiro)
  // ========================

  function lerCampoPorLabel(labelText) {
    const labels = document.querySelectorAll('label, strong, th, dt, .control-label, .field-label');
    for (const lbl of labels) {
      const text = lbl.textContent.trim().replace(/:$/, '').replace(/\?$/, '').trim();
      if (!text.toLowerCase().includes(labelText.toLowerCase())) continue;

      // Tentar input dentro do form-group pai
      const group = lbl.closest('.form-group, .control-group, tr, .row, dd, div') || lbl.parentElement;
      if (group) {
        const inputs = group.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea');
        for (const el of inputs) {
          if (el.tagName === 'SELECT') {
            const opt = el.options[el.selectedIndex];
            const val = opt ? opt.textContent.trim() : '';
            if (val) return val;
          }
          if (el.value) return el.value;
        }
        // Tentar span com valor
        const spans = group.querySelectorAll('span, p, div');
        for (const s of spans) {
          if (s === lbl || s.contains(lbl) || lbl.contains(s)) continue;
          if (s.querySelectorAll('label, strong, input, select').length > 0) continue;
          if (s.children.length === 0 && s.textContent.trim()) return s.textContent.trim();
        }
      }

      // Próximo elemento irmão
      let next = lbl.nextElementSibling;
      if (next) {
        const input = next.matches?.('input, select, textarea') ? next : next.querySelector?.('input, select, textarea');
        if (input) {
          if (input.tagName === 'SELECT') {
            const opt = input.options[input.selectedIndex];
            return opt ? opt.textContent.trim() : '';
          }
          return input.value || '';
        }
        if (next.textContent) {
          const val = next.textContent.trim();
          if (val && val !== text && val.length < 200) return val;
        }
      }
    }
    return '';
  }

  function lerCheckboxPorLabel(labelText) {
    const labels = document.querySelectorAll('label, strong');
    for (const lbl of labels) {
      const text = lbl.textContent.trim().replace(/:$/, '').replace(/\?$/, '').trim();
      if (!text.toLowerCase().includes(labelText.toLowerCase())) continue;

      const group = lbl.closest('.form-group, .control-group, tr, div, .checkbox') || lbl.parentElement;
      if (group) {
        const cb = group.querySelector('input[type="checkbox"]');
        if (cb) return cb.checked;
      }
      let next = lbl.nextElementSibling;
      while (next) {
        const cb = next.matches?.('input[type="checkbox"]') ? next : next.querySelector?.('input[type="checkbox"]');
        if (cb) return cb.checked;
        next = next.nextElementSibling;
      }
    }
    return false;
  }

  function lerRadioPorLabel(labelText) {
    const labels = document.querySelectorAll('label, strong');
    for (const lbl of labels) {
      const text = lbl.textContent.trim().replace(/:$/, '').replace(/\?$/, '').trim();
      if (!text.toLowerCase().includes(labelText.toLowerCase())) continue;

      const group = lbl.closest('.form-group, .control-group, tr, div') || lbl.parentElement;
      if (group) {
        const radios = group.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          if (radio.checked) {
            const radioLabel = group.querySelector(`label[for="${radio.id}"]`);
            if (radioLabel) return radioLabel.textContent.trim();
            return radio.parentElement?.textContent?.trim() || 'Sim';
          }
        }
      }
    }
    return '';
  }

  // ========================
  // CLICAR EM UMA ABA
  // ========================

  async function clicarAba(nomeAba) {
    const tabs = document.querySelectorAll(
      '.nav-tabs a, .nav-pills a, .nav a, [role="tab"], ' +
      'a[data-toggle="tab"], a[data-bs-toggle="tab"], ' +
      'a[href*="#"], li a, button[data-toggle], .tab-link, .tab'
    );
    for (const tab of tabs) {
      const text = tab.textContent.trim();
      if (text === nomeAba || text.toLowerCase() === nomeAba.toLowerCase()) {
        sendLog(`  Clicando na aba "${nomeAba}"...`);
        tab.click();
        await sleep(2000); // Esperar conteúdo da aba carregar
        return true;
      }
    }
    sendLog(`  Aba "${nomeAba}" não encontrada`, 'warn');
    return false;
  }

  // ========================
  // COLETAR DADOS DA TABELA PRINCIPAL
  // ========================

  function coletarDadosTabela() {
    const tabelas = document.querySelectorAll('table');
    let tabelaAlunos = null;

    // Encontrar a tabela que tem coluna "Nome do Aluno" ou "RA"
    for (const t of tabelas) {
      const headers = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      if (headers.some(h => h.includes('Nome do Aluno') || h.includes('Nome')) &&
          headers.some(h => h === 'RA' || h.includes('RA'))) {
        tabelaAlunos = t;
        break;
      }
    }

    if (!tabelaAlunos) {
      sendLog('Tabela de alunos não encontrada!', 'error');
      return [];
    }

    const rows = tabelaAlunos.querySelectorAll('tbody tr');
    const alunos = [];

    rows.forEach((tr) => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 7) return;

      const numCham = cells[0]?.textContent?.trim() || '';
      const nome = cells[1]?.textContent?.trim() || '';
      const ra = cells[2]?.textContent?.trim() || '';
      const digRa = cells[3]?.textContent?.trim() || '';
      const ufRa = cells[4]?.textContent?.trim() || '';
      const dataNasc = cells[5]?.textContent?.trim() || '';
      const filiacao1 = cells[6]?.textContent?.trim() || '';

      // Botão Visualizar (lupa) — pode estar em qualquer coluna a partir da 7
      let btnVisualizar = null;
      for (let c = 7; c < cells.length; c++) {
        const cell = cells[c];
        // Procurar por ícone de lupa (fa-search, glyphicon-search, etc.) ou link/botão
        const lupa = cell.querySelector(
          'a[title*="isualizar"], a[title*="onsultar"], a[title*="etalhe"], ' +
          'button[title*="isualizar"], [onclick*="isualizar"], [onclick*="etalhe"], ' +
          'i.fa-search, i.fa-eye, i.glyphicon-search, i.glyphicon-eye-open, ' +
          'span.fa-search, span.fa-eye, a, button'
        );
        if (lupa) {
          // Se é um ícone, pegar o link pai
          btnVisualizar = lupa.closest('a') || lupa.closest('button') || lupa;
          break;
        }
      }

      if (!nome) return;
      alunos.push({ numCham, nome, ra, digRa, ufRa, dataNasc, filiacao1, btnVisualizar, row: tr });
    });

    return alunos;
  }

  // ========================
  // EXTRAIR TODOS OS DADOS DA FICHA
  // ========================

  async function extrairDadosFicha() {
    const d = {};

    // === DADOS PESSOAIS (aba padrão que já abre) ===
    await clicarAba('Dados Pessoais');

    d['Data de Alteração'] = lerCampoPorLabel('Data de Alteração');
    d['Nome'] = lerCampoPorLabel('Nome');
    d['Informar Nome Social?'] = lerCheckboxPorLabel('Nome Social') ? 'Sim' : 'Não';
    d['Informar Nome Afetivo?'] = lerCheckboxPorLabel('Nome Afetivo') ? 'Sim' : 'Não';
    d['Sexo'] = lerCampoPorLabel('Sexo');
    d['Raça/Cor'] = lerCampoPorLabel('Raça/Cor') || lerCampoPorLabel('Raca/Cor');
    d['Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem'] =
      lerCheckboxPorLabel('transtorno') ? 'Sim' : 'Não';
    d['Tipo Sanguíneo'] = lerCampoPorLabel('Tipo Sangu');
    d['Idade Mínima Especial'] = lerCheckboxPorLabel('Idade Mínima') ? 'Sim' : 'Não';
    d['Data de Nascimento'] = lerCampoPorLabel('Data de Nascimento');
    d['Falecimento'] = lerCheckboxPorLabel('Falecimento') ? 'Sim' : 'Não';
    d['Refugiado'] = lerCheckboxPorLabel('Refugiado') ? 'Sim' : 'Não';
    d['Emancipado'] = lerCheckboxPorLabel('Emancipado') ? 'Sim' : 'Não';

    const allText = document.body.innerText || '';
    const irmaoMatch = allText.match(/Irmão\(s\)\s*[:\s]*(\d+)/i);
    d['Irmão(s)'] = irmaoMatch ? irmaoMatch[1] : '0';

    d['E-Mail'] = lerCampoPorLabel('E-Mail');
    d['E-Mail Google'] = lerCampoPorLabel('E-Mail Google');
    d['E-Mail Microsoft'] = lerCampoPorLabel('E-Mail Microsoft');
    d['Filiação 1'] = lerCampoPorLabel('Filiação 1');
    d['Filiação 2'] = lerCampoPorLabel('Filiação 2');
    d['Participa do Programa Bolsa Família'] = lerCheckboxPorLabel('Bolsa Família') ? 'Sim' : 'Não';

    // RA — extrair do cabeçalho: "Dados do Aluno: NOME - RA:000122759213-9/SP ..."
    let raNum = '', raDig = '', raUf = '';
    const raMatch = allText.match(/RA[:\s]*(\d{9,15})[- ]*(\d)\/(\w{2})/i);
    if (raMatch) {
      raNum = raMatch[1];
      raDig = raMatch[2];
      raUf = raMatch[3];
    }
    if (!raNum) raNum = lerCampoPorLabel('RA');
    d['RA'] = raNum;
    d['nrDigRa'] = raDig;
    d['sgUfRa'] = raUf;

    d['Identificação Única - Educacenso'] = lerCampoPorLabel('Educacenso') || lerCampoPorLabel('Identificação Única');
    d['Nacionalidade'] = lerCampoPorLabel('Nacionalidade');
    d['Município de Nascimento'] = lerCampoPorLabel('Município de Nascimento');

    d['UFNascimento'] = '';
    const munLabels = document.querySelectorAll('label');
    for (const lbl of munLabels) {
      if (lbl.textContent.includes('Município de Nascimento')) {
        const group = lbl.closest('.form-group, .row, div') || lbl.parentElement;
        if (group) {
          const inputs = group.querySelectorAll('input');
          for (const inp of inputs) {
            if (inp.value && inp.value.length === 2 && /^[A-Z]{2}$/.test(inp.value)) {
              d['UFNascimento'] = inp.value;
            }
          }
        }
      }
    }

    d['Sigilo'] = lerCheckboxPorLabel('Sigilo') ? 'Sim' : 'Não';
    d['Quilombola'] = lerCheckboxPorLabel('Quilombola') ? 'Sim' : 'Não';
    d['Membro de Comunidade Circense e/ou Cigana'] = lerCheckboxPorLabel('Circense') ? 'Sim' : 'Não';
    d['Possui internet em casa'] = lerRadioPorLabel('internet em casa') || (lerCheckboxPorLabel('internet') ? 'Sim' : 'Não');
    d['Possui smartphone, tablet ou notebook pessoal'] = lerRadioPorLabel('smartphone') || (lerCheckboxPorLabel('smartphone') ? 'Sim' : 'Não');

    // === DOCUMENTOS ===
    sendLog('  Extraindo Documentos...');
    await clicarAba('Documentos');
    d['CIN'] = lerCheckboxPorLabel('CIN') ? 'Sim' : (lerCampoPorLabel('CIN') || 'Não');
    d['Data Emissão do CIN'] = lerCampoPorLabel('Emissão do CIN') || lerCampoPorLabel('Emissão CIN');
    d['CPF'] = lerCampoPorLabel('CPF');
    d['Documento Civil RG'] = lerCampoPorLabel('RG') || lerCampoPorLabel('Documento Civil');
    d['Data Emissão RG/RNM'] = lerCampoPorLabel('Emissão RG') || lerCampoPorLabel('Data Emissão');
    d['Data de emissão'] = lerCampoPorLabel('Data de emissão');
    d['Cert. Matr.'] = lerCampoPorLabel('Cert') || lerCampoPorLabel('Certidão');
    d['NIS'] = lerCampoPorLabel('NIS');
    d['Cartão Nacional de Saúde - SUS'] = lerCampoPorLabel('SUS') || lerCampoPorLabel('Saúde');

    // === DEFICIÊNCIA ===
    sendLog('  Extraindo Deficiência...');
    await clicarAba('Deficiência');
    d['Investigação de deficiência'] = lerCheckboxPorLabel('Investigação') ? 'Sim' : 'Não';
    d['Estudante com Deficiência'] = lerCheckboxPorLabel('Deficiência') ? 'Sim' : 'Não';
    d['Altas Habilidades/Superdotação'] = lerCheckboxPorLabel('Altas Habilidades') ? 'Sim' : 'Não';
    d['Laudo Médico'] = lerCheckboxPorLabel('Laudo') ? 'Sim' : 'Não';
    d['Nível de Apoio'] = lerCampoPorLabel('Nível de Apoio') || '1';
    d['Necessita de Profissional de apoio Escolar?'] = lerCheckboxPorLabel('Profissional de apoio') ? 'Sim' : 'Não';
    d['Mobilidade Reduzida'] = lerCheckboxPorLabel('Mobilidade') ? 'Sim' : 'Não';
    d['Recursos'] = lerCampoPorLabel('Recursos') || '';

    // === ENDEREÇO RESIDENCIAL ===
    sendLog('  Extraindo Endereço...');
    await clicarAba('Endereço Residencial');
    d['CEP'] = lerCampoPorLabel('CEP');
    d['Localização/Zona de Residência'] = lerCampoPorLabel('Localização') || lerCampoPorLabel('Zona');
    d['Localização Diferenciada'] = lerCampoPorLabel('Diferenciada') || '';
    d['Endereço - Nº'] = lerCampoPorLabel('Endereço') || lerCampoPorLabel('Logradouro');
    d['EnderecoNR'] = lerCampoPorLabel('Número') || lerCampoPorLabel('Nº');
    d['Complemento'] = lerCampoPorLabel('Complemento');
    d['Bairro'] = lerCampoPorLabel('Bairro');
    d['Cidade - UF'] = lerCampoPorLabel('Cidade') || lerCampoPorLabel('Município');
    d['Latitude/Longitude'] = lerCampoPorLabel('Latitude');
    d['Longitude'] = lerCampoPorLabel('Longitude');

    return d;
  }

  // ========================
  // EXTRAIR TELEFONES
  // ========================

  async function extrairTelefones() {
    sendLog('  Extraindo Telefones...');
    await clicarAba('Telefones');

    const telefones = [];
    const tabelas = document.querySelectorAll('table');
    for (const tabela of tabelas) {
      const headers = Array.from(tabela.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
      const hasPhone = headers.some(h =>
        h.includes('tipo telefone') || h.includes('ddd') || h.includes('número') || h.includes('telefone')
      );

      if (hasPhone) {
        const rows = tabela.querySelectorAll('tbody tr');
        rows.forEach(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
          if (cells.length >= 3) {
            const tipo = cells[0] || 'Celular';
            const ddd = cells[1] || '';
            const numero = cells[2] || '';
            if (numero && /\d/.test(numero)) {
              const tel = ddd ? `(${ddd}) ${numero}` : numero;
              const entry = `${tipo}: ${tel}`;
              if (!telefones.includes(entry)) telefones.push(entry);
            }
          }
        });
        if (telefones.length > 0) break;
      }
    }

    return telefones.join(' | ');
  }

  // ========================
  // VOLTAR PARA A LISTA DE ALUNOS
  // ========================

  async function voltarParaLista() {
    sendLog('  Voltando para lista de alunos...');

    // TENTATIVA 1: Botão "Voltar"
    const allBtns = document.querySelectorAll('a, button, input[type="button"], input[type="submit"]');
    for (const btn of allBtns) {
      const txt = (btn.textContent?.trim() || btn.value || '').toLowerCase();
      if (txt === 'voltar' || txt === 'fechar' || txt === 'cancelar') {
        if (btn.offsetParent !== null) {
          sendLog(`  Clicando em "${btn.textContent?.trim() || btn.value}"...`);
          btn.click();
          await sleep(1000);
          const voltou = await esperarTabelaVoltar(10000);
          if (voltou) return true;
        }
      }
    }

    // TENTATIVA 2: Botão × (close)
    const closeButtons = document.querySelectorAll(
      'button.close, .btn-close, [aria-label="Close"], [aria-label="Fechar"], ' +
      '[data-dismiss="modal"], [data-bs-dismiss="modal"], .modal .close'
    );
    for (const btn of closeButtons) {
      if (btn.offsetParent !== null) {
        sendLog('  Clicando no botão fechar (×)...');
        btn.click();
        await sleep(1000);
        const voltou = await esperarTabelaVoltar(10000);
        if (voltou) return true;
      }
    }

    // TENTATIVA 3: Tecla Escape
    sendLog('  Tentando tecla Escape...');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(1000);
    if (tabelaEstaVisivel()) return true;

    // TENTATIVA 4: jQuery modal hide
    try {
      if (window.jQuery || window.$) {
        const jq = window.jQuery || window.$;
        jq('.modal').modal('hide');
        await sleep(1000);
        if (tabelaEstaVisivel()) return true;
      }
    } catch (e) {}

    // TENTATIVA 5: Clicar no backdrop
    const backdrop = document.querySelector('.modal-backdrop, .ui-widget-overlay');
    if (backdrop) {
      backdrop.click();
      await sleep(1000);
      if (tabelaEstaVisivel()) return true;
    }

    // TENTATIVA 6: history.back() como último recurso
    sendLog('  Tentando history.back()...');
    history.back();
    await sleep(2000);
    if (tabelaEstaVisivel()) return true;

    sendLog('  ⚠ Não conseguiu voltar para a lista!', 'warn');
    return false;
  }

  // ========================
  // MONTAR OBJETO CSV
  // ========================

  function montarLinhaCSV(serieAno, numero, dadosLista, d, telefonesStr) {
    const nome = d['Nome'] || dadosLista.nome;
    const dataNasc = d['Data de Nascimento'] || dadosLista.dataNasc;
    const raNum = d['RA'] || dadosLista.ra;
    const raDig = d['nrDigRa'] || dadosLista.digRa;
    const raUf = d['sgUfRa'] || dadosLista.ufRa || 'SP';
    const filiacao1 = d['Filiação 1'] || dadosLista.filiacao1;

    let idade = '';
    if (dataNasc) {
      const parts = dataNasc.split('/');
      if (parts.length === 3) {
        const birth = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        const now = new Date();
        let years = now.getFullYear() - birth.getFullYear();
        if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) years--;
        idade = years + '  anos';
      }
    }

    const cabecalho = `Dados do Aluno: ${nome} - RA:${raNum}-${raDig}/${raUf} - Data Nascimento: ${dataNasc}`;
    const raCabecalho = `${raNum}-${raDig}/${raUf}`;

    return {
      'série/ano': serieAno,
      'numero_linha': numero.toString(),
      'nome': nome,
      'ra_lista': raNum,
      'serie': raDig,
      'uf_lista': raUf,
      'data_nasc_lista': dataNasc,
      'responsavel_lista': filiacao1,
      'cabecalho': cabecalho,
      'ra_cabecalho': raCabecalho,
      'data_nascimento_cabecalho': dataNasc,
      'Data de Alteração': d['Data de Alteração'] || '',
      'Nome': nome,
      'Informar Nome Social?': d['Informar Nome Social?'] || 'Não',
      'Informar Nome Afetivo?': d['Informar Nome Afetivo?'] || 'Não',
      'Sexo': d['Sexo'] || '',
      'Raça/Cor': d['Raça/Cor'] || '',
      'Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem':
        d['Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem'] || 'Não',
      'Idade Mínima Especial': d['Idade Mínima Especial'] || 'Não',
      'Data de Nascimento': dataNasc,
      'Falecimento': d['Falecimento'] || 'Não',
      'Refugiado': d['Refugiado'] || 'Não',
      'Emancipado': d['Emancipado'] || 'Não',
      'Irmão(s)': d['Irmão(s)'] || '0',
      'E-Mail Google': d['E-Mail Google'] || '',
      'E-Mail Microsoft': d['E-Mail Microsoft'] || '',
      'Filiação 1': filiacao1,
      'Filiação 2': d['Filiação 2'] || '',
      'Participa do Programa Bolsa Família': d['Participa do Programa Bolsa Família'] || 'Não',
      'RA': raNum,
      'Identificação Única - Educacenso': d['Identificação Única - Educacenso'] || '',
      'Nacionalidade': d['Nacionalidade'] || '',
      'Município de Nascimento': d['Município de Nascimento'] || '',
      'Sigilo': d['Sigilo'] || 'Não',
      'Quilombola': d['Quilombola'] || 'Não',
      'Membro de Comunidade Circense e/ou Cigana': d['Membro de Comunidade Circense e/ou Cigana'] || 'Não',
      'Possui internet em casa': d['Possui internet em casa'] || 'Não',
      'Possui smartphone, tablet ou notebook pessoal': d['Possui smartphone, tablet ou notebook pessoal'] || 'Não',
      'Carteira de Identidade Nacional (CIN)': d['CIN'] || 'Não',
      'CPF': d['CPF'] || '',
      'Documento Civil RG': d['Documento Civil RG'] || '',
      'Data Emissão RG/RNM': d['Data Emissão RG/RNM'] || '',
      'Data de emissão': d['Data de emissão'] || '',
      'Cert. Matr.': d['Cert. Matr.'] || '',
      'Investigação de deficiência': d['Investigação de deficiência'] || 'Não',
      'Estudante com Deficiência': d['Estudante com Deficiência'] || 'Não',
      'Altas Habilidades/Superdotação': d['Altas Habilidades/Superdotação'] || 'Não',
      'Laudo Médico': d['Laudo Médico'] || 'Não',
      'Nível de Apoio': d['Nível de Apoio'] || '1',
      'Necessita de Profissional de apoio Escolar?': d['Necessita de Profissional de apoio Escolar?'] || 'Não',
      'Mobilidade Reduzida': d['Mobilidade Reduzida'] || 'Não',
      'CEP': d['CEP'] || '',
      'Localização/Zona de Residência': d['Localização/Zona de Residência'] || '',
      'Localização Diferenciada': d['Localização Diferenciada'] || '',
      'Endereço - Nº': d['Endereço - Nº'] || '',
      'Complemento': d['Complemento'] || '',
      'Bairro': d['Bairro'] || '',
      'Cidade - UF': d['Cidade - UF'] || '',
      'Latitude/Longitude': d['Latitude/Longitude'] || '',
      'Mostrar102550100registros': '',
      'Idade': idade,
      'nrDigRa': raDig,
      'sgUfRa': raUf,
      'DigRgAluno': '',
      'EnderecoNR': d['EnderecoNR'] || '',
      'Longitude': d['Longitude'] || '',
      'telefones_formatados': telefonesStr,
      'Recursos Necessários para a Participação do Aluno em Avaliações': d['Recursos'] || '',
      'NIS': d['NIS'] || '',
      'Cartão Nacional de Saúde - SUS': d['Cartão Nacional de Saúde - SUS'] || '',
      'Tipo Sanguíneo': d['Tipo Sanguíneo'] || '',
      'UFNascimento': d['UFNascimento'] || '',
      'Data Emissão do CIN': d['Data Emissão do CIN'] || '',
      'E-Mail': d['E-Mail'] || '',
    };
  }

  // ========================
  // PAGINAÇÃO (DataTables)
  // ========================

  function getProximaPagina() {
    const paginacao = document.querySelectorAll(
      '.dataTables_paginate a, .paginate_button, .pagination a, .pagination li a, ' +
      'a.paginate_button.next, .dataTables_paginate .next'
    );
    for (const btn of paginacao) {
      const text = btn.textContent.trim().toLowerCase();
      if ((text === 'seguinte' || text === 'next' || text === 'próximo' || text === '›' || text === '»') &&
          !btn.parentElement?.classList?.contains('disabled') &&
          !btn.classList.contains('disabled')) {
        return btn;
      }
    }
    return null;
  }

  function getTotalRegistros() {
    const infos = document.querySelectorAll('.dataTables_info, [class*="info"], [id*="info"]');
    for (const info of infos) {
      const match = info.textContent.match(/de\s+(\d+)/i);
      if (match) return parseInt(match[1]);
    }
    return 0;
  }

  // ========================
  // PROCESSO PRINCIPAL
  // ========================

  async function iniciarExtracao(serieAno, delayMs) {
    if (running) return;
    running = true;
    shouldStop = false;

    const totalRegistros = getTotalRegistros();
    sendLog(`===== INICIANDO EXTRAÇÃO =====`);
    sendLog(`Turma: ${serieAno}`);
    sendLog(`Total de registros estimado: ${totalRegistros || '?'}`);
    sendLog(`Delay entre alunos: ${delayMs}ms`);

    const todosAlunos = [];
    let erros = 0;
    let numeroGlobal = 0;
    let paginaAtual = 1;

    while (!shouldStop) {
      sendLog(`--- Página ${paginaAtual} ---`);
      await sleep(1000);

      // Verificar que estamos na lista de alunos
      if (!tabelaEstaVisivel()) {
        sendLog('Tabela de alunos não visível. Esperando...', 'warn');
        await esperarTabelaVoltar(10000);
        if (!tabelaEstaVisivel()) {
          sendLog('Tabela não apareceu. Abortando.', 'error');
          break;
        }
      }

      const alunosDaPagina = coletarDadosTabela();
      if (alunosDaPagina.length === 0) {
        sendLog('Nenhum aluno encontrado nesta página.', 'error');
        break;
      }

      sendLog(`${alunosDaPagina.length} alunos na página ${paginaAtual}`);

      for (let i = 0; i < alunosDaPagina.length; i++) {
        if (shouldStop) break;

        const aluno = alunosDaPagina[i];
        numeroGlobal++;

        sendProgress(numeroGlobal, totalRegistros || numeroGlobal, aluno.nome);
        sendLog(`[${numeroGlobal}] Processando: ${aluno.nome}`);

        try {
          if (!aluno.btnVisualizar) {
            sendLog(`  ⚠ Sem botão Visualizar para ${aluno.nome}`, 'warn');
            const row = montarLinhaCSV(serieAno, numeroGlobal, aluno, {}, '');
            todosAlunos.push(row);
            continue;
          }

          // PASSO 1: Guardar referência — depois de clicar, a tabela pode sumir
          const nomeAluno = aluno.nome;

          // PASSO 2: Clicar na lupa
          sendLog(`  Clicando na lupa de ${nomeAluno}...`);
          aluno.btnVisualizar.click();

          // PASSO 3: Esperar ficha abrir (detectar mudança de conteúdo)
          sendLog(`  Esperando ficha abrir...`);
          await sleep(delayMs); // Dar tempo do servidor responder
          const fichaAbriu = await esperarFichaAbrir(20000);

          if (!fichaAbriu) {
            // Mesmo se não detectamos o texto esperado, tentar extrair o que tiver na tela
            sendLog(`  ⚠ Texto da ficha não detectado, mas vamos tentar extrair...`, 'warn');
          }

          // PASSO 4: Extrair Dados Pessoais + Documentos + Deficiência + Endereço
          sendLog(`  Extraindo dados de ${nomeAluno}...`);
          const dados = await extrairDadosFicha();

          // PASSO 5: Extrair Telefones
          const telefonesStr = await extrairTelefones();

          // Montar linha CSV
          const row = montarLinhaCSV(serieAno, numeroGlobal, aluno, dados, telefonesStr);
          todosAlunos.push(row);

          const camposPreenchidos = Object.values(dados).filter(v => v && v !== 'Não' && v !== '0').length;
          sendLog(`  ✓ ${nomeAluno} - OK (${camposPreenchidos} campos extraídos)`);

          // PASSO 6: Voltar para lista de alunos
          const voltou = await voltarParaLista();
          if (!voltou) {
            sendLog(`  ⚠ Problema ao voltar para lista após ${nomeAluno}`, 'warn');
            // Esperar mais um pouco
            await sleep(3000);
            if (!tabelaEstaVisivel()) {
              sendLog('  Recarregando a página...', 'warn');
              location.reload();
              await sleep(5000);
            }
          }

          await sleep(800); // Pausa entre alunos

        } catch (err) {
          erros++;
          sendError(`${aluno.nome}: ${err.message}`);
          sendLog(`  ✗ Erro: ${aluno.nome}: ${err.message}`, 'error');
          // Tentar voltar para a lista
          try { await voltarParaLista(); } catch (e) {}
          await sleep(2000);
        }

        // Salvar progresso parcial
        await chrome.storage.local.set({ sed_alunos: todosAlunos, sed_erros: erros });
      }

      // Próxima página
      if (shouldStop) break;
      const btnProxima = getProximaPagina();
      if (btnProxima) {
        sendLog(`Avançando para página ${paginaAtual + 1}...`);
        btnProxima.click();
        paginaAtual++;
        await sleep(3000);
      } else {
        sendLog('Última página alcançada.');
        break;
      }
    }

    running = false;
    await chrome.storage.local.set({ sed_alunos: todosAlunos, sed_erros: erros, sed_running: false });
    sendComplete(todosAlunos.length);
    sendLog(`===== EXTRAÇÃO FINALIZADA =====`);
    sendLog(`Total: ${todosAlunos.length} alunos | Erros: ${erros}`, 'success');
  }

  // ========================
  // ESCUTAR MENSAGENS DO POPUP
  // ========================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'INICIAR_EXTRACAO') {
      iniciarExtracao(msg.serieAno, msg.delayMs);
      sendResponse({ ok: true });
    }
    if (msg.action === 'PARAR_EXTRACAO') {
      shouldStop = true;
      running = false;
      sendLog('Extração interrompida pelo usuário.', 'warn');
      sendResponse({ ok: true });
    }
    return true;
  });

  // ========================
  // DEBUG (Console do DevTools)
  // ========================
  window.sedDebug = {
    // Teste 1: Verifica se a ficha está aberta
    fichaAberta: () => {
      const aberta = fichaEstaAberta();
      console.log('Ficha está aberta?', aberta);
      return aberta;
    },
    // Teste 2: Verifica se a tabela está visível
    tabelaVisivel: () => {
      const visivel = tabelaEstaVisivel();
      console.log('Tabela está visível?', visivel);
      return visivel;
    },
    // Teste 3: Coleta a tabela
    coletarTabela: () => {
      const alunos = coletarDadosTabela();
      console.log(`Encontrados ${alunos.length} alunos:`, alunos.map(a => a.nome));
      return alunos;
    },
    // Teste 4: Testa clicar na lupa do primeiro aluno
    testarLupa: async () => {
      const alunos = coletarDadosTabela();
      if (alunos.length === 0) { console.log('Nenhum aluno na tabela'); return; }
      const btn = alunos[0].btnVisualizar;
      if (!btn) { console.log('Sem botão visualizar'); return; }
      console.log('Clicando na lupa de:', alunos[0].nome);
      console.log('Botão:', btn.tagName, btn.className, btn.href || '', btn.outerHTML?.substring(0, 200));
      btn.click();
      console.log('Clicou! Aguarde 3-5s e rode: sedDebug.fichaAberta()');
    },
    // Teste 5: Extrai dados da ficha aberta
    extrairDados: async () => {
      console.log('Extraindo dados da página atual...');
      const dados = await extrairDadosFicha();
      console.log('Dados extraídos:', dados);
      const telefones = await extrairTelefones();
      console.log('Telefones:', telefones);
      return { dados, telefones };
    },
    // Teste 6: Volta para a lista
    voltar: async () => {
      console.log('Tentando voltar para a lista...');
      const ok = await voltarParaLista();
      console.log('Voltou?', ok);
      return ok;
    },
    // Teste 7: Mostra o HTML ao redor de texto específico (para debug)
    encontrarTexto: (texto) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const resultados = [];
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(texto)) {
          const el = walker.currentNode.parentElement;
          resultados.push({
            texto: walker.currentNode.textContent.trim().substring(0, 100),
            tag: el.tagName,
            classes: el.className,
            id: el.id,
            html: el.outerHTML?.substring(0, 300)
          });
        }
      }
      console.log(`Encontradas ${resultados.length} ocorrências de "${texto}":`, resultados);
      return resultados;
    }
  };

  console.log('[SED Extrator v4] Content script carregado ✓');
  console.log('[SED Extrator v4] Debug: sedDebug.fichaAberta() | sedDebug.tabelaVisivel() | sedDebug.testarLupa() | sedDebug.coletarTabela()');

})();
