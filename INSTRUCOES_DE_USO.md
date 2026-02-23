# 📋 Extrator SED - Dados de Alunos

Ferramenta para extrair automaticamente dados pessoais e telefones de todos os alunos do sistema **SED (Secretaria Escolar Digital)**.

## Funcionalidades

- ✅ Extrai dados pessoais (RA, Filiação, E-mail, Nacionalidade, etc.)
- ✅ Extrai telefones de cada aluno
- ✅ Navega automaticamente por todas as páginas
- ✅ Barra de progresso visual
- ✅ Botões de **Pausar / Continuar / Parar**
- ✅ Salvamento automático a cada 10 alunos (proteção contra falhas)
- ✅ Exportação em **CSV** (abre no Excel) e **JSON**
- ✅ Suporta mais de 1000 alunos

---

## 🔵 OPÇÃO 1: Extensão Chrome (Recomendada)

### Instalação

1. Baixe a pasta `extensao-chrome/` para seu computador
2. Abra o Chrome e vá para: **chrome://extensions/**
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **"Carregar sem compactação"**
5. Selecione a pasta `extensao-chrome/`
6. Pronto! A extensão está instalada

### Como usar

1. Acesse o **SED** e vá até a tela de **Ficha do Aluno** (lista de alunos)
2. O painel azul **"📋 Extrator SED"** aparecerá automaticamente no canto superior direito
3. Ajuste os delays se necessário (para internet lenta, aumente os valores)
4. Clique em **▶ INICIAR EXTRAÇÃO**
5. Acompanhe o progresso na barra e no log
6. Use **⏸ Pausar** se precisar parar temporariamente
7. Quando terminar, clique em **📥 Baixar CSV (Excel)**

---

## 🟢 OPÇÃO 2: Tampermonkey (Mais fácil de instalar)

### Instalação

1. Instale a extensão **Tampermonkey** no Chrome:
   - Vá em: https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo
   - Clique em **"Usar no Chrome"** → **"Adicionar extensão"**

2. Após instalar o Tampermonkey:
   - Clique no ícone do Tampermonkey na barra do Chrome
   - Clique em **"Criar um novo script..."**
   - **Apague tudo** que aparecer no editor
   - Abra o arquivo `tampermonkey-extrator-sed.user.js` com o Bloco de Notas
   - **Copie todo o conteúdo** (Ctrl+A, Ctrl+C)
   - **Cole** no editor do Tampermonkey (Ctrl+V)
   - Clique em **Ctrl+S** para salvar (ou File → Save)

3. Acesse o SED e o painel aparecerá automaticamente!

---

## ⚙️ Configurações

| Configuração     | Padrão | Descrição |
|------------------|--------|-----------|
| Delay ações (ms) | 2000   | Tempo entre cada ação (clicar aba, ler dados). Aumente se a internet for lenta. |
| Delay modal (ms) | 3000   | Tempo para esperar o modal carregar. Aumente se os dados demorarem a aparecer. |

### Dicas para 1200 alunos:

- **Internet rápida**: delay ações = 1500ms, delay modal = 2500ms
- **Internet normal**: delay ações = 2000ms, delay modal = 3000ms (padrão)
- **Internet lenta**: delay ações = 3000ms, delay modal = 5000ms
- O processo pode levar **1 a 3 horas** para 1200 alunos
- Você pode **pausar e continuar** a qualquer momento
- Os dados são **salvos automaticamente** a cada 10 alunos

---

## 📥 Saída

### CSV (Excel)
- Arquivo `.csv` com separador `;` (ponto e vírgula)
- Codificação UTF-8 com BOM (caracteres especiais corretos)
- Para abrir no Excel: clicar duas vezes no arquivo

### JSON
- Arquivo `.json` com todos os dados estruturados
- Útil para importação em outros sistemas

---

## 🔧 Solução de Problemas

| Problema | Solução |
|----------|---------|
| Painel não aparece | Verifique se está na URL correta do SED (sed.educacao.sp.gov.br) |
| Erros frequentes | Aumente os delays nas configurações |
| Modal não fecha | O script tenta fechar automaticamente; se travar, pause e feche manualmente |
| Dados incompletos | Alguns campos podem estar vazios no sistema SED |
| CSV com caracteres estranhos | Abra pelo Excel > Dados > De texto/CSV, selecione UTF-8 |

---

## 📁 Estrutura de Arquivos

```
extensao-chrome/          ← Extensão Chrome
  ├── manifest.json       ← Configuração da extensão
  ├── content.js          ← Lógica de extração
  ├── style.css           ← Visual do painel
  ├── icon48.png          ← Ícone pequeno
  └── icon128.png         ← Ícone grande

tampermonkey-extrator-sed.user.js  ← Script Tampermonkey (alternativa)
```
