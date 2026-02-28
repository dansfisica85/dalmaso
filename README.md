# Dalmaso - Busca Ativa

Sistema de gestão de alunos e controle de frequência escolar com banco de dados Turso.

## Funcionalidades

- **Turmas**: Cadastro e gerenciamento de turmas
- **Alunos**: Cadastro, edição e exclusão ilimitada de alunos
- **Chamada**: Chamada diária por turma com seleção de dia da semana (Presente/Falta)
- **Relatórios**: Visualização de frequência filtrável por turma, mês e ano
- **Importar CSV/XLSX**: Upload de arquivos para adicionar turmas inteiras de uma vez
- **Exportar**: Download de dados em formato CSV

## Tecnologias

- **Backend**: Node.js + Express
- **Banco de dados**: Turso (libSQL)
- **Frontend**: HTML, CSS, JavaScript puro
- **Upload**: Multer + csv-parse + xlsx

## Como rodar

```bash
# 1. Instale as dependências
npm install

# 2. Configure o .env (já incluído)
# TURSO_DATABASE_URL=libsql://dalmaso-dansfisica85.aws-us-east-2.turso.io
# TURSO_AUTH_TOKEN=seu_token
# PORT=3000

# 3. Inicie o servidor
npm start
```

O site estará disponível em `http://localhost:3000`

## Estrutura do Banco

- **turmas**: id, nome, descricao
- **alunos**: id, nome, matricula, turma_id, ativo
- **frequencia**: id, aluno_id, turma_id, data, dia_semana, presente, observacao

## Formato do CSV para importação

O arquivo CSV deve conter ao menos uma coluna com o nome do aluno. Colunas reconhecidas automaticamente:

| Coluna | Alternativas aceitas |
|--------|---------------------|
| Nome   | nome, aluno, estudante, name |
| Matrícula | matricula, registro, ra, codigo |

Exemplo:
```csv
nome,matricula
João da Silva,2026001
Maria Santos,2026002
```
