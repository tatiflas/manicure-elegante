/**
 * Backend do painel do cardápio — cole este arquivo no Apps Script da planilha.
 * (Planilha → Extensões → Apps Script → apague o conteúdo → cole → salvar)
 *
 * O que ele faz:
 *  - GET  (sem senha): devolve os dados do cardápio para o site.
 *  - POST (com senha): salva os dados vindos do painel e recebe fotos (guardadas no Google Drive).
 *
 * A senha do painel fica na aba "Config", célula B1.
 */

const ABA_DADOS = 'Dados';
const ABA_BACKUP = 'Backup';
const ABA_CONFIG = 'Config';
const ABA_LISTA = 'Serviços (consulta)';
const ABA_HISTORICO = 'Histórico';
const PASTA_FOTOS = 'Cardápio – Fotos';
const PEDACO = 45000; // uma célula guarda até 50 mil caracteres
const CACHE_CHAVE = 'dados_cardapio';

/** Rode esta função uma vez (botão ▶ Executar) para criar as abas. */
function configurar() {
  const ss = SpreadsheetApp.getActive();
  [ABA_DADOS, ABA_BACKUP, ABA_LISTA, ABA_HISTORICO].forEach(n => ss.getSheetByName(n) || ss.insertSheet(n));
  let cfg = ss.getSheetByName(ABA_CONFIG);
  if (!cfg) {
    cfg = ss.insertSheet(ABA_CONFIG, 0);
    cfg.getRange('A1:B1').setValues([['Senha do painel', 'troque-esta-senha']]);
    cfg.getRange('A3').setValue('Troque a senha em B1. Não apague as outras abas: elas guardam o cardápio.');
    cfg.setColumnWidth(1, 180); cfg.setColumnWidth(2, 220);
  }
  pasta_();
  return 'Pronto! Agora troque a senha na aba Config e publique: Implantar → Nova implantação → App da Web.';
}

function doGet() {
  const json = lerDados_();
  return saida_({ ok: true, data: json ? JSON.parse(json) : null });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return saida_({ ok: false, erro: 'Requisição inválida' }); }
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
        const hist = SpreadsheetApp.getActive().getSheetByName(ABA_HISTORICO);
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
  const cfg = SpreadsheetApp.getActive().getSheetByName(ABA_CONFIG);
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
  const sh = SpreadsheetApp.getActive().getSheetByName(aba);
  if (!sh || sh.getLastRow() < 1) return '';
  return sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]).replace(/^~/, '')).join('');
}

function gravar_(aba, texto) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(aba) || ss.insertSheet(aba);
  sh.clearContents();
  const linhas = [];
  // o prefixo ~ impede a planilha de interpretar um pedaço que comece com "=" como fórmula
  for (let i = 0; i < texto.length; i += PEDACO) linhas.push(['~' + texto.slice(i, i + PEDACO)]);
  sh.getRange(1, 1, linhas.length, 1).setNumberFormat('@').setValues(linhas);
}

/** Lista legível dos serviços, só para consulta (editar aqui não muda o site). */
function atualizarLista_(d) {
  const ss = SpreadsheetApp.getActive();
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
