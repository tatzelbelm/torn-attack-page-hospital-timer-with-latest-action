// ==UserScript==
// @name         Torn Attack Page Hospital Timer with Latest Action
// @namespace    tatzelbelm.torn.attack-page-hospital-timer-with-latest-action
// @version      1.5.0
// @description  On the attack page, replaces the "currently in hospital" notice with a live countdown, and shows the target's last action.
// @author       tatzelbelm
// @license      MIT
// @homepageURL  https://github.com/tatzelbelm/torn-attack-page-hospital-timer-with-latest-action
// @supportURL   https://github.com/tatzelbelm/torn-attack-page-hospital-timer-with-latest-action/issues
// @downloadURL  https://raw.githubusercontent.com/tatzelbelm/torn-attack-page-hospital-timer-with-latest-action/main/torn-attack-page-hospital-timer-with-latest-action.user.js
// @updateURL    https://raw.githubusercontent.com/tatzelbelm/torn-attack-page-hospital-timer-with-latest-action/main/torn-attack-page-hospital-timer-with-latest-action.user.js
// @match        https://www.torn.com/loader.php?sid=attack*
// @match        https://www.torn.com/page.php?sid=attack*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

/*
  Torn API Terms of Service disclosure
  -------------------------------------------------------------------------
  Data Storage:          None. Data is only held in the open tab's memory.
  Data Sharing:          Nobody. Requests go only to api.torn.com.
  Purpose of Use:        Show the target's hospital release countdown and
                         last action on the attack page (display only).
  Key Storage & Sharing: PC: you enter the key in the "Hosp Timer" settings
                         pill on the attack page; it is saved in
                         Tampermonkey's own storage on your device.
                         Torn PDA: the app supplies your key.
                         Either way it is only ever sent to api.torn.com.
  Key Access Level:      Public (uses the user -> profile selection only).
  -------------------------------------------------------------------------
  Torn scripting rules: this script makes no non-API requests on its own.
  It never reloads the page automatically; the "click to refresh" link
  only reloads when you click it.
*/

(function () {
  'use strict';

  // No need to edit anything in this script.
  // PC: enter your API key in the "Hosp Timer" pill at the bottom-left of any attack page.
  // Torn PDA: the app fills in your key automatically, so the pill doesn't appear.

  // Torn PDA swaps this placeholder for your key when it runs the script. Leave it exactly as is.
  const PDA_KEY = '###PDA-APIKEY###';

  // Only run once per page, even if the app injects the script twice
  if (window.__ahcLoaded) return;
  window.__ahcLoaded = true;

  const IS_PDA =
    typeof window.flutter_inappwebview !== 'undefined' ||
    typeof window.PDA_httpGet === 'function' ||
    !PDA_KEY.startsWith('#');

  const PDA_SUPPLIES_KEY = !PDA_KEY.startsWith('#');

  // Settings storage. Tampermonkey's own storage is used when available (Torn's page
  // can't read it); otherwise falls back to the browser's storage for torn.com.
  const HAS_GM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  function load(name, fallback) {
    try {
      if (HAS_GM) return GM_getValue(name, fallback);
      const v = localStorage.getItem('ahc_' + name);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function save(name, value) {
    try {
      if (HAS_GM) GM_setValue(name, value);
      else localStorage.setItem('ahc_' + name, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }

  let KEY = PDA_SUPPLIES_KEY ? PDA_KEY : load('apiKey', '');

  const POLL_MS = 30000;      // ask the API for fresh info every 30 seconds
  const GRACE_SECONDS = 8;    // after the timer ends, give Torn's own page update time to show "Start fight"

  const targetId = new URLSearchParams(location.search).get('user2ID');
  if (!targetId) return;

  let hospUntil = 0;      // unix seconds when target leaves hospital (0 = not in hospital)
  let lastActionTs = 0;   // unix seconds of target's last action
  let lastStatus = '';    // Online / Idle / Offline
  let apiError = '';
  let loaded = false;
  let outSince = 0;       // when we first noticed the timer was finished

  let hospEl = null;      // the page element that holds the hospital message
  let infoEl = null;      // our "Last action" line

  const nowSec = () => Math.floor(Date.now() / 1000);

  function fmtCountdown(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  function fmtAgo(s) {
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
    const d = Math.floor(s / 86400);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  // Torn PDA asks scripts to use its own request helper for api.torn.com
  async function getJson(url) {
    if (typeof window.PDA_httpGet === 'function') {
      const r = await window.PDA_httpGet(url);
      return JSON.parse(r.responseText);
    }
    const res = await fetch(url);
    return res.json();
  }

  async function fetchTarget() {
    if (document.hidden && loaded) return; // don't use API calls while tab is in background
    if (!KEY) {
      apiError = PDA_SUPPLIES_KEY
        ? 'No API key available'
        : 'No API key set - add one in the Hosp Timer pill (bottom-left)';
      render();
      return;
    }
    try {
      const d = await getJson(
        `https://api.torn.com/user/${targetId}?selections=profile&key=${KEY}&comment=AttackPageHospTimer`
      );
      if (d.error) {
        apiError = d.error.error || 'API error';
        if (d.error.code === 2 && !PDA_SUPPLIES_KEY) {
          apiError += ' - check the key in the Hosp Timer pill (bottom-left)';
          setPanelStatus('Torn says this key is incorrect', true);
          openPanel();
        }
        render();
        return;
      }
      apiError = '';
      loaded = true;
      if (justSaved) {
        justSaved = false;
        setPanelStatus('Key saved and working', false);
      }
      const inHosp = (d.status && d.status.state) === 'Hospital';
      hospUntil = inHosp ? (d.states?.hospital_timestamp || d.status?.until || 0) : 0;
      lastActionTs = d.last_action?.timestamp || 0;
      lastStatus = d.last_action?.status || '';
    } catch (e) {
      apiError = 'Could not reach Torn API';
    }
    render();
  }

  // Find the smallest element whose text is Torn's "in hospital ... cannot be attacked" notice
  function findHospitalElement() {
    const re = /in\s+hospital[\s\S]*cannot\s+be\s+attacked/i;
    let best = null;
    for (const el of document.querySelectorAll('div, span, p')) {
      if (re.test(el.textContent) && (!best || best.contains(el))) best = el;
    }
    return best;
  }

  function hospitalHtml() {
    if (!loaded) return null;
    const left = hospUntil - nowSec();
    if (hospUntil && left > 0) {
      outSince = 0;
      return `IN HOSPITAL<br>OUT IN ${fmtCountdown(left)}`;
    }
    if (!outSince) outSince = nowSec();
    if (nowSec() - outSince < GRACE_SECONDS) {
      return `IN HOSPITAL<br>OUT NOW...`;
    }
    // Torn's page still hasn't updated by itself, so offer a manual refresh
    return `OUT OF HOSPITAL<br><span data-ahc-refresh="1" style="cursor:pointer;text-decoration:underline">CLICK TO REFRESH</span>`;
  }

  function renderHospital() {
    const html = hospitalHtml();
    if (html === null) return;

    // Torn's page re-renders the notice every few seconds. If it has put its
    // own text back (or made a brand-new element), find it again.
    if (!hospEl || !hospEl.isConnected || !hospEl.dataset.ahc) {
      const found = findHospitalElement();
      if (!found) { hospEl = null; return; } // notice gone, e.g. "Start fight" is showing
      hospEl = found;
      hospEl.dataset.ahc = '1';
    }
    if (hospEl.innerHTML !== html) hospEl.innerHTML = html;
  }

  // Find the FairFight line added by another script (FF Scouter), if it's there
  function findFairFightLine() {
    let best = null;
    for (const el of document.querySelectorAll('div, p')) {
      const t = el.textContent;
      if (/FairFight/i.test(t) && /Est\.?\s*Stats/i.test(t) && (!best || best.contains(el))) best = el;
    }
    return best;
  }

  let inFairFightLine = false;

  function placeInfoEl() {
    const ff = findFairFightLine();
    if (ff) {
      if (IS_PDA) {
        // Phone screens: put it on its own line directly below FairFight
        if (inFairFightLine && ff.nextElementSibling === infoEl) return; // already in place
        infoEl.style.cssText = 'display:block;font-size:13px;margin-top:2px;';
        ff.after(infoEl);
        inFairFightLine = true;
        return;
      }
      if (inFairFightLine && infoEl.parentElement === ff) return; // already in place
      if (getComputedStyle(ff).display.includes('flex')) {
        infoEl.style.cssText = 'margin-left:auto;font-size:13px;';
        ff.appendChild(infoEl);
      } else {
        infoEl.style.cssText = 'float:right;font-size:13px;';
        ff.prepend(infoEl);
      }
      inFairFightLine = true;
      return;
    }
    if (infoEl.isConnected && !inFairFightLine) return; // already placed on its own line
    inFairFightLine = false;
    infoEl.style.cssText =
      'display:flex;justify-content:flex-end;gap:6px;font-size:13px;padding:4px 8px;';
    const top = document.querySelector('[class*="topSection___"]');
    if (top) {
      top.after(infoEl);
    } else {
      // Fallback if Torn changes the layout: small box in the bottom-left corner
      infoEl.style.cssText +=
        'position:fixed;right:10px;bottom:10px;z-index:99999;background:#222;color:#ddd;border-radius:4px;';
      document.body.appendChild(infoEl);
    }
  }

  function renderLastAction() {
    if (!infoEl) infoEl = document.createElement('span');
    if (!infoEl.isConnected) inFairFightLine = false;
    placeInfoEl();

    let text;
    if (apiError) {
      text = `<span style="color:#e55">Hospital timer: ${apiError}</span>`;
    } else if (!loaded) {
      text = 'Last action: loading...';
    } else {
      const colour = lastStatus === 'Online' ? '#5c5' : lastStatus === 'Idle' ? '#e8b730' : '#e55';
      text = `Last action: <b>${fmtAgo(Math.max(0, nowSec() - lastActionTs))}</b>` +
             ` <span style="color:${colour}">(${lastStatus})</span>`;
    }
    if (infoEl.innerHTML !== text) infoEl.innerHTML = text;
  }

  // ---- Settings pill (bottom-left, PC only) ----
  let panelBody = null, panelStatus = null, panelInput = null, panelDot = null;
  let justSaved = false;

  function setPanelStatus(msg, bad) {
    if (!panelStatus) return;
    panelStatus.textContent = msg;
    panelStatus.style.color = bad ? '#e55' : '#5c5';
  }
  function updateDot() {
    if (panelDot) panelDot.style.background = KEY ? '#5c5' : '#e55';
  }
  function openPanel() {
    if (!panelBody) return;
    panelBody.style.display = 'block';
    save('panelOpen', true);
  }
  function closePanel() {
    if (!panelBody) return;
    panelBody.style.display = 'none';
    save('panelOpen', false);
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #ahc-settings { position:fixed; left:10px; bottom:10px; z-index:99999;
        font:12px Arial, sans-serif; color:#ddd; }
      #ahc-settings .ahc-pill { display:inline-flex; align-items:center; gap:6px; cursor:pointer;
        background:#333; border:1px solid #555; border-radius:14px; padding:4px 10px;
        box-shadow:0 1px 4px rgba(0,0,0,.5); user-select:none; }
      #ahc-settings .ahc-pill:hover { background:#3d3d3d; }
      #ahc-settings .ahc-dot { width:8px; height:8px; border-radius:50%; background:#e55; }
      #ahc-settings .ahc-body { display:none; width:240px; margin-bottom:6px; background:#2a2a2a;
        border:1px solid #555; border-radius:6px; padding:10px; box-shadow:0 2px 8px rgba(0,0,0,.6); }
      #ahc-settings .ahc-head { display:flex; justify-content:space-between; align-items:center;
        margin-bottom:8px; font-size:13px; }
      #ahc-settings .ahc-min { cursor:pointer; font-size:16px; line-height:12px; padding:0 4px; }
      #ahc-settings .ahc-min:hover { color:#fff; }
      #ahc-settings label { display:block; margin-bottom:4px; color:#bbb; }
      #ahc-settings .ahc-row { display:flex; gap:6px; margin-bottom:6px; }
      #ahc-settings input { flex:1; min-width:0; background:#1b1b1b; color:#eee; border:1px solid #555;
        border-radius:3px; padding:4px 6px; font:12px monospace; }
      #ahc-settings button { background:#444; color:#eee; border:1px solid #666; border-radius:3px;
        padding:3px 10px; cursor:pointer; font:12px Arial, sans-serif; }
      #ahc-settings button:hover { background:#555; }
      #ahc-settings .ahc-status { min-height:14px; margin-bottom:4px; }
      #ahc-settings .ahc-note { color:#888; font-size:11px; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'ahc-settings';
    panel.innerHTML = `
      <div class="ahc-body">
        <div class="ahc-head"><b>Hosp Timer settings</b><span class="ahc-min" title="Minimise">&ndash;</span></div>
        <label for="ahc-key">Torn API key (Public access is enough)</label>
        <div class="ahc-row">
          <input id="ahc-key" type="password" maxlength="16" placeholder="16-character key" autocomplete="off" spellcheck="false">
          <button class="ahc-show" type="button">Show</button>
        </div>
        <div class="ahc-row">
          <button class="ahc-save" type="button">Save</button>
          <button class="ahc-clear" type="button">Clear</button>
        </div>
        <div class="ahc-status"></div>
        <div class="ahc-note">Saved only on this device. Only ever sent to api.torn.com.</div>
      </div>
      <div class="ahc-pill" title="Hospital timer settings"><span class="ahc-dot"></span>Hosp Timer</div>
    `;
    document.body.appendChild(panel);

    panelBody = panel.querySelector('.ahc-body');
    panelStatus = panel.querySelector('.ahc-status');
    panelInput = panel.querySelector('#ahc-key');
    panelDot = panel.querySelector('.ahc-dot');
    panelInput.value = KEY;
    updateDot();

    panel.querySelector('.ahc-pill').addEventListener('click', () => {
      panelBody.style.display === 'block' ? closePanel() : openPanel();
    });
    panel.querySelector('.ahc-min').addEventListener('click', closePanel);

    panel.querySelector('.ahc-show').addEventListener('click', (e) => {
      const hidden = panelInput.type === 'password';
      panelInput.type = hidden ? 'text' : 'password';
      e.target.textContent = hidden ? 'Hide' : 'Show';
    });

    function saveKey() {
      const k = panelInput.value.trim();
      if (!/^[A-Za-z0-9]{16}$/.test(k)) {
        setPanelStatus('A Torn API key is 16 letters and numbers', true);
        return;
      }
      save('apiKey', k);
      KEY = k;
      updateDot();
      setPanelStatus('Saved - checking key...', false);
      justSaved = true;
      apiError = '';
      loaded = false;
      fetchTarget();
    }
    panel.querySelector('.ahc-save').addEventListener('click', saveKey);

    panel.querySelector('.ahc-clear').addEventListener('click', () => {
      save('apiKey', '');
      KEY = '';
      panelInput.value = '';
      updateDot();
      setPanelStatus('Key cleared', false);
      loaded = false;
      fetchTarget();
    });

    // Stop Torn's keyboard shortcuts firing while typing in the box; Enter saves
    panelInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') saveKey();
    });

    // Open automatically if there's no key yet, otherwise remember open/closed
    if (!KEY || load('panelOpen', false)) openPanel();
    if (!KEY) setPanelStatus('Enter your API key to start', true);
  }

  // ---- Rendering, guarded so our own changes don't re-trigger the observer ----
  let busy = false;
  const observer = new MutationObserver(() => {
    if (busy) return;
    render();
  });

  function render() {
    busy = true;
    try {
      renderHospital();
      renderLastAction();
    } finally {
      observer.takeRecords(); // throw away the changes we just made ourselves
      busy = false;
    }
  }

  function start() {
    // PC: settings pill for the API key (Torn PDA supplies the key itself)
    if (!PDA_SUPPLIES_KEY) {
      buildPanel();
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Open Hosp Timer settings', openPanel);
      }
    }

    // Runs right after Torn changes the page and before the screen repaints,
    // so Torn's original text never gets a chance to show.
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Manual refresh link (only fires when you click/tap it)
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-ahc-refresh]')) location.reload();
    });

    fetchTarget();
    setInterval(render, 1000);          // tick the countdown every second
    setInterval(fetchTarget, POLL_MS);  // refresh API data
  }

  // Torn PDA may run scripts before the page has finished loading
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
