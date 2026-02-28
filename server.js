require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const path = require('path');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

// Turso DB client
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer para upload de arquivos
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ========================
// INICIALIZAÇÃO DO BANCO
// ========================
async function initDB() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS turmas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      descricao TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS alunos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      matricula TEXT,
      turma_id INTEGER NOT NULL,
      ativo INTEGER DEFAULT 1,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS frequencia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL,
      turma_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      dia_semana TEXT NOT NULL,
      presente INTEGER NOT NULL DEFAULT 1,
      observacao TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
      FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE,
      UNIQUE(aluno_id, data)
    )`,
  ]);
  console.log('Banco de dados inicializado com sucesso.');
}

// ========================
// ROTAS - TURMAS
// ========================
app.get('/api/turmas', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM turmas ORDER BY nome');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/turmas', async (req, res) => {
  try {
    const { nome, descricao } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome da turma é obrigatório' });
    const result = await db.execute({
      sql: 'INSERT INTO turmas (nome, descricao) VALUES (?, ?)',
      args: [nome, descricao || null],
    });
    res.json({ id: Number(result.lastInsertRowid), nome, descricao });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Turma já existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/turmas/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM turmas WHERE id = ?', args: [req.params.id] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ROTAS - ALUNOS
// ========================
app.get('/api/alunos', async (req, res) => {
  try {
    const { turma_id } = req.query;
    let sql = `SELECT a.*, t.nome as turma_nome FROM alunos a 
               JOIN turmas t ON a.turma_id = t.id WHERE a.ativo = 1`;
    const args = [];
    if (turma_id) {
      sql += ' AND a.turma_id = ?';
      args.push(turma_id);
    }
    sql += ' ORDER BY a.nome';
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alunos/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT a.*, t.nome as turma_nome FROM alunos a 
            JOIN turmas t ON a.turma_id = t.id WHERE a.id = ?`,
      args: [req.params.id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: 'Aluno não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alunos', async (req, res) => {
  try {
    const { nome, matricula, turma_id } = req.body;
    if (!nome || !turma_id) return res.status(400).json({ error: 'Nome e turma são obrigatórios' });
    const result = await db.execute({
      sql: 'INSERT INTO alunos (nome, matricula, turma_id) VALUES (?, ?, ?)',
      args: [nome, matricula || null, turma_id],
    });
    res.json({ id: Number(result.lastInsertRowid), nome, matricula, turma_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/alunos/:id', async (req, res) => {
  try {
    const { nome, matricula, turma_id } = req.body;
    await db.execute({
      sql: 'UPDATE alunos SET nome = ?, matricula = ?, turma_id = ? WHERE id = ?',
      args: [nome, matricula || null, turma_id, req.params.id],
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/alunos/:id', async (req, res) => {
  try {
    await db.execute({
      sql: 'UPDATE alunos SET ativo = 0 WHERE id = ?',
      args: [req.params.id],
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar permanentemente
app.delete('/api/alunos/:id/permanente', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM alunos WHERE id = ?', args: [req.params.id] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ROTAS - FREQUÊNCIA
// ========================
app.get('/api/frequencia', async (req, res) => {
  try {
    const { turma_id, data, mes, ano } = req.query;
    let sql = `SELECT f.*, a.nome as aluno_nome, t.nome as turma_nome 
               FROM frequencia f
               JOIN alunos a ON f.aluno_id = a.id
               JOIN turmas t ON f.turma_id = t.id WHERE 1=1`;
    const args = [];
    if (turma_id) { sql += ' AND f.turma_id = ?'; args.push(turma_id); }
    if (data) { sql += ' AND f.data = ?'; args.push(data); }
    if (mes && ano) {
      sql += " AND f.data LIKE ?";
      args.push(`${ano}-${mes.padStart(2, '0')}%`);
    }
    sql += ' ORDER BY f.data DESC, a.nome';
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Salvar chamada inteira de uma turma em uma data
app.post('/api/frequencia/chamada', async (req, res) => {
  try {
    const { turma_id, data, dia_semana, registros } = req.body;
    // registros = [{ aluno_id, presente, observacao }]
    if (!turma_id || !data || !dia_semana || !registros) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    const stmts = registros.map(r => ({
      sql: `INSERT INTO frequencia (aluno_id, turma_id, data, dia_semana, presente, observacao)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(aluno_id, data) DO UPDATE SET presente = ?, observacao = ?`,
      args: [r.aluno_id, turma_id, data, dia_semana, r.presente ? 1 : 0, r.observacao || null, r.presente ? 1 : 0, r.observacao || null],
    }));

    await db.batch(stmts);
    res.json({ success: true, total: registros.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Relatório de frequência por aluno
app.get('/api/frequencia/relatorio/:aluno_id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT f.*, a.nome as aluno_nome FROM frequencia f
            JOIN alunos a ON f.aluno_id = a.id
            WHERE f.aluno_id = ? ORDER BY f.data`,
      args: [req.params.aluno_id],
    });
    const total = result.rows.length;
    const presencas = result.rows.filter(r => r.presente === 1).length;
    const faltas = total - presencas;
    res.json({
      aluno_id: req.params.aluno_id,
      total,
      presencas,
      faltas,
      percentual: total > 0 ? ((presencas / total) * 100).toFixed(1) : 0,
      registros: result.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ROTAS - UPLOAD CSV / XLSX
// ========================
app.post('/api/upload', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const { turma_id } = req.body;
    if (!turma_id) return res.status(400).json({ error: 'turma_id é obrigatório' });

    let records = [];
    const filename = req.file.originalname.toLowerCase();

    if (filename.endsWith('.csv')) {
      const content = req.file.buffer.toString('utf-8');
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      records = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    } else {
      return res.status(400).json({ error: 'Formato não suportado. Use CSV ou XLSX.' });
    }

    if (records.length === 0) return res.status(400).json({ error: 'Arquivo vazio' });

    // Tentar identificar colunas (flexível)
    const findCol = (row, ...options) => {
      for (const opt of options) {
        const key = Object.keys(row).find(k => k.toLowerCase().trim().includes(opt.toLowerCase()));
        if (key) return key;
      }
      return null;
    };

    const sample = records[0];
    const nomeCol = findCol(sample, 'nome', 'aluno', 'estudante', 'name');
    const matriculaCol = findCol(sample, 'matric', 'registro', 'ra', 'codigo', 'id');

    if (!nomeCol) {
      return res.status(400).json({
        error: 'Não foi possível identificar a coluna de nome. Use cabeçalho "nome" ou "aluno".',
        colunas_encontradas: Object.keys(sample),
      });
    }

    let inseridos = 0;
    const stmts = [];
    for (const row of records) {
      const nome = row[nomeCol]?.toString().trim();
      if (!nome) continue;
      const matricula = matriculaCol ? row[matriculaCol]?.toString().trim() : null;
      stmts.push({
        sql: 'INSERT INTO alunos (nome, matricula, turma_id) VALUES (?, ?, ?)',
        args: [nome, matricula, turma_id],
      });
      inseridos++;
    }

    if (stmts.length > 0) {
      // Batch em blocos de 50
      for (let i = 0; i < stmts.length; i += 50) {
        await db.batch(stmts.slice(i, i + 50));
      }
    }

    res.json({ success: true, inseridos, colunas: Object.keys(sample) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// EXPORTAR CSV
// ========================
app.get('/api/exportar/alunos', async (req, res) => {
  try {
    const { turma_id } = req.query;
    let sql = `SELECT a.nome, a.matricula, t.nome as turma FROM alunos a
               JOIN turmas t ON a.turma_id = t.id WHERE a.ativo = 1`;
    const args = [];
    if (turma_id) { sql += ' AND a.turma_id = ?'; args.push(turma_id); }
    sql += ' ORDER BY t.nome, a.nome';
    const result = await db.execute({ sql, args });

    let csv = 'nome,matricula,turma\n';
    for (const row of result.rows) {
      csv += `"${row.nome}","${row.matricula || ''}","${row.turma}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=alunos.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exportar frequência
app.get('/api/exportar/frequencia', async (req, res) => {
  try {
    const { turma_id, mes, ano } = req.query;
    let sql = `SELECT a.nome, a.matricula, t.nome as turma, f.data, f.dia_semana, 
               CASE WHEN f.presente = 1 THEN 'Presente' ELSE 'Falta' END as status, f.observacao
               FROM frequencia f
               JOIN alunos a ON f.aluno_id = a.id
               JOIN turmas t ON f.turma_id = t.id WHERE 1=1`;
    const args = [];
    if (turma_id) { sql += ' AND f.turma_id = ?'; args.push(turma_id); }
    if (mes && ano) { sql += " AND f.data LIKE ?"; args.push(`${ano}-${mes.padStart(2, '0')}%`); }
    sql += ' ORDER BY f.data, a.nome';
    const result = await db.execute({ sql, args });

    let csv = 'nome,matricula,turma,data,dia_semana,status,observacao\n';
    for (const row of result.rows) {
      csv += `"${row.nome}","${row.matricula || ''}","${row.turma}","${row.data}","${row.dia_semana}","${row.status}","${row.observacao || ''}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=frequencia.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// INICIAR SERVIDOR
// ========================
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Erro ao inicializar banco:', err);
  process.exit(1);
});
