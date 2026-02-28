// ========================
// CONTENT.JS - Extrator SED (Ficha do Aluno) v3
// ========================
// Detecção robusta de modal/dialog + fluxo:
//   1. Clicar na lupa (Visualizar)
//   2. Esperar a ficha do aluno aparecer (modal, dialog, overlay, div, etc.)
//   3. Extrair Dados Pessoais
//   4. Clicar em Telefones → extrair
//   5. Fechar a ficha
//   6. Repetir para o próximo aluno e próxima página

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
    try { chrome.runtime.sendMessage({ type: 'LOG', texto, nivel }); } catch (e) { /* popup fechado */ }
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
  // DETECÇÃO ROBUSTA DE MODAL/FICHA DO ALUNO
  // ========================
  // O SED pode usar: Bootstrap modal, jQuery UI dialog, div overlay, ou qualquer container.
  // Estratégia: tentar MUITOS seletores e também procurar pelo texto "Dados do Aluno" no DOM.

  const MODAL_SELECTORS = [
    '.modal.in',
    '.modal.show',
    '.modal.fade.in',
    '.modal[style*="display: block"]',
    '.modal[style*="display:block"]',
    '.modal:not([style*="display: none"]):not([style*="display:none"])',
    '.ui-dialog',
    '[role="dialog"]',
    '[role="document"]',
    '.modal-dialog',
    '.modal-content',
    '#modalDetalhe',
    '#modal-detalhe',
    '#modalAluno',
    '#modal-aluno',
    '#ModalFichaAluno',
    '#modalConsulta',
    '[id*="modal"][id*="luno"]',
    '[id*="modal"][id*="etalhe"]',
    '[id*="Modal"]',
    '.overlay-content',
    '.dialog-content',
    '.panel-detalhe',
    '.ficha-aluno',
    '[class*="modal"][class*="open"]',
    '[class*="modal"][class*="active"]',
    '[class*="dialog"]',
    '.modal-backdrop + .modal',
  ];

  function encontrarModalAberto() {
    // Estratégia 1: Tentar todos os seletores CSS conhecidos
    for (const sel of MODAL_SELECTORS) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          // Verificar se está visível
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 50) {
            sendLog(`Modal encontrado via seletor: ${sel}`, 'debug');
            return el;
          }
        }
      } catch (e) { /* seletor inválido, ignorar */ }
    }

    // Estratégia 2: Procurar qualquer elemento que contenha "Dados do Aluno" no cabeçalho
    const allElements = document.querySelectorAll('div, section, article, aside, main');
    for (const el of allElements) {
      if (el.offsetHeight < 100) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // Verificar se contém o texto do cabeçalho da ficha
      const firstText = el.innerText?.substring(0, 500) || '';
      if (firstText.includes('Dados do Aluno') || firstText.includes('Dados Pessoais')) {
        // Verificar se parece um overlay/modal (z-index alto ou position fixed/absolute)
        const zIndex = parseInt(style.zIndex) || 0;
        const isOverlay = style.position === 'fixed' || style.position === 'absolute' || zIndex > 10;
        if (isOverlay || el.classList.contains('modal') || el.getAttribute('role') === 'dialog') {
          sendLog(`Modal encontrado via texto "Dados do Aluno"`, 'debug');
          return el;
        }
        // Subir para o container pai que pode ser o modal
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          const pStyle = window.getComputedStyle(parent);
          const pZ = parseInt(pStyle.zIndex) || 0;
          if (pStyle.position === 'fixed' || pStyle.position === 'absolute' || pZ > 10
              || parent.classList.contains('modal') || parent.getAttribute('role') === 'dialog') {
            sendLog(`Modal encontrado via parent de "Dados do Aluno"`, 'debug');
            return parent;
          }
          parent = parent.parentElement;
        }
        // Se não achou overlay, retornar mesmo assim — é provavelmente o conteúdo da ficha
        sendLog(`Usando container com "Dados do Aluno" como modal`, 'debug');
        return el;
      }
    }

    // Estratégia 3: Verificar se houve mudança significativa no body (novo elemento grande com z-index)
    const allDivs = document.querySelectorAll('body > div, body > section');
    let bestCandidate = null;
    let bestZ = 0;
    for (const div of allDivs) {
      const st = window.getComputedStyle(div);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const z = parseInt(st.zIndex) || 0;
      if (z > bestZ && div.offsetHeight > 200) {
        // Verificar se não é um backdrop vazio
        if (div.innerText?.trim().length > 20) {
          bestCandidate = div;
          bestZ = z;
        }
      }
    }
    if (bestCandidate && bestZ > 0) {
      sendLog(`Modal encontrado via z-index alto (${bestZ})`, 'debug');
      return bestCandidate;
    }

    return null;
  }

  function waitForModal(timeout = 15000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const modal = encontrarModalAberto();
        if (modal) return resolve(modal);
        if (Date.now() - start > timeout) {
          // Última tentativa: usar document como fallback
          sendLog('Timeout esperando modal, usando document como fallback', 'warn');
          return resolve(document);
        }
        setTimeout(check, 400);
      };
      check();
    });
  }

  function waitForModalClose(timeout = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const modal = encontrarModalAberto();
        if (!modal || modal === document) return resolve();
        if (Date.now() - start > timeout) return resolve();
        setTimeout(check, 400);
      };
      // Esperar um momento antes de começar a checar
      setTimeout(check, 500);
    });
  }

  // ========================
  // LER CAMPOS DO MODAL DO SED
  // ========================

  function lerCampoPorLabel(container, labelText) {
    const labels = container.querySelectorAll('label, strong, th, dt, .control-label, .field-label');
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
          if (s.children.length === 0 && s.textContent.trim()) return s.textContent.trim();
        }
      }

      // Próximo elemento irmão direto
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
          if (val && val !== text) return val;
        }
      }
    }
    return '';
  }

  function lerCheckboxPorLabel(container, labelText) {
    const labels = container.querySelectorAll('label, strong');
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

  function lerRadioPorLabel(container, labelText) {
    const labels = container.querySelectorAll('label, strong');
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
        const checked = group.querySelector('input[type="checkbox"]:checked');
        if (checked) return 'Sim';
      }
    }
    return '';
  }

  // ========================
  // CLICAR EM UMA ABA DO MODAL
  // ========================

  async function clicarAba(container, nomeAba) {
    // Buscar em todo o document (as abas podem estar fora do container do modal)
    const searchIn = [container, document];
    for (const ctx of searchIn) {
      const tabs = ctx.querySelectorAll(
        '.nav-tabs a, .nav-pills a, .nav a, [role="tab"], ' +
        'a[data-toggle="tab"], a[data-bs-toggle="tab"], ' +
        'a[href*="#"], li a, button[data-toggle], .tab-link, .tab'
      );
      for (const tab of tabs) {
        const text = tab.textContent.trim();
        if (text === nomeAba || text.toLowerCase() === nomeAba.toLowerCase()) {
          sendLog(`Clicando na aba "${nomeAba}"...`);
          tab.click();
          await sleep(1500);
          return true;
        }
      }
    }
    sendLog(`Aba "${nomeAba}" não encontrada`, 'warn');
    return false;
  }

  // ========================
  // COLETAR DADOS DA TABELA PRINCIPAL
  // ========================

  function coletarDadosTabela() {
    const rows = document.querySelectorAll('table tbody tr');
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

      // Botão Visualizar na coluna 7 — pode ser <a>, <button>, ou <i> dentro de <a>
      const visualizarCell = cells[7];
      let btnVisualizar = null;
      if (visualizarCell) {
        // Procurar link ou botão clicável
        btnVisualizar = visualizarCell.querySelector('a[href], button, a[onclick], span[onclick]');
        if (!btnVisualizar) {
          // Tentar qualquer elemento clicável dentro da célula
          btnVisualizar = visualizarCell.querySelector('a, i, span, img');
        }
        if (btnVisualizar && (btnVisualizar.tagName === 'I' || btnVisualizar.tagName === 'SPAN' || btnVisualizar.tagName === 'IMG')) {
          const parent = btnVisualizar.closest('a') || btnVisualizar.closest('button');
          if (parent) btnVisualizar = parent;
        }
      }

      if (!nome) return;
      alunos.push({ numCham, nome, ra, digRa, ufRa, dataNasc, filiacao1, btnVisualizar, row: tr });
    });

    return alunos;
  }

  // ========================
  // EXTRAIR DADOS PESSOAIS (aba padrão que já abre)
  // ========================

  async function extrairDadosPessoais(container) {
    // Tentar clicar na aba Dados Pessoais (caso não esteja selecionada por padrão)
    await clicarAba(container, 'Dados Pessoais');

    const d = {};

    d['Data de Alteração'] = lerCampoPorLabel(container, 'Data de Alteração');
    d['Nome'] = lerCampoPorLabel(container, 'Nome');
    d['Informar Nome Social?'] = lerCheckboxPorLabel(container, 'Nome Social') ? 'Sim' : 'Não';
    d['Informar Nome Afetivo?'] = lerCheckboxPorLabel(container, 'Nome Afetivo') ? 'Sim' : 'Não';
    d['Sexo'] = lerCampoPorLabel(container, 'Sexo');
    d['Raça/Cor'] = lerCampoPorLabel(container, 'Raça/Cor') || lerCampoPorLabel(container, 'Raca/Cor');
    d['Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem'] =
      lerCheckboxPorLabel(container, 'transtorno') ? 'Sim' : 'Não';
    d['Tipo Sanguíneo'] = lerCampoPorLabel(container, 'Tipo Sangu');
    d['Idade Mínima Especial'] = lerCheckboxPorLabel(container, 'Idade Mínima') ? 'Sim' : 'Não';
    d['Data de Nascimento'] = lerCampoPorLabel(container, 'Data de Nascimento');
    d['Falecimento'] = lerCheckboxPorLabel(container, 'Falecimento') ? 'Sim' : 'Não';
    d['Refugiado'] = lerCheckboxPorLabel(container, 'Refugiado') ? 'Sim' : 'Não';
    d['Emancipado'] = lerCheckboxPorLabel(container, 'Emancipado') ? 'Sim' : 'Não';

    const allText = container.innerText || '';
    const irmaoMatch = allText.match(/Irmão\(s\)\s*(\d+)/i);
    d['Irmão(s)'] = irmaoMatch ? irmaoMatch[1] : '0';

    d['E-Mail'] = lerCampoPorLabel(container, 'E-Mail');
    d['E-Mail Google'] = lerCampoPorLabel(container, 'E-Mail Google');
    d['E-Mail Microsoft'] = lerCampoPorLabel(container, 'E-Mail Microsoft');
    d['Filiação 1'] = lerCampoPorLabel(container, 'Filiação 1');
    d['Filiação 2'] = lerCampoPorLabel(container, 'Filiação 2');
    d['Participa do Programa Bolsa Família'] = lerCheckboxPorLabel(container, 'Bolsa Família') ? 'Sim' : 'Não';

    // RA — extrair do cabeçalho: "Dados do Aluno: NOME - RA:000122759213-9/SP - Data Nascimento: dd/mm/aaaa"
    let raNum = '', raDig = '', raUf = '';
    const raMatch = allText.match(/RA[:\s]*(\d{9,15})[- ]*(\d)\/(\w{2})/i);
    if (raMatch) {
      raNum = raMatch[1];
      raDig = raMatch[2];
      raUf = raMatch[3];
    }
    if (!raNum) raNum = lerCampoPorLabel(container, 'RA');
    d['RA'] = raNum;
    d['nrDigRa'] = raDig;
    d['sgUfRa'] = raUf;

    d['Identificação Única - Educacenso'] = lerCampoPorLabel(container, 'Educacenso') || lerCampoPorLabel(container, 'Identificação Única');
    d['Nacionalidade'] = lerCampoPorLabel(container, 'Nacionalidade');
    d['Município de Nascimento'] = lerCampoPorLabel(container, 'Município de Nascimento');

    d['UFNascimento'] = '';
    const munLabels = container.querySelectorAll('label');
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

    d['Sigilo'] = lerCheckboxPorLabel(container, 'Sigilo') ? 'Sim' : 'Não';
    d['Quilombola'] = lerCheckboxPorLabel(container, 'Quilombola') ? 'Sim' : 'Não';
    d['Membro de Comunidade Circense e/ou Cigana'] = lerCheckboxPorLabel(container, 'Circense') ? 'Sim' : 'Não';

    const internetVal = lerRadioPorLabel(container, 'internet em casa');
    d['Possui internet em casa'] = internetVal || (lerCheckboxPorLabel(container, 'internet') ? 'Sim' : 'Não');
    const smartVal = lerRadioPorLabel(container, 'smartphone');
    d['Possui smartphone, tablet ou notebook pessoal'] = smartVal || (lerCheckboxPorLabel(container, 'smartphone') ? 'Sim' : 'Não');

    // === DOCUMENTOS (extrair do mesmo container se visível, ou clicar na aba) ===
    await clicarAba(container, 'Documentos');
    d['CIN'] = lerCheckboxPorLabel(container, 'CIN') ? 'Sim' : (lerCampoPorLabel(container, 'CIN') || 'Não');
    d['Data Emissão do CIN'] = lerCampoPorLabel(container, 'Emissão do CIN') || lerCampoPorLabel(container, 'Emissão CIN');
    d['CPF'] = lerCampoPorLabel(container, 'CPF');
    d['Documento Civil RG'] = lerCampoPorLabel(container, 'RG') || lerCampoPorLabel(container, 'Documento Civil');
    d['Data Emissão RG/RNM'] = lerCampoPorLabel(container, 'Emissão RG') || lerCampoPorLabel(container, 'Data Emissão');
    d['Data de emissão'] = lerCampoPorLabel(container, 'Data de emissão');
    d['Cert. Matr.'] = lerCampoPorLabel(container, 'Cert') || lerCampoPorLabel(container, 'Certidão');
    d['NIS'] = lerCampoPorLabel(container, 'NIS');
    d['Cartão Nacional de Saúde - SUS'] = lerCampoPorLabel(container, 'SUS') || lerCampoPorLabel(container, 'Saúde');

    // === DEFICIÊNCIA ===
    await clicarAba(container, 'Deficiência');
    d['Investigação de deficiência'] = lerCheckboxPorLabel(container, 'Investigação') ? 'Sim' : 'Não';
    d['Estudante com Deficiência'] = lerCheckboxPorLabel(container, 'Deficiência') ? 'Sim' : 'Não';
    d['Altas Habilidades/Superdotação'] = lerCheckboxPorLabel(container, 'Altas Habilidades') ? 'Sim' : 'Não';
    d['Laudo Médico'] = lerCheckboxPorLabel(container, 'Laudo') ? 'Sim' : 'Não';
    d['Nível de Apoio'] = lerCampoPorLabel(container, 'Nível de Apoio') || '1';
    d['Necessita de Profissional de apoio Escolar?'] = lerCheckboxPorLabel(container, 'Profissional de apoio') ? 'Sim' : 'Não';
    d['Mobilidade Reduzida'] = lerCheckboxPorLabel(container, 'Mobilidade') ? 'Sim' : 'Não';
    d['Recursos'] = lerCampoPorLabel(container, 'Recursos') || '';

    // === ENDEREÇO RESIDENCIAL ===
    await clicarAba(container, 'Endereço Residencial');
    d['CEP'] = lerCampoPorLabel(container, 'CEP');
    d['Localização/Zona de Residência'] = lerCampoPorLabel(container, 'Localização') || lerCampoPorLabel(container, 'Zona');
    d['Localização Diferenciada'] = lerCampoPorLabel(container, 'Diferenciada') || 'Não está em área de localização diferenciada';
    d['Endereço - Nº'] = lerCampoPorLabel(container, 'Endereço') || lerCampoPorLabel(container, 'Logradouro');
    d['EnderecoNR'] = lerCampoPorLabel(container, 'Número') || lerCampoPorLabel(container, 'Nº');
    d['Complemento'] = lerCampoPorLabel(container, 'Complemento');
    d['Bairro'] = lerCampoPorLabel(container, 'Bairro');
    d['Cidade - UF'] = lerCampoPorLabel(container, 'Cidade') || lerCampoPorLabel(container, 'Município');
    d['Latitude/Longitude'] = lerCampoPorLabel(container, 'Latitude');
    d['Longitude'] = lerCampoPorLabel(container, 'Longitude');

    return d;
  }

  // ========================
  // EXTRAIR TELEFONES
  // ========================

  async function extrairTelefones(container) {
    await clicarAba(container, 'Telefones');

    const telefones = [];

    // Buscar tabelas em todo document (a aba pode renderizar fora do container do modal)
    const searchContexts = [container, document];
    for (const ctx of searchContexts) {
      const tabelas = ctx.querySelectorAll('table');
      for (const tabela of tabelas) {
        const headers = Array.from(tabela.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
        const hasPhone = headers.some(h => h.includes('tipo telefone') || h.includes('ddd') || h.includes('número'));

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

          // Se encontrou telefones, não precisa continuar buscando
          if (telefones.length > 0) break;
        }
      }
      if (telefones.length > 0) break;
    }

    return telefones.join(' | ');
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

    const cabecalho = `×Dados do Aluno: ${nome} - RA:${raNum}-${raDig}/${raUf} - Data Nascimento: ${dataNasc}`;
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
      'Nacionalidade': d['Nacionalidade'] || 'Brasileira',
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
      'Localização/Zona de Residência': d['Localização/Zona de Residência'] || 'Urbana',
      'Localização Diferenciada': d['Localização Diferenciada'] || 'Não está em área de localização diferenciada',
      'Endereço - Nº': d['Endereço - Nº'] || '',
      'Complemento': d['Complemento'] || '',
      'Bairro': d['Bairro'] || '',
      'Cidade - UF': d['Cidade - UF'] || '',
      'Latitude/Longitude': d['Latitude/Longitude'] || '',
      'Mostrar102550100registros': '10',
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
  // FECHAR A FICHA/MODAL
  // ========================

  async function fecharModal() {
    sendLog('Fechando ficha do aluno...');

    // TENTATIVA 1: Botão × (close) — procurar em vários contextos
    const closeSelectors = [
      '.modal.in .close',
      '.modal.show .close',
      '.modal .close',
      '[role="dialog"] .close',
      '.ui-dialog .ui-dialog-titlebar-close',
      'button.close',
      '.btn-close',
      'button[aria-label="Close"]',
      'button[aria-label="Fechar"]',
      '[data-dismiss="modal"]',
      '[data-bs-dismiss="modal"]',
    ];
    for (const sel of closeSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        sendLog(`Fechando via ${sel}`);
        btn.click();
        await sleep(1500);
        await waitForModalClose();
        return;
      }
    }

    // TENTATIVA 2: Botão "Voltar"
    const allBtns = document.querySelectorAll('a, button, input[type="button"]');
    for (const btn of allBtns) {
      const txt = btn.textContent?.trim() || btn.value || '';
      if (txt === 'Voltar' || txt === 'Fechar' || txt === 'Cancelar') {
        if (btn.offsetParent !== null) {
          sendLog(`Fechando via botão "${txt}"`);
          btn.click();
          await sleep(1500);
          await waitForModalClose();
          return;
        }
      }
    }

    // TENTATIVA 3: Clicar no backdrop
    const backdrop = document.querySelector('.modal-backdrop, .ui-widget-overlay');
    if (backdrop) {
      sendLog('Fechando via backdrop');
      backdrop.click();
      await sleep(1000);
    }

    // TENTATIVA 4: Tecla Escape
    sendLog('Fechando via tecla Escape');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(1500);

    // TENTATIVA 5: Forçar fechar modals Bootstrap via jQuery se disponível
    try {
      if (window.jQuery || window.$) {
        const jq = window.jQuery || window.$;
        jq('.modal').modal('hide');
        sendLog('Fechando via jQuery .modal("hide")');
        await sleep(1000);
      }
    } catch (e) { /* jQuery não disponível */ }
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
    // Texto "Registros 1 a 10 de 42"
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
  // Fluxo por aluno:
  //   1. Clicar na lupa (Visualizar)
  //   2. Esperar ficha abrir
  //   3. Extrair Dados Pessoais + Documentos + Deficiência + Endereço
  //   4. Clicar aba Telefones → extrair
  //   5. Fechar ficha
  //   6. Próximo aluno

  async function iniciarExtracao(serieAno, delayMs) {
    if (running) return;
    running = true;
    shouldStop = false;

    const totalRegistros = getTotalRegistros();
    sendLog(`===== INICIANDO EXTRAÇÃO =====`);
    sendLog(`Total de registros estimado: ${totalRegistros || '?'}`);
    sendLog(`Delay entre alunos: ${delayMs}ms`);

    const todosAlunos = [];
    let erros = 0;
    let numeroGlobal = 0;
    let paginaAtual = 1;

    while (!shouldStop) {
      sendLog(`--- Página ${paginaAtual} ---`);
      await sleep(1000);

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

          // PASSO 1: Clicar na lupa
          sendLog(`  Clicando na lupa...`);
          aluno.btnVisualizar.click();
          await sleep(delayMs);

          // PASSO 2: Esperar ficha abrir
          sendLog(`  Esperando ficha abrir...`);
          const container = await waitForModal(15000);

          if (!container || container === document) {
            sendLog(`  ⚠ Ficha pode não ter aberto para ${aluno.nome}. Tentando extrair mesmo assim...`, 'warn');
          } else {
            sendLog(`  ✓ Ficha detectada!`);
          }

          // PASSO 3: Extrair Dados Pessoais + Documentos + Deficiência + Endereço
          sendLog(`  Extraindo dados...`);
          const dados = await extrairDadosPessoais(container);

          // PASSO 4: Extrair Telefones
          sendLog(`  Extraindo telefones...`);
          const telefonesStr = await extrairTelefones(container);

          // Montar linha CSV
          const row = montarLinhaCSV(serieAno, numeroGlobal, aluno, dados, telefonesStr);
          todosAlunos.push(row);

          sendLog(`  ✓ ${aluno.nome} - OK`);

          // PASSO 5: Fechar ficha
          await fecharModal();
          await sleep(800);

        } catch (err) {
          erros++;
          sendError(`${aluno.nome}: ${err.message}`);
          sendLog(`  ✗ Erro: ${aluno.nome}: ${err.message}`, 'error');
          // Tentar fechar qualquer coisa que esteja aberta
          try { await fecharModal(); } catch (e) { /* ignore */ }
          await sleep(1000);
        }

        // Salvar progresso parcial
        await chrome.storage.local.set({ sed_alunos: todosAlunos, sed_erros: erros });
      }

      // Próxima página
      const btnProxima = getProximaPagina();
      if (btnProxima && !shouldStop) {
        sendLog(`Avançando para página ${paginaAtual + 1}...`);
        btnProxima.click();
        paginaAtual++;
        await sleep(2500);
      } else {
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
  // DEBUG: Expor função para testar no Console do DevTools
  // ========================
  // No console do Chrome, digite: sedDebug.detectarModal() para testar a detecção
  window.sedDebug = {
    detectarModal: () => {
      const m = encontrarModalAberto();
      if (m) {
        console.log('Modal encontrado:', m);
        console.log('TagName:', m.tagName, 'Classes:', m.className, 'ID:', m.id);
        console.log('Texto (primeiros 200 chars):', m.innerText?.substring(0, 200));
      } else {
        console.log('Nenhum modal detectado.');
      }
      return m;
    },
    coletarTabela: coletarDadosTabela,
    testarLupa: async () => {
      const alunos = coletarDadosTabela();
      if (alunos.length > 0) {
        console.log(`Encontrados ${alunos.length} alunos. Testando o primeiro...`);
        const btn = alunos[0].btnVisualizar;
        if (btn) {
          console.log('Botão visualizar:', btn.tagName, btn.className, btn.href || btn.onclick);
          btn.click();
          console.log('Clicou! Aguarde 3s e rode: sedDebug.detectarModal()');
        } else {
          console.log('Sem botão visualizar na primeira linha');
        }
      } else {
        console.log('Nenhum aluno na tabela');
      }
    }
  };

  console.log('[SED Extrator v3] Content script carregado ✓');
  console.log('[SED Extrator v3] Para debug, use: sedDebug.detectarModal() ou sedDebug.testarLupa()');

})();
