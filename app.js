const STORAGE_KEY = 'hst-data-v3';
const LIMIT = 600; // set goal here

const defaultItems = [
  { id: 'gradeA', name: 'חמישית', points: 0 },
  { id: 'gradeB', name: 'שישית', points: 0 },
  { id: 'gradeC', name: 'שביעית', points: 0 },
  { id: 'gradeD', name: 'שמינית', points: 0 },
  { id: 'school', name: 'בסך הכל', points: 0 }
];

let state = loadState();

// in-memory recent change history (not persisted) to detect bursts
const CHANGE_WINDOW_MS = 10000; // window to consider rapid gains
const CHANGE_THRESHOLD = 10; // points within window to trigger encouragement
const changeHistory = {};

function ensureHistory(){
  for(const it of state.items) if(!changeHistory[it.id]) changeHistory[it.id]=[];
}
ensureHistory();

const barsEl = document.getElementById('bars');
const limitLabel = document.getElementById('limitLabel');
const resetBtn = document.getElementById('resetBtn');
const popup = document.getElementById('popup');
const popupContent = document.getElementById('popupContent');
const popupClose = document.getElementById('popupClose');
const saveInfo = document.getElementById('saveInfo');

limitLabel.textContent = LIMIT;

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return {items: defaultItems.map(i=>({...i})), updated: Date.now()};
    const parsed = JSON.parse(raw);
    // migrate / ensure fields
    if(!parsed.items) parsed.items = defaultItems.map(i=>({...i}));
    return parsed;
  }catch(e){
    console.warn('load error', e);
    return {items: defaultItems.map(i=>({...i})), updated: Date.now()};
  }
}

function saveState(){
  try{
    state.updated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateSaveInfo();
  }catch(e){console.warn('save error', e)}
}

function timeAgo(ts){
  if(!ts) return 'מעולם לא נשמר';
  const s = Math.max(0, Math.floor((Date.now() - ts)/1000));
  if(s < 60) return `${s} שניות`;
  const m = Math.floor(s/60);
  if(m < 60) return `${m} דקות`;
  const h = Math.floor(m/60);
  if(h < 24) return `${h} שעות`;
  const d = Math.floor(h/24);
  return `${d} ימים`;
}

function updateSaveInfo(){
  if(!saveInfo) return;
  if(!state.updated){ saveInfo.textContent = 'לא נשמר עדיין'; return; }
  saveInfo.textContent = `נשמר לפני ${timeAgo(state.updated)}`;
}

function render(opts = {animate: true}){
  const animate = !!opts.animate;
  barsEl.innerHTML = '';
  for(const item of state.items){
    const pct = (item.points / LIMIT) * 100;
    const reached = pct >= 100;
    const displayPct = reached ? 100 : pct;

    const card = document.createElement('div');
    card.className = 'bar-card';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const h3 = document.createElement('h3');
    h3.textContent = item.name;
    const small = document.createElement('p');
    small.textContent = `נקודות: ${item.points}`;
    meta.appendChild(h3);
    meta.appendChild(small);

    const controls = document.createElement('div');
    controls.className = 'controls';
    const add = document.createElement('button');
    add.className = 'btn';
    add.textContent = '+1';
    add.title = 'הוספת נקודה';
    const sub = document.createElement('button');
    sub.className = 'btn secondary';
    sub.textContent = '−1';
    sub.title = 'הסר נקודה';
    controls.appendChild(sub);
    controls.appendChild(add);

    const pointsEl = document.createElement('div');
    pointsEl.className = 'points';
    pointsEl.innerHTML = `<small>נקודות</small><div>${item.points}</div>`;

    const barWrap = document.createElement('div');
    barWrap.className = 'bar-wrap';
    const barInner = document.createElement('div');
    barInner.className = 'bar-inner' + (animate ? ' animate' : '');
    // if animating, start at 0 and animate to displayPct; otherwise set directly
    if(animate){
      barInner.style.width = '0%';
    } else {
      barInner.style.width = displayPct + '%';
    }
    if(reached) barInner.classList.add('over');
    barWrap.appendChild(barInner);

    const perc = document.createElement('div');
    perc.className = 'perc';
    perc.textContent = `${Math.round(pct)}%`;

    // assemble
    card.appendChild(meta);
    card.appendChild(pointsEl);
    card.appendChild(barWrap);
    card.appendChild(perc);
    card.appendChild(controls);

    // make the whole-school card larger / more prominent
    if(item.id === 'school'){
      card.classList.add('school-card');
    }

    // attach handlers
    add.addEventListener('click', ()=>{
      const prevRanks = getRanks();
      item.points += 1;
      recordChange(item.id, 1);
      syncSchoolIfNeeded(item);
      saveState();
      detectEvents(item, prevRanks, 1);
      render({animate:false});
    });
    sub.addEventListener('click', ()=>{
      const prevRanks = getRanks();
      item.points = Math.max(0, item.points - 1);
      recordChange(item.id, -1);
      syncSchoolIfNeeded(item);
      saveState();
      detectEvents(item, prevRanks, -1);
      render({animate:false});
    });

    barsEl.appendChild(card);

    // trigger width animation on next frame when requested
    if(animate){
      requestAnimationFrame(()=>{
        // small timeout helps with repeated renders
        setTimeout(()=>{ barInner.style.width = displayPct + '%'; }, 30);
      });
    }
  }
}

// If the teacher increments a grade, you might want the 'school' total to move too.
// We'll keep 'school' as independent but if user updates a grade we can auto-sync school to sum of grades.
function syncSchoolIfNeeded(changedItem){
  // simple policy: keep school equal to sum of grades (not including 'school' itself) so whole-school reflects sum
  const school = state.items.find(i=>i.id === 'school');
  if(!school) return;
  // if the changed item is the school itself, do not overwrite manual edits
  if(changedItem && changedItem.id === 'school') return;
  const gradeSum = state.items.filter(i=>i.id!=='school').reduce((s,i)=>s+i.points,0);
  school.points = gradeSum;
}

// --- Encouragement helpers ---
const encourageEl = document.getElementById('encouragement');
let encourageTimer = null;
function showEncouragement(text){
  if(!encourageEl) return;
  encourageEl.textContent = text;
  clearTimeout(encourageTimer);
  encourageTimer = setTimeout(()=>{ encourageEl.textContent = ''; }, 6000);
}

function recordChange(id, delta){
  if(!changeHistory[id]) changeHistory[id]=[];
  const now = Date.now();
  changeHistory[id].push({t: now, d: delta});
  // prune
  changeHistory[id] = changeHistory[id].filter(x => (now - x.t) <= CHANGE_WINDOW_MS);
}

function sumRecent(id){
  const now = Date.now();
  if(!changeHistory[id]) return 0;
  return changeHistory[id].filter(x=> (now - x.t) <= CHANGE_WINDOW_MS).reduce((s,x)=>s + (x.d>0?x.d:0), 0);
}

function getRanks(){
  const sorted = [...state.items].sort((a,b)=>b.points - a.points);
  const ranks = {};
  sorted.forEach((it, idx)=> ranks[it.id] = idx+1);
  return ranks;
}

function detectEvents(changedItem, prevRanks, delta){
  // detect passing: which items did changedItem pass?
  const newRanks = getRanks();
  const passed = [];
  for(const it of state.items){
    if(it.id === changedItem.id) continue;
    // if previously other was ahead but now behind
    if((prevRanks[it.id] || 999) < (prevRanks[changedItem.id] || 999) && (newRanks[it.id] || 999) > (newRanks[changedItem.id] || 999)){
      passed.push(it.name);
    }
  }
  if(passed.length){
    showEncouragement(`ה${changedItem.name} עקפה את ה${passed.join(', ')} — כל הכבוד!`);
    return;
  }

  // detect rapid gain
  if(delta > 0){
    const recent = sumRecent(changedItem.id);
    if(recent >= CHANGE_THRESHOLD){
      showEncouragement(`${changedItem.name} עלתה ב-${recent} נקודות בזמן קצר — יפה מאוד!`);
      return;
    }
  }
}

// Popup logic
let popupTimer = null;
function showPopup(){
  // build content: leading grades & how close to finish
  const sorted = [...state.items].sort((a,b)=>b.points - a.points);
  const leaders = sorted.slice(0,3);
  let html = '<ul>' + leaders.map(l=>`<li><strong>${l.name}</strong> — ${l.points} נקודות (${Math.round((l.points/LIMIT)*100)}%)</li>`).join('') + '</ul>';
  const school = state.items.find(i=>i.id==='school');
  const remaining = Math.max(0, LIMIT - (school?school.points:0));
  html += `<p>הישיבה צריכה עוד <strong>${remaining}</strong> נקודות כדי להגיע ליעד (${school?Math.round((school.points/LIMIT)*100):0}%).</p>`;
  popupContent.innerHTML = html;
  popup.classList.remove('hidden');

  // highlight leading bars
  const leadingIds = leaders.map(l=>l.id);
  highlightLeading(leadingIds);

  // auto-close after 10s
  clearTimeout(popupTimer);
  popupTimer = setTimeout(()=>{ closePopup(); }, 10_000);
}

function closePopup(){
  popup.classList.add('hidden');
  clearLeadingHighlights();
}

function highlightLeading(ids){
  // add class to bar-inner of matching items
  const cards = document.querySelectorAll('.bar-card');
  for(const card of cards){
    const name = card.querySelector('.meta h3').textContent;
    const match = state.items.find(i=>i.name === name);
    if(!match) continue;
    const inner = card.querySelector('.bar-inner');
    if(ids.includes(match.id)) inner.classList.add('leading');
  }
}
function clearLeadingHighlights(){
  document.querySelectorAll('.bar-inner.leading').forEach(el=>el.classList.remove('leading'));
}

popupClose.addEventListener('click', closePopup);

resetBtn.addEventListener('click', ()=>{
  if(!confirm('לאפס את כל הנקודות ל-0?')) return;
  state.items.forEach(i=>i.points=0);
  saveState(); render();
});

// auto-save every 3 seconds as extra safety
setInterval(()=>saveState(), 3000);

setInterval(function() {
  location.reload();
}, 60000);


// initial render
syncSchoolIfNeeded();
render({animate:true});
saveState();

// update save-info periodically
updateSaveInfo();
setInterval(updateSaveInfo, 5000);

// expose for debug in console
// DVD-style bouncing photo (photo.png)
;(function(){
  const IMG_SRC = 'photo.png';
  const SIZE = 64; // px
  const OPACITY = 0.6;
  const SPEED = 160; // pixels per second

  let dvdEl = null;
  let x = 50, y = 50;
  let vx = 1, vy = 1;
  let lastT = null;
  let running = false;

  function createDvd(){
    if(dvdEl) return dvdEl;
    dvdEl = document.createElement('img');
    dvdEl.className = 'dvd-bounce';
    dvdEl.src = IMG_SRC;
    dvdEl.alt = 'photo';
    dvdEl.style.width = SIZE + 'px';
    dvdEl.style.opacity = OPACITY;
    document.body.appendChild(dvdEl);
    // initial position random-ish
    const w = window.innerWidth - SIZE;
    const h = window.innerHeight - SIZE;
    x = Math.max(8, Math.floor(Math.random() * Math.max(1, w)));
    y = Math.max(8, Math.floor(Math.random() * Math.max(1, h)));
    // randomize direction
    vx = Math.random() < 0.5 ? -1 : 1;
    vy = Math.random() < 0.5 ? -1 : 1;
    return dvdEl;
  }

  function step(t){
    if(!running) return;
    if(lastT == null) lastT = t;
    const dt = (t - lastT) / 1000; // seconds
    lastT = t;
    const dx = vx * SPEED * dt;
    const dy = vy * SPEED * dt;
    x += dx; y += dy;
    // bounds
    const maxX = window.innerWidth - SIZE;
    const maxY = window.innerHeight - SIZE;
    if(x <= 0){ x = 0; vx = Math.abs(vx); }
    if(x >= maxX){ x = maxX; vx = -Math.abs(vx); }
    if(y <= 0){ y = 0; vy = Math.abs(vy); }
    if(y >= maxY){ y = maxY; vy = -Math.abs(vy); }
    if(dvdEl){
      // position via left/top so bounds are exact for fixed elements
      dvdEl.style.left = Math.round(x) + 'px';
      dvdEl.style.top = Math.round(y) + 'px';
    }
    requestAnimationFrame(step);
  }

  function startDvd(){
    if(running) return;
    createDvd();
    running = true;
    lastT = null;
    requestAnimationFrame(step);
  }

  function stopDvd(){
    running = false;
    lastT = null;
    if(dvdEl && dvdEl.parentNode) dvdEl.parentNode.removeChild(dvdEl);
    dvdEl = null;
  }

  // handle resize so the element stays in-bounds
  window.addEventListener('resize', ()=>{
    if(!dvdEl) return;
    const maxX = window.innerWidth - SIZE;
    const maxY = window.innerHeight - SIZE;
    x = Math.min(x, maxX);
    y = Math.min(y, maxY);
  });


  function toggleEmbed() {

    const frame = document.getElementById("embedFrame")
    const main = document.getElementById("mainContent")

    frame.src = "https://causematch.com/giborei-sajaiea"

    frame.style.display = "block"; 
    main.style.display = "none";

    setTimeout(() => {
        frame.style.display = "none";
        main.style.display = "block";
    }, 10000);
    
  }
  setInterval(toggleEmbed, 10000);
  // start automatically
  startDvd();

  // expose control
  window.hst = Object.assign(window.hst || {}, { state, saveState, loadState, render, showPopup, closePopup, dvd: { start: startDvd, stop: stopDvd } });
})();





