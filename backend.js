const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "mude-este-segredo-super-seguro";

app.use(bodyParser.json());
app.use(express.static("."));

// ---------- DB ----------
const dbFile = path.join(__dirname, "data.db");
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL,
    telefone TEXT NOT NULL,
    senha_hash TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    especialidade TEXT NOT NULL,
    data TEXT NOT NULL,
    hora TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ativo',
    triagemNivel INTEGER DEFAULT 2,
    criadoEm TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// ---------- Helpers ----------
function token(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" }); }
function auth(req, res, next){
  const [scheme, t] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !t) return res.status(401).send("Token ausente");
  try{
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  }catch(e){ return res.status(401).send("Token inválido/expirado"); }
}

function calcularPosicaoFila({ userId, especialidade, data, hora }, cb){
  db.all(
    `SELECT a.id, a.user_id, a.especialidade, a.data, a.hora, a.criadoEm
     FROM agendamentos a
     WHERE a.status='ativo' AND a.especialidade=? AND a.data=?
     ORDER BY a.hora ASC, a.criadoEm ASC`,
    [especialidade, data],
    (err, rows) => {
      if (err) return cb(err);
      let index = rows.findIndex(r => r.user_id === userId && r.data === data && r.especialidade === especialidade && r.hora === hora);
      if (index === -1) {
        const all = rows.concat([{ user_id: userId, data, especialidade, hora, criadoEm: new Date().toISOString() }])
          .sort((a,b)=> (a.hora.localeCompare(b.hora) || a.criadoEm.localeCompare(b.criadoEm)));
        index = all.findIndex(r => r.user_id === userId && r.hora === hora);
      }
      const posicao = index + 1;
      const tempoMedioMin = 15;
      const esperaMin = (posicao - 1) * tempoMedioMin;
      cb(null, { posicao, esperaMin, total: rows.length });
    }
  );
}

// ---------- Rotas ----------
app.post("/cadastro", (req, res) => {
  const { nome, telefone, senha } = req.body || {};
  if (!nome || !telefone || !senha) return res.status(400).send("Nome, telefone e senha são obrigatórios");
  if (senha.length < 4) return res.status(400).send("A senha deve ter pelo menos 4 caracteres");

  db.get("SELECT id FROM users WHERE nome=?", [nome], async (err, row) => {
    if (err) return res.status(500).send("Erro no servidor");
    if (row) return res.status(400).send("Usuário já cadastrado");
    try{
      const hash = await bcrypt.hash(senha, 10);
      db.run("INSERT INTO users (nome, telefone, senha_hash) VALUES (?,?,?)", [nome, telefone, hash], function(e){
        if (e) return res.status(500).send("Erro ao cadastrar");
        return res.status(200).send("Cadastro realizado com sucesso");
      });
    }catch(e){ return res.status(500).send("Erro ao processar a senha"); }
  });
});

app.post("/login", (req, res) => {
  const { nome, senha } = req.body || {};
  if (!nome || !senha) return res.status(400).send("Nome e senha são obrigatórios");
  db.get("SELECT id, senha_hash FROM users WHERE nome=?", [nome], async (err, row) => {
    if (err) return res.status(500).send("Erro no servidor");
    if (!row) return res.status(401).send("Nome ou senha inválidos");
    const ok = await bcrypt.compare(senha, row.senha_hash);
    if (!ok) return res.status(401).send("Nome ou senha inválidos");
    return res.json({ message:"Login OK", token: token({ id: row.id, nome }), nome });
  });
});

app.post("/pretriagem", auth, (req, res) => {
  const { sintomasGraves, sintomas } = req.body || {};
  const nivel = (sintomasGraves === "sim") ? 1 : 2;
  const recomendacao = (nivel === 1)
    ? "Procure atendimento de urgência (UPA/SAMU)."
    : "Atenção básica/consulta agendada deve atender.";
  return res.json({ nivel, recomendacao, sintomas: sintomas || "" });
});

app.post("/estimativa-fila", auth, (req, res) => {
  const { especialidade, data, hora } = req.body || {};
  if (!especialidade || !data || !hora) return res.status(400).send("Especialidade, data e hora são obrigatórios");
  calcularPosicaoFila({ userId: req.user.id, especialidade, data, hora }, (err, r) => {
    if (err) return res.status(500).send("Erro ao estimar fila");
    return res.json(r);
  });
});

app.post("/agendar", auth, (req, res) => {
  const { especialidade, data, hora, triagemNivel=2 } = req.body || {};
  if (!especialidade || !data || !hora) return res.status(400).send("Campos obrigatórios");
  const criadoEm = new Date().toISOString();
  db.run(
    "INSERT INTO agendamentos (user_id, especialidade, data, hora, status, triagemNivel, criadoEm) VALUES (?,?,?,?,?,?,?)",
    [req.user.id, especialidade, data, hora, "ativo", triagemNivel, criadoEm],
    function(err){
      if (err) return res.status(500).send("Erro ao salvar agendamento");
      const ag = { id: this.lastID, nome: req.user.nome, especialidade, data, hora, criadoEm, status: "ativo", triagemNivel };
      calcularPosicaoFila({ userId: req.user.id, especialidade, data, hora }, (e, pos)=>{
        return res.json({ message: "Agendamento realizado", agendamento: ag, fila: pos });
      });
    }
  );
});

app.post("/agendamentos/:id/cancelar", auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send("ID inválido");
  db.get("SELECT id, user_id FROM agendamentos WHERE id=? AND status='ativo'", [id], (err, row) => {
    if (err) return res.status(500).send("Erro no servidor");
    if (!row) return res.status(404).send("Agendamento não encontrado");
    if (row.user_id !== req.user.id) return res.status(403).send("Sem permissão");
    db.run("UPDATE agendamentos SET status='cancelado' WHERE id=?", [id], (e) => {
      if (e) return res.status(500).send("Erro ao cancelar");
      return res.json({ message: "Vaga liberada com sucesso" });
    });
  });
});

app.get("/agendamentos/me", auth, (req, res) => {
  db.all("SELECT id, especialidade, data, hora, status, triagemNivel, criadoEm FROM agendamentos WHERE user_id=? ORDER BY data ASC, hora ASC", [req.user.id], (err, rows) => {
    if (err) return res.status(500).send("Erro ao listar");
    return res.json(rows || []);
  });
});

app.post("/admin/disparar-lembretes", (req, res) => {
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 24*60*60*1000);
  const d1 = hoje.toISOString().slice(0,10);
  const d2 = amanha.toISOString().slice(0,10);
  db.all(
    `SELECT a.id, a.data, a.hora, u.nome, u.telefone
     FROM agendamentos a
     JOIN users u ON u.id = a.user_id
     WHERE a.status='ativo' AND (a.data=? OR a.data=?)`,
    [d1, d2],
    (err, rows) => {
      if (err) return res.status(500).send("Erro ao checar lembretes");
      rows = rows || [];
      rows.forEach(r => {
        console.log(`[LEMBRETE] Enviar para ${r.nome} (${r.telefone}) -> consulta ${r.data} ${r.hora}.`);
      });
      return res.json({ enviados: rows.length });
    }
  );
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
