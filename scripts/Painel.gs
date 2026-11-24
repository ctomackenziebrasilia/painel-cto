// Calendário Olímpico CTO – Painel semanal: gravações pelo site com senha.
//
// O site do painel (https://ctomackenziebrasilia.github.io/painel-cto/) chama este script para:
//   - conferir a senha de ENTRADA (ver o painel) e a senha de GRAVAÇÃO (mudar a planilha);
//   - aplicar na aba Eventos as datas oficiais encontradas pela tarefa semanal;
//   - registrar na aba Radar a decisão da equipe sobre cada olimpíada nova;
//   - CADASTRAR uma olimpíada do Radar direto no calendário (abas Olimpiadas e Eventos).
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
const MAX_ERROS_PAINEL = 8;          // tentativas erradas de senha...
const BLOQUEIO_SEG_PAINEL = 15 * 60; // ...bloqueiam novas tentativas por 15 minutos

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
  for (const [c, d] of novos) aba.getRange(linha, c + 1).setValue(d);

  const etapas = new Set(String(valores[r][col('Etapas confirmadas')] || '').split(',').map(s => s.trim()).filter(Boolean));
  novos.forEach(n => etapas.add(n[3].replace(/ \((início|fim)\)$/, '')));
  const listaEtapas = ETAPAS_PAINEL.filter(e => etapas.has(e));
  // Datas preenchidas na linha (depois da gravação) – todas oficiais?
  const preenchidas = COLUNAS_DATA_PAINEL.filter(t => col(t) >= 0 &&
    (novos.some(n => n[3] === t) || String(mostrados[r][col(t)]).trim() !== ''));
  const tudo = preenchidas.length > 0 && preenchidas.every(t => etapas.has(t.replace(/ \((início|fim)\)$/, '')));
  const verif = String(p.verificacao || Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy'));
  let det = String(valores[r][col('Detalhes')] || '').replace(/ ?Datas oficiais conferidas em [^.]*\./, '');
  if (tudo) det = det.replace(/Previsão com base.*?\.(?=\s|$)\s*/g, '');
  det = (det + ` Datas oficiais conferidas em ${verif} (painel): ${listaEtapas.join(', ')}.`).trim();

  aba.getRange(linha, col('Etapas confirmadas') + 1).setValue(listaEtapas.join(', '));
  aba.getRange(linha, col('Fonte das datas') + 1).setValue(link);
  aba.getRange(linha, col('Detalhes') + 1).setValue(det);
  const situacaoAntes = String(valores[r][col('Situação')]);
  if (tudo && situacaoAntes !== 'Cancelado') aba.getRange(linha, col('Situação') + 1).setValue('Confirmado');
  SpreadsheetApp.flush();

  // Lê de volta para conferir.
  const depois = aba.getRange(linha, 1, 1, tit.length).getDisplayValues()[0];
  const falhas = novos.filter(n => depois[n[0]] !== n[2]).map(n => `${n[3]} ficou ${depois[n[0]] || 'vazio'}`);
  registrarPainel_('Aplicar datas', sigla, novos.map(n => `${n[3]}=${n[2]}`).join('; ') + (conflitos.length ? ' (gravado mesmo com conflito)' : ''));
  if (falhas.length) return {ok: false, erro: 'conferencia', msg: 'Gravei, mas a conferência mostrou: ' + falhas.join('; ')};
  return {ok: true, etapas: listaEtapas.join(', '), confirmado: tudo};
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
  aba.getRange(linha, col('Situação') + 1).setValue(situacao);
  aba.getRange(linha, col('Motivo') + 1).setValue(motivo);
  aba.getRange(linha, col('Decidido em') + 1).setValue(Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'));
  registrarPainel_('Decisão no radar', sigla, situacao + (motivo ? ' – ' + motivo : ''));
  return {ok: true};
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
  for (const [t, v] of Object.entries(valoresO)) if (oc(t) >= 0 && v !== '') olim.getRange(lo, oc(t) + 1).setValue(v);

  // 2) Eventos
  const et = eventos.getRange(1, 1, 1, eventos.getLastColumn()).getDisplayValues()[0].map(v => String(v).trim()), ec = t => et.indexOf(t);
  const le = primeiraLinhaLivrePainel_(eventos, ec('Sigla') + 1);
  const det = [R('Detalhes para cadastro'), `Cadastrada pelo painel em ${hoje}.`].filter(Boolean).join(' ');
  const valoresE = {'Sigla': sigla, 'Situação': situacao, 'Etapas confirmadas': etapas.join(', '), 'Detalhes': det, 'Fonte das datas': link};
  for (const [t, v] of Object.entries(valoresE)) if (ec(t) >= 0 && v !== '') eventos.getRange(le, ec(t) + 1).setValue(v);
  for (const [col, d] of datas) if (ec(col) >= 0) eventos.getRange(le, ec(col) + 1).setValue(d);

  // 3) Radar
  const lr = r + 1;
  radar.getRange(lr, rc('Situação') + 1).setValue('Cadastrada');
  if (rc('Decidido em') >= 0) radar.getRange(lr, rc('Decidido em') + 1).setValue(Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'));
  if (rc('Motivo') >= 0 && p.motivo) radar.getRange(lr, rc('Motivo') + 1).setValue(String(p.motivo).slice(0, 500));
  if (rc('Área no calendário') >= 0 && area !== R('Área no calendário')) radar.getRange(lr, rc('Área no calendário') + 1).setValue(area);
  SpreadsheetApp.flush();
  registrarPainel_('Cadastro no calendário', sigla, `Olimpiadas linha ${lo}, Eventos linha ${le}; ${datas.length} datas (${situacao || 'sem datas'})`);
  return {ok: true, linhaOlimpiadas: lo, linhaEventos: le, situacao, datas: datas.length};
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
    aba.appendRow(['Quando', 'Ação', 'Sigla', 'Detalhe']);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  aba.appendRow([Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'), acao, sigla, detalhe]);
}
