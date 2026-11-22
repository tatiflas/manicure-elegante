/**
 * Backend do painel do cardápio — cole este arquivo no Apps Script da planilha.
 * (Planilha → Extensões → Apps Script → apague o conteúdo → cole → salvar)
 *
 * O que ele faz:
 *  - GET  (sem senha): devolve os dados do cardápio para o site.
 *  - POST (com senha): salva os dados vindos do painel e recebe fotos (guardadas no Google Drive).
 *  - POST "pagar" (sem senha): cria o link de pagamento do Mercado Pago, com o valor
 *    recalculado aqui a partir dos preços salvos (o site não consegue alterar o valor).
 *  - Avisos do Mercado Pago: atualizam a aba "Pagamentos" (aprovado, recusado...).
 *
 * Aba "Config": B1 = senha do painel · B2 = Access Token do Mercado Pago (opcional).
 *
 * PASSO A PASSO RÁPIDO
 *  1. No topo do editor, escolha a função "configurar" e clique em ▶ Executar (autorize).
 *  2. Troque a senha na aba Config da planilha (célula B1).
 *  3. Escolha a função "verificar" e clique em ▶ Executar: ela diz o que falta.
 *  4. Implantar → Nova implantação → App da Web → Executar como "Eu" → Acesso "Qualquer pessoa".
 *  ⚠ NÃO execute doGet nem doPost pelo editor: elas só funcionam chamadas pelo site.
 *  ⚠ Erro de sintaxe ao salvar? Em ⚙ Configurações do projeto, marque
 *    "Ativar o ambiente de execução do Chrome V8".
 */

const ABA_DADOS = 'Dados';
const ABA_BACKUP = 'Backup';
const ABA_CONFIG = 'Config';
const ABA_LISTA = 'Serviços (consulta)';
const ABA_HISTORICO = 'Histórico';
const PASTA_FOTOS = 'Cardápio – Fotos';
const PEDACO = 45000; // uma célula guarda até 50 mil caracteres
const CACHE_CHAVE = 'dados_cardapio';
const ABA_PAGAMENTOS = 'Pagamentos';
const MP_API = 'https://api.mercadopago.com';

/**
 * Planilha onde ficam os dados. Funciona tanto com o script criado pela planilha
 * (Extensões → Apps Script) quanto com um projeto avulso criado em script.google.com:
 * nesse caso, "configurar" cria uma planilha nova e guarda o endereço dela.
 */
function planilha_() {
  const ativa = SpreadsheetApp.getActive();
  if (ativa) return ativa;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PLANILHA_ID');
  if (id) return SpreadsheetApp.openById(id);
  const nova = SpreadsheetApp.create('Cardápio – Dados');
  props.setProperty('PLANILHA_ID', nova.getId());
  return nova;
}

/** Rode esta função uma vez (botão ▶ Executar) para criar as abas. */
function configurar() {
  const ss = planilha_();
  [ABA_DADOS, ABA_BACKUP, ABA_LISTA, ABA_HISTORICO].forEach(n => ss.getSheetByName(n) || ss.insertSheet(n));
  abaPagamentos_();
  let cfg = ss.getSheetByName(ABA_CONFIG);
  if (!cfg) {
    cfg = ss.insertSheet(ABA_CONFIG, 0);
    cfg.getRange('A1:B1').setValues([['Senha do painel', 'troque-esta-senha']]);
    cfg.getRange('A3').setValue('Troque a senha em B1. Não apague as outras abas: elas guardam o cardápio.');
    cfg.setColumnWidth(1, 180); cfg.setColumnWidth(2, 220);
  }
  if (!cfg.getRange('A2').getValue()) cfg.getRange('A2').setValue('Token Mercado Pago (opcional)');
  pasta_();
  const msg = 'Pronto! Planilha: ' + ss.getUrl() + '\n→ Agora troque a senha na aba Config (célula B1) e depois execute a função "verificar".';
  Logger.log(msg);
  return msg;
}

/** Execute pelo editor (▶) para conferir a configuração. O resultado aparece no "Registro de execução". */
function verificar() {
  const ss = planilha_(), cfg = ss.getSheetByName(ABA_CONFIG);
  const senha = cfg ? String(cfg.getRange('B1').getValue()).trim() : '';
  const url = ScriptApp.getService().getUrl();
  const itens = [
    ['Planilha', true, ss.getUrl()],
    ['Aba Config criada', !!cfg, cfg ? 'ok' : 'execute a função "configurar"'],
    ['Senha trocada', !!senha && senha !== 'troque-esta-senha', senha ? (senha === 'troque-esta-senha' ? 'troque a senha na célula B1 da aba Config' : 'ok') : 'a célula B1 da aba Config está vazia'],
    ['Implantado como App da Web', !!url, url ? url : 'faça Implantar → Nova implantação → App da Web'],
    ['Link correto termina em /exec', !!url && /\/exec$/.test(url), url && /\/dev$/.test(url) ? 'use o link /exec da implantação, não o /dev de teste' : 'ok'],
    ['Cardápio já salvo pelo painel', !!ler_(ABA_DADOS), ler_(ABA_DADOS) ? 'ok' : 'ainda não (normal antes do 1º Salvar no painel)'],
    ['Token do Mercado Pago (opcional)', true, tokenMP_() ? (/^APP_USR-/.test(tokenMP_()) ? 'ok' : 'o token deveria começar com APP_USR- (use o de PRODUÇÃO)') : 'não configurado'],
  ];
  const txt = itens.map(([n, ok, d]) => (ok ? '✅ ' : '❌ ') + n + ': ' + d).join('\n') +
    '\n\nLembrete: na implantação, "Quem pode acessar" deve ser "Qualquer pessoa" (não "Qualquer pessoa com conta do Google").' +
    '\nSe você alterou este código, atualize: Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.';
  Logger.log(txt);
  return txt;
}

function doGet(e) {
  const json = lerDados_();
  return saida_({ ok: true, data: json ? JSON.parse(json) : null });
}

function doPost(e) {
  if (!e || !e.postData) throw new Error('doPost só funciona chamada pelo site/painel. Para testar, execute a função "verificar".');
  const prm = (e && e.parameter) || {};
  let req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { if (!prm.type && !prm.topic) return saida_({ ok: false, erro: 'Requisição inválida' }); }

  // aviso automático do Mercado Pago (pagamento aprovado, recusado...)
  if (prm.type === 'payment' || prm.topic === 'payment' || req.type === 'payment' || req.topic === 'payment') {
    return saida_(notificacaoMP_(prm['data.id'] || prm.id || (req.data && req.data.id) || (req.resource && String(req.resource).split('/').pop())));
  }
  // cliente finalizando o pedido com pagamento on-line (não exige senha)
  if (req.acao === 'pagar') {
    try { return saida_(pagar_(req)); } catch (err) { return saida_({ ok: false, erro: err.message }); }
  }

  const cfgSenha = String((planilha_().getSheetByName(ABA_CONFIG) || { getRange: () => ({ getValue: () => '' }) }).getRange('B1').getValue()).trim();
  if (!cfgSenha || cfgSenha === 'troque-esta-senha') return saida_({ ok: false, erro: 'Defina uma senha nova na aba Config da planilha (célula B1) e tente de novo.' });
  if (!senhaOk_(req.senha)) { Utilities.sleep(1200); return saida_({ ok: false, erro: 'Senha incorreta' }); }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return saida_({ ok: false, erro: 'Outra pessoa está salvando. Tente de novo.' });
  try {
    switch (req.acao) {
      case 'testar':
        return saida_({ ok: true, data: (j => j ? JSON.parse(j) : null)(lerDados_()) });
      case 'salvar': {
        const d = req.dados;
        if (!d || !d.store || !Array.isArray(d.menu)) return saida_({ ok: false, erro: 'Dados inválidos' });
        const atual = lerDados_();
        if (atual) gravar_(ABA_BACKUP, atual); // guarda a versão anterior
        const json = JSON.stringify(d);
        gravar_(ABA_DADOS, json);
        CacheService.getScriptCache().remove(CACHE_CHAVE);
        atualizarLista_(d);
        const hist = planilha_().getSheetByName(ABA_HISTORICO);
        hist.appendRow([new Date(), 'Cardápio salvo', d.menu.reduce((n, c) => n + (c.items || []).length, 0) + ' serviços']);
        return saida_({ ok: true, salvoEm: new Date().toISOString() });
      }
      case 'desfazer': { // volta para a versão anterior
        const anterior = ler_(ABA_BACKUP);
        if (!anterior) return saida_({ ok: false, erro: 'Não há versão anterior' });
        const atual = lerDados_();
        gravar_(ABA_DADOS, anterior);
        if (atual) gravar_(ABA_BACKUP, atual);
        CacheService.getScriptCache().remove(CACHE_CHAVE);
        atualizarLista_(JSON.parse(anterior));
        return saida_({ ok: true, data: JSON.parse(anterior) });
      }
      case 'foto': {
        const tipos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (tipos.indexOf(req.tipo) < 0) return saida_({ ok: false, erro: 'Formato de imagem não aceito' });
        const bytes = Utilities.base64Decode(req.base64);
        if (bytes.length > 4 * 1024 * 1024) return saida_({ ok: false, erro: 'Imagem muito grande (máx. 4 MB)' });
        const nome = String(req.nome || 'foto').replace(/[^\w.\- ]/g, '').slice(0, 60) || 'foto';
        const arq = pasta_().createFile(Utilities.newBlob(bytes, req.tipo, Date.now() + '-' + nome));
        arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return saida_({ ok: true, url: 'https://lh3.googleusercontent.com/d/' + arq.getId() });
      }
      default:
        return saida_({ ok: false, erro: 'Ação desconhecida' });
    }
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- auxiliares ---------------- */
function saida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function senhaOk_(senha) {
  const cfg = planilha_().getSheetByName(ABA_CONFIG);
  const certa = cfg ? String(cfg.getRange('B1').getValue()).trim() : '';
  return !!certa && certa !== 'troque-esta-senha' && String(senha || '') === certa;
}

function lerDados_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get(CACHE_CHAVE);
  if (c) return c;
  const json = ler_(ABA_DADOS);
  if (json && json.length < 95000) cache.put(CACHE_CHAVE, json, 300);
  return json;
}

function ler_(aba) {
  const sh = planilha_().getSheetByName(aba);
  if (!sh || sh.getLastRow() < 1) return '';
  return sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]).replace(/^~/, '')).join('');
}

function gravar_(aba, texto) {
  const ss = planilha_();
  const sh = ss.getSheetByName(aba) || ss.insertSheet(aba);
  sh.clearContents();
  const linhas = [];
  // o prefixo ~ impede a planilha de interpretar um pedaço que comece com "=" como fórmula
  for (let i = 0; i < texto.length; i += PEDACO) linhas.push(['~' + texto.slice(i, i + PEDACO)]);
  sh.getRange(1, 1, linhas.length, 1).setNumberFormat('@').setValues(linhas);
}

/** Lista legível dos serviços, só para consulta (editar aqui não muda o site). */
function atualizarLista_(d) {
  const ss = planilha_();
  const sh = ss.getSheetByName(ABA_LISTA) || ss.insertSheet(ABA_LISTA);
  sh.clearContents();
  const linhas = [['Categoria', 'Serviço', 'Preço (R$)', 'Duração (min)', 'Visível no site']];
  d.menu.forEach(c => (c.items || []).forEach(i => linhas.push([c.name, i.name, i.price, i.dur || '', i.hidden ? 'Não' : 'Sim'])));
  sh.getRange(1, 1, linhas.length, 5).setValues(linhas);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function pasta_() {
  const it = DriveApp.getFoldersByName(PASTA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS);
}

/* ---------------- Mercado Pago ---------------- */
function tokenMP_() {
  const cfg = planilha_().getSheetByName(ABA_CONFIG);
  return cfg ? String(cfg.getRange('B2').getValue()).trim() : '';
}

function abaPagamentos_() {
  const ss = planilha_();
  let sh = ss.getSheetByName(ABA_PAGAMENTOS);
  if (!sh) {
    sh = ss.insertSheet(ABA_PAGAMENTOS);
    sh.getRange(1, 1, 1, 9).setValues([['Data', 'Pedido', 'Status', 'Valor (R$)', 'Forma', 'Cliente', 'Telefone', 'ID Mercado Pago', 'Atualizado em']]);
    sh.getRange(1, 1, 1, 9).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Calcula o total a partir dos preços SALVOS na planilha e cria o link de pagamento. */
function pagar_(req) {
  const token = tokenMP_();
  const d = JSON.parse(lerDados_() || 'null');
  if (!token || !d || !d.store.mercadoPago) return { ok: false, erro: 'Pagamento on-line indisponível no momento.' };

  const itens = {};
  d.menu.forEach(c => (c.items || []).forEach(i => { if (!i.hidden) itens[i.id] = i; }));
  let sub = 0;
  const nomes = [];
  (req.itens || []).slice(0, 50).forEach(l => {
    const i = itens[l.id];
    if (!i) throw new Error('Um serviço do carrinho mudou. Atualize a página e tente de novo.');
    const qtd = Math.max(1, Math.min(20, parseInt(l.qty, 10) || 1));
    const opcoes = [];
    (i.groups || []).forEach(g => (g.options || []).forEach(o => opcoes.push(o)));
    let unit = +i.price || 0;
    (l.opts || []).forEach(n => { const o = opcoes.find(x => x.n === n); if (o) unit += +o.p || 0; });
    sub += unit * qtd;
    nomes.push(qtd + 'x ' + i.name);
  });
  const cp = req.cupom && d.store.coupons && d.store.coupons[req.cupom];
  const desc = !cp ? 0 : cp.type === 'pct' ? sub * cp.value / 100 : Math.min(cp.value, sub);
  const taxa = req.modo === 'domicilio' && d.store.homeService !== false ? (+d.store.homeFee || 0) : 0;
  const total = Math.round((sub - desc + taxa) * 100) / 100;
  if (total < 1) return { ok: false, erro: 'Valor muito baixo para pagamento on-line.' };

  const pedido = String(req.pedido || '').replace(/[^\w-]/g, '').slice(0, 30) || ('P' + Date.now());
  const cliente = req.cliente || {};
  const pref = {
    items: [{ id: pedido, title: (d.store.name + ' – ' + nomes.join(', ')).slice(0, 250), quantity: 1, unit_price: total, currency_id: 'BRL' }],
    external_reference: pedido,
    payer: { name: String(cliente.nome || '').slice(0, 80) },
    statement_descriptor: String(d.store.name || '').normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13),
    notification_url: ScriptApp.getService().getUrl(),
  };
  const volta = String(req.voltar || '');
  if (/^https:\/\//.test(volta)) {
    const s = volta.indexOf('?') < 0 ? '?' : '&';
    pref.back_urls = { success: volta + s + 'pagamento=aprovado', pending: volta + s + 'pagamento=em-analise', failure: volta + s + 'pagamento=falhou' };
    pref.auto_return = 'approved';
  }
  const r = UrlFetchApp.fetch(MP_API + '/checkout/preferences', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(pref),
  });
  const j = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() >= 300 || !j.init_point) return { ok: false, erro: 'O Mercado Pago recusou: ' + (j.message || r.getResponseCode()) };

  const lock = LockService.getScriptLock();
  if (lock.tryLock(10000)) {
    try { abaPagamentos_().appendRow([new Date(), pedido, '🕓 aguardando pagamento', total, '', String(cliente.nome || ''), "'" + String(cliente.telefone || ''), '', new Date()]); }
    finally { lock.releaseLock(); }
  }
  return { ok: true, url: j.init_point, total: total };
}

/** Confere o pagamento direto no Mercado Pago (não confia no aviso) e atualiza a aba Pagamentos. */
function notificacaoMP_(id) {
  const token = tokenMP_();
  if (!id || !token) return { ok: true };
  const r = UrlFetchApp.fetch(MP_API + '/v1/payments/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { ok: true };
  const p = JSON.parse(r.getContentText());
  const status = {
    approved: '✅ aprovado', pending: '🕓 pendente', in_process: '🔎 em análise', authorized: '🔎 autorizado',
    rejected: '❌ recusado', cancelled: '🚫 cancelado', refunded: '↩️ estornado', charged_back: '⚠️ contestado',
  }[p.status] || p.status;
  const forma = { credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', bank_transfer: 'Pix', ticket: 'Boleto', account_money: 'Saldo Mercado Pago' }[p.payment_type_id] || p.payment_type_id || '';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: true };
  try {
    const sh = abaPagamentos_();
    const n = sh.getLastRow();
    const pedidos = n > 1 ? sh.getRange(2, 2, n - 1, 1).getValues().map(x => String(x[0])) : [];
    const k = pedidos.lastIndexOf(String(p.external_reference));
    const linha = [status, p.transaction_amount, forma];
    if (k >= 0) {
      sh.getRange(k + 2, 3, 1, 3).setValues([linha]);
      sh.getRange(k + 2, 8, 1, 2).setValues([[String(p.id), new Date()]]);
    } else {
      sh.appendRow([new Date(), p.external_reference || '', status, p.transaction_amount, forma, '', '', String(p.id), new Date()]);
    }
  } finally { lock.releaseLock(); }
  return { ok: true };
}
