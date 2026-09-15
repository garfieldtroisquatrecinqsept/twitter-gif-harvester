(function () {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;

  const BUTTON_CLASS = 'tgh-button';
  const buttonsByUrl = new Map();
  let lastContextUrl = null;
  let scheduled = false;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_PATHS = [
    'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v7.2a5.5 5.5 0 0 0-2-1.06V6H6v8h4.06a5.5 5.5 0 0 0 .38 2H5.5A1.5 1.5 0 0 1 4 14.5v-9Z',
    'M16.5 13a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm.75 2.25h-1.5v2.69l-.97-.97-1.06 1.06 2.78 2.78 2.78-2.78-1.06-1.06-.97.97v-2.69Z'
  ];

  function buildIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const definition of ICON_PATHS) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', definition);
      svg.appendChild(path);
    }
    return svg;
  }

  function gifSourceFor(video) {
    const direct = video.currentSrc || video.src || '';
    if (direct.indexOf('/tweet_video/') !== -1) return direct.split('?')[0];
    const poster = video.poster || '';
    const match = /tweet_video_thumb\/([A-Za-z0-9_-]+)\./.exec(poster);
    if (match) return 'https://video.twimg.com/tweet_video/' + match[1] + '.mp4';
    return null;
  }

  function containerFor(video) {
    return (
      video.closest('[data-testid="videoPlayer"]') ||
      video.closest('[data-testid="videoComponent"]') ||
      video.closest('[data-testid="placementTracking"]') ||
      video.parentElement
    );
  }

  function metaFor(video) {
    let screenName = null;
    let tweetId = null;
    const article = video.closest('article');

    if (article) {
      const links = article.querySelectorAll('a[href*="/status/"]');
      for (const link of links) {
        const path = new URL(link.href, location.origin).pathname;
        const parsed = /^\/([^/]+)\/status\/(\d+)/.exec(path);
        if (parsed) {
          screenName = parsed[1];
          tweetId = parsed[2];
          break;
        }
      }
    }

    if (!tweetId) {
      const parsed = /^\/([^/]+)\/status\/(\d+)/.exec(location.pathname);
      if (parsed) {
        screenName = parsed[1];
        tweetId = parsed[2];
      }
    }

    let index = 1;
    const scope = article || document;
    const gifs = Array.prototype.filter.call(scope.querySelectorAll('video'), gifSourceFor);
    const position = gifs.indexOf(video);
    if (position >= 0) index = position + 1;

    return { screenName: screenName, tweetId: tweetId, index: index };
  }

  function showToast(text, tone) {
    let toast = document.querySelector('.tgh-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'tgh-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.dataset.tone = tone || 'info';
    toast.classList.add('tgh-toast-visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.classList.remove('tgh-toast-visible');
    }, 4000);
  }

  function setButtonState(button, state, label) {
    button.dataset.state = state;
    const badge = button.querySelector('.tgh-button-label');
    if (state === 'idle') {
      badge.textContent = 'GIF';
      button.title = 'Telecharger ce GIF en .gif';
    } else {
      badge.textContent = label;
    }
  }

  async function startDownload(button, video) {
    const url = gifSourceFor(video);
    if (!url) {
      showToast('Aucun GIF detecte sur ce media', 'error');
      return;
    }
    if (button.dataset.state === 'working') return;

    buttonsByUrl.set(url, button);
    setButtonState(button, 'working', '0%');

    let response = null;
    try {
      response = await api.runtime.sendMessage({
        type: 'gifharvest:download',
        url: url,
        meta: metaFor(video)
      });
    } catch (error) {
      setButtonState(button, 'idle');
      showToast('Extension rechargee : actualise la page', 'error');
      return;
    }

    if (!response || !response.ok) {
      setButtonState(button, 'idle');
      showToast('Echec : ' + ((response && response.error) || 'conversion impossible'), 'error');
      return;
    }

    setButtonState(button, 'done', 'OK');
    setTimeout(function () {
      setButtonState(button, 'idle');
    }, 2500);
  }

  function attachButton(video) {
    const container = containerFor(video);
    if (!container) return;
    if (container.querySelector('.' + BUTTON_CLASS)) return;

    container.classList.add('tgh-host');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    const label = document.createElement('span');
    label.className = 'tgh-button-label';
    button.append(buildIcon(), label);
    setButtonState(button, 'idle');

    const swallow = function (event) {
      event.preventDefault();
      event.stopPropagation();
    };

    button.addEventListener('mousedown', swallow, true);
    button.addEventListener('pointerdown', swallow, true);
    button.addEventListener('click', function (event) {
      swallow(event);
      startDownload(button, video);
    }, true);

    container.appendChild(button);
  }

  function scan() {
    scheduled = false;
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (!gifSourceFor(video)) continue;
      attachButton(video);
    }
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 250);
  }

  document.addEventListener('contextmenu', function (event) {
    const target = event.target;
    if (target && target.tagName === 'VIDEO') {
      lastContextUrl = gifSourceFor(target);
      return;
    }
    const host = target && target.closest
      ? target.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]')
      : null;
    const video = host ? host.querySelector('video') : null;
    lastContextUrl = video ? gifSourceFor(video) : null;
  }, true);

  api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'gifharvest:resolve-context') {
      sendResponse({ url: lastContextUrl });
      return true;
    }

    if (message.type === 'gifharvest:progress') {
      const button = buttonsByUrl.get(message.sourceUrl);
      if (button && button.dataset.state === 'working') {
        setButtonState(button, 'working', message.percent + '%');
      }
      return;
    }

    if (message.type === 'gifharvest:done') {
      showToast('GIF enregistre : ' + message.filename, 'ok');
      return;
    }

    if (message.type === 'gifharvest:error') {
      showToast('Echec : ' + message.message, 'error');
    }
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', scheduleScan);
  scheduleScan();
})();
