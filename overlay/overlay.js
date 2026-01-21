const card = document.getElementById('card');
const topicWrapEl = document.getElementById('topicWrap');
const topicTextEl = document.getElementById('topicText');
const srcEl = document.getElementById('src');
const tEl = document.getElementById('t');
const sessEl = document.getElementById('sess');
const turnEl = document.getElementById('turn');
const dotEl = document.getElementById('dot');
const DEFAULT_TOPIC_TEMP = __TOPIC_BRAIN_TEMP__;
let lastUpdatedAt = 0;

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function calcAccent(temp){
  const min = 0.55, max = 1.00;
  const x = (clamp(temp, min, max) - min) / (max - min);
  const hue = 190 - x * 110;
  return 'hsl(' + hue + ' 82% 62%)';
}

function kickChangeAnim(){
  topicWrapEl.classList.remove('is-change');
  topicTextEl.classList.remove('is-change');
  void topicWrapEl.offsetWidth;
  topicWrapEl.classList.add('is-change');
  topicTextEl.classList.add('is-change');
  setTimeout(() => {
    topicWrapEl.classList.remove('is-change');
    topicTextEl.classList.remove('is-change');
  }, 650);
}

function fitTopicFont() {
  const wrap = topicWrapEl;
  const el = topicTextEl;
  el.style.fontSize = '';
  let tries = 0;
  while (tries < 6) {
    const isOverflowing = el.scrollHeight > wrap.clientHeight + 4;
    if (!isOverflowing) break;

    const cs = getComputedStyle(el);
    const cur = parseFloat(cs.fontSize);
    el.style.fontSize = Math.max(22, cur - 2) + 'px';
    tries++;
  }
}

async function poll(){
  try{
    const r = await fetch('/topic', { cache: 'no-store' });
    const s = await r.json();

    const accent = calcAccent(s.topicTemp ?? DEFAULT_TOPIC_TEMP);
    dotEl.style.background = accent;
    dotEl.style.boxShadow = '0 0 18px ' + accent + '77';
    card.style.borderColor = accent + '33';

    topicTextEl.textContent = s.topic || '---';
    fitTopicFont();

    srcEl.textContent = s.source || '---';
    tEl.textContent = Number(s.topicTemp ?? 0).toFixed(2);
    sessEl.textContent = String(s.sessionNo ?? 0);
    turnEl.textContent = String(s.turn ?? 0);

    if(s.updatedAt && s.updatedAt !== lastUpdatedAt){
      lastUpdatedAt = s.updatedAt;
      card.classList.remove('flash');
      void card.offsetWidth;
      card.classList.add('flash');
      kickChangeAnim();
    }

  }catch(e){}
  setTimeout(poll, 500);
}

poll();
