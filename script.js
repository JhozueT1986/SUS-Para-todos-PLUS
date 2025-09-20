// Helpers HTTP
async function request(url, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const a = getAuth();
    if (!a?.token) throw new Error("Não autenticado");
    headers["Authorization"] = "Bearer " + a.token;
  }
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  try {
    const json = JSON.parse(text);
    if (!resp.ok) throw new Error(json?.error || json || text);
    return json;
  } catch {
    if (!resp.ok) throw new Error(text || `Erro HTTP ${resp.status}`);
    return text;
  }
}
function setAuth({ token, nome }) { localStorage.setItem("auth", JSON.stringify({ token, nome })); }
function getAuth() { try { return JSON.parse(localStorage.getItem("auth")); } catch { return null; } }
function clearAuth() { localStorage.removeItem("auth"); }
function setUltimoAgendamento(ag) { localStorage.setItem("ultimoAgendamento", JSON.stringify(ag)); }
function getUltimoAgendamento() { try { return JSON.parse(localStorage.getItem("ultimoAgendamento")); } catch { return null; } }

// --- LOGIN ---
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("nomeLogin").value.trim();
    const senha = document.getElementById("senhaLogin").value.trim();
    try {
      const resp = await request("/login", { method: "POST", body: { nome, senha } });
      setAuth({ token: resp.token, nome: resp.nome });
      alert("Login bem-sucedido!");
      window.location.href = "agendamento.html";
    } catch (err) { alert(err.message || "Falha no login"); }
  });
}

// --- CADASTRO ---
const cadastroForm = document.getElementById("cadastroForm");
if (cadastroForm) {
  cadastroForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("nome").value.trim();
    const telefone = document.getElementById("telefone").value.trim();
    const senha = document.getElementById("senha").value.trim();
    try {
      await request("/cadastro", { method: "POST", body: { nome, telefone, senha } });
      alert("Cadastro realizado com sucesso!");
      window.location.href = "index.html";
    } catch (err) { alert(err.message || "Falha no cadastro"); }
  });
}

// --- PRÉ-TRIAGEM ---
const preForm = document.getElementById("pretriagemForm");
if (preForm) {
  preForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const auth = getAuth(); if (!auth?.token){ alert("Faça login."); return (window.location.href="index.html"); }
    const sintomasGraves = document.getElementById("sintomasGraves").value;
    const sintomas = document.getElementById("sintomas").value;
    try{
      const resp = await request("/pretriagem", { method: "POST", body: { sintomasGraves, sintomas }, auth: true });
      const box = document.getElementById("pretriagemResultado");
      box.textContent = `Nível ${resp.nivel} — ${resp.recomendacao}`;
      box.dataset.nivel = resp.nivel;
    }catch(err){ alert(err.message || "Falha na pré-triagem"); }
  });
}

// --- ESTIMATIVA DE FILA ---
const btnEstimar = document.getElementById("btnEstimarFila");
if (btnEstimar) {
  btnEstimar.addEventListener("click", async ()=>{
    const auth = getAuth(); if (!auth?.token){ alert("Faça login."); return (window.location.href="index.html"); }
    const especialidade = document.getElementById("especialidade").value;
    const data = document.getElementById("data").value;
    const hora = document.getElementById("hora").value;
    if (!especialidade || !data || !hora) return alert("Preencha especialidade, data e hora.");
    try{
      const r = await request("/estimativa-fila", { method:"POST", body:{ especialidade, data, hora }, auth:true });
      document.getElementById("estimativaFila").textContent = `Sua posição estimada será ${r.posicao} (espera ~${r.esperaMin} min).`;
    }catch(err){ alert(err.message || "Falha na estimativa"); }
  });
}

// --- AGENDAMENTO ---
const agendamentoForm = document.getElementById("agendamentoForm");
if (agendamentoForm) {
  agendamentoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const auth = getAuth(); if (!auth?.token){ alert("Faça login."); return (window.location.href="index.html"); }
    const especialidade = document.getElementById("especialidade").value;
    const data = document.getElementById("data").value;
    const hora = document.getElementById("hora").value;

    const nivel = parseInt(document.getElementById("pretriagemResultado")?.dataset?.nivel || "2", 10);

    try {
      const resp = await request("/agendar", { method: "POST", body: { especialidade, data, hora, triagemNivel: nivel }, auth: true });
      const ag = resp?.agendamento || { nome: auth.nome, especialidade, data, hora, id: undefined };
      setUltimoAgendamento(ag);
      alert(`Agendado! Posição ${resp?.fila?.posicao ?? "?"}, espera ~${resp?.fila?.esperaMin ?? "?"} min.`);
      window.location.href = "confirmacao.html";
    } catch (err) { alert(err.message || "Falha ao agendar"); }
  });
}

// --- CONFIRMAÇÃO + LIBERAR VAGA ---
if (document.getElementById("nomeConfirmacao")) {
  const agendamento = getUltimoAgendamento();
  if (agendamento) {
    document.getElementById("nomeConfirmacao").textContent = agendamento.nome || "";
    document.getElementById("especialidadeConfirmacao").textContent = agendamento.especialidade || "";
    document.getElementById("dataConfirmacao").textContent = agendamento.data || "";
    document.getElementById("horaConfirmacao").textContent = agendamento.hora || "";
    document.getElementById("idConfirmacao").textContent = agendamento.id || "(sem id)";
  } else {
    document.getElementById("nomeConfirmacao").textContent = "Erro ao carregar dados.";
  }

  const btn = document.getElementById("btnLiberarVaga");
  btn.addEventListener("click", async ()=>{
    const auth = getAuth(); if (!auth?.token){ alert("Faça login."); return (window.location.href="index.html"); }
    const id = getUltimoAgendamento()?.id;
    if (!id) return alert("Este agendamento não possui ID. Faça um novo agendamento para conseguir liberar a vaga.");
    try{
      await request(`/agendamentos/${id}/cancelar`, { method:"POST", auth:true });
      alert("Vaga liberada! Obrigado por avisar ❤️");
      window.location.href = "agendamento.html";
    }catch(err){ alert(err.message || "Falha ao liberar vaga"); }
  });
}
