let startTime;
let timeoutId;
let elapsedTime = 0;
let isStart = true;
// getTimezoneOffset()で取得できる値は分単位なのでミリ秒単位にする
const gmt = new Date().getTimezoneOffset() * 60000;
const hourText = document.getElementById('hour');
const minutesText = document.getElementById('minutes');
const secondsText = document.getElementById('seconds');
const millisecondsText = document.getElementById('milliseconds');
const startOrStop = document.getElementById('startOrStop');
const reset = document.getElementById('reset');

initial();

// start or stop
// 押下したタイミングで発火したいのでclickではなくmousedownを使用
startOrStop.addEventListener('mousedown', () => {
    if (isStart) {
        startTime = Date.now() - gmt;
        startOrStop.textContent = 'stop';
        isStart = false;
        count();
    } else {
        clearTimeout(timeoutId);
        elapsedTime += Date.now() - gmt - startTime;
        startOrStop.textContent = 'start';
        isStart = true;
    }
});

// reset
reset.addEventListener('mousedown', () => {
    initial();
});

function initial() {
    hourText.textContent = '00';
    minutesText.textContent = '00';
    secondsText.textContent = '00';
    millisecondsText.textContent = '00';
    startOrStop.textContent = 'start';
    clearTimeout(timeoutId);
    elapsedTime = 0;
    isStart = true;
}

function count() {
    const date = new Date(Date.now() - startTime + elapsedTime);
    // 25時間以降を表示するため、取得した時間 + （日数 - 1日 * 24時間）をする
    hourText.textContent = String(date.getHours() + ((date.getDate() - 1) * 24)).padStart(2, '0');
    minutesText.textContent = String(date.getMinutes()).padStart(2, '0');
    secondsText.textContent = String(date.getSeconds()).padStart(2, '0');
    // 常に2桁表示にするため3桁にしてから末尾を消す
    millisecondsText.textContent = String(date.getMilliseconds()).padStart(3, '0').slice(0, -1);
    timeoutId = setTimeout(() => {
      count();
    }, 10);
}