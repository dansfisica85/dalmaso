// ========================
// CONTENT.JS - Extrator SED (Ficha do Aluno)
// ========================
// Baseado na estrutura real do SED:
// - Tabela DataTables com colunas: Nº Cham | Nome do Aluno | RA | Dig. RA | UF RA | Data Nasc | Filiação 1 | Visualizar | Editar | Escolas
// - Modal com abas: Dados Pessoais | Documentos | Deficiência | Endereço Residencial | Telefones | ...
// - Campos em formato label + input readonly
// - Paginação DataTables (Anterior 1 2 3 ... Seguinte)

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

  function waitForModal(timeout = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"]');
        if (modal && modal.offsetParent !== null) return resolve(modal);
        if (Date.now() - start > timeout) return reject(new Error('Timeout esperando modal abrir'));
        setTimeout(check, 300);
      };
      check();
    });
  }

  function waitForModalClose(timeout = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const modal = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"]');
        if (!modal || modal.offsetParent === null) return resolve();
        if (Date.now() - start > timeout) return resolve();
        setTimeout(check, 300);
      };
      check();
    });
  }

  function sendLog(texto, nivel = 'info') {
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
  // LER CAMPOS DO MODAL DO SED
  // ========================

  // O SED usa padrão: <label>Campo:</label> seguido de <input readonly> ou <span>
  function lerCampoPorLabel(modal, labelText) {
    const labels = modal.querySelectorAll('label, strong, th, dt');
    for (const lbl of labels) {
      const text = lbl.textContent.trim().replace(/:$/, '').replace(/\?$/, '').trim();
      if (!text.toLowerCase().includes(labelText.toLowerCase())) continue;

      // Próximo elemento irmão
      let next = lbl.nextElementSibling;
      if (next) {
        const input = next.matches('input, select, textarea') ? next : next.querySelector('input, select, textarea');
        if (input) {
          if (input.tagName === 'SELECT') {
            const opt = input.options[input.selectedIndex];
            return opt ? opt.textContent.trim() : '';
          }
          return input.value || '';
        }
        const val = next.textContent.trim();
        if (val && val !== text) return val;
      }

      // Tentar no form-group pai
      const group = lbl.closest('.form-group, .control-group, tr, div');
      if (group) {
        const inputs = group.querySelectorAll('input, select, textarea, span');
        for (const el of inputs) {
          if (el === lbl || el.contains(lbl) || lbl.contains(el)) continue;
          if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && el.value) return el.value;
          if (el.tagName === 'SELECT') {
            const opt = el.options[el.selectedIndex];
            return opt ? opt.textContent.trim() : '';
          }
        }
      }
    }
    return '';
  }

  // Checkbox por label
  function lerCheckboxPorLabel(modal, labelText) {
    const labels = modal.querySelectorAll('label, strong');
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
        const cb = next.matches('input[type="checkbox"]') ? next : next.querySelector('input[type="checkbox"]');
        if (cb) return cb.checked;
        next = next.nextElementSibling;
      }
    }
    return false;
  }

  // Radio (Sim/Não) por label
  function lerRadioPorLabel(modal, labelText) {
    const labels = modal.querySelectorAll('label, strong');
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
            const parent = radio.parentElement;
            return parent?.textContent?.trim() || 'Sim';
          }
        }
        // Checkboxes Sim/Não
        const checked = group.querySelector('input[type="checkbox"]:checked');
        if (checked) return 'Sim';
      }
    }
    return '';
  }

  // ========================
  // CLICAR EM UMA ABA DO MODAL
  // ========================

  async function clicarAba(modal, nomeAba) {
    const tabs = modal.querySelectorAll('a, button, li a, .nav a, [role="tab"], .tab');
    for (const tab of tabs) {
      const text = tab.textContent.trim();
      if (text === nomeAba || text.toLowerCase() === nomeAba.toLowerCase()) {
        tab.click();
        await sleep(1200);
        return true;
      }
    }
    sendLog(`Aba "${nomeAba}" não encontrada`, 'warn');
    return false;
  }

  // ========================
  // COLETAR DADOS DA TABELA PRINCIPAL
  // ========================
  // Colunas: 0=Nº Cham | 1=Nome do Aluno | 2=RA | 3=Dig. RA | 4=UF RA | 5=Data Nasc | 6=Filiação 1 | 7=Visualizar | 8=Editar | 9=Escolas

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

      // Botão Visualizar (lupa Q) na coluna 7
      const visualizarCell = cells[7];
      let btnVisualizar = null;
      if (visualizarCell) {
        btnVisualizar = visualizarCell.querySelector('a, button, i') || visualizarCell;
        // Se pegou um <i>, subir para o <a> pai
        if (btnVisualizar && (btnVisualizar.tagName === 'I' || btnVisualizar.tagName === 'SPAN')) {
          btnVisualizar = btnVisualizar.closest('a') || btnVisualizar.closest('button') || btnVisualizar;
        }
      }

      if (!nome) return;

      alunos.push({ numCham, nome, ra, digRa, ufRa, dataNasc, filiacao1, btnVisualizar, row: tr });
    });

    return alunos;
  }

  // ========================
  // EXTRAIR ABA "DADOS PESSOAIS"
  // ========================

  async function extrairDadosPessoais(modal) {
    await clicarAba(modal, 'Dados Pessoais');
    const d = {};

    d['Data de Alteração'] = lerCampoPorLabel(modal, 'Data de Alteração');
    d['Nome'] = lerCampoPorLabel(modal, 'Nome');
    d['Informar Nome Social?'] = lerCheckboxPorLabel(modal, 'Nome Social') ? 'Sim' : 'Não';
    d['Informar Nome Afetivo?'] = lerCheckboxPorLabel(modal, 'Nome Afetivo') ? 'Sim' : 'Não';
    d['Sexo'] = lerCampoPorLabel(modal, 'Sexo');
    d['Raça/Cor'] = lerCampoPorLabel(modal, 'Raça/Cor') || lerCampoPorLabel(modal, 'Raca/Cor');
    d['Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem'] =
      lerCheckboxPorLabel(modal, 'transtorno') ? 'Sim' : 'Não';
    d['Tipo Sanguíneo'] = lerCampoPorLabel(modal, 'Tipo Sangu');
    d['Idade Mínima Especial'] = lerCheckboxPorLabel(modal, 'Idade Mínima') ? 'Sim' : 'Não';
    d['Data de Nascimento'] = lerCampoPorLabel(modal, 'Data de Nascimento');
    d['Falecimento'] = lerCheckboxPorLabel(modal, 'Falecimento') ? 'Sim' : 'Não';
    d['Refugiado'] = lerCheckboxPorLabel(modal, 'Refugiado') ? 'Sim' : 'Não';
    d['Emancipado'] = lerCheckboxPorLabel(modal, 'Emancipado') ? 'Sim' : 'Não';

    // Irmão(s) - botão/badge com número: "Irmão(s) 0"
    const allText = modal.innerText || '';
    const irmaoMatch = allText.match(/Irmão\(s\)\s*(\d+)/i);
    d['Irmão(s)'] = irmaoMatch ? irmaoMatch[1] : '0';

    d['E-Mail'] = lerCampoPorLabel(modal, 'E-Mail:');
    d['E-Mail Google'] = lerCampoPorLabel(modal, 'E-Mail Google');
    d['E-Mail Microsoft'] = lerCampoPorLabel(modal, 'E-Mail Microsoft');
    d['Filiação 1'] = lerCampoPorLabel(modal, 'Filiação 1');
    d['Filiação 2'] = lerCampoPorLabel(modal, 'Filiação 2');
    d['Participa do Programa Bolsa Família'] = lerCheckboxPorLabel(modal, 'Bolsa Família') ? 'Sim' : 'Não';

    // RA em 3 campos: 000122759213 - 9 / SP
    let raNum = '', raDig = '', raUf = '';
    // Extrair do cabeçalho do modal: "Dados do Aluno: NOME - RA:000122759213-9/SP - Data Nascimento: dd/mm/aaaa"
    const header = modal.querySelector('.modal-header, .modal-title, [class*="header"]');
    if (header) {
      const hText = header.textContent || header.innerText || '';
      const raMatch = hText.match(/RA[:\s]*(\d{10,15})-(\d)\/(\w{2})/i);
      if (raMatch) {
        raNum = raMatch[1];
        raDig = raMatch[2];
        raUf = raMatch[3];
      }
    }
    // Fallback: campos de input de RA
    if (!raNum) {
      raNum = lerCampoPorLabel(modal, 'RA');
    }
    d['RA'] = raNum;
    d['nrDigRa'] = raDig;
    d['sgUfRa'] = raUf;

    d['Identificação Única - Educacenso'] = lerCampoPorLabel(modal, 'Educacenso') || lerCampoPorLabel(modal, 'Identificação Única');
    d['Nacionalidade'] = lerCampoPorLabel(modal, 'Nacionalidade');
    d['Município de Nascimento'] = lerCampoPorLabel(modal, 'Município de Nascimento');

    // UF Nascimento (pode estar ao lado do município)
    d['UFNascimento'] = '';
    const munLabels = modal.querySelectorAll('label');
    for (const lbl of munLabels) {
      if (lbl.textContent.includes('Município de Nascimento')) {
        const group = lbl.closest('.form-group, div') || lbl.parentElement;
        if (group) {
          const inputs = group.querySelectorAll('input');
          for (const inp of inputs) {
            if (inp.value.length === 2 && /^[A-Z]{2}$/.test(inp.value)) {
              d['UFNascimento'] = inp.value;
            }
          }
        }
      }
    }

    d['Sigilo'] = lerCheckboxPorLabel(modal, 'Sigilo') ? 'Sim' : 'Não';
    d['Quilombola'] = lerCheckboxPorLabel(modal, 'Quilombola') ? 'Sim' : 'Não';
    d['Membro de Comunidade Circense e/ou Cigana'] = lerCheckboxPorLabel(modal, 'Circense') ? 'Sim' : 'Não';

    // Internet e smartphone: radio buttons "✓ Sim  Não" 
    const internetVal = lerRadioPorLabel(modal, 'internet em casa');
    d['Possui internet em casa'] = internetVal || (lerCheckboxPorLabel(modal, 'internet') ? 'Sim' : 'Não');
    const smartVal = lerRadioPorLabel(modal, 'smartphone');
    d['Possui smartphone, tablet ou notebook pessoal'] = smartVal || (lerCheckboxPorLabel(modal, 'smartphone') ? 'Sim' : 'Não');

    return d;
  }

  // ========================
  // EXTRAIR ABA "DOCUMENTOS"
  // ========================

  async function extrairDocumentos(modal) {
    await clicarAba(modal, 'Documentos');
    const d = {};

    d['Carteira de Identidade Nacional (CIN)'] = lerCheckboxPorLabel(modal, 'CIN') ? 'Sim' : (lerCampoPorLabel(modal, 'CIN') || 'Não');
    d['Data Emissão do CIN'] = lerCampoPorLabel(modal, 'Emissão do CIN') || lerCampoPorLabel(modal, 'Emissão CIN');
    d['CPF'] = lerCampoPorLabel(modal, 'CPF');
    d['Documento Civil RG'] = lerCampoPorLabel(modal, 'RG') || lerCampoPorLabel(modal, 'Documento Civil');
    d['Data Emissão RG/RNM'] = lerCampoPorLabel(modal, 'Emissão RG') || lerCampoPorLabel(modal, 'Data Emissão');
    d['Data de emissão'] = lerCampoPorLabel(modal, 'Data de emissão');
    d['Cert. Matr.'] = lerCampoPorLabel(modal, 'Cert') || lerCampoPorLabel(modal, 'Certidão');
    d['NIS'] = lerCampoPorLabel(modal, 'NIS');
    d['Cartão Nacional de Saúde - SUS'] = lerCampoPorLabel(modal, 'SUS') || lerCampoPorLabel(modal, 'Saúde');

    return d;
  }

  // ========================
  // EXTRAIR ABA "DEFICIÊNCIA"
  // ========================

  async function extrairDeficiencia(modal) {
    await clicarAba(modal, 'Deficiência');
    const d = {};

    d['Investigação de deficiência'] = lerCheckboxPorLabel(modal, 'Investigação') ? 'Sim' : 'Não';
    d['Estudante com Deficiência'] = lerCheckboxPorLabel(modal, 'Deficiência') ? 'Sim' : 'Não';
    d['Altas Habilidades/Superdotação'] = lerCheckboxPorLabel(modal, 'Altas Habilidades') ? 'Sim' : 'Não';
    d['Laudo Médico'] = lerCheckboxPorLabel(modal, 'Laudo') ? 'Sim' : 'Não';
    d['Nível de Apoio'] = lerCampoPorLabel(modal, 'Nível de Apoio') || '1';
    d['Necessita de Profissional de apoio Escolar?'] = lerCheckboxPorLabel(modal, 'Profissional de apoio') ? 'Sim' : 'Não';
    d['Mobilidade Reduzida'] = lerCheckboxPorLabel(modal, 'Mobilidade') ? 'Sim' : 'Não';
    d['Recursos Necessários para a Participação do Aluno em Avaliações'] = lerCampoPorLabel(modal, 'Recursos') || '';

    return d;
  }

  // ========================
  // EXTRAIR ABA "ENDEREÇO RESIDENCIAL"
  // ========================

  async function extrairEndereco(modal) {
    await clicarAba(modal, 'Endereço Residencial');
    const d = {};

    d['CEP'] = lerCampoPorLabel(modal, 'CEP');
    d['Localização/Zona de Residência'] = lerCampoPorLabel(modal, 'Localização') || lerCampoPorLabel(modal, 'Zona');
    d['Localização Diferenciada'] = lerCampoPorLabel(modal, 'Diferenciada') || 'Não está em área de localização diferenciada';
    d['Endereço - Nº'] = lerCampoPorLabel(modal, 'Endereço') || lerCampoPorLabel(modal, 'Logradouro');
    d['EnderecoNR'] = lerCampoPorLabel(modal, 'Número') || lerCampoPorLabel(modal, 'Nº');
    d['Complemento'] = lerCampoPorLabel(modal, 'Complemento');
    d['Bairro'] = lerCampoPorLabel(modal, 'Bairro');
    d['Cidade - UF'] = lerCampoPorLabel(modal, 'Cidade') || lerCampoPorLabel(modal, 'Município');
    d['Latitude/Longitude'] = lerCampoPorLabel(modal, 'Latitude');
    d['Longitude'] = lerCampoPorLabel(modal, 'Longitude');

    return d;
  }

  // ========================
  // EXTRAIR ABA "TELEFONES"
  // ========================
  // Tabela: Tipo Telefone | DDD | Número | Complemento
  // Seção "Outros Contatos": Tipo de Vínculo | Nome Completo | Telefone | Tipo de Telefone | SMS | Email

  async function extrairTelefones(modal) {
    await clicarAba(modal, 'Telefones');

    const telefones = [];

    // Tabela principal de telefones
    const tabelas = modal.querySelectorAll('table');
    for (const tabela of tabelas) {
      const headers = Array.from(tabela.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
      const hasPhone = headers.some(h => h.includes('tipo telefone') || h.includes('ddd') || h.includes('número'));

      if (hasPhone) {
        const rows = tabela.querySelectorAll('tbody tr');
        rows.forEach(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
          if (cells.length >= 3) {
            // Colunas: Tipo Telefone | DDD | Número | Complemento
            const tipo = cells[0] || 'Celular';
            const ddd = cells[1] || '';
            const numero = cells[2] || '';
            if (numero && /\d/.test(numero)) {
              const tel = ddd ? `(${ddd}) ${numero}` : numero;
              telefones.push(`${tipo}: ${tel}`);
            }
          }
        });
      }
    }

    // Seção "Outros Contatos"
    const headings = modal.querySelectorAll('h1, h2, h3, h4, h5, strong, b');
    for (const h of headings) {
      if (h.textContent.trim().toLowerCase().includes('outros contatos')) {
        // Encontrar a tabela de Outros Contatos
        let el = h.nextElementSibling;
        while (el && el.tagName !== 'TABLE') {
          el = el.nextElementSibling;
        }
        if (!el) {
          // Tentar pelo parent
          el = h.parentElement;
          while (el && !el.querySelector('table:last-of-type')) {
            el = el.parentElement;
          }
          if (el) el = el.querySelector('table:last-of-type');
        }
        if (el && el.tagName === 'TABLE') {
          const rows = el.querySelectorAll('tbody tr');
          rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
            if (cells.length >= 3) {
              // Tipo Vínculo | Nome Completo | Telefone | Tipo de Telefone | SMS | Email
              const vinculo = cells[0] || '';
              const nomeContato = cells[1] || '';
              const tel = cells[2] || '';
              const tipoTel = cells[3] || '';
              if (tel && /\d/.test(tel)) {
                telefones.push(`${tipoTel || 'Contato'}: ${tel} - ${vinculo} ${nomeContato}`.trim());
              }
            }
          });
        }
      }
    }

    return telefones.join(' | ');
  }

  // ========================
  // MONTAR OBJETO CSV
  // ========================

  function montarLinhaCSV(serieAno, numero, dadosLista, dadosPessoais, docsDados, defDados, endDados, telefonesStr) {
    const nome = dadosPessoais['Nome'] || dadosLista.nome;
    const dataNasc = dadosPessoais['Data de Nascimento'] || dadosLista.dataNasc;
    const raNum = dadosPessoais['RA'] || dadosLista.ra;
    const raDig = dadosPessoais['nrDigRa'] || dadosLista.digRa;
    const raUf = dadosPessoais['sgUfRa'] || dadosLista.ufRa || 'SP';
    const filiacao1 = dadosPessoais['Filiação 1'] || dadosLista.filiacao1;

    // Calcular idade
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
      'Data de Alteração': dadosPessoais['Data de Alteração'] || '',
      'Nome': nome,
      'Informar Nome Social?': dadosPessoais['Informar Nome Social?'] || 'Não',
      'Informar Nome Afetivo?': dadosPessoais['Informar Nome Afetivo?'] || 'Não',
      'Sexo': dadosPessoais['Sexo'] || '',
      'Raça/Cor': dadosPessoais['Raça/Cor'] || '',
      'Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem':
        dadosPessoais['Aluno com transtorno(s) que impacta(m) o desenvolvimento da aprendizagem'] || 'Não',
      'Idade Mínima Especial': dadosPessoais['Idade Mínima Especial'] || 'Não',
      'Data de Nascimento': dataNasc,
      'Falecimento': dadosPessoais['Falecimento'] || 'Não',
      'Refugiado': dadosPessoais['Refugiado'] || 'Não',
      'Emancipado': dadosPessoais['Emancipado'] || 'Não',
      'Irmão(s)': dadosPessoais['Irmão(s)'] || '0',
      'E-Mail Google': dadosPessoais['E-Mail Google'] || '',
      'E-Mail Microsoft': dadosPessoais['E-Mail Microsoft'] || '',
      'Filiação 1': filiacao1,
      'Filiação 2': dadosPessoais['Filiação 2'] || '',
      'Participa do Programa Bolsa Família': dadosPessoais['Participa do Programa Bolsa Família'] || 'Não',
      'RA': raNum,
      'Identificação Única - Educacenso': dadosPessoais['Identificação Única - Educacenso'] || '',
      'Nacionalidade': dadosPessoais['Nacionalidade'] || 'Brasileira',
      'Município de Nascimento': dadosPessoais['Município de Nascimento'] || '',
      'Sigilo': dadosPessoais['Sigilo'] || 'Não',
      'Quilombola': dadosPessoais['Quilombola'] || 'Não',
      'Membro de Comunidade Circense e/ou Cigana':
        dadosPessoais['Membro de Comunidade Circense e/ou Cigana'] || 'Não',
      'Possui internet em casa': dadosPessoais['Possui internet em casa'] || 'Não',
      'Possui smartphone, tablet ou notebook pessoal':
        dadosPessoais['Possui smartphone, tablet ou notebook pessoal'] || 'Não',
      'Carteira de Identidade Nacional (CIN)': docsDados['Carteira de Identidade Nacional (CIN)'] || 'Não',
      'CPF': docsDados['CPF'] || '',
      'Documento Civil RG': docsDados['Documento Civil RG'] || '',
      'Data Emissão RG/RNM': docsDados['Data Emissão RG/RNM'] || '',
      'Data de emissão': docsDados['Data de emissão'] || '',
      'Cert. Matr.': docsDados['Cert. Matr.'] || '',
      'Investigação de deficiência': defDados['Investigação de deficiência'] || 'Não',
      'Estudante com Deficiência': defDados['Estudante com Deficiência'] || 'Não',
      'Altas Habilidades/Superdotação': defDados['Altas Habilidades/Superdotação'] || 'Não',
      'Laudo Médico': defDados['Laudo Médico'] || 'Não',
      'Nível de Apoio': defDados['Nível de Apoio'] || '1',
      'Necessita de Profissional de apoio Escolar?': defDados['Necessita de Profissional de apoio Escolar?'] || 'Não',
      'Mobilidade Reduzida': defDados['Mobilidade Reduzida'] || 'Não',
      'CEP': endDados['CEP'] || '',
      'Localização/Zona de Residência': endDados['Localização/Zona de Residência'] || 'Urbana',
      'Localização Diferenciada': endDados['Localização Diferenciada'] || 'Não está em área de localização diferenciada',
      'Endereço - Nº': endDados['Endereço - Nº'] || '',
      'Complemento': endDados['Complemento'] || '',
      'Bairro': endDados['Bairro'] || '',
      'Cidade - UF': endDados['Cidade - UF'] || '',
      'Latitude/Longitude': endDados['Latitude/Longitude'] || '',
      'Mostrar102550100registros': '10',
      'Idade': idade,
      'nrDigRa': raDig,
      'sgUfRa': raUf,
      'DigRgAluno': '',
      'EnderecoNR': endDados['EnderecoNR'] || '',
      'Longitude': endDados['Longitude'] || '',
      'telefones_formatados': telefonesStr,
      'Recursos Necessários para a Participação do Aluno em Avaliações':
        defDados['Recursos Necessários para a Participação do Aluno em Avaliações'] || '',
      'NIS': docsDados['NIS'] || '',
      'Cartão Nacional de Saúde - SUS': docsDados['Cartão Nacional de Saúde - SUS'] || '',
      'Tipo Sanguíneo': dadosPessoais['Tipo Sanguíneo'] || '',
      'UFNascimento': dadosPessoais['UFNascimento'] || '',
      'Data Emissão do CIN': docsDados['Data Emissão do CIN'] || '',
      'E-Mail': dadosPessoais['E-Mail'] || '',
    };
  }

  // ========================
  // FECHAR MODAL
  // ========================

  async function fecharModal() {
    // Botão × no canto superior direito
    const closeBtn = document.querySelector(
      '.modal.in .close, .modal.show .close, .modal[style*="display: block"] .close'
    );
    if (closeBtn) {
      closeBtn.click();
      await waitForModalClose();
      await sleep(500);
      return;
    }
    // Botão "Voltar"
    const allBtns = document.querySelectorAll('.modal.in a, .modal.in button, .modal.show a, .modal.show button');
    for (const btn of allBtns) {
      if (btn.textContent.trim().includes('Voltar')) {
        btn.click();
        await waitForModalClose();
        await sleep(500);
        return;
      }
    }
    // Tecla Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(1000);
  }

  // ========================
  // PAGINAÇÃO (DataTables)
  // ========================

  function getProximaPagina() {
    const paginacao = document.querySelectorAll('.dataTables_paginate a, .paginate_button, .pagination a, .pagination li a');
    for (const btn of paginacao) {
      const text = btn.textContent.trim().toLowerCase();
      if ((text === 'seguinte' || text === 'next' || text === '›') &&
          !btn.parentElement?.classList?.contains('disabled') &&
          !btn.classList.contains('disabled')) {
        return btn;
      }
    }
    return null;
  }

  function getTotalRegistros() {
    // Texto "Registros 1 a 10 de 42"
    const info = document.querySelector('.dataTables_info, [class*="info"]');
    if (info) {
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
    sendLog(`Iniciando extração... Total de registros: ${totalRegistros || '?'}`);

    const todosAlunos = [];
    let erros = 0;
    let numeroGlobal = 0;
    let paginaAtual = 1;

    // Loop por todas as páginas da DataTable
    while (!shouldStop) {
      sendLog(`Processando página ${paginaAtual}...`);
      await sleep(800);

      const alunosDaPagina = coletarDadosTabela();
      if (alunosDaPagina.length === 0) {
        sendLog('Nenhum aluno encontrado nesta página', 'error');
        break;
      }

      sendLog(`${alunosDaPagina.length} alunos na página ${paginaAtual}`);

      for (let i = 0; i < alunosDaPagina.length; i++) {
        if (shouldStop) break;

        const aluno = alunosDaPagina[i];
        numeroGlobal++;

        sendProgress(numeroGlobal, totalRegistros || numeroGlobal, aluno.nome);

        try {
          if (!aluno.btnVisualizar) {
            sendLog(`Sem botão Visualizar para ${aluno.nome}`, 'warn');
            const row = montarLinhaCSV(serieAno, numeroGlobal, aluno, {}, {}, {}, {}, '');
            todosAlunos.push(row);
            continue;
          }

          // Clicar no Visualizar (lupa Q)
          aluno.btnVisualizar.click();
          await sleep(delayMs);

          // Esperar modal abrir
          let modal;
          try {
            modal = await waitForModal(8000);
          } catch (e) {
            sendLog(`Modal não abriu para ${aluno.nome}`, 'error');
            erros++;
            sendError(`${aluno.nome}: Modal não abriu`);
            continue;
          }

          // Extrair dados de cada aba
          const dadosPessoais = await extrairDadosPessoais(modal);
          const docsDados = await extrairDocumentos(modal);
          const defDados = await extrairDeficiencia(modal);
          const endDados = await extrairEndereco(modal);
          const telefonesStr = await extrairTelefones(modal);

          const row = montarLinhaCSV(serieAno, numeroGlobal, aluno, dadosPessoais, docsDados, defDados, endDados, telefonesStr);
          todosAlunos.push(row);

          // Fechar modal
          await fecharModal();
          await sleep(500);

        } catch (err) {
          erros++;
          sendError(`${aluno.nome}: ${err.message}`);
          sendLog(`Erro em ${aluno.nome}: ${err.message}`, 'error');
          try { await fecharModal(); } catch (e) { /* ignore */ }
          await sleep(500);
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
        await sleep(2000);
      } else {
        break;
      }
    }

    running = false;
    await chrome.storage.local.set({ sed_alunos: todosAlunos, sed_erros: erros, sed_running: false });
    sendComplete(todosAlunos.length);
    sendLog(`Extração finalizada! ${todosAlunos.length} alunos extraídos, ${erros} erros.`, 'success');
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

  console.log('[SED Extrator] Content script carregado na página do SED ✓');

})();
