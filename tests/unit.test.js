// Testes de unidade para as funções puras mais críticas do editor.
//
// Como index.html não é um módulo (é um único <script> pensado para rodar
// direto no navegador), extraímos aqui só as funções que queremos testar
// e rodamos cada uma num sandbox isolado (ver tests/lib/extract.js) — sem
// precisar de um navegador de verdade nem de mocks pesados do Firebase.
//
// Rodar com: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairScriptPrincipal, extrairFuncao, extrairConst, rodarEmSandbox } = require('./lib/extract');

const SOURCE = extrairScriptPrincipal();

// ─────────────────────────────────────────────────────────────
// _slugMes / sessaoIdParaMes
// Bug real corrigido: cada importação do .docx (ou geração pelo
// calendário) criava um ID de sessão aleatório baseado em timestamp.
// Abrir/reimportar "a mesma" escala em dois aparelhos diferentes
// criava dois documentos paralelos no Firestore que nunca convergiam.
// A correção foi tornar o ID determinístico a partir do nome do mês.
// ─────────────────────────────────────────────────────────────
test('_slugMes / sessaoIdParaMes', async (t) => {
  const codigo = [
    extrairFuncao(SOURCE, '_slugMes'),
    extrairFuncao(SOURCE, 'sessaoIdParaMes'),
  ].join('\n');
  const ctx = rodarEmSandbox(codigo);

  await t.test('normaliza espaços e maiúsculas', () => {
    assert.equal(ctx._slugMes('Setembro 2026'), 'setembro-2026');
  });

  await t.test('normaliza ç (único mês com acento em português)', () => {
    assert.equal(ctx._slugMes('Março 2026'), 'marco-2026');
  });

  await t.test('nunca fica vazio (evita id "sess-mes-")', () => {
    assert.equal(ctx._slugMes(''), 'sem-mes');
    assert.equal(ctx._slugMes(undefined), 'sem-mes');
  });

  await t.test('sessaoIdParaMes é determinístico — mesma label, mesmo id sempre', () => {
    const id1 = ctx.sessaoIdParaMes('Outubro 2026');
    const id2 = ctx.sessaoIdParaMes('Outubro 2026');
    assert.equal(id1, id2);
    assert.equal(id1, 'sess-mes-outubro-2026');
  });

  await t.test('meses diferentes geram ids diferentes', () => {
    assert.notEqual(ctx.sessaoIdParaMes('Outubro 2026'), ctx.sessaoIdParaMes('Novembro 2026'));
  });
});

// ─────────────────────────────────────────────────────────────
// uid()
// Bug real corrigido: o contador global reiniciava a cada carregamento
// de página, então um culto adicionado manualmente podia reutilizar um
// id já usado por um culto importado — dois cultos com o mesmo id faziam
// o botão de editar abrir o culto errado.
// ─────────────────────────────────────────────────────────────
test('uid() nunca colide com ids já existentes em cultos[]', () => {
  const codigo = extrairFuncao(SOURCE, 'uid');
  const ctx = rodarEmSandbox(codigo, {
    cultos: [{ id: 'c1' }, { id: 'c2' }, { id: 'c5' }],
    _uid: 0,
  });
  const novoId = ctx.uid();
  assert.ok(!ctx.cultos.some(c => c.id === novoId), `uid() gerou "${novoId}", que já existe`);
  // Precisa ser maior que o maior id numérico já em uso (c5), não reiniciar do zero.
  assert.equal(novoId, 'c6');
});

test('uid() funciona normalmente numa lista vazia', () => {
  const codigo = extrairFuncao(SOURCE, 'uid');
  const ctx = rodarEmSandbox(codigo, { cultos: [], _uid: 0 });
  assert.equal(ctx.uid(), 'c1');
});

// ─────────────────────────────────────────────────────────────
// grupoSlug
// ─────────────────────────────────────────────────────────────
test('grupoSlug normaliza acentos, cedilha, espaços e maiúsculas', () => {
  const codigo = extrairFuncao(SOURCE, 'grupoSlug');
  const ctx = rodarEmSandbox(codigo);
  assert.equal(ctx.grupoSlug('CORAL ROBERT KALLEY'), 'coral_robert_kalley');
  assert.equal(ctx.grupoSlug('Comunhão'), 'comunhao');
  assert.equal(ctx.grupoSlug('S&H (Salmos e Hinos)'), 's_h_salmos_e_hinos');
});

// ─────────────────────────────────────────────────────────────
// sortGrupos — ordem canônica dos badges (S&H primeiro, depois por
// categoria) usada tanto no editor quanto na página pública.
// ─────────────────────────────────────────────────────────────
test('sortGrupos respeita a ordem de categorias definida em getBadgeOrder', () => {
  const codigo = [
    extrairConst(SOURCE, 'SH_LABEL'),
    extrairFuncao(SOURCE, 'getBadgeOrder'),
    extrairConst(SOURCE, 'todosGrupos'),
    extrairFuncao(SOURCE, 'sortGrupos'),
  ].join('\n');
  const GRUPOS = {
    'Grupos Musicais': ['ADONAI'],
    'Corais': ['CORAL X'],
    'Cantores': ['FULANO'],
  };
  const ctx = rodarEmSandbox(codigo, { GRUPOS });
  const SH_LABEL = 'S&H (SALMOS E HINOS)'; // mesmo valor definido em index.html
  const entrada = ['ADONAI', 'FULANO', SH_LABEL, 'CORAL X'];
  // Array.from: o array retornado pelo sandbox (vm) tem um Array.prototype
  // de outro realm — convertemos para o realm atual antes de comparar.
  const ordenado = Array.from(ctx.sortGrupos(entrada));
  // Esperado: S&H, depois Corais, depois Cantores, depois Grupos Musicais.
  assert.deepEqual(ordenado, [SH_LABEL, 'CORAL X', 'FULANO', 'ADONAI']);
});

// ─────────────────────────────────────────────────────────────
// _fmtRelativo — tempo relativo mostrado no indicador de sincronização.
// ─────────────────────────────────────────────────────────────
test('_fmtRelativo formata intervalos de tempo em português', () => {
  const codigo = extrairFuncao(SOURCE, '_fmtRelativo');
  const ctx = rodarEmSandbox(codigo);
  const agora = Date.now();
  assert.equal(ctx._fmtRelativo(null), '');
  assert.equal(ctx._fmtRelativo(agora - 5 * 1000), 'agora mesmo');
  assert.equal(ctx._fmtRelativo(agora - 30 * 1000), 'há 30s');
  assert.equal(ctx._fmtRelativo(agora - 5 * 60 * 1000), 'há 5min');
  assert.equal(ctx._fmtRelativo(agora - 3 * 60 * 60 * 1000), 'há 3h');
  assert.equal(ctx._fmtRelativo(agora - 2 * 24 * 60 * 60 * 1000), 'há 2d');
});

// ─────────────────────────────────────────────────────────────
// matchFiltroDia — filtro multi-seleção de dias da aba Editar.
// ─────────────────────────────────────────────────────────────
test('matchFiltroDia', async (t) => {
  const codigo = extrairFuncao(SOURCE, 'matchFiltroDia');

  await t.test('"todos" sempre aceita qualquer culto', () => {
    const ctx = rodarEmSandbox(codigo, { _filtrosDia: new Set(['todos']) });
    assert.equal(ctx.matchFiltroDia({ dia: 'Sábado' }), true);
  });

  await t.test('filtro de um dia só aceita aquele dia', () => {
    const ctx = rodarEmSandbox(codigo, { _filtrosDia: new Set(['sab']) });
    assert.equal(ctx.matchFiltroDia({ dia: 'Sábado' }), true);
    assert.equal(ctx.matchFiltroDia({ dia: 'Domingo' }), false);
  });

  await t.test('multi-seleção: SÁB + DOM aceita os dois, rejeita o resto', () => {
    const ctx = rodarEmSandbox(codigo, { _filtrosDia: new Set(['sab', 'dom']) });
    assert.equal(ctx.matchFiltroDia({ dia: 'Sábado' }), true);
    assert.equal(ctx.matchFiltroDia({ dia: 'Domingo' }), true);
    assert.equal(ctx.matchFiltroDia({ dia: 'Terça' }), false);
  });

  await t.test('"esp" filtra por culto.especial, não pelo texto do dia', () => {
    const ctx = rodarEmSandbox(codigo, { _filtrosDia: new Set(['esp']) });
    assert.equal(ctx.matchFiltroDia({ dia: 'Segunda', especial: true }), true);
    assert.equal(ctx.matchFiltroDia({ dia: 'Segunda', especial: false }), false);
  });
});

// ─────────────────────────────────────────────────────────────
// _deveMigrarSessaoLocal — REGRESSÃO do bug mais sério encontrado nesta
// sessão: uma rotina de "migração" sobrescrevia a nuvem incondicionalmente
// toda vez que o app abria em qualquer aparelho, usando o cache local
// daquele aparelho específico — mesmo quando esse cache estava
// desatualizado. Isso apagava silenciosamente edições feitas em outros
// aparelhos, sem o usuário nunca clicar em "Salvar".
// ─────────────────────────────────────────────────────────────
test('_deveMigrarSessaoLocal', async (t) => {
  const codigo = extrairFuncao(SOURCE, '_deveMigrarSessaoLocal');
  const ctx = rodarEmSandbox(codigo);

  await t.test('migra se o documento ainda não existe na nuvem', () => {
    assert.equal(ctx._deveMigrarSessaoLocal({ savedAt: 100 }, null), true);
  });

  await t.test('NÃO sobrescreve a nuvem quando ela já é mais recente que o cache local', () => {
    const dadosLocaisAntigos = { savedAt: 1000, cultos: ['versão antiga'] };
    const dadosNuvemNovos = { savedAt: 2000, cultos: ['versão nova, de outro aparelho'] };
    assert.equal(
      ctx._deveMigrarSessaoLocal(dadosLocaisAntigos, dadosNuvemNovos),
      false,
      'isso é exatamente o bug: cache local antigo não pode sobrescrever a nuvem mais nova'
    );
  });

  await t.test('migra quando o cache local é comprovadamente mais novo que a nuvem', () => {
    const dadosLocaisNovos = { savedAt: 2000 };
    const dadosNuvemAntigos = { savedAt: 1000 };
    assert.equal(ctx._deveMigrarSessaoLocal(dadosLocaisNovos, dadosNuvemAntigos), true);
  });

  await t.test('empate (mesmo savedAt) não regrava — evita escrita redundante', () => {
    assert.equal(ctx._deveMigrarSessaoLocal({ savedAt: 500 }, { savedAt: 500 }), false);
  });

  await t.test('lida com savedAt ausente sem lançar erro', () => {
    assert.equal(ctx._deveMigrarSessaoLocal({}, { savedAt: 100 }), false);
    assert.equal(ctx._deveMigrarSessaoLocal({ savedAt: 100 }, {}), true);
  });
});

// ─────────────────────────────────────────────────────────────
// normalizarMesLabel — bug real: importar um .docx sem "mês + ano" no nome
// gerava o rótulo "Escala do Mês", que nunca casa com o mês atual/próximo
// usado pela página pública (a escala simplesmente não aparecia lá).
// ─────────────────────────────────────────────────────────────
test('normalizarMesLabel', async (t) => {
  const codigo = [
    extrairConst(SOURCE, '_MESES_NOMES'),
    extrairFuncao(SOURCE, 'normalizarMesLabel'),
  ].join('\n');
  const ctx = rodarEmSandbox(codigo);

  await t.test('mês + ano completos', () => {
    assert.equal(ctx.normalizarMesLabel('Dezembro 2026'), 'Dezembro 2026');
    assert.equal(ctx.normalizarMesLabel('escala_dezembro_2026'), 'Dezembro 2026');
  });
  await t.test('ano com 2 dígitos', () => {
    assert.equal(ctx.normalizarMesLabel('Escala Dezembro-26'), 'Dezembro 2026');
  });
  await t.test('aceita março sem acento', () => {
    assert.equal(ctx.normalizarMesLabel('marco 2027'), 'Março 2027');
  });
  await t.test('texto sem mês devolve null (nunca um rótulo genérico)', () => {
    assert.equal(ctx.normalizarMesLabel('Escala do Mês'), null);
    assert.equal(ctx.normalizarMesLabel(''), null);
  });
});

// ─────────────────────────────────────────────────────────────
// Escala nova nasce OCULTA da página pública; escalas existentes mantêm
// o estado. E o auto-save nunca pode sobrescrever uma versão mais nova da
// nuvem (bug real: um aparelho com cache antigo apagava edições de outro).
// ─────────────────────────────────────────────────────────────
test('_ocultaPadrao e _nuvemMaisNova', async (t) => {
  const ctx = rodarEmSandbox([extrairFuncao(SOURCE, '_ocultaPadrao'), extrairFuncao(SOURCE, '_nuvemMaisNova')].join('\n'));
  await t.test('escala nova (sem doc salvo) começa oculta', () => { assert.equal(ctx._ocultaPadrao(null), true); });
  await t.test('escala existente sem flag continua visível (não muda o que já está publicado)', () => { assert.equal(ctx._ocultaPadrao({ cultos: [] }), false); });
  await t.test('escala existente respeita o flag salvo', () => {
    assert.equal(ctx._ocultaPadrao({ ocultaPublicacao: true }), true);
    assert.equal(ctx._ocultaPadrao({ ocultaPublicacao: false }), false);
  });
  await t.test('nuvem mais nova que a base bloqueia o auto-save', () => {
    assert.equal(ctx._nuvemMaisNova({ savedAt: 2000 }, 1000), true);
    assert.equal(ctx._nuvemMaisNova({ savedAt: 1000 }, 1000), false);
    assert.equal(ctx._nuvemMaisNova({ savedAt: 500 }, 1000), false);
  });
  await t.test('sem documento na nuvem não bloqueia', () => { assert.equal(ctx._nuvemMaisNova(null, 0), false); });
});

// ─────────────────────────────────────────────────────────────
// autoSalvar — salvamento automático depois de cada edição.
// Regras: só salva se algo mudou desde o último estado salvo; nunca salva
// escala sem mês válido ("Escala do Mês"); e NUNCA sobrescreve uma versão
// mais nova da nuvem (outro aparelho) — pausa e avisa.
// ─────────────────────────────────────────────────────────────
test('autoSalvar', async (t) => {
  const codigo = [
    extrairFuncao(SOURCE, '_nuvemMaisNova'),
    extrairFuncao(SOURCE, 'autoSalvar'),
  ].join('\n');

  function montar(estado) {
    const chamadas = { salvar: [], toasts: [], status: [] };
    const ctx = rodarEmSandbox(codigo, {
      cultos: [{ id: 'c1' }],
      mesLabel: 'Dezembro 2026',
      sessaoId: 'sess-mes-dezembro-2026',
      _snapshotSalvo: null,
      _baseSavedAt: 1000,
      _autoSaveBloqueado: false,
      _autoSaveEmAndamento: false,
      _online: true,
      window: { _fbUser: { uid: 'u' } },
      normalizarMesLabel: (s) => (/(janeiro|dezembro)/i.test(s) ? s : null),
      sessaoIdParaMes: (s) => 'sess-' + s,
      getSessaoFirebase: async () => estado.nuvem ?? null,
      salvarSessao: async (auto) => { chamadas.salvar.push(auto); },
      toast: (m) => chamadas.toasts.push(m),
      setSyncStatus: (s) => chamadas.status.push(s),
      ...estado.ctx,
    });
    return { ctx, chamadas };
  }

  await t.test('salva (em modo automático) quando houve edição', async () => {
    const { ctx, chamadas } = montar({ nuvem: { savedAt: 1000 } });
    await ctx.autoSalvar();
    assert.deepEqual(Array.from(chamadas.salvar), [true]);
  });

  await t.test('não salva se nada mudou desde o último estado salvo', async () => {
    const { ctx, chamadas } = montar({ ctx: { _snapshotSalvo: JSON.stringify([{ id: 'c1' }]) } });
    await ctx.autoSalvar();
    assert.equal(chamadas.salvar.length, 0);
  });

  await t.test('não salva escala sem mês válido (ex: "Escala do Mês")', async () => {
    const { ctx, chamadas } = montar({ ctx: { mesLabel: 'Escala do Mês' } });
    await ctx.autoSalvar();
    assert.equal(chamadas.salvar.length, 0);
  });

  await t.test('NÃO sobrescreve versão mais nova da nuvem: pausa e avisa', async () => {
    const { ctx, chamadas } = montar({ nuvem: { savedAt: 5000 } });
    await ctx.autoSalvar();
    assert.equal(chamadas.salvar.length, 0, 'não pode gravar por cima da nuvem mais nova');
    assert.equal(chamadas.toasts.length, 1);
    assert.equal(ctx._autoSaveBloqueado, true);
  });

  await t.test('depois de bloqueado, não tenta de novo até reabrir/salvar manualmente', async () => {
    const { ctx, chamadas } = montar({ nuvem: { savedAt: 1000 }, ctx: { _autoSaveBloqueado: true } });
    await ctx.autoSalvar();
    assert.equal(chamadas.salvar.length, 0);
  });

  await t.test('não salva lista de cultos vazia', async () => {
    const { ctx, chamadas } = montar({ ctx: { cultos: [] } });
    await ctx.autoSalvar();
    assert.equal(chamadas.salvar.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────
// _resumoVisualizacoes — mostrador de visualizações da página pública no
// cabeçalho do editor: hoje / 7 dias / mês / total.
// ─────────────────────────────────────────────────────────────
test('_resumoVisualizacoes', async (t) => {
  const ctx = rodarEmSandbox(extrairFuncao(SOURCE, '_resumoVisualizacoes'));
  const lista = [
    { dia: '2026-11-26', total: 10, unicos: 6 },  // hoje
    { dia: '2026-11-25', total: 4, unicos: 3 },
    { dia: '2026-11-20', total: 5, unicos: 2 },   // 6 dias atrás: ainda entra nos 7 dias
    { dia: '2026-11-19', total: 7, unicos: 4 },   // 7 dias atrás: fora dos 7 dias, mas no mês
    { dia: '2026-10-31', total: 20, unicos: 9 },  // mês anterior: só no total
  ];
  const r = ctx._resumoVisualizacoes(lista, '2026-11-26');

  await t.test('hoje', () => {
    assert.equal(r.hoje.total, 10);
    assert.equal(r.hoje.unicos, 6);
  });
  await t.test('últimos 7 dias incluem hoje e os 6 anteriores', () => {
    assert.equal(r.sete.total, 10 + 4 + 5);
    assert.equal(r.sete.unicos, 6 + 3 + 2);
  });
  await t.test('mês corrente', () => {
    assert.equal(r.mes.total, 10 + 4 + 5 + 7);
  });
  await t.test('total geral', () => {
    assert.equal(r.total.total, 46);
  });
  await t.test('atravessa a virada de mês nos 7 dias', () => {
    const rr = ctx._resumoVisualizacoes([{ dia: '2026-10-31', total: 3 }, { dia: '2026-11-01', total: 2 }], '2026-11-03');
    assert.equal(rr.sete.total, 5);
    assert.equal(rr.mes.total, 2);
  });
  await t.test('lista vazia ou itens inválidos não quebram', () => {
    assert.equal(ctx._resumoVisualizacoes([], '2026-11-26').total.total, 0);
    assert.equal(ctx._resumoVisualizacoes([null, {}, { dia: '2026-11-26' }], '2026-11-26').hoje.total, 0);
  });
});
