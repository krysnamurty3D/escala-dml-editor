// Utilitário para extrair trechos de código do index.html (que não é um
// módulo — é um único <script> gigante rodando direto no navegador) para
// testar funções isoladamente em Node, sem precisar de um DOM real.
//
// A ideia: em vez de rodar o arquivo inteiro (que tem efeitos colaterais
// de topo de arquivo esperando document/localStorage reais), extraímos só
// as funções/variáveis que a gente quer testar e roda esse pedaço num
// sandbox (vm.Script) com stubs mínimos do que essas funções precisam.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');

function lerIndexHtml() {
  return fs.readFileSync(INDEX_HTML_PATH, 'utf8');
}

// Extrai o conteúdo do <script> principal do app (o grande, sem
// type="module") — ignora o script de inicialização do Firebase e
// qualquer <script> que apareça apenas como texto dentro de strings.
function extrairScriptPrincipal() {
  const html = lerIndexHtml();
  const linhas = html.split('\n');
  const aberturas = [];
  linhas.forEach((l, i) => {
    if (/^<script>$/.test(l.trim())) aberturas.push(i);
  });
  if (!aberturas.length) throw new Error('Não encontrei o <script> principal em index.html');
  const inicio = aberturas[0];
  let fim = -1;
  for (let i = inicio; i < linhas.length; i++) {
    if (/^<\/script>$/.test(linhas[i].trim())) { fim = i; break; }
  }
  if (fim === -1) throw new Error('Não encontrei o </script> de fechamento');
  return linhas.slice(inicio + 1, fim).join('\n');
}

// Extrai o texto de uma função nomeada (`function nome(...){...}`) usando
// contagem balanceada de chaves, respeitando strings/template literals
// simples para não se confundir com `{`/`}` dentro de texto.
function extrairFuncao(source, nome) {
  const re = new RegExp(`function\\s+${nome}\\s*\\(`);
  const m = re.exec(source);
  if (!m) throw new Error(`Função "${nome}" não encontrada no source`);
  const inicioParenteses = m.index + m[0].length - 1;
  let i = inicioParenteses;
  // pula até achar a primeira "{" que abre o corpo da função
  while (source[i] !== '{') i++;
  const inicioCorpo = i;
  let depth = 0;
  let emString = null; // ' " ou `
  for (; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (emString) {
      if (ch === emString && prev !== '\\') emString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { emString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return source.slice(m.index, i);
}

// Extrai uma variável top-level simples (`const nome = ...;` ou
// `let nome=...;`) até o `;` de fechamento no mesmo nível (sem entrar
// em objetos/arrays multi-linha complexos — suficiente para os casos
// usados aqui, como GRUPOS_DEFAULT).
function extrairConst(source, nome) {
  const re = new RegExp(`(?:const|let)\\s+${nome}\\s*=`);
  const m = re.exec(source);
  if (!m) throw new Error(`Variável "${nome}" não encontrada no source`);
  let i = m.index + m[0].length;
  let depth = 0;
  let emString = null;
  const inicioValor = i;
  for (; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (emString) {
      if (ch === emString && prev !== '\\') emString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { emString = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  return `${m[0]} ${source.slice(inicioValor, i)};`;
}

// Roda um trecho de código num sandbox novo, com o `contexto` fornecido
// como globals disponíveis, e retorna esse mesmo contexto (já populado
// com o que o código definiu) para os testes inspecionarem.
function rodarEmSandbox(codigo, contexto = {}) {
  const sandbox = { console, ...contexto };
  vm.createContext(sandbox);
  new vm.Script(codigo, { filename: 'sandbox.js' }).runInContext(sandbox);
  return sandbox;
}

module.exports = { lerIndexHtml, extrairScriptPrincipal, extrairFuncao, extrairConst, rodarEmSandbox };
