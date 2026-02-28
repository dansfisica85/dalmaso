# Extensão Chrome - Extrator SED

Extensão para Google Chrome que extrai dados dos alunos do sistema **SED** (Secretaria da Educação do Estado de São Paulo) e exporta como arquivo CSV no formato compatível com o sistema de gestão escolar.

## Funcionalidades

- Acessa a página de Ficha do Aluno no SED
- Clica automaticamente na lupa de cada aluno
- Coleta todos os dados pessoais (nome, RA, CPF, endereço, filiação, etc.)
- Acessa a aba de Telefones e coleta os contatos
- Exporta tudo como CSV com separador `;` (ponto e vírgula)
- Formato idêntico ao arquivo `6A.csv` usado no sistema principal

## Instalação

1. Abra o Chrome e acesse `chrome://extensions/`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `extensao-chrome-sed`
5. A extensão aparecerá na barra de extensões do Chrome

## Como Usar

1. Acesse o SED: `https://sed.educacao.sp.gov.br`
2. Faça login com suas credenciais
3. Navegue até **NCA → Ficha do Aluno** (`NCA/FichaAluno/Index`)
4. Selecione a turma desejada para que a lista de alunos apareça
5. Clique no ícone da extensão na barra do Chrome
6. Preencha a **Série/Ano** (ex: `6A`, `7B`)
7. Ajuste o **delay** se necessário (padrão: 2000ms)
8. Clique em **Iniciar Extração**
9. Aguarde a extração de todos os alunos
10. Clique em **Baixar CSV** quando concluir

## Estrutura do CSV

O arquivo exportado contém **74+ colunas** incluindo:

| Campo | Descrição |
|-------|-----------|
| série/ano | Turma (ex: 6A) |
| nome | Nome completo do aluno |
| RA | Registro do Aluno |
| CPF | CPF do aluno |
| Data de Nascimento | Data de nascimento |
| Filiação 1 / Filiação 2 | Nome dos responsáveis |
| CEP | CEP residencial |
| Endereço | Endereço completo |
| telefones_formatados | Telefones concatenados |
| Sexo, Raça/Cor | Dados demográficos |
| ... e muitos outros | |

## Observações

- A extensão **não armazena** dados externamente. Tudo fica local no navegador.
- É necessário estar **logado no SED** antes de usar.
- O delay entre alunos pode ser ajustado para evitar sobrecarga no servidor.
- Se a extração for interrompida, os dados parciais são salvos automaticamente.
- A extensão é para uso exclusivo em ambiente educacional autorizado.

## Estrutura de Arquivos

```
extensao-chrome-sed/
├── manifest.json       # Configuração da extensão (Manifest V3)
├── popup.html          # Interface do popup
├── popup.js            # Lógica do popup + download CSV
├── content.js          # Script de extração (roda no SED)
├── content-style.css   # Estilos visuais durante extração
└── README.md           # Este arquivo
```

## Solução de Problemas

- **"Nenhum aluno encontrado"**: Verifique se a lista de alunos está visível na página antes de iniciar.
- **Modal não fecha**: Aumente o delay nas configurações.
- **Dados incompletos**: O SED pode ter campos em formatos diferentes dependendo da escola. Revise manualmente campos ausentes.
