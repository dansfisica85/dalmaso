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
import httpx
from datetime import datetime, date
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS

# ── Banco de Dados ──────────────────────────────────────────
try:
    import libsql_experimental as libsql
    USE_TURSO = True
except ImportError:
    import sqlite3
    USE_TURSO = False

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
        cursor = conn.execute(sql, params or [])
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
        cursor = conn.execute(sql, params or [])
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
            conn.execute(sql, params or [])
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
            # Tenta detectar o separador
            try:
                df = pd.read_csv(io.BytesIO(file_bytes), sep=';', encoding='utf-8-sig')
            except Exception:
                df = pd.read_csv(io.BytesIO(file_bytes), sep=',', encoding='utf-8-sig')
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
# SERVIR ARQUIVOS ESTÁTICOS (apenas dev local)
# ============================================================

if not os.environ.get('VERCEL'):
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
