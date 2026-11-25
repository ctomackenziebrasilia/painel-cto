// Calendário Olímpico CTO – Painel semanal: gravações pelo site com senha.
//
// O site do painel (https://ctomackenziebrasilia.github.io/painel-cto/) chama este script para:
//   - conferir a senha de ENTRADA (ver o painel) e a senha de GRAVAÇÃO (mudar a planilha);
//   - aplicar na aba Eventos as datas oficiais encontradas pela tarefa semanal;
//   - registrar na aba Radar a decisão da equipe sobre cada olimpíada nova;
//   - CADASTRAR uma olimpíada do Radar direto no calendário (abas Olimpiadas e Eventos);
//   - DESFAZER uma gravação feita pelo painel (até 72 horas depois, se ninguém mexeu nas mesmas células).
// E, sozinho, todo dia de madrugada (VIRADA AUTOMÁTICA DE ANO, ver o fim do arquivo):
//   - quando a última data de uma olimpíada passou há mais de 30 dias, copia as datas para o ano seguinte
//     como "Previsto". Fica anotado no "Registro do painel" e pode ser desfeito pelo painel por 30 dias.
//   - Para ligar (uma vez): selecione a função instalarViradaAutomatica no editor e clique em Executar.
// O nome de quem gravou (digitado no painel) vai para a aba "Registro do painel".
// As senhas ficam guardadas só aqui (resumo criptográfico nas Propriedades do script), nunca no site.
// Cada gravação fica anotada na aba "Registro do painel".
//
// Instalação (uma vez, no computador, logado só na conta do CTO):
//   1. Abra a planilha pública → Extensões → Apps Script.
//   2. Botão + ao lado de "Arquivos" → Script → nome "Painel" → cole este código → Salvar.
//   3. Troque também o arquivo "Agendas" pela versão nova (ela acrescenta o item de menu das senhas).
//   4. Volte à planilha, recarregue a página e use o menu Calendário CTO → "Definir senhas do painel".
//   5. No Apps Script: Implantar → Nova implantação → tipo "App da Web".
//      Executar como: "Eu" (conta do CTO). Quem pode acessar: "Qualquer pessoa". Implantar e autorizar.
//   6. Copie o endereço do app da Web (termina em /exec) e mande para o Claude colocar no site.
// Para trocar uma senha depois: repita o passo 4 (não precisa reimplantar).
// Se mudar este código: Implantar → Gerenciar implantações → lápis → Versão: "Nova versão" → Implantar
// (assim o endereço continua o mesmo).

const PLANILHA_PAINEL = '1wF10E2_omNchLjgwAkMNBRixaEMf1wp17DaxzZsgKag';
const COLUNAS_DATA_PAINEL = ['Inscrição (início)', 'Inscrição (fim)', 'Divulgação aos alunos',
  '1ª Fase (início)', '1ª Fase (fim)', '2ª Fase (início)', '2ª Fase (fim)',
  'Fase Final (início)', 'Fase Final (fim)', 'Resultado', 'Premiação'];
const ETAPAS_PAINEL = ['Inscrição', 'Divulgação aos alunos', '1ª Fase', '2ª Fase', 'Fase Final', 'Resultado', 'Premiação'];
const SITUACOES_RADAR_PAINEL = ['Nova', 'Em análise', 'Cadastrar', 'Descartada'];
const AREAS_PAINEL = ['Matemática', 'Ciências da Natureza', 'Ciências Humanas', 'Linguagens', 'Tecnologia', 'Multidisciplinar / Negócios'];
const CUSTO_PAINEL = {'Gratuita': 'Gratuita', 'Paga por aluno': 'Paga por Aluno', 'Taxa por escola': 'Taxa Única por Escola'};
let AUTOR_PAINEL = '', LOG_PAINEL = [];
const DESFAZER_HORAS_PAINEL = 72; // por quanto tempo uma gravação pode ser desfeita
const MAX_ERROS_PAINEL = 8;          // tentativas erradas de senha...
const BLOQUEIO_SEG_PAINEL = 15 * 60; // ...bloqueiam novas tentativas por 15 minutos
const VIRADA_MARGEM_DIAS = 30;       // virada automática: dias depois da última data da edição
const VIRADA_MARGEM_SO_INSCRICAO_DIAS = 180; // se a linha só tem datas de inscrição/divulgação (prova ainda sem data), espera bem mais
const COLUNAS_SO_INSCRICAO_PAINEL = ['Inscrição (início)', 'Inscrição (fim)', 'Divulgação aos alunos'];
const VIRADA_MAX_POR_DIA = 12;       // mais do que isso num dia só = algo estranho; não vira nada e anota no registro
const VIRADA_DESFAZER_DIAS = 30;     // por quanto tempo uma virada automática pode ser desfeita

// ===== Senhas =====

// Menu da planilha (chamado pelo onOpen do arquivo Agendas).
function definirSenhasPainel() {
  const ui = SpreadsheetApp.getUi();
  const pedir = (titulo) => {
    const r = ui.prompt(titulo, 'Mínimo de 8 caracteres. Deixe em branco para manter a senha atual.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return null;
    return r.getResponseText().trim();
  };
  const entrada = pedir('Senha de ENTRADA do painel (para ver)');
  if (entrada === null) return;
  const gravacao = pedir('Senha de GRAVAÇÃO do painel (para mudar a planilha)');
  if (gravacao === null) return;
  const props = PropertiesService.getScriptProperties();
  const msgs = [];
  for (const [nome, valor] of [['entrada', entrada], ['gravacao', gravacao]]) {
    if (!valor) { msgs.push(`Senha de ${nome}: mantida.`); continue; }
    if (valor.length < 8) { ui.alert(`A senha de ${nome} precisa ter pelo menos 8 caracteres. Nada foi alterado.`); return; }
    const sal = Utilities.getUuid();
    props.setProperty(`painel_sal_${nome}`, sal);
    props.setProperty(`painel_hash_${nome}`, resumoPainel_(sal, valor));
    msgs.push(`Senha de ${nome}: definida.`);
  }
  if (entrada && gravacao && entrada === gravacao) msgs.push('Atenção: as duas senhas são iguais. O ideal é usar senhas diferentes.');
  CacheService.getScriptCache().remove('painel_erros');
  ui.alert(msgs.join('\n'));
}

function resumoPainel_(sal, senha) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + senha, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function confereSenhaPainel_(nome, senha) {
  const props = PropertiesService.getScriptProperties();
  const sal = props.getProperty(`painel_sal_${nome}`), hash = props.getProperty(`painel_hash_${nome}`);
  if (!sal || !hash || typeof senha !== 'string' || !senha) return false;
  return resumoPainel_(sal, senha) === hash;
}

// Bloqueio simples contra tentativas repetidas (vale para todos, por 15 min).
function bloqueadoPainel_() {
  return Number(CacheService.getScriptCache().get('painel_erros') || 0) >= MAX_ERROS_PAINEL;
}
function erroSenhaPainel_() {
  const c = CacheService.getScriptCache();
  c.put('painel_erros', String(Number(c.get('painel_erros') || 0) + 1), BLOQUEIO_SEG_PAINEL);
}

// ===== Entrada do app da Web =====

function doGet() {
  return jsonPainel_({ok: true, painel: 'ativo'});
}

function doPost(e) {
  let pedido;
  try { pedido = JSON.parse(e.postData.contents); } catch (err) { return jsonPainel_({ok: false, erro: 'pedido_invalido'}); }
  if (bloqueadoPainel_()) return jsonPainel_({ok: false, erro: 'bloqueado', msg: 'Muitas senhas erradas. Tente de novo em 15 minutos.'});
  const acao = String(pedido.acao || '');
  AUTOR_PAINEL = String(pedido.autor || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  LOG_PAINEL = [];
  const gravar = acao !== 'entrar';
  const okGravacao = confereSenhaPainel_('gravacao', pedido.senha);
  const okEntrada = okGravacao || confereSenhaPainel_('entrada', pedido.senha);
  if (gravar ? !okGravacao : !okEntrada) {
    erroSenhaPainel_();
    return jsonPainel_({ok: false, erro: 'senha', msg: gravar ? 'Senha de gravação incorreta.' : 'Senha incorreta.'});
  }
  const lock = LockService.getScriptLock();
  if (gravar && !lock.tryLock(20000)) return jsonPainel_({ok: false, erro: 'ocupado', msg: 'A planilha está ocupada. Tente de novo em instantes.'});
  try {
    if (acao === 'entrar') return jsonPainel_({ok: true, podeGravar: okGravacao});
    if (acao === 'aplicarDatas') return jsonPainel_(aplicarDatasPainel_(pedido));
    if (acao === 'decidirRadar') return jsonPainel_(decidirRadarPainel_(pedido));
    if (acao === 'cadastrarRadar') return jsonPainel_(cadastrarRadarPainel_(pedido));
    if (acao === 'desfazer') return jsonPainel_(desfazerPainel_(pedido));
    return jsonPainel_({ok: false, erro: 'acao_desconhecida'});
  } catch (err) {
    console.error(err);
    return jsonPainel_({ok: false, erro: 'falha', msg: 'Erro no script: ' + err.message});
  } finally {
    if (gravar) lock.releaseLock();
  }
}

function jsonPainel_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== Ações =====

// pedido: {sigla, link, verificacao: 'DD/MM/AAAA', forcar: bool, itens: [{coluna, oficial: 'DD/MM/AAAA', planilha: 'DD/MM/AAAA' ou ''}]}
function aplicarDatasPainel_(p) {
  const sigla = String(p.sigla || '').trim();
  const itens = Array.isArray(p.itens) ? p.itens : [];
  const link = String(p.link || '');
  if (!sigla || !itens.length) return {ok: false, erro: 'dados', msg: 'Pedido sem sigla ou sem datas.'};
  if (!/^https?:\/\//i.test(link)) return {ok: false, erro: 'dados', msg: 'Link da fonte inválido.'};
  const aba = SpreadsheetApp.openById(PLANILHA_PAINEL).getSheetByName('Eventos');
  const valores = aba.getDataRange().getValues();
  const mostrados = aba.getDataRange().getDisplayValues();
  const tit = valores[0].map(v => String(v).trim());
  const col = t => tit.indexOf(t);
  for (const t of ['Sigla', 'Situação', 'Etapas confirmadas', 'Detalhes', 'Fonte das datas']) {
    if (col(t) < 0) return {ok: false, erro: 'planilha', msg: `Coluna "${t}" não encontrada na aba Eventos.`};
  }
  const r = valores.findIndex((row, i) => i > 0 && String(row[col('Sigla')]).trim() === sigla);
  if (r < 0) return {ok: false, erro: 'dados', msg: `Sigla ${sigla} não encontrada na aba Eventos.`};

  // Confere tudo antes de gravar qualquer coisa.
  const conflitos = [];
  const novos = [];
  for (const it of itens) {
    const c = col(String(it.coluna));
    if (COLUNAS_DATA_PAINEL.indexOf(String(it.coluna)) < 0 || c < 0) return {ok: false, erro: 'dados', msg: `Coluna inválida: ${it.coluna}`};
    const d = dataPainel_(it.oficial);
    if (!d) return {ok: false, erro: 'dados', msg: `Data inválida: ${it.oficial}`};
    const atual = mostrados[r][c];
    if (atual !== String(it.planilha || '') && atual !== it.oficial) conflitos.push(`${it.coluna}: está ${atual || 'vazio'}, esperado ${it.planilha || 'vazio'}`);
    novos.push([c, d, it.oficial, String(it.coluna)]);
  }
  if (conflitos.length && !p.forcar) return {ok: false, erro: 'conflito', conflitos};

  const linha = r + 1;
  for (const [c, d] of novos) gravarPainel_(aba, linha, c + 1, d);

  const etapas = new Set(String(valores[r][col('Etapas confirmadas')] || '').split(',').map(s => s.trim()).filter(Boolean));
  novos.forEach(n => etapas.add(n[3].replace(/ \((início|fim)\)$/, '')));
  const listaEtapas = ETAPAS_PAINEL.filter(e => etapas.has(e));
  // Datas preenchidas na linha (depois da gravação) – todas oficiais?
  const preenchidas = COLUNAS_DATA_PAINEL.filter(t => col(t) >= 0 &&
    (novos.some(n => n[3] === t) || String(mostrados[r][col(t)]).trim() !== ''));
  const tudo = preenchidas.length > 0 && preenchidas.every(t => etapas.has(t.replace(/ \((início|fim)\)$/, '')));
  const verif = String(p.verificacao || Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy'));
  let det = String(valores[r][col('Detalhes')] || '').replace(/ ?Datas oficiais conferidas em [^.]*\./, '');
  if (tudo) det = det.replace(/Previsão com base.*?\.(?=\s|$)\s*/g, '').replace(/Virada automática em [^.]*\.\s*/g, '');
  det = (det + ` Datas oficiais conferidas em ${verif} (painel): ${listaEtapas.join(', ')}.`).trim();

  gravarPainel_(aba, linha, col('Etapas confirmadas') + 1, listaEtapas.join(', '));
  gravarPainel_(aba, linha, col('Fonte das datas') + 1, link);
  gravarPainel_(aba, linha, col('Detalhes') + 1, det);
  const situacaoAntes = String(valores[r][col('Situação')]);
  if (tudo && situacaoAntes !== 'Cancelado') gravarPainel_(aba, linha, col('Situação') + 1, 'Confirmado');
  SpreadsheetApp.flush();

  // Lê de volta para conferir.
  const depois = aba.getRange(linha, 1, 1, tit.length).getDisplayValues()[0];
  const falhas = novos.filter(n => depois[n[0]] !== n[2]).map(n => `${n[3]} ficou ${depois[n[0]] || 'vazio'}`);
  registrarPainel_('Aplicar datas', sigla, novos.map(n => `${n[3]}=${n[2]}`).join('; ') + (conflitos.length ? ' (gravado mesmo com conflito)' : ''));
  if (falhas.length) return {ok: false, erro: 'conferencia', msg: 'Gravei, mas a conferência mostrou: ' + falhas.join('; '), desfazer: guardarDesfazerPainel_('Aplicar datas', sigla)};
  return {ok: true, etapas: listaEtapas.join(', '), confirmado: tudo, desfazer: guardarDesfazerPainel_('Aplicar datas', sigla)};
}

// pedido: {sigla, situacao, motivo}
function decidirRadarPainel_(p) {
  const sigla = String(p.sigla || '').trim();
  const situacao = String(p.situacao || '');
  const motivo = String(p.motivo || '').slice(0, 500);
  if (SITUACOES_RADAR_PAINEL.indexOf(situacao) < 0) return {ok: false, erro: 'dados', msg: 'Situação inválida.'};
  const aba = SpreadsheetApp.openById(PLANILHA_PAINEL).getSheetByName('Radar');
  if (!aba) return {ok: false, erro: 'planilha', msg: 'Aba Radar não encontrada.'};
  const valores = aba.getDataRange().getValues();
  const tit = valores[0].map(v => String(v).trim());
  const col = t => tit.indexOf(t);
  for (const t of ['Sigla', 'Situação', 'Motivo', 'Decidido em']) {
    if (col(t) < 0) return {ok: false, erro: 'planilha', msg: `Coluna "${t}" não encontrada na aba Radar.`};
  }
  const r = valores.findIndex((row, i) => i > 0 && String(row[col('Sigla')]).trim() === sigla);
  if (r < 0) return {ok: false, erro: 'dados', msg: `Sigla ${sigla} não encontrada na aba Radar.`};
  if (String(valores[r][col('Situação')]) === 'Cadastrada') return {ok: false, erro: 'dados', msg: 'Esta olimpíada já foi cadastrada no calendário.'};
  const linha = r + 1;
  gravarPainel_(aba, linha, col('Situação') + 1, situacao);
  gravarPainel_(aba, linha, col('Motivo') + 1, motivo);
  gravarPainel_(aba, linha, col('Decidido em') + 1, Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') + (AUTOR_PAINEL ? ' – ' + AUTOR_PAINEL : ''));
  registrarPainel_('Decisão no radar', sigla, situacao + (motivo ? ' – ' + motivo : ''));
  return {ok: true, desfazer: guardarDesfazerPainel_('Decisão no radar', sigla)};
}

// pedido: {sigla, area (opcional; senão usa "Área no calendário" da aba Radar), motivo}
// Lê tudo da aba Radar (nunca do site), confere e grava uma linha nova em Olimpiadas e em Eventos.
function cadastrarRadarPainel_(p) {
  const sigla = String(p.sigla || '').trim();
  const ss = SpreadsheetApp.openById(PLANILHA_PAINEL);
  const radar = ss.getSheetByName('Radar'), olim = ss.getSheetByName('Olimpiadas'), eventos = ss.getSheetByName('Eventos');
  if (!radar || !olim || !eventos) return {ok: false, erro: 'planilha', msg: 'Aba Radar, Olimpiadas ou Eventos não encontrada.'};
  const rv = radar.getDataRange().getDisplayValues();
  const rt = rv[0].map(v => String(v).trim()), rc = t => rt.indexOf(t);
  const r = rv.findIndex((row, i) => i > 0 && String(row[rc('Sigla')]).trim() === sigla);
  if (!sigla || r < 0) return {ok: false, erro: 'dados', msg: `Sigla ${sigla} não encontrada na aba Radar.`};
  const R = t => rc(t) >= 0 ? String(rv[r][rc(t)] || '').trim() : '';
  if (R('Situação') === 'Cadastrada') return {ok: false, erro: 'dados', msg: 'Esta olimpíada já foi cadastrada.'};

  // Não pode repetir sigla nem nome do calendário.
  const ov = olim.getDataRange().getDisplayValues();
  const ot = ov[0].map(v => String(v).trim()), oc = t => ot.indexOf(t);
  const nome = R('Olimpíada');
  const norm = v => String(v).trim().toLowerCase();
  if (ov.some((row, i) => i > 0 && (norm(row[oc('Sigla')]) === norm(sigla) || (nome && norm(row[oc('Nome')]) === norm(nome))))) {
    return {ok: false, erro: 'dados', msg: `Já existe ${sigla} (ou o mesmo nome) na aba Olimpiadas.`};
  }
  const area = String(p.area || R('Área no calendário')).trim();
  if (AREAS_PAINEL.indexOf(area) < 0) return {ok: false, erro: 'dados', msg: 'Escolha a área da olimpíada no calendário.'};
  const segs = R('Segmentos').split('/').map(s => s.trim());
  if (!['EFAI', 'EFAF', 'EM'].some(s => segs.indexOf(s) >= 0)) return {ok: false, erro: 'dados', msg: 'Preencha os Segmentos na aba Radar antes de cadastrar.'};

  // Datas: "Coluna=DD/MM/AAAA; ..."
  const datas = [];
  for (const parte of R('Datas para cadastro').split(';').map(s => s.trim()).filter(Boolean)) {
    const i = parte.indexOf('=');
    const col = parte.slice(0, i).trim(), d = dataPainel_(parte.slice(i + 1).trim());
    if (i < 0 || COLUNAS_DATA_PAINEL.indexOf(col) < 0 || !d) return {ok: false, erro: 'dados', msg: `Data inválida em "Datas para cadastro": ${parte}`};
    datas.push([col, d]);
  }
  let situacao = R('Situação das datas');
  if (['Previsto', 'Previsto (só o mês)', 'Confirmado', ''].indexOf(situacao) < 0) return {ok: false, erro: 'dados', msg: 'Situação das datas inválida.'};
  if (!datas.length) situacao = '';
  else if (!situacao) situacao = 'Previsto';
  const etapas = R('Etapas oficiais').split(',').map(s => s.trim()).filter(e => ETAPAS_PAINEL.indexOf(e) >= 0);
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy');
  const link = /^https?:\/\//i.test(R('Fonte das datas')) ? R('Fonte das datas') : (/^https?:\/\//i.test(R('Fonte oficial')) ? R('Fonte oficial') : '');

  // 1) Olimpiadas (primeiro: a aba Eventos só aceita siglas que existem aqui).
  const lo = primeiraLinhaLivrePainel_(olim, oc('Sigla') + 1);
  const obs = [R('Observação'), R('Alertas') ? 'A conferir: ' + R('Alertas') : '', `Cadastrada pelo painel em ${hoje}.`].filter(Boolean).join(' ');
  const valoresO = {'Sigla': sigla, 'Nome': nome, 'Área': area, 'EFAI': segs.indexOf('EFAI') >= 0 ? 'OK' : '',
    'EFAF': segs.indexOf('EFAF') >= 0 ? 'OK' : '', 'EM': segs.indexOf('EM') >= 0 ? 'OK' : '',
    'Do ano': R('Do ano'), 'Até o ano': R('Até o ano'), 'Site oficial': /^https?:\/\//i.test(R('Fonte oficial')) ? R('Fonte oficial') : '',
    'Modalidade': R('Modalidade'), 'Custo': CUSTO_PAINEL[R('Tipo de custo')] || '', 'Inscrição por': R('Inscrição por'), 'Observações': obs};
  for (const [t, v] of Object.entries(valoresO)) if (oc(t) >= 0 && v !== '') gravarPainel_(olim, lo, oc(t) + 1, v);

  // 2) Eventos
  const et = eventos.getRange(1, 1, 1, eventos.getLastColumn()).getDisplayValues()[0].map(v => String(v).trim()), ec = t => et.indexOf(t);
  const le = primeiraLinhaLivrePainel_(eventos, ec('Sigla') + 1);
  const det = [R('Detalhes para cadastro'), `Cadastrada pelo painel em ${hoje}.`].filter(Boolean).join(' ');
  const valoresE = {'Sigla': sigla, 'Situação': situacao, 'Etapas confirmadas': etapas.join(', '), 'Detalhes': det, 'Fonte das datas': link};
  for (const [t, v] of Object.entries(valoresE)) if (ec(t) >= 0 && v !== '') gravarPainel_(eventos, le, ec(t) + 1, v);
  for (const [col, d] of datas) if (ec(col) >= 0) gravarPainel_(eventos, le, ec(col) + 1, d);

  // 3) Radar
  const lr = r + 1;
  gravarPainel_(radar, lr, rc('Situação') + 1, 'Cadastrada');
  if (rc('Decidido em') >= 0) gravarPainel_(radar, lr, rc('Decidido em') + 1, Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') + (AUTOR_PAINEL ? ' – ' + AUTOR_PAINEL : ''));
  if (rc('Motivo') >= 0 && p.motivo) gravarPainel_(radar, lr, rc('Motivo') + 1, String(p.motivo).slice(0, 500));
  if (rc('Área no calendário') >= 0 && area !== R('Área no calendário')) gravarPainel_(radar, lr, rc('Área no calendário') + 1, area);
  SpreadsheetApp.flush();
  registrarPainel_('Cadastro no calendário', sigla, `Olimpiadas linha ${lo}, Eventos linha ${le}; ${datas.length} datas (${situacao || 'sem datas'})`);
  return {ok: true, linhaOlimpiadas: lo, linhaEventos: le, situacao, datas: datas.length, desfazer: guardarDesfazerPainel_('Cadastro no calendário', sigla)};
}

// Primeira linha (a partir da 2) com a coluna da Sigla vazia; cria linhas se precisar.
function primeiraLinhaLivrePainel_(aba, colSigla) {
  const n = aba.getMaxRows();
  const vals = aba.getRange(2, colSigla, n - 1, 1).getValues();
  let ultima = 0;
  vals.forEach((v, i) => { if (String(v[0]).trim() !== '') ultima = i + 1; });
  const linha = ultima + 2;
  if (linha > n) aba.insertRowsAfter(n, 10);
  return linha;
}

// ===== Apoio =====

// Cria a data à meia-noite no fuso da PLANILHA (se usar o fuso do script, a data pode cair um dia antes).
let FUSO_PLANILHA_PAINEL = null;
function dataPainel_(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > new Date(Number(m[3]), mes, 0).getDate()) return null;
  if (!FUSO_PLANILHA_PAINEL) FUSO_PLANILHA_PAINEL = SpreadsheetApp.openById(PLANILHA_PAINEL).getSpreadsheetTimeZone();
  return Utilities.parseDate(`${m[1]}/${m[2]}/${m[3]} 00:00`, FUSO_PLANILHA_PAINEL, 'dd/MM/yyyy HH:mm');
}

function registrarPainel_(acao, sigla, detalhe) {
  const ss = SpreadsheetApp.openById(PLANILHA_PAINEL);
  let aba = ss.getSheetByName('Registro do painel');
  if (!aba) {
    aba = ss.insertSheet('Registro do painel');
    aba.appendRow(['Quando', 'Quem', 'Ação', 'Sigla', 'Detalhe']);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 5).setFontWeight('bold');
  } else if (String(aba.getRange(1, 2).getValue()).trim() !== 'Quem') {
    aba.insertColumnAfter(1);
    aba.getRange(1, 2).setValue('Quem').setFontWeight('bold');
  }
  aba.appendRow([Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'), AUTOR_PAINEL || '(sem nome)', acao, sigla, detalhe]);
}

// ===== Desfazer =====

// Grava uma célula guardando o valor anterior (para poder desfazer).
function gravarPainel_(aba, linha, col, valor) {
  const r = aba.getRange(linha, col);
  LOG_PAINEL.push({aba: aba.getName(), l: linha, c: col, antes: valorGuardadoPainel_(r.getValue())});
  r.setValue(valor);
}

function valorGuardadoPainel_(v) {
  if (v instanceof Date) {
    if (!FUSO_PLANILHA_PAINEL) FUSO_PLANILHA_PAINEL = SpreadsheetApp.openById(PLANILHA_PAINEL).getSpreadsheetTimeZone();
    return {d: Utilities.formatDate(v, FUSO_PLANILHA_PAINEL, 'dd/MM/yyyy')};
  }
  return v;
}

// Guarda o que foi gravado nesta chamada e devolve o código para desfazer.
function guardarDesfazerPainel_(acao, sigla, horas, extra) {
  if (!LOG_PAINEL.length) return '';
  SpreadsheetApp.flush();
  const ss = SpreadsheetApp.openById(PLANILHA_PAINEL);
  LOG_PAINEL.forEach(x => { x.depois = ss.getSheetByName(x.aba).getRange(x.l, x.c).getDisplayValue(); });
  const props = PropertiesService.getScriptProperties();
  for (const k of props.getKeys()) {
    if (k.indexOf('desfazer_') !== 0) continue;
    try { if (prazoDesfazerPainel_(JSON.parse(props.getProperty(k))) < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  }
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  props.setProperty('desfazer_' + id, JSON.stringify(Object.assign({quando: Date.now(), ate: Date.now() + (horas || DESFAZER_HORAS_PAINEL) * 3600 * 1000, acao, sigla, celulas: LOG_PAINEL}, extra || {})));
  return id;
}

function prazoDesfazerPainel_(reg) {
  return reg.ate || (reg.quando + DESFAZER_HORAS_PAINEL * 3600 * 1000);
}

// pedido: {id, forcar}
function desfazerPainel_(p) {
  const id = String(p.id || '').replace(/[^0-9a-f]/gi, '');
  const props = PropertiesService.getScriptProperties();
  const bruto = id ? props.getProperty('desfazer_' + id) : null;
  if (!bruto) return {ok: false, erro: 'dados', msg: 'Não dá mais para desfazer esta gravação (passou o prazo ou já foi desfeita).'};
  const reg = JSON.parse(bruto);
  if (prazoDesfazerPainel_(reg) < Date.now()) {
    props.deleteProperty('desfazer_' + id);
    return {ok: false, erro: 'dados', msg: 'Não dá mais para desfazer esta gravação (passou o prazo).'};
  }
  const ss = SpreadsheetApp.openById(PLANILHA_PAINEL);
  const mudadas = reg.celulas.filter(x => ss.getSheetByName(x.aba).getRange(x.l, x.c).getDisplayValue() !== x.depois);
  if (mudadas.length && !p.forcar) {
    return {ok: false, erro: 'conflito', conflitos: mudadas.map(x => `${x.aba}, linha ${x.l}: alguém mudou depois`)};
  }
  for (const x of reg.celulas.slice().reverse()) {
    const v = x.antes && typeof x.antes === 'object' && x.antes.d ? dataPainel_(x.antes.d) : x.antes;
    ss.getSheetByName(x.aba).getRange(x.l, x.c).setValue(v === null || v === undefined ? '' : v);
  }
  SpreadsheetApp.flush();
  props.deleteProperty('desfazer_' + id);
  // Virada desfeita: não repetir a virada desta mesma edição nos próximos dias.
  if (reg.pular) props.setProperty('virada_pular_' + reg.sigla, reg.pular);
  registrarPainel_('Desfazer', reg.sigla, `Desfeito: ${reg.acao}` + (mudadas.length ? ' (mesmo com mudanças depois)' : '') +
    (reg.pular ? '. A virada automática não será repetida para esta edição; ela volta a valer quando as datas da linha mudarem.' : ''));
  return {ok: true, acao: reg.acao, sigla: reg.sigla};
}

// ===== Virada automática de ano =====
// Todo dia, de madrugada, olha cada linha da aba Eventos (menos as "Cancelado").
// Se a ÚLTIMA data preenchida passou há mais de VIRADA_MARGEM_DIAS dias, a edição acabou
// (se a linha só tem datas de inscrição/divulgação, espera VIRADA_MARGEM_SO_INSCRICAO_DIAS, porque a prova pode estar sem data):
// todas as datas da linha vão para o ano seguinte (mesmo dia e mês; 29/02 vira 28/02),
// a Situação volta para "Previsto" ("Previsto (só o mês)" continua igual), "Etapas confirmadas" fica vazia
// e "Detalhes" ganha uma frase explicando. "Fonte das datas" continua a da edição anterior (é a base da previsão).
// Depois a tarefa semanal do Claude procura o edital novo e a equipe aplica as datas oficiais pelo painel.

// Rodar UMA vez no editor (Executar) para ligar. Rodar de novo não duplica.
function instalarViradaAutomatica() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'viradaAutomatica').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('viradaAutomatica').timeBased().everyDays(1).atHour(3).inTimezone('America/Sao_Paulo').create();
  const r = viradaPainel_(true);
  console.log('Virada automática ligada: roda todo dia por volta das 3h. ' + resumoViradaPainel_(r));
}

// Para desligar, se um dia precisar.
function desligarViradaAutomatica() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'viradaAutomatica').forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Virada automática desligada.');
}

// Mostra o que viraria hoje, sem gravar nada.
function testarViradaAutomatica() {
  console.log(resumoViradaPainel_(viradaPainel_(true)));
}

// Chamada pelo gatilho diário.
function viradaAutomatica() {
  viradaPainel_(false);
}

function resumoViradaPainel_(r) {
  if (!r.lista.length) return 'Hoje nenhuma olimpíada precisa virar de ano.';
  return `Hoje ${r.simular ? 'virariam' : 'viraram'}: ` + r.lista.map(x => `${x.sigla} (${x.anoBase} → ${x.anoBase + x.anos})`).join(', ') + (r.suspensa ? ' – SUSPENSA (muitas de uma vez)' : '');
}

function viradaPainel_(simular) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return {simular, lista: [], suspensa: false};
  try {
    const ss = SpreadsheetApp.openById(PLANILHA_PAINEL);
    FUSO_PLANILHA_PAINEL = ss.getSpreadsheetTimeZone();
    const fuso = FUSO_PLANILHA_PAINEL;
    const aba = ss.getSheetByName('Eventos');
    const valores = aba.getDataRange().getValues();
    const tit = valores[0].map(v => String(v).trim());
    const col = t => tit.indexOf(t);
    for (const t of ['Sigla', 'Situação', 'Etapas confirmadas', 'Detalhes']) if (col(t) < 0) throw new Error(`Coluna "${t}" não encontrada na aba Eventos.`);
    const iso = d => Utilities.formatDate(d, fuso, 'yyyy-MM-dd');
    const br = s => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
    const somaAnos = (s, n) => { let d = s.slice(5); if (d === '02-29') d = '02-28'; return (Number(s.slice(0, 4)) + n) + '-' + d; };
    const hoje = iso(new Date());
    const limiteNormal = iso(new Date(Date.now() - VIRADA_MARGEM_DIAS * 864e5));
    const limiteSoInscricao = iso(new Date(Date.now() - VIRADA_MARGEM_SO_INSCRICAO_DIAS * 864e5));
    const colsSoInscricao = COLUNAS_SO_INSCRICAO_PAINEL.map(t => col(t));
    const colsData = COLUNAS_DATA_PAINEL.map(t => col(t)).filter(c => c >= 0);

    const lista = [];
    for (let r = 1; r < valores.length; r++) {
      const sigla = String(valores[r][col('Sigla')]).trim();
      const situacao = String(valores[r][col('Situação')]).trim();
      if (!sigla || situacao === 'Cancelado') continue;
      const datas = colsData.filter(c => valores[r][c] instanceof Date).map(c => [c, iso(valores[r][c])]);
      if (!datas.length) continue;
      const ultima = datas.map(d => d[1]).sort().pop();
      // Só inscrição/divulgação preenchidas: a prova pode ainda acontecer sem data na planilha; espera 180 dias.
      const soInscricao = datas.every(d => colsSoInscricao.indexOf(d[0]) >= 0);
      const limite = soInscricao ? limiteSoInscricao : limiteNormal;
      if (ultima >= limite) continue;
      if (PropertiesService.getScriptProperties().getProperty('virada_pular_' + sigla) === ultima) continue; // virada desfeita pela equipe
      let anos = 1;
      while (somaAnos(ultima, anos) < limite && anos < 5) anos++;
      lista.push({r, sigla, situacao, datas, ultima, anos, soInscricao, anoBase: Number(ultima.slice(0, 4))});
    }
    if (simular || !lista.length) return {simular, lista, suspensa: false};

    AUTOR_PAINEL = 'Automático';
    if (lista.length > VIRADA_MAX_POR_DIA) {
      LOG_PAINEL = [];
      registrarPainel_('Virada automática suspensa', '', `${lista.length} olimpíadas iriam virar de ano no mesmo dia (${lista.map(x => x.sigla).join(', ')}). Nada foi mudado: confira a aba Eventos.`);
      return {simular, lista, suspensa: true};
    }
    for (const x of lista) {
      LOG_PAINEL = [];
      const linha = x.r + 1;
      for (const [c, d] of x.datas) gravarPainel_(aba, linha, c + 1, dataPainel_(br(somaAnos(d, x.anos))));
      if (x.situacao !== 'Previsto' && x.situacao !== 'Previsto (só o mês)') gravarPainel_(aba, linha, col('Situação') + 1, 'Previsto');
      const etapas = String(valores[x.r][col('Etapas confirmadas')] || '').trim();
      if (etapas) gravarPainel_(aba, linha, col('Etapas confirmadas') + 1, '');
      let det = String(valores[x.r][col('Detalhes')] || '')
        .replace(/ ?Datas oficiais conferidas em [^.]*\./g, '')
        .replace(/Virada automática em [^.]*\.\s*/g, '');
      if (etapas) det = det.replace(/Previsão com base.*?\.(?=\s|$)\s*/g, '');
      const novoAno = x.anoBase + x.anos;
      det = (`Virada automática em ${br(hoje)}: datas da edição de ${x.anoBase} repetidas em ${novoAno}, aguardando o edital. ` + det.trim()).trim();
      gravarPainel_(aba, linha, col('Detalhes') + 1, det);
      const id = guardarDesfazerPainel_('Virada automática', x.sigla, VIRADA_DESFAZER_DIAS * 24, {pular: x.ultima});
      registrarPainel_('Virada automática', x.sigla, `Datas da edição de ${x.anoBase} copiadas para ${novoAno} como "Previsto" (a última data era ${br(x.ultima)}${x.soInscricao ? ', só de inscrição: esperou ' + VIRADA_MARGEM_SO_INSCRICAO_DIAS + ' dias' : ''}). Pode ser desfeita pelo painel por ${VIRADA_DESFAZER_DIAS} dias (código ${id}).`);
    }
    return {simular, lista, suspensa: false};
  } finally {
    lock.releaseLock();
  }
}
