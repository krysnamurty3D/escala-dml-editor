// Cloud Functions for Escala DML — push notifications (FCM) + publicação
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

initializeApp();
const db = getFirestore();

const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");
const GITHUB_OWNER = "krysnamurty3D";
const GITHUB_PUBLIC_REPO = "escala-dml-public";
const RIDER_CONFIG_URL = "https://raw.githubusercontent.com/krysnamurty3D/escala-dml-public/main/rider-config.json";
const EDITOR_URL = "https://krysnamurty3d.github.io/escala-dml-editor/";
const PUBLICA_URL = "https://krysnamurty3d.github.io/escala-dml-public/";
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// ---------- Publica um arquivo em escala-dml-public usando o token do GitHub guardado no servidor ----------
// Evita depender de um token salvo no localStorage do navegador do editor (que pode ser apagado
// pelo próprio navegador — ex: Safari limpando dados de sites pouco visitados).
exports.publicarArquivo = onCall({ secrets: [GITHUB_TOKEN] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "É preciso estar logado no editor.");
  }
  const { path, content, message } = request.data || {};
  if (!path || typeof content !== "string") {
    throw new HttpsError("invalid-argument", "Parâmetros path e content são obrigatórios.");
  }
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN.value()}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json"
  };
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_PUBLIC_REPO}/contents/${path}`;
  let sha = null;
  const getRes = await fetch(url, { headers });
  if (getRes.ok) {
    const f = await getRes.json();
    sha = f.sha;
  }
  const contentB64 = Buffer.from(content, "utf8").toString("base64");
  const putRes = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message: message || `Atualiza ${path}`, content: contentB64, ...(sha ? { sha } : {}) })
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new HttpsError("internal", `GitHub ${putRes.status}: ${t}`);
  }
  return { ok: true };
});

async function sendToTokens(tokens, title, body, url) {
  if (!tokens.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { title, body, url: url || PUBLICA_URL }
  });
  const invalidos = [];
  res.responses.forEach((r, i) => {
    if (!r.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(r.error?.code)) {
      invalidos.push(tokens[i]);
    }
  });
  await Promise.all(invalidos.map(t => db.collection("pushTokens").doc(t).delete()));
}

async function tokensPorGrupo(slug) {
  const snap = await db.collection("pushTokens").where("grupo", "==", slug).get();
  return snap.docs.map(d => d.id);
}

async function tokensCoordenador() {
  const snap = await db.collection("pushTokens").where("papel", "==", "coordenador").get();
  return snap.docs.map(d => d.id);
}

async function buscarRiderConfig() {
  const res = await fetch(RIDER_CONFIG_URL + "?_=" + Date.now());
  if (!res.ok) throw new Error("rider-config.json indisponível: " + res.status);
  return res.json();
}

function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------- Avisa o coordenador quando chega uma nova solicitação de equipamento ----------
exports.onSolicitacaoCriada = onDocumentCreated("solicitacoes/{id}", async (event) => {
  const s = event.data.data();
  const tokens = await tokensCoordenador();
  await sendToTokens(
    tokens,
    "📦 Nova solicitação de equipamento",
    `${s.grupoNome || s.grupo || "Grupo"}: ${s.item || "—"} (${s.data || ""})`,
    EDITOR_URL
  );
});

// ---------- Avisa o coordenador quando um grupo avisa uma agenda externa (Comunicações) ----------
exports.onAgendaExternaCriada = onDocumentCreated("agendaExterna/{id}", async (event) => {
  const a = event.data.data();
  const tokens = await tokensCoordenador();
  await sendToTokens(
    tokens,
    "📢 Nova agenda externa avisada",
    `${a.grupoNome || a.grupo || "Grupo"}: ${a.local || "—"} (${a.dia || ""} ${a.horario || ""})`,
    EDITOR_URL
  );
});

// ---------- Avisa o coordenador quando um grupo mexe no checklist/horário do Estúdio ----------
exports.onEstudioEscrito = onDocumentWritten("estudio/{slug}", async (event) => {
  if (!event.data.after.exists) return;
  const antes = event.data.before.exists ? event.data.before.data() : null;
  const depois = event.data.after.data();
  if (antes && JSON.stringify(antes) === JSON.stringify(depois)) return;
  const tokens = await tokensCoordenador();
  await sendToTokens(
    tokens,
    "📋 Checklist do Estúdio atualizado",
    `Grupo: ${event.params.slug}`,
    EDITOR_URL
  );
});

// ---------- Lembrete pro grupo enviar o checklist, 1h40 depois que o ensaio começou ----------
exports.lembretesEnsaio = onSchedule("every 15 minutes", async () => {
  let cfg;
  try { cfg = await buscarRiderConfig(); } catch (e) { console.error(e); return; }
  const grupos = cfg.grupos || {};
  const agora = new Date();
  for (const [slug, g] of Object.entries(grupos)) {
    if (g.ensaioDia === undefined || g.ensaioDia === null || g.ensaioDia === "") continue;
    const dia = parseInt(g.ensaioDia);
    const hoje = new Date(agora); hoje.setHours(0, 0, 0, 0);
    const diffAtras = (hoje.getDay() - dia + 7) % 7;
    const dataCiclo = new Date(hoje); dataCiclo.setDate(dataCiclo.getDate() - diffAtras);
    const key = ymd(dataCiclo);
    const [hh, mm] = (g.ensaioHora || "19:30").split(":").map(Number);
    const agendado = new Date(dataCiclo); agendado.setHours(hh || 0, mm || 0, 0, 0);
    const diffMin = (agora - agendado) / 60000;
    if (diffMin < 100 || diffMin >= 115) continue;
    const ref = db.doc(`estudio/${slug}`);
    const snap = await ref.get();
    const ensaios = (snap.exists && snap.data().ensaios) || {};
    const rd = ensaios[key] || {};
    if (rd.lembreteEnviado || rd.semEnsaio || rd.entrada || Object.keys(rd.checklist || {}).length) continue;
    const tokens = await tokensPorGrupo(slug);
    await sendToTokens(
      tokens,
      "🔔 Lembrete do checklist",
      `${g.nome || slug}: não esqueça de preencher o checklist do estúdio!`,
      PUBLICA_URL
    );
    await ref.set({ ensaios: { [key]: { ...rd, lembreteEnviado: true } } }, { merge: true });
  }
});

// ---------- Avisa o coordenador quando um grupo passa 2h do horário sem preencher o checklist ----------
exports.lembretesAtrasados = onSchedule("every 30 minutes", async () => {
  let cfg;
  try { cfg = await buscarRiderConfig(); } catch (e) { console.error(e); return; }
  const grupos = cfg.grupos || {};
  const agora = new Date();
  const atrasados = [];
  for (const [slug, g] of Object.entries(grupos)) {
    if (g.ensaioDia === undefined || g.ensaioDia === null || g.ensaioDia === "") continue;
    const dia = parseInt(g.ensaioDia);
    const hoje = new Date(agora); hoje.setHours(0, 0, 0, 0);
    const diffAtras = (hoje.getDay() - dia + 7) % 7;
    const dataCiclo = new Date(hoje); dataCiclo.setDate(dataCiclo.getDate() - diffAtras);
    const key = ymd(dataCiclo);
    const [hh, mm] = (g.ensaioHora || "19:30").split(":").map(Number);
    const agendado = new Date(dataCiclo); agendado.setHours(hh || 0, mm || 0, 0, 0);
    const prazo = new Date(agendado.getTime() + 2 * 60 * 60 * 1000);
    if (agora < prazo) continue;
    const ref = db.doc(`estudio/${slug}`);
    const snap = await ref.get();
    const ensaios = (snap.exists && snap.data().ensaios) || {};
    const rd = ensaios[key] || {};
    if (rd.semEnsaio || rd.entrada || Object.keys(rd.checklist || {}).length) continue;
    if (rd.alertaCoordenadorEnviado) continue;
    atrasados.push(g.nome || slug);
    await ref.set({ ensaios: { [key]: { ...rd, alertaCoordenadorEnviado: true } } }, { merge: true });
  }
  if (atrasados.length) {
    const tokens = await tokensCoordenador();
    await sendToTokens(tokens, "⚠️ Checklists de ensaio atrasados", atrasados.join(", "), EDITOR_URL);
  }
});
