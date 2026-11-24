// Calendário Olímpico CTO – Painel semanal: gravações pelo site com senha.
//
// O site do painel (https://ctomackenziebrasilia.github.io/painel-cto/) chama este script para:
//   - conferir a senha de ENTRADA (ver o painel) e a senha de GRAVAÇÃO (mudar a planilha);
//   - aplicar na aba Eventos as datas oficiais encontradas pela tarefa semanal;
//   - registrar na aba Radar a decisão da equipe sobre cada olimpíada nova.
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
  if (tudo) det = det.replace(/Previsão com base[^.]*\.\s*/g, '');
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

// ===== Apoio =====

function dataPainel_(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : null;
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
