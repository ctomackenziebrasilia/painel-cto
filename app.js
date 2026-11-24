// Painel semanal do Calendário Olímpico CTO.
// Lê a planilha pública (abas Olimpiadas, Eventos e Radar) e o arquivo dados.json (relatório da tarefa semanal).
// Gravações passam pelo Apps Script "Painel" (conta do CTO), que confere a senha de gravação.
{
const WEBAPP = ''; // endereço do app da Web do Apps Script (termina em /exec)
const SHEET_ID = '1wF10E2_omNchLjgwAkMNBRixaEMf1wp17DaxzZsgKag';
const PLANILHA_LINK = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit';
const ENTRADA_DIAS = 30;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe = u => /^https?:\/\//i.test(u || '') ? u : '#';
const dt = iso => { if (!iso) return null; const [y,m,d] = iso.split('-').map(Number); return new Date(y, m-1, d); };
const br = iso => { const d = dt(iso); return d ? d.toLocaleDateString('pt-BR') : ''; };
const brToIso = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s||'').trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const hoje = new Date(); hoje.setHours(0,0,0,0);
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} }
};

const ROT = {"Inscrição (início)":"Abrem as inscrições","Inscrição (fim)":"Fecham as inscrições","Divulgação aos alunos":"Divulgação aos alunos","1ª Fase (início)":"1ª fase","1ª Fase (fim)":"Fim da 1ª fase","2ª Fase (início)":"2ª fase","2ª Fase (fim)":"Fim da 2ª fase","Fase Final (início)":"Fase final","Fase Final (fim)":"Fim da fase final","Resultado":"Resultado","Premiação":"Premiação"};
const GRP = k => k.replace(/ \((início|fim)\)$/, '');
const DEC = ['Cadastrar','Em análise','Descartada'];
let D = null, senhaGravacao = '', filtro = 'pendentes', segF = 'todos', nMeses = 6, forcar = {}, msgs = {}, ocupado = {};

/* ===== Leitura da planilha (gviz, JSONP) ===== */
let gvizN = 0;
function gviz(sheet){
  return new Promise((resolve, reject) => {
    const cb = `__gviz${Date.now()}_${gvizN++}`;
    const s = document.createElement('script');
    const fim = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    const t = setTimeout(() => { fim(); reject(new Error('tempo esgotado: ' + sheet)); }, 15000);
    window[cb] = j => {
      fim();
      try {
        if (j.status === 'error') throw new Error(JSON.stringify(j.errors));
        const cols = j.table.cols.map(c => String(c.label || '').trim());
        resolve(j.table.rows.map(r => Object.fromEntries(cols.map((c,i) => {
          const cel = r.c[i]; if (!cel) return [c, ''];
          const v = cel.v;
          if (typeof v === 'string' && /^Date\(/.test(v)) { const n = v.match(/\d+/g).map(Number); return [c, `${n[0]}-${String(n[1]+1).padStart(2,'0')}-${String(n[2]).padStart(2,'0')}`]; }
          return [c, v ?? ''];
        }))));
      } catch(e){ reject(e); }
    };
    s.onerror = () => { fim(); reject(new Error('falha ao carregar: ' + sheet)); };
    s.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?headers=1&sheet=${encodeURIComponent(sheet)}&tqx=${encodeURIComponent('out:json;responseHandler:' + cb)}&_=${Date.now()}`;
    document.head.append(s);
  });
}
const txt = v => String(v ?? '').trim();
const isoDe = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : brToIso(v);

async function carregar(){
  const [o, e, r, j] = await Promise.all([
    gviz('Olimpiadas'), gviz('Eventos'), gviz('Radar'),
    fetch('dados.json', {cache: 'no-store'}).then(x => x.json())
  ]);
  const OL = Object.fromEntries(o.filter(x => txt(x['Sigla'])).map(x => [txt(x['Sigla']), x]));
  const cadastradas = e.filter(x => txt(x['Sigla'])).map(x => {
    const ol = OL[txt(x['Sigla'])] || {};
    const datas = {};
    for (const k of Object.keys(ROT)) { const v = isoDe(txt(x[k])); if (v) datas[k] = v; }
    return {sigla: txt(x['Sigla']), nome: txt(ol['Nome']) || txt(x['Olimpíada (automático)']), area: txt(ol['Área']),
      seg: ['EFAI','EFAF','EM'].filter(s => txt(ol[s]).toUpperCase() === 'OK'),
      situacao: txt(x['Situação']) || 'Sem datas', confirmadas: txt(x['Etapas confirmadas']), datas, fonte: txt(x['Fonte das datas'])};
  });
  const tipo = {'Gratuita':'gratuita','Paga por aluno':'paga','Taxa por escola':'escola'};
  const radar = r.filter(x => txt(x['Sigla'])).map(x => ({
    sigla: txt(x['Sigla']), nome: txt(x['Olimpíada']), area: txt(x['Área']),
    seg: txt(x['Segmentos']).split('/').map(s => s.trim()).filter(s => ['EFAI','EFAF','EM'].includes(s)),
    abrangencia: txt(x['Abrangência']), custo: txt(x['Custo']), custoTipo: tipo[txt(x['Tipo de custo'])] || 'nao',
    proxima: txt(x['Próxima edição']), fonte: txt(x['Fonte oficial']), obs: txt(x['Observação']),
    alertas: txt(x['Alertas']).split(';').map(s => s.trim()).filter(Boolean),
    encontrada: txt(x['Encontrada em']), situacao: txt(x['Situação']) || 'Nova', motivo: txt(x['Motivo']), decidido: txt(x['Decidido em']),
    datas: txt(x['Datas conhecidas']).split(';').map(s => s.trim()).filter(Boolean).map(p => {
      const [rot, per] = p.split('='); const [a, b] = String(per || '').split('-');
      return {rotulo: txt(rot), ini: brToIso(a), fim: brToIso(b)};
    }).filter(d => d.ini)
  }));
  D = {...j, cadastradas, radar, editais: j.editais || {}};
}

/* ===== Senhas ===== */
async function chamar(corpo){
  if (!WEBAPP) throw {msg: 'O endereço do Apps Script ainda não foi configurado no site.'};
  let resp;
  try { resp = await fetch(WEBAPP, {method: 'POST', body: JSON.stringify(corpo)}); }
  catch(e){ throw {msg: 'Sem conexão com o Apps Script. Confira a internet e tente de novo.'}; }
  let j; try { j = await resp.json(); } catch(e){ throw {msg: 'Resposta inesperada do Apps Script.'}; }
  return j;
}
function entradaValida(){ const v = store.get('cto-painel-entrada', 0); return typeof v === 'number' && v > Date.now(); }
async function entrar(ev){
  ev.preventDefault();
  const s = $('#gateSenha').value; if (!s) return;
  $('#gateBtn').disabled = true; $('#gateErr').textContent = 'Conferindo…';
  try {
    const j = await chamar({acao: 'entrar', senha: s});
    if (!j.ok) { $('#gateErr').textContent = j.msg || 'Senha incorreta.'; return; }
    store.set('cto-painel-entrada', Date.now() + ENTRADA_DIAS * 864e5);
    if (j.podeGravar) senhaGravacao = s;
    $('#gateSenha').value = ''; $('#gateErr').textContent = '';
    abrir();
  } catch(e){ $('#gateErr').textContent = e.msg || 'Erro ao conferir a senha.'; }
  finally { $('#gateBtn').disabled = false; }
}
let pedeSenhaResolve = null;
function pedirSenha(texto){
  return new Promise(res => {
    pedeSenhaResolve = res;
    $('#modalErr').textContent = texto || ''; $('#modalSenha').value = '';
    $('#modal').classList.add('show'); setTimeout(() => $('#modalSenha').focus(), 30);
  });
}
function fecharModal(v){ $('#modal').classList.remove('show'); const r = pedeSenhaResolve; pedeSenhaResolve = null; if (r) r(v); }
// Faz uma gravação; pede a senha de gravação se ainda não tiver (ou se estiver errada).
async function gravar(corpo){
  for (let tent = 0; tent < 3; tent++) {
    if (!senhaGravacao) { const s = await pedirSenha(tent ? 'Senha de gravação incorreta. Tente de novo.' : ''); if (!s) return {ok: false, cancelado: true}; senhaGravacao = s; }
    const j = await chamar({...corpo, senha: senhaGravacao});
    if (j.erro === 'senha') { senhaGravacao = ''; continue; }
    return j;
  }
  return {ok: false, msg: 'Senha de gravação incorreta.'};
}

/* ===== Números do topo ===== */
function stats(){
  const pend = D.radar.filter(c => ['Nova','Em análise'].includes(c.situacao));
  const lim = new Date(hoje); lim.setDate(lim.getDate() + 30);
  const ev30 = eventos().filter(e => e.d >= hoje && e.d <= lim && /inscri/i.test(e.rot)).length;
  const nov = Object.keys(novPorSigla()).filter(s => !aplicado(s)).length;
  const man = (D.editais.manual || []).length + (D.radarManual || []).length;
  $('#stats').innerHTML = [[pend.length,'olimpíadas novas esperando decisão'],[nov,'olimpíadas com datas oficiais para aplicar'],[ev30,'inscrições abrindo ou fechando em 30 dias'],[man,'itens para verificar à mão']]
    .map(([n,t]) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join('');
}

/* ===== Radar: decidir ===== */
function cards(){
  const novas = D.radarNovasSemana || [];
  const F = {pendentes:['Esperando decisão', c => ['Nova','Em análise'].includes(c.situacao)], novas:['Novas desta semana', c => novas.includes(c.sigla)],
    gratis:['Gratuitas', c => c.custoTipo === 'gratuita'], em:['Ensino Médio', c => c.seg.includes('EM')], efai:['Anos iniciais', c => c.seg.includes('EFAI')],
    decididas:['Já decididas', c => ['Cadastrar','Descartada','Cadastrada'].includes(c.situacao)], todas:['Todas', () => true]};
  $('#filtros').innerHTML = Object.entries(F).map(([k,[t]]) => `<button class="chip" data-f="${k}" aria-pressed="${k===filtro}">${t}</button>`).join('');
  const lista = D.radar.filter(F[filtro][1]);
  $('#cards').innerHTML = lista.length ? lista.map(c => {
    const d = c.situacao, nova = novas.includes(c.sigla), id = c.sigla.replace(/\W/g,'_');
    return `<article class="cand" data-d="${esc(d)}"><div class="top"><div><h3>${esc(c.sigla)}</h3><div class="nome">${esc(c.nome)}</div></div>${nova?'<span class="new">Nova na semana</span>':''}</div>
    <div class="segs">${['EFAI','EFAF','EM'].map(s => `<span class="seg ${c.seg.includes(s)?'on':''}">${s}</span>`).join('')}${c.seg.length?'':'<span class="tag">segmentos a conferir</span>'}</div>
    <div class="tags"><span class="tag ${esc(c.custoTipo)}">${esc(c.custo)}</span><span class="tag">${esc(c.abrangencia)}</span><span class="tag">${esc(c.area)}</span><span class="tag">Radar: ${esc(d)}${c.decidido?' em '+esc(c.decidido):''}</span></div>
    <div class="prox"><b>Próxima edição:</b> ${esc(c.proxima)}</div>
    ${c.alertas.map(a => `<div class="alert">${esc(a)}</div>`).join('')}
    <p class="obs">${esc(c.obs)} <a href="${esc(safe(c.fonte))}" target="_blank" rel="noopener">Site oficial</a></p>
    ${d === 'Cadastrada' ? '<p class="obs"><b>Já está no calendário.</b></p>' : `
    <input class="motivo" id="mot-${esc(id)}" placeholder="Motivo (opcional)" value="${esc(c.motivo)}" maxlength="300">
    <div class="msg" id="rmsg-${esc(id)}">${esc(msgs['r:'+c.sigla]||'')}</div>
    <div class="dec">${DEC.map(v => `<button data-s="${esc(c.sigla)}" data-v="${v}" aria-pressed="${d===v}" ${ocupado['r:'+c.sigla]?'disabled':''}>${v==='Descartada'?'Descartar':v}</button>`).join('')}</div>`}</article>`;
  }).join('') : '<p class="empty">Nenhuma candidata neste filtro.</p>';
}
async function decidir(sigla, situacao){
  const c = D.radar.find(x => x.sigla === sigla); if (!c) return;
  const id = sigla.replace(/\W/g,'_');
  const motivo = ($('#mot-' + id)?.value || '').trim();
  const nova = c.situacao === situacao ? 'Nova' : situacao; // clicar de novo desfaz
  ocupado['r:'+sigla] = 1; msgs['r:'+sigla] = 'Gravando…'; cards();
  try {
    const j = await gravar({acao: 'decidirRadar', sigla, situacao: nova, motivo});
    if (j.cancelado) msgs['r:'+sigla] = '';
    else if (!j.ok) msgs['r:'+sigla] = j.msg || 'Não foi possível gravar.';
    else { c.situacao = nova; c.motivo = motivo; c.decidido = new Date().toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'}); msgs['r:'+sigla] = nova === 'Nova' ? 'Decisão desfeita.' : 'Gravado na aba Radar.'; }
  } catch(e){ msgs['r:'+sigla] = e.msg || 'Erro ao gravar.'; }
  delete ocupado['r:'+sigla]; cards(); stats();
}

/* ===== Calendário ===== */
function oficial(o, k){ if (o.situacao === 'Confirmado') return true; const c = o.confirmadas.split(',').map(s => s.trim()).filter(Boolean); return c.includes(k) || c.includes(GRP(k)); }
function eventos(){
  const out = [];
  for (const o of D.cadastradas) { if (o.situacao === 'Cancelado') continue;
    for (const [k, v] of Object.entries(o.datas)) out.push({d: dt(v), sig: o.sigla, seg: o.seg, rot: ROT[k] || k, kind: oficial(o,k) ? 'of' : (o.situacao === 'Previsto (só o mês)' ? 'pm' : 'pr')}); }
  for (const c of D.radar) { if (['Descartada','Cadastrada'].includes(c.situacao)) continue;
    for (const x of c.datas) out.push({d: dt(x.ini), fim: x.fim, sig: c.sigla, seg: c.seg, rot: x.rotulo, kind: 'cd'}); }
  return out.filter(e => e.d).sort((a,b) => a.d - b.d || a.sig.localeCompare(b.sig));
}
function agenda(){
  const S = {todos:'Todos os segmentos', EFAI:'Anos iniciais', EFAF:'Anos finais', EM:'Ensino Médio'};
  $('#segf').innerHTML = Object.entries(S).map(([k,t]) => `<button class="chip" data-g="${k}" aria-pressed="${k===segF}">${t}</button>`).join('');
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + nMeses, 1);
  const ev = eventos().filter(e => e.d >= hoje && e.d < fim && (segF === 'todos' || e.seg.includes(segF) || !e.seg.length));
  const meses = {}; for (const e of ev) { const k = e.d.getFullYear()*12 + e.d.getMonth(); (meses[k] = meses[k] || []).push(e); }
  const K = {of:'oficial', pr:'previsto', pm:'só o mês', cd:'candidata'};
  const cap = s => s[0].toUpperCase() + s.slice(1);
  $('#meses').innerHTML = Object.entries(meses).map(([k,l]) => { const m = new Date(Math.floor(k/12), k%12, 1);
    return `<div class="month"><h3>${cap(m.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}))}</h3>${l.map(e => `<div class="ev ${e.kind==='cd'?'cand-ev':''}"><div class="day">${e.d.getDate()}<small>${e.d.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','')}</small></div><div class="what"><b>${esc(e.sig)}</b> · ${esc(e.rot)}${e.fim?` até ${br(e.fim)}`:''}<span class="kind ${e.kind==='pm'?'pr':e.kind}">${K[e.kind]}</span></div></div>`).join('')}</div>`; }).join('') || '<p class="empty">Nenhuma data neste período.</p>';
  $('#maisMeses').textContent = nMeses < 12 ? 'Mostrar mais meses' : 'Mostrar menos meses';
}

/* ===== Editais: aplicar datas oficiais ===== */
function novPorSigla(){ const m = {}; for (const x of (D.editais.novidades || [])) (m[x.sigla] = m[x.sigla] || []).push(x); return m; }
function aplicado(s){
  const it = novPorSigla()[s] || [], o = D.cadastradas.find(o => o.sigla === s);
  if (!o || !it.length) return false;
  return it.every(x => o.datas[x.coluna] === brToIso(x.oficial) && oficial(o, x.coluna));
}
function editais(){
  const C = D.cadastradas, grp = {of:[], pr:[], pm:[], sd:[], ca:[]};
  for (const o of C) { const k = o.situacao === 'Cancelado' ? 'ca' : (o.situacao === 'Confirmado' || o.confirmadas) ? 'of' : o.situacao === 'Previsto (só o mês)' ? 'pm' : Object.keys(o.datas).length ? 'pr' : 'sd'; grp[k].push(o); }
  const L = {of:['Já tem data oficial','#1f6b45'], pr:['Só previsto (aguarda edital)','#8a8284'], pm:['Previsto só o mês','#b07a1a'], sd:['Sem datas','#c7c0c1'], ca:['Encerrada','#8e2b2e']};
  $('#editLead').textContent = `${C.length} olimpíadas na planilha. ${grp.of.length} já têm alguma etapa com data oficial; as outras usam datas da edição anterior até sair o edital.`;
  const usados = Object.entries(grp).filter(([,l]) => l.length);
  $('#meter').innerHTML = usados.map(([k,l]) => `<div style="flex:${l.length};background:${L[k][1]}" title="${L[k][0]}">${l.length}</div>`).join('');
  $('#legend').innerHTML = usados.map(([k,l]) => `<span><i style="background:${L[k][1]}"></i>${L[k][0]} (${l.length})</span>`).join('');
  const E = D.editais, P = novPorSigla(), pend = Object.keys(P).filter(s => !aplicado(s));
  const lst = (t,a,f) => `<div class="box"><h3>${t}</h3><ul>${a.map(f).join('')}</ul></div>`;
  let h = E.aviso ? `<p class="lead"><b>${esc(E.aviso)}</b></p>` : '';
  h += `<div class="apl-head"><h3 style="margin:0">Datas oficiais para aplicar (${Object.keys(P).length})</h3>${pend.length > 1 ? `<button class="btn" data-ap="__todas">Aplicar todas na planilha</button>` : ''}</div>`;
  h += Object.keys(P).length ? `<div class="grid">${Object.entries(P).map(([s,it]) => { const ok = aplicado(s), o = C.find(o => o.sigla === s);
    return `<article class="cand ap ${ok?'feito':''}"><div class="top"><div><h3>${esc(s)}</h3><div class="nome">edição ${esc(it[0].edicao)} · <a href="${esc(safe(it[0].link))}" target="_blank" rel="noopener">fonte oficial</a></div></div>${ok?'<span class="okb">Aplicado</span>':''}</div>
    <table class="dif"><thead><tr><th>Etapa</th><th>${ok?'Antes':'Planilha'}</th><th>Oficial</th></tr></thead><tbody>${it.map(x => `<tr><td>${esc(x.etapa)}</td><td class="${x.planilha===x.oficial?'':'old'}">${esc(x.planilha||'vazio')}</td><td><b>${esc(x.oficial)}</b>${x.planilha===x.oficial?' <span class="kind of">confirma</span>':''}</td></tr>`).join('')}</tbody></table>
    ${o ? '' : '<div class="msg">Esta sigla não está na aba Eventos.</div>'}
    <div class="msg" id="msg-${esc(s.replace(/\W/g,'_'))}">${esc(msgs[s]||'')}</div>
    ${ok || !o ? '' : `<button class="btn" data-ap="${esc(s)}" ${ocupado[s]?'disabled':''}>${ocupado[s]?'Gravando…':forcar[s]?'Aplicar mesmo assim':'Aplicar na planilha'}</button>`}</article>`; }).join('')}</div>` : '<p class="empty">Nenhuma data oficial nova nesta semana.</p>';
  if ((E.encerradas||[]).length) h += lst('Encerradas pelo organizador', E.encerradas, x => `<li><b>${esc(x.sigla)}</b> – ${esc(x.texto)} <a href="${esc(safe(x.link))}" target="_blank" rel="noopener">fonte</a></li>`);
  if ((E.semEdital||[]).length) h += `<div class="box"><h3>Edição encerrada, próxima sem edital</h3><p>${E.semEdital.map(esc).join(', ')}</p></div>`;
  if ((E.observacoes||[]).length) h += lst('Observações', E.observacoes, x => `<li><b>${esc(x.sigla)}</b> – ${esc(x.texto)} (${esc(x.veiculo)}, <a href="${esc(safe(x.link))}" target="_blank" rel="noopener">link</a>)</li>`);
  if ((E.semNovidade||[]).length) h += `<div class="box"><h3>Conferidas, sem novidade</h3><p>${E.semNovidade.map(esc).join(', ')}</p></div>`;
  $('#editBoxes').innerHTML = h;
  $('#sigs').innerHTML = Object.entries(grp).flatMap(([k,l]) => l.map(o => `<a href="${esc(safe(o.fonte))}" target="_blank" rel="noopener" style="background:${L[k][1]}" title="${esc(o.nome)} – ${L[k][0]}">${esc(o.sigla)}</a>`)).join('');
}
async function aplicar(sigs){
  const P = novPorSigla();
  for (const s of sigs) {
    const it = P[s]; if (!it) continue;
    ocupado[s] = 1; msgs[s] = ''; editais();
    try {
      const j = await gravar({acao: 'aplicarDatas', sigla: s, link: it[0].link, verificacao: br(D.atualizado), forcar: !!forcar[s],
        itens: it.map(x => ({coluna: x.coluna, oficial: x.oficial, planilha: x.planilha || ''}))});
      if (j.cancelado) { delete ocupado[s]; break; }
      if (j.ok) {
        delete forcar[s]; msgs[s] = '';
        const o = D.cadastradas.find(o => o.sigla === s);
        if (o) { it.forEach(x => { o.datas[x.coluna] = brToIso(x.oficial); }); o.confirmadas = j.etapas || o.confirmadas; if (j.confirmado) o.situacao = 'Confirmado'; }
      } else if (j.erro === 'conflito') {
        forcar[s] = 1; msgs[s] = 'A planilha mudou desde a verificação: ' + j.conflitos.join('; ') + '. Confira e clique de novo para gravar mesmo assim.';
      } else msgs[s] = (j.msg || 'Não foi possível gravar.') + ' Confira a planilha antes de tentar de novo.';
    } catch(e){ msgs[s] = e.msg || 'Erro ao gravar.'; }
    delete ocupado[s];
  }
  editais(); agenda(); stats();
}

/* ===== Verificar à mão ===== */
function manual(){
  const P = {alta:0, 'média':1, baixa:2};
  const a = [...(D.editais.manual||[]).map(x => ({...x, origem:'Edital'})), ...(D.radarManual||[]).map(x => ({...x, origem:'Radar'}))].sort((x,y) => (P[x.prioridade] ?? 3) - (P[y.prioridade] ?? 3));
  $('#manBox').innerHTML = a.length ? `<ul class="man box" style="list-style:none;padding-left:16px">${a.map(x => `<li><span class="pri ${esc(x.prioridade)}">${esc(x.prioridade)}</span><b>${esc(x.titulo)}</b> <span class="tag">${x.origem}</span><br>${esc(x.oque)} <a href="${esc(safe(x.link))}" target="_blank" rel="noopener">abrir</a></li>`).join('')}</ul>` : '<p class="empty">Nada para verificar à mão.</p>';
}

/* ===== Início ===== */
function render(){ stats(); cards(); agenda(); editais(); manual(); }
async function abrir(){
  $('#gate').classList.add('hidden');
  try {
    await carregar();
    const prox = D.proxima ? ` Próxima verificação: ${dt(D.proxima).toLocaleDateString('pt-BR',{weekday:'long', day:'2-digit', month:'2-digit'})}.` : '';
    $('#titulo').textContent = `Verificação semanal de ${br(D.atualizado)}`;
    $('#sub').textContent = `O que a tarefa semanal encontrou, para a equipe decidir e aplicar com um clique.${prox}`;
    $('#foot').innerHTML = `Relatório da tarefa semanal de ${br(D.atualizado)}; olimpíadas e radar lidos agora da <a href="${esc(PLANILHA_LINK)}" target="_blank" rel="noopener">planilha</a>. Cada gravação fica anotada na aba "Registro do painel". Nada muda na planilha sem a senha de gravação.`;
    render();
  } catch(e){ $('#sub').textContent = 'Não foi possível carregar os dados (' + (e.message || e) + '). Tente recarregar a página.'; }
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.f) { filtro = b.dataset.f; cards(); }
  else if (b.dataset.g) { segF = b.dataset.g; agenda(); }
  else if (b.dataset.s) decidir(b.dataset.s, b.dataset.v);
  else if (b.dataset.ap) { const l = b.dataset.ap === '__todas' ? Object.keys(novPorSigla()).filter(s => !aplicado(s)) : [b.dataset.ap]; aplicar(l); }
  else if (b.id === 'maisMeses') { nMeses = nMeses < 12 ? 12 : 6; agenda(); }
  else if (b.id === 'sair') { store.del('cto-painel-entrada'); senhaGravacao = ''; location.reload(); }
  else if (b.id === 'modalCancel') fecharModal('');
});
$('#gateForm').addEventListener('submit', entrar);
$('#modalForm').addEventListener('submit', e => { e.preventDefault(); fecharModal($('#modalSenha').value); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal').classList.contains('show')) fecharModal(''); });

if (entradaValida()) abrir(); else setTimeout(() => $('#gateSenha').focus(), 50);
}
