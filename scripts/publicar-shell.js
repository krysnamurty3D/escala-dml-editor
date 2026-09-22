#!/usr/bin/env node
// Extrai o "shell" da página pública (header, cards da home, CSS, JS de
// comportamento) direto do index.html do editor e publica em
// escala-dml-public/index.html via API do GitHub.
//
// Não mexe em dados de escala/cultos: isso já é ao vivo via Firestore
// (coleção escalaPublica), então este script cobre só código/layout.
//
// Executado automaticamente pelo workflow publish-public-shell.yml a cada
// push em main que toque o index.html do editor.

const fs = require('fs');
const path = require('path');

const GITHUB_USER = 'krysnamurty3D';
const GITHUB_REPO = 'escala-dml-public';

function extrairBloco(linhas, inicioRe, fimRe) {
  const iniIdx = linhas.findIndex(l => inicioRe.test(l));
  if (iniIdx === -1) throw new Error(`Início não encontrado: ${inicioRe}`);
  let fimIdx = -1;
  for (let i = iniIdx; i < linhas.length; i++) {
    if (fimRe.test(linhas[i])) { fimIdx = i; break; }
  }
  if (fimIdx === -1) throw new Error(`Fim não encontrado: ${fimRe}`);
  return { src: linhas.slice(iniIdx, fimIdx + 1).join('\n'), iniIdx, fimIdx };
}

function gerarHTML() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const linhas = html.split('\n').map(l => l.replace(/\r$/, ''));

  const logoLinha = linhas.find(l => /^\s*const LOGO=/.test(l));
  if (!logoLinha) throw new Error('LOGO não encontrado');

  const cssBloco = extrairBloco(linhas, /^\s*const CSS=\[/, /^\s*\]\.join\('\\n'\);/);
  const jsBloco = extrairBloco(linhas, /^\s*const JS=\[/, /^\s*\]\.join\('\\n'\);/);
  const hBloco = extrairBloco(linhas, /^\s*const H='<!DOCTYPE html>/, /^\s*\+'<\/body>\\n<\/html>';/);

  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'GITHUB_USER', 'GITHUB_REPO',
    `${logoLinha}\n${cssBloco.src}\n${jsBloco.src}\n${hBloco.src}\nreturn H;`
  );
  const out = fn(GITHUB_USER, GITHUB_REPO);
  if (typeof out !== 'string' || !out.startsWith('<!DOCTYPE html>')) {
    throw new Error('Geração do HTML falhou (resultado inesperado)');
  }
  return out;
}

async function publicarArquivo(caminhoRemoto, conteudoB64, mensagem) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN não definido no ambiente');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'escala-dml-shell-publisher'
  };
  const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${caminhoRemoto}`;

  let sha = null;
  const getRes = await fetch(url, { headers });
  if (getRes.ok) {
    const f = await getRes.json();
    sha = f.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`GET ${url} -> ${getRes.status}: ${await getRes.text()}`);
  }

  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: mensagem,
      content: conteudoB64,
      ...(sha ? { sha } : {})
    })
  });
  if (!putRes.ok) {
    throw new Error(`PUT ${url} -> ${putRes.status}: ${await putRes.text()}`);
  }
  console.log('Publicado com sucesso em', `${GITHUB_USER}/${GITHUB_REPO}/${caminhoRemoto}`);
}

async function publicarShellHTML(htmlFinal) {
  const contentB64 = Buffer.from(htmlFinal, 'utf8').toString('base64');
  await publicarArquivo('index.html', contentB64, 'Atualiza shell da página pública (código/layout)');
}

// Publica manifest.json e os ícones do PWA (necessários para instalar como
// app na tela inicial e, no iOS, pré-requisito para notificações push).
async function publicarAssetsPWA() {
  const raiz = path.join(__dirname, '..');
  const arquivos = [
    { local: 'manifest.json', remoto: 'manifest.json' },
    { local: 'icons/icon-192.png', remoto: 'icons/icon-192.png' },
    { local: 'icons/icon-512.png', remoto: 'icons/icon-512.png' },
    { local: 'icons/apple-touch-icon.png', remoto: 'icons/apple-touch-icon.png' }
  ];
  for (const { local, remoto } of arquivos) {
    const caminho = path.join(raiz, local);
    if (!fs.existsSync(caminho)) { console.warn('Asset PWA não encontrado, pulando:', local); continue; }
    const conteudoB64 = fs.readFileSync(caminho).toString('base64');
    await publicarArquivo(remoto, conteudoB64, `Atualiza asset PWA: ${remoto}`);
  }
}

(async () => {
  try {
    const htmlFinal = gerarHTML();
    await publicarShellHTML(htmlFinal);
    await publicarAssetsPWA();
  } catch (e) {
    console.error('Falha ao publicar shell:', e.message);
    process.exit(1);
  }
})();
