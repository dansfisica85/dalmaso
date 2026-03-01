# Dalmaso - Busca Ativa

Sistema de gestão de alunos e controle de frequência escolar com dashboard de gráficos interativos e banco de dados Turso.

## Funcionalidades

- **Dashboard**: Painel com 8 gráficos interativos (Plotly.js) — distribuição por turma, sexo, raça/cor, faixa etária, Bolsa Família, indicadores educacionais, frequência ao longo do tempo e frequência por turma
- **Turmas**: Cadastro e gerenciamento de turmas com cards visuais
- **Alunos**: Cadastro completo (50+ campos do SED), busca, filtro por turma, visualização detalhada e edição via modal
- **Frequência**: Chamada diária por turma com checkboxes, seleção de data e marcação em lote
- **Relatórios**: Frequência mensal (tabela + gráfico de barras) e perfil da turma (gráficos de sexo, raça, indicadores e histograma de idade)
- **Importar XLSX/CSV**: Upload de planilhas exportadas do SED (74 colunas) com mapeamento automático e upsert por RA

## Tecnologias

- **Backend**: Python / Flask (serverless na Vercel)
- **Banco de dados**: Turso (libSQL) com fallback para SQLite local
- **Frontend**: Bootstrap 5 + Plotly.js + JavaScript vanilla
- **Processamento**: Pandas + openpyxl para importação de dados
- **Extensão Chrome**: Extração automática de dados do SED (em `extensao-chrome-sed/`)

## Como rodar localmente

```bash
# 1. Crie um ambiente virtual (opcional, recomendado)
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate  # Linux/Mac

# 2. Instale as dependências
pip install -r requirements.txt

# 3. Configure o .env
# TURSO_DATABASE_URL=libsql://dalmaso-dansfisica85.aws-us-east-2.turso.io
# TURSO_AUTH_TOKEN=seu_token

# 4. Inicie o servidor
python api/index.py
```

O site estará disponível em `http://localhost:5000`

## Deploy na Vercel

1. Conecte o repositório no [vercel.com](https://vercel.com)
2. Adicione as variáveis de ambiente no painel da Vercel:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
3. O deploy é automático a cada push na branch `main`

## Estrutura do Banco

- **turmas**: id, nome, descricao, criado_em
- **alunos**: id, turma_id, ra, nome_aluno, data_nascimento, sexo, raca_cor, cpf, nis, filiacao1, filiacao2, telefones, email, cep, endereco, numero, complemento, bairro, municipio, uf, escola_origem, bolsa_familia, pcd, situacao, data_matricula, numero_chamada + mais 20 campos do SED + dados_json (campos extras)
- **frequencia**: id, aluno_id, turma_id, data, dia_semana, presente, observacao (UNIQUE aluno_id+data)

## Formato do arquivo para importação

O sistema aceita arquivos `.xlsx` e `.csv` exportados do SED. O mapeamento automático reconhece 74 colunas, incluindo:

| Coluna Excel | Campo no banco |
|-------------|---------------|
| Nome do Aluno | nome_aluno |
| RA | ra |
| Data de Nascimento | data_nascimento |
| Sexo | sexo |
| Raça/Cor | raca_cor |
| Bolsa Família | bolsa_familia |
| PcD | pcd |
| ... | ... (74 colunas mapeadas) |

A turma é criada automaticamente com base no nome do arquivo ou na coluna "Turma/Classe".

## Extensão Chrome (SED)

A pasta `extensao-chrome-sed/` contém uma extensão para Google Chrome que extrai dados dos alunos diretamente do sistema SED da Secretaria de Educação de SP. Consulte o [README da extensão](extensao-chrome-sed/README.md) para instruções de instalação e uso.
