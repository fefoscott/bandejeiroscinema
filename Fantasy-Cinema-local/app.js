const root = document.querySelector('#app');
const state = { view: 'draft', filter: 'Filme', assetFilter: 'Filme', assetMode: 'available', picks: [], data: null, controller: 'Cine Clube', viewedTeam: 'Cine Clube', search: '', assetSearch: '', trades: [], tradeDraft: null, bids: [], bidDraft: null, configError: '', draftSync: 'connecting', draftError: '', draftNeedsPublish: false, draftSaving: false, tradeSync: 'connecting', tradeError: '', tradeSaving: false, waiverSync: 'connecting', waiverError: '', bidSaving: false };
const labels = { Filme: 'Filmes', Ator: 'Atores', Diretor: 'Diretores', Distribuidora: 'Distribuidoras' };
const API_URL = 'https://script.google.com/macros/s/AKfycbxN0N_FzoUNY0v0znpNWVffRGBwjsvPu4r4Ly7NkuzuD0-377GIGvkfo6_jLRY5uxD7/exec';
const LIVE_SHEETS = ['Cadastro', 'Simulador', 'Ranking Filmes', 'Ranking Distribuidoras', 'Ranking Diretores', 'Ranking Atores', 'Configuração'];
const DRAFT_STORAGE_KEY = 'bandejeiros-cinema-draft-2025';
const TRADE_STORAGE_KEY = 'bandejeiros-cinema-trades-2025';
const BID_STORAGE_KEY = 'bandejeiros-cinema-faab-bids-2025-v2';
const TEAM_NAMES_STORAGE_KEY = 'bandejeiros-cinema-team-names-2025';
const DEFAULT_STUDIO_NAMES = ['São Paulo Shareholders', 'Cuiabá Gators', 'Corumbá Jaguars', 'Toronto Prensadinhos', 'Beagá Flours', 'BH Peckers', 'Limoeiro Nets', 'Rochedo Risco'];
const LEGACY_STUDIO_NAMES = { 'Cataguases/Pato Branco/Rochedo': 'Rochedo Risco' };
const SEASON_FAAB = 100;
const DRAFT_POLL_MS = 3000;
let draftPollTimer = null;
let tradePollTimer = null;
let waiverPollTimer = null;

function savedDraft() {
  try {
    const picks = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '[]');
    return Array.isArray(picks) ? picks : [];
  } catch (error) {
    return [];
  }
}
function saveDraft() { localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state.picks)); }
function savedTrades() {
  try {
    const trades = JSON.parse(localStorage.getItem(TRADE_STORAGE_KEY) || '[]');
    return Array.isArray(trades) ? trades : [];
  } catch (error) {
    return [];
  }
}
function saveTrades() { localStorage.setItem(TRADE_STORAGE_KEY, JSON.stringify(state.trades)); }
function savedBids() { try { const bids=JSON.parse(localStorage.getItem(BID_STORAGE_KEY) || '[]'); return Array.isArray(bids)?bids:[]; } catch (error) { return []; } }
function saveBids() { localStorage.setItem(BID_STORAGE_KEY, JSON.stringify(state.bids)); }
function savedTeamNames() { try { const teams=JSON.parse(localStorage.getItem(TEAM_NAMES_STORAGE_KEY) || '[]'); return Array.isArray(teams)&&teams.length===8?teams:[]; } catch (error) { return []; } }
function saveTeamNames() { localStorage.setItem(TEAM_NAMES_STORAGE_KEY, JSON.stringify(state.data.teams)); }
function normalizedStudioName(team) { return LEGACY_STUDIO_NAMES[team] || team; }

function numberFromSheet(value) {
  const raw = String(value || '').trim().replace(/[^\d,.-]/g, '');
  if (!raw) return 0;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  const normalized = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  return Number(normalized) || 0;
}
function liveRows(sheets, name) { return sheets[name]?.values || []; }
function hydrateWithSheet(snapshot, payload) {
  if (!payload?.ok || !payload.sheets) return snapshot;
  const sheets = payload.sheets;
  const cadastro = liveRows(sheets, 'Cadastro').slice(2).filter(row => row[0]);
  const simRows = liveRows(sheets, 'Simulador').slice(2).filter(row => row[1]);
  const simByFilm = new Map(simRows.map(row => [row[1], row]));
  const fallbackFilms = new Map(snapshot.pools.Filme.map(item => [item.name, item]));
  const fallbackMetrics = new Map(snapshot.metrics.map(item => [item.film, item]));

  snapshot.metrics = cadastro.map(row => {
    const sim = simByFilm.get(row[0]) || [];
    const previous = fallbackMetrics.get(row[0]) || {};
    return {
      film: row[0],
      letterboxd: numberFromSheet(sim[2]) || previous.letterboxd || 0,
      globalBoxOffice: numberFromSheet(sim[3]),
      metascore: numberFromSheet(sim[4]) || previous.metascore || 0,
      audiencePoints: numberFromSheet(sim[5]),
      boxOfficePoints: numberFromSheet(sim[6]),
      criticPoints: numberFromSheet(sim[7]),
      awardPoints: numberFromSheet(sim[8]),
      total: numberFromSheet(sim[9])
    };
  });
  const metricsByFilm = new Map(snapshot.metrics.map(item => [item.film, item]));
  snapshot.pools.Filme = cadastro.map(row => {
    const sim = simByFilm.get(row[0]) || [];
    const previous = fallbackFilms.get(row[0]) || {};
    const metric = metricsByFilm.get(row[0]) || {};
    return { rank: numberFromSheet(sim[0]) || previous.rank || 999, name: row[0], distributor: row[1], director: row[2], actors: row.slice(3, 7).filter(Boolean), releaseDate: row[7] || previous.releaseDate || '', score: metric.total || 0 };
  }).sort((a, b) => a.rank - b.rank || b.score - a.score);

  function refreshPeople(position, sheetName) {
    const rows = liveRows(sheets, sheetName).slice(2).filter(row => row[0] && row[1]);
    if (!rows.length) return;
    snapshot.pools[position] = rows.map(row => ({ rank: numberFromSheet(row[0]) || 999, name: row[1], score: numberFromSheet(row[7]) }))
      .sort((a, b) => a.rank - b.rank || b.score - a.score);
  }
  refreshPeople('Diretor', 'Ranking Diretores');
  refreshPeople('Ator', 'Ranking Atores');

  const distributorFallback = new Map(snapshot.pools.Distribuidora.map(item => [item.name, item]));
  const distributorRows = liveRows(sheets, 'Ranking Distribuidoras').slice(2).filter(row => row[0] && row[1]);
  if (distributorRows.length) {
    snapshot.pools.Distribuidora = distributorRows.map(row => {
      const previous = distributorFallback.get(row[1]) || {};
      return { rank: numberFromSheet(row[0]) || 999, name: row[1], score: numberFromSheet(row[7]), topFilms: previous.topFilms || snapshot.pools.Filme.filter(film => film.distributor === row[1]).sort((a, b) => b.score - a.score).slice(0, 3).map(film => film.name) };
    }).sort((a, b) => a.rank - b.rank || b.score - a.score);
  }
  const configRows = liveRows(sheets, 'Configuração').slice(2).filter(row => row[0]);
  if (configRows.length) snapshot.scoring = configRows.map(row => ({ base: row[0], parameter: row[1], value: row[2], description: row[3] }));
  snapshot.meta = { ...snapshot.meta, source: `Google Sheets · atualização ${new Date(payload.generatedAt).toLocaleString('pt-BR')}` };
  return snapshot;
}
function restoreLocalLeagueState() {
  state.trades = savedTrades();
  state.bids = savedBids();
  const names=savedTeamNames().map(normalizedStudioName);
  if (names.length===state.data.teams.length) state.data.teams=names;
  if (!state.data.teams.includes(state.controller)) state.controller=state.data.teams[0];
  if (!state.data.teams.includes(state.viewedTeam)) state.viewedTeam=state.controller;
}
function sharedDraftPicks(picks) {
  return (picks || []).map(pick => {
    const number = Number(pick.number);
    const item = (state.data.pools[pick.position] || []).find(asset => asset.name === pick.asset);
    const slotOwner = number ? pickAt(number - 1).team : pick.team;
    return { number, round: Number(pick.round), team: slotOwner, position: pick.position, asset: pick.asset, originalAsset: pick.originalAsset || pick.asset, score: item?.score || 0, createdAt: pick.createdAt || '' };
  }).filter(pick => pick.number && pick.team && pick.position && pick.asset).sort((a, b) => a.number - b.number);
}
function sharedDraftChanged(next) {
  return JSON.stringify(state.picks.map(pick => [pick.number, pick.team, pick.position, pick.asset])) !== JSON.stringify(next.map(pick => [pick.number, pick.team, pick.position, pick.asset]));
}
function applySharedDraft(picks) {
  const next = sharedDraftPicks(picks);
  const changed = sharedDraftChanged(next);
  const syncChanged = state.draftSync !== 'shared' || state.draftNeedsPublish || Boolean(state.draftError);
  state.picks = next;
  state.draftNeedsPublish = false;
  state.draftSync = 'shared';
  state.draftError = '';
  saveDraft();
  return changed || syncChanged;
}
function localTradeStatus(status) {
  return ({ OFERECIDA: 'offered', 'PENDENTE_COMISSÁRIO': 'pendingCommissioner', APROVADA: 'approved', RECUSADA: 'rejected', VETADA: 'vetoed' })[status] || String(status || '').toLowerCase();
}
function localAcceptance(status) { return ({ PENDENTE: 'pending', ACEITA: 'accepted', RECUSADA: 'rejected' })[status] || String(status || '').toLowerCase(); }
function sharedTrades(trades, assets) {
  const picksByNumber = new Map(state.picks.map(pick => [Number(pick.number), pick]));
  return (trades || []).map(trade => ({
    id: trade.id,
    createdAt: trade.createdAt || '',
    initiator: trade.initiator,
    participants: trade.participants || [],
    status: localTradeStatus(trade.status),
    acceptances: Object.fromEntries(Object.entries(trade.acceptances || {}).map(([studio, status]) => [studio, localAcceptance(status)])),
    decidedAt: trade.decidedAt || '',
    decidedBy: trade.decidedBy || '',
    reason: trade.reason || '',
    transfers: (assets || []).filter(asset => asset.tradeId === trade.id).map(asset => {
      const pick = picksByNumber.get(Number(asset.pick));
      return { from: asset.from, to: asset.to, asset: { number: Number(asset.pick), position: asset.category, asset: asset.asset, score: pick?.score || 0 } };
    })
  })).sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)));
}
function sharedTradesChanged(next) {
  return JSON.stringify(state.trades.map(trade => [trade.id, trade.status, trade.acceptances, trade.transfers])) !== JSON.stringify(next.map(trade => [trade.id, trade.status, trade.acceptances, trade.transfers]));
}
function applySharedTrades(trades, assets) {
  const next = sharedTrades(trades, assets);
  const changed = sharedTradesChanged(next) || state.tradeSync !== 'shared' || Boolean(state.tradeError);
  state.trades = next;
  state.tradeSync = 'shared';
  state.tradeError = '';
  return changed;
}
async function refreshSharedTrades() {
  try {
    const response = await fetch(`${API_URL}?view=trades`, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.trades) || !Array.isArray(payload.assets)) throw new Error(payload.error || 'Resposta inválida de Transações');
    if (applySharedTrades(payload.trades, payload.assets)) render();
  } catch (error) {
    if (state.tradeSync !== 'error') {
      state.tradeSync = 'error';
      state.tradeError = 'Não foi possível sincronizar as transações compartilhadas.';
      render();
    }
  }
}
async function postTrade(action, body) {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...body }) });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Não foi possível atualizar a troca.');
  if (Array.isArray(payload.picks)) applySharedDraft(payload.picks);
  if (Array.isArray(payload.trades) && Array.isArray(payload.assets)) applySharedTrades(payload.trades, payload.assets);
  return payload;
}
function tableRecords(table) {
  const headers = table?.headers || [];
  return (table?.rows || []).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}
function sharedBids(table) {
  return tableRecords(table).filter(row => row.LANCE_ID).map(row => ({
    id: row.LANCE_ID,
    roundId: row.RODADA_ID || 'TESTE-2025',
    createdAt: row.ENVIADO_EM || '',
    studio: row.ESTÚDIO,
    position: row.CATEGORIA,
    asset: row.ATIVO,
    amount: Number(row.VALOR_FAAB) || 0,
    priority: Number(row.PRIORIDADE) || 1,
    drop: { number: Number(row.DROP_PICK), position: row.DROP_CATEGORIA, asset: row.DROP_ATIVO },
    dropDestination: clean(row.DESTINO_DROP) === 'banco' ? 'bank' : 'waiver',
    status: row.STATUS || 'ATIVO',
    result: row.RESULTADO || '',
    processedAt: row.PROCESSADO_EM || ''
  }));
}
function sharedBidsChanged(next) { return JSON.stringify(state.bids.map(bid => [bid.id, bid.amount, bid.status])) !== JSON.stringify(next.map(bid => [bid.id, bid.amount, bid.status])); }
function applySharedWaiver(payload) {
  const next = sharedBids(payload.bids);
  const changed = sharedBidsChanged(next) || state.waiverSync !== 'shared' || Boolean(state.waiverError);
  state.bids = next;
  state.waiverSync = 'shared';
  state.waiverError = '';
  return changed;
}
async function refreshSharedWaiver() {
  try {
    const response = await fetch(`${API_URL}?view=waiver`, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload.ok || !payload.bids) throw new Error(payload.error || 'Resposta inválida da Waiver');
    if (applySharedWaiver(payload)) render();
  } catch (error) {
    if (state.waiverSync !== 'error') {
      state.waiverSync = 'error';
      state.waiverError = 'Não foi possível sincronizar os lances compartilhados.';
      render();
    }
  }
}
async function postWaiverBid(body) {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action:'waiverBid', ...body }) });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Não foi possível registrar o lance.');
  applySharedWaiver(payload);
  return payload;
}
async function postWaiverPriorities(ids) {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action:'waiverPriorities', studio:state.controller, bidIds:ids }) });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Não foi possível atualizar as prioridades.');
  applySharedWaiver(payload);
  return payload;
}
async function refreshSharedDraft() {
  try {
    const response = await fetch(`${API_URL}?view=draft`, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.picks)) throw new Error(payload.error || 'Resposta inválida do Draft');
    if (!payload.picks.length && state.picks.length && state.draftSync !== 'shared') {
      state.draftNeedsPublish = true;
      state.draftSync = 'shared';
      state.draftError = '';
      render();
      return;
    }
    if (applySharedDraft(payload.picks)) render();
  } catch (error) {
    if (state.draftSync !== 'error') {
      state.draftSync = 'error';
      state.draftError = 'Não foi possível sincronizar o Draft compartilhado.';
      render();
    }
  }
}
async function postDraftPick(pick) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'draftPick', pick: pick.number, round: pick.round, studio: pick.team, category: pick.position, asset: pick.asset })
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Não foi possível registrar a escolha.');
  applySharedDraft(payload.picks);
}
async function replaceSharedDraft(picks) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'draftReplace', picks: picks.map(pick => ({ number: pick.number, round: pick.round, team: pick.team, position: pick.position, asset: pick.asset })) })
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Não foi possível atualizar o Draft.');
  applySharedDraft(payload.picks);
}
async function submitDraftPick(item) {
  const now = currentPick();
  if (state.draftSaving || now.team !== state.controller || !canPick(state.filter)) return;
  state.draftSaving = true;
  state.draftError = '';
  render();
  try {
    await postDraftPick({ ...now, position: state.filter, asset: item.name });
  } catch (error) {
    state.draftError = error.message || 'Não foi possível registrar a escolha.';
  } finally {
    state.draftSaving = false;
    render();
  }
}
async function publishLocalDraft() {
  if (state.draftSaving || !state.picks.length) return;
  state.draftSaving = true;
  state.draftError = '';
  render();
  try {
    for (const pick of [...state.picks].sort((a, b) => a.number - b.number)) await postDraftPick(pick);
    state.draftNeedsPublish = false;
  } catch (error) {
    state.draftError = error.message || 'Não foi possível publicar o draft local.';
  } finally {
    state.draftSaving = false;
    render();
  }
}
async function clearSharedDraft(restart) {
  if (state.draftSaving) return;
  state.draftSaving = true;
  state.draftError = '';
  render();
  try {
    await replaceSharedDraft([]);
    if (restart) state.filter = 'Filme';
  } catch (error) {
    state.draftError = error.message || 'Não foi possível limpar o Draft.';
  } finally {
    state.draftSaving = false;
    render();
  }
}
async function loadLeague() {
  const snapshot = await fetch('data.json', { cache: 'no-store' }).then(response => response.json());
  snapshot.teams = [...DEFAULT_STUDIO_NAMES];
  state.data = snapshot;
  state.data.meta = { ...state.data.meta, source: 'Snapshot local — buscando atualização da planilha...' };
  state.picks = savedDraft();
  restoreLocalLeagueState();
  render();
  refreshSharedDraft();
  refreshSharedTrades();
  refreshSharedWaiver();
  if (!draftPollTimer) draftPollTimer = setInterval(refreshSharedDraft, DRAFT_POLL_MS);
  if (!tradePollTimer) tradePollTimer = setInterval(refreshSharedTrades, DRAFT_POLL_MS);
  if (!waiverPollTimer) waiverPollTimer = setInterval(refreshSharedWaiver, DRAFT_POLL_MS);
  try {
    const url = `${API_URL}?sheet=${encodeURIComponent(LIVE_SHEETS.join(','))}`;
    const live = await fetch(url, { cache: 'no-store' }).then(response => response.json());
    state.data = hydrateWithSheet(snapshot, live);
    restoreLocalLeagueState();
    state.picks = sharedDraftPicks(state.picks);
    render();
  } catch (error) {
    state.data.meta = { ...state.data.meta, source: 'Snapshot local — atualização da planilha indisponível no momento' };
    render();
  }
}
loadLeague();
function pickAt(index) { const round = Math.floor(index / 8) + 1; const offset = index % 8; return { number:index + 1, round, team:state.data.teams[round % 2 ? offset : 7 - offset] }; }
function currentPick() { return pickAt(state.picks.length); }
async function simulateUntilEnd() {
  if (state.draftSaving) return;
  const simulated = [...state.picks];
  const used = new Set(simulated.map(pick => `${pick.position}::${pick.asset}`));
  while (simulated.length < 80) {
    const next = pickAt(simulated.length);
    const teamPicks = simulated.filter(pick => pick.team === next.team);
    const allowedPositions = Object.keys(labels).filter(position => teamPicks.filter(pick => pick.position === position).length < state.data.roster[position]);
    const choices = allowedPositions.flatMap(position => (state.data.pools[position] || [])
      .filter(asset => !used.has(`${position}::${asset.name}`))
      .map(asset => ({ position, asset })));
    if (!choices.length) break;
    choices.sort((a, b) => b.asset.score - a.asset.score || a.asset.rank - b.asset.rank);
    const choice = choices[0];
    simulated.push({ ...next, position: choice.position, asset: choice.asset.name, score: choice.asset.score });
    used.add(`${choice.position}::${choice.asset.name}`);
  }
  state.draftSaving = true;
  state.draftError = '';
  render();
  try {
    await replaceSharedDraft(simulated);
  } catch (error) {
    state.draftError = error.message || 'Não foi possível simular o Draft.';
  } finally {
    state.draftSaving = false;
    render();
  }
}
function roster(team) { const base = { Filme: [], Ator: [], Diretor: [], Distribuidora: [] }; state.picks.filter(p => p.team === team).forEach(p => base[p.position].push(p)); return base; }
function total(team) { return state.picks.filter(p => p.team === team).reduce((sum, p) => sum + p.score, 0); }
function isUsed(position, name) { return state.picks.some(p => p.position === position && p.asset === name); }
function canPick(position) { return roster(currentPick().team)[position].length < state.data.roster[position]; }
function fmt(n) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }); }
function posClass(position) { return `pos-${position.toLowerCase()}`; }
function picksUntilController() { for (let i=state.picks.length; i<80; i+=1) if (pickAt(i).team===state.controller) return i-state.picks.length; return null; }
function clean(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function avg(values) { const numbers=values.filter(value=>Number.isFinite(value)); return numbers.length ? numbers.reduce((sum,value)=>sum+value,0)/numbers.length : 0; }
function film(name) { return state.data.metrics.find(item=>item.film===name); }
function award(name) { return state.data.awards.find(item=>item.film===name); }
function relatedFilms(position, name) { return state.data.pools.Filme.filter(item => position==='Ator' ? item.actors.some(actor=>clean(actor)===clean(name)) : item.director===name); }
function actorAward(name) { return state.data.actorAwards.find(item=>clean(item.actor)===clean(name)); }
function usd(value) { return Number(value || 0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}); }
function owner(position, name) { return state.picks.find(item=>item.position===position && item.asset===name)?.team || 'Sem time'; }
function isAvailable(position, item) { return item.score===0 && owner(position,item.name)==='Sem time'; }
function assetBids(position, name) { return state.bids.filter(bid=>bid.position===position && bid.asset===name).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)); }
function currentBid(position, name, studio) { return assetBids(position,name).filter(bid=>bid.studio===studio).reduce((highest,bid)=>Math.max(highest,bid.amount),0); }
function winningBid(position, name) { const bids=assetBids(position,name); if (!bids.length) return null; return [...bids].sort((a,b)=>b.amount-a.amount || state.data.teams.indexOf(a.studio)-state.data.teams.indexOf(b.studio) || a.createdAt.localeCompare(b.createdAt))[0]; }
function committedFAAB(studio) { const settled=state.bids.filter(bid=>bid.studio===studio&&bid.status==='VENCEU').reduce((sum,bid)=>sum+bid.amount,0); const amounts=new Map(); state.bids.filter(bid=>bid.studio===studio&&bid.status==='ATIVO').forEach(bid=>{const key=`${bid.position}::${bid.asset}`; amounts.set(key,Math.max(amounts.get(key)||0,bid.amount));}); return settled+[...amounts.values()].reduce((sum,amount)=>sum+amount,0); }
function availableFAAB(studio) { return SEASON_FAAB-committedFAAB(studio); }
function startBid(position, name) { const item=(state.data.pools[position]||[]).find(asset=>asset.name===name); if (!item || !isAvailable(position,item)) return; state.bidDraft={position,name}; render(); }
function cancelBid() { state.bidDraft=null; render(); }
async function submitBid(amount, dropNumber) {
  const draft=state.bidDraft; const value=Number(amount); const drop=state.picks.find(pick=>pick.number===Number(dropNumber));
  if (!draft || state.bidSaving || !Number.isInteger(value) || value<1 || !drop || drop.team!==state.controller || drop.position!==draft.position) return;
  const current=winningBid(draft.position,draft.name); const own=currentBid(draft.position,draft.name,state.controller); const replacing=own;
  if (value<=Math.max(current?.amount||0,own)) { state.waiverError=`O lance precisa ser maior que ${Math.max(current?.amount||0,own)} FAAB.`; render(); return; }
  if (committedFAAB(state.controller)-replacing+value>SEASON_FAAB) { state.waiverError='A soma dos compromissos de FAAB ultrapassa o saldo disponível.'; render(); return; }
  state.bidSaving=true; state.waiverError=''; render();
  try {
    await postWaiverBid({ studio:state.controller, category:draft.position, asset:draft.name, amount:value, priority:1, dropPick:drop.number, dropCategory:drop.position, dropAsset:drop.asset, dropDestination:drop.score!==0?'BANCO':'WAIVER' });
    state.bidDraft=null;
  } catch (error) {
    state.waiverError=error.message || 'Não foi possível registrar o lance.';
  } finally {
    state.bidSaving=false; render();
  }
}
async function moveWaiverPriority(id, direction) {
  const active=state.bids.filter(bid=>bid.status==='ATIVO'&&bid.studio===state.controller).sort((a,b)=>b.amount-a.amount||a.priority-b.priority||a.createdAt.localeCompare(b.createdAt));
  const index=active.findIndex(bid=>bid.id===id); if (index<0) return;
  const group=active.filter(bid=>bid.amount===active[index].amount); const groupIndex=group.findIndex(bid=>bid.id===id); const target=groupIndex+Number(direction);
  if (!Number.isInteger(target) || target<0 || target>=group.length) return;
  const otherId=group[target].id; const otherIndex=active.findIndex(bid=>bid.id===otherId); const reordered=[...active]; [reordered[index],reordered[otherIndex]]=[reordered[otherIndex],reordered[index]];
  state.bidSaving=true; state.waiverError=''; render();
  try { await postWaiverPriorities(reordered.map(bid=>bid.id)); }
  catch (error) { state.waiverError=error.message || 'Não foi possível atualizar as prioridades.'; }
  finally { state.bidSaving=false; render(); }
}
function renameStudioReferences(rename) { const name=value=>rename[value]||value; state.picks.forEach(pick=>{pick.team=name(pick.team);}); state.bids.forEach(bid=>{bid.studio=name(bid.studio);}); state.trades.forEach(trade=>{trade.initiator=name(trade.initiator); trade.fromStudio=name(trade.fromStudio); trade.toStudio=name(trade.toStudio); if(trade.participants) trade.participants=trade.participants.map(name); if(trade.transfers) trade.transfers.forEach(transfer=>{transfer.from=name(transfer.from);transfer.to=name(transfer.to);}); if(trade.acceptances){const next={};Object.entries(trade.acceptances).forEach(([team,status])=>{next[name(team)]=status;});trade.acceptances=next;} }); }
async function saveStudioConfiguration(values) { const next=values.map(value=>value.trim()).filter(Boolean); if(next.length!==state.data.teams.length || new Set(next.map(clean)).size!==next.length){state.configError='Use oito nomes diferentes para os estúdios.';render();return;} const previous=[...state.data.teams]; const rename=Object.fromEntries(previous.map((team,index)=>[team,next[index]])); const remoteRename={...rename}; Object.entries(LEGACY_STUDIO_NAMES).forEach(([legacy,current])=>{remoteRename[legacy]=rename[current]||current;}); const changes=Object.entries(remoteRename).filter(([from,to])=>from!==to); try { if(changes.length) { const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'renameStudios',renames:Object.fromEntries(changes)})}); const payload=await response.json(); if(!payload.ok) throw new Error(payload.error||'Não foi possível preservar os dados do estúdio.'); } renameStudioReferences(rename); state.data.teams=next; state.controller=rename[state.controller]||state.controller; state.viewedTeam=rename[state.viewedTeam]||state.viewedTeam; state.configError=''; saveDraft(); saveBids(); saveTrades(); saveTeamNames(); render(); } catch(error) { state.configError=error.message||'Não foi possível salvar os nomes dos estúdios.'; render(); } }
function assetRef(pick) { return { number: pick.number, position: pick.position, asset: pick.asset, score: pick.score }; }
function pickFromRef(ref) { return state.picks.find(pick => pick.number === ref.number && pick.position === ref.position && pick.asset === ref.asset); }
function tradeRefs(trade) { return trade.transfers ? trade.transfers.map(transfer => transfer.asset) : [trade.offered, trade.requested].filter(Boolean); }
function hasOpenTrade(pick) { return state.trades.some(trade => trade.status==='pendingCommissioner' && tradeRefs(trade).some(ref => ref.number === pick.number)); }
function canTrade(pick) { return pick && !hasOpenTrade(pick); }
function tradeStatusLabel(status) { return ({ offered: 'Aguardando resposta', pendingCommissioner: 'Pendente do Comissário', approved: 'Aprovada', rejected: 'Recusada', vetoed: 'Vetada' })[status] || status; }
function startTrade(pick) { const teams=[state.controller]; if (pick && canTrade(pick) && pick.team !== state.controller) teams.push(pick.team); state.tradeDraft={ teams, selections: pick && pick.team===state.controller ? [{ number:pick.number, to:'' }] : [] }; state.view='transactions'; render(); }
function cancelTradeBuilder() { state.tradeDraft = null; render(); }
function toggleTradeTeam(team) {
  if (!state.tradeDraft || team===state.controller) return;
  const teams=state.tradeDraft.teams;
  if (teams.includes(team)) {
    state.tradeDraft.teams=teams.filter(item=>item!==team);
    state.tradeDraft.selections=state.tradeDraft.selections.filter(item=>{ const pick=state.picks.find(candidate=>candidate.number===item.number); return pick && pick.team!==team && item.to!==team; });
  } else if (teams.length<3) state.tradeDraft.teams=[...teams,team];
  render();
}
function toggleTradeAsset(number) {
  if (!state.tradeDraft) return;
  const pick=state.picks.find(item=>item.number===number);
  if (!pick || !state.tradeDraft.teams.includes(pick.team) || !canTrade(pick)) return;
  const exists=state.tradeDraft.selections.find(item=>item.number===number);
  state.tradeDraft.selections=exists ? state.tradeDraft.selections.filter(item=>item.number!==number) : [...state.tradeDraft.selections,{number,to:''}];
  render();
}
function setTradeDestination(number, to) { if (!state.tradeDraft) return; const selection=state.tradeDraft.selections.find(item=>item.number===number); if (selection) selection.to=to; render(); }
function tradeTransfers() { const teams=state.tradeDraft?.teams || []; return (state.tradeDraft?.selections || []).map(selection=>{ const pick=state.picks.find(item=>item.number===selection.number); const to=teams.length===2 ? teams.find(team=>team!==pick?.team) : selection.to; return pick && to ? { from:pick.team, to, asset:assetRef(pick) } : null; }).filter(Boolean); }
function sameCategories(first, second) { return Object.keys(labels).every(position => first.filter(item=>item.asset.position===position).length === second.filter(item=>item.asset.position===position).length); }
function tradeDraftValid() { const draft=state.tradeDraft; const transfers=tradeTransfers(); if (!draft || draft.teams.length<2 || transfers.length<2 || transfers.length!==draft.selections.length) return false; return draft.teams.every(team=>{ const outgoing=transfers.filter(item=>item.from===team); const incoming=transfers.filter(item=>item.to===team); return outgoing.length && incoming.length && sameCategories(outgoing,incoming); }); }
async function createTrade() {
  if (!tradeDraftValid() || state.tradeSaving) return;
  const transfers=tradeTransfers(); const participants=[...state.tradeDraft.teams];
  state.tradeSaving=true; state.tradeError=''; render();
  try {
    await postTrade('tradeCreate', { initiator: state.controller, participants, transfers: transfers.map(transfer => ({ from: transfer.from, to: transfer.to, pick: transfer.asset.number, category: transfer.asset.position, asset: transfer.asset.asset })) });
    state.tradeDraft=null;
  } catch (error) {
    state.tradeError=error.message || 'Não foi possível enviar a proposta.';
  } finally {
    state.tradeSaving=false; render();
  }
}
async function answerTrade(id, accepted) {
  const trade = state.trades.find(item => item.id === id);
  if (!trade || trade.status !== 'offered' || state.tradeSaving) return;
  state.tradeSaving=true; state.tradeError=''; render();
  try {
    await postTrade('tradeAnswer', { tradeId:id, studio:state.controller, accepted });
  } catch (error) {
    state.tradeError=error.message || 'Não foi possível responder à proposta.';
  } finally {
    state.tradeSaving=false; render();
  }
}
async function resolveTrade(id, approved) {
  const trade = state.trades.find(item => item.id === id);
  if (!trade || trade.status !== 'pendingCommissioner' || state.tradeSaving) return;
  state.tradeSaving=true; state.tradeError=''; render();
  try {
    await postTrade('tradeResolve', { tradeId:id, commissioner:state.controller, approved, reason:'' });
  } catch (error) {
    state.tradeError=error.message || 'Não foi possível decidir a troca.';
  } finally {
    state.tradeSaving=false; render();
  }
}

function pendingReplies() { return state.trades.filter(trade=>trade.status==='offered' && (trade.transfers ? trade.acceptances?.[state.controller]==='pending' : trade.toStudio===state.controller)).length; }
function nav() { const replies=pendingReplies(); return `<aside class="sidebar"><div class="brand"><img class="brand-logo" src="logo-bandejeiros-cinema.png" alt="Logo Bandejeiros Cinema" /><span>Bandejeiros Cinema</span></div><nav class="nav">${[['draft','Draft'],['myteam','Meu Estúdio'],['transactions','Transações'],['rosters','Liga'],['assets','Ativos'],['scoring','Pontuação'],['league','Regras']].map(([key,label]) => `<button data-view="${key}" class="${state.view===key?'active':''}"><span>${label}</span>${key==='transactions'&&replies?`<span class="nav-trade-alert" title="${replies} proposta(s) aguardando resposta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><b>${replies}</b></span>`:''}</button>`).join('')}</nav><div class="sidebar-controller"><label for="sidebar-controller">Estúdio controlado</label><select id="sidebar-controller">${state.data.teams.map(team=>`<option value="${team}" ${team===state.controller?'selected':''}>${team}</option>`).join('')}</select></div><div class="sidebar-foot">Temporada 2025<br>Fonte: ${state.data?.meta?.source || 'planilha'}<br>Modo comissário</div></aside>`; }
function header(title, text) { const control = state.view==='draft' ? `<span class="badge">${state.picks.length}/80 escolhas</span>` : `<span class="badge">${state.data.meta.source}</span>`; return `<header class="topbar"><div><h1>${title}</h1>${text?`<p class="sub">${text}</p>`:''}</div>${control}</header>`; }
function assetContext(a) { if (state.filter === 'Filme') return `${a.distributor} · ${a.director}${a.releaseDate?` · Estreia EUA: ${a.releaseDate}`:''}`; if (state.filter === 'Distribuidora') return a.topFilms.join(' · '); return relatedFilms(state.filter,a.name).slice(0,2).map(item=>item.name).join(' · ') || 'Sem filme associado'; }
function rosterLabel(position) { return position==='Distribuidora' ? 'Distribuidora' : labels[position]; }
function teamViewer() { const team = state.viewedTeam; const r = roster(team); return `<div class="card personal-roster"><div class="card-head studio-viewer-head"><select class="team-view-select" id="viewed-team" aria-label="Escolher estúdio para visualizar">${state.data.teams.map(item=>`<option value="${item}" ${item===team?'selected':''}>${item}</option>`).join('')}</select><strong class="points">${fmt(total(team))}</strong></div><div class="personal-list">${Object.keys(labels).map(pos=>`<div class="personal-group ${posClass(pos)}"><div class="roster-label">${rosterLabel(pos)} · ${r[pos].length}/${state.data.roster[pos]}</div>${r[pos].map(p=>`<div class="roster-item"><span>${p.asset}</span><strong>${fmt(p.score)}</strong></div>`).join('') || '<span class="count">vaga vazia</span>'}</div>`).join('')}</div></div>`; }
function draftAsset(pick) { return pick.originalAsset || pick.asset; }
function boardDetail(pick) { const drafted=draftAsset(pick); if (pick.position==='Filme') { const item=state.data.pools.Filme.find(entry=>entry.name===drafted); return item ? `${item.director} · ${item.distributor}` : ''; } if (pick.position==='Distribuidora') { const count=state.data.pools.Filme.filter(item=>item.distributor===drafted).length; return `${count} ${count===1?'filme':'filmes'}`; } return relatedFilms(pick.position,drafted).map(item=>item.name).join(' · '); }
function draftBoard() { return `<section class="draft-board card"><div class="board-label"><strong>Quadro de escolhas</strong><span>Snake draft</span></div><div class="board-scroll"><div class="board-grid">${state.data.teams.map((team,teamIndex)=>`<article class="board-team ${team===state.controller?'controlled':''}"><header><span class="team-dot"></span><b>${team}</b></header>${Array.from({length:10},(_,index)=>{const round=index+1; const slot=round%2 ? teamIndex+1 : 8-teamIndex; const pick=state.picks.find(item=>item.number===(round-1)*8+slot); const code=`${round}.${String(slot).padStart(2,'0')}`; const dropped=pick&&draftAsset(pick)!==pick.asset; return `<div class="board-pick ${pick?posClass(pick.position):'empty-pick'} ${dropped?'draft-dropped':''}">${pick?`<b>${draftAsset(pick)}</b><small>${boardDetail(pick)}</small>`:''}<span class="board-number">${code}</span></div>`;}).join('')}</article>`).join('')}</div></div></section>`; }
function draft() {
  const next = currentPick(); const done = state.picks.length >= 80; const mine = !done && next.team === state.controller; const distance = picksUntilController();
  const pool = (state.data.pools[state.filter] || []).filter(item => !isUsed(state.filter, item.name));
  const clockCopy = mine ? 'É a sua vez.' : `${next.team} está no relógio. Faltam ${distance} ${distance===1?'escolha':'escolhas'} até a sua vez.`;
  const syncNote = state.draftError || (state.draftNeedsPublish ? 'Seu draft local ainda não foi publicado na planilha.' : state.draftSync==='shared' ? 'Draft compartilhado · atualiza automaticamente' : 'Conectando ao Draft compartilhado...');
  const syncAction = state.draftNeedsPublish ? `<button class="button primary" data-publish-local-draft ${state.draftSaving?'disabled':''}>${state.draftSaving?'Publicando...':'Publicar draft local'}</button>` : '';
  return `${header('Draft', '')}<div class="actions draft-sync-actions"><button class="button primary" data-action="simulate" ${state.draftSaving?'disabled':''}>${state.draftSaving?'Salvando...':'Simular até o fim'}</button><button class="button" data-action="reset" ${state.draftSaving?'disabled':''}>Recomeçar manualmente</button><button class="button danger" data-action="clear" ${state.draftSaving?'disabled':''}>Limpar escolhas</button>${syncAction}<span class="count">${syncNote}</span></div>${draftBoard()}<section class="grid draft-layout" style="margin-top:16px"><div class="card draft-main"><div class="now ${done?'draft-complete':''}">${done ? `<div class="now-team">Draft concluído</div>` : `<div class="now-eyebrow">${mine ? 'Você está no relógio' : 'No relógio'}</div><div class="now-team">${mine ? state.controller : next.team}</div>`}</div>${done ? '' : `<div class="clock-message ${mine?'your-turn':''}">${clockCopy}</div>`}<div class="draft-selection-scroll"><div class="draft-selection-inner"><div class="tabs">${Object.keys(labels).map(key=>`<button class="tab ${posClass(key)} ${state.filter===key?'active':''}" data-filter="${key}">${labels[key]}</button>`).join('')}</div><div class="search-wrap"><label for="asset-search">Buscar ativo</label><input id="asset-search" type="search" value="${state.search}" placeholder="Digite o nome do filme, ator, diretor ou distribuidora" /></div><div class="assets">${pool.map(item=>`<button class="asset ${posClass(state.filter)}" data-pick="${item.name}" ${done || !mine || !canPick(state.filter) || state.draftSaving ? 'disabled' : ''}><span class="rank">#${item.rank}</span><span class="name">${item.name}<br><small>${assetContext(item)}</small></span><span class="points">${fmt(item.score)}</span></button>`).join('') || '<p class="empty">Não há ativos livres com esse nome.</p>'}</div></div></div></div>${teamViewer()}</section>`;
}

function releaseIsFuture(value) { if (!value) return false; const text=String(value).trim(); let date; const brazilian=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (brazilian) date=new Date(`${brazilian[3]}-${brazilian[2].padStart(2,'0')}-${brazilian[1].padStart(2,'0')}T23:59:59-03:00`); else date=new Date(text); return !Number.isNaN(date?.getTime()) && date.getTime()>Date.now(); }
function assetHasFutureRelease(pick) { if (pick.position==='Filme') return releaseIsFuture(state.data.pools.Filme.find(item=>item.name===pick.asset)?.releaseDate); if (pick.position==='Distribuidora') return state.data.pools.Filme.some(item=>item.distributor===pick.asset&&releaseIsFuture(item.releaseDate)); return relatedFilms(pick.position,pick.asset).some(item=>releaseIsFuture(item.releaseDate)); }
function assetReleaseStatus(pick) { const films=pick.position==='Filme'?[state.data.pools.Filme.find(item=>item.name===pick.asset)].filter(Boolean):pick.position==='Distribuidora'?state.data.pools.Filme.filter(item=>item.distributor===pick.asset):relatedFilms(pick.position,pick.asset); if (films.length>1) { const upcoming=films.filter(item=>releaseIsFuture(item.releaseDate)).length; const released=films.length-upcoming; return `<small class="asset-status composition-status"><span class="released">${released} em cartaz</span><span class="upcoming">${upcoming} em breve</span></small>`; } const upcoming=pick.score===0||assetHasFutureRelease(pick); return `<small class="asset-status ${upcoming?'upcoming':'released'}">${upcoming?'Em breve':'Em cartaz'}</small>`; }
function pendingCounts(team) { const r=roster(team); return Object.fromEntries(Object.keys(labels).map(position=>[position,r[position].filter(assetHasFutureRelease).length])); }
function studioInitials(team) { return team.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase(); }
function pendingSummary(team) { const counts=pendingCounts(team); const names={Filme:['Filme','Filmes'],Ator:['Ator','Atores'],Diretor:['Diretor','Diretores'],Distribuidora:['Distribuidora','Distribuidoras']}; const short={Filme:'Fil.',Ator:'Ato.',Diretor:'Dir.',Distribuidora:'Dis.'}; const parts=['Filme','Ator','Diretor'].filter(position=>counts[position]).map(position=>`<span class="pending-type ${posClass(position)}"><i></i><span class="pending-full">${counts[position]} ${names[position][counts[position]===1?0:1]}</span><span class="pending-short">${counts[position]} ${short[position]}</span></span>`); const distributorFilms=roster(team).Distribuidora.reduce((sum,pick)=>sum+(assetHasFutureRelease(pick)?state.data.pools.Filme.filter(film=>film.distributor===pick.asset&&releaseIsFuture(film.releaseDate)).length:0),0); if (counts.Distribuidora) parts.push(`<span class="pending-type ${posClass('Distribuidora')}"><i></i><span class="pending-full">${counts.Distribuidora} ${names.Distribuidora[counts.Distribuidora===1?0:1]} <small>(${distributorFilms} ${distributorFilms===1?'filme':'filmes'})</small></span><span class="pending-short">${counts.Distribuidora} ${short.Distribuidora} (${distributorFilms} Fil.)</span></span>`); return `<div class="pending-summary">${parts.join('')||'<em>Sem estreias pendentes</em>'}</div>`; }
function leagueTable() { const ordered=[...state.data.teams].sort((a,b)=>total(b)-total(a)); return `<div class="card standings"><div class="standings-header"><span>Rank</span><span>Estúdio</span><span>FAAB</span><span>Estreias pendentes</span><span>FPTS</span></div><div class="standings-list">${ordered.map((team,index)=>`<div class="standing-row ${team===state.controller?'controlled':''}"><span class="standing-rank">${index+1}</span><div class="standing-team"><span class="studio-avatar">${studioInitials(team)}</span><div><b>${team}</b></div></div><strong class="standing-faab">${availableFAAB(team)}</strong>${pendingSummary(team)}<strong class="points">${fmt(total(team))}</strong></div>`).join('')}</div></div>`; }
function rostersView() { return `${header('Liga', '')}<section class="grid league-layout">${leagueTable()}${teamViewer()}</section>`; }

function myTeamAsset(pick) { const tradeButton=canTrade(pick)?`<button class="trade-icon-button" data-start-trade="${pick.number}" title="Propor troca" aria-label="Propor troca usando ${pick.asset}"><svg class="trade-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7h9.2l-2.6-2.6L15 3l5 5-5 5-1.4-1.4L16.2 9H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5Z"/><path d="M17 17H7.8l2.6 2.6L9 21l-5-5 5-5 1.4 1.4L7.8 15H17a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5Z"/></svg></button>`:''; const tradeNote=hasOpenTrade(pick)?'<small class="trade-note">Negociado</small>':''; return `<div class="my-team-asset ${posClass(pick.position)}"><div><span class="my-team-position">${rosterLabel(pick.position)}</span><b>${pick.asset}</b>${assetReleaseStatus(pick)}${tradeNote}</div><div class="my-team-actions"><strong>${fmt(pick.score)}</strong>${tradeButton}</div></div>`; }
function selectedTrade(number) { return state.tradeDraft?.selections.find(item=>item.number===number); }
function tradeBuilder() {
  if (!state.tradeDraft) return `<section class="card trade-builder trade-starter"><div><h2>Propor troca</h2><span class="count">Monte uma troca entre dois ou três estúdios.</span></div><button class="button trade-propose" data-start-trade>Propor troca</button></section>`;
  const draft=state.tradeDraft; const valid=tradeDraftValid(); const chosen=draft.selections.length;
  return `<section class="card trade-builder"><div class="card-head"><div><h2>Propor troca</h2><span class="count">Selecione até 2 estúdios. Em troca tripla, defina o destino de cada ativo.</span></div><button class="button" data-cancel-trade ${state.tradeSaving?'disabled':''}>Cancelar</button></div><div class="trade-team-picker"><span>Estúdios</span>${state.data.teams.filter(team=>team!==state.controller).map(team=>`<button class="studio-toggle ${draft.teams.includes(team)?'selected':''}" data-toggle-trade-team="${team}" ${!draft.teams.includes(team)&&draft.teams.length===3||state.tradeSaving?'disabled':''}>${team}</button>`).join('')}</div><div class="trade-columns">${draft.teams.map(team=>`<article class="trade-column"><header><b>${team}</b><small>${team===state.controller?'Você':''}</small></header><div>${state.picks.filter(pick=>pick.team===team&&canTrade(pick)).sort((a,b)=>a.position.localeCompare(b.position)||a.asset.localeCompare(b.asset,'pt-BR')).map(pick=>{const selection=selectedTrade(pick.number); return `<div class="trade-asset ${posClass(pick.position)} ${selection?'selected':''}"><button data-toggle-trade-asset="${pick.number}" ${state.tradeSaving?'disabled':''}><span>${rosterLabel(pick.position)}</span><b>${pick.asset}</b></button>${selection&&draft.teams.length===3?`<select data-trade-destination="${pick.number}" ${state.tradeSaving?'disabled':''}><option value="">Enviar para…</option>${draft.teams.filter(target=>target!==team).map(target=>`<option value="${target}" ${selection.to===target?'selected':''}>${target}</option>`).join('')}</select>`:''}</div>`;}).join('')||'<p class="empty">Sem ativos negociáveis.</p>'}</div></article>`).join('')}</div><div class="trade-submit"><span class="count">${chosen ? `${chosen} ativo(s) selecionado(s)` : 'Selecione os ativos que entram na troca.'}${chosen&&!valid?' · cada estúdio precisa enviar e receber as mesmas categorias.':''}</span><button class="button primary" data-submit-trade ${valid&&!state.tradeSaving?'':'disabled'}>${state.tradeSaving?'Enviando...':'Enviar proposta'}</button></div></section>`;
}
function tradeDescription(trade) { const transfers=trade.transfers || [{from:trade.fromStudio,to:trade.toStudio,asset:trade.offered},{from:trade.toStudio,to:trade.fromStudio,asset:trade.requested}]; return transfers.map(transfer=>`<b>${transfer.from}</b> envia <b>${transfer.asset.asset}</b> para <b>${transfer.to}</b>`).join(' · '); }
function tradeTransfersFor(trade) { return trade.transfers || [{from:trade.fromStudio,to:trade.toStudio,asset:trade.offered},{from:trade.toStudio,to:trade.fromStudio,asset:trade.requested}]; }
function tradeParticipants(trade) { return trade.participants || [...new Set(tradeTransfersFor(trade).flatMap(transfer=>[transfer.from,transfer.to]))]; }
function tradeDate(value) { return new Date(value).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}); }
function tradeTransferGroups(trade) { const groups=new Map(); tradeTransfersFor(trade).forEach(transfer=>{const key=`${transfer.to}::${transfer.from}`; if(!groups.has(key)) groups.set(key,{to:transfer.to,from:transfer.from,assets:[]}); groups.get(key).assets.push(transfer.asset);}); return [...groups.values()]; }
function tradeFeed(trade) {
  const reply=trade.status==='offered' && (trade.acceptances ? trade.acceptances[state.controller]==='pending' : trade.toStudio===state.controller);
  return `<article class="trade-feed ${trade.status}"><div class="trade-feed-status"><svg class="trade-feed-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h9.2l-2.6-2.6L15 3l5 5-5 5-1.4-1.4L16.2 9H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5Z"/><path d="M17 17H7.8l2.6 2.6L9 21l-5-5 5-5 1.4 1.4L7.8 15H17a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5Z"/></svg><b>${tradeStatusLabel(trade.status)}</b></div><div class="trade-feed-moves">${tradeTransferGroups(trade).map(group=>`<section class="trade-feed-group"><p>para <b>${group.to}</b> de ${group.from}</p>${group.assets.map(asset=>`<div class="trade-gain ${posClass(asset.position)}"><span>+</span><b>${asset.asset}</b></div>`).join('')}</section>`).join('')}</div><time>${tradeDate(trade.createdAt)}</time>${reply?`<div class="actions trade-feed-actions"><button class="button counter-offer" data-counter-trade="${trade.id}" ${state.tradeSaving?'disabled':''}>Contra-proposta</button><button class="button accept-offer" data-answer-trade="${trade.id}" data-answer="accept" ${state.tradeSaving?'disabled':''}>Aceitar</button><button class="button danger" data-answer-trade="${trade.id}" data-answer="reject" ${state.tradeSaving?'disabled':''}>Recusar</button></div>`:''}</article>`;
}
function tradeDesk() { const active=state.trades.filter(trade=>trade.status==='offered'); return `<section class="card trade-desk"><div class="card-head"><div><h2>Propostas ativas</h2></div><button class="button trade-propose" data-start-trade>Propor troca</button></div><div class="trade-feed-list">${active.map(trade=>tradeFeed(trade)).join('')||'<p class="empty">Nenhuma proposta ativa.</p>'}</div></section>`; }
const waiverExplanation='O processamento segue o valor do lance, do maior para o menor. Você só pode ordenar lances de mesmo valor.';
const waiverAvailabilityExplanation=`${waiverExplanation} Se dois lances usam o mesmo drop, o de maior valor ocupa a vaga; o outro é ignorado e o próximo lance elegível por aquele ativo pode vencer. <strong>Não é possível cancelar o lance.</strong>`;
function waiverDesk() { const bids=state.bids.filter(bid=>bid.status==='ATIVO'&&bid.studio===state.controller).sort((a,b)=>b.amount-a.amount||a.priority-b.priority||a.createdAt.localeCompare(b.createdAt)); const groups=[...bids.reduce((map,bid)=>{const group=map.get(bid.amount)||[];group.push(bid);map.set(bid.amount,group);return map;},new Map()).entries()]; let order=0; return `<section class="card trade-desk waiver-desk"><div class="card-head"><div><h2>Leilão pendente</h2><span class="count">${waiverExplanation}</span></div></div><div class="waiver-pending-list">${groups.map(([amount,group])=>`<section class="waiver-value-group"><h3>${amount} FAAB</h3>${group.map((bid,index)=>`<article class="waiver-pending ${posClass(bid.position)}"><span class="waiver-order">${++order}</span><div class="waiver-pending-moves"><div class="trade-gain ${posClass(bid.position)}"><span>+</span><b>${bid.asset}</b></div><div class="trade-gain waiver-drop-line ${posClass(bid.drop.position)}"><span>−</span><b>${bid.drop.asset}</b></div></div>${group.length>1?`<div class="waiver-priority-actions"><button class="priority-arrow" data-waiver-move="${bid.id}" data-waiver-direction="-1" aria-label="Subir prioridade" title="Subir prioridade" ${index===0||state.bidSaving?'disabled':''}>↑</button><button class="priority-arrow" data-waiver-move="${bid.id}" data-waiver-direction="1" aria-label="Descer prioridade" title="Descer prioridade" ${index===group.length-1||state.bidSaving?'disabled':''}>↓</button></div>`:'<span class="waiver-priority-spacer"></span>'}</article>`).join('')}</section>`).join('')||'<p class="empty">Nenhum lance pendente.</p>'}</div></section>`; }
function waiverFeed(bid) { const date=bid.processedAt||bid.createdAt; return `<article class="trade-feed waiver-feed"><div class="trade-feed-status"><b>Waiver</b></div><div class="trade-feed-moves"><section class="trade-feed-group"><p>para <b>${bid.studio}</b> · ${bid.amount} FAAB</p><div class="trade-gain ${posClass(bid.position)}"><span>+</span><b>${bid.asset}</b></div><div class="trade-gain waiver-drop-line ${posClass(bid.drop.position)}"><span>−</span><b>${bid.drop.asset}</b></div></section></div><time>${tradeDate(date)}</time></article>`; }
function counterTrade(id) { const trade=state.trades.find(item=>item.id===id); if (!trade) return; state.tradeDraft={teams:tradeParticipants(trade),selections:[]}; render(); }
function transactions() {
  const trades=[...state.trades].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const history=trades.filter(trade=>trade.status!=='offered');
  const waivers=state.bids.filter(bid=>bid.status==='VENCEU');
  const historyItems=[...history.map(trade=>({date:trade.createdAt,html:`${tradeFeed(trade)}${trade.status==='pendingCommissioner'?`<div class="actions commissioner-actions"><button class="button primary" data-resolve-trade="${trade.id}" data-resolution="approve" ${state.tradeSaving?'disabled':''}>Aprovar</button><button class="button danger" data-resolve-trade="${trade.id}" data-resolution="veto" ${state.tradeSaving?'disabled':''}>Vetar</button></div>`:''}`})),...waivers.map(bid=>({date:bid.processedAt||bid.createdAt,html:waiverFeed(bid)}))].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const left=state.tradeDraft?`${tradeBuilder()}${tradeDesk()}${waiverDesk()}`:`${tradeDesk()}${waiverDesk()}`;
  return `${header('Transações', '')}${state.tradeError?`<p class="config-error">${state.tradeError}</p>`:''}<section class="grid transactions-layout"><div class="transactions-left">${left}</div><section class="card transactions-card"><div class="card-head"><div><h2>Histórico</h2><span class="count">${trades.filter(trade=>trade.status==='pendingCommissioner').length} pendente(s) do Comissário</span></div></div><div class="trade-feed-list">${historyItems.map(item=>item.html).join('')||'<p class="empty">Nenhuma transação concluída, recusada, vetada ou waiver processada.</p>'}</div></section></section>`;
}
function myTeam() {
  const team = state.controller;
  const order = { Filme: 0, Diretor: 1, Ator: 2, Distribuidora: 3 };
  const picks = state.picks.filter(pick => pick.team === team).sort((a, b) => order[a.position] - order[b.position] || a.asset.localeCompare(b.asset, 'pt-BR'));
  const drops = state.bids.filter(bid => bid.studio===team && bid.status==='VENCEU').sort((a,b)=>String(b.processedAt||b.createdAt).localeCompare(String(a.processedAt||a.createdAt)));
  return `${header('Meu Estúdio', '')}<section class="grid my-team-layout"><article class="card my-team-card"><div class="card-head"><h2>${team}</h2><strong class="points">${fmt(picks.reduce((sum, pick) => sum + pick.score, 0))}</strong></div><div class="my-team-assets">${picks.map(myTeamAsset).join('') || '<p class="empty">Nenhum ativo neste estúdio.</p>'}</div></article><div class="my-team-right-stack"><article class="card drops-card"><div class="card-head"><h2>Drops</h2></div><div class="drops-list">${drops.map(waiverDropCard).join('') || '<p class="empty">Nenhum drop realizado.</p>'}</div></article></div></section>`;
}

function waiverDropCard(bid) { return `<div class="drop-asset ${posClass(bid.drop.position)}"><s>${bid.drop.asset}</s><div class="drop-replacement"><span>+</span><b>${bid.asset}</b></div><time>${tradeDate(bid.processedAt||bid.createdAt)}</time></div>`; }

function metricCell(value, points) { return `<div class="metric-cell"><b>${value}</b><small>${fmt(points)} FPTS</small></div>`; }
function awardLines(items) { return items.length ? items.map(line=>`<span>${line}</span>`).join('') : '<span>Sem indicações</span>'; }
function shortAward(category) { return category.replace('Oscar Melhor ','O. Melhor ').replace('Oscar ','O. ').replace('Globo Melhor ','G. Melhor ').replace('Globo ','G. ').replace('Globo de Ouro: ','G. ').replace('Oscar: ','O. '); }
function filmAwardSummary(name) { const item=award(name); if (!item) return { points:0, detail:'<span>Sem registro</span>' }; const entries=Object.entries(item.categories || {}).filter(([,result])=>result).map(([category,result])=>`${shortAward(category)}: ${result}`); return { points:item.filmPoints || 0, detail:awardLines(entries) }; }
function assetRows(position, include=()=>true) {
  if (position==='Filme') return state.data.pools.Filme.filter(include).map(item=>{ const m=film(item.name)||{}; const prizes=filmAwardSummary(item.name); return [item.name,item.releaseDate||'—',owner('Filme',item.name),`<strong class="fpts">${fmt(item.score)}</strong>`,metricCell(Number(m.letterboxd||0).toFixed(1),m.audiencePoints||0),metricCell(usd(m.globalBoxOffice||0),m.boxOfficePoints||0),metricCell(m.metascore||0,m.criticPoints||0),`<div class="award-lines">${prizes.detail}<b>${fmt(prizes.points)} FPTS</b></div>`]; });
  if (position==='Diretor') return state.data.pools.Diretor.filter(include).map(item=>{ const films=relatedFilms('Diretor',item.name), metrics=films.map(entry=>film(entry.name)).filter(Boolean), awards=films.map(entry=>award(entry.name)).filter(Boolean); const prize=avg(awards.map(entry=>entry.directorPoints||0)); const detail=awards.flatMap(entry=>Object.entries(entry.categories||{}).filter(([category,result])=>result && /Direção|Melhor Filme/.test(category)).map(([category,result])=>`${shortAward(category)}: ${result}`)); return [item.name,owner('Diretor',item.name),`<strong class="fpts">${fmt(item.score)}</strong>`,films.map(entry=>entry.name).join(' · ')||'Sem filme cadastrado',metricCell(avg(metrics.map(entry=>entry.letterboxd||0)).toFixed(1),avg(metrics.map(entry=>entry.audiencePoints||0))),metricCell(usd(avg(metrics.map(entry=>entry.globalBoxOffice||0))),avg(metrics.map(entry=>(entry.boxOfficePoints||0)*.5))),metricCell(avg(metrics.map(entry=>entry.metascore||0)).toFixed(1),avg(metrics.map(entry=>entry.criticPoints||0))),`<div class="award-lines">${awardLines(detail)}<b>${fmt(prize)} FPTS</b></div>`]; });
  if (position==='Ator') return state.data.pools.Ator.filter(include).map(item=>{ const films=relatedFilms('Ator',item.name), metrics=films.map(entry=>film(entry.name)).filter(Boolean), prizes=actorAward(item.name); const detail=prizes?Object.entries(prizes.categories||{}).filter(([,result])=>result).map(([category,result])=>`${shortAward(category)}: ${result}`):[]; return [item.name,owner('Ator',item.name),`<strong class="fpts">${fmt(item.score)}</strong>`,films.map(entry=>entry.name).join(' · ')||'Sem filme cadastrado',metricCell(avg(metrics.map(entry=>entry.letterboxd||0)).toFixed(1),avg(metrics.map(entry=>entry.audiencePoints||0))),metricCell(usd(avg(metrics.map(entry=>entry.globalBoxOffice||0))),avg(metrics.map(entry=>(entry.boxOfficePoints||0)*.5))),metricCell(avg(metrics.map(entry=>entry.metascore||0)).toFixed(1),avg(metrics.map(entry=>entry.criticPoints||0))),`<div class="award-lines">${awardLines(detail)}<b>${fmt(prizes?.points||0)} FPTS</b></div>`]; });
  return state.data.pools.Distribuidora.filter(include).map(item=>{ const names=item.topFilms||[]; return [item.name,owner('Distribuidora',item.name),`<strong class="fpts">${fmt(item.score)}</strong>`,...Array.from({length:3},(_,index)=>{ const name=names[index]; return name ? `${name}<small class="component-points">${fmt(film(name)?.total||0)} FPTS</small>` : '—'; })]; });
}
function table(headers, rows, className='', sortable=false, nameIndex=0) { return `<div class="card data-card ${className}"><div class="table-wrap"><table><thead><tr>${headers.map((head,index)=>`<th>${sortable&&head?`<button class="table-sort" data-sort-column="${index}">${head}<span>↕</span></button>`:head}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr data-row-name="${row[nameIndex]}">${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`; }
function applyDraftSearch(query) { root.querySelectorAll('.draft-main .asset[data-pick]').forEach(asset=>{ asset.hidden=!clean(asset.dataset.pick).includes(clean(query)); }); }
function applyAssetSearch(query) { root.querySelectorAll('.asset-table tbody tr').forEach(row=>{ row.hidden=!clean(row.dataset.rowName).includes(clean(query)); }); }
function sortableValue(value) { const text=value.replace(/\s+/g,' ').trim(); const digits=text.replace(/[^\d,.-]/g,''); if (/^-?[\d.,]+$/.test(digits) && /\d/.test(digits)) { const comma=digits.lastIndexOf(','); const dot=digits.lastIndexOf('.'); return comma>dot ? Number(digits.replace(/\./g,'').replace(',','.')) : Number(digits.replace(/,/g,'')); } return clean(text); }
function sortAssetColumn(button) { const index=Number(button.dataset.sortColumn); const table=button.closest('table'); const body=table.querySelector('tbody'); const direction=button.dataset.direction==='asc'?'desc':'asc'; [...table.querySelectorAll('.table-sort')].forEach(item=>{item.dataset.direction=''; item.querySelector('span').textContent='↕';}); button.dataset.direction=direction; button.querySelector('span').textContent=direction==='asc'?'↑':'↓'; const rows=[...body.rows].sort((a,b)=>{const first=sortableValue(a.cells[index].textContent);const second=sortableValue(b.cells[index].textContent);const comparison=typeof first==='number'&&typeof second==='number'?first-second:String(first).localeCompare(String(second),'pt-BR',{numeric:true});return direction==='asc'?comparison:-comparison;}); rows.forEach(row=>body.appendChild(row)); }
function bidHistory(position,name) { const bids=assetBids(position,name); return bids.length ? bids.map(bid=>`${bid.studio} ${bid.amount}`).join(' · ') : 'Sem lances'; }
function bidModal() { const draft=state.bidDraft; if (!draft) return ''; const current=winningBid(draft.position,draft.name); const minimum=(current?.amount||0)+1; const drops=state.picks.filter(pick=>pick.team===state.controller&&pick.position===draft.position).sort((a,b)=>a.asset.localeCompare(b.asset,'pt-BR')); const dropOptions=drops.map(drop=>`<option value="${drop.number}">${drop.asset} — ${drop.score!==0?'Banco (já pontuou)':'Waiver (ainda sem pontuação)'}</option>`).join(''); return `<div class="modal-backdrop"><section class="bid-modal" role="dialog" aria-modal="true" aria-labelledby="bid-title"><h2 id="bid-title">Confirmar lance</h2><p>Você está prestes a dar um lance em <b>${draft.name}</b>.</p><label for="bid-amount">Lance FAAB</label><input id="bid-amount" type="number" min="${minimum}" max="${availableFAAB(state.controller)+currentBid(draft.position,draft.name,state.controller)}" value="${minimum}" autofocus ${state.bidSaving?'disabled':''} />${drops.length?`<label for="bid-drop">Drop obrigatório · ${rosterLabel(draft.position)}</label><select id="bid-drop" ${state.bidSaving?'disabled':''}>${dropOptions}</select><small>Se o lance vencer: ativo que já pontuou vai para o <b>Banco</b>; ativo sem pontuação volta para a <b>Waiver</b>. Se não vencer, nenhum ativo é adicionado ou dropado.</small>`:'<small class="bid-error">Você não possui um ativo dessa categoria para dropar.</small>'}<small>Seu lance será visível para toda a liga e não poderá ser cancelado. FAAB disponível para compromissos: <b>${availableFAAB(state.controller)}</b> / ${SEASON_FAAB}.</small>${state.waiverError?`<p class="config-error">${state.waiverError}</p>`:''}<div class="actions"><button class="button" data-cancel-bid ${state.bidSaving?'disabled':''}>Voltar</button><button class="button accept-offer" data-confirm-bid ${drops.length&&!state.bidSaving?'':'disabled'}>${state.bidSaving?'Registrando...':'Confirmar lance'}</button></div></section></div>`; }
function availableRows(position) { return (state.data.pools[position]||[]).filter(item=>isAvailable(position,item)).map(item=>{const leader=winningBid(position,item.name); const row=[`<button class="add-icon" data-start-bid-asset="${item.name}" data-start-bid-position="${position}" title="Adicionar ${item.name}" aria-label="Adicionar ${item.name}">+</button>`,item.name]; if(position==='Filme') row.push(item.releaseDate||'—'); return [...row,leader?`${leader.amount} FAAB`:'—',leader?leader.studio:'Sem lances',bidHistory(position,item.name)];}); }
function assets() { const position=state.assetFilter; const mode=state.assetMode; const available=mode==='available'; const rows=available?availableRows(position):assetRows(position,item=>!isAvailable(position,item)); const headers=available?['',labels[position],...(position==='Filme'?['Estreia EUA']:[]),'Maior lance','Líder','Histórico de lances']:position==='Filme'?['Filmes','Estreia EUA','Estúdio','FPTS','Nota Letterboxd','Bilheteria','Crítica','Premiações']:position==='Distribuidora'?['Distribuidoras','Estúdio','FPTS','Filme 1','Filme 2','Filme 3']:[labels[position],'Estúdio','FPTS','Filmes elegíveis','Nota Letterboxd','Bilheteria','Crítica','Premiações']; const tableClass=available?'asset-table available-table':`asset-table ${position==='Filme'?'film-asset-table':''}`; return `${header('Ativos', '')}${state.waiverError&&!state.bidDraft?`<p class="config-error">${state.waiverError}</p>`:''}<div class="tabs asset-mode-tabs"><button class="tab ${available?'active':''}" data-asset-mode="available">Disponíveis</button><button class="tab ${!available?'active':''}" data-asset-mode="leaders">Líderes</button></div><div class="tabs asset-tabs">${Object.keys(labels).map(key=>`<button class="tab ${posClass(key)} ${position===key?'active':''}" data-asset-filter="${key}">${labels[key]}</button>`).join('')}</div><div class="search-wrap asset-search"><label for="asset-table-search">Buscar ${labels[position].toLowerCase()}</label><input id="asset-table-search" type="search" value="${state.assetSearch}" placeholder="Digite um nome" /></div>${available?`<p class="waiver-help">${waiverAvailabilityExplanation}</p>`:''}${table(headers,rows,tableClass,true,available?1:0)}${bidModal()}`; }
function configValue(parameter) { return state.data.scoring.find(item=>item.parameter===parameter)?.value || '—'; }
function scoring() { const publicMult=configValue('Multiplicador Letterboxd'), publicRef=configValue('Referência Letterboxd'), boxMult=configValue('Multiplicador global'); return `${header('Pontuação', '')}<section class="category-formula-grid"><article class="card category-formula pos-filme"><span>Filmes</span><strong>Público + Bilheteria + Crítica + Prêmios</strong><p>Bilheteria integral e peso maior para Melhor Filme.</p></article><article class="card category-formula pos-ator"><span>Atores</span><strong>Média dos filmes + Prêmios individuais</strong><p>Bilheteria com 50%; atuações têm o maior peso em prêmios.</p></article><article class="card category-formula pos-diretor"><span>Diretores</span><strong>Média dos filmes + Prêmios de direção</strong><p>Bilheteria com 50%; Melhor Filme e Direção pesam mais.</p></article><article class="card category-formula pos-distribuidora"><span>Distribuidoras</span><strong>Média dos 3 melhores filmes</strong><p>Usa a pontuação total integral das três maiores obras.</p></article></section><h2 class="section-title formula-section-title">Bases de pontuação</h2><section class="formula-grid"><article class="card formula"><span>Público</span><strong>${publicMult} × (nota Letterboxd − ${publicRef})</strong></article><article class="card formula"><span>Bilheteria</span><strong>${boxMult} × 2<sup>log10(global ÷ US$ 2 bi)</sup></strong></article><article class="card formula"><span>Crítica</span><strong>Metascore − 50,0</strong></article><article class="card formula"><span>Premiações</span><strong>Tabela de Prêmios</strong></article></section><section class="grid scoring-grid"><div><h2 class="section-title">Tabela de Prêmios</h2>${table(['Premiação','Categoria','Resultado','Filmes e distribuidoras','Atores','Diretores'],state.data.awardScoring.map(item=>[item.award,item.category,item.result,item.film,item.actor,item.director]))}</div></section>`; }
function studioConfiguration() { return `<section class="configuration-section"><h2 class="section-title">Configuração</h2><div class="card studio-configuration"><div class="card-head"><div><h2>Estúdios</h2><span class="count">Os nomes preservam draft, FAAB, trocas e histórico.</span></div></div><div class="studio-config-grid">${state.data.teams.map((team,index)=>`<label>Estúdio ${index+1}<input class="studio-name-input" value="${team}" /></label>`).join('')}</div>${state.configError?`<p class="config-error">${state.configError}</p>`:''}<div class="actions studio-config-actions"><button class="button primary" data-save-studios>Salvar nomes</button></div></div></section>`; }
function league() { return `${header('Regras', '')}<section class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><article class="card rules"><h2>Draft</h2><p><b>8 estúdios, snake, 10 rodadas.</b> Cada estúdio termina com 5 filmes, 2 atores, 2 diretores e 1 distribuidora. Filmes, pessoas e distribuidoras podem ser ativos separados, mas cada ativo só pode pertencer a um estúdio.</p></article><article class="card rules"><h2>Pontuação</h2><p><b>Dados vêm da planilha.</b> O site exibe a pontuação vigente do snapshot: público, bilheteria, crítica e prêmios. Diretores usam bilheteria com peso de 50%; distribuidoras usam a média dos três melhores filmes.</p></article><article class="card rules"><h2>O que este protótipo valida</h2><p>O fluxo de escolha, a escassez por posição, a serpentina, a montagem dos estúdios, as trocas com decisão do Comissário e a leitura de pontuação. Não há login ou waiver neste teste.</p></article><article class="card rules"><h2>Próxima conexão</h2><p>A versão da liga poderá trocar este snapshot por uma API da planilha Google. O formato do dado já está separado do layout, para não precisar redesenhar a sala de draft.</p></article></section>${studioConfiguration()}`; }
function render() {
  if (!state.data) { root.innerHTML='<main class="content"><p class="empty">Carregando a base da liga…</p></main>'; return; }
  const view = {draft,myteam:myTeam,transactions,rosters:rostersView,assets,scoring,league}[state.view] || league;
  root.innerHTML = `<div class="shell">${nav()}<main class="content">${view()}</main></div>`;
  root.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view;render();});
  root.querySelector('#controller')?.addEventListener('change', event=>{state.controller=event.target.value;state.viewedTeam=event.target.value;render();});
  root.querySelector('#my-team-select')?.addEventListener('change', event=>{state.controller=event.target.value;state.viewedTeam=event.target.value;render();});
  root.querySelector('#sidebar-controller')?.addEventListener('change', event=>{state.controller=event.target.value;state.viewedTeam=event.target.value;render();});
  root.querySelectorAll('[data-start-trade]').forEach(button=>button.onclick=()=>startTrade(button.dataset.startTrade ? state.picks.find(pick=>pick.number===Number(button.dataset.startTrade)) : null));
  root.querySelector('[data-cancel-trade]')?.addEventListener('click',cancelTradeBuilder);
  root.querySelectorAll('[data-toggle-trade-team]').forEach(button=>button.onclick=()=>toggleTradeTeam(button.dataset.toggleTradeTeam));
  root.querySelectorAll('[data-toggle-trade-asset]').forEach(button=>button.onclick=()=>toggleTradeAsset(Number(button.dataset.toggleTradeAsset)));
  root.querySelectorAll('[data-trade-destination]').forEach(select=>select.onchange=()=>setTradeDestination(Number(select.dataset.tradeDestination),select.value));
  root.querySelector('[data-submit-trade]')?.addEventListener('click',createTrade);
  root.querySelectorAll('[data-answer-trade]').forEach(button=>button.onclick=()=>answerTrade(button.dataset.answerTrade,button.dataset.answer==='accept'));
  root.querySelectorAll('[data-counter-trade]').forEach(button=>button.onclick=()=>counterTrade(button.dataset.counterTrade));
  root.querySelectorAll('[data-resolve-trade]').forEach(button=>button.onclick=()=>resolveTrade(button.dataset.resolveTrade,button.dataset.resolution==='approve'));
  root.querySelector('#viewed-team')?.addEventListener('change', event=>{state.viewedTeam=event.target.value;render();});
  root.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.filter;render();});
  root.querySelectorAll('[data-asset-filter]').forEach(button=>button.onclick=()=>{state.assetFilter=button.dataset.assetFilter;render();});
  root.querySelectorAll('[data-asset-mode]').forEach(button=>button.onclick=()=>{state.assetMode=button.dataset.assetMode;state.assetSearch='';render();});
  root.querySelector('#asset-search')?.addEventListener('input', event=>{state.search=event.target.value;applyDraftSearch(state.search);});
  root.querySelector('#asset-table-search')?.addEventListener('input', event=>{state.assetSearch=event.target.value;applyAssetSearch(state.assetSearch);});
  root.querySelectorAll('[data-sort-column]').forEach(button=>button.onclick=()=>sortAssetColumn(button));
  root.querySelectorAll('[data-start-bid-asset]').forEach(button=>button.onclick=()=>startBid(button.dataset.startBidPosition,button.dataset.startBidAsset));
  root.querySelector('[data-cancel-bid]')?.addEventListener('click',cancelBid);
  root.querySelector('[data-confirm-bid]')?.addEventListener('click',()=>submitBid(root.querySelector('#bid-amount')?.value,root.querySelector('#bid-drop')?.value));
  root.querySelectorAll('[data-waiver-move]').forEach(button=>button.onclick=()=>moveWaiverPriority(button.dataset.waiverMove,button.dataset.waiverDirection));
  root.querySelector('[data-save-studios]')?.addEventListener('click',()=>saveStudioConfiguration([...root.querySelectorAll('.studio-name-input')].map(input=>input.value)));
  root.querySelector('[data-publish-local-draft]')?.addEventListener('click',publishLocalDraft);
  root.querySelector('[data-action="simulate"]')?.addEventListener('click',simulateUntilEnd);
  root.querySelector('[data-action="reset"]')?.addEventListener('click',()=>clearSharedDraft(true));
  root.querySelector('[data-action="clear"]')?.addEventListener('click',()=>clearSharedDraft(false));
  root.querySelectorAll('[data-pick]').forEach(button=>button.onclick=()=>{const item=state.data.pools[state.filter].find(entry=>entry.name===button.dataset.pick); if (item) submitDraftPick(item);});
  if (state.view==='draft') applyDraftSearch(state.search);
  if (state.view==='assets') applyAssetSearch(state.assetSearch);
}
