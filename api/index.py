# ============================================================
# BACKEND FLASK — Sistema de Gestão Escolar (DALMASO)
# ============================================================
# Deploy: Vercel (Python Serverless)
# Banco: Turso (libSQL) via libsql-experimental
# Gráficos: dados processados com Pandas, renderizados no front com Plotly.js
# ============================================================

import os
import io
import json
import math
import csv
import re
import httpx
from datetime import datetime, date, timedelta
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS

# ── Banco de Dados ──────────────────────────────────────────
try:
    import libsql_experimental as libsql
    # Só usa Turso se as credenciais estiverem configuradas
    USE_TURSO = bool(os.environ.get("TURSO_DATABASE_URL", "").strip())
except ImportError:
    import sqlite3
    USE_TURSO = False

if not USE_TURSO:
    import sqlite3

import pandas as pd

app = Flask(__name__)
CORS(app)

_dir = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.normpath(os.path.join(_dir, '..'))

# ============================================================
# CONEXÃO COM O BANCO
# ============================================================

def get_db():
    """Retorna conexão com Turso (produção) ou SQLite local (dev)."""
    if USE_TURSO:
        url = os.environ.get("TURSO_DATABASE_URL", "")
        token = os.environ.get("TURSO_AUTH_TOKEN", "")
        conn = libsql.connect(url, auth_token=token)
        return conn
    else:
        conn = sqlite3.connect("local.db")
        conn.row_factory = sqlite3.Row
        return conn


def query(sql, params=None):
    """SELECT → retorna lista de dicts."""
    conn = get_db()
    try:
        cursor = conn.execute(sql, tuple(params or []))
        if cursor.description:
            cols = [d[0] for d in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]
        return []
    finally:
        try:
            conn.close()
        except Exception:
            pass


def execute(sql, params=None):
    """INSERT / UPDATE / DELETE → retorna lastrowid."""
    conn = get_db()
    try:
        cursor = conn.execute(sql, tuple(params or []))
        conn.commit()
        return cursor.lastrowid
    finally:
        try:
            conn.close()
        except Exception:
            pass


def execute_many(statements):
    """Executa múltiplas instruções em uma transação."""
    conn = get_db()
    try:
        for sql, params in statements:
            conn.execute(sql, tuple(params or []))
        conn.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ============================================================
# SCHEMA DO BANCO
# ============================================================

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS turmas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE,
        descricao TEXT,
        criado_em TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS alunos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turma_id INTEGER,
        numero_chamada TEXT,
        nome TEXT NOT NULL,
        ra TEXT,
        dig_ra TEXT,
        uf_ra TEXT DEFAULT 'SP',
        data_nascimento TEXT,
        sexo TEXT,
        raca_cor TEXT,
        nacionalidade TEXT,
        municipio_nascimento TEXT,
        uf_nascimento TEXT,
        cpf TEXT,
        rg TEXT,
        nis TEXT,
        sus TEXT,
        cin TEXT,
        filiacao_1 TEXT,
        filiacao_2 TEXT,
        email TEXT,
        email_google TEXT,
        email_microsoft TEXT,
        telefones TEXT,
        cep TEXT,
        endereco TEXT,
        numero_endereco TEXT,
        complemento TEXT,
        bairro TEXT,
        cidade_uf TEXT,
        bolsa_familia TEXT DEFAULT 'Não',
        deficiencia TEXT DEFAULT 'Não',
        laudo_medico TEXT DEFAULT 'Não',
        mobilidade_reduzida TEXT DEFAULT 'Não',
        nivel_apoio TEXT,
        profissional_apoio TEXT DEFAULT 'Não',
        altas_habilidades TEXT DEFAULT 'Não',
        investigacao_deficiencia TEXT DEFAULT 'Não',
        internet_em_casa TEXT DEFAULT 'Não',
        smartphone TEXT DEFAULT 'Não',
        quilombola TEXT DEFAULT 'Não',
        refugiado TEXT DEFAULT 'Não',
        sigilo TEXT DEFAULT 'Não',
        falecimento TEXT DEFAULT 'Não',
        emancipado TEXT DEFAULT 'Não',
        nome_social TEXT DEFAULT 'Não',
        nome_afetivo TEXT DEFAULT 'Não',
        tipo_sanguineo TEXT,
        recursos_avaliacao TEXT,
        dados_json TEXT,
        ativo INTEGER DEFAULT 1,
        criado_em TEXT DEFAULT (datetime('now')),
        atualizado_em TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE SET NULL
    )""",
    """CREATE TABLE IF NOT EXISTS frequencia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aluno_id INTEGER NOT NULL,
        turma_id INTEGER NOT NULL,
        data TEXT NOT NULL,
        dia_semana TEXT NOT NULL,
        presente INTEGER NOT NULL DEFAULT 1,
        observacao TEXT,
        criado_em TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
        FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE,
        UNIQUE(aluno_id, data)
    )""",
]


def init_db():
    conn = get_db()
    try:
        for stmt in SCHEMA:
            conn.execute(stmt)
        conn.commit()
    except Exception as e:
        print(f"[init_db] Erro: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


# Inicializar banco na primeira carga
init_db()


# ============================================================
# HELPERS
# ============================================================

DIAS_SEMANA = {
    0: 'Segunda-feira',
    1: 'Terça-feira',
    2: 'Quarta-feira',
    3: 'Quinta-feira',
    4: 'Sexta-feira',
    5: 'Sábado',
    6: 'Domingo',
}


def calcular_idade(data_nasc_str):
    """Calcula a idade a partir de dd/mm/aaaa."""
    if not data_nasc_str:
        return None
    try:
        parts = data_nasc_str.split('/')
        if len(parts) == 3:
            birth = date(int(parts[2]), int(parts[1]), int(parts[0]))
            today = date.today()
            age = today.year - birth.year
            if (today.month, today.day) < (birth.month, birth.day):
                age -= 1
            return age
    except (ValueError, IndexError):
        pass
    return None


def safe_val(val):
    """Converte NaN/None para string vazia."""
    if val is None:
        return ''
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return ''
    return str(val).strip()


# Mapeamento: coluna do Excel/CSV → coluna do banco
EXCEL_TO_DB = {
    'série/ano':       '_serie_ano',      # especial: define a turma
    'numero_linha':    'numero_chamada',
    'Nome':            'nome',
    'nome':            'nome',
    'RA':              'ra',
    'ra_lista':        'ra',
    'nrDigRa':         'dig_ra',
    'sgUfRa':          'uf_ra',
    'Data de Nascimento': 'data_nascimento',
    'data_nasc_lista': 'data_nascimento',
    'data_nascimento_cabecalho': 'data_nascimento',
    'Sexo':            'sexo',
    'Raça/Cor':        'raca_cor',
    'Nacionalidade':   'nacionalidade',
    'Município de Nascimento': 'municipio_nascimento',
    'UFNascimento':    'uf_nascimento',
    'CPF':             'cpf',
    'Documento Civil RG': 'rg',
    'NIS':             'nis',
    'Cartão Nacional de Saúde - SUS': 'sus',
    'Carteira de Identidade Nacional (CIN)': 'cin',
    'Filiação 1':      'filiacao_1',
    'Filiação 2':      'filiacao_2',
    'E-Mail':          'email',
    'E-Mail Google':   'email_google',
    'E-Mail Microsoft': 'email_microsoft',
    'telefones_formatados': 'telefones',
    'CEP':             'cep',
    'Endereço - Nº':   'endereco',
    'EnderecoNR':      'numero_endereco',
    'Complemento':     'complemento',
    'Bairro':          'bairro',
    'Cidade - UF':     'cidade_uf',
    'Participa do Programa Bolsa Família': 'bolsa_familia',
    'Estudante com Deficiência': 'deficiencia',
    'Laudo Médico':    'laudo_medico',
    'Mobilidade Reduzida': 'mobilidade_reduzida',
    'Nível de Apoio':  'nivel_apoio',
    'Necessita de Profissional de apoio Escolar?': 'profissional_apoio',
    'Altas Habilidades/Superdotação': 'altas_habilidades',
    'Investigação de deficiência': 'investigacao_deficiencia',
    'Possui internet em casa': 'internet_em_casa',
    'Possui smartphone, tablet ou notebook pessoal': 'smartphone',
    'Quilombola':      'quilombola',
    'Refugiado':       'refugiado',
    'Sigilo':          'sigilo',
    'Falecimento':     'falecimento',
    'Emancipado':      'emancipado',
    'Informar Nome Social?': 'nome_social',
    'Informar Nome Afetivo?': 'nome_afetivo',
    'Tipo Sanguíneo':  'tipo_sanguineo',
    'Recursos Necessários para a Participação do Aluno em Avaliações': 'recursos_avaliacao',
}

# Colunas válidas na tabela alunos (para INSERT)
DB_COLUMNS = [
    'turma_id', 'numero_chamada', 'nome', 'ra', 'dig_ra', 'uf_ra',
    'data_nascimento', 'sexo', 'raca_cor', 'nacionalidade',
    'municipio_nascimento', 'uf_nascimento', 'cpf', 'rg', 'nis', 'sus', 'cin',
    'filiacao_1', 'filiacao_2', 'email', 'email_google', 'email_microsoft',
    'telefones', 'cep', 'endereco', 'numero_endereco', 'complemento',
    'bairro', 'cidade_uf', 'bolsa_familia', 'deficiencia', 'laudo_medico',
    'mobilidade_reduzida', 'nivel_apoio', 'profissional_apoio',
    'altas_habilidades', 'investigacao_deficiencia', 'internet_em_casa',
    'smartphone', 'quilombola', 'refugiado', 'sigilo', 'falecimento',
    'emancipado', 'nome_social', 'nome_afetivo', 'tipo_sanguineo',
    'recursos_avaliacao', 'dados_json',
]


# ============================================================
# ROTAS — TURMAS
# ============================================================

@app.route('/api/turmas', methods=['GET'])
def listar_turmas():
    turmas = query("""
        SELECT t.*,
               (SELECT COUNT(*) FROM alunos a WHERE a.turma_id = t.id AND a.ativo = 1) AS total_alunos
        FROM turmas t
        ORDER BY t.nome
    """)
    return jsonify(turmas)


@app.route('/api/turmas', methods=['POST'])
def criar_turma():
    data = request.get_json(force=True)
    nome = data.get('nome', '').strip()
    if not nome:
        return jsonify({'erro': 'Nome é obrigatório'}), 400
    try:
        tid = execute(
            "INSERT INTO turmas (nome, descricao) VALUES (?, ?)",
            [nome, data.get('descricao', '')]
        )
        return jsonify({'id': tid, 'nome': nome}), 201
    except Exception as e:
        return jsonify({'erro': f'Turma já existe ou erro: {e}'}), 409


@app.route('/api/turmas/<int:tid>', methods=['PUT'])
def atualizar_turma(tid):
    data = request.get_json(force=True)
    execute(
        "UPDATE turmas SET nome = ?, descricao = ? WHERE id = ?",
        [data.get('nome', ''), data.get('descricao', ''), tid]
    )
    return jsonify({'ok': True})


@app.route('/api/turmas/<int:tid>', methods=['DELETE'])
def deletar_turma(tid):
    execute("DELETE FROM frequencia WHERE turma_id = ?", [tid])
    execute("DELETE FROM alunos WHERE turma_id = ?", [tid])
    execute("DELETE FROM turmas WHERE id = ?", [tid])
    return jsonify({'ok': True})


# ============================================================
# ROTAS — ALUNOS
# ============================================================

@app.route('/api/alunos', methods=['GET'])
def listar_alunos():
    turma_id = request.args.get('turma_id')
    busca = request.args.get('busca', '').strip()

    sql = "SELECT * FROM alunos WHERE ativo = 1"
    params = []

    if turma_id:
        sql += " AND turma_id = ?"
        params.append(int(turma_id))
    if busca:
        sql += " AND (nome LIKE ? OR ra LIKE ? OR cpf LIKE ?)"
        like = f"%{busca}%"
        params.extend([like, like, like])

    sql += " ORDER BY nome"
    alunos = query(sql, params)

    # Calcular idade para cada aluno
    for a in alunos:
        a['idade'] = calcular_idade(a.get('data_nascimento', ''))

    return jsonify(alunos)


@app.route('/api/alunos/<int:aid>', methods=['GET'])
def obter_aluno(aid):
    rows = query("SELECT * FROM alunos WHERE id = ?", [aid])
    if not rows:
        return jsonify({'erro': 'Aluno não encontrado'}), 404
    aluno = rows[0]
    aluno['idade'] = calcular_idade(aluno.get('data_nascimento', ''))

    # Dados extras do JSON
    if aluno.get('dados_json'):
        try:
            aluno['dados_extras'] = json.loads(aluno['dados_json'])
        except (json.JSONDecodeError, TypeError):
            aluno['dados_extras'] = {}

    # Buscar turma
    if aluno.get('turma_id'):
        turmas = query("SELECT nome FROM turmas WHERE id = ?", [aluno['turma_id']])
        aluno['turma_nome'] = turmas[0]['nome'] if turmas else ''

    return jsonify(aluno)


@app.route('/api/alunos', methods=['POST'])
def criar_aluno():
    data = request.get_json(force=True)
    nome = data.get('nome', '').strip()
    if not nome:
        return jsonify({'erro': 'Nome é obrigatório'}), 400

    cols = ['nome']
    vals = [nome]
    for col in DB_COLUMNS:
        if col == 'nome' or col == 'dados_json':
            continue
        v = data.get(col)
        if v is not None:
            cols.append(col)
            vals.append(str(v))

    placeholders = ', '.join(['?'] * len(cols))
    col_names = ', '.join(cols)
    aid = execute(f"INSERT INTO alunos ({col_names}) VALUES ({placeholders})", vals)
    return jsonify({'id': aid, 'nome': nome}), 201


@app.route('/api/alunos/<int:aid>', methods=['PUT'])
def atualizar_aluno(aid):
    data = request.get_json(force=True)
    sets = []
    vals = []
    for col in DB_COLUMNS:
        if col == 'dados_json':
            continue
        v = data.get(col)
        if v is not None:
            sets.append(f"{col} = ?")
            vals.append(str(v))
    if not sets:
        return jsonify({'erro': 'Nenhum campo para atualizar'}), 400

    sets.append("atualizado_em = datetime('now')")
    vals.append(aid)
    execute(f"UPDATE alunos SET {', '.join(sets)} WHERE id = ?", vals)
    return jsonify({'ok': True})


@app.route('/api/alunos/<int:aid>', methods=['DELETE'])
def deletar_aluno(aid):
    execute("UPDATE alunos SET ativo = 0 WHERE id = ?", [aid])
    return jsonify({'ok': True})


# ============================================================
# ROTAS — FREQUÊNCIA
# ============================================================

@app.route('/api/frequencia', methods=['GET'])
def listar_frequencia():
    turma_id = request.args.get('turma_id')
    data_str = request.args.get('data')
    aluno_id = request.args.get('aluno_id')
    mes = request.args.get('mes')  # formato: YYYY-MM

    sql = """
        SELECT f.*, a.nome AS aluno_nome, a.ra
        FROM frequencia f
        JOIN alunos a ON a.id = f.aluno_id
        WHERE 1=1
    """
    params = []

    if turma_id:
        sql += " AND f.turma_id = ?"
        params.append(int(turma_id))
    if data_str:
        sql += " AND f.data = ?"
        params.append(data_str)
    if aluno_id:
        sql += " AND f.aluno_id = ?"
        params.append(int(aluno_id))
    if mes:
        sql += " AND f.data LIKE ?"
        params.append(f"{mes}%")

    sql += " ORDER BY f.data DESC, a.nome"
    return jsonify(query(sql, params))


@app.route('/api/frequencia', methods=['POST'])
def salvar_frequencia():
    """Salva frequência para uma turma em uma data."""
    data = request.get_json(force=True)
    turma_id = data.get('turma_id')
    data_str = data.get('data')  # YYYY-MM-DD
    registros = data.get('registros', [])  # [{aluno_id, presente, observacao}]

    if not turma_id or not data_str or not registros:
        return jsonify({'erro': 'turma_id, data e registros são obrigatórios'}), 400

    # Determinar dia da semana
    try:
        dt = datetime.strptime(data_str, '%Y-%m-%d')
        dia_semana = DIAS_SEMANA.get(dt.weekday(), '')
    except ValueError:
        dia_semana = ''

    stmts = []
    for reg in registros:
        aluno_id = reg.get('aluno_id')
        presente = 1 if reg.get('presente', True) else 0
        obs = reg.get('observacao', '')

        # Upsert - deletar existente e re-inserir
        stmts.append((
            "DELETE FROM frequencia WHERE aluno_id = ? AND data = ?",
            [aluno_id, data_str]
        ))
        stmts.append((
            """INSERT INTO frequencia (aluno_id, turma_id, data, dia_semana, presente, observacao)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [aluno_id, turma_id, data_str, dia_semana, presente, obs]
        ))

    execute_many(stmts)
    return jsonify({'ok': True, 'total': len(registros)})


@app.route('/api/frequencia/resumo', methods=['GET'])
def resumo_frequencia():
    """Resumo de frequência por turma/mês."""
    turma_id = request.args.get('turma_id')
    mes = request.args.get('mes')  # YYYY-MM

    sql = """
        SELECT
            a.id AS aluno_id,
            a.nome,
            a.ra,
            COUNT(f.id) AS total_dias,
            SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) AS presencas,
            SUM(CASE WHEN f.presente = 0 THEN 1 ELSE 0 END) AS faltas
        FROM alunos a
        LEFT JOIN frequencia f ON f.aluno_id = a.id
    """
    params = []
    wheres = ["a.ativo = 1"]

    if turma_id:
        wheres.append("a.turma_id = ?")
        params.append(int(turma_id))
    if mes:
        wheres.append("(f.data LIKE ? OR f.data IS NULL)")
        params.append(f"{mes}%")

    sql += " WHERE " + " AND ".join(wheres)
    sql += " GROUP BY a.id, a.nome, a.ra ORDER BY a.nome"

    rows = query(sql, params)
    for r in rows:
        total = r.get('total_dias', 0) or 0
        presencas = r.get('presencas', 0) or 0
        r['percentual'] = round((presencas / total * 100), 1) if total > 0 else 0

    return jsonify(rows)


@app.route('/api/frequencia/calendario', methods=['GET'])
def calendario_frequencia():
    """Dados de frequência para o calendário anual."""
    turma_id = request.args.get('turma_id')
    ano = request.args.get('ano', str(date.today().year))
    if not turma_id:
        return jsonify({'erro': 'turma_id é obrigatório'}), 400
    freq = query(
        """SELECT data,
                  COUNT(*) as total,
                  SUM(CASE WHEN presente = 1 THEN 1 ELSE 0 END) as presencas
           FROM frequencia
           WHERE turma_id = ? AND data LIKE ?
           GROUP BY data""",
        [int(turma_id), f"{ano}%"]
    )
    total_alunos = query(
        "SELECT COUNT(*) as n FROM alunos WHERE turma_id = ? AND ativo = 1",
        [int(turma_id)]
    )
    return jsonify({
        'total_alunos': total_alunos[0]['n'] if total_alunos else 0,
        'datas': {f['data']: {'total': f['total'], 'presencas': f['presencas']} for f in freq}
    })


# ============================================================
# ROTAS — DASHBOARD / GRÁFICOS
# ============================================================

@app.route('/api/dashboard', methods=['GET'])
def dashboard():
    """Dados agregados para gráficos do dashboard."""

    # Totais
    total_alunos = query("SELECT COUNT(*) AS n FROM alunos WHERE ativo = 1")[0]['n']
    total_turmas = query("SELECT COUNT(*) AS n FROM turmas")[0]['n']

    # Frequência geral
    freq_geral = query("""
        SELECT
            COUNT(*) AS total_registros,
            SUM(CASE WHEN presente = 1 THEN 1 ELSE 0 END) AS total_presencas
        FROM frequencia
    """)
    total_reg = freq_geral[0]['total_registros'] if freq_geral else 0
    total_pres = freq_geral[0]['total_presencas'] if freq_geral else 0
    perc_freq = round((total_pres / total_reg * 100), 1) if total_reg > 0 else 0

    # Alunos por turma
    por_turma = query("""
        SELECT t.nome AS turma, COUNT(a.id) AS total
        FROM turmas t
        LEFT JOIN alunos a ON a.turma_id = t.id AND a.ativo = 1
        GROUP BY t.id, t.nome
        ORDER BY t.nome
    """)

    # Distribuição por sexo
    por_sexo = query("""
        SELECT COALESCE(sexo, 'Não informado') AS categoria, COUNT(*) AS total
        FROM alunos WHERE ativo = 1
        GROUP BY sexo ORDER BY total DESC
    """)

    # Distribuição por raça/cor
    por_raca = query("""
        SELECT COALESCE(raca_cor, 'Não informado') AS categoria, COUNT(*) AS total
        FROM alunos WHERE ativo = 1
        GROUP BY raca_cor ORDER BY total DESC
    """)

    # Faixa etária
    alunos_nasc = query("SELECT data_nascimento FROM alunos WHERE ativo = 1 AND data_nascimento IS NOT NULL AND data_nascimento != ''")
    faixas = {}
    for a in alunos_nasc:
        idade = calcular_idade(a['data_nascimento'])
        if idade is not None:
            faixas[idade] = faixas.get(idade, 0) + 1
    por_idade = [{'idade': k, 'total': v} for k, v in sorted(faixas.items())]

    # Bolsa Família
    bf = query("""
        SELECT
            SUM(CASE WHEN bolsa_familia = 'Sim' THEN 1 ELSE 0 END) AS sim,
            SUM(CASE WHEN bolsa_familia != 'Sim' OR bolsa_familia IS NULL THEN 1 ELSE 0 END) AS nao
        FROM alunos WHERE ativo = 1
    """)

    # Deficiência
    defic = query("""
        SELECT
            SUM(CASE WHEN deficiencia = 'Sim' THEN 1 ELSE 0 END) AS sim,
            SUM(CASE WHEN deficiencia != 'Sim' OR deficiencia IS NULL THEN 1 ELSE 0 END) AS nao
        FROM alunos WHERE ativo = 1
    """)

    # Internet em casa
    internet = query("""
        SELECT
            SUM(CASE WHEN internet_em_casa = 'Sim' THEN 1 ELSE 0 END) AS sim,
            SUM(CASE WHEN internet_em_casa != 'Sim' OR internet_em_casa IS NULL THEN 1 ELSE 0 END) AS nao
        FROM alunos WHERE ativo = 1
    """)

    # Smartphone
    smart = query("""
        SELECT
            SUM(CASE WHEN smartphone = 'Sim' THEN 1 ELSE 0 END) AS sim,
            SUM(CASE WHEN smartphone != 'Sim' OR smartphone IS NULL THEN 1 ELSE 0 END) AS nao
        FROM alunos WHERE ativo = 1
    """)

    # Frequência por turma (média)
    freq_turma = query("""
        SELECT t.nome AS turma,
               COUNT(f.id) AS total_registros,
               SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) AS presencas
        FROM turmas t
        LEFT JOIN frequencia f ON f.turma_id = t.id
        GROUP BY t.id, t.nome
        ORDER BY t.nome
    """)
    for ft in freq_turma:
        tr = ft.get('total_registros', 0) or 0
        pr = ft.get('presencas', 0) or 0
        ft['percentual'] = round((pr / tr * 100), 1) if tr > 0 else 0

    # Frequência ao longo do tempo (últimos 30 dias)
    freq_tempo = query("""
        SELECT data,
               COUNT(*) AS total,
               SUM(CASE WHEN presente = 1 THEN 1 ELSE 0 END) AS presencas
        FROM frequencia
        GROUP BY data
        ORDER BY data DESC
        LIMIT 60
    """)
    for ft in freq_tempo:
        t = ft.get('total', 0) or 0
        p = ft.get('presencas', 0) or 0
        ft['percentual'] = round((p / t * 100), 1) if t > 0 else 0
    freq_tempo.reverse()  # mais antigo primeiro

    return jsonify({
        'totais': {
            'alunos': total_alunos,
            'turmas': total_turmas,
            'frequencia_percentual': perc_freq,
            'total_registros_freq': total_reg,
        },
        'por_turma': por_turma,
        'por_sexo': por_sexo,
        'por_raca': por_raca,
        'por_idade': por_idade,
        'bolsa_familia': bf[0] if bf else {},
        'deficiencia': defic[0] if defic else {},
        'internet': internet[0] if internet else {},
        'smartphone': smart[0] if smart else {},
        'freq_turma': freq_turma,
        'freq_tempo': freq_tempo,
    })


# ============================================================
# ROTAS — IMPORTAÇÃO DE EXCEL/CSV
# ============================================================

@app.route('/api/importar', methods=['POST'])
def importar_arquivo():
    """Importa dados de um arquivo Excel (.xlsx) ou CSV."""
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    nome_arquivo = arquivo.filename.lower()

    try:
        # Ler com Pandas
        file_bytes = arquivo.read()
        if nome_arquivo.endswith('.xlsx') or nome_arquivo.endswith('.xls'):
            df = pd.read_excel(io.BytesIO(file_bytes), engine='openpyxl')
        elif nome_arquivo.endswith('.csv'):
            # Tenta detectar separador e encoding
            for enc in ('utf-8-sig', 'latin-1', 'cp1252'):
                for sep in (';', ','):
                    try:
                        df = pd.read_csv(io.BytesIO(file_bytes), sep=sep, encoding=enc)
                        if len(df.columns) > 1:
                            break
                        df = None
                    except Exception:
                        df = None
                if df is not None and len(df.columns) > 1:
                    break
            if df is None:
                return jsonify({'erro': 'Não foi possível ler o CSV'}), 400
        else:
            return jsonify({'erro': 'Formato não suportado. Use .xlsx, .xls ou .csv'}), 400

        if df.empty:
            return jsonify({'erro': 'Arquivo vazio'}), 400

        total_importados = 0
        turmas_criadas = set()

        for _, row in df.iterrows():
            record = {}
            extras = {}

            # Mapear colunas conhecidas
            for excel_col in df.columns:
                val = safe_val(row.get(excel_col, ''))
                if not val:
                    continue

                db_col = EXCEL_TO_DB.get(excel_col)
                if db_col:
                    if db_col == '_serie_ano':
                        record['_serie_ano'] = val
                    elif db_col in DB_COLUMNS:
                        # Se já tem valor, não sobrescrever (priorizar colunas primárias)
                        if db_col not in record or not record[db_col]:
                            record[db_col] = val
                else:
                    # Coluna não mapeada → dados extras
                    extras[excel_col] = val

            # Nome é obrigatório
            nome = record.get('nome', '').strip()
            if not nome:
                continue

            # Criar/obter turma
            serie_ano = record.pop('_serie_ano', '')
            turma_id = None
            if serie_ano:
                if serie_ano not in turmas_criadas:
                    existing = query("SELECT id FROM turmas WHERE nome = ?", [serie_ano])
                    if existing:
                        turma_id = existing[0]['id']
                    else:
                        turma_id = execute(
                            "INSERT INTO turmas (nome) VALUES (?)", [serie_ano]
                        )
                    turmas_criadas.add(serie_ano)
                else:
                    existing = query("SELECT id FROM turmas WHERE nome = ?", [serie_ano])
                    turma_id = existing[0]['id'] if existing else None

            if turma_id:
                record['turma_id'] = turma_id

            # Guardar extras como JSON
            if extras:
                record['dados_json'] = json.dumps(extras, ensure_ascii=False)

            # Verificar se aluno já existe (mesmo RA na mesma turma)
            ra = record.get('ra', '')
            if ra and turma_id:
                existing = query(
                    "SELECT id FROM alunos WHERE ra = ? AND turma_id = ?",
                    [ra, turma_id]
                )
                if existing:
                    # Atualizar aluno existente
                    sets = []
                    vals = []
                    for col in DB_COLUMNS:
                        v = record.get(col)
                        if v is not None:
                            sets.append(f"{col} = ?")
                            vals.append(str(v))
                    if sets:
                        sets.append("atualizado_em = datetime('now')")
                        vals.append(existing[0]['id'])
                        execute(f"UPDATE alunos SET {', '.join(sets)} WHERE id = ?", vals)
                    total_importados += 1
                    continue

            # Inserir novo aluno
            cols = []
            vals = []
            for col in DB_COLUMNS:
                v = record.get(col)
                if v is not None:
                    cols.append(col)
                    vals.append(str(v))

            if cols:
                placeholders = ', '.join(['?'] * len(cols))
                col_names = ', '.join(cols)
                execute(f"INSERT INTO alunos ({col_names}) VALUES ({placeholders})", vals)
                total_importados += 1

        return jsonify({
            'ok': True,
            'total_importados': total_importados,
            'turmas_criadas': len(turmas_criadas),
            'total_linhas_arquivo': len(df),
        })

    except Exception as e:
        return jsonify({'erro': f'Erro ao processar arquivo: {str(e)}'}), 500


# ============================================================
# ROTAS — RELATÓRIOS
# ============================================================

@app.route('/api/relatorios/frequencia-mensal', methods=['GET'])
def relatorio_freq_mensal():
    """Relatório de frequência mensal por turma."""
    turma_id = request.args.get('turma_id')
    mes = request.args.get('mes')  # YYYY-MM

    if not turma_id or not mes:
        return jsonify({'erro': 'turma_id e mes são obrigatórios'}), 400

    # Dados dos alunos
    alunos = query(
        "SELECT id, nome, ra, numero_chamada FROM alunos WHERE turma_id = ? AND ativo = 1 ORDER BY nome",
        [int(turma_id)]
    )

    # Frequência do mês
    freq = query(
        "SELECT aluno_id, data, presente, observacao FROM frequencia WHERE turma_id = ? AND data LIKE ?",
        [int(turma_id), f"{mes}%"]
    )

    # Construir mapa aluno→datas
    freq_map = {}
    datas_set = set()
    for f in freq:
        aid = f['aluno_id']
        if aid not in freq_map:
            freq_map[aid] = {}
        freq_map[aid][f['data']] = {
            'presente': f['presente'],
            'observacao': f.get('observacao', '')
        }
        datas_set.add(f['data'])

    datas = sorted(datas_set)

    resultado = []
    for a in alunos:
        freq_aluno = freq_map.get(a['id'], {})
        presencas = sum(1 for d in datas if freq_aluno.get(d, {}).get('presente', 0) == 1)
        faltas = sum(1 for d in datas if freq_aluno.get(d, {}).get('presente', 0) == 0 and d in freq_aluno)
        total = presencas + faltas
        perc = round((presencas / total * 100), 1) if total > 0 else 0

        resultado.append({
            'aluno_id': a['id'],
            'nome': a['nome'],
            'ra': a['ra'],
            'numero_chamada': a['numero_chamada'],
            'presencas': presencas,
            'faltas': faltas,
            'total_dias': total,
            'percentual': perc,
            'detalhes': freq_aluno,
        })

    turma_info = query("SELECT nome FROM turmas WHERE id = ?", [int(turma_id)])

    return jsonify({
        'turma': turma_info[0]['nome'] if turma_info else '',
        'mes': mes,
        'datas': datas,
        'alunos': resultado,
    })


@app.route('/api/relatorios/perfil-turma', methods=['GET'])
def relatorio_perfil_turma():
    """Perfil detalhado de uma turma para gráficos."""
    turma_id = request.args.get('turma_id')
    if not turma_id:
        return jsonify({'erro': 'turma_id é obrigatório'}), 400

    alunos = query(
        "SELECT * FROM alunos WHERE turma_id = ? AND ativo = 1",
        [int(turma_id)]
    )

    # Processar com Pandas para estatísticas
    if not alunos:
        return jsonify({'erro': 'Nenhum aluno encontrado'}), 404

    df = pd.DataFrame(alunos)

    # Contagens
    por_sexo = df['sexo'].fillna('Não informado').value_counts().to_dict()
    por_raca = df['raca_cor'].fillna('Não informado').value_counts().to_dict()

    # Idades
    idades = []
    for _, row in df.iterrows():
        idade = calcular_idade(row.get('data_nascimento', ''))
        if idade is not None:
            idades.append(idade)

    # Indicadores
    def contar_sim(coluna):
        return int((df[coluna] == 'Sim').sum()) if coluna in df.columns else 0

    indicadores = {
        'bolsa_familia': contar_sim('bolsa_familia'),
        'deficiencia': contar_sim('deficiencia'),
        'internet_em_casa': contar_sim('internet_em_casa'),
        'smartphone': contar_sim('smartphone'),
        'quilombola': contar_sim('quilombola'),
        'refugiado': contar_sim('refugiado'),
        'laudo_medico': contar_sim('laudo_medico'),
    }

    turma_info = query("SELECT nome FROM turmas WHERE id = ?", [int(turma_id)])

    return jsonify({
        'turma': turma_info[0]['nome'] if turma_info else '',
        'total_alunos': len(alunos),
        'por_sexo': [{'categoria': k, 'total': v} for k, v in por_sexo.items()],
        'por_raca': [{'categoria': k, 'total': v} for k, v in por_raca.items()],
        'idades': sorted(idades),
        'indicadores': indicadores,
    })


# ============================================================
# ASSISTENTE IA (Groq)
# ============================================================

GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
GROQ_MODEL = 'openai/gpt-oss-120b'
GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

SYSTEM_PROMPT = """Você é o Assistente Pedagógico DALMASO, um especialista em gestão escolar.
Seu papel é:
1. Analisar dados de frequência escolar e identificar padrões de risco (busca ativa).
2. Sugerir intervenções pedagógicas para alunos com baixa frequência.
3. Interpretar gráficos e dados estatísticos sobre turmas e alunos.
4. Gerar insights sobre o perfil das turmas (sexo, raça, idade, indicadores).
5. Ajudar com dúvidas sobre o sistema de gestão escolar DALMASO.

Regras:
- Responda SEMPRE em português brasileiro.
- Seja objetivo e prático nas recomendações.
- Quando receber dados de frequência, destaque alunos com <75% de presença como críticos.
- Use emojis (⚠️ ✅ 📊 🎯) para destacar pontos importantes.
- Formate respostas com markdown quando apropriado.
"""


@app.route('/api/ia/chat', methods=['POST'])
def ia_chat():
    """Endpoint de chat com IA via Groq."""
    body = request.get_json(force=True)
    user_msg = body.get('mensagem', '').strip()
    contexto = body.get('contexto', '')
    historico = body.get('historico', [])

    if not user_msg:
        return jsonify({'erro': 'Mensagem é obrigatória'}), 400

    if not GROQ_API_KEY:
        return jsonify({'erro': 'GROQ_API_KEY não configurada'}), 500

    messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]

    if contexto:
        messages.append({'role': 'system', 'content': f'Dados de contexto do sistema:\n{contexto}'})

    for msg in historico[-10:]:
        messages.append({'role': msg.get('role', 'user'), 'content': msg.get('content', '')})

    messages.append({'role': 'user', 'content': user_msg})

    try:
        resp = httpx.post(
            GROQ_URL,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {GROQ_API_KEY}',
            },
            json={
                'model': GROQ_MODEL,
                'messages': messages,
                'temperature': 0.7,
                'max_completion_tokens': 2048,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        resposta = data['choices'][0]['message']['content']
        return jsonify({'resposta': resposta})
    except httpx.HTTPStatusError as e:
        return jsonify({'erro': f'Erro Groq: {e.response.status_code}'}), 502
    except Exception as e:
        return jsonify({'erro': f'Erro ao consultar IA: {str(e)}'}), 500


@app.route('/api/ia/analisar-frequencia', methods=['POST'])
def ia_analisar_frequencia():
    """Analisa frequência de uma turma e retorna insights da IA."""
    body = request.get_json(force=True)
    turma_id = body.get('turma_id')
    mes = body.get('mes')

    if not turma_id:
        return jsonify({'erro': 'turma_id é obrigatório'}), 400

    if not GROQ_API_KEY:
        return jsonify({'erro': 'GROQ_API_KEY não configurada'}), 500

    try:
        turma_info = query("SELECT nome FROM turmas WHERE id = ?", [int(turma_id)])
        turma_nome = turma_info[0]['nome'] if turma_info else 'Desconhecida'

        if mes:
            freq_data = query("""
                SELECT a.nome, a.ra,
                       COUNT(f.id) as total_dias,
                       SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) as presencas
                FROM alunos a
                LEFT JOIN frequencia f ON a.id = f.aluno_id AND f.data LIKE ?
                WHERE a.turma_id = ? AND a.ativo = 1
                GROUP BY a.id, a.nome, a.ra
                ORDER BY a.nome
            """, [f"{mes}%", int(turma_id)])
        else:
            freq_data = query("""
                SELECT a.nome, a.ra,
                       COUNT(f.id) as total_dias,
                       SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) as presencas
                FROM alunos a
                LEFT JOIN frequencia f ON a.id = f.aluno_id
                WHERE a.turma_id = ? AND a.ativo = 1
                GROUP BY a.id, a.nome, a.ra
                ORDER BY a.nome
            """, [int(turma_id)])

        linhas = [f"Turma: {turma_nome}"]
        if mes:
            linhas.append(f"Período: {mes}")
        linhas.append(f"Total de alunos: {len(freq_data)}")
        linhas.append("")
        linhas.append("Nome | RA | Dias | Presenças | Faltas | %")
        linhas.append("---|---|---|---|---|---")

        criticos = []
        for al in freq_data:
            total = al['total_dias'] or 0
            pres = al['presencas'] or 0
            faltas = total - pres
            perc = round(pres / total * 100, 1) if total > 0 else 0
            linhas.append(f"{al['nome']} | {al['ra'] or '-'} | {total} | {pres} | {faltas} | {perc}%")
            if perc < 75 and total > 0:
                criticos.append(f"{al['nome']} ({perc}%)")

        contexto = '\n'.join(linhas)
        prompt = f"""Analise os dados de frequência da turma abaixo e forneça:
1. Resumo geral da turma
2. Alunos em situação crítica (<75% de frequência) — destaque com ⚠️
3. Padrões observados
4. Recomendações de intervenção pedagógica
5. Sugestão de busca ativa para alunos críticos

Dados:\n{contexto}"""

        messages = [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': prompt},
        ]

        resp = httpx.post(
            GROQ_URL,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {GROQ_API_KEY}',
            },
            json={
                'model': GROQ_MODEL,
                'messages': messages,
                'temperature': 0.7,
                'max_completion_tokens': 3000,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        analise = data['choices'][0]['message']['content']

        return jsonify({
            'analise': analise,
            'criticos': criticos,
            'total_alunos': len(freq_data),
            'turma': turma_nome,
        })
    except Exception as e:
        return jsonify({'erro': f'Erro: {str(e)}'}), 500


# ============================================================
# AUTENTICAÇÃO — Senhas de acesso
# ============================================================

# Senha ADMIN: acesso total ao sistema
SENHA_ADMIN = os.environ.get('SENHA_ADMIN', 'dalmaso2025')
# Senha FREQUÊNCIA: acesso apenas ao registro de frequência diária
SENHA_FREQUENCIA = os.environ.get('SENHA_FREQUENCIA', 'frequencia2025')


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    """Login com senha. Retorna nível de acesso."""
    body = request.get_json(force=True)
    senha = body.get('senha', '').strip()

    if senha == SENHA_ADMIN:
        return jsonify({'ok': True, 'nivel': 'admin', 'mensagem': 'Acesso total liberado'})
    elif senha == SENHA_FREQUENCIA:
        return jsonify({'ok': True, 'nivel': 'frequencia', 'mensagem': 'Acesso à frequência liberado'})
    else:
        return jsonify({'ok': False, 'erro': 'Senha incorreta'}), 401


# ============================================================
# DUPLICADOS — Encontrar e remover
# ============================================================

@app.route('/api/duplicados', methods=['GET'])
def encontrar_duplicados():
    """Encontra alunos duplicados (mesmo nome ou mesmo RA) na mesma turma."""
    turma_nome = request.args.get('turma', '')

    sql = """
        SELECT a.id, a.nome, a.ra, a.turma_id, t.nome AS turma_nome,
               a.data_nascimento, a.criado_em
        FROM alunos a
        JOIN turmas t ON t.id = a.turma_id
        WHERE a.ativo = 1
    """
    params = []
    if turma_nome:
        sql += " AND t.nome = ?"
        params.append(turma_nome)
    sql += " ORDER BY t.nome, a.nome, a.criado_em"

    alunos = query(sql, params)

    # Agrupar por turma + nome
    from collections import defaultdict
    por_chave = defaultdict(list)
    for a in alunos:
        chave = f"{a['turma_id']}_{a['nome'].strip().upper()}"
        por_chave[chave].append(a)

    duplicados = []
    for chave, grupo in por_chave.items():
        if len(grupo) > 1:
            duplicados.append({
                'nome': grupo[0]['nome'],
                'turma': grupo[0]['turma_nome'],
                'registros': grupo,
                'total': len(grupo)
            })

    # Também verificar por RA duplicado na mesma turma
    por_ra = defaultdict(list)
    for a in alunos:
        if a.get('ra'):
            chave_ra = f"{a['turma_id']}_{a['ra'].strip()}"
            por_ra[chave_ra].append(a)

    for chave, grupo in por_ra.items():
        if len(grupo) > 1:
            # Verificar se já está nos duplicados por nome
            ids_existentes = set()
            for d in duplicados:
                for r in d['registros']:
                    ids_existentes.add(r['id'])
            if grupo[0]['id'] not in ids_existentes:
                duplicados.append({
                    'nome': grupo[0]['nome'],
                    'turma': grupo[0]['turma_nome'],
                    'registros': grupo,
                    'total': len(grupo),
                    'tipo': 'ra_duplicado'
                })

    return jsonify({
        'duplicados': duplicados,
        'total_grupos': len(duplicados)
    })


@app.route('/api/duplicados/corrigir', methods=['POST'])
def corrigir_duplicados():
    """Remove registros duplicados, mantendo o mais recente."""
    body = request.get_json(force=True)
    turma_nome = body.get('turma', '')

    sql = """
        SELECT a.id, a.nome, a.ra, a.turma_id, t.nome AS turma_nome,
               a.criado_em, a.atualizado_em
        FROM alunos a
        JOIN turmas t ON t.id = a.turma_id
        WHERE a.ativo = 1
    """
    params = []
    if turma_nome:
        sql += " AND t.nome = ?"
        params.append(turma_nome)
    sql += " ORDER BY t.nome, a.nome"

    alunos = query(sql, params)

    from collections import defaultdict
    por_chave = defaultdict(list)
    for a in alunos:
        chave = f"{a['turma_id']}_{a['nome'].strip().upper()}"
        por_chave[chave].append(a)

    removidos = 0
    ids_removidos = []
    for chave, grupo in por_chave.items():
        if len(grupo) > 1:
            # Manter o último criado (maior id), remover os outros
            grupo_sorted = sorted(grupo, key=lambda x: x['id'])
            manter = grupo_sorted[-1]
            for a in grupo_sorted[:-1]:
                execute("DELETE FROM frequencia WHERE aluno_id = ?", [a['id']])
                execute("DELETE FROM alunos WHERE id = ?", [a['id']])
                ids_removidos.append(a['id'])
                removidos += 1

    return jsonify({
        'ok': True,
        'removidos': removidos,
        'ids_removidos': ids_removidos
    })


# ============================================================
# MONITORAMENTO — Endpoints do Painel
# ============================================================

# Configurações de turmas por período e nível
PERIODOS = {
    'manha': ['1A', '1B', '1C', '1D', '1E', '1F', '2A', '2B', '2C', '2D', '2E', '3A', '3B', '3C'],
    'tarde': ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B', '8C', '8D', '9A', '9B', '9C', '9D'],
    'noite': ['1G', '2F', '2G', '3D', '3E'],
}

NIVEIS = {
    'ensino_medio': ['1A', '1B', '1C', '1D', '1E', '1F', '2B', '2C', '2D', '2E', '3B', '3C', '1G', '2F', '2G', '3D', '3E'],
    'ensino_medio_iftp': ['2A', '3A'],
    'fundamental_final': ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B', '8C', '8D', '9A', '9B', '9C', '9D'],
}

ALL_TURMAS_ORDENADAS = (
    PERIODOS['manha'] + PERIODOS['tarde'] + PERIODOS['noite']
)

# ============================================================
# CALENDÁRIO PEDAGÓGICO 2026 — Estado de São Paulo (SEDUC-SP)
# ============================================================

CALENDARIO_PEDAGOGICO_2026 = {
    "ano": 2026,
    "inicio_aulas": "2026-02-02",
    "fim_aulas": "2026-12-17",
    "total_dias_letivos": 200,
    "bimestres": [
        {"bimestre": 1, "inicio": "2026-02-02", "fim": "2026-04-22", "dias_letivos": 55},
        {"bimestre": 2, "inicio": "2026-04-23", "fim": "2026-07-09", "dias_letivos": 50},
        {"bimestre": 3, "inicio": "2026-07-24", "fim": "2026-10-02", "dias_letivos": 50},
        {"bimestre": 4, "inicio": "2026-10-05", "fim": "2026-12-17", "dias_letivos": 45},
    ],
    "feriados": [
        {"data": "2026-01-01", "descricao": "Confraternização Universal"},
        {"data": "2026-01-25", "descricao": "Aniversário de São Paulo"},
        {"data": "2026-02-16", "descricao": "Carnaval (Ponto Facultativo)"},
        {"data": "2026-02-17", "descricao": "Carnaval"},
        {"data": "2026-02-18", "descricao": "Quarta-feira de Cinzas (Ponto Facultativo)"},
        {"data": "2026-04-02", "descricao": "Paixão de Cristo"},
        {"data": "2026-04-21", "descricao": "Tiradentes"},
        {"data": "2026-05-01", "descricao": "Dia do Trabalho"},
        {"data": "2026-06-04", "descricao": "Corpus Christi"},
        {"data": "2026-06-05", "descricao": "Ponto Facultativo (Corpus Christi)"},
        {"data": "2026-09-07", "descricao": "Independência do Brasil"},
        {"data": "2026-10-12", "descricao": "Nossa Senhora Aparecida / Dia das Crianças"},
        {"data": "2026-11-02", "descricao": "Finados"},
        {"data": "2026-11-15", "descricao": "Proclamação da República"},
        {"data": "2026-11-20", "descricao": "Dia da Consciência Negra"},
        {"data": "2026-12-25", "descricao": "Natal"},
    ],
    "recessos": [
        {"inicio": "2026-01-01", "fim": "2026-01-31", "descricao": "Recesso/Planejamento de Janeiro"},
        {"inicio": "2026-07-10", "fim": "2026-07-23", "descricao": "Recesso Escolar de Julho"},
        {"inicio": "2026-12-18", "fim": "2026-12-31", "descricao": "Recesso de Dezembro"},
    ],
    "avaliacoes": [
        {"inicio": "2026-03-16", "fim": "2026-03-27", "descricao": "AAP 1 — Avaliação de Aprendizagem em Processo", "bimestre": 1},
        {"inicio": "2026-05-18", "fim": "2026-05-29", "descricao": "AAP 2 — Avaliação de Aprendizagem em Processo", "bimestre": 2},
        {"inicio": "2026-08-17", "fim": "2026-08-28", "descricao": "AAP 3 — Avaliação de Aprendizagem em Processo", "bimestre": 3},
        {"inicio": "2026-10-19", "fim": "2026-10-30", "descricao": "AAP 4 — Avaliação de Aprendizagem em Processo", "bimestre": 4},
    ],
    "conselhos": [
        {"inicio": "2026-04-20", "fim": "2026-04-22", "descricao": "Conselho de Classe/Série — 1º Bimestre"},
        {"inicio": "2026-07-07", "fim": "2026-07-09", "descricao": "Conselho de Classe/Série — 2º Bimestre"},
        {"inicio": "2026-09-30", "fim": "2026-10-02", "descricao": "Conselho de Classe/Série — 3º Bimestre"},
        {"inicio": "2026-12-15", "fim": "2026-12-17", "descricao": "Conselho de Classe/Série — 4º Bimestre"},
    ],
    "reunioes_pais": [
        {"data": "2026-02-06", "descricao": "Reunião de Pais e Mestres — Acolhimento"},
        {"data": "2026-05-08", "descricao": "Reunião de Pais e Mestres — 1º Bimestre"},
        {"data": "2026-08-07", "descricao": "Reunião de Pais e Mestres — 2º Bimestre"},
        {"data": "2026-10-16", "descricao": "Reunião de Pais e Mestres — 3º Bimestre"},
    ],
    "replanejamentos": [
        {"data": "2026-02-02", "descricao": "Planejamento Escolar — Início do Ano"},
        {"data": "2026-07-24", "descricao": "Replanejamento — Início do 2º Semestre"},
    ],
    "olimpiadas": [
        {"inicio": "2026-03-02", "fim": "2026-03-13", "descricao": "Olimpíada Brasileira de Matemática (OBMEP) — 1ª Fase"},
        {"inicio": "2026-06-01", "fim": "2026-06-12", "descricao": "Olimpíada de Língua Portuguesa"},
        {"inicio": "2026-09-14", "fim": "2026-09-25", "descricao": "OBMEP — 2ª Fase"},
    ],
    "provao_paulista": [
        {"inicio": "2026-10-26", "fim": "2026-11-06", "descricao": "Provão Paulista — Fase Única (3ª Série)"},
    ],
}

# ============================================================
# DADOS CSV — Frequência até 28/02/2026
# ============================================================

CSV_FREQ_PATH = os.path.join(STATIC_DIR, 'FREQUENCIA ATE 28-02-2026.csv')
CSV_ALUNOS_PATH = os.path.join(STATIC_DIR, 'dados_alunos.csv')

def _parse_csv_turma_name(nome_completo):
    """Parse CSV turma name → (short_name, display_name, periodo, nivel)"""
    nome = nome_completo.strip()

    # Detect periodo from name
    periodo = 'manha'
    if 'NOITE' in nome.upper():
        periodo = 'noite'
    elif 'TARDE' in nome.upper():
        periodo = 'tarde'

    # Remove trailing ID after last " - "
    parts = nome.rsplit(' - ', 1)
    nome_base = parts[0].strip() if len(parts) > 1 else nome

    # Clean display name: remove MANHA/TARDE/NOITE ANUAL
    nome_display = re.sub(r'\s*(MANHA|TARDE|NOITE)\s*ANUAL\s*', ' ', nome_base).strip()

    # Generate short name for matching with PERIODOS
    short = ''
    nivel = 'ensino_medio'

    # Pattern: Xª SERIE Y
    m = re.search(r'(\d)ª SERIE ([A-Z])', nome_display)
    if m:
        serie = m.group(1)
        letra = m.group(2)
        short = f'{serie}{letra}'
        if 'ADMINISTRAÇÃO' in nome_display or 'DESENVOLVIMENTO' in nome_display:
            nivel = 'ensino_medio_iftp'
    else:
        # Pattern: X° ANO Y or Xº ANO Y
        m = re.search(r'(\d)[°º] ANO ([A-Z])', nome_display)
        if m:
            ano = m.group(1)
            letra = m.group(2)
            short = f'{ano}{letra}'
            nivel = 'fundamental_final'

    return short, nome_display, periodo, nivel


def load_csv_frequency():
    """Load and parse frequency data from CSV file."""
    data = []
    try:
        with open(CSV_FREQ_PATH, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                turma_raw = row.get('Turma', '').strip()
                if not turma_raw:
                    continue

                short, display, periodo, nivel = _parse_csv_turma_name(turma_raw)

                # Parse Brazilian numbers: "62,3%" → 62.3
                def parse_pct(val):
                    try:
                        return float(val.replace('%', '').replace(',', '.').strip())
                    except:
                        return 0.0

                def parse_int(val):
                    try:
                        return int(val.strip())
                    except:
                        return 0

                presenca_pct = parse_pct(row.get('(%) de Presença', '0'))
                aulas_pct = parse_pct(row.get('(%) Aulas Dadas', '0'))
                matriculas = parse_int(row.get('Matrículas Ativas', '0'))
                aulas_prev = parse_int(row.get('Aulas Previstas', '0'))
                aulas_dadas = parse_int(row.get('Aulas Dadas', '0'))

                # Calculate actual presences/absences
                total_registros = aulas_dadas * matriculas
                presencas = int(total_registros * presenca_pct / 100) if total_registros else 0
                faltas = total_registros - presencas

                data.append({
                    'nome': short,
                    'nome_completo': turma_raw,
                    'display': display,
                    'periodo': periodo,
                    'nivel': nivel,
                    'matriculas': matriculas,
                    'presenca_pct': presenca_pct,
                    'aulas_previstas': aulas_prev,
                    'aulas_dadas': aulas_dadas,
                    'aulas_pct': aulas_pct,
                    'presencas': presencas,
                    'faltas': faltas,
                    'evolucao_presenca': row.get('(%) Evolução Presença', '').strip(),
                    'evolucao_aulas': row.get('(%) Evolução Aulas', '').strip(),
                })
    except Exception as e:
        print(f"Erro ao ler CSV de frequência: {e}")
    return data


# Cache do CSV (carrega uma vez)
_csv_cache = None
_csv_cache_time = None

def get_csv_data():
    """Retorna dados do CSV com cache de 60s."""
    global _csv_cache, _csv_cache_time
    now = datetime.now()
    if _csv_cache is None or _csv_cache_time is None or (now - _csv_cache_time).seconds > 60:
        _csv_cache = load_csv_frequency()
        _csv_cache_time = now
    return _csv_cache


@app.route('/api/calendario-pedagogico', methods=['GET'])
def calendario_pedagogico():
    """Retorna o calendário pedagógico 2026 completo."""
    return jsonify(CALENDARIO_PEDAGOGICO_2026)


@app.route('/api/frequencia-csv', methods=['GET'])
def frequencia_csv():
    """
    Retorna dados de frequência do CSV (SEDUC-SP) processados.
    Params: turno (manha|tarde|noite|todos), nivel (todos|ensino_medio|...)
    """
    turno = request.args.get('turno', 'todos')
    nivel_filtro = request.args.get('nivel', 'todos')

    data = get_csv_data()

    # Aplicar filtros
    if turno != 'todos':
        data = [d for d in data if d['periodo'] == turno]
    if nivel_filtro != 'todos':
        data = [d for d in data if d['nivel'] == nivel_filtro]

    # Calcular totais
    total_alunos = sum(d['matriculas'] for d in data)
    if total_alunos > 0:
        media_presenca = sum(d['presenca_pct'] * d['matriculas'] for d in data) / total_alunos
    else:
        media_presenca = 0

    total_presencas_geral = sum(d['presencas'] for d in data)
    total_faltas_geral = sum(d['faltas'] for d in data)

    # Resumo por período
    freq_por_periodo = {}
    for per in ['manha', 'tarde', 'noite']:
        turmas_per = [d for d in data if d['periodo'] == per]
        if turmas_per:
            total_mat = sum(d['matriculas'] for d in turmas_per)
            media = sum(d['presenca_pct'] * d['matriculas'] for d in turmas_per) / total_mat if total_mat else 0
            freq_por_periodo[per] = {
                'total_turmas': len(turmas_per),
                'total_alunos': total_mat,
                'percentual': round(media, 1),
                'presencas': sum(d['presencas'] for d in turmas_per),
                'faltas': sum(d['faltas'] for d in turmas_per),
            }

    # Turmas críticas (< 60%)
    criticas = [d for d in data if d['presenca_pct'] < 60]

    # Ordenar por ALL_TURMAS_ORDENADAS
    data.sort(key=lambda x: ALL_TURMAS_ORDENADAS.index(x['nome']) if x['nome'] in ALL_TURMAS_ORDENADAS else 999)

    return jsonify({
        'fonte': 'csv_seduc',
        'referencia': 'Fevereiro 2026',
        'periodo_dados': '02/02/2026 a 28/02/2026',
        'fevereiro_completo': True,
        'contagem_faltas_inicio': '2026-02-03',
        'resumo': {
            'total_turmas': len(data),
            'total_alunos': total_alunos,
            'media_frequencia': round(media_presenca, 1),
            'total_presencas': total_presencas_geral,
            'total_faltas': total_faltas_geral,
        },
        'turmas': data,
        'turmas_criticas': criticas,
        'freq_por_periodo': freq_por_periodo,
    })


def _obter_turma_ids(nomes_turmas):
    """Obtém IDs de turmas a partir dos nomes."""
    if not nomes_turmas:
        return []
    placeholders = ','.join(['?' for _ in nomes_turmas])
    rows = query(f"SELECT id, nome FROM turmas WHERE nome IN ({placeholders})", nomes_turmas)
    return {r['nome']: r['id'] for r in rows}


def _calcular_periodo_datas(tipo_periodo, referencia=None):
    """
    Calcula data_inicio e data_fim com base no tipo de período.
    tipo_periodo: 'diario', 'semanal', 'mensal', 'bimestral', 'anual'
    referencia: data de referência (default: hoje)
    """
    if referencia:
        try:
            ref = datetime.strptime(referencia, '%Y-%m-%d').date()
        except ValueError:
            ref = date.today()
    else:
        ref = date.today()

    if tipo_periodo == 'diario':
        return ref.isoformat(), ref.isoformat()

    elif tipo_periodo == 'semanal':
        # Segunda a sexta da semana atual
        inicio = ref - __import__('datetime').timedelta(days=ref.weekday())
        fim = inicio + __import__('datetime').timedelta(days=4)  # sexta
        return inicio.isoformat(), fim.isoformat()

    elif tipo_periodo == 'mensal':
        inicio = ref.replace(day=1)
        if ref.month == 12:
            fim = ref.replace(year=ref.year + 1, month=1, day=1) - __import__('datetime').timedelta(days=1)
        else:
            fim = ref.replace(month=ref.month + 1, day=1) - __import__('datetime').timedelta(days=1)
        return inicio.isoformat(), fim.isoformat()

    elif tipo_periodo == 'bimestral':
        # Bimestre escolar baseado no mês
        mes = ref.month
        if mes <= 2:
            inicio = ref.replace(month=1, day=1)
            fim = ref.replace(month=2, day=28)
        elif mes <= 4:
            inicio = ref.replace(month=3, day=1)
            fim = ref.replace(month=4, day=30)
        elif mes <= 6:
            inicio = ref.replace(month=5, day=1)
            fim = ref.replace(month=6, day=30)
        elif mes <= 8:
            inicio = ref.replace(month=7, day=1)
            fim = ref.replace(month=8, day=31)
        elif mes <= 10:
            inicio = ref.replace(month=9, day=1)
            fim = ref.replace(month=10, day=31)
        else:
            inicio = ref.replace(month=11, day=1)
            fim = ref.replace(month=12, day=31)
        return inicio.isoformat(), fim.isoformat()

    elif tipo_periodo == 'anual':
        inicio = ref.replace(month=1, day=1)
        fim = ref.replace(month=12, day=31)
        return inicio.isoformat(), fim.isoformat()

    return ref.isoformat(), ref.isoformat()


@app.route('/api/monitoramento', methods=['GET'])
def monitoramento():
    """
    Endpoint principal do painel de monitoramento.
    Params:
      - periodo: diario|semanal|mensal|bimestral|anual
      - turno: manha|tarde|noite|todos
      - nivel: ensino_medio|ensino_medio_iftp|fundamental_final|todos
      - data_ref: YYYY-MM-DD (data de referência)
    """
    tipo_periodo = request.args.get('periodo', 'diario')
    turno = request.args.get('turno', 'todos')
    nivel = request.args.get('nivel', 'todos')
    data_ref = request.args.get('data_ref', '')

    data_inicio, data_fim = _calcular_periodo_datas(tipo_periodo, data_ref or None)

    # Filtrar turmas por turno e nível
    turmas_filtro = set(ALL_TURMAS_ORDENADAS)
    if turno != 'todos' and turno in PERIODOS:
        turmas_filtro &= set(PERIODOS[turno])
    if nivel != 'todos' and nivel in NIVEIS:
        turmas_filtro &= set(NIVEIS[nivel])

    turmas_filtro = sorted(turmas_filtro, key=lambda x: ALL_TURMAS_ORDENADAS.index(x) if x in ALL_TURMAS_ORDENADAS else 999)

    if not turmas_filtro:
        return jsonify({'erro': 'Nenhuma turma para o filtro selecionado'}), 400

    turma_map = _obter_turma_ids(turmas_filtro)
    if not turma_map:
        return jsonify({
            'periodo': tipo_periodo,
            'data_inicio': data_inicio,
            'data_fim': data_fim,
            'turno': turno,
            'nivel': nivel,
            'resumo': {'total_turmas': 0, 'total_alunos': 0, 'media_frequencia': 0, 'total_presencas': 0, 'total_faltas': 0},
            'turmas': [],
            'alunos_criticos': [],
        })

    turma_ids = list(turma_map.values())
    placeholders_ids = ','.join(['?' for _ in turma_ids])

    # Total de alunos por turma
    alunos_por_turma = query(f"""
        SELECT turma_id, COUNT(*) AS total
        FROM alunos
        WHERE ativo = 1 AND turma_id IN ({placeholders_ids})
        GROUP BY turma_id
    """, turma_ids)
    alunos_map = {r['turma_id']: r['total'] for r in alunos_por_turma}

    # Frequência no período
    freq_turma = query(f"""
        SELECT f.turma_id,
               COUNT(DISTINCT f.data) AS dias_registrados,
               COUNT(f.id) AS total_registros,
               SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) AS presencas,
               SUM(CASE WHEN f.presente = 0 THEN 1 ELSE 0 END) AS faltas
        FROM frequencia f
        WHERE f.turma_id IN ({placeholders_ids})
          AND f.data >= ? AND f.data <= ?
        GROUP BY f.turma_id
    """, turma_ids + [data_inicio, data_fim])
    freq_map = {r['turma_id']: r for r in freq_turma}

    # Montar dados por turma
    turmas_resultado = []
    total_alunos_geral = 0
    total_presencas_geral = 0
    total_faltas_geral = 0

    for nome_turma in turmas_filtro:
        tid = turma_map.get(nome_turma)
        if not tid:
            continue
        total_alunos_turma = alunos_map.get(tid, 0)
        freq = freq_map.get(tid, {})
        presencas = freq.get('presencas', 0) or 0
        faltas = freq.get('faltas', 0) or 0
        dias = freq.get('dias_registrados', 0) or 0
        total_reg = presencas + faltas
        perc = round((presencas / total_reg * 100), 1) if total_reg > 0 else 0

        # Determinar período e nível
        periodo_turma = 'manha'
        for p, lista in PERIODOS.items():
            if nome_turma in lista:
                periodo_turma = p
                break

        nivel_turma = 'ensino_medio'
        for n, lista in NIVEIS.items():
            if nome_turma in lista:
                nivel_turma = n
                break

        turmas_resultado.append({
            'id': tid,
            'nome': nome_turma,
            'total_alunos': total_alunos_turma,
            'presencas': presencas,
            'faltas': faltas,
            'dias_registrados': dias,
            'percentual': perc,
            'periodo': periodo_turma,
            'nivel': nivel_turma,
        })

        total_alunos_geral += total_alunos_turma
        total_presencas_geral += presencas
        total_faltas_geral += faltas

    total_geral = total_presencas_geral + total_faltas_geral
    media_geral = round((total_presencas_geral / total_geral * 100), 1) if total_geral > 0 else 0

    # Alunos críticos (< 75% de frequência no período)
    alunos_criticos = query(f"""
        SELECT a.id, a.nome, a.ra, a.turma_id, t.nome AS turma_nome,
               COUNT(f.id) AS total_dias,
               SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) AS presencas,
               SUM(CASE WHEN f.presente = 0 THEN 1 ELSE 0 END) AS faltas
        FROM alunos a
        JOIN turmas t ON t.id = a.turma_id
        LEFT JOIN frequencia f ON f.aluno_id = a.id AND f.data >= ? AND f.data <= ?
        WHERE a.ativo = 1 AND a.turma_id IN ({placeholders_ids})
        GROUP BY a.id, a.nome, a.ra, a.turma_id, t.nome
        HAVING total_dias > 0
        ORDER BY presencas * 1.0 / total_dias ASC
    """, [data_inicio, data_fim] + turma_ids)

    criticos = []
    for ac in alunos_criticos:
        total = ac['total_dias'] or 0
        pres = ac['presencas'] or 0
        if total > 0:
            perc_aluno = round((pres / total * 100), 1)
            if perc_aluno < 75:
                criticos.append({
                    'id': ac['id'],
                    'nome': ac['nome'],
                    'ra': ac['ra'],
                    'turma': ac['turma_nome'],
                    'presencas': pres,
                    'faltas': ac['faltas'] or 0,
                    'total_dias': total,
                    'percentual': perc_aluno,
                })

    # Frequência diária no período (para gráfico temporal)
    freq_diaria = query(f"""
        SELECT f.data,
               COUNT(f.id) AS total,
               SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) AS presencas
        FROM frequencia f
        WHERE f.turma_id IN ({placeholders_ids})
          AND f.data >= ? AND f.data <= ?
        GROUP BY f.data
        ORDER BY f.data
    """, turma_ids + [data_inicio, data_fim])

    for fd in freq_diaria:
        t = fd.get('total', 0) or 0
        p = fd.get('presencas', 0) or 0
        fd['percentual'] = round((p / t * 100), 1) if t > 0 else 0

    # Frequência por período (manhã/tarde/noite)
    freq_por_periodo = {}
    for periodo_nome, turmas_periodo in PERIODOS.items():
        ids_periodo = [turma_map[t] for t in turmas_periodo if t in turma_map and t in turmas_filtro]
        if ids_periodo:
            pres_p = sum(freq_map.get(tid, {}).get('presencas', 0) or 0 for tid in ids_periodo)
            falt_p = sum(freq_map.get(tid, {}).get('faltas', 0) or 0 for tid in ids_periodo)
            total_p = pres_p + falt_p
            freq_por_periodo[periodo_nome] = {
                'presencas': pres_p,
                'faltas': falt_p,
                'percentual': round((pres_p / total_p * 100), 1) if total_p > 0 else 0,
                'total_turmas': len(ids_periodo),
            }

    return jsonify({
        'periodo': tipo_periodo,
        'data_inicio': data_inicio,
        'data_fim': data_fim,
        'turno': turno,
        'nivel': nivel,
        'resumo': {
            'total_turmas': len(turmas_resultado),
            'total_alunos': total_alunos_geral,
            'media_frequencia': media_geral,
            'total_presencas': total_presencas_geral,
            'total_faltas': total_faltas_geral,
        },
        'turmas': turmas_resultado,
        'alunos_criticos': criticos[:50],
        'freq_diaria': freq_diaria,
        'freq_por_periodo': freq_por_periodo,
    })


@app.route('/api/monitoramento/turma/<int:tid>', methods=['GET'])
def monitoramento_turma_detalhe(tid):
    """Detalhe de monitoramento de uma turma específica."""
    tipo_periodo = request.args.get('periodo', 'mensal')
    data_ref = request.args.get('data_ref', '')

    data_inicio, data_fim = _calcular_periodo_datas(tipo_periodo, data_ref or None)

    turma_info = query("SELECT * FROM turmas WHERE id = ?", [tid])
    if not turma_info:
        return jsonify({'erro': 'Turma não encontrada'}), 404

    alunos = query("""
        SELECT a.id, a.nome, a.ra, a.numero_chamada,
               COUNT(f.id) AS total_dias,
               SUM(CASE WHEN f.presente = 1 THEN 1 ELSE 0 END) AS presencas,
               SUM(CASE WHEN f.presente = 0 THEN 1 ELSE 0 END) AS faltas
        FROM alunos a
        LEFT JOIN frequencia f ON f.aluno_id = a.id AND f.data >= ? AND f.data <= ?
        WHERE a.turma_id = ? AND a.ativo = 1
        GROUP BY a.id, a.nome, a.ra, a.numero_chamada
        ORDER BY a.nome
    """, [data_inicio, data_fim, tid])

    for a in alunos:
        total = a['total_dias'] or 0
        pres = a['presencas'] or 0
        a['percentual'] = round((pres / total * 100), 1) if total > 0 else 0

    return jsonify({
        'turma': turma_info[0],
        'periodo': tipo_periodo,
        'data_inicio': data_inicio,
        'data_fim': data_fim,
        'alunos': alunos,
    })


# ============================================================
# ROTA DE SAÚDE
# ============================================================

@app.route('/api/health', methods=['GET'])
def health():
    try:
        rows = query("SELECT 1 AS ok")
        db_ok = bool(rows)
    except Exception as e:
        db_ok = False
    return jsonify({
        'status': 'ok' if db_ok else 'erro_db',
        'db': 'turso' if USE_TURSO else 'sqlite_local',
        'timestamp': datetime.now().isoformat(),
    })


# ============================================================
# ALERTAS WHATSAPP — Painel de frequência + telefones
# ============================================================

def _load_alunos_csv():
    """Carrega dados_alunos.csv e retorna lista de dicts com nome, turma, responsável, telefones."""
    alunos = []
    try:
        # Tentar múltiplos encodings — dados_alunos.csv frequentemente é latin-1
        content = None
        for enc in ['utf-8-sig', 'utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
            try:
                with open(CSV_ALUNOS_PATH, 'r', encoding=enc) as f:
                    content = f.read()
                break
            except (UnicodeDecodeError, UnicodeError):
                continue

        if content is None:
            print("Erro: não foi possível decodificar dados_alunos.csv")
            return alunos

        reader = csv.DictReader(io.StringIO(content), delimiter=';')
        for row in reader:
                turma_raw = (row.get('série/ano') or row.get('s\u00e9rie/ano') or row.get('serie/ano') or '').strip()
                nome = (row.get('nome') or row.get('Nome') or '').strip()
                responsavel = (row.get('responsavel_lista') or row.get('Filiação 1') or row.get('Filiaçao 1') or '').strip()
                telefones_raw = (row.get('telefones_formatados') or '').strip()
                ra = (row.get('ra_lista') or row.get('RA') or '').strip()

                if not nome or not turma_raw:
                    continue

                # Parse telefones — extrair números de celular
                celulares = []
                if telefones_raw:
                    # Padrões: "Celular: (16) 994352785 - Mãe" ou "Celular Principal: (16) 981359008"
                    matches = re.findall(r'\((\d{2})\)\s*([\d.e+]+)', telefones_raw)
                    for ddd, num_raw in matches:
                        # Tratar números em notação científica (ex: 9.93175e+008)
                        try:
                            if 'e' in num_raw.lower() or 'E' in num_raw:
                                num_clean = str(int(float(num_raw)))
                            else:
                                num_clean = num_raw.replace('.', '').replace(' ', '')
                            # Celular tem 9 dígitos e começa com 9
                            if len(num_clean) == 9 and num_clean.startswith('9'):
                                celulares.append(f'55{ddd}{num_clean}')
                            elif len(num_clean) == 8 and not num_clean.startswith('9'):
                                pass  # Fixo, ignorar para WhatsApp
                        except:
                            pass

                # Remover duplicatas mantendo ordem
                celulares_unicos = list(dict.fromkeys(celulares))

                alunos.append({
                    'nome': nome,
                    'turma': turma_raw,
                    'ra': ra,
                    'responsavel': responsavel,
                    'telefones_raw': telefones_raw,
                    'celulares_whatsapp': celulares_unicos,
                    'tem_whatsapp': len(celulares_unicos) > 0,
                })
    except Exception as e:
        print(f"Erro ao ler dados_alunos.csv: {e}")
    return alunos


_alunos_cache = None
_alunos_cache_time = None

def _get_alunos_data():
    """Retorna dados de alunos com cache de 120s."""
    global _alunos_cache, _alunos_cache_time
    now = datetime.now()
    if _alunos_cache is None or _alunos_cache_time is None or (now - _alunos_cache_time).seconds > 120:
        _alunos_cache = _load_alunos_csv()
        _alunos_cache_time = now
    return _alunos_cache


def _classificar_turma_periodo(turma_short):
    """Classifica turma por período baseado no nome curto (ex: '1A' → 'manha')."""
    _PERIODOS = {
        'manha': ['1A','1B','1C','1D','1E','1F','2A','2B','2C','2D','2E','3A','3B','3C'],
        'tarde': ['6A','6B','6C','7A','7B','7C','8A','8B','8C','8D','9A','9B','9C','9D'],
        'noite': ['1G','2F','2G','3D','3E'],
    }
    for periodo, lista in _PERIODOS.items():
        if turma_short in lista:
            return periodo
    return 'desconhecido'


@app.route('/api/alertas-frequencia', methods=['GET'])
def alertas_frequencia():
    """
    Retorna dados para o painel de alertas WhatsApp.
    Cruza dados_alunos.csv (telefones) com FREQUENCIA CSV (presença por turma).
    Params:
      turno: manha|tarde|noite|todos
      tipo: todos|criticos|sem_telefone
      turma: filtrar por turma específica (ex: 1A)
    """
    turno_filtro = request.args.get('turno', 'todos')
    tipo_filtro = request.args.get('tipo', 'todos')
    turma_filtro = request.args.get('turma', '').strip()

    # Carregar dados
    alunos = _get_alunos_data()
    freq_data = get_csv_data()

    # Criar mapa de frequência por turma (short name → dados)
    freq_map = {}
    for t in freq_data:
        freq_map[t['nome']] = t

    # Enriquecer alunos com dados de frequência da turma
    resultado = []
    for aluno in alunos:
        turma_short = aluno['turma']
        freq_turma = freq_map.get(turma_short, {})
        periodo = _classificar_turma_periodo(turma_short)

        # Filtro turno
        if turno_filtro != 'todos' and periodo != turno_filtro:
            continue

        # Filtro turma
        if turma_filtro and turma_short != turma_filtro:
            continue

        presenca_pct_turma = freq_turma.get('presenca_pct', 0)
        aulas_previstas = freq_turma.get('aulas_previstas', 0)
        aulas_dadas = freq_turma.get('aulas_dadas', 0)
        display_turma = freq_turma.get('display', turma_short)

        # Determinar status de alerta
        # Status: 'critico' (< 75%), 'atencao' (75-80%), 'regular' (>= 80%)
        if presenca_pct_turma < 75:
            status = 'critico'
        elif presenca_pct_turma < 80:
            status = 'atencao'
        else:
            status = 'regular'

        entry = {
            'nome': aluno['nome'],
            'turma': turma_short,
            'turma_display': display_turma,
            'ra': aluno['ra'],
            'responsavel': aluno['responsavel'],
            'periodo': periodo,
            'celulares': aluno['celulares_whatsapp'],
            'tem_whatsapp': aluno['tem_whatsapp'],
            'telefones_raw': aluno['telefones_raw'],
            'presenca_pct_turma': presenca_pct_turma,
            'aulas_previstas': aulas_previstas,
            'aulas_dadas': aulas_dadas,
            'status': status,
        }

        # Filtro tipo
        if tipo_filtro == 'criticos' and status != 'critico':
            continue
        if tipo_filtro == 'sem_telefone' and aluno['tem_whatsapp']:
            continue

        resultado.append(entry)

    # Ordenar: críticos primeiro, depois por turma
    resultado.sort(key=lambda x: (
        0 if x['status'] == 'critico' else 1 if x['status'] == 'atencao' else 2,
        x['turma'],
        x['nome']
    ))

    # Calcular resumo
    total_alunos = len(resultado)
    total_criticos = sum(1 for a in resultado if a['status'] == 'critico')
    total_atencao = sum(1 for a in resultado if a['status'] == 'atencao')
    total_com_whatsapp = sum(1 for a in resultado if a['tem_whatsapp'])
    total_sem_whatsapp = total_alunos - total_com_whatsapp

    # Turmas críticas (< 75%)
    turmas_criticas = [t for t in freq_data if t['presenca_pct'] < 75]
    if turno_filtro != 'todos':
        turmas_criticas = [t for t in turmas_criticas if t['periodo'] == turno_filtro]

    # Contagem por turma
    turmas_resumo = {}
    for a in resultado:
        k = a['turma']
        if k not in turmas_resumo:
            turmas_resumo[k] = {
                'turma': k,
                'display': a['turma_display'],
                'periodo': a['periodo'],
                'presenca_pct': a['presenca_pct_turma'],
                'total_alunos': 0,
                'com_whatsapp': 0,
                'sem_whatsapp': 0,
                'status': a['status'],
            }
        turmas_resumo[k]['total_alunos'] += 1
        if a['tem_whatsapp']:
            turmas_resumo[k]['com_whatsapp'] += 1
        else:
            turmas_resumo[k]['sem_whatsapp'] += 1

    turmas_list = sorted(turmas_resumo.values(), key=lambda x: x.get('presenca_pct', 0))

    return jsonify({
        'resumo': {
            'total_alunos': total_alunos,
            'total_criticos': total_criticos,
            'total_atencao': total_atencao,
            'total_com_whatsapp': total_com_whatsapp,
            'total_sem_whatsapp': total_sem_whatsapp,
            'total_turmas_criticas': len(turmas_criticas),
        },
        'alunos': resultado,
        'turmas': turmas_list,
        'mensagem_modelo_falta': (
            '📋 *EE Prof. Dalmaso - Aviso de Falta*\n\n'
            'Prezado(a) responsável,\n'
            'Informamos que o(a) aluno(a) *{nome}* ({turma} - {periodo}) '
            'teve falta registrada no dia {data}.\n\n'
            'Em caso de dúvidas, procure a secretaria da escola.'
        ),
        'mensagem_modelo_critico': (
            '⚠️ *EE Prof. Dalmaso - Alerta de Frequência*\n\n'
            'Prezado(a) responsável,\n'
            'O(a) aluno(a) *{nome}* está com *{presenca}%* de presença '
            'no bimestre atual ({turma} - {periodo}).\n'
            'O mínimo recomendado é 75%.\n\n'
            'A baixa frequência pode resultar em retenção por faltas. '
            'Contamos com seu apoio!'
        ),
        'timestamp': datetime.now().isoformat(),
    })


# ============================================================
# SERVIR ARQUIVOS ESTÁTICOS
# ============================================================

@app.route('/')
def serve_index():
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/<path:filepath>')
def serve_static(filepath):
    try:
        return send_from_directory(STATIC_DIR, filepath)
    except Exception:
        return send_from_directory(STATIC_DIR, 'index.html')


# ============================================================
# DEVELOPMENT SERVER
# ============================================================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
